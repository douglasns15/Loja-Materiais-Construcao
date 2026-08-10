import { z } from 'zod';
import { saleUnitModeSchema } from './sale';
import { unitTypeSchema, type UnitType } from './product';

/**
 * Orçamentos salvos (ADR-024). O orçamento é uma PROPOSTA guardada, com código humano `O-000045`
 * (sequencial por loja — mesmo motor do ADR-023). Sem efeito de estoque. Estes schemas/tipos são o
 * contrato entre `apps/web` e `apps/api`.
 */

/** Status PERSISTIDO do orçamento (espelha o enum `QuoteStatus` do Prisma). */
export const quoteStatusSchema = z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CONVERTED']);
export type QuoteStatus = z.infer<typeof quoteStatusSchema>;

/** Status EFETIVO exibido: os persistidos + `EXPIRED`, que é DERIVADO de `validUntil` (não é gravado
 *  — evita depender de agendador). Um orçamento aberto (DRAFT/SENT/ACCEPTED) vencido aparece assim. */
export type QuoteEffectiveStatus = QuoteStatus | 'EXPIRED';

/** Rótulos PT-BR para a UI (inclui o derivado EXPIRED). */
export const QUOTE_STATUS_LABELS: Record<QuoteEffectiveStatus, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviado',
  ACCEPTED: 'Aceito',
  REJECTED: 'Recusado',
  EXPIRED: 'Expirado',
  CONVERTED: 'Convertido',
};

/** Uma linha do orçamento como o cliente ENVIA ao salvar (snapshot do que o PDV mostra). `productId`
 *  e `saleMode`/`pairGroup` permitem reconstruir a linha no PDV ao editar/converter (2.B). O servidor
 *  revalida os totais (subtotal/total) a partir daqui; preço/estoque só são revalidados na VENDA. */
export const quoteItemInputSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  productName: z.string().min(1).max(150),
  unit: unitTypeSchema,
  saleMode: saleUnitModeSchema.optional(), // BASE | ALT (EF-3/ADR-013)
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().optional(),
  total: z.number().nonnegative(),
  pairGroup: z.number().int().positive().max(999).optional(),
});
export type QuoteItemInput = z.infer<typeof quoteItemInputSchema>;

/** Payload para SALVAR um orçamento (`POST /quotes`). Nasce como DRAFT; o número `O-…` é do servidor.
 *  `validUntil` é `YYYY-MM-DD` (validade — opcional). Cliente opcional (balcão sem cadastro). */
export const createQuoteSchema = z.object({
  customerId: z.string().uuid().optional(),
  /** Nome LIVRE de quem é o orçamento (ADR-024, 2.B) — identificação de balcão sem criar cadastro.
   *  Opcional; string vazia é normalizada para `null` no servidor. */
  customerName: z.string().max(120).optional(),
  items: z.array(quoteItemInputSchema).min(1),
  discountAmount: z.number().nonnegative().optional(),
  validUntil: z.string().optional(),
  notes: z.string().max(500).optional(),
});
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

/** Payload para ATUALIZAR um orçamento (`PATCH /quotes/:id`) — status/validade/observação. `CONVERTED`
 *  NÃO é setável manualmente (só a venda o define). Ao menos um campo deve vir. */
export const updateQuoteSchema = z
  .object({
    status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED']).optional(),
    validUntil: z.string().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    // Nome livre editável (ADR-024, 2.B) — é rótulo de identificação, não "conteúdo" travado da proposta.
    customerName: z.string().max(120).nullable().optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.validUntil !== undefined ||
      v.notes !== undefined ||
      v.customerName !== undefined,
    { message: 'Nada para atualizar.' },
  );
export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;

/** Payload para REVISAR o conteúdo de um orçamento em RASCUNHO (ADR-024, 2.B) — reabre no PDV, mexe
 *  nos itens e salva por cima do MESMO `O-…`. Distingue-se do `updateQuoteSchema` (ciclo de vida) por
 *  trazer `items`; só é aceito enquanto `DRAFT` (a partir de `SENT` o conteúdo trava — o cliente já viu
 *  a proposta). Vai pela MESMA rota `PATCH /quotes/:id` (o CORS não libera PUT), discriminado por `items`. */
export const reviseQuoteSchema = z.object({
  customerId: z.string().uuid().nullable().optional(),
  customerName: z.string().max(120).nullable().optional(),
  items: z.array(quoteItemInputSchema).min(1),
  discountAmount: z.number().nonnegative().optional(),
  validUntil: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type ReviseQuoteInput = z.infer<typeof reviseQuoteSchema>;

/** Uma linha do orçamento como o servidor DEVOLVE (snapshot gravado). */
export type QuoteItem = {
  id: string;
  productId: string | null;
  productName: string;
  unit: UnitType;
  saleMode: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  total: string;
  pairGroup: number | null;
};

/** Uma linha da lista de orçamentos (`GET /quotes`). `effectiveStatus` já resolve o "Expirado". */
export type QuoteRow = {
  id: string;
  quoteNumber: number;
  customerId: string | null;
  /** Nome de EXIBIÇÃO: o do cadastro quando vinculado (`customerId`), senão o nome livre de balcão
   *  (ADR-024, 2.B). Como `customerId` diz se há cadastro, o front usa este campo p/ prefill do input
   *  livre só quando `customerId` é `null`. */
  customerName: string | null;
  status: QuoteStatus;
  effectiveStatus: QuoteEffectiveStatus;
  total: string;
  validUntil: string | null;
  createdAt: string;
  createdByName: string | null;
  convertedOrderId: string | null;
  /** Código da venda gerada na conversão (ADR-023) — exibido como `V-000128` quando convertido. */
  convertedOrderNumber: number | null;
};

/** Página de orçamentos (cursor keyset) — mesmo contrato das demais telas paginadas. */
export type QuotesPage = { rows: QuoteRow[]; nextCursor: string | null };

/** Detalhe de um orçamento (`GET /quotes/:id`) — cabeçalho + itens. */
export type QuoteDetail = QuoteRow & {
  subtotal: string;
  discountAmount: string;
  notes: string | null;
  items: QuoteItem[];
};

/** Resultado de salvar um orçamento (`POST /quotes`). */
export type CreateQuoteResult = { id: string; quoteNumber: number };
