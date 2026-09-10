# ADR-033: Devolução unificada — condição do item (defeito), forma do estorno e troca

**Status:** Aceito — desenho aprovado pelo Owner (2026-09-09). **Fatias 1, 2 e 3 NO AR** (2026-09-09): migrations `0038`/`0039`/`0040` aplicadas no Supabase; API Version `24ab85d2`; web Version `85eb33b5` (smoke ✅). Commit `7f6d70f` em `main`. **E2E de QA (Claude) executado ponta a ponta em 2026-09-10** (Fatia 1 6/6 ✅; Fatia 2 7 ✅/1 ⚠️; Fatia 3 7 ✅/1 ⏭️; Regressão 4 ✅/1 ⏭️; caixa coerente R$37→R$184,50) — evidência em [`registro-de-testes.md`](../testes/registro-de-testes.md) §"ADR-033 — E2E completo (QA)" e roteiro preenchido em [`e2e-adr033-devolucao-troca.md`](../testes/e2e-adr033-devolucao-troca.md). **Achado não-bloqueante:** "Crédito na loja" inalcançável em venda paga → originou a [ADR-034](ADR-034-cliente-opcional-em-venda.md). **Validação própria do Owner e push pendentes.** **Refino na Fatia 2:** a "forma do estorno" foi modelada como 3ª opção do `ReturnTarget` (`SAME_AS_PAYMENT`) em vez de um campo `refundMethod` separado no `return-items` (o `cancel` usa `refundMethod` no schema/audit). **Decisão de escopo (Fatia 2):** os dois endpoints (`cancel`/`return-items`) foram mantidos com suas semânticas (só a UI unificou) porque os relatórios não subtraem devoluções — fundir tudo inflaria o faturamento (dívida técnica registrada). **Escopo da Fatia 3 (troca):** vale-troca consumido por uma venda nova (parcela `EXCHANGE_CREDIT`, espelha o `STORE_CREDIT`); v1 exige **total da nova venda ≥ vale** (sem "troco" na troca — trade-down fica para depois) e **bloqueia troca de venda a prazo em aberto**; migration `0040` (`ReturnIntent` + `order_returns.intent`/`exchangeOrderId`).
**Data:** 2026-09-09
**Deciders:** Owner do produto
**Relacionados:** [ADR-022](ADR-022-conta-do-cliente-fiado-acumulado.md) (devolução por item + crédito — a base reusada aqui), [ADR-006](ADR-006-devolucao-e-movimentacoes-de-caixa.md) (devolução de venda + movimentações de caixa), [ADR-001](ADR-001-consistencia-de-estoque.md) (consistência de estoque: cache + livro-razão), [ADR-018](ADR-018-caixa-compartilhado-por-loja.md) (caixa por loja), [ADR-020](ADR-020-retirada-entrega-futura.md) (retirada futura — eixo ortogonal), [ADR-010](ADR-010-atribuicao-de-autoria.md) (autoria), [ADR-004](ADR-004-soft-delete-e-auditoria.md) (auditoria seletiva)

> **Decisões de produto já fechadas com o Owner (2026-09-09), antes deste desenho:**
> 1. **Item com defeito** devolvido **não volta ao estoque**; entra numa **lista de defeituosos** (status *Pendente*) e só volta quando **trocado pelo fornecedor** (repõe) ou recebe **baixa/perda**.
> 2. **Troca por outro item** deve ser um fluxo próprio, **integrado ao PDV**: o valor devolvido vira um abatimento na venda do item novo (paga a diferença, ou a sobra vira crédito/dinheiro).
> 3. No **cancelamento/estorno**, **perguntar a forma** de devolução do dinheiro (estorno na mesma forma × dinheiro do caixa); quando for dinheiro, **descontar do caixa** de forma explícita (prática de mercado: *same-tender refund* auditável).
> 4. **Unificar** os botões **"Cancelar venda"** e **"Devolver itens"** da tela de Histórico num **único fluxo**.

## Contexto

Depois do ADR-022, o balcão já **devolve item por item**: estorna estoque, abate a dívida a prazo e, se sobra valor, o excedente vira **crédito na loja** ou **dinheiro no caixa** (escolha do operador). Só que a operação real de uma loja de material de construção tem três exigências que o desenho atual não cobre:

