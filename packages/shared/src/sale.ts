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

/** Modo de saída da mercadoria (ADR-020). `IMMEDIATE` = baixa no ato (venda de sempre);
 * `SCHEDULED` = retirada/entrega posterior (reserva agora, baixa parcial na retirada). */
export const deliveryModeSchema = z.enum(['IMMEDIATE', 'SCHEDULED']);
export type DeliveryModeCode = z.infer<typeof deliveryModeSchema>;

/** Situação de retirada de um pedido SCHEDULED (ADR-020) — rótulos para a UI. */
export const FULFILLMENT_STATUS_LABELS = {
  PENDING: 'A retirar',
  PARTIAL: 'Retirada parcial',
  COMPLETED: 'Finalizada',
} as const;
export type FulfillmentStatusCode = keyof typeof FULFILLMENT_STATUS_LABELS;

export const saleItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().optional(),
  /// Modo de venda (EF-3). Default BASE mantém as vendas de unidade única inalteradas.
  saleMode: saleUnitModeSchema.default('BASE'),
  /**
   * Agrupamento do par (ADR-015). Dois itens do mesmo pedido com o MESMO `pairGroup` foram
   * vendidos juntos como par (parafuso + bucha) e imprimem como uma linha só no comprovante.
   * Numerado pelo cliente por pedido (1, 2, 3…). Ausente ⇒ item avulso, o caso de sempre.
   * Os **preços já vêm rateados** do cliente (`splitPairPrice` do core), como qualquer
   * `unitPrice`; o servidor não recalcula preço — só valida e grava.
   */
  pairGroup: z.number().int().positive().max(999).optional(),
  /**
   * Retirada/entrega futura (ADR-020): previsão de retirada POR ITEM (`YYYY-MM-DD`). Só é usada
   * quando `perItemSchedule = true` no pedido; caso contrário vale a previsão única do pedido.
   * Opcional (previsão é sempre opcional).
   */
  scheduledPickupAt: z.string().optional(),
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
  // Pode ser VAZIO numa venda 100% a prazo (fiado — ADR-019): nada é pago na hora. A
  // cobertura da venda (pagamento agora OU valor a prazo) é validada no servidor, que também
  // exige cliente quando há `creditAmount`. O schema offline (outbox) re-exige `.min(1)`, pois
  // fiado é online-only nesta fatia.
  payments: z.array(salePaymentSchema),
  discountAmount: z.number().nonnegative().optional(),
  freightAmount: z.number().nonnegative().optional(),
  notes: z.string().max(500).optional(),
  /**
   * Venda a prazo (fiado — ADR-019): valor deixado **a prazo** (o que o cliente pagará depois).
   * `creditAmount > 0` exige `customerId` e gera uma conta a receber; ausente/0 = venda à vista
   * comum. `Σ pagamentos agora + creditAmount` deve fechar o total (validado no servidor).
   */
  creditAmount: z.number().nonnegative().optional(),
  /** Vencimento opcional do fiado (data `YYYY-MM-DD`). Só usado quando há `creditAmount`. */
  dueDate: z.string().optional(),
  /**
   * Retirada/entrega futura (ADR-020): `SCHEDULED` reserva a mercadoria (não baixa o estoque na
   * venda) — a baixa real ocorre, parcial, na retirada. Ausente/`IMMEDIATE` = venda de balcão de
   * sempre (baixa no ato). Online-only nesta fatia (como o fiado). Ortogonal ao `creditAmount`:
   * um pedido pode ser SCHEDULED **e** a prazo (leva depois e/ou paga depois).
   */
  deliveryMode: deliveryModeSchema.default('IMMEDIATE'),
  /** Previsão ÚNICA de retirada do pedido (`YYYY-MM-DD`), quando `perItemSchedule` é falso. Opcional. */
  scheduledPickupAt: z.string().optional(),
  /** Flag "Data por item" (ADR-020): quando `true`, a previsão vem de cada item (`saleItem.scheduledPickupAt`). */
  perItemSchedule: z.boolean().optional(),
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

/**
 * Payload de uma RETIRADA parcial (ADR-020): as linhas que saem agora e quanto de cada uma, em
 * UNIDADE-BASE (a mesma de `OrderItem.baseQuantity`/estoque). Cada quantidade é validada no
 * servidor contra o que ainda falta entregar daquela linha (`isValidDelivery`). `notes` opcional
 * registra a retirada no log (ex.: "levou no caminhão da obra"). Ao menos uma linha.
 */
export const deliverOrderSchema = z.object({
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
  notes: z.string().max(300).optional(),
});
export type DeliverOrderInput = z.infer<typeof deliverOrderSchema>;

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
