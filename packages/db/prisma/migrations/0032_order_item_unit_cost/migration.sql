-- =====================================================================
-- 0032 — Custo congelado na venda (ADR-027, Relatórios v2 Fatia 2)
-- Snapshot do custo unitário na linha da venda, para destravar margem/lucro
-- histórica reproduzível (não distorce ao reajustar o custo do cadastro).
--
-- ADITIVA e NULLABLE: só acrescenta coluna; não altera nem migra dado existente.
-- `ADD COLUMN` nullable sem default = instantâneo no Postgres (sem rewrite/lock
-- de tabela). SEM backfill: o custo das vendas antigas não é recuperável, então
-- fica NULL = "custo desconhecido" (fora do lucro; nunca custo zero).
--
-- Unidade: por UNIDADE-BASE (mesma base de Product.costPrice, do estoque e de
-- baseQuantity). O custo da linha é unitCost × (baseQuantity ?? quantity).
-- =====================================================================

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "unitCost" DECIMAL(12,4);
