# ADR-006: Devolução de Venda e Movimentações de Caixa

**Status:** Aceito
**Data:** 2026-07-01
**Deciders:** Owner do produto

## Contexto

O sistema já tem **cancelamento de venda** (2.K, ADR-004), mas ele é intencionalmente
**restrito ao caixa aberto** do operador: cancelar reverte estoque e pagamento *dentro da
mesma sessão de caixa*, o que não corrompe caixas já fechados.

Falta o caso real de **devolução com o caixa já fechado**: o cliente devolve a mercadoria
dias depois, quando a sessão de caixa daquela venda já foi encerrada. Não é possível (nem
correto) reabrir e alterar um caixa fechado — o valor precisa sair do caixa de **hoje**.

Ao analisar o schema, encontramos uma lacuna estrutural: **o caixa só sabe somar
entradas**. O valor esperado é `abertura + Σ pagamentos CASH de vendas não canceladas`.
Não existe nenhuma forma de registrar uma **saída de dinheiro** que não seja o estorno
implícito de um cancelamento. Ou seja, "lançar a saída no caixa de hoje" não tinha onde
ser gravado.

## Decisão

1. **Nova tabela `CashMovement`** — movimentações de dinheiro no caixa que **não são
   vendas**: devolução, sangria (retirada), suprimento (reforço) e despesa avulsa. Cada
   registro tem `type` (`INCOME`/`EXPENSE`, reaproveitando `TransactionType`), um `kind`
   (`CashMovementKind`: `RETURN`/`WITHDRAWAL`/`SUPPLY`/`EXPENSE`), `amount`, `reason`,
   `cashSessionId`, `userId` e um `relatedOrderId` opcional (referência solta à venda de
   origem, no estilo de `AuditEvent`, sem FK — a venda pode ser de outra sessão).

2. **O valor esperado do caixa passa a considerar as movimentações**:
   `esperado = abertura + Σ entradas CASH + (Σ INCOME − Σ EXPENSE das movimentações)`.
   A matemática do net vive em `packages/core` (`netCashMovements`), pura e testada.

3. **Novo status `OrderStatus.RETURNED`** — marca a venda devolvida. Bloqueia devolução
   dupla e a distingue no Histórico. **A venda devolvida continua contando como
   faturamento do dia original** (o relatório de vendas só exclui `CANCELLED`), preservando
   o histórico; a devolução aparece como **saída de caixa** no dia em que ocorreu.

4. **Fluxo de devolução (`POST /orders/:id/return`)**, em uma transação atômica:
   - repõe o estoque de cada item (`StockMovement INCOME` reverso + incremento de
     `stockQty`) — reaproveita o motor do cancelamento (ADR-001);
   - lança `CashMovement EXPENSE/RETURN` com o total da venda na **sessão de caixa aberta
     de hoje** (não na original);
   - marca o `Order` como `RETURNED`;
   - registra `AuditEvent RETURN_ORDER` (ADR-004) com o motivo e as sessões envolvidas.
   Exige um caixa aberto (destino da saída). Vendas do **próprio** caixa aberto devem ser
   **canceladas**, não devolvidas.

## Opções Consideradas

### Opção A: Tabela `CashMovement` genérica + status `RETURNED` — **escolhida**

**Prós:** modela corretamente o caixa de um PDV (entradas e saídas além de vendas);
destrava sangria/suprimento/despesa de graça; preserva a venda e o caixa originais;
reaproveita o motor de estorno; a lógica de saldo fica pura e testável no core.
**Contras:** exige migration (tabela nova + enum + política RLS) e ajustar o cálculo do
esperado em dois pontos.

### Opção B: Reverter a venda no caixa original (marcar e recalcular)

**Prós:** não cria tabela nova.
**Contras:** exige alterar um caixa **já fechado** (corrompe o histórico), contrariando a
premissa do fluxo; e não há para onde direcionar a saída de dinheiro real de hoje.
Rejeitada.

### Opção C: "Pedido de devolução" com total negativo

**Prós:** reaproveita a entidade `Order`.
**Contras:** polui os relatórios de vendas (que acabaram de ser entregues) com totais
negativos e exige filtros especiais em toda agregação; mistura conceitos de venda e de
movimento de caixa. Rejeitada.

## Consequências

- **Fica mais fácil:** tratar devoluções sem tocar em caixas fechados; no futuro,
  implementar sangria/suprimento/despesa (a tabela já existe); auditar o dinheiro que
  saiu do caixa e por quê.
- **Fica mais difícil:** o cálculo do esperado agora tem mais um termo (movimentações);
  toda leitura do "esperado" deve passar pelo mesmo caminho para não divergir.
- **Escopo desta fase:** devolução **total** da venda. **Devolução parcial** (itens/quantidades
  específicas com rateio de valor) fica registrada como melhoria futura no ROADMAP.
- **Revisar no futuro:** relatório de **devoluções** (faturamento líquido = bruto − devoluções);
  telas de sangria/suprimento; devolução em outras formas que não dinheiro (estorno de cartão/PIX).

## Action Items

1. [x] Adicionar `OrderStatus.RETURNED`, `CashMovementKind` e o modelo `CashMovement`.
2. [x] Migração `0003_cash_movements_and_return` (tabela + enum + RLS) — **aprovada** (regra 1 do CLAUDE.md).
3. [x] `netCashMovements` no core (com testes) e uso no cálculo do esperado do caixa.
4. [x] `POST /orders/:id/return` (estorno de estoque + saída no caixa de hoje + `RETURN_ORDER`).
5. [x] UI: botão **Devolver** no Histórico para vendas de caixas fechados; linha de saídas no Caixa.
6. [ ] (Futuro) Devolução parcial por item/quantidade.
