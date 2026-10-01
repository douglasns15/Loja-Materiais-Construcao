-- =====================================================================
-- 0042 — Agenda de entregas + funcionários (ADR-042, aprovada pelo Owner 2026-10-01)
--   * orders: fulfillmentType (PICKUP × DELIVERY), scheduledUntil (fim da faixa de
--     horário; o início segue em scheduledPickupAt), deliveryAddress (snapshot do
--     endereço), dispatchedAt ("saiu para entrega") e courierId (entregador, FK
--     SET NULL) + índice (tenantId, scheduledPickupAt) para a agenda do dia.
--   * employees: cadastro de funcionários SEM login (entregadores).
--   * tenants.deliverySettings: período de entregas (JSON validado por Zod no shared).
-- Aditiva: nada existente muda de significado. Backfill: toda venda SCHEDULED antiga
-- era retirada ⇒ fulfillmentType = PICKUP. Reversível dropando as colunas/tabela/enums.
-- =====================================================================
-- CreateEnum
CREATE TYPE "FulfillmentType" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "EmployeeRole" AS ENUM ('COURIER', 'OTHER');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "courierId" UUID,
ADD COLUMN     "deliveryAddress" VARCHAR(300),
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "fulfillmentType" "FulfillmentType",
ADD COLUMN     "scheduledUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "deliverySettings" JSONB;

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20),
    "role" "EmployeeRole" NOT NULL DEFAULT 'COURIER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "createdByName" VARCHAR(100),
    "updatedById" UUID,
    "updatedByName" VARCHAR(100),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employees_tenantId_isActive_idx" ON "employees"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "orders_tenantId_scheduledPickupAt_idx" ON "orders"("tenantId", "scheduledPickupAt");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- RLS — isolamento por tenant (mesmo padrão da 0030/0034). A API (papel `postgres`)
-- ignora RLS e isola por código; o acesso direto via supabase-js fica restrito ao
-- tenant do JWT. Sem política de escrita: toda escrita passa pela API.
-- =====================================================================
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees_select_tenant" ON public.employees
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());

-- =====================================================================
-- BACKFILL — agendamentos existentes eram todos retirada (ADR-020).
-- =====================================================================
UPDATE "orders" SET "fulfillmentType" = 'PICKUP' WHERE "deliveryMode" = 'SCHEDULED';
