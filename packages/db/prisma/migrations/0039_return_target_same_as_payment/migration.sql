-- =====================================================================
-- 0039 — Forma do estorno "mesma forma do pagamento" (ADR-033, Fatia 2)
-- Acrescenta o valor SAME_AS_PAYMENT ao enum ReturnTarget: o dinheiro do
-- cliente volta PELA MESMA FORMA em que foi pago (estorno). Na prática, só a
-- PARCELA que foi paga EM DINHEIRO sai do caixa; a parte no cartão/PIX é
-- estorno e NÃO toca o caixa. Antes o destino do troco era binário
-- (crédito na loja × dinheiro do caixa) e não havia como registrar um estorno
-- de cartão sem tirar dinheiro da gaveta — o que deixava o caixa errado quando
-- a venda tinha sido no cartão.
--
-- Aditiva e reversível: só um valor a mais no enum. Devoluções antigas seguem
-- com STORE_CREDIT/CASH; nada é reescrito. (O ADD VALUE de enum não roda dentro
-- de transação no Postgres — Prisma aplica fora, como nas migrations 0013/0037.)
-- =====================================================================

-- AlterEnum
ALTER TYPE "ReturnTarget" ADD VALUE 'SAME_AS_PAYMENT';