1. **Produto com defeito não pode voltar à prateleira.** Hoje **toda** devolução repõe o estoque vendável (`StockMovement INCOME` + `Product.stockQty += base`). Uma peça devolvida com defeito precisa ficar **separada** — nem some (a loja quer trocar com o fornecedor), nem vira estoque vendável. E precisa ser **buscável** ("o que tenho para acertar com fornecedor?") com um **desfecho**: quando o fornecedor troca, a peça nova **entra** no estoque; quando não dá, é **baixa/perda**.

2. **Devolver ≠ desistir ≠ trocar.** O cliente às vezes **desiste** (quer o dinheiro), às vezes **troca** por outro item. Hoje só existe o caminho de reembolso; a troca é feita "na mão" (uma devolução + uma venda solta), sem netar a diferença nem amarrar as duas pontas.

3. **A forma do estorno do dinheiro está implícita — e às vezes errada.** O caminho `POST /orders/:id/cancel` (a venda inteira, no caixa aberto) **não pergunta nada** e **não lança movimento de caixa**: ele conta com o fato de que o cálculo do esperado **ignora vendas `CANCELLED`** ([`apps/api/src/routes/cashSessions.ts`](../../apps/api/src/routes/cashSessions.ts) — `status: { not: 'CANCELLED' }`). Isso só acerta o caixa **quando a forma da devolução é igual à do pagamento**. Se a venda foi **no cartão** e o troco voltou **em dinheiro** (ou o contrário), o caixa **não bate** — e o operador não tem como registrar a forma correta.

Há ainda um **ativo escondido** que muda o tamanho do problema: o `POST /orders/:id/return-items` (ADR-022) **já é o modelo de estorno explícito** e correto. Ele **não** cancela a venda — mantém o `Order` `CONFIRMED`, incrementa `OrderItem.returnedBaseQty` e, para o dinheiro, lança um **`CashMovement RETURN` explícito** no caixa de hoje. Ou seja: a **inconsistência do ponto 3 vive só no botão "Cancelar" avulso**, não em toda a base. Unificar em cima do `return-items` resolve o ponto 3 de graça e ainda entrega o ponto 4.

## Decisão

### 1. Um único fluxo de "devolver/estornar" no Histórico (ponto 4)

A tela de Histórico passa a ter **um** botão de estorno (**"Devolver / Estornar"**) que abre **um** modal em etapas, construído sobre o motor do `return-items` (ADR-022):

1. **Intenção** — *Devolução/desistência* × **Troca** por outro item (a troca é a Fatia 3).
2. **Itens + quanto** — quantidade a devolver por linha, com a **condição por item** (decisão 2): *Revenda* × *Defeito*.
3. **Dinheiro** — abate a dívida a prazo (quando houver) e, para o que sobra/foi pago, a **forma do estorno** (decisão 3).

**"Cancelar a venda inteira" deixa de ser um caminho próprio** e vira o caso particular de **selecionar todos os itens**. O `return-items`, por não mutar o `Order` nem depender do "ignorar canceladas", já produz o caixa correto (a venda continua contando como entrada e o `RETURN` a compensa) — é o *same-tender refund* explícito que o mercado usa.

> **Nota de status da venda:** quando **tudo** foi devolvido, o `Order` deixa de aparecer como uma venda ativa. Para não reabrir a semântica de `CANCELLED`/`RETURNED` (que carregam regras de caixa próprias), a "venda totalmente devolvida" é **derivada** de `Σ returnedBaseQty == Σ baseQuantity` (cache/consulta), exibida como **"Devolvida"** no Histórico — sem novo status no enum. O `POST /orders/:id/cancel` e o `POST /orders/:id/return` **permanecem** no back para compatibilidade e para o caso **`SCHEDULED`** (liberar reserva do ADR-020, que não é uma devolução de estoque), mas a UI de balcão passa a usar o fluxo unificado.

### 2. Condição do item devolvido: *Revenda* × *Defeito* (ponto 1)

Cada **linha devolvida** ganha uma **condição**:

- **`GOOD` (Revenda):** comportamento atual — `StockMovement INCOME` + `Product.stockQty += base`. Volta a ser vendável.
- **`DEFECTIVE` (Defeito):** **não** toca o estoque vendável. Em vez disso:
  - incrementa um **cache** `Product.defectiveQty += base` (quanto daquele produto está "parado" aguardando acerto);
  - a própria linha `order_return_items` — agora com `condition = DEFECTIVE` e `defectStatus = PENDING` — é o **livro-razão** do defeituoso (fonte de verdade; `defectiveQty` é reconciliável por `Σ baseQty` das linhas `DEFECTIVE`+`PENDING`). Mesmo padrão *cache + ledger* do ADR-001, **sem** poluir o `StockMovement` (que continua sendo só do estoque vendável).

