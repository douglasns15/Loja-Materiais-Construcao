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
  /** Faturamento das vendas CONFIRMED no período. */
  totalRevenue: number;
  /** Nº de vendas CONFIRMED no período. */
  salesCount: number;
  /** Faturamento ÷ nº de vendas (0 se não houver vendas). */
  averageTicket: number;
  /** Nº de vendas canceladas no período (fora do faturamento). */
  cancelledCount: number;
  /** Total por forma de pagamento (só vendas não canceladas). */
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
