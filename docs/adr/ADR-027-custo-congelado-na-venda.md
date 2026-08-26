# ADR-027: Custo congelado na venda (snapshot de custo no item para margem histórica)

**Status:** **Proposto** (planejamento aprovado pelo Owner em 2026-08-26; a **aplicação da migration** exige aprovação de impacto — regra 1 do `CLAUDE.md` — no início da implementação). Faz parte do [plano Relatórios v2](../plano-relatorios-v2.md), Fatia 2.
**Data:** 2026-08-26
**Deciders:** Owner do produto
**Relacionados:** [ADR-016](ADR-016-preco-e-margem-por-forma-de-pagamento.md) (preço e margem por forma de pagamento; motor de margem já existe em `core`), [ADR-001](ADR-001-consistencia-de-estoque.md) (snapshot congelado como padrão — `baseQuantity` no item), [ADR-019](ADR-019-venda-a-prazo-contas-a-receber.md) (regime de caixa dos relatórios)

## Contexto

A tela de Relatórios vai ganhar **lucro e margem** (plano Relatórios v2). Para isso é preciso saber
**quanto custou** o que foi vendido em cada venda. Hoje o custo só existe em `Product.costPrice`,
que é **mutável** (o próprio ADR de "último custo", 2026-08-11, sobrescreve o `costPrice` a cada
entrada). O `OrderItem` já congela nome, unidade, preço e quantidade-base (snapshot), mas **não
congela o custo**.

Consequência de calcular margem histórica usando o `costPrice` atual: **toda vez que o custo de um
produto muda, a margem de todas as vendas passadas daquele produto mudaria junto** — o relatório de
ontem não seria reproduzível. Isso quebra a confiança no número.

Há um paralelo direto no projeto: o ADR-001 já adotou o padrão de **congelar no item** o que não
pode depender de um valor mutável do produto (a `baseQuantity`, para o estorno de estoque ser exato
mesmo se o `conversionFactor` mudar). A margem histórica pede o mesmo tratamento para o custo.

## Decisão

### 1. Congelar o custo **na linha da venda** (snapshot), não no cadastro

Adicionar `unitCost` ao `OrderItem`, gravado **no momento da venda** com o `Product.costPrice`
vigente. A partir daí, o relatório de margem usa **o custo carimbado na venda**, nunca o custo atual
do cadastro.

- **O cadastro do produto NÃO muda de comportamento.** `Product.costPrice` continua **totalmente
  editável** (inclusive pelo "último custo" automático). Congelar o custo é sobre a **venda**, não
  sobre o produto. É justamente o snapshot que **impede** um reajuste de custo futuro de distorcer
  relatórios passados.

### 2. Campo aditivo e **nullable**

`unitCost Decimal(12,4)` **nullable** em `OrderItem` (migration aditiva, provável `0032`):

- **Nullable** porque as vendas **anteriores** à migration não têm o dado. Não há backfill honesto
  (o custo de então se perdeu). O relatório trata `unitCost = null` como **"custo desconhecido"** —
  a venda entra no faturamento normalmente, mas **fica de fora do lucro** (ou aparece com margem
  sinalizada como aproximada), **nunca** contada como custo zero (que inflaria o lucro).
- **Migration aditiva:** só acrescenta coluna; não altera nem migra dado existente. Baixo risco.

### 3. Gravação na venda (incl. caminho offline)

A mutação de criação da venda (`apps/api`) grava `unitCost` por item. Conferir também o caminho
**offline/outbox** (a venda nasce no cliente e sincroniza) para que **nenhuma venda nova nasça sem
custo**. O custo é um snapshot como os demais campos do item — não participa de estorno de estoque
nem de devolução (essas usam `baseQuantity`, ADR-001).

### 4. Cálculo de margem fica em `core` (funções puras, testadas)

Lucro bruto (`Σ (preço − custo) × qtd`), margem % e margem líquida (descontando a taxa da maquininha
por forma — ADR-016) são **funções puras** em `packages/core`, com testes Vitest (regra 2). Já
existem `calcMarginPercent`/`netMarginPercent` no `core` (usados pelo PDV) para reaproveitar.

## Alternativas consideradas

- **Calcular margem com o `costPrice` atual (sem snapshot).** Rejeitada: relatório não reproduzível
  — muda o passado quando o custo muge.
- **Tabela de histórico de custo do produto (custo por data), e casar com a data da venda.** Mais
  complexa (join temporal, mais linhas), sem ganho sobre carimbar direto na venda. Contraria a
  simplicidade custo-zero.
- **Backfill do custo em vendas antigas.** Impossível com honestidade (o custo de então não é
  recuperável); assumir o custo atual seria inventar número. Fica `null` = "desconhecido".

## Consequências

- ✅ Margem/lucro **reproduzíveis e à prova de reajuste** de custo — daqui pra frente.
- ✅ Padrão consistente com o snapshot já adotado no item (ADR-001).
- ⚠️ **Margem histórica só vale para vendas feitas após a migration.** Vendas antigas ⇒ "custo
  desconhecido". Por isso a Fatia 2 entra **cedo** no plano — quanto antes carimbar, antes o
  histórico de margem cresce.
- ⚠️ **Regra 1:** a aplicação da migration exige explicação de impacto + aprovação explícita no
  início da implementação (a direção já está aprovada aqui; a migration em si é o gate).
- ➕ Uma coluna `Decimal` nullable por item — impacto de armazenamento desprezível (custo-zero,
  §7 da ARCHITECTURE).
