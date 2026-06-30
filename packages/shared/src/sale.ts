import { z } from 'zod';

/** Formas de pagamento aceitas (cartão separado em débito e crédito). */
export const paymentMethodSchema = z.enum(['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'PIX']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Dinheiro',
  DEBIT_CARD: 'Cartão Débito',
  CREDIT_CARD: 'Cartão Crédito',
  PIX: 'PIX',
};

export const saleItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().optional(),
});
export type SaleItemInput = z.infer<typeof saleItemSchema>;

export const salePaymentSchema = z.object({
  method: paymentMethodSchema,
  amount: z.number().positive(),
});

/** Payload para registrar uma venda. `tenantId`/`userId`/caixa vêm do contexto. */
export const createSaleSchema = z.object({
  customerId: z.string().uuid().optional(),
  items: z.array(saleItemSchema).min(1),
  payments: z.array(salePaymentSchema).min(1),
  discountAmount: z.number().nonnegative().optional(),
  freightAmount: z.number().nonnegative().optional(),
  notes: z.string().max(500).optional(),
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

/**
 * Payload para cancelar uma venda (ADR-004). O motivo é obrigatório porque o
 * cancelamento é um evento crítico auditado (`AuditEvent CANCEL_ORDER`).
 */
export const cancelOrderSchema = z.object({
  reason: z.string().min(3, 'Informe o motivo do cancelamento.').max(300),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
