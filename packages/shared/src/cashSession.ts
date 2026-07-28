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

/**
 * Estorno de um lançamento manual (corrigir um Suprimento/Sangria feito por engano). Não apaga
 * a linha: gera um **contra-lançamento** de sinal oposto que zera o efeito no caixa, preservando
 * o rastro (mesma filosofia da devolução vs. apagar a venda). O `id` do lançamento a estornar vem
 * na URL; o motivo é **opcional** (a API preenche "Estorno: <motivo original>" quando ausente).
 */
export const reverseCashMovementSchema = z.object({
  reason: z.string().trim().min(1).max(300).optional(),
});
export type ReverseCashMovementInput = z.infer<typeof reverseCashMovementSchema>;

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

/**
 * Uma linha do extrato é um **estorno** de lançamento manual (Suprimento/Sangria) quando tem
 * `relatedOrderId` preenchido e NÃO é uma devolução. Como `relatedOrderId` é uma referência solta
 * (ADR-006), o `kind` desambigua: `RETURN` → aponta para uma venda (devolução); manual (SUPPLY/
 * WITHDRAWAL) com `relatedOrderId` → aponta para o `CashMovement` que este estorno reverteu.
 */
export function isReversalRow(row: CashMovementRow): boolean {
  return row.relatedOrderId !== null && row.kind !== 'RETURN';
}

/**
 * O lançamento `row` já foi estornado? (alguma linha do extrato é o estorno dele). Usado para não
 * oferecer "Estornar" duas vezes e não duplicar o efeito no caixa — espelha a guarda do servidor.
 */
export function hasBeenReversed(row: CashMovementRow, all: CashMovementRow[]): boolean {
  return all.some((m) => m.relatedOrderId === row.id && m.kind !== 'RETURN');
}

/**
 * Um lançamento é **estornável** (mostra o botão "Estornar") quando é manual (Suprimento/Sangria),
 * não é ele mesmo um estorno e ainda não foi estornado. Devolução tem fluxo próprio; despesa/venda
 * não entram aqui. Fonte única da regra para o servidor e a UI concordarem.
 */
export function isReversibleRow(row: CashMovementRow, all: CashMovementRow[]): boolean {
  const isManual = row.kind === 'SUPPLY' || row.kind === 'WITHDRAWAL';
  return isManual && !isReversalRow(row) && !hasBeenReversed(row, all);
}
