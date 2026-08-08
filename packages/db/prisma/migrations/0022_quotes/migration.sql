-- =====================================================================
-- 0022 — Orçamentos salvos (ADR-024)
-- Orçamento vira DOCUMENTO guardado, com código humano "O-000045" (sequencial por loja, mesmo motor
-- do ADR-023). NÃO tem efeito de estoque (proposta, não compromisso — ADR-001 intacto). Ciclo de vida
-- (Rascunho/Enviado/Aceito/Recusado/Convertido); "Expirado" é DERIVADO de validUntil (sem coluna, sem
-- cron). Conversão em venda reusa o PDV/POST /orders (motor único).
--
-- 100% ADITIVA: 1 enum, 2 tabelas NOVAS (nascem vazias), 1 coluna contadora em tenants (DEFAULT 0).
-- SEM backfill (não há orçamentos hoje) e nenhuma linha existente muda. RLS por tenant nas 2 tabelas
-- novas (padrão 0002/0019: só SELECT p/ authenticated; escrita via API, papel postgres). Sem coluna
-- nova em orders — o elo da conversão mora em quotes.convertedOrderId.
-- =====================================================================

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CONVERTED');

-- AlterTable — contador de orçamentos por loja (espelha tenants.lastOrderNumber do ADR-023).
ALTER TABLE "tenants" ADD COLUMN     "lastQuoteNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "quoteNumber" INTEGER NOT NULL,
    "customerId" UUID,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "notes" VARCHAR(500),
    "convertedOrderId" UUID,
    "createdById" UUID,
    "createdByName" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "productId" UUID,
    "productName" VARCHAR(150) NOT NULL,
    "unit" "UnitType" NOT NULL,
    "saleMode" VARCHAR(4),
    "quantity" DECIMAL(12,4) NOT NULL,
    "unitPrice" DECIMAL(12,4) NOT NULL,
    "discount" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "pairGroup" SMALLINT,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_tenantId_quoteNumber_key" ON "quotes"("tenantId", "quoteNumber");
CREATE INDEX "quotes_tenantId_createdAt_idx" ON "quotes"("tenantId", "createdAt");
CREATE INDEX "quotes_tenantId_status_idx" ON "quotes"("tenantId", "status");
CREATE INDEX "quote_items_quoteId_idx" ON "quote_items"("quoteId");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_convertedOrderId_fkey" FOREIGN KEY ("convertedOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- RLS — isolamento por tenant nas 2 tabelas novas (mesmo padrão da 0002/0019). Só SELECT para
-- `authenticated`; toda escrita passa pela API (papel `postgres`, que ignora RLS).
-- =====================================================================
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotes_select_tenant" ON public.quotes
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());

ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quote_items_select_tenant" ON public.quote_items
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());
