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
