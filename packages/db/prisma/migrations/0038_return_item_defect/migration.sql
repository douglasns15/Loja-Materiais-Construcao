-- =====================================================================
-- 0038 — Condição do item devolvido: defeito não volta ao estoque (ADR-033, Fatia 1)
-- Um item devolvido com DEFEITO não pode voltar à prateleira: fica parado como
-- "defeituoso" (cache `products.defectiveQty` + ledger na própria linha de
-- devolução) até ser TROCADO com o fornecedor (o substituto entra no estoque) ou
-- receber BAIXA/perda. Item de REVENDA (GOOD, default) mantém o comportamento do
-- ADR-022 (volta ao estoque vendável).
--
-- Aditiva e reversível: 2 enums novos + colunas com default em tabelas que já
-- existem — NENHUMA reescrita de tabela, nenhum dado tocado, nenhuma política RLS
-- nova (as colunas herdam o RLS por `tenantId` das suas tabelas). Devoluções e
-- produtos antigos assumem os defaults (condition=GOOD, defectiveQty=0), então o
-- comportamento pré-migração fica idêntico. Dropar as colunas e os tipos devolve
-- o estado anterior.
-- =====================================================================

-- CreateEnum
CREATE TYPE "ReturnItemCondition" AS ENUM ('GOOD', 'DEFECTIVE');

-- CreateEnum
CREATE TYPE "DefectResolution" AS ENUM ('PENDING', 'RESTOCKED', 'WRITTEN_OFF');

-- AlterTable: cache do defeituoso no produto (análogo a stockQty/reservedQty)
ALTER TABLE "products" ADD COLUMN     "defectiveQty" DECIMAL(12,4) NOT NULL DEFAULT 0;

-- AlterTable: condição + desfecho por linha devolvida (ledger do defeituoso)
ALTER TABLE "order_return_items" ADD COLUMN     "condition" "ReturnItemCondition" NOT NULL DEFAULT 'GOOD',
ADD COLUMN     "defectStatus" "DefectResolution",
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" UUID,
ADD COLUMN     "resolvedByName" VARCHAR(100);

-- CreateIndex: lista "Devolvidos com defeito" (linhas defeituosas pendentes por loja)
CREATE INDEX "order_return_items_tenantId_condition_defectStatus_idx" ON "order_return_items"("tenantId", "condition", "defectStatus");
