# ADR-017 — Unidade fechada (Barra/Rolo) como principal + venda fracionada por metro (amenda o ADR-013)

- **Status:** **Aceito e NO AR (2026-07-22), aguardando E2E do Owner.** Owner aprovou o desenho e a
  migration do enum. Implementado ponta a ponta (API `5c426eb7` + web `0041891a`).
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

- **Não há coluna nova.** Reusa `unit` (agora a unidade FECHADA), `salePrice`/`costPrice` (preço/custo
  da **barra**, NOT NULL), `conversionFactor` (tamanho da barra em metros) e `altUnit`/`altSalePrice`
  (a régua fina — metro — e o **preço por metro OPCIONAL**, pois `altSalePrice` é nullable).
- A migration é **só** `ALTER TYPE "UnitType" ADD VALUE 'BARRA'` (aditiva; não toca dado; RLS intacta).
  O que muda por código é o **core + a leitura de estoque** (ver §1), não o schema.

## Decisão

### 1. Estoque em METROS (unidade fina), desacoplado da unidade principal — precisão

O `stockQty`/`StockMovement` de um produto de unidade fechada ficam em **metros** (a unidade fina),
**desacoplados** do `unit` (que é `BARRA`). Motivo: **precisão**. A regra do meio metro só é exata em
metros — 0,5 m guardado "em barras" viraria dízima (0,5 ÷ 6 = 0,0833…) e, somando muitas vendas, o saldo
desviaria e poderia até **bloquear o último corte válido** por falta aparente. Guardando em metros, tanto
0,5 m quanto "10 barras × 6 m" são exatos. **Consequência:** o core ganha o conceito de **unidade fechada
como principal** — a venda da **barra** baixa `qtd × tamanho` metros e a venda **por metro** baixa `qtd`
metros. É o motor do EF-3 com os papéis invertidos; a razão do ledger (ADR-001) segue em unidade fina.

### 2. A unidade FECHADA (Barra/Rolo) é a de primeira classe

O operador **cadastra, compra, precifica e enxerga em barras**:

- **Cadastro principal:** unidade = **Barra** (ou Rolo…), **tamanho da barra em metros** (ex.: 6),
  **preço da barra** (`salePrice`) e **custo da barra** (`costPrice`).
- **Venda por metro (opcional):** **preço por metro** em `altSalePrice` (nullable). **Vazio ⇒ o produto só
  vende barra inteira** (o PDV não oferece "por metro") — sem marcador/checkbox, a ausência do preço é o
  sinal. Preenchido ⇒ o PDV oferece também a venda fracionada.
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

### 4. Custo e margem por barra (por metro é derivado)

O Owner informa **custo da barra**, guardado direto em `costPrice`. A margem da **barra** = `(salePrice −
costPrice)/salePrice`. A margem **por metro** é derivada: preço/metro (`altSalePrice`) contra custo/metro
(`costPrice ÷ tamanho`). Nenhuma das duas exige campo novo.

### Decisões do Owner registradas (2026-07-22)

| Ponto | Escolha |
|---|---|
| Contagem de estoque | Unidade fechada (barra) — exibida; ledger fino em metros por precisão |
| Novo valor de enum | **Só `BARRA`** (Rolo já existe) |
| Regra do meio metro | **Múltiplos de 0,5 m** (mín. 0,5 m) |
| Entrada de estoque | **Em barras** (× tamanho → metros) |
| Exibição do saldo | **Inteiros + sobra em metros** (ex.: 49 barras + 4 m); idem rolo (12 rolos + 30 m) |

---

## Mapa de dados (reuso do schema — sem coluna nova)

| Campo | Passa a guardar |
|---|---|
| `unit` | **`BARRA`** (ou `ROLL`) — a unidade fechada, principal |
| `salePrice` | **preço da barra** (fechado) — NOT NULL |
| `costPrice` | **custo da barra** — NOT NULL |
| `conversionFactor` | **tamanho da barra em metros** (ex.: 6) |
| `altUnit` | `METER` — a subdivisão fina |
| `altSalePrice` | **preço por metro** — **nullable ⇒ opcional** (vazio = só barra inteira) |
| `stockQty` / `StockMovement` | **em METROS** — desacoplado do `unit` (precisão do 0,5 m) |

> **Detecção:** "unidade fechada como principal" = `unit ∈ {BARRA, ROLL}` **com** `conversionFactor` > 0.
> Para esses, o estoque é lido/gravado em metros e a venda da barra baixa `qtd × conversionFactor`.
>
> **Compat:** os produtos EF-3 antigos (rolo × metro cadastrados com `unit=METER` + `altUnit=ROLL`) têm a
> forma **oposta** (base fina como principal) e seguem funcionando pelo caminho antigo do motor — a
> detecção acima não os pega. São poucos (dado de teste); podem ser reconciliados ou deixados como estão.

