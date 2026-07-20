# ADR-016 — Preço e margem por forma de pagamento (taxa da maquininha + acréscimo por produto)

- **Status:** **Aceito — IMPLEMENTADO e NO AR (2026-07-20); aguardando E2E do Owner.**
  ADR e migration `0012` aprovados pelo Owner antes de codar (regras 1 e 4 do CLAUDE.md).
  Migration aplicada (banco up to date, sem drift). Core **137/137** (+29). API `060acc7e` +
  web `58fbe607`; smoke ✅ (health 200, `/tenant` sem token 401, web `/login` 200).
- **Data:** 2026-07-20
- **Contexto de fase:** Fase 3, fatia **FP** (forma de pagamento), logo após a fatia PA
  (produto agregado, ADR-015).
- **Deciders:** Owner do produto.

---

## Contexto

Pedido do Owner:

> Na tela de Produtos temos o campo **Custo**. Quero poder inserir, de forma opcional, mais campos
> de custo — **Custo Débito** e **Custo Crédito**. Quando for realizar a venda de um produto que
> tenha algum desses campos preenchido, a tela deve **ler o tipo de pagamento selecionado e inserir
> o valor correspondente**.

Na conversa de refinamento, o pedido se separou em **duas necessidades distintas** que estavam
juntas na mesma palavra ("custo"):

1. **Saber a margem real por forma de pagamento.** A maquininha come um percentual (débito ~1,5%,
   crédito ~3,5%), então a mesma venda dá margens diferentes conforme o cliente paga. Isso é
   **informação interna** — não muda o que o cliente paga.
2. **Cobrar mais em determinada forma de pagamento.** O clássico "à vista R$37, no cartão R$38,50".
   Isso **muda o preço cobrado**, e o Owner foi explícito: **não pode ser automático**. Só sobe o
   preço do produto que tiver o campo preenchido no cadastro.

São mecanismos independentes e o ADR trata os dois separadamente. Misturá-los (ex.: derivar o preço
do cartão da taxa da maquininha) foi **explicitamente recusado** pelo Owner.

**O que já existe e não muda:**

- `Product.costPrice` — custo de aquisição, base da margem exibida hoje.
- `Payment.method` (`CASH` / `DEBIT` / `CREDIT` / `PIX`) — e o **PDV tem forma de pagamento única
  por venda** (`payments: [{ method, amount: total }]`), então não existe o problema de venda mista.
- `OrderItem` faz **snapshot** de `unitPrice`/`total` por item.
- O servidor recalcula o total a partir do `unitPrice` **enviado pelo cliente**
  (`apps/api/src/routes/orders.ts`) e valida "pagamento suficiente".

---

## Decisão central: o acréscimo entra **embutido no `unitPrice` do item**

Vender no crédito um produto com acréscimo de R$1,50 grava o `OrderItem` já com o preço do crédito:

| Cenário | `unitPrice` gravado | Total (2 un) |
|---|---|---|
| Dinheiro / PIX | R$ 37,0000 | R$ 74,00 |
| Crédito (+R$1,50) | R$ 38,5000 | R$ 77,00 |

**Por que embutir e não criar uma linha "acréscimo" no pedido:**

- **Estoque, cancelamento e devolução não mudam uma linha de código** — os três percorrem
  `OrderItem` e estornam o valor que foi cobrado. Uma linha de acréscimo à parte exigiria coluna
  nova em `Order`, mudança no cálculo do total no servidor e no motor de estorno (ADR-006).
- **Caixa e relatórios ficam corretos de graça** — o `cashInflow` e o faturamento já somam o que foi
  efetivamente pago.
- **Fila offline (ADR-011) intacta** — o envelope continua carregando `unitPrice` por item; nenhuma
  mudança no protocolo de sync.
- **Mesmo critério que o Owner já escolheu no ADR-015** para o par: *"comprado separado o valor muda
  — mostrar uma linha evita questionamento"*.

É o mesmo padrão do ADR-013 (embalagem) e do ADR-015 (par): **a variação de preço é resolvida no
preço do item, não numa estrutura nova.**

---

## Decisões do Owner (2026-07-20)

### 1. Duas coisas separadas: taxa da loja (margem) × acréscimo do produto (preço)

| | Taxa da maquininha | Acréscimo por pagamento |
|---|---|---|
| **Onde se cadastra** | Configurações (nível **loja**), uma vez | Cadastro do **produto**, opcional |
| **Formato** | percentual (ex.: 1,50% / 3,50%) | **R$ fixo por unidade** |
| **Vale para** | **todos** os produtos, automático | **só** os produtos preenchidos |
| **Efeito** | margem real exibida (interno) | **preço cobrado do cliente** |
| **Cliente vê?** | não | sim |

### 2. O campo do produto é **acréscimo**, não custo absoluto nem preço final

