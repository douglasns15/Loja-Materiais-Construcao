# 🗺️ Roadmap — NexoLoja (ERP/POS Multiramos)

> Fonte de verdade do progresso do projeto. Atualizado a cada avanço.
> Legenda: `[x]` concluído · `[ ]` pendente · 🟡 em andamento · ⏭️ adiado p/ fase futura
>
> **Última atualização:** 2026-07-03 (**Fase 2.5 — Fatias A–D concluídas**: exclusão de usuário
> da loja adicionada — `DELETE /users/:id` apaga a linha em `users` + revoga a identidade no
> Supabase Auth (`deleteAuthUser`, libera o e-mail) + `AuditEvent DELETE_USER`; bloqueia
> self/`OWNER` e usuários com histórico (→ 409 *Desativar*); botão **Excluir** em
> `/configuracoes`. **Fatia D (documental)**: `CREATE_TENANT`/`SET_TENANT_ACTIVE`/`DELETE_USER`
> formalizados na lista fechada do **ADR-004** e **ADR-009 fechado** (Fatias A–D). Sem migration.
> Typecheck API + web ✅; falta deploy do Worker + E2E do usuário. **Fatia E** (entrar no contexto
> da loja p/ suporte, impersonation auditada) fica como futura — direção no ADR-009. Antes:
> **Fatia C (painel `/plataforma`) no ar**: UI do
> Super Usuário (listar/criar/ativar lojas), `PATCH /platform/tenants/:id` + `SET_TENANT_ACTIVE`,
> login roteia por papel. API `76fe3134` + web `05a05fc4`; E2E PATCH 7/7 + UI validada no navegador
> (super usuário → painel, lista Loja Demo). Falta E2E de e-mail real (usuário) e a **Fatia D**
> (formalizar auditoria no ADR-004 + fechar ADR-009). Antes: **Fatia B (onboarding) no ar**: `POST
> /platform/tenants` cria loja + convida 1º Admin (`OWNER`); `createTenantSchema`+`slugify`,
> `inviteAuthUser` extraído p/ `lib/authAdmin.ts`, `AuditEvent CREATE_TENANT`; sem migration.
> API publicada (Version `ff3889d4`); E2E 12/12 (loja de teste criada e removida). Falta o E2E do
> e-mail real → cai na Fatia C. Antes: **Fatia A (ADR-009) no ar**: identidade
> de plataforma. Migration `0005_platform_admin` aplicada (tabela cross-tenant `platform_admins` +
> RLS + hook estendido p/ claim `is_platform_admin`), middleware `requirePlatformAuth`, rotas
> `/platform/me` e `/platform/tenants`, script `create-platform-admin.mjs`. API publicada (Version
> `7f7fcd7e`); E2E 10/10 (super usuário lista lojas cross-tenant; owner de loja barrado com 403;
> hook não quebrou a auth de loja). 1º super usuário: `super_owner@nexoloja.local`. Plano completo
> em `docs/plano-fase-2.5.md`. Próximo: **Fatia B (onboarding)**. Antes: **UI responsiva (2.S)** —
> correção de
> usabilidade no celular/tablet: `<meta viewport>` adicionado, menu lateral vira **gaveta**
> no celular (☰) e **recolhe** no desktop (persistido em `localStorage`), 7 tabelas passam a
> rolar (`overflow-x-auto`). Front puro, sem migration/API. Build + **deploy publicado**
> (Version `c13b1755`); falta só o E2E visual do usuário no celular. ⚠️ No Windows o
> `opennextjs-cloudflare deploy` quebrava (workerd `--debug-port`) — **corrigido em 2026-07-03**
> fixando `@cloudflare/workerd-windows-64@1.20260630.1` como optionalDependency do `apps/web`
> (casa com o workerd do wrangler 4); `npm run deploy` do web agora funciona direto. Ver
> "Infra.Deploy-Win" no registro de testes. Antes: **Web publicado no Cloudflare via OpenNext e validado** →
> `nexoloja-web.imortal.workers.dev` (convite E2E OK pela URL publicada); ver bloco abaixo.
> Antes: **Fase 2 CONCLUÍDA** — **Convite de usuário por e-mail —
> fatia 2 do ADR-008 (2.Q)**: `POST /users/invite` (Supabase `inviteUserByEmail` via
> `service_role` + linha em `users` + `AuditEvent CHANGE_ROLE`), botão **Convidar** em
> `/configuracoes` e página `/definir-senha`; binding `SUPABASE_SERVICE_ROLE_KEY` provisionado
> + Worker publicado + **E2E validado pelo usuário no navegador**. Antes: **Perfil "Meus
> dados" (2.P)**: menu de conta
> no rodapé (ícone + nome, popover com Meus dados/Sair); painel edita nome + **telefone**
> (`PATCH /me`) e troca **senha** via Supabase Auth com **reautenticação**. Migration
> `0004_user_phone` (coluna `phone` opcional em `users`) aplicada; Worker publicado (versão
> `685109c2`); E2E `PATCH /me` 6/6. Antes disso: **RBAC + gestão de usuários (ADR-008 fatia 1,
> 2.O)** — papéis Admin/Usuário derivados do `UserRole` sem migration, `requireAdmin`, `/me`,
> `/users`, gate de Configurações; E2E de RBAC 14/14. Falta a **fatia 2** do ADR-008 (convite
> por e-mail via `service_role`), que **fecha a Fase 2**, e a conferência visual no navegador)

