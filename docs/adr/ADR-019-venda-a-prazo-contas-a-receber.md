# ADR-019: Venda a Prazo / Contas a Receber (o "fiado")

**Status:** Aceito (Owner aprovou a regra de relatório e a migration `0014` em 2026-07-28)
**Data:** 2026-07-28
**Deciders:** Owner do produto

> **Nota (2026-07-28):** o Owner levantou um cenário **ortogonal** — cliente **paga agora e
> retira a mercadoria depois** (parcial/total), marcando os itens retirados conforme saem.
> Isso é outro eixo (adia a **saída de estoque**, não o pagamento) e toca a invariante ADR-001,
> então vai para um **ADR-020 (retirada/entrega futura)** próprio, na fatia seguinte. Os dois
> motores compõem sem retrabalho: um pedido pode ter pendência de dinheiro (a receber) e de
> mercadoria (a entregar) ao mesmo tempo, cada uma no seu mecanismo.

## Contexto

O sistema registra vendas em que o pagamento é **recebido na hora** (dinheiro, PIX,
cartão), e o `POST /orders` valida `pago ≥ total`. Falta o caso clássico de balcão: o
cliente **leva a mercadoria agora e paga depois** — o "fiado". Isso é uma **venda a prazo**
que gera uma **conta a receber** (a loja fica credora).

Esta é a 2ª metade do par que começou na **CX.Movimentacao** (lançar dinheiro que entra/sai
do caixa fora de uma venda): a descrição do **Suprimento** já cita "pagamento atrasado
recebido" como um dos casos de uso — ou seja, o recebimento de um fiado em dinheiro **já
tem onde cair no caixa**.

Duas lacunas estruturais:
1. Não há onde **persistir a dívida** (quem deve, quanto, contra qual venda, quanto já foi
   pago, em aberto/quitada).
2. O relatório de vendas soma faturamento por **regime de competência**
   (`totalRevenue = Σ Order.total` no dia da venda — `reports.ts`). Para o fiado, o Owner
   quer o valor contado **quando o dinheiro entra**, não quando a venda é feita.

## Decisão

### 1. O fiado é uma **condição de pagamento** no PDV (reúso do pagamento dividido)

A venda a prazo é uma venda **normal** (baixa estoque, imprime comprovante, autoria ADR-010).
A novidade é uma parcela **"A prazo"** ao lado das formas já existentes (o pagamento dividido
do `UI.PDV.SplitPayment` já permite N formas). Regras:

- **Fiado parcial e total** (decisão do Owner): o cliente pode pagar uma **entrada** agora
  (dinheiro/PIX/cartão) e deixar o **restante a prazo**, ou deixar **100% a prazo**.
- **Cliente obrigatório** quando há parcela a prazo (`creditAmount > 0 ⇒ customerId`): não
  existe dívida anônima.
- **Vencimento opcional** (decisão do Owner): `dueDate` nullable na venda a prazo; a tela
  destaca vencidos.
- A parte a prazo **não entra no caixa** (não é dinheiro na gaveta). A entrada paga na hora
  entra normalmente (o CASH alimenta o `cashInflow`, igual hoje).

### 2. Estrutura de dados — 1 enum + 2 tabelas novas (migration `0014`, aditiva)

**`enum ReceivableStatus { OPEN, PAID, CANCELLED }`**

**Tabela `Receivable`** — a dívida de **uma** venda a prazo:

| Campo | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | gerável no cliente (padrão do projeto) |
| `tenantId` | uuid | denormalizado p/ RLS (ADR-003) |
| `orderId` | uuid **unique** | a venda que originou (1 conta por venda) |
| `customerId` | uuid | o devedor (obrigatório) |
| `originalAmount` | Decimal(12,2) | valor a prazo original |
| `settledAmount` | Decimal(12,2) default 0 | quanto já foi recebido (corrente) |
| `status` | ReceivableStatus default OPEN | OPEN → PAID quando quita; CANCELLED se a venda cai |
| `dueDate` | DateTime? | vencimento opcional |
| `createdAt` | DateTime default now | |
| `createdById` / `createdByName` | uuid? / varchar(100)? | autoria (ADR-010), referência solta |

Saldo devedor = `originalAmount − settledAmount` (derivado, não armazenado).
Índices: `[tenantId, status]`, `[tenantId, customerId]`, `[tenantId, dueDate]`.

**Tabela `ReceivablePayment`** — cada **recebimento** contra a dívida:

| Campo | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS (ADR-003) |
| `receivableId` | uuid | a conta abatida |
| `amount` | Decimal(12,2) | valor recebido |
| `method` | varchar(30) | CASH / PIX / CREDIT_CARD / DEBIT_CARD (igual `Payment.method`) |
| `paidAt` | DateTime default now | **o dia em que o dinheiro entrou** (chave do relatório) |
| `cashSessionId` | uuid? | caixa que recebeu (quando em dinheiro) |
| `cashMovementId` | uuid? | elo com o Suprimento gerado (quando em dinheiro) |
| `receivedById` / `receivedByName` | uuid? / varchar(100)? | autoria |

Índices: `[tenantId, paidAt]`, `[receivableId]`.

Ambas com **RLS por `tenantId`** (mesmas políticas das demais tabelas de aplicação),
incluídas na migration. Aditiva, sem alterar tabelas existentes, sem drift.

