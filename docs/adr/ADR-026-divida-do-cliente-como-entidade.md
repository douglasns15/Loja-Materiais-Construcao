# ADR-026: Dívida do cliente como entidade (conta-corrente com código D-0001)

**Status:** Aceito — **implementado e E2E do Owner VALIDADO (2026-08-25)**. Fatias 1 e 2 no ar (migrations `0030` aplicada + backfill). Refino aprovado pelo Owner: **vencimento na DÍVIDA** (Opção A, migration `0031`) — um vencimento por dívida, atualizado a cada venda a prazo que informa uma data. Correção junto: off-by-one de data-only por fuso (`formatDateBr`, formata em UTC).
**Data:** 2026-08-25
**Deciders:** Owner do produto
**Relacionados:** [ADR-019](ADR-019-venda-a-prazo-contas-a-receber.md) (o fiado), [ADR-022](ADR-022-conta-do-cliente-fiado-acumulado.md) (**este ADR SUPERA a decisão 1 dela** — conta implícita → entidade), [ADR-023](ADR-023-numeracao-sequencial-de-vendas.md) (contador sequencial por loja), [ADR-006](ADR-006-devolucao-e-movimentacoes-de-caixa.md) (devolução)

## Contexto

A ADR-022 decidiu (decisão 1) que a **conta do cliente é implícita**: `saldo = Σ recebíveis OPEN − crédito`, sem entidade "comanda". Funcionou para "pega mais e paga no fim", mas a operação real expôs uma confusão:

- Existem **duas visões** que se sobrepõem: **Por cliente** (`accounts` — conta implícita, receber FIFO no total) e **Por venda** (`debts` — recebível a recebível, com a aba **Quitadas**).
- **Não há "receber por item".** Um recebimento parcial na conta é distribuído **FIFO (mais antigo primeiro)** entre os recebíveis. Isso é correto, mas **invisível**: o operador recebe um valor e uma venda inteira some da lista de aberto sem que ele perceba qual.
- **Caso real (Rafael, o Pedreiro — Maria ConstruLar, 2026-08-25):** um recebimento de **R$ 6,50 na conta** quitou integralmente a venda mais antiga (Gesso Lento 1kg, R$ 6,00) e sobrou R$ 0,50 na seguinte. O relato chegou como *"tinha um gesso na dívida e sumiu"*. Nada sumiu — foi pago; mas a **aba Quitadas só existe na visão Por venda**, justamente a que "some" da vista do cliente. A dívida não tinha **identidade** para o operador ancorar o histórico.

O trade-off final da ADR-022 já previa isto: *"se um dia o Owner quiser escolher qual dívida quitar, é uma opção de UI por cima (não muda o schema)"*. A evolução aqui é mais funda que UI: **dar identidade e ciclo de vida à conta**, mantendo o receber-no-total (que é o comportamento desejado), e unificar as duas visões numa só.

## Decisão

### 1. A dívida vira **entidade de primeira classe** com código `D-0001`

Nasce a entidade **`Debt`** (tabela `debts`), com código sequencial por loja **`D-0001`** (padrão do `lastOrderNumber`/`lastQuoteNumber` — ADR-023). Uma dívida agrega **1+ vendas a prazo** do mesmo cliente e é a **unidade de quitação**: recebe-se a **dívida**, não a venda nem o item.

### 2. **Uma dívida ABERTA por cliente** (aprovado pelo Owner)

- Toda venda a prazo entra na **dívida aberta** do cliente; se ele não tiver nenhuma aberta, **abre `D-000X`** (aloca o próximo número atômico no `lastDebtNumber`, dentro da transação da venda — ADR-023).
- A dívida é **OPEN** enquanto houver saldo devedor. Quando o saldo zera (recebimento e/ou devolução), vira **PAID/QUITADA**, ganha `closedAt`, e **arquiva** — as vendas que a compõem passam a aparecer só na aba **Quitadas**.
- A **próxima** compra a prazo do mesmo cliente abre a dívida **seguinte** (`D-000X+1`). Assim cada `D-000X` é um "capítulo" fechado do fiado daquele cliente.

### 3. **Receber** abate o **saldo da dívida** (FIFO interno), com resumo + extrato

O receber continua sendo um **valor único** que abate o **total da dívida**, distribuído FIFO entre as vendas que a compõem (reúso de `distributeAccountPayment` — ADR-022). O que muda é a **apresentação**: a tela da dívida mostra
- **Resumo:** original, recebido, devolvido, **saldo**; e
- **Extrato:** toda a movimentação em ordem — vendas somadas (`+`), recebimentos (`−`), devoluções (`−`) — cada uma com data/autoria.

Regras de caixa/relatório **inalteradas** (ADR-019): `CASH` vira `SUPPLY`; o relatório em regime de caixa conta pelo `paidAt` do recebimento.

### 4. Visão **única: por Cliente/Dívida** com abas **Em aberto / Quitadas**

A tela "Contas a Receber" passa a ter **uma** visão (a dívida do cliente), com abas:
- **Em aberto:** as dívidas `OPEN` (no máximo uma por cliente).
- **Quitadas:** as dívidas `PAID` (histórico) — a aba que hoje só existe na visão Por venda passa a viver aqui.

A visão "Por venda" isolada é **aposentada** (o detalhe da venda continua acessível pelo extrato da dívida e pelo Histórico de Vendas).

## Estrutura de dados — migration `0030` (aditiva + backfill)

