# 🗺️ Roadmap — NexoLoja (ERP/POS Multiramos)

> Fonte de verdade do progresso do projeto. Atualizado a cada avanço.
> Legenda: `[x]` concluído · `[ ]` pendente · 🟡 em andamento · ⏭️ adiado p/ fase futura
>
> **Última atualização:** 2026-07-01 (Fase 2 — **Perfil "Meus dados" (2.P)**: menu de conta
> no rodapé (ícone + nome, popover com Meus dados/Sair); painel edita nome + **telefone**
> (`PATCH /me`) e troca **senha** via Supabase Auth com **reautenticação**. Migration
> `0004_user_phone` (coluna `phone` opcional em `users`) aplicada; Worker publicado (versão
> `685109c2`); E2E `PATCH /me` 6/6. Antes disso: **RBAC + gestão de usuários (ADR-008 fatia 1,
> 2.O)** — papéis Admin/Usuário derivados do `UserRole` sem migration, `requireAdmin`, `/me`,
> `/users`, gate de Configurações; E2E de RBAC 14/14. Falta a **fatia 2** do ADR-008 (convite
> por e-mail via `service_role`), que **fecha a Fase 2**, e a conferência visual no navegador)

> ▶️ **Próximo passo — fatia 2 (FECHA a Fase 2): convite de usuário por e-mail**
> (`inviteUserByEmail`). Pré-requisito do usuário: provisionar a `SUPABASE_SERVICE_ROLE_KEY`
> como **secret do Worker** (`wrangler secret put SUPABASE_SERVICE_ROLE_KEY`). A implementar:
> `POST /users/invite` (cria no Supabase Auth + linha em `users` com papel) e botão
> **Convidar** na seção Usuários de `/configuracoes`. RBAC (2.O) e perfil (2.P) já validados
> pelo usuário no navegador — logins: Admin `owner@lojademo.com`, Usuário `caixa@lojademo.com`.
> - *Melhoria futura na Fase 2:* devolução **parcial** (itens/quantidades com rateio).
> - *Fase própria (Plataforma, ver abaixo):* **multi-loja + Super Usuário + onboarding** (ADR-009).
> - *Fase futura dedicada:* **NFC-e fiscal** (SEFAZ + certificado).
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
- [x] **Upload de logo da loja (Cloudflare R2)** — **concluído**. **R2 binding** no Worker
      (ADR-007, não presigned): `POST /tenant/logo` valida tipo/tamanho (`validateLogo` em
      `packages/shared`), grava no R2 (`env.MEDIA.put`) e salva só a `logoUrl` (nunca
      BLOB/Base64); `DELETE /tenant/logo` remove; leitura pública pelo próprio Worker em
      `GET /public/logo/:tenantId` (cache longo + cache-bust `?v=`). UI nova `/configuracoes`
      (upload + preview + validação). **Sem migration** — `logoUrl` já existia. Bucket
      `nexoloja-media` criado + Worker publicado + E2E validado no navegador. *(2.M)*
- [x] **Editar dados da loja (nome/CNPJ/telefone)** — API `PATCH /tenant` (Zod
      `updateTenantSchema`: nome obrigatório, CNPJ/telefone opcionais → `null` quando vazio;
      `P2002` do CNPJ único → 409) e o card "Dados da loja" em `/configuracoes` virou
      formulário (editar/salvar/descartar; "Salvar" habilita só com alteração real). **Sem
      migration** — campos já existiam no `Tenant`. Máscara de CNPJ/telefone: digita só
      números e formata ao sair do campo (`formatCnpj`/`formatPhoneBr` em `packages/shared`);
      banco guarda **só dígitos** (canônico → índice único de `cnpj` robusto). Typecheck da
      API + build do web ✅. **Worker publicado** (`wrangler deploy`) + **editar→salvar e
      máscara validados pelo usuário no navegador**. *(2.N)*
