import type { MutationEnvelope } from '@nexoloja/shared';
import { openDb, reqAsPromise, OUTBOX_STORE as STORE, hasIndexedDb } from './db';

/**
 * Store `outbox` no IndexedDB — a fila de mutações offline (ADR-011 §1, AI 5).
 *
 * FIFO **por dispositivo**: o IndexedDB é escopado por origem+navegador, e a chave `seq` é
 * autoincremental, então ler em ordem de `seq` reproduz a ordem em que as mutações foram
 * criadas (essencial para respeitar dependências — abrir caixa antes da venda, ADR-011 §5).
 *
 * A abertura/migração do banco vive em `db.ts` (abridor compartilhado com o store `catalog` da
 * CS-2). Este módulo cuida só das operações da fila (enfileirar/ler/marcar/podar).
 */

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

/** `true` quando o ambiente tem IndexedDB (evita quebrar no SSR/hydration do Next).
 *  Alias de `hasIndexedDb` mantido pelo nome histórico usado nos imports da fila. */
export function hasOutbox(): boolean {
  return hasIndexedDb();
}

// --- Pub/sub: avisa a UI quando a fila muda (enfileirar/sincronizar/podar/descartar) ---
// Permite que qualquer indicador montado (o chip global no topo, o painel do PDV, a tela de
// pendências) se atualize sem prop-drilling nem polling. Só um mecanismo de UX; a verdade é a store.
type OutboxListener = () => void;
const listeners = new Set<OutboxListener>();

/** Assina mudanças na fila. Retorna a função para cancelar a assinatura. */
export function subscribeOutbox(fn: OutboxListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Notifica os assinantes. Um listener que quebra não derruba os outros. */
function notifyOutbox(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // ignora — a UI se recompõe no próximo evento
    }
  }
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
    notifyOutbox();
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

/** Quantas vendas ainda não sincronizaram (retryáveis) — usado pelo worker no `guard` do loop. */
export async function countPending(): Promise<number> {
  const all = await listOutbox();
  return all.filter((r) => r.status === 'PENDING' || r.status === 'ERROR').length;
}

/** Contagem por categoria de UI: pendentes (PENDING/ERROR, ainda vão sozinhas) e com falha
 *  (FAILED/CONFLICT, exigem atenção do operador na tela de pendências). */
export interface OutboxCounts {
  pending: number;
  failed: number;
}
export async function countOutbox(): Promise<OutboxCounts> {
  const all = await listOutbox();
  let pending = 0;
  let failed = 0;
  for (const r of all) {
    if (r.status === 'PENDING' || r.status === 'ERROR') pending++;
    else if (r.status === 'FAILED' || r.status === 'CONFLICT') failed++;
  }
  return { pending, failed };
}

/** Atualiza status/erro de um item. `bumpAttempt` conta a tentativa (worker); `resetAttempts`
 *  zera o contador (retry manual, para dar backoff/limite frescos). */
async function patchRecord(
  seq: number,
  patch: Partial<Pick<OutboxRecord, 'status' | 'lastError'>>,
  opts: { bumpAttempt?: boolean; resetAttempts?: boolean } = {},
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const current = await reqAsPromise(store.get(seq) as IDBRequest<OutboxRecord | undefined>);
  if (!current) return;
  const attempts = opts.resetAttempts
    ? 0
    : opts.bumpAttempt
      ? current.attempts + 1
      : current.attempts;
  const next: OutboxRecord = {
    ...current,
    ...patch,
    attempts,
    updatedAt: new Date().toISOString(),
  };
  await reqAsPromise(store.put(next));
  notifyOutbox();
}

/** Marca como sincronizada (aplicada no servidor). */
export function markSynced(seq: number): Promise<void> {
  return patchRecord(seq, { status: 'SYNCED', lastError: undefined });
}

/** Marca falha transitória (re-tentar depois) e conta a tentativa. */
export function markError(seq: number, message: string): Promise<void> {
  return patchRecord(seq, { status: 'ERROR', lastError: message }, { bumpAttempt: true });
}

/** Marca falha dura/terminal (4xx ou limite de tentativas): sai da varredura FIFO, exige atenção. */
export function markFailed(seq: number, message: string): Promise<void> {
  return patchRecord(seq, { status: 'FAILED', lastError: message }, { bumpAttempt: true });
}

/** Marca conflito (só cadastros mutáveis — não ocorre na venda append-only). */
export function markConflict(seq: number, message?: string): Promise<void> {
  return patchRecord(seq, { status: 'CONFLICT', lastError: message }, { bumpAttempt: true });
}

/** Recoloca um item na fila (retry manual da tela de pendências): volta a `PENDING`, limpa o erro
 *  e zera as tentativas para o worker tentar de novo com backoff/limite frescos. */
export function requeue(seq: number): Promise<void> {
  return patchRecord(seq, { status: 'PENDING', lastError: undefined }, { resetAttempts: true });
}

/** Remove um item da fila (poda de sincronizado, ou descarte manual de um item com falha). */
export async function removeMutation(seq: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await reqAsPromise(tx.objectStore(STORE).delete(seq));
  notifyOutbox();
}

/**
 * Poda os itens já sincronizados (`SYNCED`) — mantém a fila enxuta (a venda offline é append-only,
 * então um item aplicado no servidor não tem mais utilidade no cliente). Deixa intactos os
 * retryáveis (PENDING/ERROR) e os que exigem atenção (FAILED/CONFLICT). Retorna quantos removeu.
 */
export async function pruneSynced(): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const index = tx.objectStore(STORE).index('status');
  const keys = await reqAsPromise(
    index.getAllKeys(IDBKeyRange.only('SYNCED')) as IDBRequest<IDBValidKey[]>,
  );
  if (keys.length === 0) return 0;
  // Emite todos os deletes na MESMA transação (síncrono no map) para não fechar a tx entre awaits.
  const wtx = db.transaction(STORE, 'readwrite');
  const wstore = wtx.objectStore(STORE);
  await Promise.all(keys.map((k) => reqAsPromise(wstore.delete(k))));
  notifyOutbox();
  return keys.length;
}
