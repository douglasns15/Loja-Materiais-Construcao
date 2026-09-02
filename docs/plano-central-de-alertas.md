# Plano de Execução — Central de Pendências (sino de alertas)

> **Status:** **CONCLUÍDO e NO AR** — as 5 fatias + o refino pós-E2E foram implementados, deployados e
> **E2E do Owner VALIDADO em 2026-09-02** ("tudo validado com sucesso"). Decisão de arquitetura em
> [ADR-029](adr/ADR-029-central-de-pendencias-computada.md). Fonte de verdade do progresso continua
> sendo [`ROADMAP.md`](ROADMAP.md) + [`testes/registro-de-testes.md`](testes/registro-de-testes.md);
> este documento detalha o **como** (as fatias). NO AR: API `b0240d76` + web (smokes OK); commits
> `9ee5c91` (5 fatias) + `0ff3c73` (refino) em `main` — push do Owner.

## Contexto

Dados de cadastro incompletos/inconsistentes degradam o app em silêncio — o gatilho foi o **produto
sem custo** derrubando o "Lucro bruto estimado" dos Relatórios ([ADR-027](adr/ADR-027-custo-congelado-na-venda.md)):
num mês real só ~19% das vendas tinham custo, e o dono só percebeu por estranhar o número.

A entrega é um **sino de alertas** no topo (ao lado da cesta, no [`layout.tsx`](../apps/web/app/(app)/layout.tsx),
junto de `QueueChip`/`CartChip`) que **junta** essas pendências, mostra a contagem num badge e oferece
a **ação** de corrigir (baixar a lista). É uma **central computada**, não um feed de notificações
(ADR-029): calculada sob demanda, sem tabela, sem push, sem migração.

## Decisões travadas (Owner, 2026-09-02)

1. **Implementar o catálogo inteiro** (blocos A, B e C abaixo).
2. **Nasce visível para todos os papéis.** O metadado `roles` de cada alerta já é gravado, mas **não
   é aplicado** nesta entrega — o filtro por papel vira o **épico seguinte** (tela de permissões por
   usuário, onde o Admin limita telas/funcionalidades individualmente).
3. **Sem migração / sem tabela nova** — tudo sai de campos existentes (ADR-029).

## Princípios e regras que TODA fatia respeita (do `CLAUDE.md` + ADR-029)

- **Custo-zero:** agregação no Postgres (`COUNT FILTER`, `$queryRaw`), **CSV montado no cliente**,
  nenhuma lib nova. Nenhum estado de alerta escrito no banco.
- **Guarda de CPU do Worker (free):** contagens = uma varredura agregada e enxuta; **nunca**
  `findMany` + laço em JS (histórico: `GET /products` estourou 10 ms). Detalhe/download = rota
  **separada e paginada**.
- **Regra 2 (testes):** limiares e classificação de severidade vivem em `packages/core` como funções
  puras, com testes Vitest. A API passa só os números crus; o `core` decide alerta/severidade.
- **Regra 7 (doc da API):** toda rota nova atualiza `docs/DOCUMENTACAO-TECNICA.md` §8.2 **na mesma
  mudança** (método, rota, o que faz, guardas de auth).
- **Multi-tenant/RLS:** toda query filtra `tenantId` (padrão da API). Produtos: só `isActive = true`
  e `deletedAt IS NULL` (ADR-004) contam como pendência.
- **Identidade visual:** índigo/esmeralda das telas repaginadas (painel com header `bg-indigo-600`,
  cards `rounded-2xl`, selos arredondados, severidade por cor).

## Modelo de dados dos alertas (em `packages/shared`)

```ts
type AlertKind =
  | 'product-no-cost'      // costPrice = 0
  | 'product-cost-ge-price'// costPrice >= salePrice (ambos > 0) — margem ≤ 0
  | 'product-no-price'     // salePrice = 0
  | 'product-no-ean'       // ean IS NULL
  | 'product-no-category'  // categoryId IS NULL
  | 'stock-negative'       // stockQty < 0
  | 'stock-below-min'      // minStockQty > 0 AND stockQty <= minStockQty
  | 'cash-open-too-long'   // CashSession OPEN há > N horas
  | 'cash-divergence'      // fechamento(s) com diferença no período recente
  | 'debt-stale';          // Debt aberta parada há > N dias (ADR-026)

type AlertSeverity = 'info' | 'warn' | 'danger';

interface AlertSummary {
  kind: AlertKind;
  count: number;
  severity: AlertSeverity;
  roles: UserRole[];       // informativo nesta entrega (ver decisão 2)
  downloadable: boolean;   // tem lista para CSV?
  actionHref?: string;     // para onde levar ao clicar (ex.: /produtos?filtro=…)
}
```

