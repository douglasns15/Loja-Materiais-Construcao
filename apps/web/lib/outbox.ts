import type { MutationEnvelope } from '@nexoloja/shared';

/**
 * Store `outbox` no IndexedDB — a fila de mutações offline (ADR-011 §1, AI 5).
 *
 * FIFO **por dispositivo**: o IndexedDB é escopado por origem+navegador, e a chave `seq` é
 * autoincremental, então ler em ordem de `seq` reproduz a ordem em que as mutações foram
 * criadas (essencial para respeitar dependências — abrir caixa antes da venda, ADR-011 §5).
 *
 * Esta fatia entrega **só a infraestrutura** (enfileirar/ler/marcar). O worker que drena a fila
 * e o `POST /orders` idempotente vêm nas fatias seguintes. Aplicar a mutação (efeitos no
 * servidor) NÃO acontece aqui.
 */

const DB_NAME = 'nexoloja';
const DB_VERSION = 1;
const STORE = 'outbox';

/** Estado de cada item na fila. `PENDING` nasce ao enfileirar; o worker move para `SYNCED`
 *  (aplicado no servidor — inclui o dedup 409), `ERROR` (falha transitória, será re-tentada),
 *  `FAILED` (falha dura/terminal — 4xx ou limite de tentativas; exige atenção) ou `CONFLICT`
 *  (só cadastros mutáveis — não ocorre na venda append-only, ADR-011 §4). Retryáveis = PENDING/ERROR. */
export type OutboxStatus = 'PENDING' | 'SYNCED' | 'ERROR' | 'FAILED' | 'CONFLICT';

export interface OutboxRecord {
  /** Chave autoincremental — define a ordem FIFO. Ausente só antes de gravar. */
  seq?: number;
  envelope: MutationEnvelope;
  status: OutboxStatus;
  /** Tentativas de sync já feitas (para backoff/limite no worker). */
  attempts: number;
  /** Última mensagem de erro (quando `status = ERROR`). */
  lastError?: string;
  /** ISO 8601 — quando entrou na fila. */
  enqueuedAt: string;
  /** ISO 8601 — última mudança de estado. */
  updatedAt: string;
}

/** `true` quando o ambiente tem IndexedDB (evita quebrar no SSR/hydration do Next). */
export function hasOutbox(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Abre (e cria/migra) o banco. Memoiza a conexão para não reabrir a cada chamada. */
function openDb(): Promise<IDBDatabase> {
  if (!hasOutbox()) return Promise.reject(new Error('IndexedDB indisponível'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
        // Índice único por `entityId`: impede enfileirar a MESMA venda duas vezes (ex.: clique
        // duplo / reabrir a tela). A idempotência de rede fica com o servidor (ADR-011 §2); esta
        // é a idempotência de ENFILEIRAMENTO no cliente.
        store.createIndex('entityId', 'envelope.entityId', { unique: true });
        // Índice por status para o worker varrer só os PENDING sem ler a fila inteira.
        store.createIndex('status', 'status', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Falha ao abrir o IndexedDB'));
  });
  return dbPromise;
}

/** Promise wrapper para uma request do IndexedDB. */
function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Erro no IndexedDB'));
  });
}

/**
 * Enfileira um envelope (status `PENDING`). Retorna o `seq` gerado. Se já existir um item com o
 * mesmo `entityId` (índice único), trata como **já enfileirado** e devolve o `seq` existente —
 * um reenfileiramento não é erro, é no-op idempotente no cliente.
 */
export async function enqueueMutation(envelope: MutationEnvelope): Promise<number> {
  const db = await openDb();
  const now = new Date().toISOString();
  const record: OutboxRecord = {
    envelope,
    status: 'PENDING',
    attempts: 0,
    enqueuedAt: now,
    updatedAt: now,
  };
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const key = await reqAsPromise(tx.objectStore(STORE).add(record) as IDBRequest<IDBValidKey>);
    return key as number;
  } catch (err) {
    // ConstraintError = já existe um envelope com este entityId → devolve o existente.
    if (err instanceof DOMException && err.name === 'ConstraintError') {
      const existing = await findByEntityId(envelope.entityId);
      if (existing?.seq != null) return existing.seq;
    }
    throw err;
  }
}

/** Lê um item pelo `entityId` (chave de idempotência). */
export async function findByEntityId(entityId: string): Promise<OutboxRecord | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const index = tx.objectStore(STORE).index('entityId');
  return reqAsPromise(index.get(entityId) as IDBRequest<OutboxRecord | undefined>);
}

/** Toda a fila, em ordem FIFO (por `seq`). */
export async function listOutbox(): Promise<OutboxRecord[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  return reqAsPromise(tx.objectStore(STORE).getAll() as IDBRequest<OutboxRecord[]>);
}

/** O primeiro item `PENDING` da fila (FIFO) — o próximo que o worker deve tentar sincronizar. */
export async function peekPending(): Promise<OutboxRecord | undefined> {
  const all = await listOutbox();
  return all.find((r) => r.status === 'PENDING' || r.status === 'ERROR');
}

/** Quantas vendas ainda não sincronizaram (para o indicador "X pendentes" da UI, fatia futura). */
export async function countPending(): Promise<number> {
  const all = await listOutbox();
  return all.filter((r) => r.status === 'PENDING' || r.status === 'ERROR').length;
}

/** Atualiza status/erro de um item (usado pelo worker). Incrementa `attempts` opcionalmente. */
async function patchRecord(
  seq: number,
  patch: Partial<Pick<OutboxRecord, 'status' | 'lastError'>>,
  bumpAttempt = false,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const current = await reqAsPromise(store.get(seq) as IDBRequest<OutboxRecord | undefined>);
  if (!current) return;
  const next: OutboxRecord = {
    ...current,
    ...patch,
    attempts: bumpAttempt ? current.attempts + 1 : current.attempts,
    updatedAt: new Date().toISOString(),
  };
  await reqAsPromise(store.put(next));
}

/** Marca como sincronizada (aplicada no servidor). */
export function markSynced(seq: number): Promise<void> {
  return patchRecord(seq, { status: 'SYNCED', lastError: undefined });
}

/** Marca falha transitória (re-tentar depois) e conta a tentativa. */
export function markError(seq: number, message: string): Promise<void> {
  return patchRecord(seq, { status: 'ERROR', lastError: message }, true);
}

/** Marca falha dura/terminal (4xx ou limite de tentativas): sai da varredura FIFO, exige atenção. */
export function markFailed(seq: number, message: string): Promise<void> {
  return patchRecord(seq, { status: 'FAILED', lastError: message }, true);
}

/** Marca conflito (só cadastros mutáveis — não ocorre na venda append-only). */
export function markConflict(seq: number, message?: string): Promise<void> {
  return patchRecord(seq, { status: 'CONFLICT', lastError: message }, true);
}

/** Remove um item da fila (ex.: depois de sincronizado e confirmado). */
export async function removeMutation(seq: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await reqAsPromise(tx.objectStore(STORE).delete(seq));
}
