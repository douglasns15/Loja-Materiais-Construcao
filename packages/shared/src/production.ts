import { z } from 'zod';

/**
 * Produção com ficha técnica (ADR-043) — contratos compartilhados entre apps/web e apps/api.
 * Quantidades sempre em UNIDADE-BASE (a mesma do estoque): kg, L, un…
 */

/** Quantidade positiva com a precisão do estoque (4 casas). */
const qty = z
  .number()
  .positive('Informe uma quantidade maior que zero.')
  .max(10_000_000)
  .transform((n) => Number(n.toFixed(4)));

/**
 * Ficha técnica (`PUT /productions/recipes/:productId`): "para produzir `yieldQty` do pronto, uso
 * estes insumos". 1 a 30 insumos, sem repetir. (Que o pronto não seja insumo de si mesmo é checado
 * na API, que conhece o id do pronto.)
 */
export const recipeSchema = z
  .object({
    yieldQty: qty,
    notes: z.string().trim().max(300).nullable().optional(),
    items: z
      .array(z.object({ productId: z.string().uuid(), quantity: qty }))
      .min(1, 'Adicione ao menos um insumo.')
      .max(30),
  })
  .refine((r) => new Set(r.items.map((i) => i.productId)).size === r.items.length, {
    message: 'O mesmo insumo aparece duas vezes na ficha.',
  });
export type RecipeInput = z.infer<typeof recipeSchema>;

/**
 * Registrar uma produção (`POST /productions`): quanto do pronto foi produzido e quanto de cada
 * insumo foi usado DE FATO (a tela preenche pela ficha; o operador pode corrigir — ADR-043 §2).
 * Insumo com 0 é aceito (não usou) e não gera movimento.
 */
export const createProductionSchema = z
  .object({
    productId: z.string().uuid(),
    quantity: qty,
    inputs: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z
            .number()
            .min(0)
            .max(10_000_000)
            .transform((n) => Number(n.toFixed(4))),
        }),
      )
      .min(1)
      .max(30),
    notes: z.string().trim().max(300).optional(),
  })
  .refine((p) => p.inputs.some((i) => i.quantity > 0), { message: 'Informe o que foi usado na produção.' });
export type CreateProductionInput = z.infer<typeof createProductionSchema>;

/** Insumo da ficha como a tela o mostra (com o que precisa para decidir: saldo e custo). */
export type RecipeItemRow = {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  /** Custo por unidade-base do insumo (custo do cadastro ÷ tamanho, se unidade fechada). */
  unitCost: number;
  trackStock: boolean;
  /** Disponível (`stockQty − reservedQty`, unidade-base); `null` se o insumo não controla estoque. */
  available: number | null;
};

/** Ficha de um produto pronto (`GET /productions/recipes/:productId` e lista de produzíveis). */
export type RecipeRow = {
  productId: string;
  productName: string;
  unit: string;
  /** "Vendido inteiro também" (ADR-040 §4): peso médio da peça ⇒ a produção aceita "N peças". */
  pieceWeight: number | null;
  trackStock: boolean;
  salePrice: number;
  stockQty: number;
  yieldQty: number;
  notes: string | null;
  items: RecipeItemRow[];
  updatedByName: string | null;
  updatedAt: string;
};

/** Tipo do evento: pela ficha técnica ou desmembramento da peça em cortes (Fatia 3). */
export type ProductionKind = 'RECIPE' | 'BREAKDOWN';

/** Uma produção registrada (`GET /productions`). */
export type ProductionRow = {
  id: string;
  productionNumber: number;
  kind: ProductionKind;
  createdAt: string;
  registeredByName: string | null;
  totalCost: number;
  notes: string | null;
  outputs: { productId: string; name: string; unit: string; quantity: number; unitCost: number | null }[];
  inputs: { productId: string; name: string; unit: string; quantity: number; unitCost: number | null }[];
};

// -----------------------------------------------------------------------------
// Fatia 2 — sobra/perda + resumo do dia (ADR-043 §3)
// -----------------------------------------------------------------------------

