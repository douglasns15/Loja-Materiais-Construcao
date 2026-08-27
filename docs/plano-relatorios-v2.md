# Plano de Execução — Relatórios v2 (repaginação + inteligência de decisão)

> **Status:** planejamento aprovado pelo Owner em **2026-08-26**. Falta apenas iniciar o
> desenvolvimento (será tocado em outra sessão). Fonte de verdade do progresso continua sendo
> [`ROADMAP.md`](ROADMAP.md) + [`testes/registro-de-testes.md`](testes/registro-de-testes.md);
> este documento detalha o **como** (as fatias) da repaginação da tela **Relatórios**.
>
> **Mockup navegável (referência visual/funcional):** versionado em
> [`mockups/relatorios-v2.html`](mockups/relatorios-v2.html) (abrir no navegador) — também publicado
> como Artifact "Relatórios Repaginados" v3 (busca de produto/cliente + pop-ups). Usa a MESMA identidade das telas
> já repaginadas (PDV Opção A / menu retrátil): container largo, título em gradiente índigo, cards
> `rounded-2xl`, cabeçalho de tabela azul, selos arredondados, botões esmeralda, painel/modal com
> header `bg-indigo-600`.

## Contexto

A tela [`apps/web/app/(app)/relatorios/page.tsx`](../apps/web/app/(app)/relatorios/page.tsx) hoje
mostra: cards de resumo (Recebido/Vendas/Ticket/Canceladas), tabela **Por forma de pagamento** e
**Fechamentos de caixa** (com drill-down de movimentações). A API é
[`apps/api/src/routes/reports.ts`](../apps/api/src/routes/reports.ts) (`GET /reports/sales`,
`GET /reports/cash-sessions`), agregando no banco (custo-zero). Tipos em
[`packages/shared/src/report.ts`](../packages/shared/src/report.ts).

O objetivo do v2 é transformar Relatórios de um **placar** em um **painel de decisão**: além de
mostrar números, ajudar o dono a decidir (o que dá lucro, quem são os bons clientes, para onde o
mês está indo, o que vai faltar).

## Decisões travadas (respostas do Owner em 2026-08-26)

1. **Base de custo entra CEDO (Fatia 2).** A margem só existe para vendas cujo custo foi
   "carimbado". Quanto antes começar a gravar, antes o histórico de margem cresce. Ver
   [ADR-027](adr/ADR-027-custo-congelado-na-venda.md).
   - ⚠️ **Esclarecimento do Owner (importante):** "congelar o custo" **NÃO** trava o custo no
     cadastro do produto. `Product.costPrice` continua **totalmente editável**. O que muda: cada
     **venda** passa a gravar, na linha do item, o custo **daquele momento** (snapshot). O
     relatório de margem usa esse snapshot — por isso reajustar o cadastro depois **não distorce**
     relatórios passados. É exatamente o que impede a margem histórica de "quebrar".
2. **Insights CONFIGURÁVEIS (ligar/desligar cada um), já nesta rodada** (Fatia 9). Não ficam para
   depois.
3. **Pop-up de detalhe (produto/cliente) começa ENXUTO** — os tiles + "quem compra / o que costuma
   comprar", sem mini-gráfico de evolução por ora. Enriquecer depois.
4. **A busca abre o detalhe em POP-UP dentro de Relatórios** (reaproveita o padrão de modal), sem
   tela dedicada nova.

## Princípios e regras que TODA fatia respeita (do `CLAUDE.md`)

- **Custo-zero:** sem dependência nova de gráfico/planilha/PDF. Gráficos = **SVG à mão**; CSV =
  gerado no cliente; PDF = **impressão do navegador** (folha de estilo de impressão). Qualquer lib
  pesada seria decisão arquitetural (regra 4) — fora de escopo aqui.
- **Regra 1 (migração):** a única fatia com migration é a **Fatia 2**; explicar impacto e obter
  aprovação explícita ANTES de aplicar (a direção já foi aprovada; a aplicação da migration é o
  gate).
- **Regra 2 (testes):** todo cálculo novo (margem, run-rate de projeção, velocidade de estoque,
  regras de insight) vive em `packages/core` como função pura, com testes Vitest.
- **Regra 7 (doc da API):** toda rota nova/alterada atualiza `docs/DOCUMENTACAO-TECNICA.md` §8.2
  **na mesma mudança** (método, rota, o que faz, guardas de auth).
- **Multi-tenant/RLS:** toda query filtra `tenantId` (padrão já existente na API de reports).
- **Regime de caixa (ADR-019):** "Recebido" = à vista + recebimentos de fiado por `paidAt`. Não
  regredir isso ao mexer nos agregados.

---

## Fatias (ordem de ataque)

Cada fatia é entregável e testável isoladamente. Marcar progresso no `ROADMAP.md`.

