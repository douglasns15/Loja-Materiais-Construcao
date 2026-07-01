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

### 2.D — Convite de funcionários por e-mail — ⏭️ pendente
### 2.I — NFC-e fiscal (SEFAZ) — ⏭️ fase futura dedicada
