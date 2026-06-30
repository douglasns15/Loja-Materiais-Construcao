# 🗺️ Roadmap — NexoLoja (ERP/POS Multiramos)

> Fonte de verdade do progresso do projeto. Atualizado a cada avanço.
> Legenda: `[x]` concluído · `[ ]` pendente · 🟡 em andamento · ⏭️ adiado p/ fase futura
>
> **Última atualização:** 2026-06-30 (Fase 2 — Gestão de estoque concluída; entrada/ajuste validados no navegador e via API publicada)

> ▶️ **Próximo passo (a definir com o usuário):** uma destas frentes —
> **upload de logo da loja** (Cloudflare R2), **relatórios de vendas/caixa**,
> ou **cancelamento de venda** (ADR-004).
> Estado atual: PDV completo (carrinho → revisão → confirmar → impressão, com layout
> 80mm/A4 validado no navegador), **gestão de estoque** (entrada/ajuste/histórico),
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
- [ ] UI + API: **cancelamento de venda** (ADR-004) — estorno de estoque (StockMovement
      reverso), reversão do pagamento no caixa e `AuditEvent CANCEL_ORDER`
- [ ] **Relatórios** de vendas e caixa — vendas por período, totais por forma de
      pagamento e fechamentos de caixa
- [ ] Upload de logo da loja (Cloudflare R2)
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
