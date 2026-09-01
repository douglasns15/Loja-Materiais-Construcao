-- =====================================================================
-- 0036 — Fator de embalagem lembrado por produto (importação de NF-e, ADR-025)
-- Guarda no produto quantas unidades de venda vêm numa unidade comercial do
-- fornecedor (ex.: 1 PC = 50 UN). Preenchido na importação quando o operador
-- informa o fator; nas próximas notas daquele produto o De-Para pré-sugere esse
-- valor (custo do pacote ÷ fator), eliminando o retrabalho manual.
--
-- Aditiva e reversível: uma coluna INTEGER nullable, sem reescrever nada. NULL =
-- sem embalagem lembrada (fator 1). Dropar a coluna devolve o estado anterior.
-- =====================================================================

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "nfePackFactor" INTEGER;
