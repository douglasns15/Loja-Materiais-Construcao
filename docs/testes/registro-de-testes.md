# 🧪 Registro de Testes — NexoLoja

> Evidência dos testes executados em cada etapa do desenvolvimento.
> Alimentado conforme novas validações são feitas. Legenda: ✅ passou · ❌ falhou · ⏭️ pendente

---

## Fase 1 — Monorepo e Backend

### 1.1 Estrutura e build (2026-06-25)

| O que foi testado | Método | Resultado |
|---|---|---|
| Schema Prisma válido | `prisma validate` | ✅ "schema is valid" |
| Geração do client | `prisma generate` | ✅ Client v6.19.3 gerado |
| Workspaces resolvidos pelo Turborepo | `turbo run test` | ✅ orquestrou os pacotes |
| Typecheck `packages/db` | `tsc --noEmit` | ✅ sem erros |
| Typecheck `apps/api` | `tsc --noEmit` | ✅ sem erros |

### 1.2 Migrations / Banco (2026-06-25)

| O que foi testado | Método | Resultado |
|---|---|---|
| Conexão com Supabase | `prisma db execute "SELECT 1"` | ✅ executou |
| Baseline `0_init` reflete o banco | `migrate diff --from-empty --to-schema-datasource` | ✅ inclui todas as tabelas |
| `0_init` registrado | `migrate resolve --applied` | ✅ marcado como aplicado |
| Drop de `passwordHash` (auth) | `migrate deploy` (`0001_drop_password_hash`) | ✅ coluna removida |
| Banco em dia | `migrate status` | ✅ "up to date" |
| Sem drift schema × banco | `migrate diff --exit-code` | ✅ "No difference detected" |

### 1.3 Lógica pura — `packages/core` (Vitest)

| O que foi testado | Resultado |
|---|---|
| `calcSubtotal`, `calcOrderTotal` | ✅ |
| `calcMarginPercent` (margem, casos de borda, arredondamento) | ✅ |
| **Total** | ✅ 8 testes passando |

### 1.4 Item 3 — Prisma rodando no Worker (local, `wrangler dev`) (2026-06-25)

| Endpoint | Resultado |
|---|---|
| `GET /health` | ✅ `{ok:true}` |
| `GET /db-check` (Prisma via `@prisma/adapter-pg`) | ✅ `{tenants:0}` |

### 1.5 CRUD de Produtos — `/products` (local) (2026-06-25)

| Caso | Resultado |
|---|---|
| `POST` criar | ✅ 201 + `marginPercent` calculado (28,57%) |
| `GET` listar | ✅ |
| `PATCH` (venda→45) recalcula margem | ✅ 36,67% |
| `DELETE` (soft-delete, ADR-004) | ✅ |
| `GET` pós-delete (some da lista) | ✅ |
| Sem header `x-tenant-id` | ✅ 400 |
| Body inválido | ✅ 400 com erros Zod |

### 1.6 CRUD de Clientes — `/customers` (local) (2026-06-26)

| Caso | Resultado |
|---|---|
| `POST` / `GET` / `PATCH` | ✅ |
| CPF/CNPJ duplicado | ✅ 409 |
| E-mail inválido | ✅ 400 (Zod) |
| `DELETE` → `GET` (soft-delete) | ✅ |

### 1.7 CRUD de Categorias e Fornecedores (local) (2026-06-26)

| Caso | Resultado |
|---|---|
| Categoria: `POST` pai | ✅ 201 |
| Categoria: `POST` subcategoria com `parentId` | ✅ vínculo pai/filho |
| Categoria: `parentId` inexistente | ✅ 400 (checagem no tenant) |
| Categoria: `DELETE` | ✅ soft-delete |
| Fornecedor: `POST` | ✅ 201 |
| Fornecedor: CNPJ duplicado | ✅ 409 |
| Fornecedor: `PATCH` / `DELETE` | ✅ |

### 1.8 Deploy na edge — produção (Cloudflare Workers + Hyperdrive) (2026-06-26)

URL: `https://nexoloja-api.imortal.workers.dev`

| Endpoint (produção) | Resultado |
|---|---|
| `GET /health` | ✅ `{ok:true}` |
| `GET /db-check` (Prisma → Hyperdrive → Supabase) | ✅ `{tenants:1}` |
| `GET /categories` (dados reais) | ✅ retornou categoria |
| `GET /products` sem header | ✅ 400 |

---

## Fase 2 — Autenticação, RLS e MVP

### 2.A — Autenticação via Supabase JWT (produção) (2026-06-27)

Bootstrap: OWNER `owner@lojademo.com` criado e vinculado à `loja-demo`
(`users.id` = `auth.users.id`).

| Teste | Esperado | Resultado |
|---|---|---|
| Login Supabase (grant_type=password) | retorna access_token | ✅ JWT (796 chars) |
| `GET /products` com `Authorization: Bearer` | 200 | ✅ |
| `GET /categories` com Bearer | dados reais do tenant | ✅ (tenant resolvido do token) |
| `GET /products` sem token | 401 | ✅ |
| Apenas o antigo header `x-tenant-id` | 401 | ✅ brecha fechada |
| Token inválido/forjado | 401 | ✅ |

> Middleware `requireAuth`: verifica assinatura via JWKS (ES256) e resolve
> `tenantId`/`role` da tabela `users`. O header `x-tenant-id` foi aposentado.

### 2.B+C — Access Token Hook + RLS (produção) (2026-06-27)

Migration `0002_rls_and_auth_hook` aplicada. Hook ativado no painel.
RLS em 14/14 tabelas de aplicação · 2 funções · 14 políticas.

| Teste | Esperado | Resultado |
|---|---|---|
| **B)** JWT após login carrega claims | `tenant_id` + `user_role` | ✅ `tenant_id`, `user_role: OWNER` |
| Regressão: API com Bearer (`postgres` ignora RLS) | 200 | ✅ |
| **C)** Acesso direto PostgREST `authenticated` | só dados do tenant | ✅ Cimentos + CP-II |
| **C)** Acesso direto PostgREST `anon` (sem login) | vazio/negado | ✅ `[]` |

> A API (papel `postgres`, dono) ignora RLS e isola por código; o RLS protege o
> acesso direto via `supabase-js`. Escrita direta bloqueada (sem policy de write).

### 2.E — UI (Next.js) — Fatia 1: login + produtos (2026-06-27)

Testado no navegador (preview), `apps/web` (Next 15 + Tailwind) → API em produção.

| Teste | Resultado |
|---|---|
| Tela de login renderiza | ✅ |
| Login Supabase (`owner@lojademo.com`) → redirect `/products` | ✅ |
| Lista de produtos via API (Bearer + CORS) | ✅ |
| Cadastrar produto pela tela (TIJ-8F) → grava no banco | ✅ |
| Lista atualiza com moeda + margem | ✅ R$ 0,80 / R$ 1,20 / 33.33% |
| Logout | ✅ |

> ⚠️ **Achado:** o cache de leitura do Hyperdrive servia listas velhas após escrita
> (criava produto e não aparecia). **Correção:** `wrangler hyperdrive update <id>
> --caching-disabled` (pooling mantido). Reteste OK.

### 2.E.2 — App shell (menu lateral) + tela de Clientes (2026-06-27)

| Teste | Resultado |
|---|---|
| Layout com menu lateral (Produtos/Clientes) + proteção de login centralizada | ✅ |
| Navegação entre telas pelo menu | ✅ |
| Tela de Clientes: lista lê do banco | ✅ |
| Cadastro de cliente (form → API → banco → refresh) | ✅ Construtora Souza, Pedreira Norte |
| Build de produção (`next build`) | ✅ 5 rotas, sem erros |

> Obs.: o clique sintético da ferramenta de preview às vezes não dispara o submit
> nativo do form; `requestSubmit()` confirma o handler. Não é bug do app (clique real
> do usuário funciona).

### 2.G — Caixa (abertura/fechamento) (2026-06-27)

Core: `calcExpectedCash`, `calcCashDivergence` (+ testes, total 13 no core).
API `/cash-sessions` (open/current/close) + UI `/caixa`.

| Teste | Resultado |
|---|---|
| API: `current` sem caixa | ✅ `null` |
| API: `open` R$100 | ✅ 201 |
| API: `open` de novo | ✅ 409 (já aberto) |
| API: `current` mostra esperado | ✅ R$100, entradas R$0 |
| API: `close` contando R$90 | ✅ divergência −10 + auditoria |
| Auditoria ADR-004 (CLOSE_CASH_WITH_DIVERGENCE) | ✅ registrada com meta |
| UI: abrir caixa (R$200) → estado "aberto" + esperado | ✅ |
| UI: fechar (R$195) → "divergência −R$5 (falta)" | ✅ |

### 2.H — Venda / PDV — Fatia 1: motor + tela (2026-06-27)

Core: `calcSaleItemTotal`, `calcSaleTotals` (+ testes, total 17 no core).
API `POST /orders` (transação atômica ADR-001) + UI `/venda`.

| Teste | Resultado |
|---|---|
| API: venda com caixa aberto | ✅ 201, status CONFIRMED |
| API: baixa de estoque atômica (ADR-001) | ✅ 50 → 46 (StockMovement + decremento) |
| API: pagamento alimenta o caixa | ✅ esperado subiu p/ R$104,80 |
| API: bloqueia venda sem caixa / sem estoque | ✅ (validado no código + caminhos 400) |
| UI: formas de pagamento (Dinheiro, Déb., Créd., PIX) | ✅ |
| UI: adicionar ao carrinho + totais | ✅ 3× Tijolo = R$3,60 |
| UI: **Concluir venda** → registrada | ✅ |
| UI: **Orçamento** → cotação "não é venda" (sem persistir) | ✅ 2× Cimento R$74,00 |

### 2.H.2 — Venda / PDV — Fatia 2: impressão (2026-06-28)

API `GET /tenant` (nome/logo da loja) + componente `ReceiptPrint` + estilos `@media print`.

| Teste | Resultado |
|---|---|
| API: `GET /tenant` retorna nome/logo | ✅ "Loja Demo" (logoUrl null) |
| Build de produção (`next build`) | ✅ 7 rotas, sem erros |
| Comprovante e orçamento com seleção 80mm/A4 + cabeçalho (nome/logo) | ✅ layout validado no navegador (ver 2.H.4) |

> Logo: aparece quando a loja tiver `logoUrl` (upload de logo p/ R2 é tarefa futura).

### 2.H.4 — Venda / PDV — validação visual da impressão (2026-06-28)

Validado no navegador (`npm run dev`, preview) via página temporária que renderiza o
`ReceiptPrint` com dados de exemplo, simulando a largura do papel (80mm ≈ 302px, A4 ≈ 794px).
Página removida após o teste. Console sem erros/avisos.

| Layout | Resultado |
|---|---|
| 80mm — Comprovante de venda (cabeçalho, itens, Subtotal/Desconto, TOTAL, Pagamento/Troco, rodapé) | ✅ |
| A4 — Comprovante de venda (4 colunas alinhadas, totais, pagamento/troco) | ✅ |
| A4 — Orçamento (título em caixa destacada, rodapé "não é documento fiscal") | ✅ |
| Alternância 80mm ↔ A4 (largura/fonte) e venda ↔ orçamento | ✅ |

> Observação: o diálogo nativo de impressão (`window.print()`) e a saída em papel real
> dependem da impressora do usuário — só o usuário pode confirmar a impressão física.
> O que foi validado aqui é a renderização/layout do documento.

### 2.H.3 — Ajustes do PDV (2026-06-28)

| Ajuste | Resultado |
|---|---|
| Troco em destaque (Dinheiro) | ✅ caixa verde, fonte grande (R$ 36,00) |
| Campo de desconto entre Total e botões | ✅ Subtotal 74 → Total 64; bloqueia se > subtotal |
| Desconto no comprovante/orçamento (Subtotal/Desconto/Total) | ✅ |
| Tooltip por item (margem + desconto possível) | ✅ "Margem 2.7% • até R$1,00/un" |
| Botão "Voltar e editar" após Concluir/Orçamento | ✅ restaura carrinho e desconto |
| **Passo de revisão** (Concluir → Revisar → Confirmar) | ✅ estoque só baixa ao Confirmar; Voltar mantém estoque intacto (6→6→4) |

### 2.J — Gestão de Estoque (entrada + ajuste) (2026-06-30)

Core: `applyStockMovement`, `reconcileStock` (ADR-001), `calcInventoryAdjustment`
(+ testes, total **25 no core**). API `/stock` (`POST /movements`, `POST /adjust`,
`GET /movements`) + UI `/estoque`. **Sem migration** — o schema já tinha `StockMovement`
e `AuditEvent`.

Validado contra a **API publicada** (login real `owner@lojademo.com` → JWT → Bearer),
primeiro via chamadas diretas e depois pela UI no navegador (`npm run dev`, preview),
sobre o produto "Cimento".

**API (chamadas diretas)**

| Teste | Esperado | Resultado |
|---|---|---|
| Core: 8 funções de estoque (Vitest) | — | ✅ 25/25 no core |
| API: entrada (INCOME) +10, transação atômica (ADR-001) | 2 → 12 | ✅ 12 |
| API: ajuste p/ contagem 5 → calcula EXPENSE 7 | 12 → 5 | ✅ EXPENSE 7 |
| API: `AuditEvent ADJUST_STOCK` na mesma transação | gravado | ✅ (saldo confirmou a tx) |
| API: histórico por produto (`GET /movements?productId=`) | 2 movimentos | ✅ |
| API: estoque final no produto | 5 | ✅ |
| API: saída maior que o estoque | bloqueada | ✅ 400 |
| API: ajuste sem motivo (ADR-004) | bloqueado | ✅ 400 (Zod) |
| API: rota exige JWT (`GET /stock/movements` sem token) | 401 | ✅ |
| Build de produção (`next build`) | rota `/estoque` gerada | ✅ 8 rotas, sem erros |
| Typecheck `apps/api` (`tsc --noEmit`) | sem erros | ✅ |

**UI no navegador (`/estoque`)**

| Teste | Resultado |
|---|---|
| Tela renderiza (entrada + ajuste + estoque atual + histórico) | ✅ console sem erros |
| Entrada pela UI (Cimento +5) → "Entrada registrada" + lista atualiza | ✅ 5 → 10 |
| Ajuste: preview do delta ao digitar a contagem | ✅ "10 → 8 (-2)" |
| Ajuste pela UI (contagem 8, motivo) → gera Saída 2 + auditoria | ✅ 10 → 8, topo do histórico |
| Histórico mostra entradas/saídas (inclui baixas de venda) com tipo e motivo | ✅ |
| Validação client-side (entrada sem produto) | ✅ mensagem amigável |

> A coluna "Mínimo" e o destaque de **estoque baixo** funcionam por lógica
> (`stockQty <= minStockQty`, testado no core), mas não foram demonstrados
> visualmente porque os produtos da loja-demo estão com `minStockQty = 0`.

### 2.J.2 — Estoque mínimo por produto (2026-06-30)

Campo "Estoque mín." no cadastro de produto + edição inline por linha na tela de
Produtos (`apiPatch` → `PATCH /products/:id`). Arma o alerta de "baixo" da tela de
Estoque (regra `stockQty <= minStockQty` com `minStockQty > 0`). Validado no navegador.

| Teste | Resultado |
|---|---|
| Build de produção (`next build`) | ✅ 8 rotas, sem erros |
| Coluna "Estoque mín." na tabela de Produtos | ✅ |
| Botão "Salvar" por linha (habilita só ao alterar o valor) | ✅ |
| Editar mínimo (Cimento → 300) via `PATCH` | ✅ persiste, botão volta a desabilitar |
| Estoque baixo reflete na tela de Estoque (Cimento 259 ≤ 300) | ✅ badge "baixo" + "1 com estoque baixo" |
| Produto acima do mínimo não marca baixo (Tijolo 1001 > 5) | ✅ |
| Console do navegador | ✅ sem erros |

> Após o teste, os mínimos da loja-demo foram restaurados para 0 (estoque intacto:
> Cimento 259, Tijolo 1001).

### 2.J.3 — Ajustes do estoque: spinner e filtros (2026-06-30)

Dois acertos pedidos após o uso: (1) as setinhas dos campos numéricos de estoque
mínimo andavam de 0,0001 em 0,0001 (`step="0.0001"`) — trocado para `step="1"` nos
campos de mínimo (inteiros); os campos de quantidade ficam em `step="any"` (aceitam
fracionados para kg/m²). (2) Filtros nas "Movimentações recentes": Produto (resolvido
no servidor via `?productId=`), Tipo, Motivo e período (De/Até, no cliente) + "Limpar".

| Teste | Resultado |
|---|---|
| Spinner do estoque mínimo (3× ↑ a partir de 0 → 3; ↓ → 2) | ✅ anda de 1 em 1 |
| Filtro Tipo = Saída | ✅ 17 de 22 (só saídas) |
| Filtro Motivo = "ajuste" | ✅ 3 de 22 (só ajustes) |
| Filtro Produto = Cimento (refetch no servidor) | ✅ 13 de 13 (total muda) |
| Filtro período (hoje) combinado c/ Produto | ✅ 4 de 13 |
| Botão "Limpar" | ✅ volta a 22 de 22 e some |
| Build de produção + console do navegador | ✅ sem erros |

### 2.K — Cancelamento de venda (2026-06-30)

`cancelOrderSchema` (motivo obrigatório, ADR-004) + API `GET /orders` (vendas do caixa
aberto) e `POST /orders/:id/cancel` + UI `/vendas`. **Sem migration** — `OrderStatus.CANCELLED`
e `AuditEvent` já existiam. Escopo: cancelamento **restrito ao caixa aberto** do operador
(não corrompe caixas fechados). O estorno é atômico (ADR-001): cada item gera `StockMovement
INCOME` reverso + incremento de `stockQty`; o `cashInflow` do caixa passou a ignorar pedidos
`CANCELLED` (esperado recalcula sozinho); `AuditEvent CANCEL_ORDER` na mesma transação.

Validado contra a **API publicada** (deploy do worker → login real `owner@lojademo.com` →
JWT → Bearer) por script E2E, e depois pela UI no navegador (`npm run dev`, preview), sobre
o produto "Cimento".

**API (script E2E — 14/14)**

| Teste | Esperado | Resultado |
|---|---|---|
| Registrar venda (2× Cimento = R$74, CASH) | 201 | ✅ |
| Estoque baixa na venda (ADR-001) | 259 → 257 | ✅ |
| Caixa sobe o esperado (pgto CASH) | Δ +R$74 | ✅ |
| Cancelar sem motivo (ADR-004) | bloqueado | ✅ 400 |
| Cancelar venda inexistente | não encontrada | ✅ 404 |
| Cancelar venda confirmada | 200 + status | ✅ `CANCELLED` |
| Estoque **estornado** (INCOME reverso) | 257 → 259 | ✅ |
| Caixa **recalcula** (ignora `CANCELLED`) | esperado volta à base | ✅ 975,8 → 901,8 |
| Cancelar a mesma venda de novo | bloqueado | ✅ 409 |
| `StockMovement EXPENSE` (venda) + `INCOME` (cancelamento) | ambos gravados | ✅ |
| `GET /orders` mostra a venda | status atual | ✅ `CANCELLED` |
| `AuditEvent CANCEL_ORDER` (lido via service_role) | gravado com motivo | ✅ "Teste E2E — cliente desistiu" |
| Typecheck `apps/api` (`tsc --noEmit`) | sem erros | ✅ |
| Build de produção (`next build`) | rota `/vendas` gerada | ✅ 9 rotas, sem erros |

**UI no navegador (`/vendas`)**

| Teste | Resultado |
|---|---|
| Item "Vendas" no menu lateral | ✅ |
| Lista as vendas do caixa aberto (mais recentes primeiro) | ✅ |
| Venda cancelada: badge "Cancelada", riscada, **sem** botão de cancelar | ✅ |
| Venda confirmada: badge "Confirmada" + botão "Cancelar venda" | ✅ |
| Itens, total e forma de pagamento por venda | ✅ |
| Sem caixa aberto → orienta a abrir o caixa | ✅ (lógica) |
| Console do navegador | ✅ sem erros |

> Observação: cancelar de caixa **já fechado** é intencionalmente bloqueado — esse caso vira
> o fluxo futuro de **devolução/estorno** (repõe estoque e lança saída no caixa de hoje),
> que reaproveita o motor de estorno deste cancelamento.

### 2.K.2 — Histórico de Vendas: rename do menu + reimpressão de nota (2026-06-30)

Ajustes de usabilidade na tela de vendas: (1) menu renomeado para desambiguar o par —
**"Venda" → "Nova Venda"** (PDV) e **"Vendas" → "Histórico de Vendas"**; (2) botão
**"Reimprimir nota"** ao lado de "Cancelar venda", reaproveitando o `ReceiptPrint` e a
lógica de impressão do PDV (seletor 80mm/A4 + `@page`). Mudança 100% no front (usa
`GET /orders` e `GET /tenant` já publicados) — sem deploy de API. Validado no navegador.

