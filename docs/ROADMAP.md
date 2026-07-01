# 🗺️ Roadmap — NexoLoja (ERP/POS Multiramos)

> Fonte de verdade do progresso do projeto. Atualizado a cada avanço.
> Legenda: `[x]` concluído · `[ ]` pendente · 🟡 em andamento · ⏭️ adiado p/ fase futura
>
> **Última atualização:** 2026-07-01 (Fase 2 — Upload de logo da loja (Cloudflare R2 /
> ADR-007): binding `[[r2_buckets]]` no Worker (sem chaves S3/CORS); `POST /tenant/logo`
> valida tipo/tamanho e grava a imagem no R2 salvando SÓ a `logoUrl`; `DELETE /tenant/logo`
> remove; leitura pública servida pelo próprio Worker em `GET /public/logo/:tenantId` com
> cache longo + cache-bust por versão. Validação pura em `packages/shared` (`validateLogo`).
> Nova tela `/configuracoes` (upload + preview + validação). **Sem migration** — `logoUrl`
> já existia. Código + build/typecheck/UI validados localmente; **falta você criar o bucket
> e publicar o Worker** para o E2E — ver bloco abaixo)

> ▶️ **Próximo passo — Provisionar o R2 + publicar e validar o upload de logo.** O código
> está pronto; faltam os passos de nuvem (conta Cloudflare do usuário) + o E2E:
> - **Criar o bucket** (uma vez): `cd apps/api && npx wrangler r2 bucket create nexoloja-media`.
> - **Publicar o Worker** com as rotas novas: `cd apps/api && npx wrangler deploy`.
> - **Validar E2E:** subir uma logo em `/configuracoes` → conferir que aparece na tela,
>   persiste (`GET /tenant` retorna `logoUrl`) e sai no **cabeçalho do comprovante** (80mm/A4).
>   Testar **Remover** (volta a "Sem logo") e limites (arquivo > 1 MB / formato inválido → erro).
> - *Depois disso:* editar **dados da loja** (nome/CNPJ/telefone via `PATCH /tenant`) — a tela
>   `/configuracoes` já tem o espaço reservado (hoje só leitura).
> Estado atual: PDV completo (carrinho → revisão → confirmar → impressão, com layout
> 80mm/A4 validado no navegador), **cancelamento de venda** (estorno de estoque/caixa +
> auditoria, restrito ao caixa aberto), **gestão de estoque** (entrada/ajuste/histórico),
> caixa, auth+RLS e CRUDs de cadastro funcionando e publicados. App roda com
> `npm run dev` na **raiz** (sobe só o web via turbo filter; `dev:all`/`dev:api` exigem
> Postgres local p/ Hyperdrive). O front chama a API publicada em
> `nexoloja-api.imortal.workers.dev`.

---

## 🟢 Fase 0 — Fundação, Arquitetura e Banco de Dados — **Concluída**

- [x] Definição arquitetural: 5 ADRs + `docs/ARCHITECTURE.md`
- [x] Modelagem completa do `schema.prisma` (multi-tenant, produtos, estoque, vendas, caixa, entregas, auditoria)
- [x] Tabelas criadas fisicamente no Supabase (schema `public`)
- [x] Ambiente Prisma estabilizado na v6 (conexão via porta direta 5432)

---

## 🟡 Fase 1 — Monorepo e Backend — **Concluída**

- [x] Turborepo + npm workspaces na raiz (`package.json`, `turbo.json`, `tsconfig.base.json`)
- [x] `packages/db` — Prisma isolado (schema + client + migrations)
- [x] `packages/shared` — base de schemas Zod / tipos compartilhados
- [x] `packages/core` — lógica de negócio pura + testes Vitest
- [x] `apps/api` — Hono em Cloudflare Workers (scaffold)
- [x] `apps/web` — placeholder reservado p/ Fase 2
- [x] **Ajuste:** `directUrl` (5432) no datasource p/ migrations
- [x] **Ajuste:** baseline de migrations (`0_init` + `0001_drop_password_hash`)
- [x] **Ajuste:** auth alinhada ao Supabase Auth (remoção de `User.passwordHash`; `User.id` = `auth.users.id`)
- [x] Endpoint de validação `GET /db-check` lendo o banco (validado em `wrangler dev`)
- [x] CRUD de **Produtos** (`/products`) — validado ponta a ponta no Supabase
- [x] CRUD de **Clientes** (`/customers`) — validado ponta a ponta no Supabase
- [x] CRUD de **Categorias** (`/categories`, com hierarquia) e **Fornecedores** (`/suppliers`)
- [x] Deploy na edge (Cloudflare Workers + Hyperdrive) — `https://nexoloja-api.imortal.workers.dev`

> ℹ️ Tenant ainda vem do header temporário `x-tenant-id` — será substituído pelo
> claim do JWT (Supabase Auth + RLS) na Fase 2.

---

## 🔵 Fase 2 — Autenticação, Segurança (RLS) e MVP funcional — **Em andamento**

- [x] **API protegida por JWT do Supabase** (middleware `requireAuth`) — aposenta o `x-tenant-id`
- [x] Bootstrap de loja + OWNER (`users.id` = `auth.users.id`)
- [x] Custom Access Token Hook (injeta `tenant_id`/`user_role` no JWT)
- [x] Ativar RLS nas tabelas + políticas de isolamento por `tenant_id`
- [x] UI (Next.js + Tailwind): scaffold + tela de **login** (Supabase Auth)
- [x] UI: **app shell** (menu lateral + proteção de login centralizada)
- [x] UI: tela de **produtos** (lista + cadastro via API, com CORS)
- [x] UI: tela de **clientes** (lista + cadastro)
- [x] UI + API: abertura/fechamento de **caixa** (com divergência e auditoria)
- [x] UI + API: **venda/PDV** — carrinho, pagamento (Dinheiro/Déb/Créd/PIX),
      Concluir e Orçamento; estoque atômico (ADR-001) e baixa no caixa
