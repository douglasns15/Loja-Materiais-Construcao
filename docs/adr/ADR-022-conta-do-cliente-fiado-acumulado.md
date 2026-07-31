# ADR-022: Conta do Cliente (fiado acumulado — adicionar, receber e devolver itens)

**Status:** Aceito (Owner aprovou o desenho e a migration da Fatia B em 2026-07-31; ordem A → B → C)

> **Nota de numeração (2026-07-31):** um refino da Fatia A — **observação da dívida por cliente**,
> separada da nota do cadastro (`Customer.notes`) — consumiu a migration **`0018_customer_debt_notes`**
> (1 coluna aditiva `customers.debtNotes VARCHAR(500)`, aplicada, sem drift). Logo, **a migration da
> Fatia B passa a ser `0019`** (referências a "0018" nas seções 6/8/Consequências devem ser lidas como
> `0019`).
**Data:** 2026-07-31
**Deciders:** Owner do produto
**Relacionados:** [ADR-019](ADR-019-venda-a-prazo-contas-a-receber.md) (o fiado), [ADR-006](ADR-006-devolucao-e-movimentacoes-de-caixa.md) (devolução + movimentações de caixa), [ADR-001](ADR-001-consistencia-de-estoque.md) (consistência de estoque), [ADR-020](ADR-020-retirada-entrega-futura.md) (retirada futura — eixo ortogonal)

> **Decisões de produto já fechadas com o Owner (2026-07-31), antes deste desenho:**
> 1. **Adicionar itens** a uma conta a prazo aberta = **nova venda a prazo que soma na conta** (o `Order` original **não** é editado).
> 2. A **conta do cliente é implícita**: `saldo = Σ recebíveis em aberto − crédito a favor`. Não há "abrir/fechar comanda".
> 3. Na **devolução**, o operador **escolhe na hora** se o valor que sobra vira **crédito na loja** ou **devolução em dinheiro** pelo caixa.

## Contexto

Depois do ADR-019, o balcão já vende a prazo e gera uma **conta a receber** por venda. Mas o
uso real do fiado em material de construção é uma **conta corrente**: o mesmo cliente volta
várias vezes, **pega mais itens** (que somam à conta), às vezes **devolve ou troca** algo que
já levou, e **paga tudo no final**.

Hoje isso trava por três motivos estruturais — e **é proposital**, não é falta de tela:

1. **O `Order` é um evento de venda imutável.** Ao fechar a venda ele já baixou estoque via
   `StockMovement` (a *fonte de verdade auditável* — ADR-001), imprimiu comprovante e virou
   histórico. **Editar itens depois** (adicionar/remover linhas) corromperia a auditoria de
   estoque e o comprovante já emitido.
2. **O `Receivable` é 1:1 com o `Order`** (`orderId` único). Uma dívida = uma venda; não há
   noção de "conta" que junte várias vendas do mesmo cliente.
3. **A devolução (ADR-006) é da venda inteira e devolve dinheiro no caixa** (`CashMovement
   EXPENSE/RETURN`). Se a venda foi *a prazo e não paga*, **não há dinheiro a devolver** — o
   correto seria abater a dívida. O próprio ADR-019 já registra isso como limitação em aberto:
   *"devolver venda a prazo com recebimento é caso de estorno, fora do escopo"*.

Este ADR resolve os três **sem violar nenhuma invariante**: nada é editado retroativamente;
cada movimento de estoque continua sendo um evento próprio e auditável.

## Decisão

### 1. A conta do cliente é **implícita** (sem entidade nova de "comanda")

Não existe objeto "Conta" com abrir/fechar. A conta é uma **visão agregada** por cliente:

```
saldo da conta = Σ (saldo devedor dos recebíveis OPEN do cliente) − creditBalance do cliente
saldo devedor de um recebível = originalAmount − settledAmount − returnedAmount
```

Enquanto houver recebível `OPEN`, a conta existe. Isso já conversa com o selo **"Dívida
ativa"** que o perfil do cliente mostra hoje. Custo de schema do **agrupamento**: zero.

### 2. **Pegar mais itens** = nova venda a prazo que soma na conta (reúso total do ADR-019)