### Fatia 1 — Fundação visual (repaginação, sem dados novos)
- **Objetivo:** reaplicar a identidade das telas repaginadas na Relatórios ATUAL, sem funcionalidade
  nova: título em gradiente, container largo, seções com rótulo, cards `rounded-2xl`, cabeçalho de
  tabela azul. Reorganiza KPIs + forma de pagamento + caixa no novo layout.
- **Camadas:** só `apps/web` (a página). **Sem** API/migration/core/shared.
- **Gate:** `tsc` 0 + build; visual coerente com o PDV; E2E de fumaça (a tela carrega igual, com os
  mesmos dados).

### Fatia 2 — Base de custo: snapshot de custo na venda (MIGRATION) — ADR-027
- **Objetivo:** passar a **gravar o custo do produto em cada item vendido**, para destravar
  margem/lucro daí em diante. **Ainda sem tela de lucro** — é a fundação.
- **Banco — migration ADITIVA (provável `0032`):** adiciona `unitCost Decimal(12,4)` (nullable) em
  `OrderItem`. Nullable porque vendas antigas não têm o dado — o relatório trata `null` como "sem
  custo" (margem "—"/aproximada sinalizada), nunca como zero.
- **Escrita:** a mutação de venda (criação do pedido, `apps/api`) grava `unitCost` = `Product.costPrice`
  do momento. Conferir também o caminho **offline/outbox** para não nascer venda sem custo.
- **Camadas:** `packages/db` (schema+migration), `apps/api` (gravação), possivelmente `packages/shared`
  (tipo do item). **Sem UI de relatório ainda.**
- **Gate:** **regra 1** — impacto + aprovação antes de aplicar a migration. Após: toda venda nova
  nasce com `unitCost`; testes da mutação; conferir estorno/devolução (não dependem do custo).

### Fatia 3 — Drill-down por forma de pagamento (pop-up)
- **Objetivo:** clicar numa forma (PIX, Dinheiro…) abre um **modal** com a composição: vendas à
  vista + recebimentos de dívida que somam aquele valor.
- **API (nova rota):** `GET /reports/payment-composition?method=&from=&to=` → linhas
  (`{tipo: 'venda'|'divida', ref, descrição, valor}`) cuja soma bate com o "Recebido" da forma.
  Reaproveita a lógica de `GET /reports/sales` (Payment + ReceivablePayment por forma). Atualizar
  **§8.2**.
- **Camadas:** `apps/api` + `apps/web` (+ `packages/shared` p/ o tipo). Sem migration.
- **Gate:** soma da composição = total da forma; E2E do Owner.

### Fatia 4 — Comparação com o período anterior (KPIs)
- **Objetivo:** cada card (Recebido, Lucro, Vendas/Ticket, Canceladas) mostra ▲/▼ vs. a janela
  anterior equivalente (7d vs. 7d anteriores; "Hoje" vs. ontem; 30d vs. 30d).
- **API:** estender `GET /reports/sales` com `compare=1` (ou rota irmã) devolvendo os agregados da
  janela anterior. Cálculo de variação = função pura em `core` (com testes). Atualizar **§8.2**.
- **Camadas:** `apps/api` + `apps/web` + `packages/core` (variação) + `packages/shared`. Sem migration.
- **Gate:** deltas corretos em bordas (período anterior vazio ⇒ "—", não ÷0).

### Fatia 5 — Top produtos & clientes + busca + pop-up de detalhe (enxuto)
- **Objetivo:** dois cards **colapsáveis** (Produtos, Clientes), cada um com **busca** (sem acento)
  e lista; clicar (na lista ou no resultado) abre **pop-up enxuto** de detalhe.
  - **Produto:** faturamento, lucro, margem, quantidade vendida, ticket, "quem mais compra".
  - **Cliente:** total comprado, nº compras, ticket, lucro gerado, dívida atual, "o que costuma
    comprar".
  - Campos de **lucro/margem** usam o snapshot da Fatia 2 (vendas sem custo ⇒ sinalizado).
- **API:** `GET /reports/top-products`, `GET /reports/top-customers` (com `q` de busca e `orderBy`
  faturamento|lucro) + detalhe por id. `groupBy` em `OrderItem`/`Order`. Atualizar **§8.2**.
- **Camadas:** `apps/api` + `apps/web` + `packages/shared`. Sem migration.
- **Gate:** busca acha por nome parcial sem acento; totais batem; E2E do Owner.

### Fatia 6 — Lucro & margem no "Resultado do período"
- **Objetivo:** card destacado **Lucro bruto estimado** (receita − custo dos snapshots) + **margem
  %**, e ordenar Produtos por **faturamento × lucro**.
- **Cálculo:** funções puras em `core` (lucro bruto, margem, margem líquida com taxa de maquininha —
  reaproveitar `calcMarginPercent`/`netMarginPercent` já existentes do PDV/ADR-016), com testes.
- **API:** somar `unitCost` nos agregados de `sales`/top. Sinalizar cobertura (quantas vendas do
  período têm custo). Atualizar **§8.2**.
