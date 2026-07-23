# ADR-017 — Unidade fechada (Barra/Rolo) como principal + venda fracionada por metro (amenda o ADR-013)

- **Status:** **Aceito (2026-07-22).** Owner aprovou o desenho e a migration do enum. Em implementação.
- **Data:** 2026-07-22
- **Contexto de fase:** Fase 3, evolução do módulo de estoque fino (EF-3). Amenda a **convenção de
  apresentação** do [ADR-013](./ADR-013-venda-em-unidade-alternativa.md) — não substitui o motor.
- **Deciders:** Owner do produto.

> ⚠️ **Este ADR implica alteração de banco** (um valor novo no enum `UnitType`). Pela regra 1 do
> `CLAUDE.md`, a migration só é escrita/aplicada após aprovação.

---

## Contexto

O EF-3 (ADR-013, Opção A) modelou "duas embalagens, dois preços" com a convenção **"a unidade-base é a
mais fina"**: `unit`/`salePrice`/`stockQty` são o **metro** (fino), e o **fechado (rolo)** é a *unidade
alternativa*, definida por `conversionFactor` (metros por rolo) + `altSalePrice` (preço do rolo). O PDV
apresenta o **metro como principal** e o rolo como opção.

O Owner pediu para **inverter a apresentação** — e a razão é boa: em material de construção o produto é
pensado como o **item fechado** ("uma **barra** de ferro que custa R$ 48"), e a venda **por metro** é o
caso **secundário** (corte fracionado). Além de **Barra** ser uma unidade nova (o enum tem `ROLL`, não
tem barra).

> **Pedido, nas palavras do Owner:** no cadastro principal deve estar a unidade **fechada** (Barra, Rolo…)
> com o **valor fechado**; a **"venda em unidade alternativa"** é que deve ter a **venda por metro,
> fracionada**. A barra tem **tamanho em metros**; ao vender por metragem, "vai tirando do **total de
> metros** somados do estoque". A **metragem mínima** de venda é **meio metro**, em **múltiplos de 0,5 m**
> (evita saldos muito quebrados).

---

## A descoberta que simplifica

O motor do ADR-013 **já** guarda o estoque na unidade fina e converte o fechado por um fator. Ou seja, um
produto "base = metro + alternativa = rolo" e um produto "principal = barra + fracionado = metro" têm a
**mesma forma no banco** — muda só **qual lado a UI chama de principal**. Portanto:

- **Não há coluna nova.** Reusa `unit`/`salePrice`/`costPrice` (a régua fina, metro) e
  `altUnit`/`altSalePrice`/`conversionFactor` (o fechado).
- A migration é **só** `ALTER TYPE "UnitType" ADD VALUE 'BARRA'` (aditiva; não toca dado; RLS intacta).

## Decisão

### 1. O ledger de estoque continua na unidade FINA (metro) — precisão

O `StockMovement`/`stockQty` seguem em **metros** (a unidade fina), **exatamente como hoje**. Motivo:
**precisão**. A regra do meio metro só é exata em metros — 0,5 m guardado "em barras" viraria dízima
(0,5 ÷ 6 = 0,0833…) e, somando muitas vendas, o saldo desviaria (12 × 0,0833 ≠ 1 barra). Guardando em
metros, tanto a venda de 0,5 m quanto a entrada de "10 barras × 6 m" são exatas. **ADR-001 permanece
intacto — zero mudança no ledger.**

### 2. A unidade FECHADA (Barra/Rolo) é a de primeira classe na UI

Embora o ledger seja em metros, o operador **cadastra, compra, precifica e enxerga em barras**:

- **Cadastro principal:** unidade = **Barra** (ou Rolo…), **tamanho da barra em metros** (ex.: 6),
  **preço da barra** (fechado) e **custo da barra**.
- **Venda em unidade alternativa:** **preço por metro** (fracionado). **Refino de implementação (2026-07-22):**
  como o ledger fica em metros (precisão do 0,5 m), o preço por metro é o preço da unidade-base e portanto
  **um campo normal do cadastro** — no v1 **toda barra pode ser vendida inteira ou por metro**. Um marcador
  **"não corta"** (só inteira) fica como evolução de 1 coluna booleana, se o Owner pedir (não altera este
  motor).
- **Saldo:** exibido como **unidades inteiras + sobra em metros** — `inteiros = piso(metros ÷ tamanho)`
  e `sobra = metros − inteiros × tamanho`. Ex.: 298 m com barra de 6 m → **49 barras + 4 m** (não
  "49,67 barras"). **Idêntico para rolo** (ex.: **12 rolos + 30 m**). O total em metros também fica visível.
- **Entrada de estoque (compra):** lançada **em barras** (+10 barras ⇒ +60 m no ledger).

### 3. Venda: barra inteira por padrão; por metro é a opção

- No PDV, o **modo padrão** do produto passa a ser a **unidade fechada** (barra inteira) — antes era a
  fina. Vender por metro é a opção, **habilitada só se houver preço por metro**.
- **Venda por metro:** aceita **múltiplos de 0,5 m** (0,5 / 1 / 1,5 / 2…), **mínimo 0,5 m**. Validação
  pura no `packages/core`, testada, reusada no PDV (online e offline).
