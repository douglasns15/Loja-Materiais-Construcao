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

/**
 * Sinal disparado logo após gravar um repasse. Serve ao caso da janela flutuante (ADR-031): quando o
 * "Vender de novo" parte do Histórico FLUTUANTE com o PDV (`/venda`) já aberto por baixo, o
 * `router.push('/venda')` é no-op (mesma rota) e NÃO remonta a tela — então o efeito de montagem que
 * consome o repasse jamais roda. O PDV já montado escuta este evento e consome na hora.
 */
export const REORDER_SIGNAL = 'nexoloja:reorder-signal';

/**
 * Sinal disparado quando o operador CONFIRMA a revisão do reorder no PDV (itens somados ao carrinho).
 * Serve à janela flutuante (ADR-031): o Histórico flutuante que originou o "Vender de novo" continua
 * montado por baixo, preso no modo seleção. Ao ouvir isto, ele sai do modo seleção, limpa a seleção e
 * recarrega — voltando à tela normal do Histórico.
 */
export const REORDER_APPLIED_SIGNAL = 'nexoloja:reorder-applied';

/** Avisa que a revisão do reorder foi confirmada (ver REORDER_APPLIED_SIGNAL). */
export function signalReorderApplied(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REORDER_APPLIED_SIGNAL));
}

/** Um item de venda a repetir (snapshot do Histórico; o PDV resolve preço/estoque atuais). */
export type ReorderPayloadItem = {
  productId: string;
  productName: string;
  /** Unidade VENDIDA no pedido original (base ou embalagem) — o PDV deriva o modo com o catálogo. */
  unit: string;
  /** Quantidade na unidade vendida (string, como vem do GET /orders). */
  quantity: string;
  /**
   * Venda em par (ADR-015): quando o item foi vendido CASADO (ex.: parafuso + bucha), os dois lados
   * do par compartilham esta chave, para o PDV remontá-los COMO PAR (não como dois avulsos). É
   * `null` no item avulso. Já vem **namespaced por venda** (`${orderId}#${pairGroup}`) para não
   * colidir ao combinar itens de várias vendas na mesma seleção.
   */
  pairKey: string | null;
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
    // Avisa um PDV JÁ montado (janela flutuante) para consumir sem depender de remontar a rota.
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(REORDER_SIGNAL));
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
