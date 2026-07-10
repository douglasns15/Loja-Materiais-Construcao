import { z } from 'zod';
import { createSaleSchema, type CreateSaleInput } from './sale';

/**
 * Envelope de mutação da fila offline (Outbox) — ADR-011 §1 e AI 5.
 *
 * Cada escrita feita sem rede vira um **envelope** (a *intenção*: "registrar esta venda")
 * guardado na store `outbox` do IndexedDB e, quando a conexão volta, enviado à API pelo worker
 * de sync (fatia seguinte). Este arquivo define **só o formato** — o contrato compartilhado
 * entre o cliente (que enfileira) e o servidor (que, na Fatia 4, aplica de forma idempotente).
 *
 * Idempotência (ADR-011 §2): a chave é o **`entityId` = PK UUID gerada no cliente**. O servidor
 * deduplica pela própria PK (se a linha já existe, o reenvio é no-op). Por isso o `payload`
 * carrega o mesmo `id`.
 */

/**
 * Versão do formato do envelope. Sobe **apenas** em mudança incompatível de shape — assim o
 * servidor pode recusar/migrar envelopes de uma versão que não conhece, e o cliente sabe se um
 * envelope antigo preso na fila ainda é aplicável após um deploy.
 */
export const OUTBOX_SCHEMA_VERSION = 1 as const;

/**
 * Tipos de mutação que podem ser enfileirados offline. A 1ª (e, por ora, única) fatia é a
 * **venda** (append-only, sem conflito — ADR-011 §4). Estoque, caixa e cadastros entram depois,
 * cada um adicionando um `kind` aqui + o schema do seu payload.
 */
export const MUTATION_KINDS = ['sale.create'] as const;
export type MutationKind = (typeof MUTATION_KINDS)[number];

/**
 * Payload da criação de venda offline: a venda de sempre (`createSaleSchema`) com `id` e
 * `cashSessionId` **obrigatórios** (no online eles são opcionais). O `id` é a PK UUID gerada no
 * cliente (chave de idempotência — o servidor deduplica por `orders.id`, ADR-011 §2); o
 * `cashSessionId` é o caixa que estava aberto quando a venda foi feita offline. `tenantId`/`userId`
 * continuam vindo do JWT no servidor (ADR-011 §7) — nunca do envelope.
 */
export const saleMutationPayloadSchema = createSaleSchema.extend({
  id: z.string().uuid(),
  cashSessionId: z.string().uuid(),
});
export type SaleMutationPayload = z.infer<typeof saleMutationPayloadSchema>;

/**
 * Envelope de mutação. `entityId` é a PK da linha-raiz criada (para venda, o `orders.id`) e serve
 * de chave de idempotência e de identidade da mutação na fila (dedup de enfileiramento).
 *
 * Por ora há um único `kind`, então `payload` é o da venda. Ao surgir o 2º tipo, trocar por um
 * `z.discriminatedUnion('kind', [...])` para casar `kind` ↔ `payload`.
 */
export const mutationEnvelopeSchema = z.object({
  kind: z.enum(MUTATION_KINDS),
  schemaVersion: z.literal(OUTBOX_SCHEMA_VERSION),
  entityId: z.string().uuid(),
  /** ISO 8601 — quando a mutação foi criada no dispositivo (ordem FIFO auxiliar/depuração). */
  createdAt: z.string().datetime(),
  payload: saleMutationPayloadSchema,
});
export type MutationEnvelope = z.infer<typeof mutationEnvelopeSchema>;

/**
 * Constrói o envelope de uma venda offline. Função **pura** — sem I/O, sem tocar no IndexedDB
 * (a persistência é do wrapper `apps/web/lib/outbox.ts`). `id` é o UUID gerado no cliente
 * (`crypto.randomUUID()`) e vira tanto o `entityId` do envelope quanto o `id` do payload
 * (idempotência por PK, ADR-011 §2). `cashSessionId` é o caixa aberto no momento da venda.
 */
export function buildSaleMutation(
  id: string,
  cashSessionId: string,
  sale: CreateSaleInput,
  now: Date = new Date(),
): MutationEnvelope {
  return {
    kind: 'sale.create',
    schemaVersion: OUTBOX_SCHEMA_VERSION,
    entityId: id,
    createdAt: now.toISOString(),
    payload: { ...sale, id, cashSessionId },
  };
}
