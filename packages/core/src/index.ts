/**
 * Lógica de negócio PURA (sem I/O) — funções `(entrada) => saída` testáveis com Vitest.
 * Reusada no cliente (apps/web) e no servidor (apps/api), conforme CLAUDE.md.
 *
 * Esta é a semente da Fase 1: cálculos de caixa, estoque e frete entram aqui.
 */

export interface OrderItemLike {
  /** Total já calculado da linha (quantidade × preço − desconto). */
  total: number;
}

/** Soma os totais das linhas para obter o subtotal de um pedido. */
export function calcSubtotal(items: OrderItemLike[]): number {
  return items.reduce((acc, item) => acc + item.total, 0);
}

/**
 * Total de um pedido a partir do subtotal, desconto e frete.
 * Mantém a regra simples e pura para ser reaproveitada no PDV e na API.
 */
export function calcOrderTotal(params: {
  subtotal: number;
  discountAmount?: number;
  freightAmount?: number;
}): number {
  const { subtotal, discountAmount = 0, freightAmount = 0 } = params;
  return subtotal - discountAmount + freightAmount;
}
