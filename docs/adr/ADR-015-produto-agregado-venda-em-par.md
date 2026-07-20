# ADR-015 — Produto agregado: venda em par com preço promocional (parafuso + bucha)

- **Status:** **Aceito — IMPLEMENTADO e NO AR (2026-07-20), aguardando o E2E do Owner.** Migration
  `0011` aprovada e aplicada; API `95498aff` + web `bf20b770`. Core 103/103.
- **Data:** 2026-07-20
- **Contexto de fase:** Fase 3, fatia **PA** (produto agregado), logo após a fatia EP
  (visualizar/editar cadastro de produto + Fabricante).
- **Deciders:** Owner do produto.

---

## Contexto

Pedido do Owner, com o caso concreto:

> Cadastro **Parafuso nº10** (R$ 0,60) e **Bucha nº10** (R$ 0,20) como **dois produtos
> independentes**, cada um com seu preço e seu estoque. Mas quando o cliente leva **o par**,
> o conjunto sai por **R$ 0,70**. Quero indicar no cadastro qual é o item agregado e o preço do
> par, e no PDV poder vender o item **individual** ou **com o agregado**.

Não é um desconto genérico nem uma promoção por quantidade: é um **segundo preço para um par
específico de produtos**, análogo ao que o ADR-013 fez para embalagens do *mesmo* produto — só que
agora entre **produtos diferentes**, cada um com estoque próprio.

**O que já existe e não muda:**

- `Product` tem `salePrice`/`stockQty` próprios — os dois produtos continuam independentes.
- `OrderItem` faz **snapshot** de `productName`/`unit`/`quantity`/`unitPrice`/`total` por item.
- **O motor de estoque percorre `OrderItem`**: `POST /orders` debita item a item (ADR-001), e o
  **cancelamento** e a **devolução** (ADR-006) estornam item a item. Esse detalhe decide o desenho.

---

## Decisão central: o par grava **dois `OrderItem`** com o preço rateado

Vender 1 par por R$ 0,70 grava **duas linhas** no pedido, e não uma linha "kit":

| `OrderItem` | Qtd | `unitPrice` | Origem |
|---|---|---|---|
| Parafuso nº10 | 1 | R$ 0,5250 | 0,60 ÷ 0,80 × 0,70 |
| Bucha nº10 | 1 | R$ 0,1750 | 0,20 ÷ 0,80 × 0,70 |
| **Total** | | **R$ 0,70** | fecha exato |

**Rateio proporcional ao preço avulso**, com o **resíduo do arredondamento no item mais caro** para o
total do par fechar exato no centavo (função pura no core, testada).

**Por que rateio e não uma linha "kit":**

- **Estoque, cancelamento e devolução não mudam uma linha de código.** O par debita 1 parafuso **e** 1
  bucha porque são dois itens de verdade; o estorno reverte os dois pelo mesmo motor de sempre. Uma
  linha "kit" exigiria reescrever o débito (um item, dois produtos), o estorno e o `StockMovement`.
- **Relatórios por produto continuam honestos** — cada produto recebe a fatia real do faturamento e a
  margem sai correta. Numa linha "kit", o faturamento ficaria pendurado num pseudo-produto e a
  bucha apareceria como se nunca tivesse vendido.
- **Fila offline (ADR-011) intacta:** a venda segue append-only; o par é montado no cliente e chega
  como dois itens no envelope. **Nenhuma mudança no protocolo de sync.**

**Contrapartida aceita:** o preço unitário gravado é quebrado (R$ 0,5250). Isso é invisível para o
cliente — ver a decisão do comprovante abaixo — e o `Decimal(12,4)` do schema já comporta.

---

## Decisões do Owner (2026-07-20)

### 1. Escopo: **par (2 itens)**, não combo de N itens

Duas colunas em `products`, sem tabela nova. Um produto tem **no máximo um** agregado.

> **Evolução registrada:** se um dia surgir kit de 3+ (pia + torneira + sifão) ou vários combos por
> produto, promove-se para uma tabela `ProductCombo` + itens. A migração de dados é trivial (cada par
> vira um combo de 2). Mesmo racional do ADR-013 (Opção A agora, Opção B documentada).