- 🟡 **Gestão de usuários da loja + RBAC (ADR-008)** — *item que fecha a Fase 2*. Papéis
      **Admin** (`OWNER`/`MANAGER`) e **Usuário** (`CASHIER`/`STOCK`) derivados do `UserRole`
      atual — **sem migration** (funções puras em `packages/shared/roles.ts`). Convenção de
      escrita: Admin→`MANAGER`, dono→`OWNER` (preservado), Usuário→`CASHIER`.
  - [x] **Fatia 1 (feita):** `requireAdmin` na API; `GET /me` (papel p/ o front); `/users`
        (listar + definir papel + ativar/desativar, com `AuditEvent CHANGE_ROLE`, ADR-004);
        `PATCH /tenant` e logo agora exigem Admin; front esconde **Configurações** do menu e
        bloqueia a tela para não-Admin + seção de **Usuários** em `/configuracoes`. Typecheck
        API + build web ✅; **Worker publicado** (versão `909427d2`) + smoke 401 OK. *(2.O)*
  - [ ] **Fatia 2:** convite por e-mail (`inviteUserByEmail`) — exige a
        `SUPABASE_SERVICE_ROLE_KEY` como **secret do Worker** (provisionar + deploy) e um
        `POST /users/invite`. Até lá, novos usuários nascem pelo script de bootstrap.
- [x] **Perfil do usuário ("Meus dados")** — menu de conta no rodapé do menu lateral (ícone +
      nome; abre popover com nome/e-mail/papel, **Meus dados** e **Sair**). Painel edita nome
      e **telefone** (via `PATCH /me`) e troca a **senha** pelo Supabase Auth no cliente **com
      reautenticação** (pede a senha atual). E-mail é somente leitura. **Migration
      `0004_user_phone`** (coluna `phone` opcional em `users`; sem alteração de RLS). API+build
      ✅; Worker publicado (versão `685109c2`); E2E do `PATCH /me` 6/6. *(2.P)*
- [ ] Vínculo formal `users.id` ↔ `auth.users.id` (FK cross-schema)
- [ ] **NFC-e fiscal** (SEFAZ + certificado) — fase futura dedicada

> **Gestão de usuários fecha a Fase 2 (ADR-008):** foi deixada por último de propósito —
> só faz sentido depois do núcleo do MVP (login → cadastros → venda → caixa → estoque →
> relatórios), e não bloqueou nada até aqui porque o primeiro OWNER de cada loja nasce do
> script de **bootstrap** (invite-only). Agora entra como o item de fechamento, trazendo
> junto o **RBAC** (o `user_role` já vai no JWT, mas ainda não é verificado). O papel de
> **Super Usuário (fabricante)** NÃO entra aqui — é de plataforma (cross-tenant) e vive na
> fase abaixo (ADR-009).

> **Nota de infra:** o cache de leitura do Hyperdrive foi **desabilitado**
> (`--caching-disabled`) para evitar listas desatualizadas logo após uma escrita —
> essencial num ERP/POS. O pooling de conexão segue ativo.

---

## 🟠 Fase 2.5 — Plataforma: multi-loja, Super Usuário e onboarding — **Pendente**

> Capacidades de **plataforma** que **cruzam o limite do tenant** (a fronteira de segurança
> via RLS). Separadas da Fase 2 de propósito: não são necessárias para uma loja operar e
> mexem no modelo de isolamento — ver **ADR-009**. Assentam sobre o RBAC da Fase 2 (ADR-008).

- [ ] **Super Usuário (fabricante)** — papel de plataforma **fora** do `UserRole` por-tenant
      (tabela `PlatformAdmin` e/ou claim `is_platform_admin`), com acesso **cross-tenant
      controlado** (rotas de plataforma dedicadas na API, não relaxamento do RLS) e auditoria.
- [ ] **Onboarding de loja** — criar `Tenant` + primeiro **Admin** (substitui o script de
      bootstrap). Decidir gatilho: **provisionado pelo Super Usuário** (recomendado) vs.
      signup self-service. A unicidade `Tenant.cnpj` (`@unique`, 409) passa a ter uso real.
- [ ] **Painel de gestão de lojas** (exclusivo do Super Usuário) — listar/ativar/inativar
      lojas (`Tenant.isActive`) e entrar no contexto de uma loja para suporte.
- [ ] Estender a **auditoria (ADR-004)** para eventos de plataforma.

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
