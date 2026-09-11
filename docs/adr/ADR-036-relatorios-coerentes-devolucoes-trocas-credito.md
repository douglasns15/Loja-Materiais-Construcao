# ADR-036: Relatórios coerentes com devoluções, trocas e crédito + card do Histórico refletindo o desfecho

**Status:** Aceito — **NO AR + E2E do Owner VALIDADO** (2026-09-10; API `61a14ce6`, web deployado). Blocos de card (A/B/C) validados na tela; relatórios (D/E/F) validados por reconstrução dos dados reais da Loja Demo (bateu com o esperado). Sem migration. Push do Owner pendente.
**Data:** 2026-09-10
**Deciders:** Owner do produto
**Relacionados:** [ADR-035](ADR-035-credito-no-retorno-pick-cliente-e-faturamento-liquido.md) (faturamento líquido — **origem**: achados do E2E), [ADR-033](ADR-033-devolucao-unificada-defeito-estorno-troca.md) (devolução/cancelamento/troca), [ADR-022](ADR-022-conta-do-cliente-fiado-acumulado.md) (crédito da loja), [ADR-019](ADR-019-venda-a-prazo-contas-a-receber.md) (fiado / Recebido regime de caixa), [ADR-027](ADR-027-custo-congelado-na-venda.md) (base de custo/lucro), [plano Relatórios v2](../plano-relatorios-v2.md)

## Contexto

No E2E da ADR-035 (2026-09-10, loja Demo, owner), todos os fluxos centrais passaram, mas o Owner apontou incoerências entre o que aconteceu na venda e o que os relatórios e o card do Histórico mostram:

- **Card do Histórico não reflete devolução/troca** (Blocos A, B, D, F): uma venda com itens devolvidos continua com o valor e o status originais; uma venda totalmente trocada não referencia a venda gerada na troca.
- **Venda a prazo devolvida ainda conta no faturamento** (Bloco F): uma venda **totalmente devolvida** deveria sair do faturamento como as canceladas. Além disso, o líquido da ADR-035 subtrai do **Recebido** (regime de caixa), o que é **impreciso para fiado** — o valor a prazo nunca entrou como dinheiro.
- **Recebido conta crédito/vale como dinheiro** (Bloco E, descoberto na análise): as parcelas `STORE_CREDIT` (crédito da loja) e `EXCHANGE_CREDIT` (vale-troca) são gravadas como `Payment` e **somadas ao Recebido** — inflando o "Recebido" e fazendo a **troca contar 2×** (a venda de origem + a nova venda com o vale).
- **Trocas invisíveis** (Bloco E): não há indicação de quantas trocas houve no período.

### Fatos do código (verificados)

- `apps/api/src/routes/orders.ts` (`return-items`): a devolução por item **mantém** `order.status = CONFIRMED` (nunca marca `RETURNED`), mesmo quando devolve tudo. O enum `OrderStatus` **já tem** `RETURNED` (usado pelo `/return` antigo e reconhecido pelo `ReturnItemsModal`).
- `apps/api/src/routes/reports.ts` (`computeSalesData`): `totalRevenue` vem de `payment.groupBy` **sem filtro de método** (conta `STORE_CREDIT`/`EXCHANGE_CREDIT`); `goodsRevenue`/`salesAgg`/`cancelledCount` filtram por `status <> CANCELLED` (portanto **contam** `RETURNED`); `returnsTotal` (ADR-035) soma **todas** as devoluções REFUND (total + parcial) e o líquido subtrai isso do `totalRevenue`.
- `GET /orders?scope=all`: inclui `items` (com `returnedBaseQty`/`baseQuantity`/`total`), mas **não** um resumo de devoluções/troca por venda; a troca grava `OrderReturn.exchangeOrderId` (elo com a nova venda), não exposto na lista.
- `packages/shared/src/report.ts`: `SalesReport` tem `totalRevenue`, `returnsTotal`, `netRevenue`, `cancelledCount`, etc.

## Decisão

### A. Venda devolvida por inteiro sai do faturamento (status `RETURNED`)

Quando uma devolução **REFUND** deixa a venda **totalmente devolvida** (todos os itens com `returnedBaseQty ≥ baseQuantity`), o `return-items` passa a marcar `order.status = 'RETURNED'` (na mesma transação). Os relatórios passam a **excluir `RETURNED`** do faturamento, exatamente como já fazem com `CANCELLED` — em `totalRevenue`, `goodsRevenue` e `salesCount`. Resultado: a venda totalmente devolvida (inclusive fiado) **some do faturamento** na raiz, sem depender de subtração no líquido. A **troca (EXCHANGE) NÃO** marca `RETURNED` (o dinheiro da venda de origem foi real; a coerência da troca vem da Decisão C).

### B. Faturamento líquido subtrai só as devoluções PARCIAIS

Como as devoluções **totais** saem do faturamento pela Decisão A, o `returnsTotal` (linha "Devoluções" / base do líquido) passa a somar só as **devoluções parciais** (REFUND de vendas que continuam `CONFIRMED`). O líquido = `Recebido − devoluções parciais`, sem dupla remoção.

### C. "Recebido" conta só dinheiro real (crédito/vale fora)

