-- =====================================================================
-- 0031 — Vencimento na DÍVIDA (ADR-026, Opção A)
-- Um vencimento por dívida, atualizado a cada venda a prazo que informa uma
-- data (a última digitada vence). Aditiva. Backfill: para cada dívida, adota o
-- vencimento da venda MAIS RECENTE que tinha data (reflete "a última digitada").
-- Dívidas sem nenhuma venda com data ficam sem vencimento (NULL).
-- =====================================================================

-- AlterTable
ALTER TABLE "debts" ADD COLUMN     "dueDate" TIMESTAMP(3);

-- Backfill: vencimento da dívida = o da venda a prazo mais recente (por createdAt) que tinha data.
UPDATE debts d
SET "dueDate" = sub."dueDate"
FROM (
  SELECT DISTINCT ON (r."debtId") r."debtId", r."dueDate"
  FROM receivables r
  WHERE r."debtId" IS NOT NULL AND r."dueDate" IS NOT NULL
  ORDER BY r."debtId", r."createdAt" DESC, r.id DESC
) sub
WHERE sub."debtId" = d.id;
