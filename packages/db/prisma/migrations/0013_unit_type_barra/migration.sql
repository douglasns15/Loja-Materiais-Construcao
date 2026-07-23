-- =====================================================================
-- 0013 — Unidade "Barra" no enum UnitType (ADR-017)
-- Adiciona o rótulo BARRA ao enum de unidade de venda. Aditiva: não toca
-- tabelas, dados nem RLS. A "barra" é a unidade FECHADA apresentada como
-- principal no cadastro (tamanho em metros + preço da barra); o estoque
-- segue no ledger em unidade fina (metro), cortável em múltiplos de 0,5 m.
-- Mesmo padrão do ADD VALUE da 0003 (OrderStatus.RETURNED).
-- =====================================================================

-- AlterEnum
ALTER TYPE "UnitType" ADD VALUE 'BARRA';
