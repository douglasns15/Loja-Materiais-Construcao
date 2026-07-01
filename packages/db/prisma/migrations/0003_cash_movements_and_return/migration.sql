-- =====================================================================
-- 0003 — Devolução de venda + Movimentações de caixa (ADR-006)
-- Adiciona o status RETURNED (devolução de venda de caixa já fechado) e a
-- tabela `cash_movements` (saídas/entradas de dinheiro que não são vendas:
-- devolução, sangria, suprimento, despesa). A saída da devolução é lançada no
-- caixa de HOJE, sem tocar no caixa original já fechado.
-- =====================================================================

-- CreateEnum
CREATE TYPE "CashMovementKind" AS ENUM ('RETURN', 'WITHDRAWAL', 'SUPPLY', 'EXPENSE');

-- AlterEnum (novo status de pedido)
ALTER TYPE "OrderStatus" ADD VALUE 'RETURNED';

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cashSessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "kind" "CashMovementKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(300),
    "relatedOrderId" UUID,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'SYNCED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_movements_tenantId_cashSessionId_idx" ON "cash_movements"("tenantId", "cashSessionId");

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "cash_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- RLS — isolamento por tenant (mesmo padrão da 0002). A API (papel `postgres`)
-- ignora RLS e isola por código; o acesso direto via supabase-js fica restrito
-- ao tenant do JWT. Sem política de escrita: toda escrita passa pela API.
-- =====================================================================
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cash_movements_select_tenant" ON public.cash_movements
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());
