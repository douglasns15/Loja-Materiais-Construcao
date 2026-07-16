-- =====================================================================
-- 0008 — Venda em unidade alternativa (ADR-013 — EF-3)
-- Segundo preço para vender o mesmo produto na embalagem fechada (ex.: fio
-- por metro OU rolo fechado de 100 m, com preços diferentes — o fechado sai
-- mais barato por metro, então NÃO é `salePrice × conversionFactor`).
--
-- Duas colunas OPCIONAIS em `products` (Opção A do ADR-013):
--   • alt_unit       — unidade da embalagem fechada (ex.: 'ROLL')
--   • alt_sale_price — preço próprio de 1 embalagem fechada
-- O TAMANHO da embalagem (metros por rolo) reusa `conversionFactor`, que já
-- existe. Produtos atuais ficam com os campos NULL = comportamento inalterado.
--
-- Aditiva e backward-compatible. Sem alteração de RLS: as políticas de linha
-- da 0002 já cobrem colunas novas (mesmo padrão da 0007/popularName).
-- =====================================================================

-- AlterTable
ALTER TABLE "products" ADD COLUMN "altUnit" "UnitType";
ALTER TABLE "products" ADD COLUMN "altSalePrice" DECIMAL(12,4);