### 2. Simetria: o par vale **dos dois lados**

Cadastrado uma vez (no parafuso), o par aparece tanto ao vender o **parafuso** quanto a **bucha** — é
o mesmo par e o mesmo preço. Grava-se **um lado só** (`pairedProductId` no parafuso) e o outro lado é
resolvido por consulta reversa. Assim é **impossível** os dois lados divergirem de preço.

### 3. Comprovante: **uma linha única**

O par imprime como **"Parafuso nº10 + Bucha nº10 (par) — R$ 0,70"**, mesmo com duas linhas no banco.
Justificativa do Owner: *comprado em outro momento, separado, o valor muda — mostrar uma linha só
evita questionamento no balcão.* O nome sai dos `productName` já gravados e o valor da soma dos dois
totais; **nada de novo precisa ser guardado para isso**.

**Consequência técnica:** para reimprimir uma venda antiga a partir do banco é preciso saber **quais**
itens formaram um par — imagine *2 pares + 1 parafuso avulso* na mesma venda. Daí a terceira coluna da
migration (`pairGroup` em `order_items`): itens do mesmo pedido com o mesmo grupo se imprimem juntos.

---

## Impacto no banco — migration `0011` (**a aprovar**)

Três colunas nullable, **aditivas**, **sem alterar RLS** (as políticas de linha da 0002 já cobrem
colunas novas — padrão validado em 0007/0008/0010) e **sem tocar dado existente** (produtos e pedidos
atuais ficam com os campos `NULL` = comportamento de hoje, inalterado).

| Tabela | Coluna | Tipo | Papel |
|---|---|---|---|
| `products` | `pairedProductId` | `uuid?` (FK → `products.id`) | O produto agregado (a bucha, cadastrada no parafuso). |
| `products` | `pairPrice` | `Decimal(12,4)?` | Preço **total do par** (R$ 0,70), não por item. |
| `order_items` | `pairGroup` | `SmallInt?` | Agrupa os itens vendidos como par no mesmo pedido (1, 2, 3…). `NULL` = item avulso. |

Mais um índice `products(tenantId, pairedProductId)` para a consulta reversa (simetria).

A FK é **auto-relação em `products`** com `ON DELETE SET NULL`: se o agregado for removido de vez, o
par simplesmente deixa de existir e o produto principal segue vendendo normal. (Na prática a exclusão
é **soft-delete** — ADR-004 —, então o caminho normal é a regra de negócio abaixo.)

---

## Regras de negócio (a implementar)

1. **Preço do par é o total do par**, rateado proporcionalmente ao preço avulso; resíduo no item mais
   caro. Função pura no `packages/core` com testes Vitest (regra 2 do `CLAUDE.md`) **antes** de tocar o PDV.
2. **Trava de estoque:** o par só é vendável se **ambos** os produtos tiverem saldo. N pares exigem
   N de cada. Reusa a trava existente, aplicada aos dois produtos.
3. **O par não se combina com a unidade alternativa (EF-3/ADR-013) neste corte** — par é sempre na
   unidade-base. Um produto com embalagem fechada não oferece o par no modo embalagem (evita a
   combinatória "2 rolos + 2 buchas por qual preço?" sem demanda real).
4. **Auto-referência proibida** (um produto não pareia consigo mesmo) — validado na API.
5. **Par duplicado invertido bloqueado:** se a bucha já aponta para o parafuso, cadastrar o inverso é
   recusado (senão haveria dois preços para o mesmo par). Guarda na API.
6. **Agregado soft-deleted ou inativo ⇒ o par não é oferecido** no PDV (o produto principal segue
   vendendo avulso, sem erro).
7. **Cancelamento e devolução:** nada a fazer — funcionam sozinhos, item a item. Um par cancelado
   estorna 1 parafuso e 1 bucha.
8. **Offline:** `pairedProductId`/`pairPrice` entram no espelho do catálogo (`CachedProduct`), então o
   par é vendável offline sem mudança no motor de sync.

---

## Consequências

- **Cadastro (`/products`):** dois campos novos — seletor do produto agregado (com busca) e preço do
  par —, tanto no formulário de criação quanto no painel de visualizar/editar da fatia EP.