`GET /alerts` → `{ ok: true, data: AlertSummary[] }` (só os `count > 0`, ordenados por severidade).
Detalhe/download por alerta de produto: `GET /alerts/products?kind=<AlertKind>&cursor=…` → linhas
(id, nome, sku/ean, os campos relevantes) que o cliente vira CSV.

---

## Fatias

### Fatia 1 — Esqueleto + 1º alerta ("sem custo") de ponta a ponta — **IMPLEMENTADA (2026-09-02), E2E do Owner PENDENTE**
- **shared** ([`alerts.ts`](../packages/shared/src/alerts.ts)): tipos `AlertKind/AlertSeverity/AlertSummary`
  + **catálogo `ALERT_META`** (rótulo, descrição, severidade base, `roles` informativo, `downloadable`) +
  schema/tipos da lista (`AlertProductsPage`).
- **core:** **sem mudança nesta fatia.** Refinamento em relação ao plano original: "sem custo" é um
  `COUNT`, não um cálculo — não há função pura a testar aqui. A severidade é metadado **estático** em
  `shared` (não uma regra). Os limiares/severidade **computados** (caixa aberto há N horas, dívida há N
  dias) entram na **Fatia 4**, onde há de fato conta — como funções puras em `core`, com testes (ADR-029 §6).
- **api** ([`routes/alerts.ts`](../apps/api/src/routes/alerts.ts)): `GET /alerts` rodando **um**
  `COUNT FILTER` (sem custo) numa varredura agregada de `products`; `GET /alerts/products?kind=product-no-cost`
  paginado por **keyset** (`$queryRaw` com casts `float8` — guarda de CPU do Worker). Doc §8.2 atualizada (regra 7).
- **web** ([`AlertsChip.tsx`](../apps/web/app/(app)/AlertsChip.tsx)): sino no header ao lado de `CartChip`,
  badge = soma dos `warn`+`danger`; **painel** índigo (fixo, fecha ao clicar fora/Esc, recarrega ao focar
  a janela) que lista os alertas; no "sem custo", botão **Baixar lista (CSV)** (pagina o keyset e monta o
  CSV no cliente). Recarga ao voltar o foco já entregue (era Fatia 5) — barato, ficou aqui.
- **Gate:** ✅ `tsc` limpo (shared/api/web) + web build (todas as rotas) + shared 51/51. **E2E do Owner
  pendente** (exige login numa loja com produtos sem custo).

### Fatia 2 — Bloco A completo (qualidade de cadastro) — **IMPLEMENTADA (2026-09-02), E2E do Owner PENDENTE**
- Acrescentou ao **mesmo** agregado de `products` os `COUNT FILTER`: `product-cost-ge-price`,
  `product-no-price`, `product-no-ean`, `product-no-category`. Contagens montadas a partir da lista
  `PRODUCT_ALERT_KINDS` (aliases posicionais `c0..cN`) — o bloco B (Fatia 3) entra só somando kinds à
  lista + `case` no predicado. Schema de `GET /alerts/products` ampliado para os 5 kinds; painel/CSV do
  web **já eram genéricos** (nenhuma mudança no web).
- **Decisão de predicado:** `custo ≥ preço` exige AMBOS `> 0` — preço 0 é a pendência "sem preço", não
  esta (sem sobreposição). "Sem EAN" cobre nulo **ou** vazio.
- **`actionHref`:** ainda não (fica para quando houver filtro de cadastro por pendência) — hoje o valor
  do alerta é a **lista baixável**.
- **Gate:** ✅ `tsc` shared/api/web + shared 51/51. **E2E do Owner pendente** (conferir contagens e os
  4 downloads contra a base real).

### Fatia 3 — Bloco B (estoque) — **IMPLEMENTADA (2026-09-02), E2E do Owner PENDENTE**
- `stock-negative` (`stockQty < 0`) e `stock-below-min` (`minStockQty > 0 AND 0 <= stockQty <= minStockQty`),
  lendo o cache `stockQty` (o placar exibido em todo o app; ADR-001). Entraram só somando os 2 kinds à
  lista `PRODUCT_ALERT_KINDS` + 2 `case` no predicado (mesma varredura) e ao enum de `/alerts/products`.
  **Web sem mudança** (genérico). Downloads via CSV genérico.
- **Decisão:** `abaixo do mínimo` **exclui negativos** (que já são `stock-negative`, gravidade maior) —
  sem contar o mesmo produto em dois alertas. Mínimo 0 nunca gera falso "ruptura".
