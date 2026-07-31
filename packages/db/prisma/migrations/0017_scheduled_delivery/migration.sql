-- =====================================================================
-- 0017 — Retirada / Entrega futura (ADR-020)
-- Adia a SAÍDA da mercadoria (eixo ortogonal ao fiado/ADR-019, que adia o
-- pagamento). Na venda SCHEDULED a quantidade fica RESERVADA (sem baixa); a
-- baixa real de estoque (ADR-001: StockMovement EXPENSE + stockQty) dispara
-- na RETIRADA, que é PARCIAL (item a item, conforme sai). Estrutura espelha o
-- fiado: `order_item_deliveries` (cada retirada) ≡ `receivable_payments`;
-- `OrderItem.deliveredBaseQty` (cache do retirado) ≡ `Receivable.settledAmount`.
--
-- 100% ADITIVA: toda coluna nova tem default ou é anulável; nenhum backfill.
-- Pedidos existentes ficam IMMEDIATE, fulfillmentStatus null, deliveredBaseQty
-- 0 e reservedQty 0 — comportamento de hoje, regressão nula. O modelo Delivery
-- (ADR-002) NÃO é reusado: é por-pedido/tudo-ou-nada e tem address NOT NULL;
-- a retirada parcial exige rastreio por linha.
-- =====================================================================

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('IMMEDIATE', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('PENDING', 'PARTIAL', 'COMPLETED');

-- AlterTable — Product: cache do reservado (disponível = stockQty − reservedQty)
ALTER TABLE "products" ADD COLUMN "reservedQty" DECIMAL(12,4) NOT NULL DEFAULT 0;

-- AlterTable — Order: modo de saída + agendamento (previsão única ou por item)
ALTER TABLE "orders" ADD COLUMN "deliveryMode" "DeliveryMode" NOT NULL DEFAULT 'IMMEDIATE';
ALTER TABLE "orders" ADD COLUMN "fulfillmentStatus" "FulfillmentStatus";
ALTER TABLE "orders" ADD COLUMN "scheduledPickupAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "perItemSchedule" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable — OrderItem: cache do retirado por linha + previsão por item
ALTER TABLE "order_items" ADD COLUMN "deliveredBaseQty" DECIMAL(12,4) NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN "scheduledPickupAt" TIMESTAMP(3);

-- CreateTable — log de retiradas parciais (o "lastro" da tela de Entregas)
CREATE TABLE "order_item_deliveries" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stockMovementId" UUID,
    "reference" VARCHAR(100),
    "notes" VARCHAR(300),
    "deliveredById" UUID,
    "deliveredByName" VARCHAR(100),

    CONSTRAINT "order_item_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_tenantId_fulfillmentStatus_idx" ON "orders"("tenantId", "fulfillmentStatus");

-- CreateIndex
CREATE INDEX "order_item_deliveries_tenantId_orderId_idx" ON "order_item_deliveries"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "order_item_deliveries_tenantId_orderItemId_idx" ON "order_item_deliveries"("tenantId", "orderItemId");

-- AddForeignKey
ALTER TABLE "order_item_deliveries" ADD CONSTRAINT "order_item_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_deliveries" ADD CONSTRAINT "order_item_deliveries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_deliveries" ADD CONSTRAINT "order_item_deliveries_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- RLS — isolamento por tenant (mesmo padrão da 0002/0014). Colunas novas em
-- products/orders/order_items já são cobertas pelas políticas existentes; a
-- tabela nova precisa da sua. A API (papel `postgres`) ignora RLS e isola por
-- código; o acesso direto via supabase-js fica restrito ao tenant do JWT. Sem
-- política de escrita: toda escrita passa pela API.
-- =====================================================================
ALTER TABLE public.order_item_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_item_deliveries_select_tenant" ON public.order_item_deliveries
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());