Estratégia: **camada de agrupamento sobre o que já existe** (`receivables`/`receivable_payments`/`order_returns` ficam como estão — reúso máximo, relatórios intactos). Segue o padrão *cache + contador* do projeto.

**Coluna nova no `tenants`:**

| Coluna | Tipo | Observação |
|---|---|---|
| `lastDebtNumber` | `Int` default `0` | contador de dívidas por loja (ADR-023); aloca `D-000X` atômico ao abrir dívida |

**Tabela nova `debts`** (a conta-corrente do cliente):

| Campo | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS (ADR-003) |
| `customerId` | uuid | o devedor |
| `debtNumber` | Int | sequencial por loja → exibido `D-0001` (`formatDebtNumber`) |
| `status` | `DebtStatus { OPEN, PAID }` | OPEN enquanto houver saldo; PAID quando zera |
| `openedAt` | DateTime default now | |
| `closedAt` | DateTime? | quando foi quitada |
| autoria (ADR-010) | `createdById/Name` | quem abriu (1ª venda a prazo) |

`@@unique([tenantId, debtNumber])` + `@@index([tenantId, customerId, status])`. **Invariante de aplicação:** no máximo **um** `OPEN` por `(tenantId, customerId)` — garantido pela lógica de venda (não por constraint, para não travar corridas; a venda resolve/cria sob a transação).

**Coluna nova no `receivables`:**

| Coluna | Tipo | Observação |
|---|---|---|
| `debtId` | uuid? (FK → `debts`) | a dívida que agrega esta venda a prazo; nullable só durante o backfill, depois sempre preenchida em vendas novas |

**Novo enum** `DebtStatus { OPEN, PAID }`. Tudo com **RLS por `tenantId`**.

### Backfill (dentro da `0030`, por loja)

Para cada `(tenant, customer)`:
1. **Recebíveis `OPEN`** do cliente → agrupados numa **única `Debt` OPEN** (`openedAt = min(createdAt)` dos recebíveis; `debtNumber` alocado na sequência cronológica da loja).
2. **Cada recebível `PAID`/`CANCELLED`** → uma `Debt` própria já **PAID** (1:1), preservando o histórico como está hoje na aba Quitadas (`closedAt = createdAt` do recebível — aproximação; o `paidAt` real segue nos `receivable_payments`).
3. `receivables.debtId` preenchido conforme o agrupamento; `tenants.lastDebtNumber` = maior `debtNumber` emitido.

Ordenação dos códigos: todas as dívidas a criar são ordenadas por seu `createdAt` representativo **por loja**, então numeradas `D-0001, D-0002…` (histórico coerente). **100% aditiva** — nenhuma tabela existente reescrita; `debtId` nasce nullable e é backfillado na mesma migration.

## Núcleo testável (regra 2 — `packages/core`)

- Reúso de `receivableBalance`, `customerAccountBalance`, `distributeAccountPayment`, `splitReturnValue`, `applyReceivableReturn` (já existem — ADR-022).
- `debtBalance(receivablesDaDivida)` → saldo da dívida (Σ saldos devedores dos recebíveis).
- `debtStatusAfter(saldo)` → `OPEN`/`PAID` (transição ao zerar).
- `formatDebtNumber(n)` → `"D-0001"` (espelha `formatOrderNumber`).
- `resolveOpenDebt(divsAbertas)` / regra "1 aberta por cliente" — pura, testável.

## Fatiamento (entrega incremental)

- **Fatia 1 — Schema + backfill + abrir/ligar dívida.** Migration `0030`; a venda a prazo resolve/cria a dívida aberta e liga o recebível; contador `lastDebtNumber`. Sem mudança visível ainda (a conta implícita continua somando igual).
- **Fatia 2 — Visão única por Cliente/Dívida.** Tela com dívida `D-000X`, resumo + extrato, receber no saldo, abas Em aberto/Quitadas; aposenta a visão Por venda. API: `GET /debts` (lista por status), `GET /debts/:id` (resumo+extrato), receber passa a mirar a dívida (reúso do FIFO).
- **Fatia 3 — Fechamento de ciclo.** Marcar `PAID`/`closedAt` ao zerar (no receber e na devolução); próxima venda a prazo abre a `D` seguinte; devolução numa dívida já quitada → excedente vira crédito (ADR-022, sem reabrir).

## Consequências

- **Reúso máximo:** `receivables`, `receivable_payments`, `order_returns`, o caixa e o relatório **não mudam**. A dívida é uma camada de agrupamento + identidade por cima.
- **Supera a decisão 1 da ADR-022** (conta implícita → entidade `Debt`); as decisões 2–5 (somar item = nova venda, receber FIFO, devolver por item, crédito) **seguem valendo** — a dívida é onde elas se ancoram.
- **Migration `0030`** — 1 enum + 1 coluna em `tenants` + 1 tabela `debts` + 1 coluna FK em `receivables` + backfill + RLS. **Aditiva; aprovar antes de codar (regra 1).**
- **Testável no core** (regra 2): saldo/estado da dívida, formatação do código, resolução da dívida aberta.
- **Trade-off:** "1 dívida aberta por cliente" é simples e previsível, mas não permite (nesta fatia) várias comandas simultâneas do mesmo cliente (ex.: separar por obra). Se o Owner quiser isso no futuro, é uma evolução (dívida nomeada), sem quebrar o modelo.
- **Doc técnica:** a Fatia 2 cria/edita rotas (`/debts`) → atualizar `docs/DOCUMENTACAO-TECNICA.md` §8.2 na mesma mudança (regra 7).
