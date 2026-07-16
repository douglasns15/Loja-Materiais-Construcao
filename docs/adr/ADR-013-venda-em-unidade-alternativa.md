# ADR-013 — Venda em unidade alternativa (segundo preço: rolo fechado × por metro)

- **Status:** **Aceito — Opção A, IMPLEMENTADO e VALIDADO (2026-07-16).** No ar (API `4f19776c` + web
  `98453ac5`); E2E do usuário conferido — venda por rolo baixou 200 m (2 × 100) e o cancelamento
  estornou 200 m (não 2), provando o snapshot `baseQuantity`. Migrations `0008` + `0009` aplicadas.
- **Data:** 2026-07-15 (implementado/validado 2026-07-16)
- **Contexto de fase:** Fase 3, item **EF-3** (última fatia do módulo de estoque fino; EF-1 e EF-2 já no ar).
- **Deciders:** Owner do produto (pendente).

> ⚠️ **Este ADR implica alteração de banco.** As opções abaixo mudam o schema (colunas novas em
> `Product` **ou** uma tabela nova). **Nada será codado nem migrado até a escolha ser aprovada.**
> O objetivo aqui é **decidir no papel** qual modelagem seguir.

---

## Contexto

Hoje um produto tem **uma** unidade de venda (`Product.unit`) e **um** preço (`Product.salePrice`). O
PDV vende sempre nessa unidade, dá baixa de `stockQty` na razão de 1:1 e o comprovante imprime essa
unidade. Isso não cobre um caso comum de material de construção:

> **Vender o mesmo produto em duas embalagens, com preços diferentes.** Ex.: **fio/cabo** vendido
> **por metro** (avulso, mais caro por metro) **ou** como **rolo fechado** (ex.: 100 m, mais barato
> por metro). Também vale para cabo, corda, mangueira, tela em rolo, arame etc.

Não é "mais um campo": mexe no **motor de venda**. Precisamos decidir **como o segundo preço e a
conversão são modelados** para depois tocar, com segurança, quatro pontos:

1. **PDV** — o operador escolhe **metro** ou **rolo** ao adicionar o item; o preço muda conforme a escolha.
2. **Baixa de estoque (ADR-001)** — o estoque é único e físico. Vender **1 rolo** precisa debitar
   **100 m** do mesmo saldo; vender **5 m** debita **5 m**. Ou seja: **uma unidade-base para o estoque**
   e um **fator de conversão** para a embalagem.
3. **Comprovante** — a nota deve mostrar o que o cliente comprou ("1 rolo (100 m)" vs. "5 m").
4. **Segundo preço** — o preço do rolo **não** é `salePrice × fator` (o fechado sai mais barato). É um
   **preço próprio**, cadastrado à parte.

**O que já existe no schema** (`model Product`, conferido em `packages/db/prisma/schema.prisma`):

- `unit UnitType` e `salePrice Decimal(12,4)` — a unidade e o preço **primários** (base).
- **`conversionFactor Decimal(10,4)?`** — **já existe** ("1 milheiro = 1000 unidades → 1000"). O mesmo
  conceito serve para "1 rolo = 100 metros → 100". **Sem preço próprio associado a ele hoje.**
- `UnitType` já inclui `ROLL`, `BAG`, `THOUSAND`, `METER`, `SQUARE_METER`… (não falta enum novo).
- `OrderItem` já faz **snapshot** de `unit`, `quantity`, `unitPrice` e `total` no momento da venda.
- `StockMovement` é a **razão em unidade-base** (fonte de verdade do estoque, ADR-001).

**Convenção que ambas as opções assumem:** `stockQty` e `salePrice`/`unit` são a **unidade-base**
(a mais fina — no exemplo, **metro**). A embalagem fechada (rolo) é a **unidade alternativa**, definida
por um **fator** (metros por rolo) e um **preço próprio**. A baixa de estoque é sempre convertida para
a base; o `StockMovement` continua em unidade-base (nenhuma mudança na semântica do ledger).

---

## Opções de modelagem

### Opção A — Segundo preço + `conversionFactor` (mínima, reusa o que já existe)

Reaproveita o `conversionFactor` (já no schema) como **tamanho da embalagem alternativa** e adiciona
**um segundo preço** + **a unidade alternativa** ao próprio `Product`.

**Migration (aditiva, `Product`):**

| Coluna | Tipo | Papel |
|---|---|---|
| `altUnit` | `UnitType?` (nullable) | Unidade da embalagem fechada (ex.: `ROLL`). |
| `altSalePrice` | `Decimal(12,4)?` (nullable) | Preço **próprio** de 1 embalagem fechada (ex.: R$ do rolo). |
| *(reusa)* `conversionFactor` | já existe | Tamanho da embalagem em unidade-base (ex.: 100 m/rolo). |

