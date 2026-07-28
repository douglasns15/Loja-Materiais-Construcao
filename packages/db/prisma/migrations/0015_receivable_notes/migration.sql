-- =====================================================================
-- 0015 — Observação por dívida (venda a prazo — ADR-019)
-- Adiciona uma observação livre a cada conta a receber (ex.: "prometeu pagar
-- dia 10", "ligar para cobrar"). Aditiva, nullable — não toca em nenhuma linha
-- existente. RLS intacta (a policy de SELECT da 0014 já cobre a coluna nova).
-- =====================================================================

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN "notes" VARCHAR(500);
