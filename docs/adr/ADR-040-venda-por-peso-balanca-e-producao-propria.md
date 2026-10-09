# ADR-040 — Venda por peso, etiqueta de balança e produto sem controle de estoque

- **Status:** **Aceito** (2026-09-30) — migration aprovada **com `Product.ncm`**; ver "Decisão do Owner" abaixo.
- **Data:** 2026-09-29 (proposta) · 2026-09-30 (aceite)
- **Deciders:** Owner do produto.

> **Decisão do Owner (2026-09-30):** aprovada a migration única ADR-039 + ADR-040 **incluindo `Product.ncm`**.
> O campo NCM fica **visível no cadastro de qualquer loja**, de qualquer ramo — **não** é gated por ramo/módulo
> (é pré-requisito fiscal geral, não recurso de alimentos).
- **Contexto de fase:** implantação do Mercadinho + Sorveteria + Rotisseria. Depende do
  [ADR-039](./ADR-039-ramo-da-loja-e-modulos.md) (módulo `SCALE_LABEL`).

---

## Contexto

Verificado no código em 2026-09-29, três coisas impedem hoje a loja de alimentos de vender:

1. **Não há venda fracionada por kg.** O stepper do carrinho só aceita decimal quando a linha é metro de
   barra/rolo (`isMeterLine` → passo 0,5; demais → passo 1 — `apps/web/app/(app)/venda/page.tsx`). Não se vende
   0,350 kg de sorvete nem 1,2 kg de comida.
2. **A venda trava sem estoque.** `POST /orders` bloqueia online quando `disponível < quantidade`
   (`apps/api/src/routes/orders.ts`, "Estoque insuficiente"). Frango assado, marmita e sorvete são **produzidos
   no dia**; exigir uma Entrada antes de cada venda é inviável no balcão.
3. **Não há leitura de etiqueta de balança.** Sorvete, comida por kg, frios e hortifruti são pesados numa
   balança que **imprime uma etiqueta com código de barras**; o caixa só passa o leitor.

---

## Como funciona a etiqueta de balança (referência para o Owner)

A balança etiquetadora (Toledo Prix, Filizola, Urano, Elgin…) imprime um **EAN-13 que começa com `2`** — faixa
que a GS1 reserva para **uso interno da loja** (nunca colide com código de fabricante). O código carrega **só
duas informações**: **qual produto** (o código dele na balança, "PLU") e **quanto** (o preço total **ou** o
peso). Nome, preço/kg, data e validade vão **impressos em texto** na etiqueta, não no código.

Layout mais comum no Brasil (varia por configuração da balança):

```
 2   0123   0   002468   4
 │    │     │     │      └─ dígito verificador do EAN-13
 │    │     │     └──────── preço total em centavos (R$ 24,68)  — ou peso em gramas, conforme config
 │    │     └────────────── dígito de preenchimento/verificação (depende do layout)
 │    └──────────────────── código do produto na balança (PLU) — 4 ou 5 dígitos
 └───────────────────────── "2" = código interno de balança
```

Exemplo: sorvete de PLU `0123` a R$ 59,90/kg, 412 g → total R$ 24,68 → etiqueta `2012300024684`. O PDV lê,
acha o produto de código de balança `0123`, lança **R$ 24,68** e baixa **0,412 kg** do estoque (24,68 ÷ 59,90).

**"Funciona com qualquer balança?"** — Para **etiquetadora, sim**: o PDV não conversa com a balança, só lê o
código impresso, e o formato é o mesmo em todas as marcas. Só precisamos saber **2 parâmetros**, que ficam
configuráveis por loja: nº de dígitos do PLU (4 ou 5) e se o valor embutido é **preço** ou **peso**. Os produtos
(PLU, nome, preço/kg) são cadastrados **na balança** pelo software do fabricante (ou no teclado dela); numa
fatia futura o NexoLoja pode **exportar** essa lista no formato de cada marca (ex.: Toledo MGV).

**Balança de checkout ligada ao computador** (o caixa pesa e o peso entra sozinho no PDV) é **outro caso**:
o protocolo serial muda por marca e, numa PWA, só funciona via Web Serial no **Chrome/Edge de computador**
(não em celular/tablet). Fica **fora** desta ADR; enquanto isso, o PDV aceita **digitar o peso**.