> ✅ **Fase 2 fechada** — a fatia 2 do ADR-008 (convite de usuário por e-mail) foi validada
> ponta a ponta pelo usuário no navegador (convite → e-mail → `/definir-senha` → login). Com
> ela, gestão de usuários + RBAC concluídos. Logins de teste: Admin `owner@lojademo.com`,
> Usuário `caixa@lojademo.com`.
>
> ℹ️ **E-mail de convite — personalização adiada.** O convite já envia o nome da loja
> (`data.store_name`), pronto para uso, mas **editar o template de e-mail é bloqueado no free
> tier do Supabase** (exige Custom SMTP, Pro ou Send Email hook). Como isso se acopla ao
> **remetente próprio**, template + branding + campo de e-mail da loja ficaram todos como
> **melhorias futuras** (ver item da fatia 2). Hoje o convite funciona com o template padrão.
>
> ✅ **Web publicado no Cloudflare (OpenNext) — 2026-07-01 — validado:** `apps/web` roda na edge
> em **https://nexoloja-web.imortal.workers.dev** (Workers via `@opennextjs/cloudflare`; Pages
> descontinuado, ADR-005), sem domínio próprio por ora. As `NEXT_PUBLIC_*` são embutidas no
> build (não são secrets de runtime). CORS da API liberado para a nova origem + API republicada;
> Supabase *URL Configuration* atualizado (Site URL + Redirect `.../**` cobrindo `/definir-senha`,
> localhost mantido p/ dev). Smoke automatizado ✅ (login 200, env embutidas, preflight CORS 204)
> e **E2E de convite pela URL publicada validado pelo usuário no navegador** (convite → e-mail →
> `/definir-senha` → login). Ver 2.R no registro de testes.
>
> ▶️ **Próximo passo:** **Fase 2.5 (plataforma / multi-loja / Super Usuário / onboarding,
> ADR-009)** — *ainda não iniciada, aguardando decisão*. Alternativa: **Fase 3** (offline-first).
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

## 🔵 Fase 2 — Autenticação, Segurança (RLS) e MVP funcional — **Concluída (MVP)**

