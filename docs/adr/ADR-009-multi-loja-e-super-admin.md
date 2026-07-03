# ADR-009 — Multi-loja, onboarding e Super Usuário (plataforma)

- **Status:** Aceito (2026-07-02) · **Implementado — Fatias A–D concluídas (2026-07-03)**; execução em `docs/plano-fase-2.5.md`
- **Data:** 2026-07-01 (proposto) · 2026-07-02 (aceito)
- **Contexto de fase:** Fase nova dedicada — "Plataforma / Administração" (após a Fase 2)

> ⚠️ **Implica alteração de schema (migration) e mexe no modelo de segurança (RLS).**
> Pela regra 1 do `CLAUDE.md`, nada é aplicado ao banco antes de aprovação explícita.
> Este ADR fixa a direção; cada mudança de banco/segurança é um passo posterior e revisado.

## Contexto

O sistema **é multi-tenant por arquitetura** (ADR-003/005): várias lojas (`Tenant`)
coexistem isoladas por RLS. Mas faltam duas capacidades de **plataforma**, que **cruzam o
limite do tenant** e por isso não pertencem ao MVP de uma loja:

1. **Onboarding de loja** — hoje uma loja nova só nasce por **script de bootstrap
   (invite-only)**. Não há tela/fluxo para criar uma loja e seu primeiro Admin.
2. **Super Usuário (fabricante)** — a equipe do NexoLoja precisa de um papel **acima de
   qualquer loja**, capaz de enxergar/administrar **todas** as lojas (suporte, provisão,
   diagnóstico). Isso é fundamentalmente diferente do papel `Admin` **dentro** de uma loja
   (ver [ADR-008](./ADR-008-papeis-e-rbac.md)): exige acesso **cross-tenant controlado**.

Misturar isso na Fase 2 emperraria o fechamento do MVP e aumentaria o risco de brecha de
isolamento — a razão de ser um ADR e uma fase separados.

## Decisão

### 1. Super Usuário vive FORA do `UserRole` por-tenant

O `UserRole` (ADR-008) descreve o papel **dentro de uma loja** e não deve ganhar um valor
"super admin" — um super usuário não "pertence" a uma loja. Opções consideradas:

- **A) Flag/tabela de plataforma** — uma tabela `PlatformAdmin` (ou claim `is_platform_admin`
  no JWT) que marca contas da equipe do fabricante, independente de `tenant_id`. **Preferida.**
- **B) Tenant "sistema" especial** — modelar o fabricante como um tenant privilegiado.
  Rejeitada: sobrecarrega o conceito de `Tenant` e confunde o RLS.

**Adotar a opção A**: identidade de plataforma explícita e separada do vínculo com loja.

### 2. Acesso cross-tenant controlado (não enfraquecer o RLS)

O RLS por `tenant_id` (ADR-005) **permanece a fronteira**. O acesso do Super Usuário a
várias lojas é feito de forma **explícita e auditável**, não relaxando as políticas gerais:

- Preferir **rotas de plataforma dedicadas** na API (Worker, papel dono do banco) que
  recebem o `tenantId` alvo por parâmetro e **exigem** claim de plataforma — em vez de criar
  policies RLS que abram dados de todos os tenants ao papel `authenticated`.
- Toda ação de plataforma que toque dados de uma loja gera **auditoria** (quem, qual loja,
  o quê). Reavaliar a lista fechada do ADR-004 para incluir eventos de plataforma.

### 3. Onboarding de loja (provisão do primeiro Admin)

- Fluxo para **criar loja** (`Tenant`) + **primeiro usuário Admin** (ADR-008), substituindo
  o script de bootstrap por uma operação de produto. A criar depois de decidido o gatilho:
  **self-service** (signup público) **vs.** **provisionado pelo Super Usuário** (a equipe
  cria a loja e convida o Admin). **Recomendação inicial:** provisionado pelo Super Usuário
  (menos superfície de abuso; combina com o público de PMEs atendido diretamente).
- **Unicidade de `Tenant.cnpj`** (já `@unique` no schema) passa a ter uso real: bloqueia
  criar uma segunda loja com o mesmo CNPJ (a API já retorna **409** nesse caso — hoje o
  caminho não é alcançável por não haver criação de loja pela UI).

### 4. Painel de gestão de lojas

- Área exclusiva de Super Usuário para **listar lojas**, ver estado (ativa/inativa,
  `Tenant.isActive`), e entrar no contexto de uma loja para suporte. **Nunca** exposta a
  Admin/Usuário de loja.
- **Entregue (Fatia C):** UI `/plataforma` (listar/criar/ativar-inativar lojas).
  **Entrar no contexto de uma loja para suporte** é a maior superfície de risco e fica
  como **Fatia E** (impersonation auditada) — ver "Status de implementação".

## Consequências