---

## Decisão

### 1. Venda fracionada por kg e litro — core, qualquer ramo

- Linhas cuja unidade de venda é `KILOGRAM` ou `LITER` aceitam **3 casas decimais** (botões −/+ andam 0,1; a
  digitação é livre até 3 casas, ex.: `0,412`). Função pura em `packages/core` (`quantityRuleFor(unit) → {step, decimals, min}`)
  substitui os `isMeterLine`/`step` espalhados, com testes Vitest.
- Estoque já é `Decimal(12,4)` — **nenhuma mudança de banco** para isto.

### 2. Produto sem controle de estoque — `Product.trackStock` (core)

- Novo campo `trackStock Boolean @default(true)`. Desligado ⇒ a venda **não trava** e **não gera
  `StockMovement`** nem mexe em `stockQty` (o produto simplesmente não tem estoque, como um serviço).
- **Coerente com o ADR-001:** a regra "toda mudança de estoque = movimento" continua valendo — o produto sem
  controle **não tem** estoque para mudar. Religar o controle começa do zero com uma Entrada (contagem).
- Rotisseria/sorveteria usam no dia 1. Quando o módulo `RECIPES` existir (produção: frango cru → assado), aí
  sim a produção vira movimento — decisão futura.
- **Alternativa rejeitada:** "permitir estoque negativo" por produto. Mantém movimentos, mas enche telas e
  alertas de saldos negativos sem significado e mascara furo real de estoque nos produtos controlados.

### 3. Etiqueta de balança — módulo `SCALE_LABEL`

- Novo campo `Product.scaleCode VarChar(6)?` (o PLU), **único por loja** entre produtos não excluídos
  (índice parcial). Só aparece no cadastro quando o módulo está ligado.
- Layout por loja em `TenantModule.config` do `SCALE_LABEL` (sem migration): `{ pluDigits: 4|5, value: 'PRICE'|'WEIGHT' }`.
- Função pura `parseScaleBarcode(code, layout) → { plu, priceCents } | { plu, grams } | null` em `packages/core`,
  com testes (DV inválido, prefixo ≠ 2, layouts 4/5 dígitos, preço × peso).
- No PDV, a leitura de um EAN-13 iniciado em `2` (com módulo ligado) tenta primeiro a balança:
  - **Valor = preço:** o **total da etiqueta manda** (é o que o cliente viu impresso); quantidade = total ÷ preço/kg,
    arredondada a 3 casas, só para baixar estoque.
  - **Valor = peso:** quantidade = gramas ÷ 1000; total = quantidade × preço/kg atual do cadastro.
- **Recomendação ao comprar a balança:** layout **preço** (sem divergência de centavo entre etiqueta e caixa).

### 4. "Vendido inteiro também" — produto por peso com preço do inteiro (decisão do Owner 2026-10-01)

- Pergunta do Owner: item pesado na hora (frango assado, melancia, queijo) deve ter o **preço do quilo** e,
  opcionalmente, o **preço do item inteiro**. Padrão de mercado confirmado: item de peso variável é cadastrado
  pelo **preço do quilo**; o "inteiro a preço fixo" é uma **segunda forma de venda** do mesmo produto (o mercado
  costuma usar dois códigos; aqui fica num produto só, à escolha do caixa).
- **Sem migration e sem motor novo:** reusa a venda em unidade alternativa ([ADR-013](./ADR-013-venda-em-unidade-alternativa.md))
  com `altUnit = UNIT` — `salePrice` = preço do kg/L, `altSalePrice` = preço do inteiro, `conversionFactor` = **peso
  médio** (só para baixar estoque e contar quantidade nos relatórios). Funções puras no core: `isWeighedUnit`,
  `wholeOfWeighedEligible`, `sellsWholeOfWeighed`.
- **Cadastro:** produto em kg/L ganha o bloco visível "Vendido inteiro também" (preço do inteiro + peso médio; os
  dois juntos ou nenhum) e os rótulos viram "Preço do quilo"/"Custo do quilo". Embalagem diferente de `UNIT` já
  gravada (dado legado) segue no cadastro genérico.
- **PDV:** botões "+ kg · R$ 39,90" (digita o peso, ADR-040 §1) e "+ inteiro · R$ 45,00" (preço fixo, passo 1).