**Ciclo de vida do defeituoso** (nova tela/filtro **"Devolvidos com defeito"**, lista os `PENDING`):

- **Trocado pelo fornecedor → repõe:** a peça nova entra como estoque vendável (`StockMovement INCOME` + `stockQty += base`), `defectiveQty -= base`, a linha vira `defectStatus = RESTOCKED` (com `resolvedAt`/autoria). É aqui que o item "volta ao estoque" — na prática, o **substituto**.
- **Baixa/perda:** `defectiveQty -= base`, linha vira `defectStatus = WRITTEN_OFF`. Nenhum estoque vendável se move; registra a perda para relatório futuro.

Tudo em **transação atômica** (ADR-001) + `AuditEvent` (ADR-004) + autoria (ADR-010). A resolução é **por linha inteira** na v1 (resolver parte de uma linha defeituosa fica como limitação — ver abaixo).

### 3. Forma do estorno explícita e caixa correto (ponto 3)

O modal passa a registrar **como o dinheiro voltou**, em `OrderReturn.refundMethod`:

- **`SAME_AS_PAYMENT` (estorno na mesma forma):** o dinheiro volta pela forma original. Só a **parcela em dinheiro** do pagamento (rateada pelo valor devolvido) **sai do caixa**; PIX/cartão = estorno, **não** toca o caixa.
- **`CASH` (dinheiro do caixa):** o valor devolvido ao cliente sai **em dinheiro**, mesmo que a venda tenha sido no cartão — exige **caixa aberto**.

Regra do caixa (função pura, testável — regra 2):

```
dinheiroQueSaiDoCaixa =
  refundMethod = CASH            → valorDevolvidoAoCliente
  refundMethod = SAME_AS_PAYMENT → parcelaEmDinheiroDoPagamento rateada pelo valor devolvido
```

Quando `dinheiroQueSaiDoCaixa > 0`, lança **um** `CashMovement EXPENSE/RETURN` (reúso do ADR-006/ADR-022), com `reason` explícito. Como o fluxo unificado **não** marca a venda `CANCELLED` (ela segue `CONFIRMED`, apenas com `returnedBaseQty`), **não há contagem dupla**: a entrada da venda permanece e o `RETURN` a compensa — exatamente o modelo já usado pelo `return-items` hoje. O caixa passa a **mostrar** a saída (o Owner pediu "descontar do caixa"), em vez de ela sumir silenciosamente.

> **Convergência com o cancelamento:** o `POST /orders/:id/cancel` legado (que zera a venda via exclusão) **deixa de ser o caminho de balcão**. Se um dia ele for aposentado de vez, o cálculo do esperado que hoje faz `status: { not: 'CANCELLED' }` deve ser revisto **com testes** (regra 2) — mas isso **não** é necessário para esta ADR, porque o fluxo novo não gera `CANCELLED`. Fica registrado como dívida técnica.

### 4. Troca integrada ao PDV (ponto 2)

A **troca** é modelada como **uma transação atômica**: devolver o item A + vender o item B + **netar a diferença**, amarrados pelo mesmo evento. Reúso máximo do PDV e do `return-items`:

- O modal, na intenção **Troca**, registra a devolução gerando um **vale-troca** = valor devolvido `V` (não vira crédito de cliente nem sai no caixa ainda) e **abre o PDV** já com esse abatimento.
- No PDV, o operador monta a venda do item novo. O vale entra como uma linha de pagamento **`EXCHANGE_CREDIT`** (string livre, no mesmo espírito do `STORE_CREDIT` — **não** é dinheiro na gaveta, **não** infla o "recebido" do dia):
  - **total novo > V:** cliente paga a **diferença** (pagamento normal).
  - **total novo < V:** a **sobra** segue a decisão 3 — crédito na loja (com cliente) ou dinheiro no caixa.
- A `OrderReturn` guarda `exchangeOrderId` (a venda que consumiu o vale), fechando o laço para auditoria. Se a venda nova for **abandonada**, a troca **não se efetiva** (atômica): ou o operador conclui, ou cai no fluxo de devolução simples (crédito/dinheiro) como fallback explícito.