- **Semântica:** produto com `altUnit` + `altSalePrice` + `conversionFactor` preenchidos ⇒ o PDV
  oferece **dois modos**: *por metro* (`unit`/`salePrice`, baixa = qtd) e *rolo fechado*
  (`altUnit`/`altSalePrice`, baixa = qtd × `conversionFactor`). Vazio ⇒ produto normal de uma unidade só.
- **Venda/estoque:** `OrderItem` já guarda `unit`+`quantity`+`unitPrice` (snapshot); o `StockMovement`
  registra a baixa **em unidade-base** (qtd × fator quando for rolo) — **nenhuma coluna nova em
  `OrderItem`/`StockMovement`** (o fator é conhecido no momento da venda).
- **Prós:** migration mínima (2 colunas nullable, RLS inalterada — igual ao `popularName` da EF-1);
  reusa `conversionFactor`; cadastro simples (mais 2 campos); PDV = um seletor de 2 opções; casa com o
  ethos cost-zero/minimalista do projeto (mesma lógica do "banco canônico, UI formata").
- **Contras:** **teto de exatamente 2 unidades** (base + 1 alternativa) — não cobre uma 3ª embalagem
  (ex.: metro + meia-bobina + rolo); sobrecarrega o significado de `conversionFactor` (milheiro **e**
  embalagem); a decisão "qual é a unidade-base" precisa ficar clara no cadastro.

### Opção B — Estrutura de "embalagem" (tabela `ProductPackaging`: label + tamanho + preço)

Modela cada forma de vender como uma **linha própria** numa tabela filha de `Product`.

**Migration (tabela nova + RLS):**

```
model ProductPackaging {          // "embalagem / forma de venda"
  id           Uuid  @id
  tenantId     Uuid                // denormalizado p/ RLS (padrão ADR-003)
  productId    Uuid
  label        VarChar(60)         // "Por metro", "Rolo fechado", "Meia-bobina"
  unit         UnitType
  factorToBase Decimal(12,4)       // qtos da unidade-base equivalem a 1 desta (metro=1, rolo=100)
  price        Decimal(12,4)       // preço próprio desta embalagem
  isDefault    Boolean
  sortOrder    Int
  isActive     Boolean
  // + RLS policy por tenantId, índice [tenantId, productId]
}
```

- **Semântica:** o `Product` mantém unidade-base + `stockQty`; **cada embalagem** é "N unidades-base a
  um preço". O PDV lista as embalagens ativas; a baixa usa `factorToBase`.
- **Prós:** **N unidades de venda** (metro, rolo, meia-bobina, caixa…), sem teto; semântica limpa
  (nada sobrecarregado); extensível (código de barras por embalagem no futuro, promoções por embalagem).
- **Contras:** **tabela nova + política RLS + índice** (migration maior); mais UI (gerir a lista de
  embalagens no cadastro); mais joins nas leituras; **peso desproporcional** para o caso comum de 2
  preços que é o que o EF-3 pede hoje.

---

## Decisão (aprovada 2026-07-15)

**Opção A** como primeiro corte do EF-3. Racional:

- O requisito concreto do EF-3 é **exatamente dois preços** (rolo × metro). A Opção A entrega isso com
  a **menor migration possível** (2 colunas nullable, aditivas, RLS intacta — mesmo padrão validado na
  EF-1/`popularName`), **reusando `conversionFactor`** que já foi desenhado para "N base por embalagem".
- Segue a mesma disciplina das decisões anteriores: escolher o **mínimo que resolve o fluxo real** e
  deixar a estrutura maior documentada como evolução (igual ao ADR-011, que preferiu idempotência pela
  PK ao ledger dedicado até haver necessidade real).
- **A Opção B fica registrada como a evolução natural**: no dia em que um produto precisar de uma **3ª
  forma de venda**, promove-se para a tabela `ProductPackaging` (migração de dados trivial: `Product`
  base + `altUnit/altSalePrice` viram 2 linhas de packaging). Nada na Opção A impede essa migração.

> Se o Owner já enxerga **3+ embalagens** como requisito próximo (não só rolo × metro), aí a Opção B se
> paga desde já e evita a migração dupla. **Essa é a pergunta-chave da aprovação.**

---

## Impacto no banco (a aprovar)

- **Opção A:** `ALTER TABLE products ADD COLUMN alt_unit … , ADD COLUMN alt_sale_price …` — **2 colunas
  nullable**, aditivas, **sem alterar RLS** (as políticas de linha da 0002 já cobrem colunas novas) e
  **sem tocar dados existentes** (produtos atuais ficam com os campos vazios = comportamento atual).
  Backward-compatible. Migration via `migrate diff` + `migrate deploy` (padrão do projeto, free tier).