#### 4.1 Estoque de pesados por peças (aprovado pelo Owner 2026-10-01, achado do E2E da #5) — NO AR 2026-10-01 (API `952ae59c`, web `ea2b5931`; E2E pendente)

O Owner precisa saber **quanto tem** de frango/carne: a mercadoria chega em **peças**, mas a régua é **kg**.
- **Saldo sempre em kg/L** (o ledger não muda). Telas de saldo (Estoque, detalhe de estoque, detalhe do produto,
  busca do PDV) mostram **3 casas** e, se o produto vende inteiro, **"≈ N peças"** = saldo ÷ peso médio
  (`approxPieces`).
- **Entrada por peças** (tela Estoque, produto kg/L): alterna "Peso total" × "Peça a peça" — digita o peso de cada
  peça (Enter adiciona), o sistema soma (`sumPieceWeights`) e grava UMA Entrada em kg; o detalhe vai no motivo
  ("3 peças: 4,200 + 3,900 + 4,400 kg", `pieceEntryLabel`, ≤ 150). **Sem mudança de API/contrato.**
- **Última peça** (`wholeOfWeighedSale`): o inteiro baixa o peso MÉDIO, mas a peça real pode pesar menos (1,1 kg
  no estoque, média 1,2). Libera se `inteiros ≤ ceil(disponível ÷ média)` e a baixa **para no disponível** (zera,
  não fica negativo). Mesma regra no PDV (cliente) e no `POST /orders` (servidor, online).
- Peso também com 3 casas no carrinho/resumo/cupom/relatórios (`formatWeight`, shared).

---

## Impacto no banco (aprovado — regra 1)

> **APLICADA 2026-09-30 — migration `0041`**, a mesma do [ADR-039](./ADR-039-ramo-da-loja-e-modulos.md). Os 721
> produtos existentes seguem `trackStock = true`, sem PLU/NCM.

Aditiva, na **mesma migration do [ADR-039](./ADR-039-ramo-da-loja-e-modulos.md)**:

1. `ALTER TABLE products ADD COLUMN "trackStock" BOOLEAN NOT NULL DEFAULT true` — todo produto existente segue controlado.
2. `ALTER TABLE products ADD COLUMN "scaleCode" VARCHAR(6)` + índice único `(tenantId, scaleCode)`.
   **Ajuste na implementação:** índice único **comum**, não parcial — o Prisma 6 não expressa `WHERE` e um
   índice parcial em SQL cru seria revertido pelo próximo `migrate diff`. NULLs não colidem no Postgres; o
   soft-delete do produto **libera o PLU** (grava `scaleCode = null`) na Fatia 3.

3. `ALTER TABLE products ADD COLUMN "ncm" VARCHAR(8)` — **aprovado pelo Owner (2026-09-30)**. Não é usado no
   cálculo agora, mas a NFC-e vai exigir, e a planilha de importação ([ADR-041](./ADR-041-importacao-de-catalogo-por-planilha.md))
   e o cadastro já o coletam. Pré-preenchido a partir de `ProductCatalog.ncm` quando o EAN casa. **Visível no
   cadastro de toda loja** (sem gating de ramo).

---

## Consequências

- `POST /orders` passa a respeitar `trackStock` (não trava, não movimenta) — também no caminho offline (ADR-011)
  e na devolução/troca (ADR-033: devolver item sem controle não gera Entrada).
- Relatórios de estoque/reposição (Central de Alertas, ADR-029) ignoram produtos sem controle.
- Custo/margem continuam valendo (vêm do cadastro/snapshot, não do estoque).

## Fatias

1. **Fatia 1 — kg fracionado** (sem migration): `quantityRuleFor` + PDV/carrinho/offline. Dá para ir antes de tudo.
   **IMPLEMENTADA 2026-09-30** (só `packages/core` + `apps/web`; sem API/migration/contrato): core ganhou
   `quantityRuleFor`/`roundQuantity`/`isValidQuantity`/`stepQuantity` (+`quantidade.test.ts`); no PDV a linha
   kg/L anda de 0,1 nos botões, aceita até 3 casas digitadas, mostra "kg"/"R$ …/kg"; produto por peso que entra
   no carrinho sem peso informado recebe o foco no campo da linha (Enter devolve à busca); resumo e cupom imprimem
   "0,412 kg". Corte de barra/rolo (0,5 m) e pacote aberto (inteiro) preservados byte a byte na regra. Gates:
   core 409 ✅, web tsc 0 + build ✅. **NO AR 2026-09-30 (web `dbc6a24a`)**; E2E do Owner pendente. Fica para a Fatia 2: a trava de estoque
   ainda vale (produto por kg precisa de saldo até existir `trackStock`).
