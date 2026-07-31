-- =====================================================================
-- 0018 — Observação da dívida por cliente (conta do cliente — ADR-022)
-- Adiciona uma observação livre da DÍVIDA/conta ao cliente, separada da
-- observação do CADASTRO (`customers.notes`). Uma nota por cliente,
-- compartilhada por todas as vendas a prazo dele, editada nas telas de
-- Contas a Receber. Aditiva, nullable — não toca em nenhuma linha existente.
-- RLS intacta (as policies por linha da 0002 já cobrem a coluna nova).
-- =====================================================================

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "debtNotes" VARCHAR(500);