> Fechada pelo item que a define (gestão de usuários + RBAC, ADR-008), validado no navegador.
> Itens ainda desmarcados abaixo **não** travam o fechamento: **NFC-e** é fase futura dedicada;
> o **vínculo FK cross-schema** é endurecimento opcional (o `users.id = auth.users.id` já é
> garantido em código); **devolução parcial** e **melhorias de e-mail** são melhorias futuras.

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
- [x] **Gestão de usuários da loja + RBAC (ADR-008)** — *fecha a Fase 2*. Papéis
      **Admin** (`OWNER`/`MANAGER`) e **Usuário** (`CASHIER`/`STOCK`) derivados do `UserRole`
      atual — **sem migration** (funções puras em `packages/shared/roles.ts`). Convenção de
      escrita: Admin→`MANAGER`, dono→`OWNER` (preservado), Usuário→`CASHIER`.
  - [x] **Fatia 1 (feita):** `requireAdmin` na API; `GET /me` (papel p/ o front); `/users`
        (listar + definir papel + ativar/desativar, com `AuditEvent CHANGE_ROLE`, ADR-004);
        `PATCH /tenant` e logo agora exigem Admin; front esconde **Configurações** do menu e
        bloqueia a tela para não-Admin + seção de **Usuários** em `/configuracoes`. Typecheck
        API + build web ✅; **Worker publicado** (versão `909427d2`) + smoke 401 OK. *(2.O)*
  - [x] **Fatia 2 (feita):** convite por e-mail (`inviteUserByEmail`). `inviteUserSchema`
        (shared), `POST /users/invite` (cria/recupera no Supabase Auth + linha em `users` com
        papel + `AuditEvent CHANGE_ROLE`), formulário **Convidar** em `/configuracoes` e página
        pública `/definir-senha`. Secret `SUPABASE_SERVICE_ROLE_KEY` provisionado + Worker
        publicado; **E2E no navegador validado pelo usuário** (convite → e-mail → definir senha
        → login). Ver 2.Q. O convite já envia o **nome da loja** (`data.store_name`), pronto
        para o template — mas hoje usa o **template padrão** do Supabase (ver melhoria abaixo).
    - [ ] *Melhorias futuras de e-mail (fora do ADR-008):* **(a)** **personalizar o template**
          do convite (PT-BR + `{{ .Data.store_name }}`) — **bloqueado no free tier** (exige
          Custom SMTP, Pro ou Send Email hook); **(b)** **remetente próprio (branded)** via
          **Custom SMTP** (Resend/SES) — exige **domínio** com SPF/DKIM; **(c)** campo `email`
          no cadastro da loja (migration em `Tenant`) para **Reply-To**/contato no e-mail e no
          comprovante. Padrão de SaaS: envio pela plataforma, com nome de exibição = loja e
          Reply-To = e-mail da loja. (a) e (b) andam juntos: editar o template requer o SMTP.
- [x] **Perfil do usuário ("Meus dados")** — menu de conta no rodapé do menu lateral (ícone +
      nome; abre popover com nome/e-mail/papel, **Meus dados** e **Sair**). Painel edita nome
      e **telefone** (via `PATCH /me`) e troca a **senha** pelo Supabase Auth no cliente **com
      reautenticação** (pede a senha atual). E-mail é somente leitura. **Migration
      `0004_user_phone`** (coluna `phone` opcional em `users`; sem alteração de RLS). API+build
      ✅; Worker publicado (versão `685109c2`); E2E do `PATCH /me` 6/6. *(2.P)*
- [ ] Vínculo formal `users.id` ↔ `auth.users.id` (FK cross-schema) — *endurecimento opcional;
      não bloqueia o MVP (o vínculo já é garantido em código)*
- [ ] **NFC-e fiscal** (SEFAZ + certificado) — *fase futura dedicada (não é Fase 2)*

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

## 🟠 Fase 2.5 — Plataforma: multi-loja, Super Usuário e onboarding — **Fatias A–D concluídas** (E futura)

> Capacidades de **plataforma** que **cruzam o limite do tenant** (a fronteira de segurança
> via RLS). Separadas da Fase 2 de propósito: não são necessárias para uma loja operar e
> mexem no modelo de isolamento — ver **ADR-009**. Assentam sobre o RBAC da Fase 2 (ADR-008).

> **Decisões travadas (2026-07-02, ver `docs/plano-fase-2.5.md`):** onboarding **provisionado
> pelo Super Usuário** (sem signup público); identidade = **tabela `platform_admins` + claim
> `is_platform_admin`**; acesso cross-tenant por **rotas `/platform/*` dedicadas** (RLS de loja
> intacto). Execução em fatias A–D.

- [x] **Fatia A — Super Usuário (identidade + acesso cross-tenant)** — papel de plataforma **fora**
      do `UserRole` por-tenant: tabela `platform_admins` (verdade) + claim `is_platform_admin`
      (atalho de UI, via hook estendido). Middleware `requirePlatformAuth` (autoriza pela tabela),
      rotas `/platform/me` e `/platform/tenants`, script `create-platform-admin.mjs`. Migration
      `0005_platform_admin` (aditiva) aplicada + Worker publicado + **E2E 10/10** (2.5.A). Falta a
      **auditoria de plataforma** (Fatia D).
- [x] **Fatia B — Onboarding de loja (API)** — `POST /platform/tenants` cria `Tenant` + convida o
      primeiro **Admin** (`OWNER`) reusando o convite por e-mail (`inviteAuthUser` extraído p/
      `lib/authAdmin.ts`). `createTenantSchema` + `slugify` (shared); unicidade `slug`/`cnpj` (409);
      transação com `AuditEvent CREATE_TENANT`. **Sem migration.** API publicada (Version `ff3889d4`)
      + **E2E 12/12** (2.5.B). Falta o E2E do **e-mail real** (fica na Fatia C, com o navegador).