2. **Fatia 2 — `trackStock`** (migration): cadastro ("Controlar estoque deste produto"), venda, devolução, alertas.
   **IMPLEMENTADA 2026-10-01** (coluna já existia pela `0041`; sem migration nova) **+ §4 "vendido inteiro"**. Core
   `tracksStock`/`sellableQty` (∞ p/ sem controle — fonte única da trava do PDV e do `POST /orders`) + testes
   (`semControleEstoque.test.ts`). API: `POST /orders` não trava nem baixa/reserva; cancelamento, devolução
   total/por item e troca não estornam e não geram defeituoso (condição vira `GOOD`); retirada (ADR-020) só
   registra; `POST /stock/movements` e `/adjust` recusam (400); NF-e atualiza custo/preço sem lançar Entrada;
   alertas de estoque, "vai faltar" e reposição do suporte ignoram; `POST /products` ignora `initialStock`;
   `PATCH` recusa desligar com reserva pendente (409). Web: interruptor no cadastro/edição (esconde mínimo/estoque
   inicial), detalhe mostra "Estoque: sem controle", PDV nunca trava e não mostra saldo (`stockQty` = "Infinity",
   espelhado no cache offline), Estoque esconde o produto das tabelas e dos seletores de Entrada/Ajuste. Doc §8.2
   atualizada (regra 7). Gates: core 434, shared 68, API tsc 0, web build.
   **NO AR 2026-10-01 (API `22042b01`, web `8cfe172e`)**; E2E do Owner pendente.
3. **Fatia 3 — etiqueta de balança** (migration + módulo): `scaleCode`, `parseScaleBarcode`, config do layout no
   painel, leitura no PDV. E2E com etiqueta impressa de verdade (ou gerada em tela para teste).
   **IMPLEMENTADA 2026-10-09** (sem migration nova): core `parseScaleBarcode`/`buildScaleBarcode`/`scaleLabelLine`/
   `normalizeScaleCode` (+`etiquetaBalanca.test.ts`, inclui varredura que garante o total impresso no centavo).
   Posições: PLU em 2–5 (4 dígitos, + 1 de preenchimento) ou 2–6 (5 dígitos); valor sempre em 7–12 (6 dígitos).
   **Layout PRICE:** quantidade = total ÷ preço/kg (3 casas) e o `unitPrice` da linha é ajustado na 4ª casa
   (`total ÷ quantidade`) para fechar exatamente no total impresso — sem desconto artificial (o PDV exibe, p.ex.,
   R$ 24,88/kg numa etiqueta de R$ 10,00 de um produto a R$ 24,90/kg). Cada etiqueta é uma linha própria do
   carrinho. PLU gravado sem zeros à esquerda; 409 próprio para PLU repetido; soft-delete libera o PLU. Layout no
   painel da plataforma (`config` do `SCALE_LABEL`), entregue ao PDV pelo `/me` (vale offline); padrão 4 + preço.
   Só produto por kg/L lê etiqueta. **Validar com a balança real** quando comprada (se o layout dela fugir destas
   posições, o parser ganha posições configuráveis).
4. **Futuro:** exportar PLUs para a balança; balança de checkout via Web Serial; `RECIPES`.

## Relacionadas

- [ADR-001](./ADR-001-consistencia-de-estoque.md) — estoque por movimento (preservado).
- [ADR-017](./ADR-017-unidade-fechada-como-principal-barra.md) / [ADR-030](./ADR-030-pacote-como-unidade-fechada.md) — regras de passo que a `quantityRuleFor` unifica.
- [ADR-025](./ADR-025-catalogo-global-ean.md) — `gtinKey`; o prefixo `2` nunca vai ao catálogo global (código interno).
