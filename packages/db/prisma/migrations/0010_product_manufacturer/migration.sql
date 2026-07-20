-- =====================================================================
-- 0010 — Fabricante do produto (EP — edição/visualização de produto)
-- Coluna opcional em `products` para o fabricante/marca (ex.: "Votorantim",
-- "Tigre"). Campo genérico p/ qualquer ramo, exibido no cadastro/detalhe e
-- usado na BUSCA junto com nome, nome popular e SKU — daí o índice por
-- (tenantId, manufacturer), no mesmo padrão do popularName (0007).
--
-- Aditiva e backward-compatible: produtos atuais ficam com NULL = comportamento
-- inalterado. Sem alteração de RLS: as políticas de linha da 0002 já cobrem
-- colunas novas (mesmo padrão da 0007/0008).
-- =====================================================================

-- AlterTable
ALTER TABLE "products" ADD COLUMN "manufacturer" VARCHAR(120);

-- CreateIndex
CREATE INDEX "products_tenantId_manufacturer_idx" ON "products"("tenantId", "manufacturer");
