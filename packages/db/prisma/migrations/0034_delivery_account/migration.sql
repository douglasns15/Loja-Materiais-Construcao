-- =====================================================================
-- 0034 — Conta de retiradas do cliente (conta-corrente "E-0001" — ADR-028)
-- Espelha a `debts` (ADR-026/migration 0030) no eixo da ENTREGA: agrupa as
-- vendas SCHEDULED de um mesmo cliente numa ENTIDADE `delivery_accounts`, com
-- código sequencial por loja (`E-0001`). A conta é a unidade EXIBIDA na tela de
-- Entregas (não a unidade de baixa — a mercadoria continua saindo por venda/item).
--
-- Aditiva: cria enum/tabela/colunas SEM reescrever nada existente. O BACKFILL
-- agrupa as vendas SCHEDULED atuais em contas (1 aberta por cliente; cada
-- finalizada vira a sua própria conta fechada; vendas sem cliente ficam sem
-- conta) e acerta o contador. Reversível: dropar `delivery_accounts`, a coluna
-- `orders.deliveryAccountId` e `tenants.lastDeliveryNumber` devolve o estado
-- anterior sem perder pedidos.
-- =====================================================================

-- CreateEnum
CREATE TYPE "DeliveryAccountStatus" AS ENUM ('OPEN', 'COMPLETED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveryAccountId" UUID;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "lastDeliveryNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "delivery_accounts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "accountNumber" INTEGER NOT NULL,
    "status" "DeliveryAccountStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdByName" VARCHAR(100),

    CONSTRAINT "delivery_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_accounts_tenantId_customerId_status_idx" ON "delivery_accounts"("tenantId", "customerId", "status");

-- CreateIndex
CREATE INDEX "delivery_accounts_tenantId_status_idx" ON "delivery_accounts"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_accounts_tenantId_accountNumber_key" ON "delivery_accounts"("tenantId", "accountNumber");

-- CreateIndex
CREATE INDEX "orders_deliveryAccountId_idx" ON "orders"("deliveryAccountId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_deliveryAccountId_fkey" FOREIGN KEY ("deliveryAccountId") REFERENCES "delivery_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_accounts" ADD CONSTRAINT "delivery_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_accounts" ADD CONSTRAINT "delivery_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- RLS — isolamento por tenant (mesmo padrão da 0030). A API (papel `postgres`)
-- ignora RLS e isola por código; o acesso direto via supabase-js fica restrito
-- ao tenant do JWT. Sem política de escrita: toda escrita passa pela API.
-- =====================================================================
ALTER TABLE public.delivery_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "delivery_accounts_select_tenant" ON public.delivery_accounts
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());

-- =====================================================================
-- BACKFILL — agrupa as vendas SCHEDULED existentes em contas (ADR-028 §Backfill).
-- Só vendas CONFIRMED, SCHEDULED e COM cliente. Regra por (tenant, customer):
--   • vendas não-finalizadas (fulfillment NULL/PENDING/PARTIAL) -> UMA conta OPEN
--     do cliente (openedAt = min createdAt)
--   • cada venda COMPLETED -> a SUA PRÓPRIA conta COMPLETED (closedAt = createdAt)
--   • vendas SEM cliente ficam SEM conta (deliveryAccountId nulo — card avulso)
-- Códigos E-0001, E-0002… por ordem cronológica dentro de cada loja.
-- =====================================================================

-- Um registro por CONTA a criar, com id já sorteado e número sequencial por loja.
CREATE TEMP TABLE _delivery_seed AS
WITH ord_grouped AS (
  SELECT
    o."tenantId",
    o."customerId",
    o."createdAt",
    -- aberta = tudo que ainda não está COMPLETED (NULL trata como aberta)
    (o."fulfillmentStatus" IS DISTINCT FROM 'COMPLETED') AS is_open,
    -- chave do agrupamento: aberta colapsa por cliente; finalizada é 1:1 (por venda)
    CASE WHEN o."fulfillmentStatus" IS DISTINCT FROM 'COMPLETED'
         THEN 'OPEN:' || o."customerId"::text
         ELSE 'ORD:'  || o.id::text
    END AS group_key
  FROM orders o
  WHERE o."deliveryMode" = 'SCHEDULED'
    AND o.status = 'CONFIRMED'
    AND o."customerId" IS NOT NULL
),
group_info AS (
  SELECT
    "tenantId",
    group_key,
    "customerId", -- constante dentro do grupo (a group_key já o embute); vai no GROUP BY
    bool_or(is_open) AS is_open,
    min("createdAt") AS opened_at,
    max("createdAt") AS closed_at
  FROM ord_grouped
  GROUP BY "tenantId", group_key, "customerId"
)
SELECT
  gen_random_uuid() AS account_id,
  "tenantId",
  group_key,
  "customerId",
  is_open,
  opened_at,
  closed_at,
  row_number() OVER (PARTITION BY "tenantId" ORDER BY opened_at, group_key) AS account_number
FROM group_info;

-- Cria as contas.
INSERT INTO delivery_accounts (id, "tenantId", "customerId", "accountNumber", status, "openedAt", "closedAt")
SELECT
  account_id, "tenantId", "customerId", account_number,
  CASE WHEN is_open THEN 'OPEN'::"DeliveryAccountStatus" ELSE 'COMPLETED'::"DeliveryAccountStatus" END,
  opened_at,
  CASE WHEN is_open THEN NULL ELSE closed_at END
FROM _delivery_seed;

-- Liga cada venda SCHEDULED (com cliente) à sua conta (recompõe a mesma group_key).
UPDATE orders o
SET "deliveryAccountId" = s.account_id
FROM _delivery_seed s
WHERE s."tenantId" = o."tenantId"
  AND s.group_key = CASE WHEN o."fulfillmentStatus" IS DISTINCT FROM 'COMPLETED'
                         THEN 'OPEN:' || o."customerId"::text
                         ELSE 'ORD:'  || o.id::text END
  AND o."deliveryMode" = 'SCHEDULED'
  AND o.status = 'CONFIRMED'
  AND o."customerId" IS NOT NULL;

-- Acerta o contador de contas de cada loja (maior número emitido).
UPDATE tenants t
SET "lastDeliveryNumber" = sub.maxnum
FROM (SELECT "tenantId", max(account_number) AS maxnum FROM _delivery_seed GROUP BY "tenantId") sub
WHERE sub."tenantId" = t.id;

DROP TABLE _delivery_seed;
