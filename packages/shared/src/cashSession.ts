import { z } from 'zod';

/**
 * Schemas de Caixa (CashSession). `tenantId`/`userId` vêm do contexto (JWT).
 */
export const openCashSessionSchema = z.object({
  openingAmount: z.number().nonnegative(),
});
export type OpenCashSessionInput = z.infer<typeof openCashSessionSchema>;

export const closeCashSessionSchema = z.object({
  closingAmount: z.number().nonnegative(),
  notes: z.string().max(500).optional(),
});
export type CloseCashSessionInput = z.infer<typeof closeCashSessionSchema>;

/**
 * Movimentação manual de caixa (Movimentação de Caixa): Suprimento (entrada) ou
 * Sangria (saída). O motivo é obrigatório (rastreabilidade — o operador precisa dizer
 * por que mexeu no caixa). O sinal contábil (INCOME/EXPENSE) NÃO vem daqui: é derivado
 * do `kind` por `manualCashMovementType` no core, fonte única para API e UI.
 */
export const cashMovementSchema = z.object({
  kind: z.enum(['SUPPLY', 'WITHDRAWAL']),
  amount: z.number().positive(),
  reason: z.string().trim().min(1).max(300),
});
export type CashMovementInput = z.infer<typeof cashMovementSchema>;
