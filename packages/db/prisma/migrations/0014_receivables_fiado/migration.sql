-- =====================================================================
-- 0014 — Venda a prazo / Contas a Receber (o "fiado" — ADR-019)
-- Adiciona o enum `ReceivableStatus` e as tabelas `receivables` (a dívida de
-- uma venda a prazo) e `receivable_payments` (cada recebimento, total ou
-- parcial). Aditiva: não altera nenhuma tabela existente. O fiado adia o
-- PAGAMENTO, não a entrega — o motor de estoque (ADR-001) não muda.
-- =====================================================================

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "receivables" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "originalAmount" DECIMAL(12,2) NOT NULL,
    "settledAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "ReceivableStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "createdByName" VARCHAR(100),

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_payments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "receivableId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" VARCHAR(30) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashSessionId" UUID,
    "cashMovementId" UUID,
    "reference" VARCHAR(100),
    "receivedById" UUID,
    "receivedByName" VARCHAR(100),

    CONSTRAINT "receivable_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receivables_orderId_key" ON "receivables"("orderId");

-- CreateIndex
CREATE INDEX "receivables_tenantId_status_idx" ON "receivables"("tenantId", "status");

-- CreateIndex
CREATE INDEX "receivables_tenantId_customerId_idx" ON "receivables"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "receivables_tenantId_dueDate_idx" ON "receivables"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "receivable_payments_tenantId_paidAt_idx" ON "receivable_payments"("tenantId", "paidAt");

-- CreateIndex
CREATE INDEX "receivable_payments_receivableId_idx" ON "receivable_payments"("receivableId");

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- RLS — isolamento por tenant (mesmo padrão da 0002/0003). A API (papel
-- `postgres`) ignora RLS e isola por código; o acesso direto via supabase-js
-- fica restrito ao tenant do JWT. Sem política de escrita: toda escrita passa
-- pela API.
-- =====================================================================
ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "receivables_select_tenant" ON public.receivables
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());

ALTER TABLE public.receivable_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "receivable_payments_select_tenant" ON public.receivable_payments
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());
