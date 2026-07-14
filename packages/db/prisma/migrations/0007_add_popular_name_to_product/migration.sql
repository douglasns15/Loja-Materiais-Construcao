-- =====================================================================
-- 0007 — Nome popular do produto (busca no PDV)
-- Coluna opcional em `products` para o nome popular/regional do produto, usado
-- na busca além do nome oficial (ex.: "Ferro 8" p/ "Vergalhão CA-50 8mm";
-- "Dipirona" p/ "Dipirona Sódica 500mg"). Campo genérico p/ qualquer ramo.
-- Índice por (tenantId, popularName) para busca rápida. Sem alteração de RLS:
-- as políticas de linha da 0002 já cobrem a nova coluna.
-- =====================================================================

-- AlterTable
ALTER TABLE "products" ADD COLUMN "popularName" VARCHAR(150);

-- CreateIndex
CREATE INDEX "products_tenantId_popularName_idx" ON "products"("tenantId", "popularName");
