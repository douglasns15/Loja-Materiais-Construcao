-- =====================================================================
-- 0006 — Atribuição de autoria ("Registrado por") — ADR-010
--
-- Adiciona QUEM criou/alterou/excluiu/movimentou em cada registro relevante, para
-- exibir "Registrado por … em <data>" nas telas (o QUANDO reusa os `createdAt`/
-- `updatedAt`/`deletedAt`/`openedAt` já existentes). Padrão:
--   * `*Id`   = referência SOLTA ao usuário (SEM FK) — sobrevive à exclusão do usuário.
--   * `*Name` = SNAPSHOT do nome no momento da ação (congelado; é o que aparece em tela).
--
-- Todas as colunas são ADITIVAS e NULLABLE → migration segura (sem perda de dados, sem
-- quebrar escrita/leitura existentes). SEM alteração de RLS: as políticas de linha da 0002
-- já cobrem colunas novas (como na 0004). Complementa — não substitui — a auditoria seletiva
-- do ADR-004 (isto é snapshot na própria linha, não um log de eventos; segue cost-zero).
--
-- Destaque: `stock_movements` NÃO registrava operador nenhum até aqui — ganha `userId`
-- (solto) + `registeredByName`. Movimentações antigas ficam com NULL (não há o dado
-- histórico) e a tela mostra "—".
-- =====================================================================

-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN     "registeredByName" VARCHAR(100);

-- AlterTable
ALTER TABLE "cash_sessions" ADD COLUMN     "closedById" UUID,
ADD COLUMN     "closedByName" VARCHAR(100),
ADD COLUMN     "openedByName" VARCHAR(100);

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "createdByName" VARCHAR(100),
ADD COLUMN     "deletedById" UUID,
ADD COLUMN     "deletedByName" VARCHAR(100),
ADD COLUMN     "updatedById" UUID,
ADD COLUMN     "updatedByName" VARCHAR(100);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "registeredByName" VARCHAR(100);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "createdByName" VARCHAR(100),
ADD COLUMN     "deletedById" UUID,
ADD COLUMN     "deletedByName" VARCHAR(100),
ADD COLUMN     "updatedById" UUID,
ADD COLUMN     "updatedByName" VARCHAR(100);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "registeredByName" VARCHAR(100),
ADD COLUMN     "userId" UUID;