O `payment.groupBy` do `totalRevenue`/`byPaymentMethod` passa a **excluir** os métodos `STORE_CREDIT` e `EXCHANGE_CREDIT` (não são dinheiro que entrou — são liquidação de crédito / uso de vale). Corrige a **troca contando 2×** e a inflação do Recebido pelo crédito da loja. Os recebimentos de fiado (`ReceivablePayment`) continuam entrando (isso é dinheiro real).

### D. Contadores de Trocas e Devolvidas no período

Os relatórios ganham `exchangeCount` (nº de `OrderReturn` intent `EXCHANGE` no período) e `returnedCount` (nº de vendas `RETURNED` no período), exibidos ao lado de "Canceladas". Dá visibilidade ao que hoje é invisível.

### E. Card do Histórico reflete o desfecho

A lista `GET /orders?scope=all` passa a expor, por venda, um resumo: `returnedValue` (Σ REFUND), `exchangedValue` (Σ EXCHANGE) e `exchangedTo` (nº das vendas geradas na troca, resolvendo `exchangeOrderId`). O card:

- `CANCELLED` → **"Cancelada"** (como hoje).
- `RETURNED` → **"Devolvida"** (valor riscado; ações escondidas, como a cancelada).
- `CONFIRMED` com `exchangedValue > 0` → **"Trocada → V-000XXX"** (referência à nova venda).
- `CONFIRMED` com `returnedValue > 0` → **"Confirmada"** (verde) + selo **"Devolução parcial"** + valor ajustado (original − devolvido).
- senão → como hoje.

## Alternativas consideradas

1. **Marcar `RETURNED` + excluir do faturamento + Recebido só dinheiro (RECOMENDADA — esta decisão).** Conserta Bloco F na raiz, corrige a troca 2× e o crédito inflando. **Contra:** muda números históricos (para o correto) e exige expor resumo na lista.
2. **Manter tudo no bruto e só subtrair no líquido (ADR-035 atual).** Rejeitada: o fiado devolvido fica impreciso no Recebido (subtrai valor que nunca entrou) e a troca continua contando 2×.
3. **Não contar crédito/vale como Recebido só no futuro.** Rejeitada pelo Owner: quer o Recebido correto agora.

## Guardas / invariantes

- **Estoque (ADR-001) intacto** — `RETURNED` é só status do pedido; o estorno de estoque já aconteceu no `return-items`.
- **Transação atômica** — marcar `RETURNED` entra na mesma transação da devolução.
- **Custo-zero (regra 6)** — sem tabela/coluna nova; `RETURNED` já existe no enum `OrderStatus` (**sem migration**). Agregações no banco.
- **Idempotência** — venda `RETURNED` não aceita nova devolução (guarda `status !== CONFIRMED` já existente).
- **Retroatividade** — a exclusão de `RETURNED`/crédito e a contagem valem para o histórico (números passados ficam corretos) — aceito pelo Owner (ADR-035, decisão análoga).
- **Doc §8.2 (regra 7)** — atualizar o contrato de `GET /orders` (novo resumo por venda) e a nota do `return-items` (marca `RETURNED` no total).

## Escopo (fatia única)

- `packages/db`: **sem migration** (enum `RETURNED` já existe).
- `apps/api`: `orders.ts` (`return-items` marca `RETURNED` no total REFUND; `GET /orders` expõe o resumo) + `reports.ts` (exclui `RETURNED`; exclui `STORE_CREDIT`/`EXCHANGE_CREDIT` do Recebido; `returnsTotal` parcial-only; `exchangeCount`/`returnedCount`) + doc §8.2.
- `packages/shared`: `SalesReport`/`SalesComparison` += `exchangeCount`, `returnedCount`; tipo da linha de venda += `returnedValue`/`exchangedValue`/`exchangedTo`.
- `packages/core`: `isOrderFullyReturned(items)` (função pura) + testes (regra 2).
- `apps/web`: `vendas/page.tsx` (badges + valor ajustado) + `relatorios/page.tsx` (Trocas/Devolvidas + rótulos).

## Consequências

- **Faturamento honesto:** venda totalmente devolvida (inclusive fiado) sai do bruto; Recebido reflete só dinheiro real; troca deixa de contar 2×.
- **Histórico legível:** cada venda mostra seu desfecho (Cancelada/Devolvida/Trocada/Devolução parcial) e o valor ajustado.
- **Números históricos mudam** (para o correto) — esperado.
- **Limite honesto:** devoluções **parciais** de vendas fiado ainda subtraem do Recebido pelo valor devolvido (imprecisão menor de regime de caixa); aceitável na v1 (o caso grande — devolução total — foi resolvido na raiz).
- **Lucro/margem (ADR-027):** esta ADR **não** altera a base de lucro (goodsRevenue do lucro) além de excluir `RETURNED`; devoluções parciais no cálculo de margem ficam para um passo futuro se necessário.

## Próximos passos

> **Status:** Aceito (Owner aprovou as 3 decisões no E2E). Implementar a fatia única acima; gates de sempre (core+testes, tsc, build); deploy API+web; E2E do Owner; push. Sem migration.
