# ADR-035: Crédito no retorno com cliente escolhido no ato (pick-no-retorno) + passo de intenção explícito (botão único "Cancelar / Devolver") + faturamento líquido de devoluções

**Status:** Aceito — **NO AR + E2E do Owner VALIDADO** (2026-09-10; API `adc7c14c`, web deployado). Os fluxos centrais passaram; os achados de relatório/histórico do E2E originaram a [ADR-036](ADR-036-relatorios-coerentes-devolucoes-trocas-credito.md) (implementada). Sem migration. Push do Owner pendente.
**Data:** 2026-09-10
**Deciders:** Owner do produto
**Relacionados:** [ADR-034](ADR-034-cliente-opcional-em-venda.md) (cliente opcional na venda — *attach-na-venda*; esta ADR é o complemento **pick-no-retorno** que aquela deixou fora do escopo v1), [ADR-033](ADR-033-devolucao-unificada-defeito-estorno-troca.md) (devolução unificada — cancelamento × devolução por item, forma do estorno; **origem** dos dois achados), [ADR-022](ADR-022-conta-do-cliente-fiado-acumulado.md) (crédito da loja / `creditBalance`), [ADR-026](ADR-026-divida-do-cliente-como-entidade.md) (dívida do cliente), [ADR-001](ADR-001-consistencia-de-estoque.md) (estoque = movimento + cache), [plano Relatórios v2](../plano-relatorios-v2.md) (base de custo/faturamento)

## Contexto

Na sessão de validação da ADR-034 (2026-09-10), a evidência confirmou que **uma venda paga de balcão já pode carregar cliente** (venda `V-000112`, paga em **Dinheiro**, com **Cliente: Silas** — impossível antes da ADR-034). Mas a validação expôs dois pontos do Owner que a ADR-034 **não** cobre:

### Achado 1 — o cliente precisa poder ser escolhido **no ato da devolução**

O caso real do balcão é a **venda anônima**: na hora de vender, não dá para prever que haverá devolução, nem qual será o desfecho (reembolso? crédito? troca?). Condicionar "Crédito na loja" a ter anexado o cliente **na venda** (ADR-034) cobre só quem já se identificou (fiado, entrega, cliente recorrente). Para o fluxo comum, o cliente precisa poder ser **selecionado ou cadastrado no momento em que se escolhe "Crédito na loja"** no modal de devolução.

> Palavras do Owner: *"quando fazemos uma venda, não temos como adivinhar que o cliente vai devolver algo e qual será o desfecho… o caminho mais comum é venda sem cliente registrado. O cliente deve ser possível inserir também no momento em que clicamos em Devolver/Estornar, se for escolhido crédito na loja."*

### Achado 2 — crédito também na devolução **total**

Hoje a devolução **total** na mesma sessão cai no **cancelamento** (ADR-033), que oferece só **Estorno / Dinheiro** — nunca "Crédito na loja" (`ReturnItemsModal.tsx:156` — *"cancelamento não vira crédito"*). O Owner quer que, numa devolução total, o cliente **também** possa deixar o valor como crédito. O cancelamento **apaga a venda do faturamento**, mas **mantém o registro no histórico** (requisito confirmado pelo Owner).

### Decisão colateral do Owner — resolver o faturamento líquido **agora**

A ADR-033 registrou como **dívida técnica** que os relatórios calculam faturamento de vendas `CONFIRMED` e **não subtraem devoluções**. O Owner decidiu **resolver isso nesta ADR**, não deixar para depois.

### Fatos do código (verificados nesta branch)

- **Roteamento cancelar × devolver** (`apps/web/components/ReturnItemsModal.tsx:152-158`): `useCancelPath = intent==='REFUND' && mesma sessão && sem devolução anterior && devolução total`; nesse caminho os destinos são só `['SAME_AS_PAYMENT','CASH']`; senão `['STORE_CREDIT','SAME_AS_PAYMENT','CASH']`. `:428` **desabilita** `STORE_CREDIT` quando `!hasCustomer`.
- **`hasCustomer`** vem de `vendas/page.tsx:1017` → `!!returnOrder.customerId` (a lista `GET /orders` já devolve `customerId` por `include`, scalar).
- **Handler de devolução** (`apps/api/src/routes/orders.ts`): lê `const customerId = order.customerId` (`:1483`), **recusa** `STORE_CREDIT` sem cliente (`:1489`), credita o `creditBalance` **só se o pedido já tem cliente** (`:1604`). Ou seja, hoje o cliente do crédito sai **exclusivamente do pedido**.
- **Contrato de entrada** (`packages/shared/src/return.ts:24` — `createReturnSchema`): tem `items`, `reason`, `target`, `intent`. **Não** aceita `customerId`.
- **Relatórios** (`apps/api/src/routes/reports.ts`): faturamento agregado de `payments._sum.amount` (por forma) e `SUM(oi.total)` de vendas `CONFIRMED`; `CANCELLED` fora; **`OrderReturn` não é subtraído** de nada.
- **Cancelamento**: remove a venda do faturamento (a venda deixa de ser `CONFIRMED`), mas o registro permanece consultável no histórico.

