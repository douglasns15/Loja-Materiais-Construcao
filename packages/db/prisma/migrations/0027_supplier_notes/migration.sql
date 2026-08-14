-- =====================================================================
-- 0027 — Observação livre no cadastro de Fornecedor
-- A tela de Fornecedores ganhou um campo de texto livre "Observações" (paridade com o cadastro de
-- Cliente, que já tinha `customers.notes`). Esta coluna guarda essa anotação do CADASTRO do
-- fornecedor (ex.: "vendedor João, entrega às terças"). É só informativa.
--
-- 100% ADITIVA: 1 coluna nullable em suppliers (sem DEFAULT, sem backfill — nenhuma linha existente
-- muda). NULL = sem observação (inclusive todas as linhas atuais). SEM mudança de RLS (as políticas
-- de linha de suppliers já cobrem a coluna nova, mesmo perfil da 0018 em customers). Reversível
-- (DROP COLUMN).
-- =====================================================================

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "notes" VARCHAR(500);
