-- ADR-016 x ADR-022 (Fatia C.3): acréscimo de cartão cobrado ao RECEBER uma dívida por débito/crédito.
-- Coluna ADITIVA (default 0), não altera dados existentes nem RLS. `surcharge` é receita a mais
-- (recupera a taxa do cartão); NÃO abate a dívida — o `amount` é que quita. Somada no relatório à
-- forma do cartão. Digitada manualmente pelo operador no recebimento.
ALTER TABLE "receivable_payments" ADD COLUMN "surcharge" DECIMAL(12,2) NOT NULL DEFAULT 0;