### 3. Fluxo — criar venda a prazo (`POST /orders` estendido)

Payload ganha `creditAmount` (valor a prazo, opcional) + `dueDate` (opcional); `customerId`
já existe. Em **transação atômica** (ADR-001):

- valida `Σ pagamentos à vista + creditAmount = total` e `creditAmount > 0 ⇒ customerId`;
- cria o `Order` + `OrderItem` + baixa de estoque + os `Payment` **realmente pagos agora**
  (a parte a prazo **não** vira `Payment` — dinheiro que não entrou não é pagamento);
- se `creditAmount > 0`, cria o `Receivable` (`originalAmount = creditAmount`, `dueDate`).

O caixa e o protocolo de sync **não mudam**: só os `Payment` reais (CASH) alimentam o caixa.
**Venda a prazo é ONLINE-ONLY nesta fatia** (o PDV offline não oferece "A prazo") — mesma
postura de estoque/caixa (a mutação com conta a receber é retaguarda, pode esperar a rede).

### 4. Fluxo — receber (`POST /receivables/:id/receive`)

Payload: `amount`, `method`, `reference?`. Em **transação atômica**:

- valida `amount > 0`, `amount ≤ saldo devedor`, conta `OPEN`;
- insere `ReceivablePayment`;
- `settledAmount += amount`; se `settledAmount ≥ originalAmount` → `status = PAID`;
- **se `method = CASH`**: exige **caixa aberto** (senão 404, como o lançamento manual) e
  lança um **`CashMovement SUPPLY`** no caixa de hoje (reúso da CX.Movimentacao), com
  `reason = "Recebimento de fiado — <cliente>"` e `relatedOrderId` = a venda; grava
  `cashSessionId`/`cashMovementId` no recebimento. Assim o **caixa fica correto sozinho**.
- **se não-dinheiro** (PIX/cartão): registra o recebimento; não toca no caixa (não é gaveta).

Recebimento parcial é o padrão (abate o saldo); vários recebimentos até quitar.

### 5. Relatório — regime de **caixa** para o "valor recebido/vendido no dia" (decisão do Owner)

Hoje `totalRevenue = Σ Order.total` no dia da venda (competência). Passa a ser o **dinheiro
que efetivamente entrou no período** (regime de caixa), para o fiado contar **no dia do
recebimento**, sem contar o mesmo real duas vezes:

- **Recebido no período** = `Σ Payment.amount` (pagamentos à vista, por `paidAt`, vendas não
  canceladas) **+** `Σ ReceivablePayment.amount` (recebimentos de fiado, por `paidAt`).
- A **parte a prazo de uma venda NÃO conta** enquanto não é recebida (não é `Payment`).
- **Consequência (explícita):** uma venda **100% fiado** contribui **R$ 0** ao "recebido" no
  dia em que é feita; entra no total **no(s) dia(s) do recebimento**. Uma venda **à vista**
  segue contando integral no dia (para elas `Σ Payment = total` e `paidAt ≈ createdAt`, então
  os números históricos **não mudam** — baixo risco de regressão).
- Linha informativa **"Vendas a prazo geradas (a receber)"** = `Σ Receivable.originalAmount`
  criados no período — mostra o que foi vendido no fiado, **sem** somar ao recebido.
- `nº de vendas` segue por `createdAt` (a venda a prazo é 1 venda no dia em que ocorre); o
  **ticket médio** perde precisão quando há fiado — inerente à venda a crédito, documentado.

### 6. Tela nova **Contas a Receber**

Lista as contas em aberto (por cliente, com saldo devedor, vencimento e destaque de
**vencidos**); busca por cliente; ação **Receber** (valor total ou parcial, forma de
pagamento) reusando o `MoneyInput`. Item novo no menu lateral. Só-leitura para operador?
Não — **qualquer operador vende e recebe fiado** (é operação de balcão, como a venda);
autoria registra quem fez.

## Limitações conhecidas (fora do escopo desta fatia)

- **Cancelar/devolver uma venda a prazo:** se o `Receivable` está **intocado**
  (`settledAmount = 0`), o cancelamento/devolução também marca a conta como `CANCELLED`
  (cascata simples). Se **já houve recebimento**, é caso de estorno de dinheiro recebido —
  **fora do escopo** desta fatia (bloqueado com mensagem; tratamento futuro).
- **Juros/multa por atraso**, **limite de crédito por cliente**, **extrato/carnê impresso do
  cliente** e **cobrança/notificação** ficam para fatias futuras.
- **Offline:** venda a prazo e recebimento são **online-only** aqui.

## Consequências

- **Reúso máximo:** o PDV (pagamento dividido), o caixa (Suprimento da CX.Movimentacao) e a
  autoria (ADR-010) entram quase de graça; o estoque, o cancelamento e o sync **não mudam**.
- **Migration nova** (`0014`) — 1 enum + 2 tabelas + RLS. Aditiva, aprovar antes de codar.
- **Mudança de semântica no relatório de vendas** (competência → caixa) — é a decisão do
  Owner; documentada acima, com baixo risco para o histórico à vista.
- **Testáveis no core (regra 2):** saldo devedor, quitação (parcial → total), validação de
  "não receber mais que o saldo", split entrada×a-prazo na venda.
