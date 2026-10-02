-- =====================================================================
-- 0043 — Funcionários: e-mail de contato + novas funções (ADR-042, aprovada pelo Owner 2026-10-02)
--   * employees.email: contato opcional (NÃO é login — funcionário não acessa o sistema).
--   * EmployeeRole += Operador, Caixa, Açougueiro, Cozinheiro, Churrasqueiro, Limpeza, Segurança.
-- Aditiva: nenhum dado existente muda; sem backfill. (PG ≥ 12 aceita vários ADD VALUE na mesma
-- migration, desde que os valores novos não sejam USADOS na mesma transação.)
-- =====================================================================
-- AlterEnum
ALTER TYPE "EmployeeRole" ADD VALUE 'OPERATOR';
ALTER TYPE "EmployeeRole" ADD VALUE 'CASHIER';
ALTER TYPE "EmployeeRole" ADD VALUE 'BUTCHER';
ALTER TYPE "EmployeeRole" ADD VALUE 'COOK';
ALTER TYPE "EmployeeRole" ADD VALUE 'GRILLER';
ALTER TYPE "EmployeeRole" ADD VALUE 'CLEANING';
ALTER TYPE "EmployeeRole" ADD VALUE 'SECURITY';

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "email" VARCHAR(160);