- **Opção B:** **tabela nova** `product_packaging` + **política RLS** própria (isolamento por `tenantId`)
  + índice — migration maior, mas ainda aditiva (não altera tabelas existentes).

**Nenhuma das duas será escrita como migration até a aprovação.**

---

## Consequências

- **PDV:** ao adicionar um produto com unidade alternativa, aparece um **seletor** (metro × rolo na
  Opção A; lista de embalagens na Opção B). O preço e a projeção de baixa de estoque seguem a escolha.
- **Estoque (ADR-001):** a baixa é sempre convertida para a unidade-base antes do `StockMovement` —
  **a razão do estoque não muda**, só passa a receber `qtd × fator` quando a venda é na embalagem.
- **Comprovante:** o item precisa imprimir a embalagem vendida ("1 rolo (100 m)") — reusa o snapshot de
  `OrderItem.unit`/`quantity`; a Opção B pode guardar também o `label`.
- **Núcleo puro (`packages/core`):** entra uma função pura de **conversão embalagem→base** e de **preço
  efetivo**, testada com Vitest (regra 2 do `CLAUDE.md`) antes de tocar o PDV.
- **Fila offline:** venda segue append-only (ADR-011) — a unidade alternativa é só mais um campo do
  snapshot do item; **não muda o protocolo de sync**.

---

## Action Items (após aprovação)

1. [x] **Owner escolheu a Opção A** (2026-07-15) — 2 preços bastam por ora; Opção B fica como evolução.
2. [x] **Migration `0008_alt_sale_unit_ef3` aplicada** (2026-07-15) via `migrate deploy` — 2 colunas
       nullable em `products` (`altUnit`, `altSalePrice`); `migrate status` → up to date; client regenerado.
3. [x] **Funções puras em `packages/core` + testes (2026-07-15):** `hasAltUnit`, `resolveSaleUnit`
       (fallback de segurança ALT→BASE), `toBaseQuantity` (qtd × `conversionFactor`) e
       `effectiveBaseUnitPrice` (preço/unidade-base — mostra a economia do rolo). **+14 testes → 82/82.**
4. [x] **2ª migration `0009_order_item_base_quantity_ef3` aplicada** (2026-07-15) — `OrderItem.baseQuantity`
       (nullable) para o estorno de estoque em unidade-base no cancelamento/devolução ser robusto mesmo
       se o `conversionFactor` mudar depois. Aprovada pelo Owner. Estorno usa `baseQuantity ?? quantity`
       (pedidos antigos intactos).
5. [x] **Código do EF-3 escrito e nos gates (2026-07-15):**
       - `packages/shared`: `saleMode` no item de venda + `altUnit`/`altSalePrice` no produto.
       - `apps/api` (`POST /orders`): baixa e `StockMovement` em unidade-base (`toBaseQuantity`), snapshot
         `baseQuantity`/`unit` vendida no `OrderItem`; cancelamento/devolução estornam em unidade-base.
       - `apps/web` **cadastro** (`/products`): fieldset "unidade alternativa" (embalagem + tamanho + preço).
       - `apps/web` **PDV** (`/venda`): botões "base × embalagem" no picker, linha do carrinho com a base
         equivalente, trava de estoque em unidade-base, `saleMode` no payload (online e offline), cache do
         catálogo estendido; **comprovante** imprime a embalagem vendida.
       Gates: core 82/82, api tsc ✅, web tsc ✅, build web (18 rotas) ✅.
6. [x] **Deploy (API `4f19776c` + web `98453ac5`) + E2E do usuário VALIDADO (2026-07-16).** Produto
       "Cabo Flexível 2,5mm — TESTE 2 EF1" (metro R$2 / rolo 100 m R$150, estoque 500): venda por metro
       Saída 5; venda por rolo (2×) Saída **200**; cancelamento Entrada **200** (estorno em unidade-base,
       não 2); saldo 500−5−200+200 = 495. Casos extras 11–13 (margem efetiva, dois modos no carrinho,
       produto comum inalterado) OK. **ADR fechado; `ROADMAP.md` e registro de testes atualizados.**

---

## Relacionadas

- **[ADR-001](./ADR-001-consistencia-de-estoque.md)** — a baixa da embalagem converte para a
  unidade-base; `StockMovement` segue sendo a razão em unidade-base.
- **[ADR-011](./ADR-011-fila-de-sincronizacao-offline.md)** — precedente de "escolher o mínimo que
  resolve o fluxo real e documentar a evolução" (PK vs. ledger); a venda com unidade alternativa
  continua append-only.
- **EF-1 / `popularName`** — precedente da **migration aditiva nullable com RLS intacta** (padrão da Opção A).
