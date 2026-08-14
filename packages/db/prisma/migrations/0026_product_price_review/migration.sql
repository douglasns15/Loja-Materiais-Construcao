-- =====================================================================
-- 0026 — Aviso de revisão de preço (item 5 da esteira de precificação)
-- Quando uma Entrada de estoque sobrescreve o custo do cadastro ("último custo", ADR de 2026-08-11),
-- a margem muda em todo o sistema, mas o Preço de Venda NÃO. Esta coluna guarda o INSTANTE desse
-- ajuste para o cadastro do produto exibir um aviso discreto ("custo ajustado, confira o preço") até
-- o operador reconhecer (o PATCH do produto com `dismissPriceReview` limpa a marca). É só SINALIZAÇÃO:
-- nunca altera preço automaticamente.
--
-- 100% ADITIVA: 1 coluna nullable em products (sem DEFAULT, sem backfill — nenhuma linha existente
-- muda). NULL = nada pendente (inclusive todas as linhas atuais). SEM mudança de RLS (as políticas de
-- linha de products já cobrem a coluna nova, mesmo perfil das migrations 0010–0012). Reversível
-- (DROP COLUMN).
-- =====================================================================

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "priceReviewPendingAt" TIMESTAMP(3);