| Teste | Resultado |
|---|---|
| Menu mostra "Nova Venda" e "Histórico de Vendas" | ✅ |
| Build de produção (`next build`) | ✅ 9 rotas, sem erros |
| Seletor "Modelo de impressão" (Térmica 80mm / A4) no topo | ✅ |
| Venda confirmada: botões "Reimprimir nota" + "Cancelar venda" | ✅ |
| Venda cancelada: sem botões (não reimprime nem cancela) | ✅ |
| Reimprimir (80mm) monta o `#print-area` correto e chama `window.print()` | ✅ "COMPROVANTE DE VENDA" Cimento R$37 + Tijolo R$1,20 = R$38,20, Dinheiro |
| Trocar para A4 e reimprimir aplica `@page size: A4` (`data-model=A4`) | ✅ |
| Console do navegador | ✅ sem erros |

> A impressão física depende da impressora do usuário (`window.print()`); aqui foi validada
> a montagem do documento e a injeção da regra `@page` por modelo.

### 2.L — Relatórios de vendas e caixa (2026-06-30)

Core: `calcAverageTicket` (ticket médio, divisão por zero) e `withPaymentShare`
(participação % por forma de pagamento + ordenação) — **+6 testes, total 31 no core**.
Nova rota `/reports` com agregação no servidor (Prisma `aggregate`/`groupBy`, cost-zero):
`GET /reports/sales?from=&to=` (faturamento, nº de vendas, ticket médio, canceladas à
parte, quebra por forma de pagamento) e `GET /reports/cash-sessions?from=&to=` (histórico
de fechamentos com divergência). UI `/relatorios` (atalhos Hoje/7d/30d + período De–Até,
cards de resumo, tabela por pagamento e tabela de fechamentos). **Sem migration** — usa
`Order`/`Payment`/`CashSession`. Vendas `CANCELLED` ficam fora do faturamento (coerente
com o caixa) e são contadas à parte. Bordas do período aplicadas no fuso da loja (UTC-3).

**Build / typecheck / core**

| Teste | Esperado | Resultado |
|---|---|---|
| Core: `calcAverageTicket` + `withPaymentShare` (Vitest) | — | ✅ 31/31 no core |
| Typecheck `apps/api` (`tsc --noEmit`, após `prisma generate`) | sem erros | ✅ |
| Build de produção (`next build`) | rota `/relatorios` gerada | ✅ 10 rotas, sem erros (3.19 kB) |
| Compilação + checagem de tipos do web | sem erros | ✅ |

**API publicada (E2E — deploy do worker → login real `owner@lojademo.com` → JWT → Bearer)**

Worker republicado (`wrangler deploy`) com a rota `/reports`. Script E2E sobre os dados
reais da loja-demo.

| Teste | Esperado | Resultado |
|---|---|---|
| `GET /reports/sales` (todo o histórico) | 200 | ✅ Faturamento R$ 1.084,80 · 10 vendas |
| Ticket médio = faturamento ÷ nº de vendas | R$ 108,48 | ✅ (1.084,80 ÷ 10) |
| Canceladas contadas à parte (fora do faturamento) | 3 | ✅ |
| Quebra por forma de pagamento (com participação %) | CASH + PIX | ✅ CASH R$ 801,80 (73,91%) · PIX R$ 283,00 (26,09%) |
| Σ pagamentos = faturamento (sanidade) | igual | ✅ R$ 1.084,80 = R$ 1.084,80 |
| `GET /reports/cash-sessions` | 200 + fechamentos | ✅ 3 fechamentos |
| Divergência calculada = contado − esperado | bate por sessão | ✅ −11, −5, −10 (sem discrepância) |
| Filtro de período (`?from=&to=` de 1 dia) | agrega só o dia | ✅ hoje R$ 0,00 / 0 vendas |
| `GET /reports/sales` sem token | 401 | ✅ |

> UI `/relatorios` no navegador (cards, tabela por pagamento, fechamentos) fica para
> confirmação visual no ambiente do usuário; os dados que a tela consome já foram
> validados acima contra a API publicada.

### 2.L2 — Devolução de venda de caixa fechado (2026-07-01)

ADR-006. Migration `0003_cash_movements_and_return` (tabela `cash_movements` + enum
`CashMovementKind` + valor `OrderStatus.RETURNED` + política RLS) **aplicada no Supabase**
(`migrate deploy`). Core: `netCashMovements` (entradas − saídas de caixa) usado no cálculo
do esperado — **+4 testes, total 35 no core**. API: `POST /orders/:id/return` (estorno de
estoque + `CashMovement EXPENSE/RETURN` no caixa de hoje + `RETURN_ORDER`) e `GET
/orders?scope=all` (histórico entre sessões). UI: botão **Devolver** no Histórico + linha
"Devoluções / saídas" no Caixa. Worker **republicado**.

**Build / typecheck / core**

| Teste | Esperado | Resultado |
|---|---|---|
| Core: `netCashMovements` (Vitest) | — | ✅ 35/35 no core |
| `prisma migrate status` → 0003 pendente e depois aplicada | up to date | ✅ |
| Typecheck `apps/api` (`tsc --noEmit`, após `prisma generate`) | sem erros | ✅ |
| Build de produção (`next build`) | 10 rotas | ✅ sem erros |

**API publicada (E2E — script `e2e-return`, 16/16)**

Cenário real: vende no caixa A → **fecha A** → abre caixa B (hoje) → devolve a venda de A.

| Teste | Esperado | Resultado |
|---|---|---|
| Venda no caixa A (2× Cimento = R$74) + baixa de estoque | 259 → 257 | ✅ |
| Devolver sem caixa aberto | bloqueado | ✅ 400 |
| Devolver sem motivo (ADR-004) | bloqueado | ✅ 400 |
| Devolução aceita → pedido `RETURNED` | 200 | ✅ |
| `CashMovement EXPENSE/RETURN` criado (R$74) | gravado | ✅ |
| Estoque **reposto** na devolução | 257 → 259 | ✅ |
| Caixa de hoje registra a saída (net negativo) | −R$74 | ✅ |
| Esperado do caixa desconta a saída | abertura 100 − 74 = R$26 | ✅ |
| Devolver a mesma venda de novo | bloqueado | ✅ 409 |
| Devolver venda do caixa **aberto** (deve cancelar) | bloqueado | ✅ 400 |
| Devolver venda inexistente | não encontrada | ✅ 404 |
| `GET /orders?scope=all` mostra a venda como `RETURNED` + estado do caixa | ok | ✅ |
| `AuditEvent RETURN_ORDER` (via service_role) | gravado com motivo/sessões | ✅ |

**UI no navegador (`/vendas` e `/caixa`)**

| Teste | Resultado |
|---|---|
| Histórico lista vendas entre sessões (scope=all) com badges | ✅ Confirmada / Cancelada / Devolvida |
| Venda de caixa fechado mostra botão **Devolver**; do caixa aberto, **Cancelar** | ✅ |
| Caixa fechado → banner "abra o caixa" e ações ocultas | ✅ |
| Devolução pela UI (motivo) → venda vira **Devolvida** | ✅ #e0172543 (Devolvida 3→4) |
| Console do navegador | ✅ sem erros |
| Caixa mostra linha **"Devoluções / saídas"** em vermelho e reduz o Esperado | ✅ −R$38,20 → esperado R$161,80 (abertura R$200) |

> A devolução é sempre da venda **inteira** nesta fase; devolução **parcial** (itens/quantidades)
> está registrada como melhoria futura no ROADMAP e no ADR-006.

### 2.M — Upload de logo da loja (Cloudflare R2) (2026-07-01)

ADR-007. **R2 binding** (`[[r2_buckets]]` → `MEDIA`) no Worker, sem chaves S3/CORS.
API: `POST /tenant/logo` (valida tipo/tamanho, `env.MEDIA.put`, grava só `logoUrl`),
`DELETE /tenant/logo` (apaga objeto + zera `logoUrl`) e `GET /public/logo/:tenantId`
(leitura pública servida pelo Worker, cache longo + cache-bust `?v=`). Validação pura
`validateLogo` em `packages/shared` (PNG/JPG/WebP, ≤ 1 MB) reusada no front e no back.
UI nova `/configuracoes` (preview + validação + Salvar/Remover). **Sem migration** —
`Tenant.logoUrl` já existia. **Proibido BLOB/Base64** (CLAUDE.md): só a URL no banco.

**Build / typecheck / core (local)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/api` (`tsc --noEmit`, após `prisma generate`) | sem erros | ✅ API OK |
| Build de produção (`next build`) | rota `/configuracoes` gerada | ✅ 11 rotas, sem erros (3.12 kB) |
| Core (Vitest) — regressão (nada quebrou) | 35/35 | ✅ 35/35 |

**UI no navegador (`/configuracoes`, `npm run dev` → API publicada)**

| Teste | Resultado |
|---|---|
| Item "Configurações" no menu lateral | ✅ |
| Tela renderiza (card Logo + card Dados da loja) | ✅ console sem erros |
| `GET /tenant` popula os dados | ✅ "Loja Demo" (logoUrl null → placeholder "Sem logo") |
| Botão "Salvar logo" desabilitado sem arquivo | ✅ (cinza) |
| Botão "Remover" oculto quando não há logo | ✅ |

**Nuvem + E2E (usuário) — 2026-07-01**

R2 ativado no painel · bucket `nexoloja-media` criado (`wrangler r2 bucket create`) ·
Worker publicado (`wrangler deploy`) com as rotas novas.

| Teste | Resultado |
|---|---|
| `wrangler r2 bucket create nexoloja-media` | ✅ criado (após ativar o R2 no painel) |
| `wrangler deploy` (rotas `/tenant/logo`, `/public/logo/:tenantId`) | ✅ publicado |
| Upload de logo em `/configuracoes` → aparece na tela e persiste | ✅ validado no navegador pelo usuário |
| Logo no **cabeçalho do comprovante** (80mm/A4) | ✅ validado no navegador pelo usuário |

> Erro inicial `code: 10042` ("enable R2 through the Cloudflare Dashboard") resolvido
> ativando o R2 no painel da conta (aceitar termos) antes de criar o bucket.

### 2.N — Editar dados da loja (nome/CNPJ/telefone) (2026-07-01)

API: `PATCH /tenant` com `updateTenantSchema` (`packages/shared`) — nome obrigatório
(1–120), CNPJ (≤18) e telefone (≤20) opcionais, com string vazia normalizada para `null`
(evita colisão no índice único de `cnpj`); erro `P2002` do CNPJ mapeado para **409**. UI:
o card "Dados da loja" em `/configuracoes` virou formulário (inputs + Salvar/Descartar;
"Salvar" só habilita quando há alteração real em relação ao banco), com mensagens de
erro/sucesso próprias (separadas do card da Logo). **Sem migration** — `name/cnpj/phone`
já existiam no `Tenant`.

**Build / typecheck (local)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/api` (`tsc --noEmit`, após `prisma generate`) | sem erros | ✅ |
| Build de produção (`next build`) | rota `/configuracoes` gerada | ✅ 13 rotas, sem erros (3.66 kB) |

**Deploy (produção)**

| Teste | Esperado | Resultado |
|---|---|---|
| `wrangler deploy` (rota `PATCH /tenant`) | publicado | ✅ versão `6b2d9093` (`nexoloja-api.imortal.workers.dev`) |
| Smoke test `PATCH /tenant` **sem token** | rota existe e exige auth | ✅ 401 (não 404) |

**Ajuste — máscara de CNPJ/telefone + canonicalização (2026-07-01)**

Helpers puros em `packages/shared` (`onlyDigits`, `formatCnpj`, `formatPhoneBr`). O banco
passa a guardar **só dígitos** (forma canônica) — o `updateTenantSchema` normaliza no
servidor (independe da pontuação; robustece o índice único de `cnpj`). Na UI, os campos
aceitam **só números** ao digitar (`onChange` → dígitos) e **formatam ao sair do campo**
(`onBlur` → `00.000.000/0000-00` / `(00) 00000-0000`); comparação de "alterado" por dígitos.
Exibição formatada também no comprovante (`ReceiptPrint`).

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/api` + build `next build` (após o ajuste) | sem erros | ✅ 13 rotas (`/configuracoes` 3.9 kB) |
| `wrangler deploy` (schema Zod atualizado) | publicado | ✅ versão `c6486aca` |

**E2E no navegador (usuário)**

| Teste | Resultado |
|---|---|
| `/configuracoes` → editar CNPJ → **Salvar** → persiste | ✅ validado pelo usuário |
| Máscara: digitar só dígitos → formata ao sair do campo (CNPJ/telefone) | ✅ validado pelo usuário |

> **Esclarecimento (pontos levantados no uso):** o índice único de `cnpj` é da tabela
> **`Tenant`** (uma loja não pode repetir o CNPJ de **outra loja**). Não há relação com o
> `cpfCnpj` de **Cliente** (tabela diferente, único por `[tenantId, cpfCnpj]`) — por isso
> gravar no CNPJ da loja o mesmo CNPJ de um cliente é **aceito** (correto). E o **409** só
> dispara contra outra loja; como só existe a `loja-demo` e ainda não há tela de criar loja
> (bootstrap é via script invite-only), esse caminho não é alcançável hoje.

> **Pendente (usuário):** E2E no navegador — login → `/configuracoes` → editar
> nome/CNPJ/telefone → **Salvar** → persiste; reeditar CNPJ para um já usado → **409**.
> A tela é protegida por login (senha, digitada só pelo usuário), então o E2E fica com o
> usuário, como nas etapas anteriores (2.M).

### 2.O — RBAC + gestão de usuários da loja — fatia 1 (2026-07-01)

ADR-008. Papéis **Admin** (`OWNER`/`MANAGER`) e **Usuário** (`CASHIER`/`STOCK`) derivados do
`UserRole` atual — **sem migration** (funções puras em `packages/shared/roles.ts`:
`isAdminRole`, `toStoreRole`, `storeRoleToUserRole`). API: middleware `requireAdmin`;
`GET /me` (papel para o front); `/users` (`GET` lista, `PATCH /:id` define papel/ativação com
guardas — não altera o próprio usuário nem o `OWNER` — e grava `AuditEvent CHANGE_ROLE`,
ADR-004); `PATCH /tenant` e upload/remoção de logo passaram a exigir Admin. Front: hook
`useMe`, item **Configurações** escondido para não-Admin, guard na página e nova seção
**Usuários** em `/configuracoes`. Convite por e-mail fica para a fatia 2 (exige `service_role`).

**Build / typecheck (local)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/api` (`tsc --noEmit`, após `prisma generate`) | sem erros | ✅ |
| Build de produção (`next build`) | `/configuracoes` regenerada | ✅ 13 rotas, sem erros (4.99 kB) |

**Deploy + smoke (produção)**

| Teste | Esperado | Resultado |
|---|---|---|
| `wrangler deploy` (RBAC + `/me` + `/users`) | publicado | ✅ versão `909427d2` |
| `GET /me` sem token | exige auth | ✅ 401 |
| `GET /users` sem token | exige auth | ✅ 401 |

**API publicada (E2E — script `e2e-rbac`, 14/14)**

Segundo usuário de teste criado na loja-demo (`caixa@lojademo.com`, `CASHIER`) via novo
script `packages/db/scripts/create-user.mjs`. Login real dos dois usuários (owner + caixa)
→ JWT → Bearer. O caixa é revertido a `USER`/ativo ao fim do roteiro.

| Teste | Esperado | Resultado |
|---|---|---|
| owner `/me` → papel derivado | ADMIN (role OWNER) | ✅ |
| caixa `/me` → papel derivado | USER (role CASHIER) | ✅ |
| owner `GET /users` | 200 + lista (2 usuários) | ✅ |
| lista traz o caixa como USER | sim | ✅ |
| caixa `GET /users` | 403 (requireAdmin) | ✅ |
| caixa `PATCH /tenant` | 403 | ✅ |
| owner `PATCH` em si mesmo | 400 (não altera o próprio acesso) | ✅ |
| owner promove caixa → ADMIN | 200, grava role `MANAGER` | ✅ |
| caixa passa a enxergar como ADMIN e acessa `/users` | 200 | ✅ |
| owner reverte caixa → USER | 200, grava role `CASHIER` | ✅ |
| owner desativa o caixa | 200, `isActive=false` | ✅ |
| caixa desativado → `/me` | 403 (bloqueado no `requireAuth`) | ✅ |
| owner reativa o caixa | 200, `isActive=true` | ✅ |

> `AuditEvent CHANGE_ROLE` é gravado em cada `PATCH /users/:id` (ADR-004). Falta apenas a
> **confirmação visual no navegador** (menu esconde Configurações p/ Usuário; seção Usuários
> para Admin) — a lógica que a tela consome já está validada acima.

### 2.P — Perfil do usuário ("Meus dados") + trocar senha (2026-07-01)

Menu de conta no rodapé do menu lateral (ícone de usuário + nome; popover com nome/e-mail/
papel, **Meus dados** e **Sair**). Painel **Meus dados** edita nome + **telefone** (via
`PATCH /me`) e troca a **senha** pelo Supabase Auth no cliente, **com reautenticação** (pede
a senha atual → `signInWithPassword` → `updateUser`). E-mail somente leitura. Telefone
guardado como só dígitos (formata na exibição, igual ao Tenant).

Migration **`0004_user_phone`** — coluna `phone VARCHAR(20)` opcional em `users`. Sem
alteração de RLS (as políticas de linha da 0002 cobrem a nova coluna).

**Migration / build (local)**

| Teste | Esperado | Resultado |
|---|---|---|
| `prisma migrate deploy` (0004) | aplicada | ✅ |
| `prisma migrate status` | up to date | ✅ "Database schema is up to date" |
| Typecheck `apps/api` + `next build` | sem erros | ✅ 13 rotas |

**API publicada (E2E — script `e2e-me`, 6/6)**

Worker republicado (versão `685109c2`). Login real do `caixa@lojademo.com`.

| Teste | Esperado | Resultado |
|---|---|---|
| `GET /me` inclui `phone` | campo presente | ✅ |
| `PATCH /me` (nome + telefone) | 200 | ✅ |
| Nome atualizado | "Operador de Caixa" | ✅ |
| Telefone normalizado p/ dígitos | `11987654321` (de `(11) 98765-4321`) | ✅ |
| Nome vazio | bloqueado | ✅ 400 |
| Telefone vazio → `null` + nome restaurado | ok | ✅ |

**Navegador (usuário) — 2026-07-01**

| Teste | Resultado |
|---|---|
| Editar telefone do `caixa` pelo painel **Meus dados** | ✅ salvo |
| **Trocar senha** (com senha atual) | ✅ trocada |
| Logout → login com a **senha antiga** | ✅ erro (como esperado) |
| Login com a **senha nova** | ✅ entrou normalmente |

> A troca de senha é client-side (Supabase Auth) com reautenticação — só o usuário digita
> as senhas. Fluxo confirmado ponta a ponta pelo usuário.

### 2.Q — Convite de usuário por e-mail — fatia 2 do ADR-008 (2026-07-01)

ADR-008, fatia 2. Convite por e-mail via `inviteUserByEmail` do Supabase Auth
(`POST /auth/v1/invite` com a `service_role`). Novo `inviteUserSchema` em
`packages/shared/roles.ts` (e-mail + papel Admin/Usuário + `redirectTo` opcional). API:
`POST /users/invite` (Admin) cria/recupera o usuário no Auth, envia o e-mail e grava a linha
em `users` com o papel (upsert por `id = auth.users.id`, ADR-005), com guardas de
multi-tenancy (não sequestra e-mail de outra loja; 409 se já existe na loja) e `AuditEvent
CHANGE_ROLE` (ADR-004). Front: formulário **Convidar** na seção Usuários de `/configuracoes`
e nova página pública `/definir-senha` (o convidado define a senha via `updateUser` e entra).
**Sem migration** — opera sobre `users`/`AuditEvent` existentes. **Novo secret do Worker:**
`SUPABASE_SERVICE_ROLE_KEY` (binding em `request.ts`; provisionado pelo usuário via
`wrangler secret put`).

**Build / typecheck / core (local)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/api` (`tsc --noEmit`, após `prisma generate`) | sem erros | ✅ |
| Build de produção (`next build`) | rotas `/configuracoes` + `/definir-senha` | ✅ 14 rotas (`/configuracoes` 5.47 kB, `/definir-senha` 1.64 kB) |
| Core (Vitest) — regressão (nada quebrou) | 35/35 | ✅ 35/35 |

**Provisionamento + deploy (usuário) — 2026-07-01**

| Passo | Resultado |
|---|---|
| `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (secret do Worker) | ✅ provisionado |
| `wrangler deploy` (publica `POST /users/invite`) | ✅ publicado |
| Supabase *URL Configuration*: Site URL `http://localhost:3000` + Redirect `http://localhost:3000/**` | ✅ configurado |