Cada ida ao balcão é uma **venda a prazo normal** para o mesmo cliente: baixa estoque, imprime
o comprovante **daquele lote** e cria mais um `Receivable`. O saldo da conta é a soma dos
recebíveis em aberto. **Nada muda no motor de venda** — é o PDV a prazo que já existe.

### 3. **Receber** = recebimento contra a **conta inteira** (FIFO), não recebível a recebível

Novo caminho "receber da conta do cliente": um valor único é distribuído entre os recebíveis
`OPEN` do cliente **do mais antigo para o mais novo** (FIFO), gerando um `ReceivablePayment`
por recebível tocado, até esgotar o valor. Regras herdadas do ADR-019:

- `amount ≤ saldo total da conta`; parcial é o padrão (abate quanto der).
- Se `method = CASH`: exige **caixa aberto** e lança **um** `CashMovement SUPPLY` no caixa de
  hoje pelo total recebido (reúso da CX.Movimentacao), com `reason = "Recebimento de conta —
  <cliente>"`. Não-dinheiro (PIX/cartão) não toca o caixa.
- `paidAt` de cada `ReceivablePayment` é o dia do recebimento (o relatório em regime de caixa
  do ADR-019 continua valendo, sem mudança).

O endpoint por recebível (`POST /receivables/:id/receive`, ADR-019) **continua existindo** —
o de conta é uma camada FIFO por cima dele.

### 4. **Devolver um item** = devolução **parcial, por item**, que **abate a dívida** (com escolha crédito/dinheiro)

Substitui a limitação do ADR-019 e estende a devolução do ADR-006 (que hoje é só da venda
inteira). O operador seleciona **item(ns) e quantidade** de uma venda e confirma a devolução.
Em **transação atômica** (ADR-001), para o valor devolvido `V` (soma do valor dos itens
devolvidos):

1. **Estoque volta**: `StockMovement INCOME` por item devolvido (motor de estorno do ADR-006,
   já existe) + incremento de `Product.stockQty`; incrementa `OrderItem.returnedBaseQty` (trava
   contra devolver a mesma peça duas vezes — devolvível = `(baseQuantity ?? quantity) −
   returnedBaseQty`).
2. **Abate a dívida daquela venda**: `abatido = min(V, saldo devedor do recebível da venda)`;
   `Receivable.returnedAmount += abatido`. Se o saldo devedor chegar a 0, o recebível vira
   `PAID` (sem saldo em aberto — a dívida foi quitada por devolução, não por dinheiro; ver
   "Semântica de `PAID`" abaixo).
3. **Excedente** `E = V − abatido` (o que sobra depois de zerar a dívida daquela venda — inclui
   o caso da venda **à vista**, cujo saldo devedor já é 0, então `E = V`): segue o que o
   **operador escolheu** (`target`):
   - **`STORE_CREDIT`**: `Customer.creditBalance += E` + linha `+E` em `customer_credits`
     (livro-razão). Não toca o caixa.
   - **`CASH`**: `CashMovement EXPENSE/RETURN` de `E` no caixa de hoje (reúso do ADR-006);
     exige **caixa aberto**. Não gera crédito.

Cada devolução grava um `AuditEvent` (categoria de estorno; ADR-004) e a autoria (ADR-010).

### 5. **Trocar um item** = devolução (passo 4) + venda (passo 2), na mesma conta

A troca não é um mecanismo novo: **devolve o item A** (credita/abate) e **vende o item B a
prazo** (soma). A diferença ajusta o saldo da conta automaticamente, para qualquer lado (item
mais caro ⇒ saldo sobe; mais barato ⇒ abate/gera crédito). A UI pode oferecer um atalho
"Trocar" que encadeia os dois, mas o modelo de dados é só a soma das duas operações.

### 6. Estrutura de dados — migration `0018` (aditiva)

O **agrupamento (decisão 1) e o receber FIFO (decisão 3) não exigem schema** — são agregação e
distribuição sobre `receivables`/`receivable_payments` que já existem. **Todo o schema novo é da
devolução parcial + crédito** (decisões 4/5). Segue o padrão *cache + livro-razão* do projeto
(`stockQty`/`StockMovement`, `settledAmount`/`ReceivablePayment`, `deliveredBaseQty`/
`order_item_deliveries`):