## Impacto no banco (a aprovar)

- **Migration:** `ALTER TYPE "UnitType" ADD VALUE 'BARRA'` — **aditiva**, não altera tabelas nem RLS, não
  toca dado existente. Aplicada via `migrate diff` + `migrate deploy` (padrão do projeto). ⚠️ Em Postgres,
  `ADD VALUE` não roda dentro de transação com uso imediato do valor — a migration só adiciona o rótulo
  (o uso vem depois, no código), então é segura.
- **Nenhuma coluna nova.**

## Consequências / superfície a tocar (só depois de aprovar)

- **`packages/core`** (funções puras + testes, regra 2): `isValidMeterStep` (múltiplo de 0,5 — ✅ feito),
  `metersFromWhole` (entrada em barras → metros — ✅ feito), `splitWholeAndRemainder` (exibição — ✅ feito),
  e o **resolvedor de unidade fechada**: dado o produto e o modo (barra × metro), devolve preço e **quanto
  baixar em metros** (barra ⇒ `qtd × tamanho`; metro ⇒ `qtd`). É o EF-3 com papéis invertidos.
- **`packages/shared`:** cadastro/edição coletam tamanho + preço/custo da barra + preço/metro **opcional**;
  o item de venda por metro valida o passo de 0,5 m.
- **`apps/api`:** `POST /orders` — para produto de unidade fechada, a trava de estoque e o `StockMovement`
  usam o débito em metros do resolvedor (barra ⇒ `qtd × tamanho`); valida o passo de 0,5 m na venda por
  metro. Entrada de estoque (`/stock`) recebe metros (o web converte barras → metros).
- **`apps/web`:** cadastro (`/products` + `ProductDetail`) com a apresentação invertida; **Estoque** mostra
  saldo em barras + sobra em metros e a **Entrada em barras**; **PDV** com padrão barra inteira + opção "por
  metro" (passo 0,5) quando houver preço/metro; **comprovante** imprime "1 barra (6 m)" ou "2,5 m"; espelho
  offline do catálogo atualizado.
- **Risco principal:** inversão em várias telas **+** o resolvedor de unidade fechada no core/API (débito da
  barra em metros). Exige varredura cuidadosa (Produtos, Estoque, PDV, comprovante, ProductDetail, cache
  offline) e testes de estoque no core. Correção: o ADR não é "só apresentação" — o motor ganha o modo
  fechado-principal; o ledger em si (razão em unidade fina) continua intacto (ADR-001).

## Action Items (após aprovação)

1. [x] **Owner aprovou** o ADR e a migration do enum (2026-07-22).
2. [x] Migration `0013` (`ALTER TYPE "UnitType" ADD VALUE 'BARRA'`) aplicada no Supabase.
3. [x] `packages/core` (parte 1): `isValidMeterStep`, `metersFromWhole`, `splitWholeAndRemainder` + testes.
4. [ ] `packages/core` (parte 2): `isClosedPrimary` + resolvedor fechado (preço + débito em metros da
       barra × do metro), testes.
5. [x] `packages/shared`: `BARRA` no enum + rótulo; o cadastro coleta por barra (a validação do passo
       de 0,5 m fica no core/API + PDV).
6. [x] `apps/api`: `POST /orders` usa `closedStockMeters` p/ unidade fechada (barra ⇒ `qtd × tamanho`;
       metro ⇒ `qtd`) e valida o passo de 0,5 m no online. Cancelamento/devolução usam `baseQuantity` (metros).
7. [x] `apps/web`: **PDV** (padrão barra inteira + "por metro" 0,5), **cadastro** (bloco barra invertido),
       **Estoque** (saldo "X barras + Y m" + entrada em barras), **ProductDetail** (leitura/edição invertida),
       cache offline já traz os campos. *(Comprovante usa o snapshot da unidade vendida — barra/metro.)*
8. [x] Gates: core **156/156**, typecheck api+web ✅, build web ✅. **NO AR:** API `5c426eb7` + web
       `0041891a`; smoke health/login 200. **Falta:** E2E do Owner.

## Relacionadas

- **[ADR-013](./ADR-013-venda-em-unidade-alternativa.md)** — o motor de unidade alternativa que este ADR
  **reapresenta** (não substitui). Convenção antiga: base fina como principal; nova: fechado como principal.
- **[ADR-001](./ADR-001-consistencia-de-estoque.md)** — o ledger segue em unidade fina (metro); **sem
  mudança** na razão de estoque.
