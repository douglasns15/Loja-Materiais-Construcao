import { openDb, reqAsPromise, txDone, CATALOG_STORE, hasIndexedDb } from './db';

/**
 * Cache do catálogo de produtos no IndexedDB (ADR-012, Fatia CS-2, decisões (a)/(d)).
 *
 * O PDV precisa da lista de produtos para montar o carrinho, mas `GET /products` é cross-origin e
 * **nunca é cacheado** pelo Service Worker (ADR-011 §7) — offline, ao remontar/reabrir, o catálogo
 * sumia e o PDV ficava sem itens (achado 3.E.2). Guardamos o último catálogo lido para o cold-start
 * offline:
 *
 * - **Online:** a rede sempre vence (decisão (a)) — cada `GET /products` OK **sobrescreve** o
 *   espelho inteiro (produtos removidos/soft-deleted saem do cache).
 * - **Offline:** o PDV monta o carrinho a partir deste espelho. O `stockQty` é o **último conhecido**
 *   e é decrementado junto com a baixa otimista das vendas offline (ADR-011 §6), para a trava de
 *   estoque local seguir coerente após remontar.
 *
 * Só cache de leitura no aparelho — sem migration, sem custo de free tier.
 */

/** Produto no cache — mesmo formato que o PDV consome do `GET /products`. */
export interface CachedProduct {
  id: string;
  name: string;
  sku: string;
  salePrice: string;
  costPrice: string;
  stockQty: string;
}

/**
 * Substitui o catálogo em cache pela lista informada. Chamado a cada `GET /products` OK (espelho
 * fresco do servidor) e na baixa otimista offline (grava o `stockQty` já decrementado). **Best-effort:**
 * uma falha de IndexedDB nunca pode derrubar o fluxo de venda — só perde-se o espelho offline.
 */
export async function cacheProducts(products: CachedProduct[]): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(CATALOG_STORE, 'readwrite');
    const store = tx.objectStore(CATALOG_STORE);
    // Espelho fiel: limpa e regrava na MESMA transação (remove o que saiu do catálogo).
    store.clear();
    for (const p of products) {
      store.put({
        id: p.id,
        name: p.name,
        sku: p.sku,
        salePrice: p.salePrice,
        costPrice: p.costPrice,
        stockQty: p.stockQty,
      });
    }
    await txDone(tx);
  } catch {
    // Cache best-effort — offline segue com o último espelho que houver (ou vazio).
  }
}

/** Último catálogo conhecido (vazio se não há cache ou o IndexedDB falhou). */
export async function readCachedProducts(): Promise<CachedProduct[]> {
  if (!hasIndexedDb()) return [];
  try {
    const db = await openDb();
    const tx = db.transaction(CATALOG_STORE, 'readonly');
    return await reqAsPromise(tx.objectStore(CATALOG_STORE).getAll() as IDBRequest<CachedProduct[]>);
  } catch {
    return [];
  }
}