- **Preço por metro é independente** do preço da barra (o corte avulso costuma sair mais caro por metro
  que a barra fechada) — não é derivado.

### 4. Custo e margem por barra (derivados por metro)

O Owner informa **custo da barra**; guardamos `costPrice` (por metro) = **custo da barra ÷ tamanho**. A
margem é mostrada tanto por barra quanto por metro (derivada), como o EF-3 já faz com `effectiveBaseUnitPrice`.

### Decisões do Owner registradas (2026-07-22)

| Ponto | Escolha |
|---|---|
| Contagem de estoque | Unidade fechada (barra) — exibida; ledger fino em metros por precisão |
| Novo valor de enum | **Só `BARRA`** (Rolo já existe) |
| Regra do meio metro | **Múltiplos de 0,5 m** (mín. 0,5 m) |
| Entrada de estoque | **Em barras** (× tamanho → metros) |
| Exibição do saldo | **Inteiros + sobra em metros** (ex.: 49 barras + 4 m); idem rolo (12 rolos + 30 m) |

---

## Mapa de dados (reuso do schema EF-3 — sem coluna nova)

| Campo | Passa a guardar |
|---|---|
| `unit` | unidade **fina** = `METER` (ledger/salePrice) |
| `salePrice` | **preço por metro** (venda fracionada) |
| `costPrice` | custo por metro = **custo da barra ÷ tamanho** |
| `altUnit` | **`BARRA`** (unidade fechada = principal na UI) |
| `altSalePrice` | **preço da barra** (fechado) |
| `conversionFactor` | **tamanho da barra em metros** (ex.: 6) |

> **Compat:** produtos EF-3 já cadastrados (rolo × metro) têm a mesma forma — passam a ser **apresentados**
> com o fechado como principal também, de forma consistente. **Nenhum dado muda**; é só apresentação + o
> modo padrão do PDV.

## Impacto no banco (a aprovar)

- **Migration:** `ALTER TYPE "UnitType" ADD VALUE 'BARRA'` — **aditiva**, não altera tabelas nem RLS, não
  toca dado existente. Aplicada via `migrate diff` + `migrate deploy` (padrão do projeto). ⚠️ Em Postgres,
  `ADD VALUE` não roda dentro de transação com uso imediato do valor — a migration só adiciona o rótulo
  (o uso vem depois, no código), então é segura.
- **Nenhuma coluna nova.**

## Consequências / superfície a tocar (só depois de aprovar)

- **`packages/core`** (funções puras + testes, regra 2): validação **múltiplo de 0,5 m** (`isValidMeterStep`),
  conversões `barsFromMeters`/`metersFromBars`, e um "modo padrão = fechado". Sem mudar `toBaseQuantity`
  (o ledger segue em metros).
- **`packages/shared`:** cadastro/edição passam a coletar tamanho + preço/custo da barra; `saleMode`
  padrão = fechado; validação do passo de 0,5 m no item de venda por metro.
- **`apps/api`:** `POST /orders` — trava de estoque e `StockMovement` **seguem em metros** (nada muda no
  ledger); só valida o passo de 0,5 m. Entrada de estoque em barras converte para metros.
- **`apps/web`:** cadastro (`/products` + `ProductDetail`) com a apresentação invertida; **Estoque**
  mostra saldo em barras (metros ÷ tamanho) + metros, e a **Entrada em barras**; **PDV** com padrão barra
  inteira + opção "por metro" (passo 0,5); **comprovante** imprime "1 barra (6 m)" ou "2,5 m"; espelho
  offline do catálogo atualizado.
- **Risco principal:** é uma **inversão de apresentação em várias telas** — exige varredura cuidadosa
  (Produtos, Estoque, PDV, comprovante, ProductDetail, cache offline) para nenhuma continuar mostrando o
  metro como principal. O motor de estoque/venda em si quase não muda (menor risco).

## Action Items (após aprovação)

1. [ ] **Owner aprova o ADR** (esta decisão) e a **migration do enum**.
2. [ ] Migration `ALTER TYPE "UnitType" ADD VALUE 'BARRA'` (via `migrate diff` + `migrate deploy`).
3. [ ] `packages/core`: `isValidMeterStep(0,5)`, `barsFromMeters`/`metersFromBars`,
       `splitWholeAndRemainder(metros, tamanho)` → `{ inteiros, sobraMetros }` (exibição "49 barras + 4 m"),
       testes Vitest.
4. [ ] `packages/shared`: coleta por barra + passo de 0,5 m + `saleMode` padrão fechado.
5. [ ] `apps/api`: validação do passo; entrada em barras → metros; ledger inalterado.
6. [ ] `apps/web`: cadastro/PDV/estoque/comprovante/ProductDetail/cache com apresentação invertida.
7. [ ] Gates (core, tsc api+web, build web) → deploy (API + web) → E2E do Owner.

## Relacionadas

- **[ADR-013](./ADR-013-venda-em-unidade-alternativa.md)** — o motor de unidade alternativa que este ADR
  **reapresenta** (não substitui). Convenção antiga: base fina como principal; nova: fechado como principal.
- **[ADR-001](./ADR-001-consistencia-de-estoque.md)** — o ledger segue em unidade fina (metro); **sem
  mudança** na razão de estoque.
