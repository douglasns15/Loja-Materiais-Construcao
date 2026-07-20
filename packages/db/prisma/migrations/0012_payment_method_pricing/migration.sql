-- ADR-016 — Preço e margem por forma de pagamento.
-- Aditiva: 4 colunas nullable, nenhuma alteração de RLS (as políticas por linha da 0002 já
-- cobrem colunas novas), nenhum índice. Zero impacto em dados existentes.
--
-- products.surcharge*    = acréscimo em R$ por unidade-base, OPT-IN por produto: é o quanto o
--                          preço sobe naquela forma de pagamento. Vazio ⇒ preço normal.
-- tenants.cardFee*       = taxa da maquininha em %, usada SÓ para exibir a margem real.
--                          Nunca altera o preço cobrado do cliente.

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "surchargeCredit" DECIMAL(12,4),
ADD COLUMN     "surchargeDebit" DECIMAL(12,4);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "cardFeeCreditPercent" DECIMAL(5,2),
ADD COLUMN     "cardFeeDebitPercent" DECIMAL(5,2);
