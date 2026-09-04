# ADR-030 — Pacote como unidade fechada (generaliza o ADR-017 para corte por unidade avulsa)

- **Status:** **Aceito e IMPLEMENTADO (2026-09-04), aguardando deploy + E2E do Owner.** Owner
  aprovou a migração do enum e o desenho (Pacote como unidade fechada, igual a Barra/Rolo).
- **Data:** 2026-09-04
- **Contexto de fase:** Fase 3, evolução do módulo de estoque fino. **Generaliza** o
  [ADR-017](./ADR-017-unidade-fechada-como-principal-barra.md) — não o substitui.
- **Deciders:** Owner do produto.

> ⚠️ **Este ADR implica alteração de banco** (um valor novo no enum `UnitType`). Pela regra 1 do
> `CLAUDE.md`, a migration só foi escrita/aplicada após aprovação — dada em 2026-09-04.

---

## Contexto

O Owner precisa cadastrar produtos vendidos em **pacote/caixa fechada** que também são **abertos e
vendidos por unidade avulsa**. Caso real: **Kit de cola quente** (SKU 8145 — Maria ConstruLar): o
pacote fechado tem **6 unidades**, mas a loja abre e vende a **unidade a R$ 2,00**.

Hoje isso não era possível:

1. **Não existia a unidade "Pacote"** no enum `UnitType` (só `UNIT, METER, …, ROLL, BARRA`).
2. O recurso de "unidade fechada como principal" (ADR-017) foi construído **só para Barra/Rolo**, e
   a subdivisão é sempre **por metro**, com corte mínimo de **0,5 m**.

O caso do pacote é **a mesma ideia** do ADR-017 (fechado como principal + corte avulso opcional),
mas a régua fina é a **unidade avulsa**, contada em **inteiros** — não existe "meio tubo de cola".

## A descoberta que simplifica (de novo)

O ADR-017 já provou que "fechado como principal + corte fino" tem **uma forma só no banco**: `unit`
= a unidade fechada, `salePrice`/`costPrice` = do fechado, `conversionFactor` = o tamanho na régua
fina, `altUnit` = a régua fina e `altSalePrice` = o preço do corte avulso (opcional). O **ledger
fica na régua fina** por precisão.

Para o pacote muda **só o que a régua fina é**:

| | Barra/Rolo (ADR-017) | **Pacote (ADR-030)** |
|---|---|---|
| Régua fina (`altUnit`) | `METER` | **`UNIT`** |
| Passo do corte avulso | 0,5 m | **1 unidade** (inteira) |
| `conversionFactor` | tamanho em metros | **unidades por pacote** |
| Ledger / estoque | em metros | **em unidades avulsas** |
| Saldo exibido | "49 barras + 4 m" | **"3 pacotes + 2 un"** |

Todo o resto (motor de preço, débito de estoque, entrada em unidades fechadas, comprovante) é
**reusado sem duplicação**.

## Decisão

1. **Novo valor de enum `PACK`** (migration `0037`, aditiva — `ALTER TYPE "UnitType" ADD VALUE
   'PACK'`; não toca tabelas, dados nem RLS).
2. **Pacote é unidade fechada de primeira classe**, igual a Barra/Rolo: o operador **cadastra,
   compra, precifica e enxerga em pacotes**. Preço/custo do cadastro = do **pacote inteiro**;
   `conversionFactor` = **unidades por pacote**; **preço por unidade avulsa** (opcional) em
   `altSalePrice`. Vazio ⇒ só vende o pacote fechado (sem opção avulsa no PDV).
3. **A régua fina do pacote é a UNIDADE** (`altUnit = UNIT`), com **passo 1**. Barra/rolo seguem em
   metro com passo 0,5. Isso é o único ponto de negócio que diverge — encapsulado em duas funções
   puras no core: `closedSaleStep(unit)` (1 p/ pacote, 0,5 p/ barra/rolo) e `closedFineUnit(unit)`
   (`UNIT` p/ pacote, `METER` p/ barra/rolo).