**Novo enum** `ReturnTarget { STORE_CREDIT, CASH }` — destino do excedente da devolução.

**Colunas novas (aditivas, com default — nenhuma reescrita de tabela):**

| Tabela | Coluna | Tipo | Observação |
|---|---|---|---|
| `order_items` | `returnedBaseQty` | `Decimal(12,4)` default `0` | quanto (em unidade-base) já foi devolvido da linha; espelha `deliveredBaseQty` |
| `receivables` | `returnedAmount` | `Decimal(12,2)` default `0` | devolução abate a dívida: `saldo = original − settled − returned` |
| `customers` | `creditBalance` | `Decimal(12,2)` default `0` | saldo a favor do cliente (**cache** desnormalizado) |

**Tabela nova `order_returns`** (cabeçalho de uma devolução parcial — 1 evento, N itens):

| Campo | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | gerável no cliente |
| `tenantId` | uuid | RLS (ADR-003) |
| `orderId` | uuid | a venda de origem |
| `customerId` | uuid? | o cliente (quando houver) |
| `totalValue` | Decimal(12,2) | `V` — valor devolvido |
| `abatedAmount` | Decimal(12,2) default 0 | quanto abateu da dívida |
| `excessAmount` | Decimal(12,2) default 0 | `E` — o que virou crédito/dinheiro |
| `target` | `ReturnTarget?` | destino do excedente (null se `E = 0`) |
| `receivableId` | uuid? | recebível abatido (quando a venda era a prazo) |
| `cashMovementId` | uuid? | elo com o RETURN (quando `target = CASH`), referência solta |
| `customerCreditId` | uuid? | elo com a linha de crédito (quando `target = STORE_CREDIT`) |
| `reason` | varchar(500) | motivo (ADR-004) |
| `createdAt` | DateTime default now | |
| `createdById` / `createdByName` | uuid? / varchar(100)? | autoria (ADR-010) |

**Tabela nova `order_return_items`** (as linhas do evento):

| Campo | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS |
| `returnId` | uuid | FK → `order_returns` |
| `orderItemId` | uuid | a linha devolvida |
| `baseQty` | Decimal(12,4) | quanto (base) voltou ao estoque |
| `value` | Decimal(12,2) | valor daquele item na devolução |

**Tabela nova `customer_credits`** (livro-razão do crédito — fonte de verdade auditável do
`creditBalance`, reconciliável por `creditBalance = Σ amount`):

| Campo | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS |
| `customerId` | uuid | dono do crédito |
| `amount` | Decimal(12,2) | **assinado**: `+` de devolução, `−` ao usar numa venda |
| `origin` | varchar(30) | `RETURN` / `SALE_USE` / `MANUAL` |
| `relatedOrderId` | uuid? | venda que gerou/consumiu o crédito, referência solta |
| `createdAt` | DateTime default now | |
| `createdById` / `createdByName` | uuid? / varchar(100)? | autoria |

Todas as tabelas novas com **RLS por `tenantId`** (mesmas políticas das demais tabelas de
aplicação), incluídas na migration. **100% aditiva** — nenhuma tabela existente é reescrita
(as três colunas novas têm default), sem drift.

### 7. Núcleo testável (regra 2 — funções puras em `packages/core`)

- Estender `receivableBalance` → `originalAmount − settledAmount − returnedAmount`.
- `customerAccountBalance(receivables, creditBalance)` → saldo líquido da conta.
- `distributeAccountPayment(amount, receivablesOrdenados)` → lista de abatimentos FIFO
  (parcial → quitação; nunca acima do saldo total).
- `isValidPartialReturn(orderItem, qty)` → não devolver além de `(baseQuantity ?? quantity) −
  returnedBaseQty`; respeita o passo do metro/par (ADR-017/ADR-015).
- `splitReturnValue(V, saldoDevedorDaVenda)` → `{ abatido, excedente }`.
- `applyStoreCredit(total, creditBalance)` → quanto do crédito abate uma nova venda (≤ total,
  ≤ saldo) — base da Fatia C.

### 8. Fatiamento (entrega incremental, cada fatia com valor próprio)