Decidido com exemplo numérico (cimento: custo R$25, preço à vista R$37, crédito R$38,50): o Owner
digita **1,50** — "só o quanto acrescentar".

- Campo **vazio** ⇒ o produto **não** muda de preço naquela forma de pagamento. Este é o default e
  cobre a maioria do catálogo.
- Consequência de nomenclatura: o rótulo honesto na UI é **"Acréscimo no Débito / no Crédito"**, não
  "Custo Débito / Crédito" — o número digitado não é um custo, é quanto o preço sobe. *(Ponto de
  baixo risco: se o Owner preferir o vocabulário dele na tela, é só texto.)*

### 3. Só **Débito** e **Crédito**; sem parcelamento

`CASH` e `PIX` nunca têm acréscimo. Faixas de parcelas (1x / 2-6x / 7-12x) ficam **fora** — exigiriam
tabela de regras em vez de duas colunas e um seletor de parcelas no PDV. Vira ADR futuro se houver
demanda real.

### 4. O acréscimo é **embutido no preço do item** no comprovante

Linha única, já com o preço da forma de pagamento escolhida. Sem linha "Acréscimo cartão".

---

## Desenho técnico

### Migration `0012` (aditiva — **requer aprovação**, regra 1 do CLAUDE.md)

```prisma
model Product {
  // Acréscimo por forma de pagamento (ADR-016). R$ por unidade VENDIDA, opcional.
  // Vazio ⇒ o produto não muda de preço naquela forma de pagamento.
  surchargeDebit   Decimal? @db.Decimal(12, 4)
  surchargeCredit  Decimal? @db.Decimal(12, 4)
}

model Tenant {
  // Taxa da maquininha (ADR-016). Percentual, só para calcular a MARGEM REAL — nunca altera preço.
  cardFeeDebitPercent   Decimal? @db.Decimal(5, 2)
  cardFeeCreditPercent  Decimal? @db.Decimal(5, 2)
}
```

- **4 colunas nullable, nenhuma alteração de RLS** (as políticas da `0002` são por linha e já cobrem
  colunas novas), nenhum índice novo, zero impacto em dados existentes. Mesmo perfil de risco das
  migrations `0010` e `0011`.
- `Decimal(12,4)` no acréscimo casa com `salePrice`/`costPrice`; `Decimal(5,2)` cobre taxa até
  999,99%.

### `packages/core` — funções puras (com testes, regra 2 do CLAUDE.md)

| Função | Papel |
|---|---|
| `resolveSurcharge(product, method, saleMode)` | Devolve o acréscimo em R$ da linha, ou 0. Único lugar que sabe as regras abaixo. |
| `priceForPaymentMethod(basePrice, surcharge)` | Preço final da unidade vendida. |
| `netMarginPercent(costPrice, unitPrice, feePercent)` | Margem **real** descontada a taxa da maquininha. |

Regras de composição com as fatias anteriores:

- **EF-3 (embalagem fechada, ADR-013):** o acréscimo é cadastrado na **unidade-base**; vendendo a
  embalagem, ele é aplicado **proporcionalmente** (`acréscimo × conversionFactor`). Um rolo de 100 m
  com acréscimo de R$0,02/m sobe R$2,00 — coerente com "repassar a taxa do cartão", que é
  proporcional ao valor. *(A alternativa — acréscimo fixo por linha, R$0,02 no rolo inteiro — foi
  descartada por ser desproporcional ao valor da venda.)*
- **PA (par, ADR-015):** o acréscimo do par é a **soma dos acréscimos dos dois lados** (cada par
  consome 1 de cada). Entra no total do par **antes** do rateio do `splitPairLine`, então a soma dos
  dois `OrderItem` continua fechando exata no centavo — a propriedade que o bug PA.1 ensinou a
  proteger.

### PDV (`apps/web/app/(app)/venda/page.tsx`)

O ponto delicado: **a forma de pagamento é escolhida depois de montar o carrinho.** Hoje o
`CartItem.unitPrice` é congelado ao adicionar o item — se o acréscimo fosse aplicado ali, trocar de
Dinheiro para Crédito no fim não reprecificaria nada.

**Solução:** o `CartItem` guarda o **preço base** e os acréscimos do produto; o preço efetivo é
**derivado** do `method` atual no `useMemo` de `totals` e em `cartToSaleItems()`. Trocar a forma de
pagamento reprecifica a tela inteira reativamente, e o valor enviado é sempre o que está na tela.

Isso preserva a invariante conquistada no PA.1: **o front soma exatamente os itens que envia**, com
a mesma função pura do servidor. O acréscimo entra dentro dessa mesma função — não é um cálculo
paralelo.

### Servidor (`POST /orders`) — **sem mudança no cálculo**