- [x] Impressão: comprovante de venda (não-fiscal) + orçamento — térmica 80mm e A4,
      com cabeçalho (nome + logo da loja) — *layout validado no navegador (2.H.4)*
- [x] UI + API: **gestão de estoque** — entrada (compra/recebimento, transação atômica
      ADR-001) e ajuste de inventário (com `AuditEvent ADJUST_STOCK`, ADR-004), histórico
      de movimentações e alerta de estoque baixo — *validado no navegador e via API (2.J)*
- [x] UI: **estoque mínimo por produto** — campo no cadastro + edição inline na tela de
      Produtos (`PATCH /products`); arma o alerta de “baixo” na tela de Estoque — *(2.J.2)*
- [x] UI + API: **cancelamento de venda** (ADR-004) — estorno de estoque (StockMovement
      reverso INCOME), reversão do pagamento no caixa (esperado ignora `CANCELLED`) e
      `AuditEvent CANCEL_ORDER`; restrito ao caixa aberto — *validado via API publicada
      (14/14) e UI no navegador (2.K)*
- [x] **Relatórios** de vendas e caixa — nova rota `/reports` (`GET /sales`,
      `GET /cash-sessions`) com agregação no servidor (Prisma `aggregate`/`groupBy`,
      cost-zero); vendas por período (faturamento, nº de vendas, ticket médio,
      canceladas à parte), totais por forma de pagamento (com participação %) e
      histórico de fechamentos de caixa com divergência; UI `/relatorios` com atalhos
      (Hoje/7d/30d) e período De–Até. Core: `calcAverageTicket` + `withPaymentShare`
      (testes Vitest). **Sem migration** — usa `Order`/`Payment`/`CashSession`. *(2.L)*
- [x] **Devolução de venda de caixa fechado** (ADR-006) — fluxo separado do cancelamento:
      repõe estoque (StockMovement INCOME reverso) e lança a **saída no caixa de hoje**
      (nova tabela `CashMovement`, `EXPENSE/RETURN`), sem tocar no caixa original já
      fechado; marca o pedido como `RETURNED` e registra `AuditEvent RETURN_ORDER`. O
      esperado do caixa passa a descontar saídas (`netCashMovements` no core). UI: botão
      **Devolver** no Histórico (vendas de caixas fechados) + linha de saídas no Caixa.
      Migration `0003_cash_movements_and_return` (tabela + enum + RLS). *(2.L2)*
  - [ ] **Devolução parcial** (itens/quantidades específicas com rateio de valor) — melhoria
        futura; hoje a devolução é sempre da venda inteira.
- [x] **Upload de logo da loja (Cloudflare R2)** — 🟡 **código pronto; falta deploy+E2E**.
      **R2 binding** no Worker (ADR-007, não presigned): `POST /tenant/logo` valida
      tipo/tamanho (`validateLogo` em `packages/shared`), grava no R2 (`env.MEDIA.put`) e
      salva só a `logoUrl` (nunca BLOB/Base64); `DELETE /tenant/logo` remove; leitura pública
      pelo próprio Worker em `GET /public/logo/:tenantId` (cache longo + cache-bust `?v=`).
      UI nova `/configuracoes` (upload + preview + validação). **Sem migration** — `logoUrl`
      já existia. Build/typecheck/UI OK localmente; **pendente:** criar bucket `nexoloja-media`
      + `wrangler deploy` + E2E (logo no cabeçalho do comprovante).
- [ ] **NFC-e fiscal** (SEFAZ + certificado) — fase futura dedicada
- [ ] Convite de funcionários por e-mail (`inviteUserByEmail`)
- [ ] Vínculo formal `users.id` ↔ `auth.users.id` (FK cross-schema)

> **Por que o convite de funcionários está adiado:** ele será uma tela de *gestão de
> usuários* dentro do painel, e faz mais sentido construí-lo depois do núcleo do MVP
> (login → cadastros → venda). Não bloqueia nada agora porque o primeiro OWNER de cada
> loja já é criado pelo script de **bootstrap** (invite-only), então dá para desenvolver
> e testar todo o fluxo sem o convite pronto. Entra na fase de gestão de usuários/papéis.

> **Nota de infra:** o cache de leitura do Hyperdrive foi **desabilitado**
> (`--caching-disabled`) para evitar listas desatualizadas logo após uma escrita —
> essencial num ERP/POS. O pooling de conexão segue ativo.

---

## 🟣 Fase 3 — Recursos Avançados e Produção — **Pendente**

- [ ] Suporte offline (PWA / Service Worker no Next.js)
- [ ] Fila de sincronização (IndexedDB → Supabase)
- [ ] Módulo de estoque fino (estoque mínimo, notificações, movimentações detalhadas)
- [ ] Otimização do pooler (6543) para limites do free tier
- [ ] Avaliar upgrade Supabase Pro p/ produção

---

## 📌 Notas / decisões em aberto

- **Prisma 6 (não 7):** mantido de propósito por estabilidade de conexão. Não subir sem revalidar a conexão pela edge.
- **Migrations no Supabase:** usar `migrate diff` + `migrate deploy` (o `migrate dev` tropeça no *shadow database* do free tier).
- **Auth:** credenciais são do Supabase Auth; a tabela `users` não guarda senha.
