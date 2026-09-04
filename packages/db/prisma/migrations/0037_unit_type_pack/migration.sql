-- =====================================================================
-- 0037 — Unidade "Pacote" no enum UnitType (ADR-030, generaliza o ADR-017)
-- Adiciona o rótulo PACK ao enum de unidade de venda. Aditiva: não toca
-- tabelas, dados nem RLS. O "pacote" é uma unidade FECHADA apresentada como
-- principal no cadastro (tamanho em UNIDADES + preço do pacote), igual à
-- barra/rolo do ADR-017, mas a régua fina é a unidade avulsa (passo 1, não
-- 0,5 m). O estoque segue no ledger em unidade fina (unidades avulsas).
-- Mesmo padrão do ADD VALUE da 0013 (UnitType.BARRA).
-- =====================================================================

-- AlterEnum
ALTER TYPE "UnitType" ADD VALUE 'PACK';
