-- =====================================================================
-- 0035 — Histórico de importação de NF-e (tela Estoque)
-- Guarda, por item lançado, o NOME DO ARQUIVO XML importado e um snapshot do
-- FORNECEDOR, para a tela de histórico listar as importações (agrupadas por
-- chave de acesso) sem joins extras. Preenchidos na confirmação (POST /nfe/entry).
--
-- Aditiva e reversível: adiciona duas colunas NULLABLE e um índice de listagem,
-- sem reescrever nada. Linhas anteriores a esta mudança ficam com `fileName`/
-- `supplierName` = NULL (a listagem marca essas importações como "sem nome de
-- arquivo"). Dropar as colunas e o índice devolve o estado anterior.
-- =====================================================================

-- AlterTable
ALTER TABLE "nfe_import_items" ADD COLUMN     "fileName" VARCHAR(200),
ADD COLUMN     "supplierName" VARCHAR(120);

-- CreateIndex
CREATE INDEX "nfe_import_items_tenantId_createdAt_idx" ON "nfe_import_items"("tenantId", "createdAt");
