import { z } from 'zod';
import { paymentMethodSchema, type PaymentMethod } from './sale';

/**
 * Conta a receber / venda a prazo — o "fiado" (ADR-019). Tipos e schemas compartilhados entre
 * apps/web e apps/api. A dívida nasce na venda (parcela "A prazo" no PDV) e é abatida por
 * recebimentos (total ou parcial); receber em dinheiro gera um Suprimento no caixa.
 */

/** Situação de uma conta a receber. Espelha o enum `ReceivableStatus` do Prisma. */
export type ReceivableStatus = 'OPEN' | 'PAID' | 'CANCELLED';

export const RECEIVABLE_STATUS_LABELS: Record<ReceivableStatus, string> = {
  OPEN: 'Em aberto',
  PAID: 'Quitada',
  CANCELLED: 'Cancelada',
};

/**
 * Payload para registrar um recebimento contra uma conta a receber (ADR-019). O valor é
 * validado no servidor contra o saldo devedor (`isValidReceipt` do core — positivo e ≤ saldo).
 * `method` reusa as formas de pagamento da venda; em dinheiro (`CASH`), o servidor lança um
 * Suprimento no caixa aberto (por isso o recebimento em dinheiro exige caixa aberto).
 */
export const receiveReceivableSchema = z.object({
  amount: z.number().positive(),
  method: paymentMethodSchema,
  reference: z.string().max(100).optional(),
});
export type ReceiveReceivableInput = z.infer<typeof receiveReceivableSchema>;

/** Um recebimento de uma conta a receber, como retornado pela API (`amount` serializado). */
export type ReceivablePaymentRow = {
  id: string;
  amount: string;
  method: PaymentMethod | string;
  paidAt: string;
  receivedByName: string | null;
  reference: string | null;
};

/**
 * Uma conta a receber, como retornada por `GET /receivables`. `originalAmount`/`settledAmount`
 * são Decimais serializados em string; `balance` (saldo devedor) vem calculado do servidor
 * (fonte única `receivableBalance` do core). `customerName` é o snapshot para a lista.
 */
export type ReceivableRow = {
  id: string;
  orderId: string;
  customerId: string;
  customerName: string | null;
  originalAmount: string;
  settledAmount: string;
  balance: number;
  status: ReceivableStatus;
  dueDate: string | null;
  createdAt: string;
  createdByName: string | null;
};
