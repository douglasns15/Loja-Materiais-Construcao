-- =====================================================================
-- 0040 — Troca: devolução com intenção EXCHANGE + venda que consome o vale (ADR-033, Fatia 3)
-- Uma devolução pode ser uma TROCA (`intent = EXCHANGE`): o valor devolvido não vira
-- dinheiro/crédito/abatimento na hora — vira um VALE consumido por uma nova venda no
-- PDV (parcela `EXCHANGE_CREDIT`). `exchangeOrderId` amarra a devolução à venda que
-- consumiu o vale (null enquanto não consumido — trava contra consumir 2×).
--
-- Aditiva e reversível: 1 enum novo + 2 colunas (uma com default, outra nullable) em
-- `order_returns`. Devoluções antigas assumem `intent = REFUND` (comportamento atual).
-- Dropar as colunas e o tipo devolve o estado anterior.
-- =====================================================================

-- CreateEnum
CREATE TYPE "ReturnIntent" AS ENUM ('REFUND', 'EXCHANGE');

-- AlterTable
ALTER TABLE "order_returns" ADD COLUMN     "intent" "ReturnIntent" NOT NULL DEFAULT 'REFUND',
ADD COLUMN     "exchangeOrderId" UUID;
