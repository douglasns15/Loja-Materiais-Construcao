-- =====================================================================
-- 0023 — Nome livre de quem é o orçamento (ADR-024, Sub-fatia 2.B)
-- Campo de identificação de BALCÃO: o nome da pessoa a quem o orçamento pertence, SEM criar cadastro
-- de cliente (a pessoa pode nunca mais voltar). Complementa o customerId opcional já existente — o
-- cadastro, quando vinculado, é o nome canônico; este campo livre serve quando não há cadastro.
--
-- 100% ADITIVA: 1 coluna nullable em quotes (sem DEFAULT, sem backfill — nenhuma linha existente muda).
-- SEM mudança de RLS (as políticas de linha da 0022 já cobrem a coluna nova). Sem efeito de
-- estoque/caixa/venda. Reversível (DROP COLUMN).
-- =====================================================================

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "customerName" VARCHAR(120);
