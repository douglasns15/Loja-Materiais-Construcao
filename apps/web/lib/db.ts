/**
 * Abridor compartilhado do IndexedDB `nexoloja` (cliente).
 *
 * O IndexedDB tem **uma** versão por banco, então todos os stores do app moram no mesmo banco e são
 * criados/migrados aqui, num único `onupgradeneeded`. Hoje há dois:
 *  - `outbox`  — fila de mutações offline (ADR-011). Store original (v1).
 *  - `catalog` — cache do catálogo de produtos para o cold-start offline (ADR-012 CS-2). Entrou na v2.
 *
 * Centralizar o abridor evita que dois módulos abram o mesmo banco com versões divergentes (o que o
 * IndexedDB rejeita) e mantém **uma** conexão memoizada. Sem migration de servidor — é o banco local
 * do aparelho.
 */

export const DB_NAME = 'nexoloja';
/** v1 = só `outbox`; v2 = + `catalog` (ADR-012 CS-2). Subir aqui ao adicionar/alterar um store. */
export const DB_VERSION = 2;

export const OUTBOX_STORE = 'outbox';
export const CATALOG_STORE = 'catalog';

/** `true` quando o ambiente tem IndexedDB (evita quebrar no SSR/hydration do Next). */
export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Abre (e cria/migra) o banco. Memoiza a conexão para não reabrir a cada chamada. */
export function openDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) return Promise.reject(new Error('IndexedDB indisponível'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Checagem por store (idempotente): cobre tanto o banco novo (cria os dois) quanto o upgrade
      // v1→v2 de quem já tinha `outbox` (só falta criar `catalog`) — sem perder a fila existente.
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const store = db.createObjectStore(OUTBOX_STORE, { keyPath: 'seq', autoIncrement: true });
        // Índice único por `entityId`: impede enfileirar a MESMA venda duas vezes (ADR-011 §2 é a
        // idempotência de REDE; esta é a de ENFILEIRAMENTO no cliente).
        store.createIndex('entityId', 'envelope.entityId', { unique: true });
        // Índice por status para o worker varrer só os PENDING sem ler a fila inteira.
        store.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(CATALOG_STORE)) {
        // Chave = `id` do produto (UUID). Espelho do catálogo; sobrescrito a cada GET /products OK.
        db.createObjectStore(CATALOG_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Falha ao abrir o IndexedDB'));
  });
  return dbPromise;
}

/** Promise wrapper para uma request do IndexedDB. */
export function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Erro no IndexedDB'));
  });
}

/** Resolve quando a transação inteira completa (ou rejeita se abortar) — para escritas em lote. */
export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Erro na transação IndexedDB'));
    tx.onabort = () => reject(tx.error ?? new Error('Transação IndexedDB abortada'));
  });
}