- **Camadas:** `apps/api` + `apps/web` + `packages/core` + `packages/shared`. Sem migration.
  **Depende da Fatia 2.**
- **Gate:** margem confere numa venda conhecida; vendas sem custo não entram como lucro cheio.

### Fatia 7 — Gráfico temporal (faturamento por dia) + toggle Tabela/Gráfico
- **Objetivo:** toggle no topo alterna a composição entre tabela e um **gráfico de barras diário**
  (SVG à mão), com o dia de hoje destacado.
- **API:** `GET /reports/daily?from=&to=` agregando por dia (fuso da loja, como o resto). Atualizar
  **§8.2**.
- **Camadas:** `apps/api` + `apps/web` + `packages/shared`. Sem migration. Sem lib de gráfico.
- **Gate:** soma das barras = Recebido do período.

### Fatia 8 — Projeções
- **Objetivo:** seção "Projeções" (sempre rotulada **"no ritmo atual"** — direcional, não promessa):
  1. **Faturamento projetado do mês** — run-rate (média diária × dias do mês), com realizado/parcial.
  2. **A receber (próx. 30 dias)** — soma das dívidas com vencimento no período (ADR-026 já tem
     vencimento). Não depende de custo.
  3. **Vai faltar estoque** — itens cuja velocidade (via `StockMovement`) esgota o `stockQty` em
     poucos dias.
- **Cálculo:** funções puras em `core` (run-rate, dias-para-ruptura), com testes (regra 2).
- **API:** rota(s) de projeção. Atualizar **§8.2**.
- **Camadas:** `apps/api` + `apps/web` + `packages/core` + `packages/shared`. Sem migration.
- **Gate:** projeções batem num cenário fixado nos testes; texto "no ritmo atual" visível.

### Fatia 9 — Insights configuráveis
- **Objetivo:** a faixa de insights no topo, com **regras** que o dono pode **ligar/desligar**.
  Regras iniciais: margem baixa em produto que fatura alto; forma de pagamento dominante; projeção
  do mês; divergência de caixa fora do normal; melhor cliente.
- **Cálculo:** cada regra = função pura em `core` sobre os agregados já existentes (com testes). A
  UI só renderiza os insights ligados.
- **Persistência das preferências (micro-decisão para a implementação):** começar com
  **`localStorage` por dispositivo** (custo-zero, sem migration) — ex.: `nexoloja:report-insights`.
  Evolução futura possível = preferência por usuário/tenant no banco (fora do escopo desta rodada).
- **Camadas:** `apps/web` + `packages/core` (regras). Sem migration (com a decisão de localStorage).
- **Gate:** ligar/desligar persiste no reload; regra só dispara quando a condição é real.

### Fatia 10 — Exportar CSV + PDF (impressão)
- **Objetivo:** botões CSV e PDF no topo.
  - **CSV:** montado no cliente a partir das tabelas do período (forma de pagamento, top produtos,
    caixa). Abre no Excel. Sem dependência.
  - **PDF:** `window.print()` + **folha de estilo de impressão** (esconde navegação, ajusta cores).
    Sem lib de PDF.
- **Camadas:** só `apps/web`. Sem API/migration.
- **Gate:** CSV abre corretamente no Excel (separador/acentos); impressão sai limpa.

---

## Dependências entre fatias

- **2 → 6** (lucro no resultado) e **2 → parte do 5** (campos de lucro/margem do pop-up).
- As demais são independentes entre si; 3, 4, 7, 8, 10 não dependem de custo.
- Sugestão de ordem de valor: 1 → 2 → 3 → 5 → 6 → 4 → 7 → 8 → 9 → 10 (2 cedo para acumular
  histórico; 3 e 5 são as de maior valor percebido).

## Fora de escopo desta rodada (backlog)

- Mini-gráfico de evolução dentro do pop-up de produto/cliente (Owner escolheu "enxuto").
- Tela dedicada de produto/cliente (Owner escolheu pop-up).
- Preferência de insights persistida no banco (começa em localStorage).
- Export para `.xlsx` formatado / lib de PDF (decisão arquitetural — regra 4).
- Recompor custo histórico de vendas antigas (não há snapshot retroativo; margem vale "daqui pra
  frente").
- **Dias de funcionamento da loja (config em Configurações)** — hoje o run-rate do mês usa dias de
  CALENDÁRIO (fechados entram no divisor e no multiplicador, então quase se cancelam: a projeção fica
  correta; só o rótulo "R$/dia" parece baixo por incluir fins de semana). Configurar os dias abertos
  melhoraria a clareza do "/dia" (viraria "por dia aberto") e a precisão em viradas de mês atípicas.
  Mexe em Settings + schema (por-tenant) — refino futuro, não urgente. Levantado pelo Owner em 2026-08-27.
- **Ponto de reposição de verdade** (lead time + estoque de segurança) para o "vai faltar" — hoje é
  direcional pela velocidade típica; o padrão dos grandes ERPs é ROP = demanda × lead time + segurança.
