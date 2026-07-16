-- =====================================================================
-- 0009 — Quantidade em unidade-base no item de venda (ADR-013 — EF-3)
-- Snapshot da quantidade debitada do estoque em UNIDADE-BASE, congelado no
-- momento da venda. Na venda em embalagem (rolo), `quantity` fica na unidade
-- vendida (ex.: 2 rolos) e `base_quantity` guarda o equivalente em base
-- (ex.: 200 m). O cancelamento/devolução estorna `base_quantity ?? quantity`
-- — robusto mesmo se o `conversionFactor` do produto mudar depois da venda.
--
-- Coluna OPCIONAL: pedidos antigos (pré-EF-3) ficam NULL e o estorno cai no
-- `quantity` (exato para eles, pois vendiam sempre na unidade-base, fator 1).
-- Aditiva, backward-compatible, sem alteração de RLS (políticas da 0002 cobrem
-- colunas novas, mesmo padrão da 0007/0008).
-- =====================================================================

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "baseQuantity" DECIMAL(12,4);
