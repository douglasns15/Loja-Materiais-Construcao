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

/**
 * Margem de lucro percentual sobre o preço de venda (markup sobre venda).
 * Ex: custo 60, venda 100 → 40%. Retorna 0 se o preço de venda for <= 0.
 * Arredondada a 2 casas para exibição.
 */
export function calcMarginPercent(costPrice: number, salePrice: number): number {
  if (salePrice <= 0) return 0;
  return Number((((salePrice - costPrice) / salePrice) * 100).toFixed(2));
}

// =============================================================================
// CAIXA (Cash Session)
// =============================================================================

/**
 * Valor esperado no caixa = abertura + entradas em dinheiro durante a sessão.
 * Usado no fechamento para comparar com o valor contado pelo operador.
 */
export function calcExpectedCash(openingAmount: number, cashInflows: number[]): number {
  const total = cashInflows.reduce((acc, v) => acc + v, openingAmount);
  return Number(total.toFixed(2));
}

/**
 * Divergência de fechamento = valor contado − valor esperado.
 * Positivo = sobra; negativo = falta; 0 = bateu. Arredondada a 2 casas.
 */
export function calcCashDivergence(expectedAmount: number, closingAmount: number): number {
  return Number((closingAmount - expectedAmount).toFixed(2));
}

// =============================================================================
// VENDA (Sale / PDV)
// =============================================================================

export interface SaleItemInput {
  quantity: number;
  unitPrice: number;
  discount?: number;
}

/** Total de uma linha da venda: quantidade × preço unitário − desconto da linha. */
export function calcSaleItemTotal(item: SaleItemInput): number {
  return Number((item.quantity * item.unitPrice - (item.discount ?? 0)).toFixed(2));
}

/**
 * Subtotal (soma das linhas) e total (subtotal − desconto + frete) de uma venda.
 * Reaproveita `calcOrderTotal`. Tudo arredondado a 2 casas.
 */
export function calcSaleTotals(
  items: SaleItemInput[],
  opts: { discountAmount?: number; freightAmount?: number } = {},
): { subtotal: number; total: number } {
  const subtotal = Number(
    items.reduce((acc, item) => acc + calcSaleItemTotal(item), 0).toFixed(2),
  );
  const total = Number(
    calcOrderTotal({
      subtotal,
      discountAmount: opts.discountAmount,
      freightAmount: opts.freightAmount,
    }).toFixed(2),
  );
  return { subtotal, total };
}

// =============================================================================
// ESTOQUE (Stock) — ADR-001
// =============================================================================

/** Tipo de movimentação de estoque. Espelha o enum `TransactionType` do schema. */
export type StockMovementType = 'INCOME' | 'EXPENSE';

export interface StockMovementLike {
  type: StockMovementType;
  quantity: number;
}

/**
 * Aplica uma movimentação sobre o estoque atual: INCOME soma, EXPENSE subtrai.
 * Retorna o novo saldo arredondado a 4 casas (mesma precisão de `Product.stockQty`).
 */
export function applyStockMovement(
  currentQty: number,
  type: StockMovementType,
  quantity: number,
): number {
  const delta = type === 'INCOME' ? quantity : -quantity;
  return Number((currentQty + delta).toFixed(4));
}

/**
 * Reconciliação de estoque (ADR-001): saldo = Σ INCOME − Σ EXPENSE.
 * Fonte de verdade auditável para corrigir divergências no cache `Product.stockQty`.
 */
export function reconcileStock(movements: StockMovementLike[]): number {
  const total = movements.reduce(
    (acc, m) => acc + (m.type === 'INCOME' ? m.quantity : -m.quantity),
    0,
  );
  return Number(total.toFixed(4));
}

/**
 * Traduz uma contagem de inventário no movimento necessário para chegar nela.
 * Ex: estoque atual 10, contado 7 → EXPENSE de 3; contado 12 → INCOME de 2.
 * `quantity` 0 indica que a contagem já bate (nenhum movimento necessário).
 */
export function calcInventoryAdjustment(
  currentQty: number,
  countedQty: number,
): { type: StockMovementType; quantity: number } {
  const delta = Number((countedQty - currentQty).toFixed(4));
  return {
    type: delta >= 0 ? 'INCOME' : 'EXPENSE',
    quantity: Math.abs(delta),
  };
}

// =============================================================================
// RELATÓRIOS (Reports) — vendas por período e formas de pagamento
// =============================================================================

/**
 * Ticket médio = faturamento ÷ nº de vendas. Retorna 0 quando não há vendas
 * (evita divisão por zero). Arredondado a 2 casas para exibição.
 */
export function calcAverageTicket(totalRevenue: number, salesCount: number): number {
  if (salesCount <= 0) return 0;
  return Number((totalRevenue / salesCount).toFixed(2));
}

/** Total agregado por forma de pagamento (entrada crua vinda do groupBy). */
export interface PaymentMethodTotal {
  method: string;
  total: number;
  count: number;
}

/** Forma de pagamento com sua participação percentual no total recebido. */
export interface PaymentMethodShare extends PaymentMethodTotal {
  /** Participação no total recebido, em % (2 casas). 0 quando o total é 0. */
  share: number;
}

/**
 * Enriquece a quebra por forma de pagamento com a participação percentual de
 * cada uma no total recebido e ordena da maior para a menor. Função pura: a
 * soma por método já vem agregada do banco (cost-zero); aqui só derivamos o %.
 */
export function withPaymentShare(rows: PaymentMethodTotal[]): PaymentMethodShare[] {
  const grandTotal = rows.reduce((acc, r) => acc + r.total, 0);
  return rows
    .map((r) => ({
      ...r,
      share: grandTotal > 0 ? Number(((r.total / grandTotal) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.total - a.total);
}
