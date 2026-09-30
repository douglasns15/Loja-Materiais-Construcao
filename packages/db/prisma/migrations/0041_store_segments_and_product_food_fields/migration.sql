-- =====================================================================
-- 0041 — Ramo da loja + campos de produto para loja de alimentos
--        (ADR-039 + ADR-040 + ADR-041 §B, aprovadas pelo Owner em 2026-09-30)
--
-- Tenant:
--   * `segments StoreSegment[]` — ramos da loja (multisseleção; preset de módulos).
-- Product:
--   * `trackStock`    (default true)  — produto sem controle de estoque (ADR-040 §2).
--   * `scaleCode`     VARCHAR(6)      — PLU da balança etiquetadora, único por loja (ADR-040 §3).
--   * `ncm`           VARCHAR(8)      — NCM fiscal, visível a qualquer loja (ADR-040, decisão do Owner).
--   * `pendingReview` (default false) — cadastrado no caixa aguardando conferência (ADR-041 §B).
--
-- Aditiva e reversível: 1 enum + 5 colunas (todas com default ou nullable) + 1 índice único.
-- Nenhum dado existente muda de significado: todo produto segue controlado (`trackStock = true`),
-- sem PLU, sem NCM e sem revisão pendente.
--
-- Backfill (retrocompatibilidade — ADR-039 §4): todas as lojas atuais são de material de
-- construção ⇒ `segments = {CONSTRUCTION}` + módulo `CONSTRUCTION_UNITS` ligado. Comportamento
-- idêntico ao de antes para elas; só loja nova de outro ramo verá a tela enxuta.
--
-- Índice de `scaleCode` é único COMUM (não parcial): o Prisma 6 não expressa `WHERE`, e um
-- índice parcial em SQL cru seria revertido pelo próximo `migrate diff`. NULLs não colidem;
-- o soft-delete do produto libera o PLU na aplicação.
-- =====================================================================

-- CreateEnum
CREATE TYPE "StoreSegment" AS ENUM ('CONSTRUCTION', 'GROCERY', 'ICE_CREAM', 'ROTISSERIE', 'GENERAL_RETAIL');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "ncm" VARCHAR(8),
ADD COLUMN     "pendingReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scaleCode" VARCHAR(6),
ADD COLUMN     "trackStock" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "segments" "StoreSegment"[] DEFAULT ARRAY[]::"StoreSegment"[];

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_scaleCode_key" ON "products"("tenantId", "scaleCode");

-- Backfill 1/2: lojas existentes são de material de construção.
UPDATE "tenants" SET "segments" = ARRAY['CONSTRUCTION']::"StoreSegment"[];

-- Backfill 2/2: liga o módulo de unidades de obra em todas as lojas existentes (idempotente).
-- `id` gerado aqui porque o default uuid() do schema é do lado do Prisma, não do banco.
INSERT INTO "tenant_modules" ("id", "tenantId", "moduleKey", "isActive", "createdAt")
SELECT gen_random_uuid(), t."id", 'CONSTRUCTION_UNITS', true, CURRENT_TIMESTAMP
FROM "tenants" t
ON CONFLICT ("tenantId", "moduleKey") DO NOTHING;
