-- =====================================================================
-- 0050 — Retirada do crédito do cliente (aprovada pelo Owner 2026-10-22). O livro-razão `customer_credits`
-- (ADR-022) ganha a forma em que o valor voltou ao cliente (`method`: CASH/PIX/DEBIT_CARD/CREDIT_CARD) e o
-- motivo (`reason`) — preenchidos só nos lançamentos `origin = 'WITHDRAWAL'`. Colunas opcionais: as linhas
-- existentes ficam nulas, sem backfill; o código anterior não as lê. Volta: DROP COLUMN das duas.
-- =====================================================================

-- AlterTable
ALTER TABLE "customer_credits" ADD COLUMN     "method" VARCHAR(30),
ADD COLUMN     "reason" VARCHAR(500);
