-- =====================================================================
-- 0030 — Dívida do cliente como entidade (conta-corrente "D-0001" — ADR-026)
-- Promove a conta implícita da ADR-022 a uma ENTIDADE `debts`, com código
-- sequencial por loja (`D-0001`), agregando 1+ vendas a prazo do mesmo cliente.
-- A dívida vira a unidade de quitação (recebe-se a dívida, não a venda/item).
--
-- Aditiva: cria enum/tabela/colunas SEM reescrever nada existente. O BACKFILL
-- agrupa os recebíveis atuais em dívidas (1 aberta por cliente; cada paga vira a
-- sua própria dívida quitada; canceladas ficam sem dívida) e acerta o contador.
-- Reversível: dropar `debts`, a coluna `receivables.debtId` e
-- `tenants.lastDebtNumber` devolve o estado anterior sem perder recebíveis.
-- =====================================================================

-- CreateEnum
CREATE TYPE "DebtStatus" AS ENUM ('OPEN', 'PAID');

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "debtId" UUID;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "lastDebtNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "debts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "debtNumber" INTEGER NOT NULL,
    "status" "DebtStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdByName" VARCHAR(100),

    CONSTRAINT "debts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "debts_tenantId_customerId_status_idx" ON "debts"("tenantId", "customerId", "status");

-- CreateIndex
CREATE INDEX "debts_tenantId_status_idx" ON "debts"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "debts_tenantId_debtNumber_key" ON "debts"("tenantId", "debtNumber");

-- CreateIndex
CREATE INDEX "receivables_debtId_idx" ON "receivables"("debtId");

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "debts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- RLS — isolamento por tenant (mesmo padrão da 0014). A API (papel `postgres`)
-- ignora RLS e isola por código; o acesso direto via supabase-js fica restrito
-- ao tenant do JWT. Sem política de escrita: toda escrita passa pela API.
-- =====================================================================
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "debts_select_tenant" ON public.debts
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());

-- =====================================================================
-- BACKFILL — agrupa os recebíveis existentes em dívidas (ADR-026 §Backfill).
-- Regra por (tenant, customer):
--   • recebíveis OPEN  -> UMA dívida OPEN do cliente (openedAt = min createdAt)
--   • cada recebível PAID -> a SUA PRÓPRIA dívida PAID (closedAt = createdAt)
--   • recebíveis CANCELLED ficam SEM dívida (debtId nulo — cancelado ≠ quitado)
-- Códigos D-0001, D-0002… por ordem cronológica dentro de cada loja.
-- =====================================================================

-- Um registro por DÍVIDA a criar, com id já sorteado e número sequencial por loja.
CREATE TEMP TABLE _debt_seed AS
WITH rec_grouped AS (
  SELECT
    r."tenantId",
    r."customerId",
    r."createdAt",
    -- chave do agrupamento: OPEN colapsa por cliente; PAID é 1:1 (por recebível)
    CASE WHEN r.status = 'OPEN'
         THEN 'OPEN:' || r."customerId"::text
         ELSE 'REC:'  || r.id::text
    END AS group_key,
    (r.status = 'OPEN') AS is_open
  FROM receivables r
  WHERE r.status IN ('OPEN', 'PAID') -- CANCELLED fica de fora (sem dívida)
),
group_info AS (
  SELECT
    "tenantId",
    group_key,
    "customerId", -- constante dentro do grupo (a group_key já o embute); vai no GROUP BY
    bool_or(is_open) AS is_open,
    min("createdAt") AS opened_at,
    max("createdAt") AS closed_at
  FROM rec_grouped
  GROUP BY "tenantId", group_key, "customerId"
)
SELECT
  gen_random_uuid() AS debt_id,
  "tenantId",
  group_key,
  "customerId",
  is_open,
  opened_at,
  closed_at,
  row_number() OVER (PARTITION BY "tenantId" ORDER BY opened_at, group_key) AS debt_number
FROM group_info;

-- Cria as dívidas.
INSERT INTO debts (id, "tenantId", "customerId", "debtNumber", status, "openedAt", "closedAt")
SELECT
  debt_id, "tenantId", "customerId", debt_number,
  CASE WHEN is_open THEN 'OPEN'::"DebtStatus" ELSE 'PAID'::"DebtStatus" END,
  opened_at,
  CASE WHEN is_open THEN NULL ELSE closed_at END
FROM _debt_seed;

-- Liga cada recebível (OPEN/PAID) à sua dívida (recompõe a mesma group_key).
UPDATE receivables r
SET "debtId" = s.debt_id
FROM _debt_seed s
WHERE s."tenantId" = r."tenantId"
  AND s.group_key = CASE WHEN r.status = 'OPEN'
                         THEN 'OPEN:' || r."customerId"::text
                         ELSE 'REC:'  || r.id::text END
  AND r.status IN ('OPEN', 'PAID');

-- Acerta o contador de dívidas de cada loja (maior número emitido).
UPDATE tenants t
SET "lastDebtNumber" = sub.maxnum
FROM (SELECT "tenantId", max(debt_number) AS maxnum FROM _debt_seed GROUP BY "tenantId") sub
WHERE sub."tenantId" = t.id;

DROP TABLE _debt_seed;