- **PDV (`/venda`):** produto com par ganha a escolha **avulso × par**, no mesmo padrão visual do
  "base × embalagem" do EF-3. Escolher "par" adiciona **as duas linhas** ao carrinho, agrupadas.
- **Comprovante:** agrupa por `pairGroup` e imprime uma linha só (decisão 3).
- **Relatórios:** sem mudança — cada produto contabiliza sua fatia.
- **Histórico de vendas:** a venda mostra os itens do par agrupados, coerente com o comprovante.

---

## Action Items

1. [x] **Owner aprovou a migration `0011`** (2026-07-20) — 3 colunas + índice + FK auto-relação.
2. [x] **Migration `0011_product_pair` aplicada** via `migrate diff` + `migrate deploy`; `migrate diff
       --exit-code` → "No difference detected" (sem drift); client regenerado.
3. [x] **Funções puras no `packages/core` + testes (+21 → 103/103):** `splitPairPrice` (rateio com
       resíduo no item mais caro — a soma é **sempre exatamente** o preço do par, testado inclusive com
       dízima), `hasPair`, `pairAvailableQty` (menor dos dois saldos, nunca negativo) e
       `groupPairedItems` (une o par numa linha de exibição; grupo órfão vira item avulso — nunca some).
4. [x] **`packages/shared`:** `pairedProductId`/`pairPrice` no `createProductSchema` (e `null` no update
       para desfazer o par) + `pairGroup` no `saleItemSchema`.
5. [x] **`apps/api`:** `validatePair` (auto-referência, agregado inexistente/soft-deleted, par invertido
       duplicado) no `POST`/`PATCH /products`; `POST /orders` grava `pairGroup`. **Cancelamento e
       devolução não precisaram de uma linha** — percorrem os itens, e o par são dois itens de verdade.
6. [x] **`apps/web`:** par no cadastro e no painel de edição (com a economia calculada e o lado reverso
       bloqueado explicando onde editar); PDV com botão **"+ par c/ …"** e trava dos dois estoques;
       carrinho/comprovante em linha única; histórico e **reimpressão** agrupando por `pairGroup`;
       `CachedProduct` estendido (par vendável offline).
7. [x] **Gates:** core 103/103, typecheck API+web, build web (18 rotas). **Deploy:** API `95498aff` +
       web `bf20b770`; smoke ✅ (`/health` 200, `/orders` sem token 401).
8. [ ] **E2E do Owner** — roteiro no registro de testes.

## Decisões de implementação (registradas durante o desenvolvimento)

- **O carrinho trata o par como UMA linha** (`CartItem.pair`), com `unitPrice` = preço do par, e só
  expande em dois itens no envio (`cartToSaleItems`). Consequência boa: totais, desconto, revisão e
  comprovante do PDV funcionaram **sem alteração** — todos já liam uma linha por item de carrinho.
- **Trava de estoque generalizada** (`baseUsedByProduct`): conta as três formas de um produto aparecer
  no carrinho — avulso (com o fator da embalagem), lado principal de um par e lado agregado de um par.
  Sem isso, misturar avulso e par do mesmo produto estouraria o estoque real.
- **Validação de UX:** escolher o agregado sem preencher o preço salvaria um par que o PDV nunca
  ofereceria (`hasPair` falharia em silêncio). O cadastro e a edição agora recusam esse estado.

---

## Relacionadas

- **[ADR-001](./ADR-001-consistencia-de-estoque.md)** — o par debita dois produtos; cada baixa continua
  atômica e com `StockMovement` próprio. É por preservar esse motor que o par vira dois `OrderItem`.
- **[ADR-013](./ADR-013-venda-em-unidade-alternativa.md)** — precedente direto: segundo preço para uma
  forma alternativa de venda, resolvido com colunas nullable no `Product` em vez de tabela nova.
- **[ADR-006](./ADR-006-devolucao-e-movimentacoes-de-caixa.md)** — a devolução estorna item a item, e
  por isso não precisa saber que um par existiu.
- **[ADR-011](./ADR-011-fila-de-sincronizacao-offline.md)** — a venda em par segue append-only; o
  protocolo de sync não muda.