**E2E no navegador (usuário) — `http://localhost:3000`, 2026-07-01**

| Teste | Resultado |
|---|---|
| Login Admin → **Configurações → Usuários → Convidar** (e-mail + papel) | ✅ "Convite enviado" + surge na lista |
| E-mail de convite chega (SMTP do Supabase) | ✅ recebido |
| Link do e-mail → `/definir-senha` → definir senha → entra na loja | ✅ |
| Logout → login com o **novo usuário + senha definida** | ✅ entrou |

> Fatia 2 do ADR-008 **concluída** — fecha a gestão de usuários (RBAC + convite) da Fase 2.

**Personalização do e-mail — nome da loja (2026-07-01)**

O `POST /users/invite` passou a enviar `data: { store_name }` (nome do `Tenant`), que ficaria
disponível no template como `{{ .Data.store_name }}`. Typecheck `apps/api` ✅. **Porém**, ao
tentar editar o template no painel, constatou-se que **o free tier do Supabase bloqueia a
edição** de assunto/corpo dos e-mails de auth (aviso "Set up custom SMTP to edit templates" —
alternativas: Custom SMTP, Pro ou Send Email hook). Como a edição do template se acopla ao
**remetente próprio**, toda a personalização do e-mail foi **adiada** para a melhoria futura.

| Item | Resultado |
|---|---|
| API envia `data.store_name` no convite (código pronto p/ o futuro template) | ✅ código + typecheck |
| Editar template "Invite user" (assunto/corpo) | ⚠️ bloqueado no free tier (exige Custom SMTP/Pro/hook) |
| Redeploy do Worker p/ enviar o `data` | ⏭️ opcional (sem efeito visível sem template editável) |

> Convite **funciona hoje** com o template padrão do Supabase (em inglês). Personalização do
> template, remetente branded (Custom SMTP) e campo `email` da loja (Reply-To) = **melhorias
> futuras** (ROADMAP). Deploy do **web** no Cloudflare é o próximo passo, fora do ADR-008.

### 2.D — Convite de funcionários por e-mail — ✅ concluído (ver 2.Q)
### 2.I — NFC-e fiscal (SEFAZ) — ⏭️ fase futura dedicada

---

## 2.R — Publicar o web no Cloudflare (OpenNext) — 2026-07-01

> Front `apps/web` (Next.js 15.1.3) publicado no Cloudflare Workers via
> `@opennextjs/cloudflare` (Pages descontinuado, ADR-005). URL gerada, sem domínio próprio:
> **https://nexoloja-web.imortal.workers.dev**. As três `NEXT_PUBLIC_*` são embutidas no
> bundle no `next build` (a partir do `.env.local`) — não são vars/secrets de runtime.

**Config + build (código) — 2026-07-01**

| O que foi testado | Método | Resultado |
|---|---|---|
| Deps OpenNext + wrangler 4 (`apps/web`) | `npm install -D @opennextjs/cloudflare wrangler@4` | ✅ instaladas |
| `open-next.config.ts` + `wrangler.jsonc` (`nodejs_compat`, assets) | criados | ✅ |
| Build do adaptador (Next build + bundle Worker) | `opennextjs-cloudflare build` | ✅ 12 rotas, `worker.js` gerado |

**Deploy + smoke automatizado (Claude, wrangler autenticado) — 2026-07-01**

| Passo | Método | Resultado |
|---|---|---|
| Deploy do web | `opennextjs-cloudflare deploy` | ✅ `nexoloja-web.imortal.workers.dev` |
| Redeploy da API com CORS da nova origem | `wrangler deploy` (`apps/api`) | ✅ publicado |
| `GET /login` (web) | `curl` | ✅ HTTP 200 |
| `GET /` (web, redireciona p/ login) | `curl` | ✅ HTTP 307 |
| `NEXT_PUBLIC_SUPABASE_URL` embutida no bundle servido | `curl` chunk JS | ✅ presente |
| `NEXT_PUBLIC_API_URL` embutida no bundle servido | `curl` chunk JS | ✅ presente |
| CORS preflight da API com `Origin: nexoloja-web.imortal.workers.dev` | `curl -X OPTIONS /me` | ✅ 204 + `access-control-allow-origin` correto |

**Config Supabase + E2E de convite pela URL publicada (usuário) — 2026-07-01**

| Passo | Resultado |
|---|---|
| Supabase *URL Configuration*: Site URL → `https://nexoloja-web.imortal.workers.dev` | ✅ configurado |
| Supabase *Redirect URLs*: `https://nexoloja-web.imortal.workers.dev/**` (cobre `/definir-senha`) + `http://localhost:3000/**` mantido p/ dev | ✅ 2 URLs |
| E2E convite pela URL publicada (convite → e-mail → `/definir-senha` → login) | ✅ validado pelo usuário no navegador |

> **2.R concluída** — web em produção na edge (`nexoloja-web.imortal.workers.dev`), com convite
> de usuário validado ponta a ponta pela URL publicada. Fase 2 100% operacional em produção.

---

## 2.S — UI responsiva (celular/tablet) + recolher menu lateral — 2026-07-02

> Correção de usabilidade após o uso real no celular (a barra lateral fixa espremia a tela e
> nada se ajustava). Exigência do CLAUDE.md ("100% responsivo, PC/tablet/celular"). Mudança
> **100% no front** — sem migration, sem mudança de API.

**Causas de raiz corrigidas**

| # | Problema | Correção |
|---|---|---|
| 1 | Sem `<meta viewport>` → celular renderiza na largura de desktop e dá zoom-out | `export const viewport` (`width=device-width, initial-scale=1`) em `app/layout.tsx` |
| 2 | Menu lateral `w-56` fixo e sempre visível (roubava metade da tela do celular) | Shell reescrito (`app/(app)/layout.tsx`): **gaveta** (drawer overlay) no celular/tablet via botão ☰ + fundo escuro; **recolher** no desktop (botão ‹) com preferência salva em `localStorage` |
| 3 | 7 tabelas com `overflow-hidden` (cortavam no celular) | Trocado por `overflow-x-auto` (rolam lateralmente): produtos, clientes, venda, estoque ×2, relatórios ×2 |

**Build / smoke (Claude, `npm run dev` → preview mobile 375px)**

| Teste | Esperado | Resultado |
|---|---|---|
| `<meta viewport>` no HTML servido | presente | ✅ `width=device-width, initial-scale=1` |
| Página de login no celular (375px) | card no tamanho certo, sem zoom-out | ✅ |
| Rotas do shell compilam (`/products`, `/venda`, `/estoque`, `/relatorios`, `/customers`, `/configuracoes`) | 200 | ✅ 6/6 |
| Console do navegador + logs do dev server | sem erros | ✅ |

**Build + deploy do web (OpenNext → Cloudflare) — 2026-07-02**

| Passo | Resultado |
|---|---|
| `opennextjs-cloudflare build` (via `npm run deploy`) | ✅ 12 rotas, `.open-next/worker.js` gerado |
| `opennextjs-cloudflare deploy` (passo de deploy do wrapper) | ❌ quebra no Windows (`workerd.exe serve --debug-port: unrecognized option`) |
| **Contorno:** `wrangler deploy` direto do artefato já buildado | ✅ publicado (Version `c13b1755`) |
| Reinstalar deps (`@opennextjs/cloudflare`/`wrangler` tinham sumido do node_modules) | ✅ `npm install` na raiz |
| Smoke na URL publicada: `/login` 200 + viewport no HTML | ✅ |
| Smoke: chunk do layout publicado contém o novo shell (`Abrir menu`/`Recolher menu`/`sidebar-collapsed`) | ✅ |

**E2E no navegador (usuário) — pendente**

O menu (gaveta/recolher) só aparece após login (protegido por senha, como nos E2E anteriores):

| Teste | Resultado |
|---|---|
| Celular: ☰ abre/fecha a gaveta; tocar num item navega e fecha; tocar fora fecha | ✅ usuário (celular) |
| Desktop: ‹ recolhe o menu e o estado persiste ao recarregar | ⏭️ usuário |
| Telas (produtos/venda/estoque/relatórios) usáveis no celular sem corte | ✅ usuário (celular) |

**Ajuste 2.S.2 — `dvh` (viewport dinâmica) — 2026-07-02**

Após o teste no celular, dois defeitos com a **mesma raiz** (`h-screen` = `100vh`): (1) o rodapé
da gaveta (**Sair**) caía **atrás da barra do navegador** no celular; (2) no **Safari** a tela
"sambava" ao rolar (a barra do Safari aparece/some e o `100vh` muda de tamanho). Correção: trocar
`h-screen`/`min-h-screen` por **`h-dvh`/`min-h-dvh`** (mede só a área visível). No shell, `inset-y-0`
virou `top-0` (senão `top+bottom` fixaria a altura e o `h-dvh` seria ignorado). Aplicado em: `app/layout.tsx`
(body), `app/(app)/layout.tsx` (container + aside), `login` e `definir-senha`.

| Teste | Esperado | Resultado |
|---|---|---|
| Tailwind gera as classes (`.h-dvh`/`min-h-dvh`/`100dvh`) | presentes no CSS | ✅ (Tailwind 3.4) |
| `opennextjs-cloudflare build` | worker gerado | ✅ |
| `wrangler deploy` (contorno Windows) | publicado | ✅ Version `31d3df21` |
| `100dvh` no CSS servido em produção | presente | ✅ |
| Celular: **Sair** visível na gaveta (não fica atrás da barra) | visível | ✅ usuário (celular) |
| Safari: sem "samba" ao rolar | estável | ✅ usuário (celular) |

> **2.S concluída** — UI responsiva (gaveta no celular/tablet + recolher no desktop), tabelas
> roláveis e viewport dinâmica (`dvh`) validados no celular pelo usuário. A exigência de "100%
> responsivo" do CLAUDE.md está atendida em produção (`nexoloja-web.imortal.workers.dev`).

---

## Fase 2.5 — Plataforma (ADR-009)

### 2.5.A — Fundação de identidade de plataforma (Super Usuário) — 2026-07-02

ADR-009, Fatia A (ver `docs/plano-fase-2.5.md`). Migration **`0005_platform_admin`** (tabela
cross-tenant `platform_admins`, RLS ligado sem policy de cliente, e **extensão do access token
hook** para injetar `is_platform_admin`). Middleware `requirePlatformAuth` (autoriza pela tabela,
não pelo claim), rotas `/platform/me` e `/platform/tenants` (acesso cross-tenant controlado),
script `create-platform-admin.mjs`. Identidade dupla: tabela = verdade, claim = atalho de UI.

**Build / migration (local + Supabase)**

| Teste | Esperado | Resultado |
|---|---|---|
| `prisma validate` + `generate` (modelo `PlatformAdmin`) | schema válido | ✅ |
| `CREATE TABLE` escrito à mão == SQL canônico do Prisma (sem drift) | igual | ✅ (conferido via `migrate diff --from-empty`) |
| Typecheck `apps/api` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| `prisma migrate deploy` (0005) no Supabase | aplicada | ✅ |
| `prisma migrate status` | up to date | ✅ |
| Drift schema × banco (`migrate diff --exit-code`) | sem diferença | ✅ |
| `wrangler deploy` (rotas `/platform/*`) | publicado | ✅ Version `7f7fcd7e` |

**E2E contra a API publicada (script `e2e-platform`, 10/10)**

Super usuário `super_owner@nexoloja.local` provisionado pelo script (e-mail sintético não-entregável;
senha inicial `super123`, a trocar pelo usuário). Login real via Supabase Auth (anon key → JWT).

| Teste | Esperado | Resultado |
|---|---|---|
| Login do super usuário | 200 + token | ✅ |
| JWT traz `is_platform_admin=true` e `tenant_id=null` | claim de plataforma, sem tenant | ✅ |
| `GET /platform/me` | 200, `isPlatformAdmin` | ✅ `super_owner@nexoloja.local` |
| `GET /platform/tenants` (cross-tenant) | 200 + lista | ✅ 1 loja (Loja Demo, 5 usuários) |
| Campos da loja (slug/isActive/userCount) | presentes | ✅ |
| Login do owner de loja | 200 + token | ✅ |
| JWT do owner **sem** `is_platform_admin`, `tenant_id` intacto | hook não quebrou a loja | ✅ |
| owner em `/platform/me` e `/platform/tenants` | 403 | ✅ 403/403 |
| Rotas `/platform/*` sem token | 401 | ✅ |

> **Fatia A concluída.** O hook estendido preserva 100% o comportamento dos usuários de loja
> (owner mantém `tenant_id` e não ganha claim de plataforma). Próximo: **Fatia B** (onboarding —
> `POST /platform/tenants` cria loja + convida 1º Admin). Falta a confirmação visual do painel
> (Fatia C, UI) — ainda não implementada.

### 2.5.B — Onboarding: criar loja + 1º Admin (Super Usuário) — 2026-07-02

ADR-009, Fatia B. `POST /platform/tenants` cria `Tenant` + convida o 1º Admin (`OWNER`) por
e-mail (reusa `inviteAuthUser`, agora extraído p/ `apps/api/src/lib/authAdmin.ts` e compartilhado
com o convite de loja). `createTenantSchema` + helper puro `slugify` (`packages/shared`): `slug`
derivado do nome quando ausente. Unicidade slug/cnpj → 409; tudo em transação com `AuditEvent
CREATE_TENANT`. **Sem migration** (usa `Tenant`/`User`/`AuditEvent`). Substitui o `bootstrap-tenant.mjs`
como operação de produto.

**Build (local)**

| Teste | Esperado | Resultado |
|---|---|---|
| `slugify` (acentos/símbolos/espaços → kebab) | puro, correto | ✅ ("Loja do Zé & Cia" → `loja-do-ze-cia`) |
| Typecheck `apps/api` (`tsc --noEmit`, após refactor do `inviteAuthUser`) | sem erros | ✅ exit 0 |
| `wrangler deploy` (rota `POST /platform/tenants`) | publicado | ✅ Version `ff3889d4` |

**E2E contra a API publicada (script `e2e-onboarding`, 12/12)**

Loja de teste criada e **removida ao final** (cascade nos usuários + conta throwaway no Auth
apagada) — banco limpo. Para não esbarrar no rate limit de e-mail do free tier, o admin é
pré-criado via `admin/users` (sem envio) e o convite cai no ramo "já registrado" (recupera o id).

| Teste | Esperado | Resultado |
|---|---|---|
| `POST /platform/tenants` (super usuário) | 201 | ✅ |
| `slug` derivado do nome | kebab-case | ✅ `loja-teste-b-…` |
| 1º admin vinculado como `OWNER` | dono da loja nova | ✅ |
| Loja nasce ativa | `isActive=true` | ✅ |
| Nova loja aparece em `GET /platform/tenants` | com `userCount=1` | ✅ |
| Slug repetido | bloqueado | ✅ 409 |
| `adminEmail` inválido | bloqueado (Zod) | ✅ 400 |
| Usuário de loja em `POST /platform/tenants` | barrado | ✅ 403 |
| `AuditEvent CREATE_TENANT` gravado (meta com slug/adminEmail/OWNER) | sim | ✅ |
| Limpeza (tenant + auth user de teste) | removidos | ✅ |

> O **envio real do e-mail de convite** (para um endereço real) não é automatizável aqui — rate
> limit de e-mail do free tier + precisa de inbox real. Fica para o E2E de navegador na **Fatia C**
> (criar loja pelo painel com um e-mail seu → convite chega → 1º Admin define senha → entra na loja
> nova), como no ADR-008 fatia 2. A lógica do endpoint (validação, unicidade, transação, auditoria)
> está provada acima.

> **Fatia B concluída (API).** Próximo: **Fatia C** — painel `/plataforma` (UI do Super Usuário:
> listar/criar/ativar lojas + roteamento de login por papel).

### 2.5.C — Painel de gestão de lojas (UI `/plataforma`) — 2026-07-02

ADR-009, Fatia C. Nova API `PATCH /platform/tenants/:id` (ativar/inativar `Tenant.isActive` +
`AuditEvent SET_TENANT_ACTIVE`) e `setTenantActiveSchema` (shared). Front: área **`/plataforma`**
separada do shell de loja `(app)`, com layout/guard próprios (`GET /platform/me`); página lista
lojas + form "Nova loja" (→ `POST /platform/tenants`) + botão ativar/inativar por linha.
**Roteamento por papel no login** (`tokenIsPlatformAdmin` lê o claim do token recém-emitido):
super usuário → `/plataforma`; usuário de loja → `/products`. O shell `(app)` também redireciona
super usuário para `/plataforma` (não fica preso no app de loja). **Sem migration.**

**Build (local)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/api` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| Build de produção (`next build`) | rota `/plataforma` gerada | ✅ 13 rotas, sem erros (3.93 kB) |
| `wrangler deploy` API (rota `PATCH /platform/tenants/:id`) | publicado | ✅ Version `76fe3134` |
| Deploy web (OpenNext + `wrangler deploy`) | publicado | ✅ Version `05a05fc4` |

**E2E `PATCH /platform/tenants/:id` (script `e2e-tenant-active`, 7/7)** — loja de teste criada e removida.

| Teste | Esperado | Resultado |
|---|---|---|
| `PATCH isActive=false` (super usuário) | 200, `isActive=false` | ✅ |
| `PATCH isActive=true` | 200, `isActive=true` | ✅ |
| `isActive` inválido | bloqueado (Zod) | ✅ 400 |
| Loja inexistente | não encontrada | ✅ 404 |
| Usuário de loja em `PATCH` | barrado | ✅ 403 |
| `AuditEvent SET_TENANT_ACTIVE` gravado (2×: off+on) | sim | ✅ count=2 |

**UI no navegador (Claude, preview → API publicada; login real `super_owner`)**

| Teste | Resultado |
|---|---|
| Login `super_owner@nexoloja.local` roteia direto p/ `/plataforma` | ✅ (sem passar por `/products`) |
| Painel renderiza (header "Plataforma" + form "Nova loja" + tabela) | ✅ console sem erros |
| Lista lê `GET /platform/tenants` | ✅ Loja Demo (CNPJ formatado, 5 usuários, criada 25/06/2026, "Ativa", botão "Inativar") |
| Responsivo no celular (375px): form em coluna única, tabela rolável | ✅ |

> **Ajuste — bounce no login:** a 1ª tentativa roteava `/products` ↔ `/plataforma` porque
> `getSession()` logo após o `signInWithPassword` vinha defasado. Corrigido lendo o claim do
> **token retornado diretamente** pelo login (`tokenIsPlatformAdmin`). Reteste: vai direto p/ `/plataforma`.

**E2E de navegador (usuário) — validado (2026-07-05)**

| Teste | Resultado |
|---|---|
| Login `super_owner` (senha `super123`) → painel; **trocar a senha** | ✅ usuário |
| **Criar loja** pelo painel com um e-mail real → convite chega → 1º Admin define senha → entra na loja nova | ✅ usuário |
| Ativar/inativar uma loja pelo painel | ✅ usuário |

> **Fatia C concluída (código + validação técnica + E2E do usuário).** O fluxo de onboarding
> (criar loja pelo painel → convite por e-mail real → 1º Admin define senha → entra na loja nova)
> e o ativar/inativar por linha foram validados no navegador pelo usuário em 2026-07-05.

### 2.5.Del — Exclusão de usuário da loja (ADR-008) — 2026-07-03

Pré-requisito pedido antes da Fatia D (liberar um e-mail de teste). `DELETE /users/:id` (Admin):
apaga a linha em `users` **+ revoga a identidade no Supabase Auth** (`deleteAuthUser` — `DELETE
/auth/v1/admin/users/{id}` via `service_role`, o que **libera o e-mail** para um convite novo) **+
`AuditEvent DELETE_USER`** (na mesma transação do banco; a revogação no Auth é best-effort, fora da
tx, pois a exclusão da linha já corta o acesso). Guardas: não exclui a si mesmo nem o `OWNER`;
usuário **com histórico** (`Order`/`CashSession` — FKs sem cascade) → **409** orientando a
*Desativar* (preserva integridade + auditoria; a trilha sobrevive porque `AuditEvent.userId` é ref.
solta). Front: botão **Excluir** (vermelho) ao lado de Desativar/Ativar na seção Usuários de
`/configuracoes`, com `window.confirm`. **Sem migration.**

**Build (local)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/api` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ exit 0 |

**Deploy (Claude) — 2026-07-03**

