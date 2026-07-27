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

/** Natureza de uma movimentação de caixa (ADR-006), inclusive as que não são lançamento manual
 * (RETURN = devolução de venda). Espelha o enum `CashMovementKind` do Prisma. */
export type CashMovementKind = 'RETURN' | 'WITHDRAWAL' | 'SUPPLY' | 'EXPENSE';

/** Rótulos amigáveis por natureza — usados no extrato do Caixa e no histórico em Relatórios. */
export const CASH_MOVEMENT_KIND_LABELS: Record<CashMovementKind, string> = {
  SUPPLY: 'Suprimento',
  WITHDRAWAL: 'Sangria',
  RETURN: 'Devolução',
  EXPENSE: 'Despesa',
};

/** Uma linha do extrato de movimentações do caixa, como retornada por `GET /cash-sessions/movements`
 * (`amount` é Decimal serializado em string). Compartilhado entre a tela do Caixa e a de Relatórios. */
export type CashMovementRow = {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  kind: CashMovementKind;
  amount: string;
  reason: string | null;
  relatedOrderId: string | null;
  registeredByName: string | null;
  createdAt: string;
};