- [x] **Fatia C — Painel de gestão de lojas** (UI `/plataforma`, exclusivo do Super Usuário) —
      área separada do shell `(app)` com guard próprio (`GET /platform/me`); lista lojas + form
      "Nova loja" (`POST /platform/tenants`) + ativar/inativar (`PATCH /platform/tenants/:id` +
      `AuditEvent SET_TENANT_ACTIVE`). Login roteia por papel (`tokenIsPlatformAdmin`): super
      usuário → `/plataforma`. API Version `76fe3134` + web `05a05fc4`; E2E PATCH 7/7 + UI validada
      no navegador (2.5.C). *Entrar no contexto de uma loja p/ suporte = futuro (fatia própria).*
      Falta o E2E de navegador do usuário (criar loja com e-mail real).
- [x] **Exclusão de usuário da loja (ADR-008)** — `DELETE /users/:id` (Admin): apaga a linha em
      `users` **+ revoga a identidade no Supabase Auth** (`deleteAuthUser`, libera o e-mail para
      novo convite) **+ `AuditEvent DELETE_USER`**. Bloqueia excluir a si mesmo/o `OWNER`; usuário
      **com histórico** (pedidos/caixa — FKs sem cascade) → **409** orientando a *Desativar*
      (preserva integridade + auditoria). Botão **Excluir** na seção Usuários de `/configuracoes`.
      **Sem migration.** Typecheck API + web ✅. *Falta: deploy do Worker + E2E no navegador (login)
      pelo usuário.* Pré-requisito pedido antes da Fatia D (liberar o e-mail de teste).
- [x] **Fatia D — Auditoria de plataforma** — eventos `CREATE_TENANT` e `SET_TENANT_ACTIVE`
      (e `DELETE_USER`, de loja) **formalizados na lista fechada do ADR-004** (`meta.platform = true`;
      `userId` = Super Usuário; `tenantId` = loja-alvo) e **ADR-009 fechado** (Fatias A–D). **Sem
      migration, sem deploy** (só documentação).
- [x] **Endurecimento — bloqueio de loja desativada (ADR-009)** — desativar a loja (`SET_TENANT_ACTIVE`)
      passou a ter efeito real: `requireAuth` carrega `Tenant.isActive` → `tenantActive` no contexto;
      `GET /me` devolve o flag; novo middleware `requireActiveTenant` barra `POST /orders` (nova venda)
      com **403** quando inativa. Front: **aviso vermelho no topo** de toda tela (`(app)/layout`) +
      tela de **Nova Venda bloqueada**. Consultas/fechar caixa/cancelar/devolver seguem liberados (a
      loja ainda "encerra" pendências). Bloqueio aplicado a **novas vendas** (`POST /orders`),
      **abertura de caixa** (`POST /cash-sessions/open`) e **entrada de estoque** (`POST
      /stock/movements`); fechar caixa, ajuste de inventário, cancelar/devolver e consultas seguem
      liberados (ações de encerramento/correção). O aviso do topo lista as três operações. **Sem
      migration.** API `daf90038` + web `533c1921`; typecheck API+web ✅. *Falta E2E no navegador (usuário).*
- [ ] **Fatia E — Entrar no contexto da loja para suporte (impersonation auditada)** — *futura*.
      Sessão de suporte temporária de escopo `{ platformAdminId, targetTenantId, exp }` (token
      próprio, não login do lojista), somente-leitura por padrão, auditada (`meta.support = true`,
      `SUPPORT_SESSION_START/END`). Direção detalhada no **ADR-009 → "Status de implementação"**.

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
- **Atualizar o wrangler da API (3.114 → 4.x) — adiado:** decisão de 2026-07-03. A API funciona na 3.114; a v3 está defasada (aviso de deprecação no deploy). Fazer **depois de fechar os testes da Fase 2.5 + a Fatia D**, junto com o web (uniformizar as duas apps na mesma major/`workerd`, deixando um binário só na raiz). Ao atualizar: revalidar config `wrangler.toml` + bindings (Hyperdrive/R2/secret) com `deploy --dry-run` antes de publicar. Contexto do descasamento de `workerd` no Windows em "Infra.Deploy-Win" (registro de testes).
- **Migrations no Supabase:** usar `migrate diff` + `migrate deploy` (o `migrate dev` tropeça no *shadow database* do free tier).
- **Auth:** credenciais são do Supabase Auth; a tabela `users` não guarda senha.