## Decisão

Três mudanças que, juntas, tornam "Crédito na loja" um destino de primeira classe em **qualquer** devolução e mantêm os relatórios honestos.

### A. Pick-no-retorno — escolher/cadastrar o cliente no ato do crédito

No modal **"Devolver / Estornar"**, quando o destino escolhido é **"Crédito na loja"** e a venda **não tem cliente**, exibir **inline** um seletor **selecionar/cadastrar cliente** (reuso do mesmo componente de busca+cadastro do PDV — `renderCustomerPicker`/modal de cliente). O cliente escolhido é:

1. **Anexado à venda** (`order.customerId`, se hoje é `null`) na **mesma transação** — de brinde, a venda ganha histórico retroativo; e
2. **Creditado** no `creditBalance` (ADR-022), como o crédito já funciona quando o pedido tinha cliente.

**Contrato:** `createReturnSchema` ganha `customerId?` (uuid). O servidor: valida que é cliente do tenant; se `order.customerId` é `null`, seta com esse `customerId` (senão, ignora o parâmetro e usa o do pedido — o pedido manda); credita. Guarda: `STORE_CREDIT` sem cliente **nem** no pedido **nem** no parâmetro continua recusado (`:1489`). Atualizar `docs/DOCUMENTACAO-TECNICA.md` §8.2 (regra 7).

### B. Passo de intenção explícito — um botão, três caminhos

O modal deixa de **inferir** o cancelamento pela completude da devolução (hoje: total + mesma sessão ⇒ cancela). O operador passa a **declarar a intenção** no topo (estende o passo "O que o cliente quer?" da ADR-033 F3). Botão único no Histórico, rotulado **"Cancelar / Devolver"** (cancelar primeiro — é o primeiro pensamento de quem errou), abre o motor com três caminhos:

1. **Cliente devolveu / desistiu** — escolhe os itens (**parcial ou total**) e o **destino do valor**: estorno na mesma forma · dinheiro do caixa · **crédito na loja** (com o pick-no-retorno da Decisão A). A **venda é mantida** (`CONFIRMED`) no histórico; o `OrderReturn` é registrado; a Fatia C corrige o faturamento. É a futura **"nota de devolução"** (nota de entrada).
2. **Cliente quer trocar** — troca via vale-troca (ADR-033 F3, já existe; sem mudança).
3. **Venda feita errada — cancelar** — **desfaz** a venda (sai do faturamento), devolvendo o dinheiro como entrou (estorno/dinheiro). **Sem "crédito na loja"** (foi erro de operação, não devolução) e **sem troca**. Disponível só quando dá para desfazer limpo (**mesma sessão de caixa, sem devolução anterior**). É a futura **"nota de cancelamento"**.

**Por que separar por intenção (e não por completude):** resolve o crédito na devolução total **sem ambiguidade** — o crédito mora no caminho 1 (mesmo quando a devolução é total); "desfazer por erro" mora no caminho 3. O operador **escolhe**; o sistema não adivinha. E deixa o fluxo **fiscal-ready**: caminho 1 = nota de devolução, caminho 3 = nota de cancelamento — a distinção que a NF-e exige. **Cancelamento e devolução permanecem operações distintas** (requisito do Owner, ótica NF-e), com **uma única porta de entrada** — sem reabrir a dualidade de botões que a ADR-033 removeu.

### C. Faturamento líquido de devoluções

Os relatórios passam a **subtrair as devoluções** do faturamento do período: **faturamento líquido = bruto − valor devolvido** (`OrderReturn`), **independentemente da forma do estorno** (dinheiro, estorno na mesma forma ou crédito) — porque a **mercadoria voltou**, e é isso que reduz a receita. A subtração é agregada **no banco** (cost-zero, sem tabela nova), somando os `OrderReturn`/itens devolvidos do período e descontando do bruto. Apresentação (bruto+líquido × só líquido) fica na decisão pendente #1.