Item **defeituoso numa troca** segue a decisão 2 (não repõe; entra na lista de defeituosos) — as duas dimensões são ortogonais.

### 5. Estrutura de dados

O grosso é **aditivo**. Fatiado por migration para aprovar só o necessário de cada etapa (regra 1).

#### 5.1 Migration `0038` — Fatia 1 (condição do item + defeituosos)

**Novos enums:**

- `ReturnItemCondition { GOOD, DEFECTIVE }` — condição da linha devolvida.
- `DefectResolution { PENDING, RESTOCKED, WRITTEN_OFF }` — desfecho do item defeituoso.

**Colunas novas (aditivas, com default — sem reescrita de tabela):**

| Tabela | Coluna | Tipo | Observação |
|---|---|---|---|
| `order_return_items` | `condition` | `ReturnItemCondition` default `GOOD` | Revenda × Defeito; `GOOD` mantém o comportamento atual |
| `order_return_items` | `defectStatus` | `DefectResolution?` | só nas linhas `DEFECTIVE`: `PENDING` → `RESTOCKED`/`WRITTEN_OFF` |
| `order_return_items` | `resolvedAt` | `DateTime?` | quando o defeito foi resolvido |
| `order_return_items` | `resolvedById` / `resolvedByName` | `uuid?` / `varchar(100)?` | autoria da resolução (ADR-010) |
| `products` | `defectiveQty` | `Decimal(12,4)` default `0` | **cache** do que está parado como defeito (reconciliável por Σ das linhas) |

**Snapshot para a lista buscável:** `order_return_items` já referencia `orderItem` (que tem `productId` + `productName` snapshot). A tela de defeituosos junta `order_return_items → order_item → product` (nome, fornecedor atual). Nenhuma coluna de snapshot nova é necessária na v1.

#### 5.2 Migration `0039` — Fatia 2 (forma do estorno)

| Tabela | Coluna | Tipo | Observação |
|---|---|---|---|
| `order_returns` | `refundMethod` | `RefundMethod?` | `SAME_AS_PAYMENT` × `CASH`; null em devoluções antigas |

**Novo enum** `RefundMethod { SAME_AS_PAYMENT, CASH }`. (O destino do **excedente** — crédito × dinheiro — continua no `target ReturnTarget` que já existe; `refundMethod` descreve **como o valor devolvido volta**.)

#### 5.3 Migration `0040` — Fatia 3 (troca)

| Tabela | Coluna | Tipo | Observação |
|---|---|---|---|
| `order_returns` | `intent` | `ReturnIntent` default `REFUND` | `REFUND` × `EXCHANGE` |
| `order_returns` | `exchangeOrderId` | `uuid?` | a venda que consumiu o vale-troca (referência solta, SET NULL) |

**Novo enum** `ReturnIntent { REFUND, EXCHANGE }`. O pagamento `EXCHANGE_CREDIT` é **string livre** no `Payment.method` (como o `STORE_CREDIT`), **sem** enum novo.

Todas as tabelas seguem **RLS por `tenantId`** (ADR-003); nenhuma tabela existente é reescrita (colunas com default). Sem BLOB/base64; tipos leves (regra 6).

### 6. Núcleo testável (regra 2 — funções puras em `packages/core`)

- `cashRefundOfReturn(payments, valorDevolvido, refundMethod)` → quanto **sai em dinheiro** do caixa (a regra da decisão 3; base dos testes de caixa).
- `reconcileDefectiveQty(linhas)` → `defectiveQty = Σ baseQty (DEFECTIVE ∧ PENDING)` (invariante do cache).
- `applyDefectResolution(status, base)` → transição válida `PENDING → RESTOCKED|WRITTEN_OFF` (rejeita resolver duas vezes) + efeito no estoque vendável.
- `splitExchange(valeV, totalNovo)` → `{ consumidoDoVale, diferençaAPagar, sobra }` (o net da troca).
- Reúso do que já existe: `splitReturnValue`, `returnableBaseQty`, `applyItemReturn`, `receivableBalance`, `applyReceivableReturn`.

Os testes de **fechamento de caixa** (regra 2) devem cobrir a matriz forma-do-pagamento × forma-do-estorno para garantir que o esperado bate em todos os casos.