| Passo | Resultado |
|---|---|
| `wrangler deploy` API (rota `DELETE /users/:id`) | ✅ Version `9f86b36c` |
| Smoke `DELETE /users/:id` sem token | ✅ 401 (rota existe, exige auth) |
| Build + deploy do **web** (botão Excluir) | ✅ Version `41ca16a3` (chunk `configuracoes` contém "Excluir") |

**E2E de navegador (usuário) — validado (2026-07-05)**

| Teste | Resultado |
|---|---|
| Login Admin → `/configuracoes` → **Excluir** `dougns100@gmail.com` (sem histórico) → some da lista | ✅ usuário |
| Excluir usuário **com** histórico de venda/caixa → **409** "use Desativar" | ✅ usuário |
| `AuditEvent DELETE_USER` gravado (via service_role) | ✅ usuário |
| Recriar a loja de teste reusando o e-mail liberado (convite chega) | ✅ usuário |

> **2.5.Del concluída (E2E do usuário).** Exclusão de usuário sem histórico remove da lista +
> libera o e-mail; usuário com histórico cai no **409** orientando a *Desativar*; auditoria
> `DELETE_USER` gravada. Validado no navegador pelo usuário em 2026-07-05.

### 2.5.D — Auditoria de plataforma (documental) — 2026-07-03

ADR-009, Fatia D. **Sem código de produto, sem migration, sem deploy** — formaliza a auditoria já
emitida. **ADR-004** ganhou a subseção **"Lista fechada de ações auditadas"** com as duas famílias:
eventos de loja (`CANCEL_ORDER`, `RETURN_ORDER`, `CHANGE_PRICE`, `ADJUST_STOCK`,
`CLOSE_CASH_WITH_DIVERGENCE`, `CHANGE_ROLE`, `DELETE_USER`) e eventos de **plataforma**
(`CREATE_TENANT`, `SET_TENANT_ACTIVE`, com `meta.platform = true`, `userId` = Super Usuário e
`tenantId` = loja-alvo). **ADR-009** marcado como **Implementado (Fatias A–D)**, com o design da
**Fatia E** (impersonation auditada) registrado em "Status de implementação". ROADMAP atualizado.

| Item | Resultado |
|---|---|
| ADR-004 — lista fechada de ações (loja + plataforma) formalizada | ✅ |
| ADR-004 — Action Items marcados como concluídos | ✅ |
| ADR-009 — status "Implementado — Fatias A–D" + esboço da Fatia E | ✅ |
| ROADMAP — Fatia D marcada; Fatia E listada como futura | ✅ |

### Infra.Deploy-Win — Correção do deploy do web no Windows (workerd) — 2026-07-03

Resolve de vez o bloqueio registrado em **2.S** (`opennextjs-cloudflare deploy` quebrava com
`workerd.exe serve: --debug-port: unrecognized option`). **Causa raiz:** o `apps/web` usa
**wrangler 4.106**, que depende de `workerd@1.20260630.1` e passa `--debug-port` ao `workerd serve`
(validação de startup). O pacote meta `workerd@1.20260630.1` estava instalado, mas o **binário de
plataforma** `@cloudflare/workerd-windows-64` só existia na versão **antiga** `1.20250718.0` (hoisted
na raiz, puxada pelo wrangler 3.114 da API) — que **não conhece** `--debug-port`. Por resolução de
módulos, o workerd novo acabava executando o binário velho → erro. (A API não sofria: usa wrangler
3.114, que não passa `--debug-port`.)

**Correção:** fixar o binário Windows na versão que casa com o workerd novo, como
**`optionalDependency` do workspace `apps/web`**:

```
npm install @cloudflare/workerd-windows-64@1.20260630.1 -w apps/web --save-optional
```

O npm aninha o binário novo em `apps/web/node_modules` (o antigo permanece na raiz para a API). É
`optional` + gated por `os: ['win32']`, então em Linux/macOS/CI é ignorado sem erro.

| Teste | Esperado | Resultado |
|---|---|---|
| Binário novo aninhado no web + antigo na raiz | 2 cópias coexistindo | ✅ `apps/web` 1.20260630.1 · raiz 1.20250718.0 |
| `npx wrangler deploy` (4.106) no web — antes falhava no `--debug-port` | publica | ✅ Version `5da5c671` (Startup 27 ms) |
| **`npm run deploy`** (canônico: `opennextjs-cloudflare build && deploy`) | publica sem o erro do Windows | ✅ Version `41ca16a3` (Startup 21 ms) |
| Deploy da API (wrangler 3.114) segue funcionando | intacto | ✅ Version `9f86b36c` |

> A partir de agora o **`npm run deploy` do web funciona direto no Windows** — o contorno manual do
> 2.S (`wrangler deploy` do artefato) deixa de ser necessário. Se um upgrade futuro do wrangler
> subir a versão do `workerd`, repetir o `npm install` do `@cloudflare/workerd-windows-64` na versão
> correspondente.

> **Superado por "Infra.WranglerV4" (2026-07-03):** com a API também migrada para o wrangler 4, a
> raiz passou a ter um `workerd` único e correto, e os binários aninhados (inclusive este do web)
> foram **removidos** — não são mais necessários.

### 2.5.Inact — Bloqueio de loja desativada (ADR-009) — 2026-07-03

Achado no E2E do usuário: ao **desativar** uma loja pelo painel (`SET_TENANT_ACTIVE`), o usuário
dela ainda logava e operava normalmente — a flag `Tenant.isActive` não tinha efeito. Corrigido:
desativar passa a ter consequência real, sem trancar o usuário para fora (ele ainda consulta e
encerra pendências).

**Servidor (a barreira de verdade):** `requireAuth` passou a carregar `tenant.isActive` (sem query
extra — join no `findUnique` do usuário) e a setar `tenantActive` no contexto. `GET /me` devolve o
flag. Novo middleware `requireActiveTenant` (em `middleware/auth.ts`) barra com **403**, quando a
loja está inativa: **`POST /orders`** (venda nova), **`POST /cash-sessions/open`** (abrir caixa) e
**`POST /stock/movements`** (entrada de estoque). Fechar caixa, ajuste de inventário (`/stock/adjust`),
cancelar/devolver e todas as consultas seguem liberados de propósito (encerramento/correção).
**Front:** `useMe` expõe `tenantActive`; `(app)/layout` mostra um **aviso vermelho no topo** de toda
tela (lista as três operações bloqueadas). Componente reutilizável `<StoreDisabledNotice>` (caixa
vermelha padronizada) exibido **proativamente** (guiado por `me.tenantActive` — aparece já ao abrir a
tela, sem depender de um 403): **Nova Venda** troca o PDV pela caixa; **Caixa** troca o form "Abrir
caixa" pela caixa (fechar caixa continua na tela); **Estoque** troca o card "Entrada de estoque" pela
caixa (Ajuste de inventário + históricos continuam). **Sem migration.** *(refino 2026-07-03: antes as
telas de Caixa/Estoque só mostravam o erro 403 após tentar a ação; passaram a avisar na entrada, com o
mesmo layout da Nova Venda.)*