O servidor continua recalculando o total a partir do `unitPrice` recebido, como hoje. **Não** vai
reaplicar o acréscimo a partir do catálogo, porque uma venda offline sincronizada dias depois seria
reprecificada com o cadastro de hoje — exatamente o que o ADR-011 evita ao congelar o preço no
envelope.

⚠️ **Ainda assim o deploy da API é obrigatório**, mesmo sem rota nova: os schemas Zod de
`@nexoloja/shared` e o client Prisma antigos **descartariam** os campos novos (`createProductSchema`
tira campo desconhecido; client antigo não lê a coluna). É o mesmo tropeço já documentado com
`popularName` (14/07) e `manufacturer` (fatia EP).

### Onde a margem real aparece

- **Tooltip do item no PDV** — hoje mostra `Margem X% • até R$Y/un`; passa a mostrar a margem da
  forma de pagamento selecionada, já descontada a taxa.
- **Produtos / ProductDetail** — margem à vista (como hoje) + margem no débito e no crédito quando as
  taxas estiverem cadastradas.
- Sem taxa cadastrada, tudo se comporta exatamente como hoje.

---

## Consequências

**Positivas**

- Owner passa a saber a margem **real** por forma de pagamento — hoje a margem exibida ignora a
  maquininha e é otimista em 1,5-3,5%.
- Repasse do custo do cartão vira decisão **por produto**, não uma regra cega no catálogo inteiro.
- Estoque, cancelamento, devolução, caixa, relatórios e o protocolo de sync **não mudam**.

**Achado da implementação (2026-07-20): acréscimo repõe LUCRO, não repõe MARGEM %**

Descoberto ao escrever os testes do core, com o caso do Owner (custo R$25, à vista R$37, crédito
+R$1,50, taxa 3,5%):

| | Preço | Taxa | Lucro em R$ | Margem % |
|---|---|---|---|---|
| À vista | 37,00 | — | **12,00** | **32,43%** |
| Crédito +R$1,50 | 38,50 | 1,3475 | **12,15** | **31,56%** |

O lucro **em reais sobe**, mas a margem **percentual cai** — o acréscimo entra também no
denominador. Não é defeito do cálculo; é aritmética. Os dois pontos de equilíbrio, para o mesmo
produto:

- **Repor o lucro em R$:** acréscimo de **R$1,34** (`0,965 × preço = 37`).
- **Repor a margem %:** acréscimo de **R$2,02** (`25 ÷ (0,965 − 0,3243)`).

Ou seja, R$1,50 já deixa o Owner ganhando mais dinheiro por venda no crédito do que à vista. É
justamente para essa escolha que a margem real por modalidade existe na tela — o número aparece
antes de o acréscimo ser decidido.

**Negativas / limites aceitos**

- O preço passa a depender de um estado da tela (forma de pagamento). Mitigado por reprecificar
  reativamente e por o total sempre refletir os itens enviados.
- **Orçamento** sai com o preço da forma de pagamento selecionada no momento — se o cliente depois
  pagar de outro jeito, o valor muda. Cabe deixar a forma de pagamento visível no orçamento.
- Venda **mista** (dinheiro + cartão) continua fora do escopo — o PDV nem a suporta hoje.
- A taxa da maquininha é um percentual único por modalidade; taxa por bandeira ou por faixa de
  parcelas não é modelada.

---

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Derivar o preço do cartão **automaticamente** da taxa da maquininha | **Recusado pelo Owner**: só sobe o preço de quem ele marcar. Evita reajuste silencioso do catálogo inteiro. |
| Campo de **preço final** por modalidade (digitar R$38,50) | Se o preço à vista for reajustado e o campo do cartão não, o cartão fica defasado **sem aviso**. |
| Acréscimo em **percentual** por produto | Gera centavo quebrado por linha e reintroduz a classe de bug de arredondamento do PA.1. |
| **Linha de acréscimo** separada no pedido | Exige coluna em `Order`, mudança no total do servidor e no motor de estorno (ADR-006), para ganho só cosmético. |
| Taxa da maquininha por produto | Redigitar em cada cadastro e reeditar tudo quando a maquininha reajustar. A taxa é da loja, não do produto. |

---

## Plano de execução (após aprovação)

1. Migration `0012` (`migrate diff` + `migrate deploy`) — **só depois do OK explícito**.
2. `packages/core`: as 3 funções puras + testes (incluindo composição com par e embalagem, e teste de
   propriedade de arredondamento como no PA.1).
3. `packages/shared`: campos nos schemas Zod de produto e no `updateTenantSchema` (opcionais aceitando
   `null` para limpar, como a fatia EP estabeleceu).
4. Web: cadastro/edição de produto (2 campos), Configurações (2 taxas), PDV reativo, tooltip de
   margem, espelho offline do catálogo (`lib/catalog.ts`).
5. Gates: typecheck API+web, build web, core verde.
6. Deploy **API + web** (a API é obrigatória, ver acima), smoke, E2E do Owner.
