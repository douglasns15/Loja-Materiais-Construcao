/**
 * Handoff de "Vender de novo" (reorder) do Histórico de Vendas para o PDV.
 *
 * O Histórico não tem o catálogo vivo (preço/estoque) — quem repreça é o PDV. Então a passagem é
 * simples: o Histórico grava os itens crus das vendas selecionadas (produto + unidade vendida +
 * quantidade) no sessionStorage e navega para /venda; o PDV lê UMA vez, resolve contra o catálogo
 * atual (planReorder, no core), mostra a revisão e joga no carrinho. sessionStorage (não local):
 * é um repasse de uso único, some ao fechar a aba, e nunca deve vazar entre sessões.
 */
const KEY = 'nexoloja:reorder';

/** Um item de venda a repetir (snapshot do Histórico; o PDV resolve preço/estoque atuais). */
export type ReorderPayloadItem = {
  productId: string;
  productName: string;
  /** Unidade VENDIDA no pedido original (base ou embalagem) — o PDV deriva o modo com o catálogo. */
  unit: string;
  /** Quantidade na unidade vendida (string, como vem do GET /orders). */
  quantity: string;
};

/** O que trafega do Histórico para o PDV: quantas vendas e os itens (já achatados). */
export type ReorderPayload = {
  /** Quantas vendas o operador selecionou (para a revisão dizer "de N vendas"). */
  sales: number;
  items: ReorderPayloadItem[];
};

/** Grava o repasse e deixa pronto para o PDV consumir na próxima montagem. Best-effort. */
export function writeReorderPayload(payload: ReorderPayload): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage indisponível (aba privada/limitada): o reorder simplesmente não acontece.
  }
}

/** Lê e REMOVE o repasse (uso único). Retorna null quando não há nada válido. */
export function takeReorderPayload(): ReorderPayload | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as ReorderPayload;
    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}