4. **Estoque em unidades avulsas** (a régua fina), desacoplado do `unit` (`PACK`) — mesma razão do
   ADR-017 (precisão): a venda avulsa baixa 1 unidade; a venda do pacote baixa `conversionFactor`
   unidades. O ledger (ADR-001) segue em unidade fina.

## Mapa de dados (reuso do schema — sem coluna nova)

| Campo | Passa a guardar (pacote) |
|---|---|
| `unit` | **`PACK`** — a unidade fechada, principal |
| `salePrice` | **preço do pacote** (fechado) — NOT NULL |
| `costPrice` | **custo do pacote** — NOT NULL |
| `conversionFactor` | **unidades por pacote** (ex.: 6) |
| `altUnit` | **`UNIT`** — a régua fina (avulsa) |
| `altSalePrice` | **preço por unidade avulsa** — **nullable ⇒ opcional** (vazio = só pacote) |
| `stockQty` / `StockMovement` | **em UNIDADES avulsas** — desacoplado do `unit` |

> **Detecção:** `isClosedPrimary` passou a incluir `PACK` (via `CLOSED_PRIMARY_UNITS =
> ['BARRA','ROLL','PACK']`). Para esses, o estoque é lido/gravado na régua fina e a venda do fechado
> baixa `qtd × conversionFactor`.

## Consequências / superfície tocada

- **`packages/core`:** `CLOSED_PRIMARY_UNITS` += `PACK`; novas `closedSaleStep` e `closedFineUnit`;
  `isValidMeterStep` já era parametrizável no passo (chamadas passam `closedSaleStep(unit)`). As
  demais funções (`metersFromWhole`, `splitWholeAndRemainder`, `resolveClosedSale`,
  `closedStockMeters`) já eram agnósticas à régua fina — reusadas. **+13 testes** (`pacote.test.ts`;
  core 354/354).
- **`packages/shared`:** `PACK` no enum + rótulo "Pacote"; novo helper de apresentação
  `closedUnitTerms(unit)` (artigo/substantivo/régua fina concordados), consumido por todas as telas
  para não espalhar `unit === 'ROLL'`.
- **`apps/api`:** `POST /orders` valida o passo do corte avulso com `closedSaleStep(p.unit)` (pacote
  ⇒ inteiro) e mensagem de erro específica. Débito de estoque via `closedStockMeters` (já genérico).
- **`apps/web`:** cadastro (`/products` + `ProductDetail`), **Estoque** (saldo "X pacotes + Y un" +
  entrada em pacotes), **PDV** (`/venda` — botão "+ pacote (6 un)" e "+ por unidade · R$/un", passo 1
  no stepper, `baseUnitType = UNIT`), comprovante e espelho offline reusam os mesmos campos.
- **Migration `0037`:** `ALTER TYPE "UnitType" ADD VALUE 'PACK'` — aditiva; aplicada via `migrate
  diff` + `migrate deploy` (padrão do projeto). Nenhuma coluna nova.

## Alternativa considerada e descartada

**Inverter (unidade avulsa como principal + pacote como embalagem alternativa, EF-3 clássico).**
Reusaria o motor do ADR-013 sem generalização, mas: (a) a entrada de estoque pensaria em unidades
soltas, antinatural para caixa fechada; (b) criaria **dois comportamentos** para o mesmo conceito
("embalagem que abre") — o oposto do que o Owner escolheu para Barra/Rolo. Descartada por
consistência: como o mercado funciona, a **caixa fechada é a cara do produto** e abrir é a exceção.

## Relacionadas

- **[ADR-017](./ADR-017-unidade-fechada-como-principal-barra.md)** — o motor de unidade fechada que
  este ADR **generaliza** (barra/rolo por metro → + pacote por unidade avulsa).
- **[ADR-013](./ADR-013-venda-em-unidade-alternativa.md)** — o motor EF-3 subjacente.
- **[ADR-001](./ADR-001-consistencia-de-estoque.md)** — o ledger segue em unidade fina; **sem
  mudança** na razão de estoque.