### 7. Fatiamento (entrega incremental)

- **Fatia 1 — Condição do item (defeito): não repor + rastrear + resolver.** Migration `0038`. Estende o `return-items` (e o modal) com condição por item; `DEFECTIVE` não repõe e alimenta `defectiveQty` + o ledger; nova tela **"Devolvidos com defeito"** (lista `PENDING`) + `POST /returns/defective/:id/resolve` (repor/baixa) + `GET /returns/defective`. **Resolve o ponto 1.** Independente e entregável sozinha.
- **Fatia 2 — Unificar a UI + forma do estorno.** Migration `0039`. Colapsa os botões num fluxo único sobre o `return-items`; pergunta `refundMethod`; lança a saída de caixa correta; exibe "Devolvida" para venda 100% devolvida. Core + **Vitest de caixa**. **Resolve os pontos 3 e 4.**
- **Fatia 3 — Troca integrada ao PDV.** Migration `0040`. `intent = EXCHANGE` + vale-troca consumido por uma venda nova (atômica) + `exchangeOrderId`. **Resolve o ponto 2.** A mais pesada.

**Ordem recomendada:** 1 → 2 → 3 (cada uma com valor próprio; o Owner valida por E2E antes da seguinte).

### 8. Impacto no caixa e no relatório

- **Devolução `GOOD` → crédito:** não toca o caixa (ADR-022).
- **Devolução → dinheiro** (`refundMethod = CASH` ou parcela em dinheiro do `SAME_AS_PAYMENT`): `CashMovement RETURN` reduz o caixa de hoje — **explícito e visível** (sem "ignorar canceladas"). A venda segue `CONFIRMED`, então a entrada dela permanece e o `RETURN` a compensa (sem contagem dupla).
- **Defeito:** não afeta caixa nem estoque vendável na entrada; a **reposição** (troca com fornecedor) entra como `INCOME` normal quando resolvida.
- **Vale-troca / `EXCHANGE_CREDIT`:** não é dinheiro na gaveta — abate o valor da venda nova, **não** gera `Payment CASH` (o valor já foi reconhecido na devolução que o originou; evita contagem dupla, igual ao `STORE_CREDIT` da Fatia C do ADR-022).

## Limitações conhecidas (fora do escopo)

- **`SCHEDULED` (ADR-020):** o fluxo unificado é para o que **já saiu do estoque** (imediato/retirado). Cancelar reserva de item ainda não retirado continua no caminho do ADR-020.
- **Resolução parcial de um defeito:** a v1 resolve a **linha inteira** (todo o `baseQty` daquela devolução); repor/baixar só parte de uma linha defeituosa fica para depois.
- **Aposentar o `POST /orders/:id/cancel` legado** e reescrever o cálculo que ignora `CANCELLED`: dívida técnica registrada; não é necessário aqui porque o fluxo novo não gera `CANCELLED`.
- **Offline:** devolver/trocar/resolver defeito são **online-only** (mutação de retaguarda, pode esperar a rede — mesma postura do ADR-022).
- **RMA/garantia formal com o fornecedor** (número de RMA, prazo, frete de troca) fica fora — a lista de defeituosos é o mínimo operacional; um módulo de garantia é evolução futura.

## Consequências

- **Reúso máximo:** o `return-items`, o `CashMovement RETURN`, a autoria e a auditoria entram quase de graça; o `Order` **não** vira mutável; nenhuma invariante de estoque/caixa é violada.
- **Corrige a lacuna do ponto 3** de forma alinhada à prática de mercado (*same-tender refund* explícito) **sem** mexer no cálculo de caixa legado — porque o fluxo novo não passa por `CANCELLED`.
- **Novo conceito auditável** (defeituoso) com cache + ledger, buscável e com desfecho — sem tabela pesada nem BLOB.
- **Três migrations aditivas** (`0038`/`0039`/`0040`), uma por fatia, **aprovar antes de codar** (regra 1). A Fatia 1 depende só da `0038`.
- **Testável no core** (regra 2): regra do caixa por forma de estorno, reconciliação do defeito, transições de resolução e o net da troca.
- **Trade-off da unificação:** um fluxo mais rico exige um modal em etapas (mais lógica de UI), mas elimina três botões com regras divergentes — menos superfície de erro e menos cliques (princípio do `CLAUDE.md`).
