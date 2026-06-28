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
