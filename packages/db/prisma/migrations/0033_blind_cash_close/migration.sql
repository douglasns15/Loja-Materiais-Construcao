-- =====================================================================
-- 0033 — Fechamento cego do caixa (blind close)
-- Flag por loja: quando ligada, a tela do Caixa esconde o Esperado e a quebra
-- de valores no fechamento; o operador conta a gaveta às cegas e só então
-- "revela" a divergência. Prática anti-viés (evita ajustar a contagem para
-- bater com o esperado).
--
-- ADITIVA e com DEFAULT: `ADD COLUMN ... DEFAULT false` é instantâneo no
-- Postgres (sem rewrite/lock de tabela). Sem backfill: `false` = fechamento
-- normal, preservando o comportamento atual de todas as lojas.
-- =====================================================================

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "blindCashClose" BOOLEAN NOT NULL DEFAULT false;