## Alternativas consideradas

1. **Pick-no-retorno + crédito em total + faturamento líquido (RECOMENDADA — esta decisão).** Cobre o fluxo real (venda anônima), dá crédito com lastro em qualquer devolução e mantém os relatórios honestos. **Contras:** mexe em contrato (`createReturnSchema`), em roteamento do modal e nos relatórios — exige cuidado transacional e de agregação.
2. **Só *attach-na-venda* (ADR-034).** Rejeitada como principal pelo Owner: não cobre a venda anônima, que é o caso comum.
3. **Crédito no cancelamento apagando a venda.** Rejeitada: gera crédito **sem lastro** de venda (a venda sumiu do faturamento) — incoerente com o `creditBalance` e com o histórico.
4. **Não subtrair devoluções (status quo).** Rejeitada pelo Owner: os relatórios "mentem" (faturamento inflado por devoluções).
5. **Inferir o cancelamento pela completude (status quo ADR-033: total + mesma sessão ⇒ cancela).** Rejeitada: adivinha a intenção e não distingue "cliente devolveu tudo e quer crédito" de "operador errou e quer desfazer para refazer". Substituída pelo **passo de intenção explícito** (Decisão B), que ainda deixa o fluxo fiscal-ready (nota de devolução × nota de cancelamento).

## Guardas / invariantes

- **Estoque (ADR-001) intacto:** GOOD volta ao estoque; DEFECTIVE vira defeituoso rastreado (ADR-033). O crédito muda o **destino do valor**, não a mecânica de estoque.
- **Transação atômica:** anexar cliente + registrar devolução + creditar `creditBalance` + movimentos de estoque num só `prisma.$transaction`.
- **Crédito exige cliente:** agora escolhível no ato; sem cliente (nem no pedido nem no parâmetro), `STORE_CREDIT` segue recusado.
- **Idempotência/corrida:** trava contra creditar/anexar 2× (padrão ADR-033 — `exchangeOrderId`, `returnedBaseQty`).
- **Custo-zero (regra 6):** só `customerId` (FK já existente) + `OrderReturn` (já existe). Subtração do faturamento agregada no banco. **Sem BLOB, sem tabela nova.**
- **Migration:** **nenhuma prevista** — `Order.customerId` já é `String?`, `OrderReturn` já registra o valor devolvido. (A confirmar na implementação; se algum campo faltar, volta à regra 1 com aprovação.)

## Escopo (fatias propostas)

- **Fatia 1 — Pick-no-retorno + passo de intenção explícito (A + B):**
  - `packages/shared`: `createReturnSchema += customerId?` (uuid, opcional).
  - `apps/api` (`orders.ts` return handler): aceitar `customerId`, anexar ao pedido se `null`, creditar. O caminho de crédito usa a semântica de **devolução** (venda mantida `CONFIRMED`); o **cancelamento** (caminho 3) segue sua semântica atual (desfaz), disponível só quando elegível (mesma sessão, sem devolução anterior). Doc §8.2 (regra 7).
  - `apps/web` (`ReturnItemsModal` + `vendas/page.tsx`): botão único renomeado **"Cancelar / Devolver"**; passo de intenção de **3 caminhos** (Devolveu/desistiu · Trocar · Cancelar por erro); **"Crédito na loja" disponível também na devolução total** (caminho 1); seletor/cadastro de cliente inline quando crédito + sem cliente; enviar `customerId`.
  - Testes (regra 2): funções puras de valor/abatimento/caixa afetadas em `packages/core` (o crédito não toca o caixa; dinheiro/estorno sim).
- **Fatia 2 — Faturamento líquido de devoluções (C):**
  - `apps/api` (`reports.ts`): subtrair `OrderReturn` do período do faturamento (bruto → líquido); ajustar `/sales`, ranking de produtos e composição por forma conforme a decisão #1.
  - `apps/web` (Relatórios): exibir bruto/líquido conforme a decisão #1.
  - Testes (regra 2): agregação bruto−devolvido em `packages/core` quando houver função pura.

## Consequências

