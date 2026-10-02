-- =====================================================================
-- 0044 — Produção com ficha técnica (ADR-043, aprovada pelo Owner 2026-10-02)
--   * recipes / recipe_items: ficha técnica do produto PRONTO (rendimento + insumos).
--   * productions / production_lines: o evento "P-0001" — insumos que saíram (INPUT) e
--     pronto que entrou (OUTPUT), com custo congelado e elo com o StockMovement.
--   * tenants.lastProductionNumber: contador do código P-.
-- Aditiva: nenhum dado existente muda; sem backfill. Reversível dropando tabelas/enum/coluna.
-- =====================================================================
-- CreateEnum
CREATE TYPE "ProductionLineDirection" AS ENUM ('INPUT', 'OUTPUT');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "lastProductionNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "yieldQty" DECIMAL(12,4) NOT NULL,
    "notes" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "createdByName" VARCHAR(100),
    "updatedById" UUID,
    "updatedByName" VARCHAR(100),

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "recipeId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productionNumber" INTEGER NOT NULL,
    "totalCost" DECIMAL(12,2) NOT NULL,
    "notes" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,
    "registeredByName" VARCHAR(100),

    CONSTRAINT "productions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "direction" "ProductionLineDirection" NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitCost" DECIMAL(12,4),
    "stockMovementId" UUID,

    CONSTRAINT "production_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recipes_productId_key" ON "recipes"("productId");

-- CreateIndex
CREATE INDEX "recipes_tenantId_idx" ON "recipes"("tenantId");

-- CreateIndex
CREATE INDEX "recipe_items_recipeId_idx" ON "recipe_items"("recipeId");

-- CreateIndex
CREATE INDEX "recipe_items_tenantId_productId_idx" ON "recipe_items"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "productions_tenantId_createdAt_idx" ON "productions"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "productions_tenantId_productionNumber_key" ON "productions"("tenantId", "productionNumber");

-- CreateIndex
CREATE INDEX "production_lines_productionId_idx" ON "production_lines"("productionId");

-- CreateIndex
CREATE INDEX "production_lines_tenantId_productId_idx" ON "production_lines"("tenantId", "productId");

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productions" ADD CONSTRAINT "productions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "productions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- RLS — isolamento por tenant (mesmo padrão da 0042). A API (papel `postgres`) ignora
-- RLS e isola por código; o acesso direto via supabase-js fica restrito ao tenant do
-- JWT. Sem política de escrita: toda escrita passa pela API.
-- =====================================================================
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recipes_select_tenant" ON public.recipes
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());
ALTER TABLE public.recipe_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recipe_items_select_tenant" ON public.recipe_items
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());
ALTER TABLE public.productions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "productions_select_tenant" ON public.productions
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());
ALTER TABLE public.production_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "production_lines_select_tenant" ON public.production_lines
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());