- **Positivas:** habilita o modelo de negócio multi-loja sem enfraquecer o isolamento;
  separa claramente "papel de loja" (ADR-008) de "papel de plataforma"; onboarding deixa de
  depender de script manual.
- **Negativas / riscos:** acesso cross-tenant é a maior superfície de risco do sistema —
  exige rotas dedicadas, checagem estrita do claim de plataforma e auditoria; signup
  self-service (se escolhido) abre vetor de abuso e precisaria de verificação.
- **Dependências:** assenta sobre o RBAC do ADR-008 (papéis de loja) já existente.

## Decisões resolvidas (2026-07-02)

As três decisões em aberto foram resolvidas com o usuário e fixam a execução
(ver `docs/plano-fase-2.5.md`):

- **Onboarding: provisionado pelo Super Usuário.** Sem signup público — a equipe cria a loja e
  convida o primeiro Admin (`OWNER`).
- **Identidade de plataforma: tabela `platform_admins` (verdade) + claim `is_platform_admin` no
  JWT (atalho de UI).** A autorização no servidor confia **na tabela** (middleware
  `requirePlatformAuth`); o claim (injetado estendendo o access token hook da 0002) serve só para
  o front rotear/mostrar o painel.
- **Acesso cross-tenant: rotas `/platform/*` dedicadas** (API como dono do banco). O RLS das
  tabelas de loja **não muda**.

## Status de implementação (Fase 2.5)

Executado em fatias (ver `docs/plano-fase-2.5.md` e `docs/testes/registro-de-testes.md`):

- **Fatia A — identidade + acesso cross-tenant:** ✅ migration `0005_platform_admin`, `requirePlatformAuth`, rotas `/platform/me` e `/platform/tenants`, claim `is_platform_admin` no hook, script `create-platform-admin.mjs`.
- **Fatia B — onboarding:** ✅ `POST /platform/tenants` cria loja + convida 1º Admin (`OWNER`); `AuditEvent CREATE_TENANT`.
- **Fatia C — painel de gestão de lojas:** ✅ UI `/plataforma` (listar/criar/ativar-inativar); `PATCH /platform/tenants/:id` + `AuditEvent SET_TENANT_ACTIVE`; login roteia por papel.
- **Fatia D — auditoria de plataforma:** ✅ `CREATE_TENANT` e `SET_TENANT_ACTIVE` **formalizados na lista fechada do [ADR-004](./ADR-004-soft-delete-e-auditoria.md)** (`meta.platform = true`). Sem migration.

### Fatia E (futura) — entrar no contexto da loja para suporte (impersonation auditada)

Maior superfície de risco do sistema; fica como fatia própria. Direção pretendida (a detalhar num plano quando priorizada):

- **Sessão de suporte explícita e temporária, não um login "como" o dono.** O Super Usuário abre uma sessão de suporte sobre uma loja-alvo pelo painel; a API emite um **token de suporte de curta duração** com escopo `{ platformAdminId, targetTenantId, exp }` — **não** um JWT de usuário da loja. Nada de logar com a senha do lojista nem reaproveitar o `requireAuth` de loja.
- **Autorização continua na plataforma.** As rotas de loja usadas em modo suporte passam por um middleware que aceita **ou** um usuário da loja (`requireAuth`) **ou** um super usuário com sessão de suporte válida para *aquele* `tenantId` — a fronteira nunca é o RLS relaxado, é a checagem explícita (como já é em `/platform/*`).
- **Somente-leitura por padrão; escrita é exceção auditada.** O suporte enxerga a loja; qualquer ação de escrita exige um passo a mais e gera auditoria por operação.
- **Tudo auditado com `meta.support = true`.** Abrir e encerrar a sessão de suporte gera `AuditEvent` (novos `action`s, ex. `SUPPORT_SESSION_START`/`SUPPORT_SESSION_END`, `tenantId` = loja-alvo, `userId` = super usuário) e cada escrita feita em modo suporte carrega `meta.support = true` + o `platformAdminId`, para separar no relato "foi o lojista" de "foi o suporte".
- **Visível para o lojista.** Idealmente a loja vê um aviso/registro de que houve acesso de suporte (transparência), e a sessão tem expiração curta.
- **Migration provável:** nenhuma para o mecanismo de token; apenas os novos `action`s de auditoria (strings, sem migration). Um `tenantId` nullable em `AuditEvent` só seria necessário se quisermos auditar suporte "sem loja" — não é o caso aqui.

## Relacionadas

- **ADR-003 / ADR-005** — Multi-tenancy e RLS (a fronteira que este ADR respeita).
- **ADR-004** — Auditoria seletiva (estender para eventos de plataforma).
- **ADR-008** — Papéis e RBAC dentro da loja (o nível abaixo deste).
- **CLAUDE.md** — Regra 1 (aprovar migrations) e multi-tenancy estrito no banco.