- **Fatia A — a conta que soma + receber no final. SEM migration.** Conta implícita
  (agregação por cliente) + `POST /customers/:id/receive` FIFO + tela "Contas a Receber"
  agrupada por cliente (saldo total, dívidas que compõem, "Receber da conta"). Resolve o caso
  **mais comum** (*"pega mais e paga no fim"*) com **risco de schema zero**.
- **Fatia B — devolução/troca por item. Migration `0018`.** Devolução parcial + abatimento da
  dívida + escolha `STORE_CREDIT`/`CASH` + acúmulo de crédito no cliente. A parte pesada.
- **Fatia C — usar o crédito da loja numa nova venda.** Abater o `creditBalance` no PDV
  (linha `−` em `customer_credits`, `origin = SALE_USE`). Fecha o ciclo do crédito. Pode ir
  junto da B ou depois.

**Ordem recomendada:** A → B → C.

### 9. Impacto no caixa e no relatório

- **Receber da conta** (decisão 3): idêntico ao ADR-019 — CASH vira `SUPPLY`; o relatório em
  regime de caixa conta pelo `paidAt` do recebimento. Sem mudança de semântica.
- **Devolução → crédito**: **não toca o caixa** (nenhum dinheiro se move) e não conta como
  recebimento no relatório. Fica registrada como crédito do cliente.
- **Devolução → dinheiro**: `CashMovement EXPENSE/RETURN` reduz o caixa de hoje (comportamento
  do ADR-006, já existente).
- **Usar crédito numa venda** (Fatia C): o crédito **não é dinheiro na gaveta** — reduz o valor
  a pagar da venda, **não** gera `Payment CASH` (portanto não infla o "recebido" do dia; o
  valor já foi reconhecido na devolução que o gerou, evitando contagem dupla).

## Semântica de `PAID` e transições

- `Receivable.status`: `OPEN` enquanto `saldo devedor > 0`; vira `PAID` quando `settledAmount +
  returnedAmount ≥ originalAmount` — ou seja, **`PAID` passa a significar "sem saldo em
  aberto"**, quitada por dinheiro e/ou por devolução (documentado; hoje só havia a via
  dinheiro). `CANCELLED` segue igual (venda de origem cai antes de qualquer movimento).

## Limitações conhecidas (fora do escopo desta fatia)

- **Devolução de item ainda NÃO retirado** (pedido `SCHEDULED` do ADR-020, com saldo
  reservado): a devolução parcial aqui vale para o que **já saiu do estoque** (itens
  entregues/imediatos). "Cancelar a reserva" de um item agendado é o fluxo do ADR-020
  (liberar `reservedQty`), não uma devolução — tratado lá.
- **Limite de crédito por cliente**, **juros/multa por atraso**, **extrato/carnê impresso** e
  **cobrança/notificação** seguem fora (herdado do ADR-019).
- **Offline:** somar item, receber, devolver e usar crédito são **online-only** nesta fatia
  (a mutação é de retaguarda, pode esperar a rede — mesma postura do ADR-019).
- **Expiração/estorno de crédito da loja**: o `creditBalance` não expira e não há tela de
  ajuste manual de crédito nesta fatia (a coluna `origin = MANUAL` fica reservada para o
  futuro).

## Consequências

- **Reúso máximo:** o PDV a prazo (ADR-019), o recebimento (ADR-019), o motor de estorno de
  estoque e o `CashMovement RETURN` (ADR-006) e a autoria (ADR-010) entram quase de graça. O
  `Order` **não** vira mutável; nenhuma invariante de estoque/caixa é violada.
- **Substitui uma limitação do ADR-019** (devolver venda a prazo): a devolução parcial passa a
  abater a dívida corretamente.
- **Migration nova** (`0018`) — 1 enum + 3 colunas com default + 3 tabelas + RLS. **Aditiva**,
  aprovar **antes de codar** (regra 1). A **Fatia A não depende dela**.
- **Testável no core** (regra 2): saldo da conta, FIFO, validação da devolução parcial, split
  abate×excedente, uso de crédito.
- **Trade-off do FIFO:** receber "da conta" abate do mais antigo — simples e previsível; se um
  dia o Owner quiser escolher **qual** dívida quitar, é uma opção de UI por cima (não muda o
  schema).
