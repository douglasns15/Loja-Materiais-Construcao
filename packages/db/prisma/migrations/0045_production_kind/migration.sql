-- =====================================================================
-- 0045 — Tipo do evento de produção (ADR-043 Fatia 3, aprovada pelo Owner 2026-10-08)
--   * productions.kind: RECIPE (pela ficha técnica) | BREAKDOWN (desmembramento: 1 peça → N cortes).
-- Aditiva: as produções existentes ficam RECIPE pelo default; sem backfill.
-- Reversível: DROP COLUMN "kind" + DROP TYPE "ProductionKind".
-- =====================================================================
-- CreateEnum
CREATE TYPE "ProductionKind" AS ENUM ('RECIPE', 'BREAKDOWN');

-- AlterTable
ALTER TABLE "productions" ADD COLUMN     "kind" "ProductionKind" NOT NULL DEFAULT 'RECIPE';
