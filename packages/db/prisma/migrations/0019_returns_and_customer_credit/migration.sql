-- =====================================================================
-- 0019 — Devolução/troca por item + crédito do cliente (conta do cliente — ADR-022, Fatia B/C)
-- Devolução PARCIAL, item a item: estorna estoque (ADR-001: StockMovement INCOME + stockQty),
-- abate a dívida da venda (`receivables.returnedAmount`) e, se sobrar valor, o EXCEDENTE vira
-- crédito na loja (`customers.creditBalance` + livro-razão `customer_credits`) OU dinheiro no
-- caixa (CashMovement RETURN) — escolha do operador (`order_returns.target`). A troca é a soma
-- de uma devolução + uma venda.
--
-- Padrão cache + livro-razão do projeto: `customers.creditBalance` (cache) ≡ `products.stockQty`,
-- `customer_credits` (append-only, assinado) ≡ `StockMovement`. `order_returns`/`order_return_items`
-- espelham `order_item_deliveries` (ADR-020), com o acerto de dinheiro no cabeçalho.
--
-- 100% ADITIVA: as 3 colunas novas têm DEFAULT 0; nenhum backfill; nenhuma linha existente muda
-- (returnedBaseQty/returnedAmount/creditBalance nascem 0 = comportamento de hoje). RLS por tenant
-- nas 3 tabelas novas (as colunas novas em customers/order_items/receivables já são cobertas pelas
-- políticas existentes). A API (papel `postgres`) ignora RLS e isola por código; o acesso direto
-- via supabase-js fica restrito ao tenant do JWT. Sem política de escrita: toda escrita via API.
-- =====================================================================

-- CreateEnum
CREATE TYPE "ReturnTarget" AS ENUM ('STORE_CREDIT', 'CASH');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "creditBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "returnedBaseQty" DECIMAL(12,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "returnedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "order_returns" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "customerId" UUID,
    "totalValue" DECIMAL(12,2) NOT NULL,
    "abatedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "excessAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "target" "ReturnTarget",
    "receivableId" UUID,
    "cashMovementId" UUID,
    "customerCreditId" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "createdByName" VARCHAR(100),

    CONSTRAINT "order_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_return_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "baseQty" DECIMAL(12,4) NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "order_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_credits" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "origin" VARCHAR(30) NOT NULL,
    "relatedOrderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "createdByName" VARCHAR(100),

    CONSTRAINT "customer_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_returns_tenantId_createdAt_idx" ON "order_returns"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "order_returns_orderId_idx" ON "order_returns"("orderId");

-- CreateIndex
CREATE INDEX "order_return_items_returnId_idx" ON "order_return_items"("returnId");

-- CreateIndex
CREATE INDEX "customer_credits_tenantId_customerId_idx" ON "customer_credits"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "customer_credits_customerId_idx" ON "customer_credits"("customerId");

-- AddForeignKey
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_return_items" ADD CONSTRAINT "order_return_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_return_items" ADD CONSTRAINT "order_return_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "order_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_return_items" ADD CONSTRAINT "order_return_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- RLS — isolamento por tenant nas 3 tabelas novas (mesmo padrão da 0002/0014/0017). Só SELECT
-- para `authenticated`; toda escrita passa pela API (papel `postgres`, que ignora RLS).
-- =====================================================================
ALTER TABLE public.order_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_returns_select_tenant" ON public.order_returns
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());

ALTER TABLE public.order_return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_return_items_select_tenant" ON public.order_return_items
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());

ALTER TABLE public.customer_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customer_credits_select_tenant" ON public.customer_credits
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());
