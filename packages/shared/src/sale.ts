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

/**
 * Modo de venda do item (ADR-013 — EF-3): `BASE` = unidade-base (ex.: metro);
 * `ALT` = embalagem fechada (ex.: rolo), com preço próprio e baixa de estoque
 * convertida (`quantity × conversionFactor`). Ausente ⇒ `BASE` (venda de sempre).
 * O servidor é quem resolve o fator/baixa a partir do produto (fonte de verdade).
 */
export const saleUnitModeSchema = z.enum(['BASE', 'ALT']);
export type SaleUnitMode = z.infer<typeof saleUnitModeSchema>;

export const saleItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().optional(),
  /// Modo de venda (EF-3). Default BASE mantém as vendas de unidade única inalteradas.
  saleMode: saleUnitModeSchema.default('BASE'),
});
export type SaleItemInput = z.infer<typeof saleItemSchema>;

export const salePaymentSchema = z.object({
  method: paymentMethodSchema,
  amount: z.number().positive(),
});

/**
 * Payload para registrar uma venda. `tenantId`/`userId` vêm sempre do contexto (JWT).
 *
 * `id` e `cashSessionId` são **opcionais** e existem para a venda **offline** (ADR-011):
 *  - **Online (padrão):** ambos ausentes — o servidor gera o `id` (PK) e deriva o caixa do
 *    caixa aberto do operador; estoque insuficiente é **bloqueado** (regra de sempre).
 *  - **Offline (sync):** o cliente envia o `id` UUID gerado por ele (chave de idempotência,
 *    ADR-011 §2) e o `cashSessionId` da venda (o caixa que estava aberto no momento). Nesse
 *    caminho o servidor **deduplica pela PK** e **registra mesmo com estoque negativo** (§6:
 *    a venda física já aconteceu; o negativo vai para a reconciliação da ADR-001).
 *
 * Ou seja, **`id` presente ⇔ venda de origem offline** — é o sinal que o servidor usa para
 * escolher o comportamento (dedup + permitir negativo) sem um campo extra.
 */
export const createSaleSchema = z.object({
  id: z.string().uuid().optional(),
  cashSessionId: z.string().uuid().optional(),
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

/**
 * Payload para devolver uma venda de caixa já fechado (ADR-006). Diferente do
 * cancelamento (que estorna dentro do caixa aberto), a devolução repõe o estoque
 * e lança a SAÍDA de dinheiro no caixa de HOJE, sem tocar no caixa original.
 * O motivo é obrigatório porque é um evento crítico auditado (`RETURN_ORDER`).
 */
export const returnOrderSchema = z.object({
  reason: z.string().min(3, 'Informe o motivo da devolução.').max(300),
});
export type ReturnOrderInput = z.infer<typeof returnOrderSchema>;
