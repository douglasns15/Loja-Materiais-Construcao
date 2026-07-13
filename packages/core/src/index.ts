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

/**
 * Fechamento ajustado por vendas offline tardias (CS-5, ADR-012 §b).
 *
 * Uma venda offline pode ser anexada a um caixa JÁ FECHADO no sync (CS-4). O dado
 * congelado do fechamento (`expected`/`divergence`) permanece **imutável** para a
 * auditoria; esta função só recalcula, para exibição no relatório, quanto o esperado
 * "deveria" ter sido incluindo a **parcela em dinheiro** dessas vendas tardias.
 *
 * Só o dinheiro entra no ajuste — cartão/PIX não passam pela gaveta (conciliam na
 * maquininha), exatamente como no cálculo do esperado (`calcExpectedCash`).
 *
 * @param expectedAmount  esperado congelado no fechamento
 * @param closingAmount   contado no fechamento
 * @param lateCashSalesTotal  Σ da parcela CASH das vendas anexadas após o fechamento
 */
export function calcAdjustedCashClosing(
  expectedAmount: number,
  closingAmount: number,
  lateCashSalesTotal: number,
): { adjustedExpected: number; adjustedDivergence: number } {
  const adjustedExpected = Number((expectedAmount + lateCashSalesTotal).toFixed(2));
  return {
    adjustedExpected,
    adjustedDivergence: calcCashDivergence(adjustedExpected, closingAmount),
  };
}

/** Movimentação de caixa que não é venda (devolução, sangria, suprimento, despesa). */
export interface CashMovementLike {
  type: StockMovementType; // reaproveita 'INCOME' | 'EXPENSE'
  amount: number;
}

/**
 * Saldo líquido das movimentações de caixa: Σ INCOME − Σ EXPENSE.
 * Entra no valor esperado do caixa junto com a abertura e as vendas em dinheiro,
 * permitindo que uma devolução (EXPENSE) reduza o esperado do caixa de hoje.
 * Arredondado a 2 casas.
 */
export function netCashMovements(movements: CashMovementLike[]): number {
  const total = movements.reduce(
    (acc, m) => acc + (m.type === 'INCOME' ? m.amount : -m.amount),
    0,
  );
  return Number(total.toFixed(2));
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

// =============================================================================
// SINCRONIZAÇÃO OFFLINE (Outbox) — ADR-011
// =============================================================================
//
// Máquina de estados PURA da fila de sync (funções `(entrada) => saída`, sem I/O). O worker no
// cliente (apps/web) faz o I/O (IndexedDB + fetch) e delega TODA a decisão a estas funções, que
// são testadas com Vitest (CLAUDE.md). Regras (ADR-011 §5–6): drenar em FIFO, **parar na 1ª falha
// dura** (não reordenar/pular) e re-tentar só falhas transitórias com backoff.

/**
 * Desfecho de uma tentativa de sincronizar um item da fila:
 * - `SYNCED`: aplicado no servidor (ou já estava — dedup idempotente). Remover da fila.
 * - `RETRY`: falha transitória (rede/servidor 5xx). Manter na fila e re-tentar depois.
 * - `FAILED`: falha dura (4xx — payload inválido, dependência ausente). Parar a fila; exige atenção.
 */
export type SyncOutcome = 'SYNCED' | 'RETRY' | 'FAILED';

/** Máximo de tentativas antes de um item transitório virar falha dura (evita loop infinito). */
export const MAX_SYNC_ATTEMPTS = 5;

/**
 * Classifica o resultado HTTP de um envio da fila. Idempotência (ADR-011 §2): **409 = já aplicado**
 * (a PK já existia) → tratamos como `SYNCED`, não como erro. 2xx = aplicado agora. 5xx = servidor
 * transitório → `RETRY`. Demais 4xx = erro de cliente (payload/dependência) → `FAILED` (falha dura).
 */
export function classifyHttpOutcome(status: number): SyncOutcome {
  if (status === 409) return 'SYNCED'; // dedup: a venda já existe no servidor
  if (status >= 200 && status < 300) return 'SYNCED';
  if (status >= 500) return 'RETRY';
  return 'FAILED';
}

/**
 * Desfecho quando o próprio `fetch` falhou (sem resposta HTTP): offline/DNS/timeout. É sempre
 * transitório — a rede volta — então `RETRY` (a fila drena de novo no próximo gatilho `online`).
 */
export function classifyNetworkError(): SyncOutcome {
  return 'RETRY';
}

/**
 * Dado o desfecho e quantas tentativas o item JÁ acumulou (antes desta), decide se ainda vale
 * re-tentar. Só `RETRY` re-tenta, e só enquanto não estourar `MAX_SYNC_ATTEMPTS` — depois disso
 * o item transitório é promovido a falha dura (para não travar a fila para sempre).
 */
export function shouldRetry(outcome: SyncOutcome, attempts: number): boolean {
  return outcome === 'RETRY' && attempts < MAX_SYNC_ATTEMPTS;
}

/**
 * Backoff exponencial (ms) para a próxima tentativa a partir do nº de tentativas já feitas:
 * 1s, 2s, 4s, 8s… com teto de 30s. Puro e determinístico (sem jitter) para ser testável; o
 * jitter, se necessário, fica no worker.
 */
export function syncBackoffMs(attempts: number): number {
  const base = 1000 * 2 ** Math.max(0, attempts);
  return Math.min(base, 30000);
}

/**
 * `true` quando a fila deve **parar** de drenar após este desfecho — ou seja, tudo que não foi
 * `SYNCED`. Falha dura (`FAILED`) e transitória (`RETRY`) ambas param o avanço FIFO (ADR-011 §5:
 * não pular itens); a diferença é que `RETRY` volta a tentar no próximo gatilho e `FAILED` não.
 */
export function haltsQueue(outcome: SyncOutcome): boolean {
  return outcome !== 'SYNCED';
}
