-- =====================================================================
-- 0011 — Produto agregado: venda em par (ADR-015)
-- O caso: parafuso nº10 (R$0,60) e bucha nº10 (R$0,20) são produtos
-- independentes, mas o PAR sai por R$0,70. Três colunas opcionais:
--
--   • products.pairedProductId — o produto agregado (auto-relação). Grava-se
--     só de UM lado; o outro é resolvido por consulta reversa pelo índice
--     abaixo, então é impossível os dois lados divergirem de preço.
--   • products.pairPrice       — preço TOTAL do par (não por item).
--   • order_items.pairGroup    — agrupa os itens vendidos como par no mesmo
--     pedido, para o comprovante imprimir UMA linha ("Parafuso + Bucha nº10").
--
-- A venda do par grava DOIS order_items com o preço rateado (proporcional ao
-- preço avulso). É o que mantém estoque, cancelamento e devolução funcionando
-- sem alteração — eles percorrem os itens, e o par são dois itens de verdade.
--
-- FK com ON DELETE SET NULL: se o agregado for apagado de vez, o par deixa de
-- existir e o produto principal segue vendendo avulso.
--
-- Aditiva e backward-compatible: produtos e pedidos atuais ficam com os campos
-- NULL = comportamento inalterado. Sem alteração de RLS — as políticas de linha
-- da 0002 já cobrem colunas novas (mesmo padrão de 0007/0008/0010).
-- =====================================================================

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "pairGroup" SMALLINT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN "pairPrice" DECIMAL(12,4),
ADD COLUMN "pairedProductId" UUID;

-- CreateIndex
CREATE INDEX "products_tenantId_pairedProductId_idx" ON "products"("tenantId", "pairedProductId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_pairedProductId_fkey" FOREIGN KEY ("pairedProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
