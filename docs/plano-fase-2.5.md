# Plano de Execução — Fase 2.5 (Plataforma / ADR-009)

> Plano aprovado pelo usuário em **2026-07-02**. Fonte de verdade do progresso continua sendo
> `docs/ROADMAP.md` + `docs/testes/registro-de-testes.md`; este documento detalha o **como** da
> Fase 2.5. Implementa o [ADR-009](adr/ADR-009-multi-loja-e-super-admin.md).

## Decisões travadas (resolvem as "decisões em aberto" do ADR-009)

1. **Onboarding = provisionado pelo Super Usuário.** Não há signup público. A equipe (fabricante)
   cria a loja e convida o primeiro Admin. Menor superfície de abuso.
2. **Identidade de plataforma = tabela `platform_admins` (verdade) + claim `is_platform_admin` no
   JWT (atalho de UI).** A **autorização** no servidor confia **na tabela** (via middleware); o
   claim serve só para o front decidir rota/menu. O claim é injetado estendendo o *custom access
   token hook* que já existe (migration 0002).
3. **Acesso cross-tenant = rotas `/platform/*` dedicadas.** A API roda como dono do banco e isola
   por código. O **RLS das tabelas de loja NÃO muda** — continua sendo a fronteira. Nunca abrir
   policies RLS para o papel `authenticated` ver dados de todos os tenants.

## Princípios de segurança

- O Super Usuário **não pertence a nenhuma loja** — não tem linha em `users`, logo **não** passa
  pelo `requireAuth` (que exige `users`); ganha middleware e shell próprios.
- Toda ação de plataforma que toque dados de uma loja é **auditada** (quem, qual loja, o quê).
- Rotas `/platform/*` **nunca** expostas a papéis de loja (Admin/Usuário).

---

## Fatia A — Fundação de identidade de plataforma

**Banco — migration `0005_platform_admin` (ADITIVA, não altera tabelas existentes):**
- Tabela `platform_admins`: `id uuid PK` (= `auth.users.id`), `email varchar(150) @unique`,
  `name varchar(100)`, `isActive boolean default true`, `createdAt`, `updatedAt`. **Sem FK para
  `tenants`** (é cross-tenant).
- **RLS ligado, sem policy** → nega acesso direto de cliente; só a API-dono lê (mesmo padrão das
  demais tabelas). Baixo risco, reversível.

**Supabase (fora do Prisma):** estender o *access token hook* para setar `is_platform_admin: true`
quando o `id` do usuário estiver em `platform_admins` e ativo. Documentado como a 0002.

**API:**
- Middleware `requirePlatformAuth` — verifica o JWT (JWKS) e **autoriza pela tabela**
  `platform_admins` (claim é só atalho de UI). Popula `platformAdminId` no contexto.
- Grupo `/platform` montado no `index.ts`, protegido por `requirePlatformAuth`.
- `GET /platform/me` → `{ isPlatformAdmin, name, email }`.
- `GET /platform/tenants` → lista todas as lojas (prova o acesso cross-tenant seguro).

**Script:** `packages/db/scripts/create-platform-admin.mjs` (via `service_role`, como o bootstrap)
para provisionar o 1º super usuário.

**Validação:** typecheck API + `next build`; script E2E (platform vê lojas; usuário de loja recebe
403 nas rotas `/platform/*`); provisão do 1º super usuário validada pelo usuário.

---

## Fatia B — Onboarding (provisão de loja + 1º Admin)

- `POST /platform/tenants` — cria `Tenant` (nome, slug, CNPJ opcional) **+ convida o 1º Admin**
  (papel `OWNER`) reusando o fluxo de convite (`inviteUserByEmail` + `service_role`), tudo em
  **transação**. Trata unicidade de `slug`/`cnpj` (409). Gera `AuditEvent CREATE_TENANT`.
- Aposenta o `bootstrap-tenant.mjs` como operação de produto (script fica só para emergência).

**Validação:** E2E criar loja → convite chega → 1º Admin define senha → entra na loja nova.

---

## Fatia C — Painel de gestão de lojas (UI do Super Usuário)

- Nova área **`/plataforma`** no `apps/web`, **separada** do shell de loja `(app)`. Guard via
  `GET /platform/me`.
- Telas: **listar lojas** (status, criada em, nº de usuários), **criar loja** (form →
  `POST /platform/tenants`), **ativar/inativar** (`PATCH /platform/tenants/:id { isActive }`).
- **Login roteia por papel:** super usuário → `/plataforma`; usuário de loja → `/venda`.
- *"Entrar no contexto da loja" para suporte* fica como **futuro** (maior superfície de risco;
  merece fatia própria com auditoria dedicada).

**Validação:** typecheck + build; E2E de navegador (login com senha) com o usuário.

---

## Fatia D — Auditoria de plataforma

- Estender a lista fechada do **ADR-004** com `CREATE_TENANT` e `SET_TENANT_ACTIVE` — ambos têm
  loja-alvo, então **reusam `AuditEvent`** (`tenantId` = loja alvo, `userId` = id do super
  usuário, `meta.platform = true`) — **sem migration**.
- Eventos *sem* loja (ex.: conceder super usuário) exigiriam `AuditEvent.tenantId` nullable (mexe
  em tabela core + RLS) → **adiado/decidir depois**; por ora, conceder super usuário é via script
  auditável no servidor.
- Fechamento: `ADR-009 → Aceito`; `ADR-004` atualizado com os novos eventos.

---

## Resumo de migrations

| Fatia | Migration | Impacto |
|---|---|---|
| A | `0005_platform_admin` | **Aditiva** — nova tabela + RLS. Não altera nada existente. |
| B/C | nenhuma | `Tenant.isActive/cnpj` e `AuditEvent` já existem. |
| D | nenhuma (opcional, adiada) | só se decidirmos auditar eventos sem loja. |

> **Regra 1 do CLAUDE.md:** cada migration é aplicada no Supabase só após "ok" explícito do
> usuário. O código/schema/migration são escritos e validados localmente antes disso.