- **Gate:** ✅ `tsc` shared/api/web + shared 51/51. **E2E do Owner pendente** (bater com a tela de Estoque).

### Fatia 4 — Bloco C (operacional / financeiro) — **IMPLEMENTADA (2026-09-02), E2E do Owner PENDENTE**
- `cash-open-too-long` (caixa `closedAt IS NULL` aberto há > **18h**), `cash-divergence` (fechamento com
  `closingAmount <> expectedAmount` nos últimos **30d**), `debt-stale` (`Debt` OPEN **vencida há >30d OU
  sem recebimento há >30d** — os dois critérios, decisão do Owner 2026-09-02). Todos **levam à tela**
  (`actionHref`: /caixa, /relatorios, /contas-a-receber) em vez de CSV.
- **Limiares + regra em `core`** (funções puras testadas, ADR-029 §6): `CASH_OPEN_ALERT_HOURS=18`,
  `DEBT_STALE_ALERT_DAYS=30`, `CASH_DIVERGENCE_WINDOW_DAYS=30`; `isCashOpenTooLong`, `isDebtStale`
  (+10 testes em `packages/core/src/alerts.test.ts`). O servidor busca os candidatos (poucos: 1 caixa
  aberto/loja, 1 dívida aberta/cliente) e aplica a regra pura — sem duplicar em SQL. "Último recebimento"
  da dívida = `MAX(ReceivablePayment.paidAt)` via `Receivable.debtId`.
- **web:** o painel ganhou o botão **"Abrir"** (link) para alertas não-baixáveis com `actionHref`.
- **Gate:** ✅ core 341/341 (incl. 10 novos) + tsc shared/core/api/web + web build. **E2E do Owner pendente.**

### Fatia 5 — Acabamento — **IMPLEMENTADA (2026-09-02), E2E do Owner PENDENTE**
- Ordenação por severidade, cores (info/warn/danger), **estado vazio** ("Tudo em ordem ✓"), refresh ao
  focar a janela e badge só de `warn`+`danger` **já vinham das fatias anteriores**. Esta fatia entregou o
  **silenciar por 7 dias** via `localStorage` (ADR-029 §5): botão "Silenciar 7 dias" por item (some do
  painel E do badge), rodapé "N silenciada(s) · **Reexibir**", estado "Tudo silenciado por ora." quando
  tudo está oculto. Chave `nexoloja:alerts-snooze`, tolerante a storage indisponível; expira sozinho e o
  alerta reaparece se persistir. Sem tabela/servidor.
- **Gate:** ✅ web tsc + build. **E2E do Owner pendente** (silenciar some do sino; reexibir traz de volta).

### Refino pós-E2E — **IMPLEMENTADO e NO AR (2026-09-02)**
Feedback do 1º teste do Owner (commit `0ff3c73`):
- **Badge por nº de alertas** (não a soma dos itens): um alerta com 250 produtos é **1** notificação —
  corrige o "99+". O badge conta os `warn`+`danger` visíveis; a contagem grande fica no card do alerta.
- **Pop-up "Ver"** em todo alerta, além do CSV/Abrir ([`AlertDetailModal.tsx`](../apps/web/components/AlertDetailModal.tsx)):
  cadastro/estoque → tabela de produtos (mesma fonte do CSV, paginada por keyset com "Carregar mais");
  caixa/dívida → lista de datas/valores.
- **`GET /alerts/detail?kind=`** (bloco C): detalhe já formatado pt-BR — fechamentos com diferença
  (data + falta/sobra), caixa aberto (desde quando), dívidas paradas (`D-000X` — cliente +
  vencimento/inatividade). Timestamps formatados no Worker via offset −3h; vencimento (date-only) via
  `formatDateBr` (UTC). Doc §8.2 atualizada.
- **Não feito (melhoria futura):** "Abrir a tela já filtrada" (ex.: Relatórios nas datas divergentes) —
  mexeria nas telas de destino; por ora o `actionHref` leva à tela e o "Ver" mostra as datas.

## Fora de escopo (próximos épicos)
- **Tela de permissões por usuário** (Admin limita telas/funcionalidades por papel) — quando existir,
  liga o filtro `roles` que cada alerta já carrega (ADR-029 §4). É o **próximo** épico combinado.
- **Push real / notificação fora do app** (ADR-029, alternativa rejeitada por ora).
- **Limiares configuráveis pelo dono** (por enquanto constantes em `core`); pode virar preferência
  do tenant depois, sem mudar o desenho.
