-- =====================================================================
-- 0024 — Troco por venda (Histórico: "Dinheiro recebido" e "Troco")
-- Persistir o troco devolvido ao cliente para exibir no Histórico e na reimpressão. Hoje as parcelas
-- gravadas somam exatamente o total (o dinheiro fecha o resto) e o troco só existia na UI do PDV —
-- perdido após a venda. Este campo é INFORMATIVO: NÃO entra no caixa (a invariante do ADR-016 —
-- parcelas somam o total, caixa recebe o dinheiro LÍQUIDO — permanece intacta).
--
-- 100% ADITIVA: 1 coluna nullable em orders (sem DEFAULT, sem backfill — nenhuma linha existente muda).
-- NULL = venda antiga sem o dado registrado; vendas novas gravam 0 quando não há troco. SEM mudança de
-- RLS (as políticas de linha de orders já cobrem a coluna nova). Reversível (DROP COLUMN).
-- =====================================================================

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "changeAmount" DECIMAL(12,2);
