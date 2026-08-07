-- =====================================================================
-- 0021 — Numeração sequencial de vendas por loja (ADR-023)
-- Toda venda ganha um número inteiro sequencial DENTRO da loja, exibido
-- como "V-000128". Fecha o refino do ADR-022 (busca por código) e dá uma
-- identidade humana à venda/nota. Aditiva; RLS intacta (as policies por
-- linha da 0002 já cobrem as colunas novas). O `id` UUID segue como PK.
-- =====================================================================

-- 1) Coluna do número na venda (nullable no primeiro momento, para o backfill).
ALTER TABLE "orders" ADD COLUMN "orderNumber" INTEGER;

-- 2) Backfill: numera 1..N por loja, na ordem cronológica (empate estável por id).
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "tenantId" ORDER BY "createdAt" ASC, "id" ASC
  ) AS rn
  FROM "orders"
)
UPDATE "orders" o
SET "orderNumber" = n.rn
FROM numbered n
WHERE o.id = n.id;

-- 3) Trava definitiva: NOT NULL + único por loja (também indexa a busca por número).
ALTER TABLE "orders" ALTER COLUMN "orderNumber" SET NOT NULL;
CREATE UNIQUE INDEX "orders_tenantId_orderNumber_key"
  ON "orders" ("tenantId", "orderNumber");

-- 4) Contador por loja (último número emitido).
ALTER TABLE "tenants" ADD COLUMN "lastOrderNumber" INTEGER NOT NULL DEFAULT 0;

-- 5) Acerta o contador de cada loja para o maior número já emitido (0 se não há vendas).
UPDATE "tenants" t
SET "lastOrderNumber" = COALESCE(
  (SELECT MAX(o."orderNumber") FROM "orders" o WHERE o."tenantId" = t.id), 0
);