**Build + deploy (Claude) — 2026-07-03**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/api` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| `wrangler deploy` API — 1ª fatia (só vendas) | publicado | ✅ Version `5ea4cf30` |
| `wrangler deploy` API — estende p/ abrir caixa + entrada de estoque | publicado | ✅ Version `daf90038` |
| `npm run deploy` web (aviso + bloqueio da Nova Venda) | publicado | ✅ Versions `239ed369` → `533c1921` |

**E2E de navegador (usuário) — validado (2026-07-05)**

| Teste | Resultado |
|---|---|
| Super Usuário **inativa** a loja no painel `/plataforma` | ✅ usuário |
| Login com usuário da loja inativa → **aviso vermelho no topo** em todas as telas | ✅ usuário |
| Abrir **Nova Venda** → tela bloqueada ("Loja desativada") | ✅ usuário |
| **Abrir caixa** → 403 "Loja desativada" (fechar caixa continua funcionando) | ✅ usuário |
| **Entrada de estoque** → 403 "Loja desativada" (ajuste de inventário continua) | ✅ usuário |
| Tentar `POST /orders` direto (fora da UI) → **403** "Loja desativada" | ✅ usuário |
| **Reativar** a loja → aviso some e as três operações voltam | ✅ usuário |

> Bloqueio server-enforced nas 3 rotas de escrita "de negócio". Correções/encerramentos (fechar
> caixa, ajuste, cancelar, devolver) permanecem liberados por design — uma loja suspensa ainda
> precisa conseguir encerrar pendências.

> **Fase 2.5 (A–D) fechada.** Resta o E2E de navegador do usuário (Fatia C: criar loja com e-mail
> real; 2.5.Del: excluir usuário) e o deploy do Worker com o `DELETE /users/:id`. **Fatia E**
> (entrar no contexto da loja para suporte) fica como fatia futura, com direção travada no ADR-009.

### Infra.Retry — Retry de leitura no cliente (cold start) — 2026-07-03

Achado no uso: ao abrir **Estoque** após ociosidade, a 1ª carga demorou e deu **`Failed to fetch`**;
o retry manual funcionou. Causa: **cold start** da stack no free tier (Supabase pausa/esfria +
Hyperdrive/Worker frios) — a 1ª requisição depois de parada falha no nível de **rede**/timeout e a
seguinte já funciona (conexão quente). Não é bug do app.

Correção (front, `apps/web/lib/api.ts`): `apiGet` ganhou **retry com backoff** — até 2 re-tentativas
(400 ms, 1200 ms) + timeout de 12 s por tentativa (`AbortController`). Re-tenta **só GET**
(idempotente) e **só em falha de rede/timeout** (`fetch` lançou `TypeError`/`AbortError`); erro HTTP
(401/403/404/409/500) é resposta válida e **não** é re-tentado. POST/PATCH/DELETE ficam de fora (não
idempotentes). Web publicado (Version `750ea631`).

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| `apiGet` re-tenta em falha de rede; propaga erro HTTP sem re-tentar | lógica | ✅ (código) |
| E2E: 1ª carga após ociosidade não falha mais (ou se recupera sozinha) | — | ⏭️ usuário (observar no uso) |

> Mitigações mais fortes seguem no ROADMAP como futuro de produção: **Supabase Pro** (remove a pausa)
> e/ou keep-warm. O retry é a camada barata que resolve a maioria dos cold starts de leitura.

### Infra.WranglerV4 — API migrada para wrangler 4 + toolchain unificada — 2026-07-03

Fechamento do item que estava adiado: a **API** saiu do wrangler 3.114 (defasado) para o **4.107.0**,
igualando o web. Feito na branch `chore/wrangler-v4-api`. A config `wrangler.toml` da API **não
precisou de mudança** (só chaves padrão: `name`/`main`/`compatibility_date`/`compatibility_flags`/
`[vars]`/`[[hyperdrive]]`/`[[r2_buckets]]`). Como efeito colateral bom, a raiz do `node_modules`
passou a ter **um único `workerd 1.20260701.1`** (meta + binário) e os `@cloudflare/workerd-windows-64`
**aninhados** (o do web, criado em Infra.Deploy-Win, e um que eu cheguei a adicionar por engano na
API) foram **removidos** — deixaram de ser necessários com os dois apps na mesma versão.

**Estado final da toolchain**

| Item | Resultado |
|---|---|
| `apps/api` wrangler | ✅ `^4.107.0` (era `^3.95.0`) |
| `apps/web` wrangler | ✅ `^4.107.0` (era `^4.106.0`) |
| `workerd` (meta + binário Windows) | ✅ **um só na raiz**: `1.20260701.1` |
| binários `@cloudflare/workerd-windows-64` aninhados | ✅ nenhum (removidos de api e web) |

**Validação (API)**

| Teste | Esperado | Resultado |
|---|---|---|
| `wrangler deploy --dry-run` (bindings + build) | sem erro; lista Hyperdrive/R2/`SUPABASE_URL` | ✅ (sem erro de `--debug-port`) |
| `wrangler deploy` (real) | publica | ✅ Version `97929c6f` (Startup 38 ms) |
| `GET /health` | ok | ✅ `{ok:true}` |
| `GET /db-check` (Hyperdrive→Supabase, workerd novo) | conecta | ✅ `{tenants:2}` |
| `GET /me` e `/products` sem token | 401 | ✅ ambos 401 |
| secret `SUPABASE_SERVICE_ROLE_KEY` preservado | segue no Worker (não some no deploy) | ✅ (não é config; persiste) |

**Validação (WEB — regressão do deploy no Windows com o binário unificado)**

| Teste | Esperado | Resultado |
|---|---|---|
| `npm run deploy` (OpenNext build + deploy) | publica sem o bug do Windows | ✅ Version `8e275410` (Startup 23 ms) |

> Item do ROADMAP "atualizar o wrangler da API" **fechado**. As duas apps agora sobem com
> `npm run deploy`/`npx wrangler deploy` de forma idêntica no Windows.

### 2.5.E — Entrar no contexto da loja para suporte (impersonation read-only) — 2026-07-05

ADR-009, Fatia E, em **modo somente-leitura**. O Super Usuário entra numa loja para suporte **sem
virar usuário dela**: a API emite um **token de suporte assinado e curto** (`apps/api/src/lib/
supportToken.ts`, HS256 com o secret `SUPPORT_TOKEN_SECRET` do Worker, TTL 30 min) de escopo
`{ platformAdminId, targetTenantId, exp }`. Fluxo: `POST /platform/tenants/:id/support`
(`requirePlatformAuth`) emite o token + `AuditEvent SUPPORT_SESSION_START`. As rotas de leitura
ficam em **`/support/*`** (montadas FORA de `/platform/*` de propósito — ali o `Authorization: Bearer`
é o token de suporte, não um JWT do Supabase), protegidas por `requireSupportSession`, que **verifica
o token e revalida `platform_admins.isActive`** (desativar o super usuário corta a sessão na hora,
antes do TTL). `GET /support/:tenantId/overview` (dados da loja, contadores, caixa aberto, estoque
baixo, últimas vendas, auditoria recente) confere o `:tenantId` contra o escopo do token (403 se
divergir). `POST /support/end` grava `SUPPORT_SESSION_END`. **RLS de loja intacto** — a fronteira é a
checagem explícita do escopo, como nas rotas `/platform/*`. Front: botão **Entrar (suporte)** por linha
em `/plataforma` → guarda o token no `sessionStorage` (`lib/support.ts`) → `/plataforma/suporte/
[tenantId]` (banner "Modo suporte — somente leitura", overview read-only, **Encerrar sessão**).
Auditoria (`SUPPORT_SESSION_START/END`, `meta.support = true`) formalizada no ADR-004. **Sem migration.**

**Build / typecheck / core (local)**

| Teste | Esperado | Resultado |
|---|---|---|
| `prisma generate` (client c/ `platformAdmin`) | ok | ✅ |
| Typecheck `apps/api` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| Build de produção (`next build`) | rota `/plataforma/suporte/[tenantId]` gerada (dinâmica) | ✅ 15 rotas, sem erros (2.36 kB) |
| Core (Vitest) — regressão (nada quebrou) | 35/35 | ✅ 35/35 |
| `wrangler deploy --dry-run` (API) | build ok, bindings intactos (Hyperdrive/R2/`SUPABASE_URL`) | ✅ sem erro |

> ⚠️ **Observação (toolchain):** o `npx wrangler` do `apps/api` resolveu **3.114.17** no dry-run,
> apesar do commit de migração para a v4 (Infra.WranglerV4). Não bloqueia (o dry-run passou); vale
> conferir se o `node_modules` foi reinstalado após o bump de versão.

**Provisionamento + deploy (Claude) — 2026-07-05**

| Passo | Resultado |
|---|---|
| `wrangler secret put SUPPORT_TOKEN_SECRET` (48 bytes aleatórios via stdin) | ✅ "Uploaded secret" |
| `wrangler deploy` (API — rotas `/platform/tenants/:id/support` + `/support/*`) | ✅ Version `1e323a22` |
| `npm run deploy` (web — botão "Entrar (suporte)" + painel de suporte) | ✅ Version `c13a34de` (chunk `suporte/[tenantId]` publicado) |

**Smoke na API/web publicadas (Claude)**

| Teste | Esperado | Resultado |
|---|---|---|
| `POST /platform/tenants/:id/support` sem token | 401 (existe + exige auth) | ✅ 401 |
| `GET /support/:tenantId/overview` sem token | 401 | ✅ 401 |
| `POST /support/end` sem token | 401 | ✅ 401 |
| `POST /support/end` com `Bearer` inválido | 401 (não 503 → o secret ESTÁ configurado; `verifySupportToken` rejeitou) | ✅ 401 |
| `GET /login` (web) | 200 | ✅ 200 |
| Chunk publicado de `/plataforma` contém "Entrar (suporte)" | presente | ✅ |

**E2E de navegador (usuário) — validado (2026-07-05)**

| Teste | Resultado |
|---|---|
| Login `super_owner` → `/plataforma` → **Entrar (suporte)** numa loja → abre o overview read-only | ✅ usuário |
| Overview lê dados reais da loja-alvo (contadores, caixa, vendas, auditoria) | ✅ usuário |
| **Encerrar sessão** → volta ao painel; `AuditEvent SUPPORT_SESSION_START/END` gravados | ✅ usuário |
| Token expirado / super usuário desativado → `/support/*` responde 401/403 | ✅ usuário |

> **Fatia E (read-only) concluída e validada** — código + validação técnica + deploy (API/web) +
> secret provisionado + smoke em produção + **E2E no navegador validado pelo usuário (2026-07-05)**.
> **Escrita em modo suporte** fica como fatia futura (ADR-009).

### 2.5.E.2 — Painel de suporte navegável: abas + filtros + detalhes (read-only) — 2026-07-05

Evolução da tela de suporte a pedido do usuário — **tudo somente-leitura**. A página
`/plataforma/suporte/[tenantId]` virou **3 abas**: **Resumo** (o overview anterior), **Vendas** e
**Produtos & Estoque**. Três endpoints de leitura novos em `apps/api/src/routes/support.ts` (todos
sob `requireSupportSession`, com o `:tenantId` conferido contra o escopo do token → 403 se divergir):

- `GET /support/:tenantId/orders?from=&to=&status=` — vendas com **filtro de período** (fuso da loja,
  UTC-3, igual aos relatórios) e **status** (`CONFIRMED`/`CANCELLED`/`RETURNED`/`DRAFT`); traz itens +
  pagamentos + cliente por venda (expandir "Ver" mostra o detalhe sem 2ª chamada). Cap 200.
- `GET /support/:tenantId/products?q=&lowStock=1` — materiais cadastrados com **busca** (nome/SKU) e
  **"só estoque baixo"**; traz preço/custo/**margem** (core `calcMarginPercent`), estoque atual/mínimo,
  categoria e flag de baixo. Cap 300.
- `GET /support/:tenantId/stock-movements?productId=` — **movimentações** de um material (entrada/saída,
  motivo, fornecedor), abertas inline pela linha do produto. Cap 100.

Front: abas com estado próprio (cada uma carrega sob demanda), filtros com "Filtrar"/"Limpar", linhas
expansíveis (`Fragment` com `key`) para detalhe de venda e movimentações de produto. Erro 401/403 numa
seção promove a **sessão expirada** (volta ao painel). Nenhuma ação de escrita na tela.

**Build / typecheck / deploy (Claude)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/api` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| Build de produção (`next build`) | `/plataforma/suporte/[tenantId]` 4.61 kB | ✅ 15 rotas, sem erros |
| `wrangler deploy` (API — 3 rotas de leitura novas) | publicado | ✅ Version `1397654d` |
| `npm run deploy` (web — abas/filtros/detalhes) | publicado | ✅ Version `d3f54d16` |
| Smoke: `/support/:id/orders`, `/products`, `/stock-movements` sem token | 401 | ✅ 401/401/401 |
| Smoke: `GET /login` (web) | 200 | ✅ 200 |

**E2E de navegador (usuário) — validado (2026-07-05)**

| Teste | Resultado |
|---|---|
| Aba **Vendas**: filtrar por período/status → lista atualiza; **Ver** abre itens + pagamentos | ✅ usuário |
| Aba **Produtos & Estoque**: buscar por nome/SKU + "só estoque baixo" → lista filtra | ✅ usuário |
| Produto → **Ver** movimentações (entrada/saída, motivo, fornecedor) | ✅ usuário |
| Tudo somente-leitura (nenhum botão de escrita nas abas) | ✅ usuário |

> **2.5.E.2 concluída e validada** — painel de suporte navegável (abas + filtros + detalhes),
> somente-leitura, validado no navegador pelo usuário em 2026-07-05.

---

## Melhoria — "Registrado por" (atribuição de autoria, ADR-010) — 2026-07-05

ADR-010. Cada registro passa a guardar **quem** executou (id solto, sem FK + **snapshot do nome**)
e reusa o **quando** já existente, exibindo "Registrado por … em <data>" nas telas. Migration
**`0006_authorship_attribution`** (aditiva, colunas nullable, sem RLS): `products`/`customers`
ganham `createdBy/updatedBy/deletedBy {Id,Name}`; `orders`/`cash_movements` ganham
`registeredByName`; `stock_movements` ganha `userId` (**antes não tinha**) + `registeredByName`;
`cash_sessions` ganha `openedByName` + `closedBy{Id,Name}`. `requireAuth` passou a expor `userName`
(snapshot). Write-path (produtos, clientes, estoque, vendas, caixa) grava a autoria; UI exibe:
Vendas "Registrado por", Estoque coluna "Registrado por", Produtos/Clientes coluna "Última
alteração", Caixa "Aberto por"; painel de suporte também mostra a autoria. Nível **"quem fez por
último"** (não histórico completo) — complementar ao ADR-004 (cost-zero), não um log de eventos.

**Build / validação local (Claude)**

| Teste | Esperado | Resultado |
|---|---|---|
| `prisma validate` + `generate` (campos novos) | schema válido | ✅ |
| SQL canônico via `migrate diff` (banco vivo → schema) == só as colunas novas (sem drift) | igual | ✅ |
| Typecheck `apps/api` (`tsc --noEmit`, após generate) | sem erros | ✅ exit 0 |
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| Build de produção (`next build`) | sem erros | ✅ 15 rotas |
| Core (Vitest) — regressão | 35/35 | ✅ 35/35 |

**Aplicação + deploy (Claude) — 2026-07-05**

| Passo | Resultado |
|---|---|
| `prisma migrate deploy` (0006) no Supabase (autorizado — Regra 1) | ✅ aplicada · *up to date* · sem drift |
| Deploy da API (grava a autoria) — depois da migration | ✅ Version `a3503411` |
| Deploy do web (exibe "Registrado por"/"Última alteração"/"Aberto por") | ✅ Version `93c9a95e` |
| Smoke: `/health` 200 · `/db-check` `{tenants:2}` (Prisma no schema migrado) · `/login` 200 | ✅ |

**E2E de navegador (usuário) — validado (2026-07-05)**

| Teste | Resultado |
|---|---|
| Criar/editar produto e cliente → "Última alteração" mostra o operador + data | ✅ usuário |
| Registrar venda / entrada de estoque / abrir caixa → "Registrado por" aparece | ✅ usuário |
| Registros antigos (pré-0006) mostram "—" (sem quebrar) | ✅ usuário |

> **Ordem obrigatória (cumprida):** a **migration 0006** foi aplicada ANTES de publicar a API nova
> (que grava colunas que só existem após a migration). Sendo aditiva/nullable, não quebrou a API
> anterior. **Melhoria "Registrado por" (ADR-010) concluída e validada ponta a ponta.**

---

## Melhoria — Estoque inicial no cadastro de produto (ADR-001) — 2026-07-05

Campo opcional **"Estoque inicial"** no cadastro de Produtos. Quando `> 0`, o `POST /products`
cria o produto **e** gera a **Entrada** (`StockMovement` INCOME, `reason: "Estoque inicial
(cadastro)"`, `unitCost` = custo, com autoria ADR-010) na **mesma transação** — o saldo nunca é
escrito solto no cache (`stockQty` = Σ movimentos; reconciliação bate). Vazio → produto nasce com 0
(fluxo anterior). Também **fechou a brecha** do `stockQty` solto: removido de `createProductSchema`/
`updateProductSchema` (estoque só muda por movimentação, ADR-001). Substitui a ideia de gravar o
saldo direto no cadastro. **Sem migration.**

**Build / validação local (Claude)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/api` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| Build de produção (`next build`) | `/products` regenerada | ✅ 15 rotas, sem erros |
| Core (Vitest) — regressão | 35/35 | ✅ 35/35 |
| `stockQty` não trafega mais por schema (grep) | só reads/updates internos | ✅ |

**Deploy (Claude) — 2026-07-05**

| Passo | Resultado |
|---|---|
| `wrangler deploy` (API — `initialStock` no `POST /products`) | ✅ Version `cad0fe6e` |
| `npm run deploy` (web — campo "Estoque inicial") | ✅ Version `ef59a575` |
| Smoke: `/health` 200 · `/db-check` `{tenants:2}` · `/products` 401 · `/login` 200 | ✅ |

**E2E de navegador (usuário) — pendente**

| Teste | Resultado |
|---|---|
| Cadastrar produto com "Estoque inicial" 10 → saldo 10 + Entrada "Estoque inicial (cadastro)" no Estoque com "Registrado por" | ⏭️ usuário |
| Cadastrar produto sem estoque inicial → nasce com 0 (sem Entrada) | ⏭️ usuário |

---

## Fase 3 — Offline-first e produção

### 3.A — PWA instalável + cache de app-shell (2026-07-06)

Primeira fatia da Fase 3: tornar o `apps/web` **instalável** (adicionar à tela inicial no
celular e no desktop) e carregar rápido/estável com um **service worker** de casca. Escopo
**só front** — sem migration, sem API. A sincronização de escrita (fila IndexedDB → Supabase)
fica para fatia futura, com ADR próprio.

**O que entrou**

| Peça | Arquivo |
|---|---|
| Manifest dinâmico (`/manifest.webmanifest`) | `apps/web/app/manifest.ts` |
| Ícones (192/512 + maskable 192/512 + apple-touch 180) | `apps/web/public/icons/*` (gerados via sharp; "N" verde sobre `#111827`) |
| Metadata PWA (theme-color, apple-web-app, ícones) | `apps/web/app/layout.tsx` |
| Service worker (app-shell; só GET same-origin) | `apps/web/public/sw.js` |
| Registro do SW (gated a produção) | `apps/web/app/RegisterSW.tsx` |
| Botão "Instalar app" (`beforeinstallprompt`) | `apps/web/app/InstallPrompt.tsx` |
| Página de fallback offline | `apps/web/app/offline/page.tsx` |

> **Regra de segurança do SW num ERP/POS:** intercepta **só GET e só mesma origem**. As
> chamadas à API (`nexoloja-api.*`) e ao Supabase Auth são cross-origin e passam **direto pela
> rede** — nunca cacheadas (não serve estoque/venda/caixa velhos). Navegações = network-first.

**Build / typecheck (local, Claude)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ exit 0 |
| Build de produção (`next build`) | rotas `/manifest.webmanifest` + `/offline` geradas | ✅ 17 rotas, sem erros |

**Smoke no navegador (Claude, `npm run dev` → preview)**

| Teste | Esperado | Resultado |
|---|---|---|
| `<link rel="manifest">` no HTML (injetado 1× pelo `app/manifest.ts`) | presente, sem duplicar | ✅ `/manifest.webmanifest` |
| `GET /manifest.webmanifest` | 200 + JSON válido (name/icons/display/theme) | ✅ |
| Ícones 192 / 512 / maskable-512 / apple-touch | 200 `image/png` | ✅ 4/4 |
| Meta `theme-color` / `mobile-web-app-capable` / `apple-mobile-web-app-*` | presentes | ✅ (`theme-color=#111827`, `mobile-web-app-capable=yes`) |
| `GET /sw.js` | 200 `application/javascript` | ✅ |
| Rota `/offline` renderiza (marca + mensagem + "Tentar novamente") | ok | ✅ (screenshot) |
| Console (login + offline) | sem erros/avisos | ✅ |

> **Nota:** o registro do service worker é **gated para produção** (em dev o SW atrapalha o
> HMR/cache). Portanto o comportamento de **cache/offline em runtime** e o **prompt "Instalar"**
> (exigem contexto instalável real: HTTPS + engajamento) só se manifestam no ambiente publicado.

**Deploy (Claude) — 2026-07-06**

| Passo | Resultado |
|---|---|
| `npm run deploy` (web — OpenNext → Cloudflare) | ✅ Version `1f290a7d` (23 assets novos: `/sw.js`, ícones, chunk `/offline`) |
| Smoke prod: `GET /manifest.webmanifest` | ✅ 200 `application/manifest+json` (name/display/theme corretos) |
| Smoke prod: `GET /sw.js` | ✅ 200 `text/javascript` |
| Smoke prod: ícones 192/512/maskable-512/apple-touch | ✅ 4/4 200 |
| Smoke prod: `GET /offline` | ✅ 200 |
| Smoke prod: HTML do `/login` tem `<link rel="manifest">` + `theme-color` + apple-touch-icon | ✅ |

**E2E do usuário — 2026-07-06 (link oficial: `https://nexoloja-web.imortal.workers.dev`)**

| Teste | Resultado |
|---|---|
| **Android** (Chrome): instalar → app abre standalone com ícone/nome | ✅ usuário |
| **iPhone** (Safari): "Adicionar à Tela de Início" → abre standalone | ✅ usuário |
| **PC** (Chrome/Edge): instalar → abre em janela própria | ✅ usuário |
| Recarregar offline uma tela já visitada → casca carrega; página nova → `/offline` | ⏭️ usuário (opcional) |

> **Instalação validada nas 3 plataformas pelo usuário.** Fatia 3.A concluída.

**Comportamento de atualização do PWA (esclarecido com o usuário — 2026-07-06)**

Dúvida do usuário: "a cada ajuste na aplicação precisa reinstalar?" **Não.** Um PWA instalado é um
atalho para o app no ar, não um pacote congelado (como `.apk`/`.exe`).

| Situação | Precisa reinstalar? | Por quê |
|---|---|---|
| Correção de bug / nova tela / novo campo / lógica / API | ❌ Não — só reabrir | Navegações são *network-first*: o app busca a versão nova no próximo carregamento com internet |
| Mudança de estilo/layout | ❌ Não — só reabrir | Assets do Next têm nome com hash (build novo = arquivo novo; nunca fica preso em cache velho) |
| Atualização do próprio `sw.js` | ❌ Não | `skipWaiting` + `clients.claim` fazem a versão nova assumir sozinha (às vezes só no 2º abrir) |
| Trocar **ícone** ou **nome** do app (vêm do manifest) | ⚠️ Às vezes (sobretudo iPhone) | iOS mantém o ícone/nome antigos até remover e readicionar à tela inicial |

> Regra prática: para pegar uma atualização, **fechar e reabrir o app** (a 1ª abertura baixa em
> segundo plano; a seguinte já roda com ela). Só mudança de ícone/nome pode pedir reinstalar no iPhone.

### 3.B — Flag `OFFLINE_SALES` por loja (ADR-011, Action Item 4) — 2026-07-09

Primeira fatia da implementação do ADR-011 (fila de sync offline): o **interruptor por loja**
`OFFLINE_SALES`, que decide se o PDV enfileira venda offline (fila em si vem na próxima fatia).
Reusa a tabela **`TenantModule`** que já existe — **sem migration**. Regra do gate (§9):
**ausência da linha OU `isActive=false` = OFF** (default desligado; recurso de plano pago).
Escopo desta fatia (decidido com o usuário): **só ler o flag + aviso** no PDV — a `outbox`/worker
ficam para a fatia seguinte.

**O que entrou**

| Peça | Arquivo |
|---|---|
| Constante `MODULE_OFFLINE_SALES` + `isOfflineSalesOn()` (puro) + `setTenantModuleSchema` (Zod) | `packages/shared/src/modules.ts` |
| `GET /me` devolve `offlineSales` (query no `TenantModule` pelo índice `[tenantId, moduleKey]`) | `apps/api/src/routes/me.ts` |
| `PATCH /platform/tenants/:id/modules` (upsert + `AuditEvent SET_TENANT_MODULE`) + `offlineSales` na lista `GET /platform/tenants` | `apps/api/src/routes/platform.ts` |
| Toggle "Offline (pago)" por loja no painel do Super Usuário | `apps/web/app/plataforma/page.tsx` |
| `Me.offlineSales` no hook | `apps/web/lib/useMe.ts` |
| Aviso de conexão no PDV (só offline; texto depende do flag) | `apps/web/components/OfflineSalesNotice.tsx` + `apps/web/app/(app)/venda/page.tsx` |
| Novo `action` `SET_TENANT_MODULE` formalizado na lista fechada | `docs/adr/ADR-004-*.md` |

> **Segurança/RLS (ADR-011 §7):** o toggle é rota de plataforma (`requirePlatformAuth`); o
> `GET /me` lê o módulo do **próprio tenant** do JWT. Nenhuma porta cross-tenant nova.

**Build / typecheck / core (Claude)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `packages/shared` (`tsc --noEmit`) | sem erros | ✅ |
| Typecheck `apps/api` (`tsc --noEmit`) | sem erros | ✅ |
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ |
| Build de produção (`next build`) | 17 rotas, `/plataforma` 2.51 kB · `/venda` 5.07 kB | ✅ sem erros |
| Core (Vitest) — regressão (nada quebrou) | 35/35 | ✅ 35/35 |

**Deploy + smoke em produção (Claude) — 2026-07-09**

| Passo | Resultado |
|---|---|
| `wrangler deploy` (API — `/me` com `offlineSales` + `PATCH …/modules`) | ✅ Version `0b8c0348` |
| Smoke API: `/health` 200 · `/db-check` `{tenants:2}` · `/me` 401 · `PATCH …/modules` sem token 401 | ✅ |
| `npm run deploy` (web — toggle + aviso no PDV) | ✅ Version `bda9d6dd` |
| Smoke web: `/login` 200 · `/` 307 · `/manifest.webmanifest` 200 · `/plataforma` 200 | ✅ |

**E2E no navegador — ⏭️ usuário** (exige login de Super Usuário e estado offline real)

| Teste | Resultado |
|---|---|
| Painel `/plataforma`: coluna "Offline (pago)" mostra ON/OFF; **Ligar/Desligar** persiste (upsert `TenantModule`) + grava `SET_TENANT_MODULE` | ⏭️ usuário |
| Loja com flag OFF, PDV sem internet → aviso âmbar "nota manual" | ⏭️ usuário |
| Loja com flag ON, PDV sem internet → aviso índigo "vendas offline habilitadas" | ⏭️ usuário |
| Reativar conexão → aviso some | ⏭️ usuário |

> **3.B no ar** — shared/api/web + auditoria formalizada; sem migration; API `0b8c0348` + web
> `bda9d6dd` publicados + smoke em produção ✅. **E2E do usuário validado (2026-07-09):** os dois
> avisos (OFF âmbar / ON índigo) aparecem no PDV offline. Próxima fatia do ADR-011: **envelope de
> mutação + store `outbox`** (AI 5).

**3.B.1 — Aviso offline no caixa fechado + abrir caixa online-only (2026-07-09)**

Achado do usuário no E2E: com o **caixa fechado**, o aviso offline não aparecia (o `OfflineSalesNotice`
só estava na tela principal de venda) e o botão "Abrir caixa" tentaria abrir sem rede. Como abrir
caixa é **intencionalmente online-only** nesta fatia (ADR-011 sequenciou venda → estoque → caixa),
o ajuste é **só de UX** (sem backend, sem migration):

- Hook `useOnline` (`apps/web/lib/useOnline.ts`) extraído — estado de `navigator.onLine` reativo.
- `OfflineSalesNotice` ganhou `context='cash-open'`: texto explica que abrir caixa precisa de internet
  (ON: "a venda offline cobre quedas depois do caixa aberto"; OFF: "nota manual").
- Aviso adicionado ao galho "caixa fechado" do PDV (`/venda`) **e** à tela `/caixa`.
- Botão "Abrir caixa" **desabilitado quando offline** (rótulo "Sem conexão para abrir o caixa"),
  em vez de falhar com erro de rede.

> **Nota (cold start offline):** o flag vem do `GET /me`; se o app abrir já sem internet, `/me` falha
> e o aviso cai no padrão âmbar (nota manual) mesmo numa loja ON. Fallback seguro por ora; **persistir
> o flag em `localStorage`** entra junto com a fatia da `outbox` (AI 5).

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ |
| Build de produção (`next build`) | 17 rotas, `/venda` 5.24 kB | ✅ |
| `npm run deploy` (web) | publicado | ✅ Version `ca49b68f` |
| Smoke web: `/login` `/caixa` `/venda` | 200 | ✅ 200/200/200 |
| E2E: caixa fechado + offline → aviso + botão "Abrir caixa" desabilitado | — | ✅ usuário (2026-07-09) |

**3.B.2 — Esconder erro cru de rede offline ("Failed to fetch") (2026-07-09)**

Achado do usuário no E2E: ao desabilitar a internet, a `/caixa` mostrava **"Failed to fetch"** em
vermelho (erro cru do `GET /cash-sessions/current`) logo acima do aviso amigável — ruído redundante.
Correção: o banner de `error` só aparece **quando online** (`error && online`); offline, quem explica
é o `OfflineSalesNotice`. Aplicado na `/caixa` e no PDV (`/venda`, mesmo padrão). Sem backend.

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/web` + `next build` | sem erros, 17 rotas | ✅ |
| `npm run deploy` (web) | publicado | ✅ Version `c35f8592` |
| Smoke web: `/login` `/caixa` `/venda` | 200 | ✅ 200/200/200 |
| Offline: "Failed to fetch" some; só o aviso amigável fica | — | ⏭️ usuário |

### 3.C — Envelope de mutação + store `outbox` (IndexedDB) + flag em `localStorage` (ADR-011, AI 5) — 2026-07-10

Segunda fatia da fila de sync offline: a **infraestrutura do cliente**. Define o **formato do
envelope de mutação** (o contrato de sync), cria a store **`outbox`** no IndexedDB (FIFO por
dispositivo) e persiste o flag **`OFFLINE_SALES` em `localStorage`** para o *cold start offline*.
**Só cliente** — sem migration, sem API. O envelope **ainda não é enfileirado** por nenhuma ação:
ligar o PDV para enfileirar pareia com o **worker de sync** (Fatia 3) e o `POST /orders`
idempotente (Fatia 4); esta fatia entrega a infra **dormente e aditiva** (o caminho vivo da venda
não muda).

**O que entrou**

| Peça | Arquivo |
|---|---|
| Formato do envelope (`kind`, `entityId` UUID, `schemaVersion`, `payload`, `createdAt`) + `mutationEnvelopeSchema` (Zod) + builder puro `buildSaleMutation` + `OUTBOX_SCHEMA_VERSION=1` | `packages/shared/src/outbox.ts` (exportado no `index.ts`) |
| Store `outbox` no IndexedDB — FIFO por `seq` autoincremental, índice único `entityId` (dedup de enfileiramento), índice `status`; `enqueueMutation`/`listOutbox`/`peekPending`/`countPending`/`markSynced`/`markError`/`markConflict`/`removeMutation` + guarda `hasOutbox()` (SSR) | `apps/web/lib/outbox.ts` |
| Cache do flag em `localStorage` (`cacheOfflineSales`/`readCachedOfflineSales`) | `apps/web/lib/offlineFlag.ts` |
| `useMe` grava o flag a cada `/me` OK e expõe `offlineSales` efetivo (com fallback do cache no cold start offline) | `apps/web/lib/useMe.ts` |
| `/venda` e `/caixa` usam o `offlineSales` efetivo do `useMe` (em vez de `me?.offlineSales`) | `apps/web/app/(app)/{venda,caixa}/page.tsx` |

> **Idempotência (ADR-011 §2):** a chave é o `entityId` = PK UUID gerada no cliente; o payload da
> venda carrega o mesmo `id`. O servidor deduplica pela PK na Fatia 4. O índice único `entityId` da
> `outbox` cobre a idempotência de **enfileiramento** no cliente (clique duplo/reabrir a tela).
> **RLS/segurança:** nada novo — `tenantId`/`userId` continuam vindo do JWT no sync (ADR-011 §7).

**Build / typecheck / core (Claude)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `packages/shared` (`tsc --noEmit`) | sem erros | ✅ |
| Typecheck `apps/api` (`tsc --noEmit`, após `prisma generate`) | sem erros | ✅ |
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ |
| Build de produção (`next build`) | 17 rotas, `/venda` 5.34 kB · `/caixa` 2.57 kB | ✅ sem erros |
| Core (Vitest) — regressão (nada quebrou) | 35/35 | ✅ 35/35 |

**Deploy / E2E**

| Passo | Resultado |
|---|---|
| Deploy | ⏭️ opcional nesta fatia — infra **dormente** (nada user-observable ainda); pode ir junto com o worker (Fatia 3) |
| E2E do usuário | ⏭️ n/a nesta fatia — sem ação de UI que exercite a `outbox`; a validação vem quando o PDV enfileirar (Fatia 3) |

> **3.C: infra da fila pronta** — envelope (contrato compartilhado) + store `outbox` + flag em
> `localStorage`. Typecheck (shared/api/web) + build (17 rotas) + core 35/35 ✅. Próxima fatia do
> ADR-011: **worker de sincronização** (AI 6) — drena a `outbox` quando há rede e liga o PDV para
> enfileirar venda offline.

### 3.D — Round-trip da venda offline: worker + `POST /orders` idempotente + máquina de estados (ADR-011 AI 6–9) — 2026-07-10

Fecha o **ciclo completo da venda offline**: o PDV enfileira sem rede, o worker drena quando a
conexão volta e o servidor aplica de forma **idempotente por PK** (dedup do reenvio). Cobre as
Fatias 3 (worker), 4 (POST idempotente), 5 (máquina de estados pura + testes) e o essencial da 6
(indicador de pendentes). **Sem migration** (ver AI 10 abaixo). No ar; **E2E do usuário pendente**.

**O que entrou**

| Peça | Arquivo |
|---|---|
| Máquina de estados PURA da fila (`classifyHttpOutcome` — **409 = dedup = SYNCED**; `classifyNetworkError`; `shouldRetry`/`MAX_SYNC_ATTEMPTS`; `syncBackoffMs` exp. c/ teto 30s; `haltsQueue`) + **12 testes Vitest** | `packages/core/src/index.ts` (+ `index.test.ts`) |
| `createSaleSchema` ganhou `id`/`cashSessionId` **opcionais** (online omite; offline envia); `saleMutationPayloadSchema` os torna obrigatórios; `buildSaleMutation(id, cashSessionId, sale)` | `packages/shared/src/{sale,outbox}.ts` |
| `POST /orders` **idempotente por PK** (ADR-011 §2–3/6): `id` presente ⇒ venda offline → dedup por `orders.id` (no-op devolve a persistida), caixa vem do envelope (validado tenant+user), **estoque insuficiente não bloqueia** (registra e deixa negativo p/ reconciliação); online segue igual (gera PK, bloqueia sem estoque). Corrida de PK → trata como dedup | `apps/api/src/routes/orders.ts` |
| Worker de sync (drena FIFO, **para na 1ª falha**, retry só transitório; delega decisão ao core) + helper `apiPostForSync` (status bruto) | `apps/web/lib/syncWorker.ts` · `apps/web/lib/api.ts` |
| Estado `FAILED` terminal + `markFailed` na `outbox` | `apps/web/lib/outbox.ts` |
| Hook `useOutboxSync` (gatilhos: `online`, foreground, montagem, botão manual; contador de pendentes) | `apps/web/lib/useOutboxSync.ts` |
| PDV: `onConfirmar` enfileira quando **offline + recurso ON** (UUID no cliente, baixa otimista no cache local, tela "Salva offline — pendente"); online igual; indicador "X vendas pendentes" + "Sincronizar agora" | `apps/web/app/(app)/venda/page.tsx` |

> **Idempotência (ADR-011 §2):** a chave é a PK UUID gerada no cliente; reenvio pós-crash é no-op
> (200 `deduped`). **§6:** venda offline que não "cabe" no estoque ao sincronizar é **registrada**
> (saldo negativo → reconciliação da ADR-001), não rejeitada. **§7/RLS:** `tenantId`/`userId`/autoria
> vêm do JWT; o `cashSessionId` do envelope é validado contra tenant+user. **Online intacto:** sem
> `id` no payload, o caminho é byte-a-byte o de antes (bloqueio de estoque mantido).

**Build / typecheck / core (Claude)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `packages/shared` + `apps/api` (após `prisma generate`) + `apps/web` | sem erros | ✅ |
| Build de produção (`next build`) | 17 rotas, `/venda` 6.91 kB | ✅ sem erros |
| Core (Vitest) — 12 testes novos da fila + regressão | 47/47 | ✅ 47/47 |

**Deploy + smoke em produção (Claude) — 2026-07-10**

| Passo | Resultado |
|---|---|
| `npm run deploy` (API — `POST /orders` idempotente) | ✅ Version `897d5524` |
| `npm run deploy` (web — worker + PDV enfileira + indicador) | ✅ Version `afb6bd71` |
| Smoke API: `/health` 200 · `/db-check` `{tenants:2}` · `POST /orders` sem token 401 (sem regressão) | ✅ |
| Smoke web: `/login` 200 · `/` 307 · `/venda` 200 · `/manifest.webmanifest` 200 | ✅ |
| Smoke navegador (dev): `/login` sem erros de console (novos módulos carregam) | ✅ |

**AI 10 — migration?** Avaliado: **nenhuma migration necessária** neste corte. A idempotência usa a
**PK existente** (`orders.id`, já única, `@default(uuid)`) — o dedup é um `findUnique` na transação,
sem constraint nova; e o estoque negativo é permitido pelo tipo atual (sem CHECK). Um índice de
reforço só entraria se surgisse contenção real → aí vira migration própria com aprovação (regra 1).

**E2E no navegador (Claude + usuário, produção, 2026-07-10)** — loja-demo com flag **ON**, caixa
aberto, offline simulado via console (`navigator.onLine=false` + eventos `offline`/`online` — mesmo
código do `useOnline`/worker, sem derrubar a rede real).

| Teste | Resultado |
|---|---|
| Loja **ON**, offline → aviso índigo "vendas offline habilitadas" | ✅ |
| Confirmar offline (2× Cimento) → **enfileira** (não vai à rede) + tela "Salva offline — pendente" | ✅ (`outbox` seq 1 PENDING; envelope com `kind`/`entityId`/`cashSessionId`/itens corretos) |
| Voltar **online** → worker drena → item `SYNCED` | ✅ (0 tentativas, sem erro) |
| Servidor aplica: pedido com a **mesma PK** (`#981d99d6`), autoria "owner", estoque **258→256** | ✅ (Histórico + estoque recarregado do servidor) |
| **Reenvio/idempotência**: remarcar PENDING + drenar de novo → **dedup por PK** | ✅ 1 pedido no Histórico, estoque **continua 256** (sem duplicar/re-baixar) |
| Indicador "1 venda pendente" após enfileirar (2ª venda, Tijolo) | ✅ (após o fix 3.D.1) |
| Voltar online → indicador **zera** + aviso some | ✅ (`outbox` seq 1/2 `SYNCED`) |
| Loja **OFF** offline → aviso **âmbar** "nota manual"; Confirmar mostra "Use nota manual." e **não enfileira** (fila inalterada) | ✅ (2026-07-10; flag desligado no painel do Super Usuário e religado ao fim) |

**3.D.1 — Dois achados do E2E, corrigidos e republicados (web `c74bbc5f`)**

| Achado | Correção |
|---|---|
| Indicador "X pendentes" não atualizava após enfileirar (contador do React só recarregava ao remontar/sincronizar; dado na fila estava certo) | `venda/page.tsx`: `void refreshPending()` após o `enqueueMutation` |
| Texto do aviso ON ainda dizia "aguarde a conexão voltar para registrar" (copy da Fatia 1, antes de o PDV enfileirar) | `OfflineSalesNotice`: "Pode concluir a venda normalmente — ela é salva neste aparelho e sincroniza sozinha quando a conexão voltar." |

> **3.D validada ✅** — ciclo completo da venda offline (enfileirar → drenar → aplicar idempotente)
> confirmado em produção, incluindo **idempotência** (reenvio não duplica) e o servidor como único a
> debitar estoque no sync (§3). API `897d5524` + web `c74bbc5f`; sem migration; core 47/47. Refinos
> possíveis (fatia futura): drenagem global (fora do PDV), tela de itens `FAILED`, poda de itens
> `SYNCED` da fila, e estoque/caixa offline (as próximas naturezas de mutação).

### 3.E — Refinos da fila offline: drenagem global + poda de SYNCED + tela de pendências (2026-07-10)

Polimento das pontas soltas da venda offline (3.D). **Só cliente** — sem migration, sem API. Três
refinos coesos; o 4º (cold-start offline com `sessionId` persistido) ficou **de fora** de propósito
por ser maior que um refino (exige também **catálogo de produtos em cache** e semântica de caixa
possivelmente fechado no servidor) — vira fatia própria.

**O que entrou**

| Refino | Peça | Arquivo |
|---|---|---|
| **Drenagem global** — o worker antes só rodava montado no `/venda`; agora drena em qualquer tela | Provider único no shell + chip de status no topo (aparece só com fila não-vazia; vermelho=falha, índigo=pendente) | `apps/web/lib/outboxSync.tsx` · `apps/web/app/(app)/QueueChip.tsx` · `apps/web/app/(app)/layout.tsx` |
| **Poda de `SYNCED`** — a fila não cresce sem limite | `pruneSynced()` chamado no `finally` do dreno (best-effort) | `apps/web/lib/outbox.ts` · `apps/web/lib/syncWorker.ts` |
| **Tela de `FAILED`** — itens com falha dura somem do contador; agora têm onde aparecer | Página `/pendencias` (lista a fila; ações **Tentar novamente** = `requeue`, **Descartar** = `removeMutation`) | `apps/web/app/(app)/pendencias/page.tsx` |
| **Sincronia dos indicadores** | Pub/sub na `outbox` (`subscribeOutbox`/`notifyOutbox`) — enfileirar/sincronizar/podar/descartar reatualiza chip, PDV e tela de pendências sem polling | `apps/web/lib/outbox.ts` · `apps/web/lib/useOutboxSync.ts` |

> **Instância única (drenagem global):** o `useOutboxSync` passou a ser montado **uma vez** no
> `OutboxSyncProvider` do shell `(app)`; o PDV (`/venda`) agora lê pelo `useOutboxSyncContext` em vez
> de instanciar o hook, evitando listeners/drenos duplicados. Com o pub/sub, o `void refreshPending()`
> manual após enfileirar (fix 3.D.1) ficou redundante e foi removido.

**Build / typecheck / core (Claude)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ |
| Build de produção (`next build`) | **18 rotas** (nova `/pendencias` 2.08 kB); `/venda` 5.63 kB | ✅ sem erros |
| Core (Vitest) — regressão (nada tocado no core) | 47/47 | ✅ 47/47 |

**Deploy / E2E**

| Passo | Resultado |
|---|---|
| `npm run deploy` (web — provider global + chip + `/pendencias` + poda) | ✅ Version `3921af94` |
| `npm run deploy` (web — `error.tsx` da área logada, ver 3.E.1) | ✅ Version `300254fc` |
| Smoke prod: `/login` 200 · `/` 307 · `/venda` 200 · **`/pendencias` 200** · `/manifest.webmanifest` 200 | ✅ |
| E2E no navegador (PWA instalado no macOS) | ✅ **validado pelo usuário (2026-07-11)** — offline → **Confirmar** → **chip "1 pendente" no topo**; voltar online (sem sair do `/venda`) → **worker drena** (sincronização vista) → vendas registradas (`#2f0d11b0`, `#7bfa4d01`). Chip global e drenagem OK. *(Achado colateral 3.E.1 na 1ª tentativa: navegação offline entre telas — ver abaixo.)* |

> **3.E: refinos no ar** — drenagem global (chip no topo + worker no shell), poda de `SYNCED` e
> tela `/pendencias` (retry/descarte). Pub/sub mantém os indicadores em sincronia. Typecheck + build
> (18 rotas) + core 47/47 ✅. Web publicado + smoke em produção ✅. **Fora deste corte:** cold-start
> offline (persistir `sessionId` + cachear catálogo) — fatia própria.

**3.E.1 — Achado do E2E: navegação offline entre telas quebra o app (2026-07-11)**

No E2E, ao **navegar offline** do PDV para outra tela (Estoque → Relatórios), o app deu **tela branca**
("Application error: a client-side exception"). Causa: o service worker da Fatia 3.A cacheia só a
**casca** e os assets **já abertos com internet**; abrir offline uma tela cujo **chunk JS ainda não
foi baixado** (agravado logo após o deploy — todo chunk ganha hash novo) faz o import dinâmico falhar
→ React lança sem fronteira → root error boundary (tela branca). **Não é do refino** — é a lacuna de
**offline-first de leitura**, já marcada como fatia própria (navegação offline entre telas ainda não
é suportada; a **fila de vendas offline segue intacta**).

Mitigação aplicada (não é a solução completa): `apps/web/app/(app)/error.tsx` — fronteira de erro de
segmento que fica **dentro** do `layout` do grupo `(app)`, então a **barra do topo (e o chip)
permanece** e só a área da página mostra um aviso amigável ("Esta tela precisa de internet para
abrir…") em vez da tela branca. Web Version `300254fc`. A navegação offline propriamente dita
(cachear rotas/RSC) continua na fatia futura de offline-first de leitura.

**3.E.2 — Observação do usuário: "caixa fechado" ao navegar offline (2026-07-11)**

Depois do E2E, o usuário desabilitou a rede e navegou entre telas **já cacheadas** (não deu mais tela
branca, porque os chunks foram baixados no teste anterior). Sintomas: a tela **Venda** dizia "caixa
fechado" e a **Caixa** informava (corretamente) que abrir caixa precisa de internet; ao **voltar
online, o caixa reaparecia aberto** (nunca foi fechado). **Comportamento esperado nesta fase, não é
bug:** offline o `GET /cash-sessions/current` e o `GET /products` falham (a API é cross-origin, nunca
cacheada, ADR-011 §7), então o PDV, ao **remontar** offline, não consegue confirmar o caixa aberto
nem carregar o catálogo → assume "caixa fechado". A venda offline de 3.D funciona porque o `sessionId`
e os produtos ficam **em memória** enquanto você não sai do `/venda`; ao navegar/remontar offline,
essa memória se perde. A verdade do caixa está no servidor (por isso volta certo online). É
**exatamente a fatia de cold-start / offline-first de leitura** (adiada): persistir o `sessionId` do
caixa **+ cachear o catálogo de produtos** para o PDV seguir vendável offline mesmo após
navegar/reabrir. Sem isso, o offline cobre só a "queda durante a venda" (cenário de 3.D), não a
operação offline prolongada.

> **Nota de ambiente:** os testes foram feitos no **PWA instalado no macOS** — mesma engine do
> Chrome, comportamento idêntico ao navegador. Para depurar é mais fácil numa **aba normal do Chrome**
> (DevTools → Network → Offline + Console prontos); no app instalado, o DevTools abre por
> botão-direito → *Inspecionar elemento* (ou ⋥ menu → *Mais ferramentas → Ferramentas do
> desenvolvedor*).

### 3.F — Cold-start / offline-first de leitura — PLANEJADO (estratégia, a executar em outra sessão)

Fatia própria que fecha a lacuna dos achados 3.E.1/3.E.2: manter o PDV **vendável offline** após
navegar/remontar/reabrir. **Tudo no cliente** (IndexedDB/localStorage/SW cache) — **sem migration de
servidor, sem impacto nos free tiers** (Cloudflare/Supabase): o cache vive no aparelho e a venda
sincronizada gera a **mesma** linha `Order` de sempre. Estratégia completa (sub-fatias CS-0…CS-4,
decisões a travar) no ROADMAP, Fase 3. **Passo 0 = ADR-012 escrito e ACEITO (2026-07-11)** — 5
decisões (a)–(e) aprovadas pelo Owner (regra 4 cumprida). Roteiro de validação previsto por
sub-fatia:

| Sub-fatia | O que validar (E2E, offline) | Status |
|---|---|---|
| **CS-1 — cache do caixa aberto** | Abrir caixa online → ficar offline → **navegar/remontar** `/venda` → PDV reconhece o caixa aberto (não diz "caixa fechado") e mantém o `sessionId` p/ enfileirar | 🟡 código pronto; E2E do usuário ⏭️ (ver 3.F.CS-1) |
| **CS-2 — cache do catálogo** | Offline após remontar → `/venda` **lista os produtos** (do cache) → montar carrinho → **Confirmar** enfileira normalmente; estoque exibido = último conhecido + baixas otimistas | 🟡 código pronto; E2E do usuário ⏭️ (ver 3.F.CS-2) |
| **CS-3 — navegação offline** | Offline, **trocar entre telas** sem tela branca — as telas abrem do cache via **navegação por reload** | ✅ **validada pelo usuário (2026-07-11)** — ver 3.F.CS-3 (+ achados .1/.2/.3) |
| **CS-4 — caixa fechado no sync** | Enfileirar offline → caixa **fechado no servidor** → voltar online → **anexa c/ marca de reconciliação** (`SALE_ON_CLOSED_CASH`); Relatórios mostra "N após fechamento" na linha do caixa | ✅ **validada pelo usuário (2026-07-11/12)** — ver 3.F.CS-4 |
| **CS-5 — esperado ajustado** | Caixa com venda tardia em dinheiro → Relatórios mostra "ajust. R$…" sob Esperado (= esperado + dinheiro tardio) e Divergência recalculada | 🟡 código pronto; deploy + E2E do usuário ⏭️ (ver 3.F.CS-5) |
| Regressão | Online intacto; venda offline "queda durante a venda" (3.D) segue funcionando; poda/drenagem (3.E) sem regressão; core Vitest | ✅ CS-1…CS-5 sem regressão (build 18 rotas + core 51/51) |

> **Marco de valor:** CS-1 + CS-2 já entregam "operar offline após remontar/reabrir" (ficando no
> `/venda`). CS-3 adiciona navegação offline entre telas. CS-4 endurece a borda do caixa fechado.

### 3.F.CS-1 — Cache do caixa aberto — CÓDIGO PRONTO (2026-07-11)

Implementa a decisão (a) e a base da (e) do **ADR-012**: persistir a **identidade do caixa aberto**
em `localStorage` para o PDV/Caixa seguirem cientes do turno **offline após remontar/reabrir**
(achado 3.E.2). **Só cliente** — sem migration, sem API, sem tocar `packages/core`/`shared`.

**O que entrou**

| Peça | Papel | Arquivo |
|---|---|---|
| `cacheCashSession` / `readCachedCashSession` / `clearCachedCashSession` | Cache `localStorage` do caixa aberto (`id`/`openedAt`/`openingAmount`/`openedByName` + `cachedAt`); espelha o padrão de `offlineFlag.ts` | `apps/web/lib/cashSessionCache.ts` (novo) |
| `/venda` — leitura do caixa | Online: `GET current` OK **sobrescreve/limpa** o cache (rede vence, (a)). Offline (catch): recupera o cache → PDV reconhece caixa aberto + mantém `sessionId` p/ enfileirar; rótulo **"dados de HH:MM"** | `apps/web/app/(app)/venda/page.tsx` |
| `/caixa` — leitura do caixa | Online: idem cache/limpeza. Offline: card enxuto **"Caixa aberto"** (identidade + rótulo do horário) em vez de oferecer **"Abrir caixa"** (que é online-only e estaria errado) | `apps/web/app/(app)/caixa/page.tsx` |

> **Regra (a) — rede sempre vence:** o cache é subproduto da leitura normal; toda resposta OK
> sobrescreve (ou limpa, se vier `null`/fechado). O cache só é **servido offline**, sempre rotulado
> com o horário do snapshot. Fechar/abrir caixa seguem **online-only** (decisão (e)) — offline não há
> formulário, só o aviso de que a operação volta com a conexão.

**Escopo incremental (esperado):** CS-1 recupera o **caixa**; o **catálogo** de produtos ainda **não**
é cacheado (é a CS-2). Logo, offline após remontar o PDV reconhece o caixa aberto mas o seletor de
produtos fica vazio até a CS-2 — **CS-1 + CS-2 juntas** fecham "vender offline após remontar". A venda
offline "queda durante a venda" (3.D, sem sair do `/venda`) segue intacta.

**Build / typecheck / core (Claude)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ |
| Build de produção (`next build`) | 18 rotas (sem rota nova); `/venda` 6 kB, `/caixa` 2.97 kB | ✅ sem erros |
| Core (Vitest) — não tocado (mudança só de cliente) | 47/47 (inalterado) | ✅ (sem alteração em `core`/`shared`) |

**Deploy / E2E**

| Passo | Resultado |
|---|---|
| `npm run deploy` (web) | ⏭️ pendente |
| E2E no navegador (usuário) — abrir caixa online → **offline** → **remontar/reabrir** `/venda` → PDV diz **"Caixa aberto"** (não "fechado") + rótulo "dados de HH:MM" + mantém `sessionId`; `/caixa` mostra card enxuto (sem "Abrir caixa"); voltar online → dado fresco sobrescreve o cache | ⏭️ pendente (offline + autenticado → fica com o usuário, como 3.D/3.E) |

> **Próximo:** CS-2 (cache do catálogo no IndexedDB — store `catalog`, bump `DB_VERSION`→2) fecha
> "vender offline após remontar". Depois CS-3 (navegação offline, com *spike*) e CS-4 (borda do caixa
> fechado no sync).

### 3.F.CS-2 — Cache do catálogo de produtos — CÓDIGO PRONTO (2026-07-11)

Fecha, com a CS-1, "operar offline após remontar/reabrir": persistir o **catálogo** de produtos para
o PDV montar o carrinho sem rede (achado 3.E.2). Implementa as decisões (a)/(d) do **ADR-012**. **Só
cliente** — sem migration de servidor, sem API, sem tocar `packages/core`/`shared`.

**O que entrou**

| Peça | Papel | Arquivo |
|---|---|---|
| Abridor compartilhado do IndexedDB `nexoloja` | Dono da versão + cria todos os stores num único `onupgradeneeded`; **`DB_VERSION`→2** adiciona o store `catalog` (upgrade v1→v2 preserva a `outbox`) | `apps/web/lib/db.ts` (novo) |
| `cacheProducts` / `readCachedProducts` | Espelho do catálogo (`clear`+regrava a cada `GET /products` OK; leitura offline) | `apps/web/lib/catalog.ts` (novo) |
| `outbox.ts` refatorado | Passa a usar o `openDb`/`reqAsPromise` do `db.ts`; `hasOutbox` vira alias de `hasIndexedDb` (imports existentes intactos) | `apps/web/lib/outbox.ts` |
| `/venda` — catálogo | Online: `loadProducts` **cacheia** a lista lida (rede vence). Offline (cold-start): carrega o catálogo do cache. Baixa otimista offline faz **write-through** no cache (estoque exibido após remontar = último conhecido − vendas offline) | `apps/web/app/(app)/venda/page.tsx` |

> **Um banco, uma versão:** o IndexedDB tem versão única por banco; por isso a abertura/migração foi
> centralizada em `db.ts` — dois módulos abrindo o mesmo banco com versões divergentes seria rejeitado
> pelo IndexedDB. O upgrade v1→v2 é aditivo (cria só o `catalog`), **sem perder a fila `outbox`** de
> quem já tinha o app instalado.

**Build / typecheck / core (Claude)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ |
| Build de produção (`next build`) | 18 rotas; `/venda` 6.16 kB | ✅ sem erros |
| Core (Vitest) — não tocado | 47/47 (inalterado) | ✅ (sem alteração em `core`/`shared`) |
| Regressão da fila offline (refactor do `outbox.ts`) | imports `hasOutbox`/worker/pendências intactos | ✅ (typecheck + build cobrem; E2E da fila no usuário) |

**Deploy / E2E**

| Passo | Resultado |
|---|---|
| `npm run deploy` (web) | ⏭️ pendente (deploy único cobrindo CS-1 + CS-2) |
| E2E no navegador (usuário) — abrir caixa + carregar produtos online → **offline** → **remontar/reabrir** `/venda` → **lista os produtos do cache** + caixa reconhecido → montar carrinho → **Confirmar** enfileira (estoque cai localmente) → remontar offline de novo → estoque reflete a baixa; voltar online → catálogo fresco sobrescreve o cache | ⏭️ pendente (offline + autenticado → fica com o usuário, como 3.D/3.E) |

> **Marco:** CS-1 + CS-2 entregam o PDV **vendável offline após remontar/reabrir** (ficando no
> `/venda`). Falta a navegação offline **entre telas** (CS-3, com *spike* — hoje paliada pelo
> `error.tsx`) e a borda do caixa fechado no sync (CS-4).

**E2E do usuário — CS-1 + CS-2 no ar (2026-07-11):** deploy web Version `b55d670f` + smoke (`/login`,
`/venda`, `/caixa`, `/manifest.webmanifest` = 200). **7/7 do roteiro passaram** (abrir caixa online →
offline → **remontar/reabrir** `/venda` → caixa reconhecido ("dados de HH:MM") + **produtos do
cache** → vender offline (estoque cai) → remontar reflete a baixa → online sobrescreve o cache →
`/caixa` offline mostra card enxuto sem "Abrir caixa"). **CS-1 + CS-2 validadas em produção.**

**3.F.CS-2.1 — Achado do E2E: "Failed to fetch" nas telas online-only offline (2026-07-11)**

Ainda offline, o usuário abriu **Produtos** e viu o erro cru **"Failed to fetch"** + "Nenhum produto
cadastrado" (some da base). Pela decisão (c) do ADR-012 essas telas são **online-only**, mas o previsto
é **mostrar o aviso de rede, não a tela vazia/erro técnico** — a implementação disso ficou faltando.
**Correção:** novo componente `apps/web/components/OfflineNotice.tsx` (banner âmbar "Sem conexão…",
só offline) aplicado às 5 telas online-only — **Produtos, Estoque, Clientes, Relatórios, Histórico de
Vendas** — e o erro cru passou a aparecer **só quando online** (`{error && online && …}`, mesmo padrão
já usado em PDV/Caixa). No Histórico, o aviso "Caixa fechado" também foi gated a `online` (offline o
`openSessionId` não carrega e daria falso "fechado"). Typecheck + build (18 rotas) ✅. **No ar:** web
Version `a4cebe57`. *E2E do aviso: com o usuário no próximo teste offline.*

> **E2E do usuário (2026-07-11):** o banner amigável apareceu offline em Produtos/Estoque/Clientes/
> Relatórios/Histórico ✅. **Complemento (web `c1679c08`):** faltou a tela **Configurações** — offline
> ela mostrava **"Acesso restrito a administradores"** (enganoso: o `GET /me` falha → `isAdmin` cai
> para `false` para qualquer um, o papel não pode ser confirmado sem rede). Ajuste: no ramo `!isAdmin`,
> **offline** exibe o `OfflineNotice`; **online** mantém o gate de RBAC real (ADR-008). Typecheck +
> build ✅; no ar `c1679c08`.

**3.F.CS-2.2 — Achado do E2E: navegar offline entre telas → crash raiz (2026-07-11)**

Offline, ao **trocar de tela** (ex.: Configurações → outra), o app travou e caiu no **erro cru do
Next** ("Application error… while loading nexoloja-web…"), **sem a casca**. Causa: a navegação via
`<Link>` falha ao baixar o **chunk JS** (hash novo a cada deploy; só em cache se a tela foi aberta
online antes) e/ou o **payload RSC** (`?_rsc=`, que o SW nem intercepta) — o erro é do **roteador**,
**acima** do grupo `(app)`, então o `(app)/error.tsx` **não** o pega e, sem fronteira na raiz, vira o
fallback cru. **É o CS-3** (navegação offline entre telas — exige *spike* do SW: precache de
rotas/RSC ou navegação-por-reload), ainda em aberto.

**Mitigação (não é o CS-3):** novo `apps/web/app/global-error.tsx` — fronteira de erro **da raiz**
(substitui o layout raiz; estilos inline; sem `globals.css`). Offline mostra "Sem conexão para abrir
esta tela" + **Ir para a Venda** (navegação real → o SW atende do cache o shell/`/offline`, tirando
do beco-sem-saída) e **Tentar novamente**. Typecheck + build ✅; no ar `51faac08`. A navegação offline
**de verdade** entre telas segue para a fatia CS-3.

> ✅ **E2E do usuário (2026-07-11) — avisos offline validados em TODAS as telas online-only** (Produtos,
> Estoque, Clientes, Relatórios, Histórico e **Configurações**): o banner amigável aparece no lugar do
> erro cru. Com isso, **CS-1 + CS-2 + refino de avisos (3.F.CS-2.1) fechados e validados**. Fica aberto
> só o **CS-3** (navegação offline entre telas) — o `global-error.tsx` cobre o caso com uma saída, mas
> a navegação em si é a próxima fatia.
>
> ✅ **Confirmação extra (2026-07-11):** reabrir o app, **desativar a rede** e acessar uma tela **já
> cacheada** (Configurações) **não quebra mais** — a casca permanece e aparece o `OfflineNotice`
> (caminho feliz: chunk em cache + dados da API indisponíveis). Isso valida o **aviso**, não o
> `global-error` — este só dispara quando o **chunk/RSC da tela destino não está em cache** (o crash de
> 3.F.CS-2.2), difícil de reproduzir depois de já ter circulado pelas telas. **`global-error.tsx` fica
> como safety-net no ar, porém não-exercitado em E2E** — o caminho real é o CS-3.

> ⚠️ **Protocolo de teste após deploy:** todo deploy troca o hash dos chunks. Abra o app **online uma
> vez** e visite as telas que vai testar (para o SW cachear os chunks novos) **antes** de simular
> offline — senão a navegação offline bate em chunk não-cacheado (o global-error acima agora cobre
> esse caso com saída, mas a navegação só funciona de fato com o CS-3).

### 3.F.CS-3 — Navegação offline entre telas (por reload) — CÓDIGO PRONTO (2026-07-11)

Fecha o achado **3.F.CS-2.2** (navegar offline entre telas → crash raiz). Fatia de *spike* prevista no
ADR-012 (decisão (c)) — **cliente puro, sem migration/API**.

**Diagnóstico do spike.** A navegação **client-side** do Next (App Router) via `<Link>` busca o
**payload RSC** da rota destino (`GET /rota?_rsc=...`) pela rede; o SW não intercepta esse pedido e,
offline, ele falha → o roteador lança → fallback cru. Já a **navegação real** (full load) embute o RSC
inicial no próprio HTML (`self.__next_f`), **sem** o fetch `?_rsc=` — e o SW sabe servir o documento
(navigate network-first) + os chunks (`/_next/static/`, SWR) do cache. Logo, a correção é a
**navegação por reload** offline (o fallback que o ADR-012 pré-aprovou), equivalente a "reabrir o app
offline" (caminho já validado em CS-1/CS-2).

**Implementação (só front).**
- `apps/web/app/(app)/OfflineNav.tsx` — componente sem render montado no shell `(app)`. Instala um
  interceptor de clique em **fase de captura**: **offline**, se o clique resolve para um `<a>` interno
  (mesma origem, sem modificador/`target=_blank`/`download`), faz `preventDefault` + `stopPropagation`
  + `window.location.assign(href)` — **full-load** em vez de client-nav. **Online: no-op** (client-nav
  rápida do Next preservada). Cobre o menu lateral, o chip → `/pendencias` e os botões dos error
  boundaries (que já eram navegação real).
- `apps/web/public/sw.js` — **reescrito (v3)** para aquecer os chunks de verdade (ver 3.F.CS-3.1 para o
  porquê): **dois caches** — `SHELL` versionado (documentos + ícones/manifest) e `STATIC` **não-versionado**
  (`/_next/static/*`, imutáveis por hash → **sobrevivem a deploys**, cache-first). `warmRoutes()` busca o
  HTML de cada rota offline-capable, cacheia o **documento** (SHELL) e **extrai as URLs `/_next/static/`
  do próprio HTML** (onde o chunk da página aparece como `<script>`) cacheando-as (STATIC). Disparado no
  `install` (online) e por mensagem `WARM_ROUTES` do cliente. O `activate` limpa só caches de casca
  antigos (preserva o STATIC).
- **Aquecimento no cliente:** efeito no shell `(app)` manda `WARM_ROUTES` ao SW **quando online** e
  **re-aquece ao reconectar** (todo deploy troca o hash dos chunks). Inclui `/pendencias`, que **não está
  no menu** (o chip só aparece com fila offline → seu chunk nunca seria aquecido por navegação normal). O
  `router.prefetch` foi mantido só para acelerar a client-nav online (aquece o RSC, **não** o JS — por
  isso não bastava; ver 3.F.CS-3.1).
- Cópia de `(app)/error.tsx` e `global-error.tsx` atualizada: pós-CS-3 a navegação offline funciona
  para telas já abertas online; os boundaries viram **rede de segurança** para o caso residual (rota
  cujo chunk/RSC nunca foi cacheado).

**Build / typecheck / core (local)**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ |
| Build de produção (`next build`) | 18 rotas | ✅ sem erros |
| Core (Vitest) — não tocado | 47/47 | ✅ (regressão) |

**Deploy + smoke (produção) — 2026-07-11**

| Teste | Esperado | Resultado |
|---|---|---|
| `npm run deploy` (web) — 1º | publicado | ✅ Version `6b4f8ad9` (1ª tentativa caiu em `fetch failed` transitório; retry OK) |
| `GET /sw.js` traz `VERSION` v2 + precache `/venda`,`/caixa`,`/pendencias` | atualizado | ✅ |
| `GET /login` / `GET /venda` | 200 | ✅ 200 / 200 |
| `npm run deploy` (web) — 2º (`router.prefetch` p/ `/pendencias`) | publicado | ✅ Version `6f65a81b` (insuficiente; ver 3.F.CS-3.1) |
| `npm run deploy` (web) — 3º (SW v3: aquecimento real de chunks) | publicado | ✅ Version `b4fa95f7` |
| `GET /sw.js` traz `VERSION` v3 + `warmRoutes`/`WARM_ROUTES`/`nexoloja-static` | atualizado | ✅ |
| `/pendencias` HTML expõe os chunks `/_next/static/` que o warm extrai | ≥ 1 | ✅ 18 refs (CSS + JS, incl. chunk da página) |
| `npm run deploy` (web) — 4º (warm de TODAS as telas do menu; ver 3.F.CS-3.2) | publicado | ✅ Version `4d47eacc` |
| `GET /sw.js` traz `WARM_ROUTES` com as 9 telas do menu | atualizado | ✅ |

**E2E do usuário (offline, no PWA) — ⏭️ pendente (2ª rodada, sobre v3).** O SW/offline é produção-only e
o `OfflineNav` só monta no shell logado (exige login do usuário). Protocolo (simplificado após a
correção do aquecimento): abrir o app **online** e aguardar ~2s no shell logado (o efeito pré-carrega
Venda/Caixa/**Pendências** sozinho — não precisa visitar cada tela) → **desativar a rede** → navegar
entre elas pelo menu **e pelo chip → Pendências** (após uma venda offline). **Esperado:** as telas
trocam por reload, sem tela branca e sem cair no `global-error`; o caixa/catálogo seguem do cache
(CS-1/CS-2) e a venda offline enfileira normalmente.

**3.F.CS-3.1 — Achado do 1º E2E: navegação por reload caía no `global-error` (2026-07-11)**

No 1º E2E (v2/`6f65a81b`), offline: ao trocar de tela apareceu o `global-error` ("Sem conexão para
abrir esta tela"), e **"Ir para a Venda" voltava para a mesma tela** em vez de abrir o PDV. **Causa
raiz (duas somadas):** (1) `router.prefetch` **não aquece o JS** da rota — só o payload RSC (que o SW
nem cacheia); como `/pendencias` nunca é aberta online, seu chunk ficava fora do cache. (2) O bump do
`VERSION` do SW **apagava o cache de chunks já aquecidos** (o `activate` limpava tudo e recriava só com
os documentos do PRECACHE, sem os `.js`) — então, logo após o deploy e antes de reabrir tudo online,
**até o `/venda` ficava sem chunk**, e a navegação real para ele caía de novo no `global-error` (o
documento carregava, mas o chunk da página faltava). **Correção (SW v3, Version `b4fa95f7`):**
`warmRoutes()` busca o HTML de cada rota offline-capable e cacheia **documento + todos os chunks
`/_next/static/` extraídos do HTML** (aquecimento real, incl. `/pendencias`); os chunks vão para um
cache **não-versionado** (`STATIC`, cache-first) que **sobrevive a deploys**; o `activate` só limpa
casca antiga. Disparo no `install` (online) e por `WARM_ROUTES` (load online + reconexão). Smoke:
`/pendencias` expõe 18 refs `/_next/static/` que o parser captura. **Re-teste do usuário sobre v3 →
pendente.**

**3.F.CS-3.2 — Achado do 2º E2E: tela online-only offline caía no beco `/offline` (2026-07-11)**

No 2º E2E (v3/`b4fa95f7`), offline, ao entrar em **Estoque** (tela **online-only**) apareceu a página
`/offline` ("Você está offline"), **sem o menu** — um beco-sem-saída. Causa: o `OfflineNav` força
**reload** em toda navegação e só as rotas offline-capable (`/venda`,`/caixa`,`/pendencias`) eram
aquecidas; `/estoque` não estava em cache → o SW caiu no `/offline`. **Regressão de UX:** antes da CS-3
(3.F.CS-2.1) abrir Estoque offline mostrava o **banner "Sem conexão" dentro da tela, com o menu** —
comportamento validado que a CS-3 quebrou. **Correção (Version `4d47eacc`):** aquecer o **shell de
TODAS as telas do menu** (`WARM_ROUTES` = venda/vendas/caixa/products/estoque/customers/relatorios/
configuracoes/pendencias), não só as offline-capable. Custo mínimo (o JS é quase todo compartilhado; o
chunk próprio de cada tela tem 2–6KB). Assim as telas online-only **abrem o shell + menu + banner "Sem
conexão"** (os dados seguem online-only, decisão (c) do ADR-012) em vez do beco `/offline`; as
offline-capable seguem funcionando por completo. Smoke: `sw.js` publicado com as 9 rotas em
`WARM_ROUTES`; `/estoque` expõe 18 refs `/_next/static/`.

> ✅ **E2E do usuário (2026-07-11) — CS-3 VALIDADA (Version `4d47eacc`).** No PWA (Windows), offline:
> navegou por **todas** as telas do menu sem tela branca, sem `/offline`, sem `global-error`; as
> online-only mostram o banner "Sem conexão" com o menu; Venda/Caixa/Pendências operam do cache
> (CS-1/CS-2) e a venda offline enfileira. **Um achado menor → 3.F.CS-3.3.**

**3.F.CS-3.3 — Achado do E2E: item "Configurações" some do menu ao navegar offline (2026-07-11)**

Durante o E2E validado, o usuário notou que **Configurações desaparece do menu** depois de começar a
navegar offline. Causa: o item é `adminOnly` — só aparece com `isAdmin` (derivado do `GET /me`). Como a
navegação por reload remonta o shell a cada tela e o `/me` (cross-origin) falha sem rede, `isAdmin` caía
para `false` e o item sumia (antes da CS-3, o `me` ficava em memória entre telas). **Correção (Version
`624912fe`):** novo `apps/web/lib/meCache.ts` persiste o último `/me` bom em `localStorage`; `useMe`, ao
falhar **offline**, usa o cache (papel/nome preservados) — mas numa falha **online** (auth real, ex.: 403
de desativado) segue caindo em `me=null` (gate real intacto). `logout` chama `clearCachedMe()` (não vaza
perfil entre contas no aparelho). Só espelho de UX (decisão (a) do ADR-012); segurança real na API.
Typecheck + build (18 rotas) ✅. **Re-confirmação do usuário → pendente (item aparece offline).**

### 3.F.CS-4 — Semântica de caixa fechado no sync — CÓDIGO PRONTO (2026-07-11)

Última sub-fatia do ADR-012 (decisão (b)) — **a única que toca o servidor**, ainda **sem migration**
(`AuditEvent.action` é `String` livre). **Problema:** a venda offline referencia um `cashSessionId` que
pode ter sido **fechado** (noutro dispositivo) até o sync. A venda ocorreu fisicamente naquele turno, então
o `POST /orders` idempotente **anexa mesmo assim** (já anexava — a busca do caixa não exige `closedAt:null`)
e agora **marca para reconciliação**.

**Implementação.**
- `apps/api/src/routes/orders.ts` — no ramo offline, a busca do caixa passou a trazer `closedAt`;
  `cashClosedAt = isOffline ? session.closedAt : null`. Na transação, se o caixa estava fechado, grava
  **`AuditEvent SALE_ON_CLOSED_CASH`** (`meta`: `cashSessionId`, `cashClosedAt`, `total`, `offline`,
  `reconcile:true`) — evento crítico auditável, **não bloqueia** a venda. A resposta ganha
  `syncedToClosedCash:true` (observabilidade). Online intacto (caixa aberto, sem marca).
- `apps/api/src/routes/reports.ts` — `GET /reports/cash-sessions` agrega as marcas por sessão
  (`SALE_ON_CLOSED_CASH`) e devolve `lateSalesCount`/`lateSalesTotal` por fechamento — a divergência que a
  decisão (b) manda surgir no relatório.
- `packages/shared/src/report.ts` — `CashSessionReport` ganhou `lateSalesCount`/`lateSalesTotal`.
- `apps/web/app/(app)/relatorios/page.tsx` — badge âmbar "N após fechamento · R$…" na linha do caixa
  quando `lateSalesCount > 0`.
- `docs/adr/ADR-004` — `SALE_ON_CLOSED_CASH` formalizado na lista fechada de eventos.

**Build / typecheck / core (local)**

| Teste | Esperado | Resultado |
|---|---|---|
| `tsc --noEmit` em `packages/shared` + `apps/api` (após `prisma generate`) | sem erros | ✅ |
| Typecheck `apps/web` + `next build` | 18 rotas | ✅ sem erros |
| Core (Vitest) — não tocado | 47/47 | ✅ (regressão) |

**Deploy + smoke (produção) — 2026-07-11**

| Teste | Esperado | Resultado |
|---|---|---|
| `npm run deploy` (API) | publicado | ✅ Version `94f277ea` |
| `npm run deploy` (web) | publicado | ✅ Version `ae5296b5` |
| `GET /health` | `{ok:true}` | ✅ |
| `GET /reports/cash-sessions` sem token | 401 | ✅ (rota viva, secret intacto) |
| `POST /orders` sem token | 401 | ✅ |

**E2E do usuário — ✅ VALIDADO (2026-07-11/12).** Método de dois contextos do mesmo operador (PWA +
aba anônima): PWA abre o caixa → fica offline → registra a venda (pendente); a aba anônima (online)
**fecha o caixa**; o PWA volta online → o worker drena → a venda **entra** (não vira `FAILED`). Em
**Relatórios** apareceu o badge **"após fechamento"** na linha daquele caixa. *(Obs.: o "abrir no
navegador redireciona para o PWA" é o link-capturing do Chrome/Edge com PWA instalado — a **aba anônima**
dá o 2º contexto isolado, bastando logar o mesmo operador.)*

**Verificação de estoque (venda `#c0d0b8b9`, script de leitura descartável):** venda **CASH R$370,00**,
`status CONFIRMED`/`syncStatus SYNCED`, criada `01:21:02` num caixa fechado `01:20:26` (**anexada ~36s
após o fechamento** → caso real da decisão (b)). Estoque do **Cimento**: **240 → 230** (`StockMovement
EXPENSE 10` "Venda c0d0b8b9…", débito atômico ADR-001 confirmado); sem outros movimentos após. **Ou
seja: a marca de reconciliação NÃO afeta o débito de estoque nem a validade da venda — só sinaliza a
divergência de caixa.** Situação do caixa (`8bda91ce`): abertura R$850,00 · esperado congelado R$893,20
· contado R$0,00 (fechamento de teste) · a venda tardia foi **CASH R$370** — base para o "esperado
ajustado" da melhoria futura (ver CS-5 no ROADMAP). **CS-4 validada → ADR-012 (CS-1…CS-4) concluído.**

### 3.F.CS-5 — "Esperado ajustado" e divergência recalculada no relatório — CÓDIGO PRONTO (2026-07-13)

Melhoria da conferência da CS-4. Hoje o relatório mostra "N após fechamento · R$…", mas o dono ainda
fazia a conta do esperado ajustado na cabeça (ver 3.F.CS-4: caixa `8bda91ce` esperado R$893,20 + venda
tardia CASH R$370 = R$1.263,20). A CS-5 exibe a conta pronta **sem tocar no dado congelado** do
fechamento (auditoria — o caixa fechado segue imutável). **Sem migration** (`AuditEvent.meta` é JSON livre).

**Implementação.**
- `packages/core/src/index.ts` — função pura **`calcAdjustedCashClosing(expected, closing, lateCashTotal)`**
  → `{ adjustedExpected = expected + lateCashTotal, adjustedDivergence = closing − adjustedExpected }`
  (reusa `calcCashDivergence`; só o **dinheiro** entra, como no `calcExpectedCash`). **+4 testes Vitest.**
- `apps/api/src/routes/orders.ts` — no ramo que grava `SALE_ON_CLOSED_CASH`, o `meta` ganhou **`cashAmount`**
  (Σ dos `payments` com `method === 'CASH'` da venda) — evita join nos pagamentos no relatório.
- `apps/api/src/routes/reports.ts` — `GET /reports/cash-sessions` acumula `lateCashSalesTotal` por sessão
  (lê `meta.cashAmount`; **fallback ao `meta.total`** para marcas gravadas antes da CS-5, correto p/ venda
  100% dinheiro como a da CS-4) e devolve `adjustedExpected`/`adjustedDivergence` via `calcAdjustedCashClosing`.
- `packages/shared/src/report.ts` — `CashSessionReport` ganhou `lateCashSalesTotal`, `adjustedExpected`,
  `adjustedDivergence`.
- `apps/web/app/(app)/relatorios/page.tsx` — sob **Esperado** e **Divergência**, uma linha "ajust. R$…"
  (âmbar/colorida) aparece quando `lateSalesCount > 0 && lateCashSalesTotal > 0`.

**Build / typecheck / core (local)**

| Teste | Esperado | Resultado |
|---|---|---|
| Core (Vitest) — `calcAdjustedCashClosing` (+4) | 51/51 | ✅ 51/51 (era 47) |
| `tsc --noEmit` em `apps/api` (após `prisma generate`) | sem erros | ✅ |
| Typecheck `apps/web` + `next build` | 18 rotas | ✅ sem erros |

**Casos cobertos pelos testes do core**

| Caso | `adjustedExpected` | `adjustedDivergence` |
|---|---|---|
| Sem vendas tardias (repete o fechamento) | = esperado | 0 |
| Caso 3.F.CS-4 (893,20 + CASH 370, contado 1.263,20) | 1.263,20 | 0 |
| Contado não cobre a venda tardia (contado 893,20) | 1.263,20 | −370 |
| Arredondamento a 2 casas | ✅ | ✅ |

**Deploy (produção) — 2026-07-13.** API Version `dedff652` + web `8e398cfd`; smoke ✅ (`/health` ok;
`/reports/cash-sessions` e `POST /orders` → 401 sem token). **E2E do usuário:** confirmado no navegador
que a linha "ajust." aparece no relatório usando o dado da CS-4 (caixa `8bda91ce`: Esperado R$893,20 →
**ajust. R$1.263,20**, com o fallback ao `total` para a marca antiga sem `cashAmount`).

**Adendo — responsável do caixa no relatório (2026-07-13).** Pedido de UX: a tabela de Fechamentos já
mostra todo o financeiro do turno (abertura/esperado/contado/divergência), mas **não** dizia *quem abriu
e quem fechou* — dado capturado pelo ADR-010 (`CashSession.openedByName`/`closedByName`), nunca exibido.
`GET /reports/cash-sessions` passou a mapear `openedByName`/`closedByName` (a query já lia a sessão
inteira; **sem migration, sem core**); `CashSessionReport` (`packages/shared`) estendido. api tsc + web
typecheck/build (18 rotas) ✅. **No ar:** API Version `3c926d4c` + web `952c3bda`.

**Adendo — popover do turno (substitui o tooltip nativo, 2026-07-13).** O `title` nativo não aparece no
toque (celular/PWA). Trocado por um **popover React** (`CashSessionSummary` em `relatorios/page.tsx`) na
célula "Fechado em": **hover no desktop** (mouse, com atraso de 150 ms para "atravessar" até o balão) e
**toque abre/fecha no celular/PWA**; fecha ao tocar fora, `Esc`, rolar ou redimensionar. Posicionado com
`position: fixed` calculado do gatilho (`getBoundingClientRect`) + clamp na viewport → **não é cortado**
pelo `overflow-x-auto` da tabela nem sai da tela em telas estreitas. Conteúdo: *Aberto {data/hora · por
nome}* e *Fechado {data/hora · por nome}* (nomes com fallback "não informado"). Só front — web typecheck +
build (18 rotas) ✅. **No ar:** web Version `ac7c5b14`. **E2E do usuário ✅ VALIDADO (2026-07-13)** — o
popover aparece corretamente com abertura/fechamento + responsáveis.

### EF-1 (parcial) — Nome popular + busca (nome/popular/SKU) + código de barras — 2026-07-14

Fatia do enriquecimento do cadastro (parte do apelido) + leitura de código de barras. **Desvios do plano:**
a coluna virou `popularName` (não `nickname`, `VarChar(150)`) e o **código de barras entrou como bônus** (não
estava no EF-1 original). O resto do EF-1 (descrição, peso kg/g, unidade de venda) **não** foi feito.

**Banco.** Migration `0007_add_popular_name_to_product` — `ALTER TABLE products ADD COLUMN "popularName"
VARCHAR(150)` + `CREATE INDEX products_tenantId_popularName_idx`. Aditiva, nullable, **sem mudança de RLS**.
Aplicada com `migrate deploy` (o `migrate dev` tropeça no shadow DB por causa do schema `auth` do Supabase).

**Core (Vitest).**

| Teste | Esperado | Resultado |
|---|---|---|
| `normalizeSearchText` + `productMatchesQuery` (+7) | 58/58 | ✅ 58/58 (era 51) |

Casos cobertos: match por nome oficial, por nome popular, por SKU; acento- e caixa-insensível; query vazia
casa tudo; `popularName` nulo; "não casa quando nada bate".

**Build / typecheck.** `tsc --noEmit` em `apps/web` ✅; build da API (`wrangler deploy --dry-run`) ✅ após
`prisma generate`.

**Deploy da API (2026-07-14).** `apps/api` re-deployado — Version `54acd8eb-4c89-4f58-a5a6-44aca930b7e6`.
**Motivo (achado):** a API é um Worker deployado (`NEXT_PUBLIC_API_URL` aponta p/ ela). A versão anterior tinha
`@nexoloja/shared` (Zod **descarta** campo desconhecido) e Prisma Client antigos → o `popularName` **não salvava
nem retornava**. Confirmado no banco antes do deploy: produto criado ficou com `popularName=null`.

**E2E do usuário (2026-07-14, app logado, tenant real).**

| Caso | Resultado |
|---|---|
| Busca por **nome** (Produtos) e por **SKU** (case-insensitive) | ✅ |
| Busca **acento-insensível** ("vergalhao" → "Vergalhão") | ✅ |
| Cadastro de produto pela UI | ✅ (persistiu) |
| Modal do scanner 📷 abre + **câmera indisponível** → mensagem tratada (não quebra) | ✅ (preview sem câmera) |
| **Auto-add no Enter** na venda (SKU "TIJ-8F" → Tijolo no carrinho) | ✅ |
| **Busca por nome popular** ("cano" só existe em popular "Cano 100") | ❌ antes do deploy → ✅ **depois do deploy** |
| Persistência do `popularName` no banco (produto "Tubo PVC 100mm" / "Cano 100") | ✅ `popularName="Cano 100"` |

**Deploy do web (2026-07-14).** `apps/web` deployado (OpenNext) — Version `2bc2eab3-1aa4-4151-bd61-3e3a168300bd`;
smoke OK (login serve em `nexoloja-web.imortal.workers.dev`). **Fatia 100% no ar (API + web).** Login de produção
para o usuário conferir (não inserimos senha).

**Notas.** Leitura por **câmera** só dá para validar de verdade num **celular** (HTTPS) — o preview desktop não
tem câmera. **Dados de teste** deixados no tenant (a pedido do usuário): caixa aberto R$100 + produtos FE8-TESTE
e PVC100-TESTE.

### EF-1 (resto) — Descrição + peso (toggle kg/g) + unidade de venda no cadastro — 2026-07-15

Fecha o cadastro enriquecido do EF-1: os 3 campos que faltavam entraram na tela de Produtos. **Só front** —
os campos já existiam no `schema.prisma` (`description VarChar(500)`, `weightKg Decimal(8,3)`, `unit UnitType`)
e no `createProductSchema`; a API de 14/07 (`POST /products`) já repassa `...parsed.data` ao Prisma, então
**sem migration e sem deploy de API**.

**O que foi feito.**
- **`packages/shared/src/product.ts`** — novo `unitTypeLabels` (Record<UnitType,string> com rótulos PT-BR:
  Unidade/Metro/m²/m³/kg/Litro/Milheiro/Saco/Rolo), reutilizável no PDV/comprovante.
- **`apps/web/.../products/page.tsx`** — no formulário de cadastro:
  - **Unidade de venda** — `<select>` sobre `unitTypeLabels` (default `UNIT`).
  - **Peso** — input numérico + seletor **kg/g**; canônico em **kg** (gramas ÷ 1000 no envio; só vai quando > 0).
  - **Descrição/observação** — `<textarea>` (até 500, `resize-y`); vazio → `undefined` (não envia coluna vazia).
  - Reset do form e grid realinhados (6 colunas: unidade e peso col-span-2; descrição col-span-4 ao lado do
    estoque inicial).

**Build / typecheck / core.**

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ |
| Typecheck `packages/shared` | sem erros | ✅ |
| Core (Vitest) — regressão (não tocou o core) | 58/58 | ✅ 58/58 |
| Build de produção (`next build`) | rota `/products` regenerada | ✅ 18 rotas, sem erros |
| Dev server compila `/products` | 200 | ✅ (compilou, GET 200, sem erros no log) |

**Deploy do web (2026-07-15).** `apps/web` deployado (OpenNext) — Version `4baf2760-c0e2-442a-a5a7-c25d6f52e337`.
Sem deploy de API (a de 14/07 já aceita os 3 campos). Smoke OK (login serve em produção).

**E2E no navegador (2026-07-15, app logado, tenant real).** Usuário logou; cadastramos o produto **"Cabo
Flexível 2,5mm — TESTE EF1"** (SKU `CABO25-EF1TESTE`) com **Unidade = Metro (m)**, **Peso = 250 g** e
descrição. Persistência conferida direto na API (`GET /products`, do contexto da página com o token da sessão):

| Campo | Enviado na UI | Persistido |
|---|---|---|
| Cadastro pela UI (form reseta + produto surge na lista) | — | ✅ (margem 42,86%) |
| `unit` | Metro (m) | ✅ `"METER"` |
| `weightKg` (canônico kg) | **250 g** | ✅ **`"0.25"`** (conversão g→kg correta) |
| `description` | texto | ✅ íntegro |
| Console do navegador | — | ✅ sem erros |

> O caminho **g** (não-trivial, ÷1000) passou; o **kg** é identidade (coberto). **EF-1 FECHADO.** Produto de
> teste `CABO25-EF1TESTE` deixado no tenant (remover quando quiser). Próximo passo: **EF-2**.

### Fix — Busca do PDV (Nova Venda) vira lista visível e clicável — 2026-07-15

**Achado do usuário:** ao digitar no campo "Buscar produto" da Nova Venda, os produtos relacionados não
apareciam. **Causa:** a busca *funcionava* (mesma `productMatchesQuery` do core, 58/58), mas os resultados
filtravam só as `<option>` **dentro de um `<select>` colapsado** — só visíveis ao abrir o dropdown. Não era
bug de filtragem, e sim de UX (resultado escondido).

**Correção (só front, `apps/web/.../venda/page.tsx`):** trocado o `<select> + Adicionar` por uma **lista de
resultados visível e rolável** (autocomplete do PDV) abaixo do campo de busca:
- Aparece/filtra ao vivo conforme se digita (nome, nome popular ou SKU); sem termo, lista o catálogo (rolável).
- **Clicar no produto adiciona ao carrinho** com a **Quantidade** informada (campo ao lado da busca); depois a
  busca limpa e a lista volta ao catálogo completo.
- Cada linha mostra nome · SKU · preço · estoque; **estoque zerado** fica esmaecido e **desabilitado**
  ("sem estoque").
- **Enter-scan** (leitor físico, `onProductSearchKeyDown`) e **câmera** (`addByScan`) preservados.

| Teste | Esperado | Resultado |
|---|---|---|
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ |
| Build + `npm run deploy` (web) | publicado | ✅ Version `c15b93a1-ad8f-4bc3-96b0-6c8776bc7668` |
| Digitar "cimento" → lista filtra ao vivo (7 → 1) | lista visível narrowa | ✅ (E2E no navegador, produção) |
| Clicar no produto (qtd 3) → entra no carrinho | 3× Cimento = R$ 111,00 | ✅ |
| Após adicionar: busca limpa + lista volta ao catálogo + qtd volta a 1 | ok | ✅ |
| Itens sem estoque (Mouse, Cabo, Tubo PVC…) desabilitados | não clicáveis | ✅ ("sem estoque" em vermelho) |
| Console do navegador | sem erros | ✅ |

> Nada gravado no banco no teste (carrinho é estado local até "Confirmar"). Busca por **SKU/nome popular** usa a
> mesma função pura já validada (58/58 no core + E2E da tela Produtos).

### EF-2 (fatia 1) — Painel de reposição na tela de Estoque — 2026-07-15

Primeira fatia do EF-2 (estoque fino online-first): um **painel de reposição** no topo da tela de Estoque que
junta num lugar só tudo que está no ponto de reposição. **Sem migration, sem deploy de API** (usa
`/products`/`minStockQty` já existentes). **Não toca a fila offline.**

**Core (funções puras + testes, CLAUDE.md regra 2).** Duas funções novas em `packages/core`:
- **`isLowStock({stockQty, minStockQty})`** — regra canônica de estoque baixo: `minStockQty > 0 && stockQty <=
  minStockQty` (produto sem mínimo não alerta — o lojista opta rastreando).
- **`replenishmentShortfall(...)`** — sugestão de compra: `minStockQty − stockQty` (nunca negativa, 0 quando não
  está baixo), 4 casas (kg/m² fracionados).
Reusadas na tela (painel + badge + tabela — removida a duplicação da regra inline).

| Teste | Esperado | Resultado |
|---|---|---|
| Core: `isLowStock` + `replenishmentShortfall` (+10 casos) | 68/68 | ✅ 68/68 (era 58) |
| Typecheck `apps/web` (`tsc --noEmit`) | sem erros | ✅ |
| Build + `npm run deploy` (web) | publicado | ✅ Version `42314d77-384d-497e-89ac-d8f7cfa25295` |

**E2E no navegador (produção, app logado).** Cenário montado pela tela de Produtos (com autorização do usuário) e
**revertido ao final**: **Cimento** (saldo 230) mínimo → 300; **Mouse** (saldo 0) mínimo → 5.

| Caso | Resultado |
|---|---|
| Painel "Reposição de estoque" aparece no topo do Estoque com contador "2 itens para repor" | ✅ |
| **Mouse** — badge **zerado**, em estoque 0, mínimo 5, **Comprar +5** | ✅ (ordenado 1º, por estar zerado) |
| **Cimento** — badge **baixo**, em estoque 230, mínimo 300, **Comprar +70** | ✅ |
| Ordenação: zerados antes de baixos | ✅ |
| Console do navegador | ✅ sem erros |
| Reverter mínimos (Cimento → 10, Mouse → 0) → painel desaparece | ✅ (dados de teste restaurados) |

> Painel só renderiza quando há itens a repor (some quando tudo está acima do mínimo). Próxima fatia do EF-2:
> visão de reposição/movimentações por produto.

### EF-2 (fatia 2) — Visão consolidada por produto (saldo × mínimo × histórico) — 2026-07-15

Fecha o EF-2. A tabela "Estoque atual" passou a mostrar, por produto, os **totais do histórico** e a **consistência
do cache** (ADR-001), e virou porta de entrada para o histórico daquele produto. **Sem migration**; precisou de
**deploy de API** (endpoint agregado novo).

**API — `GET /stock/summary` (novo).** Totais por produto agregados no servidor com Prisma
`groupBy(['productId','type'], _sum: quantity)` — **cost-zero**, não trafega o histórico inteiro (o
`/stock/movements` tem `take: 50`, insuficiente para somar tudo). Reagrupa em `{ productId, income, expense }`.
Typecheck `apps/api` ✅. Deploy Version `d1f6799a-05b2-41bd-a9ff-088a45221f8e`.

**Web — tela de Estoque.** Colunas novas em "Estoque atual": **Entradas** (Σ INCOME, verde), **Saídas**
(Σ EXPENSE, vermelho) e **Saldo (hist.)** = Σ entradas − Σ saídas. Quando o saldo do histórico **diverge** do
`stockQty`, mostra **⚠** com tooltip (consistência ADR-001; não é erro — dado antigo sem movimento de origem
também diverge). **Clicar no produto** define o filtro das "Movimentações recentes" para ele (liga saldo ↔
histórico). Typecheck `apps/web` ✅. Deploy web Version `3523dd7c-e796-4dee-8fbb-ab4947eff59b`.

**E2E no navegador (produção, app logado).**

| Caso | Resultado |
|---|---|
| Colunas Entradas/Saídas/Saldo(hist.) aparecem por produto | ✅ |
| Argamassa: 55 entradas − 6 saídas = **49** = saldo atual (confere, sem ⚠) | ✅ |
| **⚠ de divergência** dispara quando Σ ≠ `stockQty` | ✅ **achado real no seed:** Cimento 230 ≠ 200; Tijolo 955 ≠ 905 |
| Produtos zerados/sem movimento (Mouse, Cabo, Tubo PVC, Vergalhão) → 0/0/0 | ✅ |
| Clicar no produto (Cimento) → filtra "Movimentações recentes" para ele | ✅ (dropdown vira "Cimento", lista 37 de 37 só Cimento) |
| Console do navegador | ✅ sem erros |

> **Achado (dado, não código):** o ⚠ revelou que `Product.stockQty` de **Cimento** (230) e **Tijolo** (955) não
> bate com a soma das movimentações (200 e 905) — provável seed/legado ajustado fora do fluxo de `StockMovement`.
> A **rotina de reconciliação** do ADR-001 (`stockQty = Σ INCOME − Σ EXPENSE`) corrige isso quando o usuário
> quiser. **EF-2 fechado** (fatias 1 e 2). Próximo: **EF-3** (venda em unidade alternativa — ADR antes de codar).
