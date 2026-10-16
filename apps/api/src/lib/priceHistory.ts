import { Prisma } from '@nexoloja/db';
import { diffPriceCost, type PriceCostSnapshot } from '@nexoloja/core';
import { PRICE_HISTORY_ACTION, type PriceChangeSource } from '@nexoloja/shared';

/**
 * Histórico de custo e preço do produto (2026-10-16). Uma linha por alteração, gravada no
 * `AuditEvent` existente (auditoria seletiva — ARCHITECTURE §7, sem tabela nova): `entity =
 * 'Product'`, `entityId = productId`, `action = PRICE_COST_CHANGE`, e o "de → para" + quem + por onde
 * no `meta` (compacto). O nome do operador vai como snapshot (`byName`), como a autoria do ADR-010.
 *
 * Toda rota que muda `costPrice`/`salePrice` chama `priceHistoryEvent` DENTRO da mesma transação da
 * alteração — se a alteração falhar, a linha não fica; se a linha falhar, a alteração volta.
 */
export type PriceHistoryInput = {
  tenantId: string;
  productId: string;
  userId: string | null | undefined;
  userName: string | null | undefined;
  source: PriceChangeSource;
  /** Custo/preço ANTES (null = cadastro: o produto nasce agora). */
  before: PriceCostSnapshot | null;
  /** Custo/preço DEPOIS (campo ausente/nulo = não mexeu). */
  after: Partial<PriceCostSnapshot>;
  /** Referência da origem (ex.: "NF 12345", "PR-0003"). */
  detail?: string | null;
};

/** Monta a linha do `AuditEvent` — ou `null` se custo e preço não mudaram (não grava nada). */
export function priceHistoryEvent(input: PriceHistoryInput): Prisma.AuditEventCreateManyInput | null {
  const change = diffPriceCost(input.before, input.after);
  if (!change) return null;
  return {
    tenantId: input.tenantId,
    userId: input.userId ?? null,
    entity: 'Product',
    entityId: input.productId,
    action: PRICE_HISTORY_ACTION,
    meta: {
      source: input.source,
      byName: input.userName ?? null,
      ...change,
      ...(input.detail ? { detail: input.detail.slice(0, 80) } : {}),
    },
  };
}

/** Grava a linha do histórico (se houve mudança) na transação da alteração. */
export async function recordPriceHistory(tx: Prisma.TransactionClient, input: PriceHistoryInput): Promise<void> {
  const data = priceHistoryEvent(input);
  if (data) await tx.auditEvent.create({ data });
}