/** Motivos da perda do pronto (o que não vendeu ou se perdeu na cozinha). */
export const PRODUCTION_LOSS_REASONS = ['LEFTOVER', 'BURNED', 'DROPPED', 'OTHER'] as const;
export type ProductionLossReason = (typeof PRODUCTION_LOSS_REASONS)[number];
export const productionLossReasonLabels: Record<ProductionLossReason, string> = {
  LEFTOVER: 'Sobra do dia',
  BURNED: 'Queimou',
  DROPPED: 'Caiu',
  OTHER: 'Outro',
};

/**
 * Prefixo do motivo do `StockMovement` de perda (sem tabela nova — ADR-043 §3). O resumo do dia
 * soma as saídas cujo motivo começa por ele.
 */
export const PRODUCTION_LOSS_PREFIX = 'Perda — ';

/**
 * Registrar perda do pronto (`POST /productions/loss`): quanto (unidade-base) e por quê. "Outro"
 * exige a descrição.
 */
export const productionLossSchema = z
  .object({
    productId: z.string().uuid(),
    quantity: qty,
    reason: z.enum(PRODUCTION_LOSS_REASONS),
    note: z.string().trim().max(100).optional(),
  })
  .refine((l) => l.reason !== 'OTHER' || !!l.note, { message: 'Descreva o motivo da perda.', path: ['note'] });
export type ProductionLossInput = z.infer<typeof productionLossSchema>;

/** Motivo gravado no movimento: "Perda — Sobra do dia" / "Perda — Queimou: 2 do fundo da máquina". */
export function productionLossReasonText(reason: ProductionLossReason, note?: string | null): string {
  const label = reason === 'OTHER' && note ? note : productionLossReasonLabels[reason];
  const extra = reason !== 'OTHER' && note ? `: ${note}` : '';
  return `${PRODUCTION_LOSS_PREFIX}${label}${extra}`.slice(0, 150);
}

/** Uma perda registrada (lista do dia). */
export type ProductionLossRow = {
  id: string;
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  /** Motivo sem o prefixo ("Sobra do dia", "Queimou: …"). */
  reason: string;
  unitCost: number | null;
  createdAt: string;
  registeredByName: string | null;
};

/** Linha do resumo do dia por produto pronto: produzido × vendido × perda × em estoque (unidade-base). */
export type ProductionSummaryRow = {
  productId: string;
  name: string;
  unit: string;
  pieceWeight: number | null;
  produced: number;
  sold: number;
  lost: number;
  stockQty: number;
};

/** `GET /productions/summary?day=`. */
export type ProductionDaySummary = {
  day: string;
  products: ProductionSummaryRow[];
  losses: ProductionLossRow[];
};

// -----------------------------------------------------------------------------
// Fatia 3 — desmembramento: 1 peça → N cortes (ADR-043)
// -----------------------------------------------------------------------------

/**
 * Desmembrar uma peça (`POST /productions/breakdown`): quanto da peça foi usado (unidade-base) e
 * quanto saiu de cada corte. A tela pré-monta os cortes do último desmembramento da peça, mas o
 * operador remove/adiciona à vontade — só vão os cortes pesados (> 0). 1 a 30 cortes, sem repetir;
 * que a peça não seja corte de si mesma é checado na API.
 */
export const createBreakdownSchema = z
  .object({
    productId: z.string().uuid(),
    quantity: qty,
    cuts: z
      .array(z.object({ productId: z.string().uuid(), quantity: qty }))
      .min(1, 'Informe o peso de ao menos um corte.')
      .max(30),
    notes: z.string().trim().max(300).optional(),
  })
  .refine((b) => new Set(b.cuts.map((c) => c.productId)).size === b.cuts.length, {
    message: 'O mesmo corte aparece duas vezes.',
  });
export type CreateBreakdownInput = z.infer<typeof createBreakdownSchema>;

/** Cortes do último desmembramento de uma peça (`GET /productions/breakdown/last/:productId`). */
export type BreakdownLastCuts = { productId: string; name: string; unit: string }[];
