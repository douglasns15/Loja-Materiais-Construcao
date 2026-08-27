import { z } from 'zod';

/**
 * Schemas e tipos dos relatórios de vendas e caixa (Fase 2).
 * O intervalo é opcional: sem `from`/`to`, o relatório cobre todo o histórico.
 * Datas no formato YYYY-MM-DD (o servidor aplica as bordas do dia no fuso da loja).
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.');

export const reportRangeSchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});
export type ReportRange = z.infer<typeof reportRangeSchema>;

/** Quebra de faturamento por forma de pagamento. */
export interface PaymentMethodReport {
  method: string;
  total: number;
  count: number;
  /** Participação no total recebido, em % (2 casas). */
  share: number;
}

/** Resumo de vendas do período (canceladas fora dos totais, contadas à parte). */
export interface SalesReport {
  from: string | null;
  to: string | null;
  /**
   * **Recebido no período** — regime de caixa (ADR-019): dinheiro que efetivamente entrou =
   * pagamentos à vista das vendas do período + recebimentos de fiado do período (pela data do
   * recebimento). A parte a prazo de uma venda só conta quando é recebida.
   */
  totalRevenue: number;
  /** Nº de vendas CONFIRMED no período (pela data da venda). */
  salesCount: number;
  /** Recebido ÷ nº de vendas (0 se não houver vendas). */
  averageTicket: number;
  /** Nº de vendas canceladas no período (fora do recebido). */
  cancelledCount: number;
  /**
   * Informativo (ADR-019): total de vendas **a prazo geradas** no período (crédito concedido no
   * fiado). NÃO entra no recebido — é o que ficou a receber; conta como recebido conforme entra.
   */
  creditSalesGenerated: number;
  /** Total por forma de pagamento (à vista + recebimentos de fiado). Σ formas = recebido. */
  byPaymentMethod: PaymentMethodReport[];
}

/** Uma sessão de caixa fechada, com a divergência calculada. */
export interface CashSessionReport {
  id: string;
  openedAt: string;
  closedAt: string;
  /** Nome de quem abriu o caixa (snapshot, ADR-010); `null` se não registrado. */
  openedByName: string | null;
  /** Nome de quem fechou o caixa (snapshot, ADR-010); `null` se não registrado. */
  closedByName: string | null;
  openingAmount: number;
  closingAmount: number;
  expectedAmount: number;
  /** Contado − esperado: positivo = sobra, negativo = falta. */
  divergence: number;
  notes: string | null;
  /** Vendas offline anexadas a este caixa DEPOIS do fechamento (CS-4, ADR-012 §b) —
   * marca de reconciliação. `0` quando não houve. */
  lateSalesCount: number;
  /** Soma (total) das vendas anexadas após o fechamento (reconciliação, CS-4). */
  lateSalesTotal: number;
  /** Parcela em DINHEIRO das vendas tardias — só o que tocaria a gaveta (CS-5). */
  lateCashSalesTotal: number;
  /** Esperado recalculado = `expectedAmount` + `lateCashSalesTotal` (CS-5).
   * NÃO reescreve o dado congelado do fechamento; é só a conta pronta para conferência. */
  adjustedExpected: number;
  /** Divergência recalculada = `closingAmount` − `adjustedExpected` (CS-5). */
  adjustedDivergence: number;
}

/**
 * Drill-down por forma de pagamento (Relatórios v2, Fatia 3). Além do intervalo, exige a `method`
 * (a forma clicada). O servidor devolve a COMPOSIÇÃO daquele valor — as vendas à vista e os
 * recebimentos de dívida que somam o "Recebido" da forma no período (Σ linhas = total da forma).
 */
export const paymentCompositionSchema = reportRangeSchema.extend({
  method: z.string().min(1).max(30),
});
export type PaymentCompositionQuery = z.infer<typeof paymentCompositionSchema>;

/** Uma linha da composição do recebido de uma forma: uma venda à vista OU um recebimento de dívida. */
export interface PaymentCompositionRow {
  /** `venda` = pagamento à vista de uma venda; `divida` = recebimento de uma dívida (fiado). */
  tipo: 'venda' | 'divida';
  /** Identificador humano da origem: nº do pedido (`#000123`) ou código da dívida (`D-0001`). */
  ref: string;
  /** Cliente (ou "Consumidor" quando a venda à vista não tem cliente). */
  descricao: string;
  /** Valor que entrou nesta linha. À vista = `Payment.amount`; dívida = `amount + surcharge` (ADR-022). */
  valor: number;
  /** Data do evento (ISO): venda = data da venda; dívida = data do recebimento (`paidAt`, regime de caixa). */
  data: string;
}

/**
 * Composição do recebido de UMA forma no período (Fatia 3). `total` deve bater com o total daquela
 * forma em `GET /reports/sales` (mesma regra de caixa, ADR-019): é o gate do drill-down.
 */
export interface PaymentComposition {
  method: string;
  from: string | null;
  to: string | null;
  /** Σ dos `valor` das linhas — bate com o total da forma em `/reports/sales`. */
  total: number;
  rows: PaymentCompositionRow[];
}

/**
 * Consulta dos rankings de produtos/clientes (Relatórios v2, Fatia 5). Além do intervalo, aceita
 * busca `q` (sem acento, no servidor) e o critério de ordenação. `limit` limita o tamanho da lista.
 */
export const topReportSchema = reportRangeSchema.extend({
  q: z.string().trim().max(80).optional(),
  /** `faturamento` (padrão) ou `lucro` (usa o custo carimbado — ADR-027). */
  orderBy: z.enum(['faturamento', 'lucro']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type TopReportQuery = z.infer<typeof topReportSchema>;

/**
 * Linha do ranking de PRODUTOS no período (Fatia 5). Lucro/margem só das vendas com custo carimbado
 * (ADR-027); `costCoverage < 1` sinaliza que parte do faturamento não tem custo (venda antiga).
 */
export interface TopProductRow {
  productId: string;
  productName: string;
  /** Faturamento do produto (Σ dos totais das linhas), inclui vendas sem custo. */
  revenue: number;
  /** Quantidade vendida (na unidade do produto). */
  qty: number;
  /** Nº de vendas que incluíram o produto (base do ticket). */
  salesCount: number;
  /** Lucro bruto (só linhas com custo). Ver `costCoverage`. */
  grossProfit: number;
  /** Margem % sobre a receita coberta. */
  marginPercent: number;
  /** Fração do faturamento com custo (0..1). `< 1` ⇒ lucro/margem parciais. */
  costCoverage: number;
}

/** "Quem mais compra" um produto (Fatia 5): top clientes por faturamento naquele produto. */
export interface ProductCustomerRow {
  /** `null` quando a venda foi sem cliente (consumidor). */
  customerId: string | null;
  customerName: string;
  qty: number;
  revenue: number;
}