- **"Crédito na loja" vira destino de primeira classe** em qualquer devolução, com cliente definido no ato — cobre o fluxo real do balcão (venda anônima).
- **Crédito sempre com lastro:** ao rotear o crédito pela devolução (não pelo cancelamento), a venda permanece no histórico e no faturamento, e a devolução o corrige — coerente com a Fatia C.
- **Relatórios honestos:** faturamento líquido reflete as devoluções — remove a dívida técnica da ADR-033.
- **Retroatividade dos relatórios:** a subtração vale para **todas** as devoluções do período (é só cálculo) — números históricos podem mudar (para melhor: ficam corretos). A confirmar na decisão #6.
- **Regra 4/7:** alteração de fluxo UI↔API + mudança de contrato (`createReturnSchema`) + relatórios ⇒ **exige esta ADR aprovada antes de codar** e atualização da doc §8.2 na mesma mudança.

## Próximos passos

> **Status atual:** ADR **Aceito e IMPLEMENTADA (Fatias 1+2)**; gates verdes (core 367/367, tsc shared/api/web 0, next build OK). **Sem migration.** Falta **deploy (API + web) + E2E do Owner + push**.

O que foi implementado:

1. **Fatia 1 (A+B):**
   - `packages/shared/src/return.ts`: `createReturnSchema += customerId?` (uuid opcional).
   - `apps/api/src/routes/orders.ts` (`return-items`): aceita `customerId`; `willAttachCustomer`/`effectiveCustomerId`; valida o cliente do tenant, ANEXA à venda (`order.update`) e credita `effectiveCustomerId` na mesma transação; `OrderReturn.customerId` = efetivo; auditoria `attachedCustomerId`. Doc §8.2 atualizada.
   - `apps/web/components/ReturnItemsModal.tsx`: reescrito — botão/título **"Cancelar / Devolver"**, passo de intenção de **3 caminhos** (`Intent = REFUND|EXCHANGE|CANCEL`), CANCEL só quando `canCancel` (mesma sessão + sem devolução anterior), "Crédito na loja" disponível na devolução total, **pick-no-retorno** (busca `/customers?q=` + `CustomerQuickAddModal`, fora do backdrop). `apps/web/app/(app)/vendas/page.tsx`: rótulo do botão → "Cancelar / Devolver".
2. **Fatia 2 (C):**
   - `packages/core`: `calcNetRevenue(gross, returns)` (+ 5 testes).
   - `apps/api/src/routes/reports.ts` (`computeSalesData`): agrega `OrderReturn` (intent REFUND) do período → `returnsTotal` + `netRevenue` (via `calcNetRevenue`), no atual e no `previous`.
   - `packages/shared/src/report.ts`: `SalesReport`/`SalesComparison` += `returnsTotal`, `netRevenue`.
   - `apps/web/app/(app)/relatorios/page.tsx`: card "Recebido" mostra **Devoluções** e **Líquido** (destaque) quando há devolução; CSV += linhas.
3. **Validação (pendente — Owner):** E2E — venda paga anônima → "Cancelar / Devolver" → caminho 1 → "Crédito na loja" → seleciona/cadastra cliente → credita; relatório com bruto/líquido; e caminho 3 (cancelar por erro). Registrar em `docs/testes/registro-de-testes.md`.

## Decisões do Owner (aprovadas em 2026-09-10)

| # | Decisão | Resolução |
|---|---------|-----------|
| 1 | **Relatórios:** bruto E líquido ou só líquido? | ✅ **Bruto E líquido** (líquido em destaque + linha de devoluções). |
| 2 | **Anexar o cliente à venda** no ato do crédito, ou só creditar? | ✅ **Anexar** à venda (`order.customerId`) — histórico/garantia retroativos. |
| 3 | **Crédito na loja em venda paga em cartão/PIX** também? | ✅ **Sim** — a mercadoria voltou; crédito não toca o caixa. |
| 4 | **Ordem das fatias:** juntas ou 1 depois 2? | ✅ **As duas juntas** nesta rodada. |
| 5 | **Cancelamento × devolução:** unificar ou manter distintos? | ✅ **Distintos** (ótica NF-e: nota de cancelamento × nota de devolução), com **um botão único** "Cancelar / Devolver" e **passo de intenção de 3 caminhos** (Devolveu/desistiu · Trocar · Cancelar por erro). O cancelamento (caminho 3) desfaz a venda; sem crédito. |
| 6 | **Retroatividade dos relatórios:** subtrair devoluções passadas? | ✅ **Sim** — é só cálculo; deixa os números corretos. |

> **Nota de rumo (NF-e):** os caminhos 1 e 3 do passo de intenção mapeiam, no futuro épico de NF-e, para **nota de devolução** (entrada) e **nota de cancelamento** (com janela de tempo e regras próprias). Esta ADR já deixa o fluxo operacional alinhado a essa distinção fiscal.
