# ADR-008 — Papéis de usuário e controle de acesso (RBAC) dentro da loja

- **Status:** Aceito
- **Data:** 2026-07-01
- **Contexto de fase:** Fase 2 — item que fecha a fase (gestão de usuários da loja)

> ⚠️ **Implica alteração de schema (migration).** Pela regra 1 do `CLAUDE.md`, nada é
> aplicado ao banco antes de aprovação explícita do impacto. Este ADR fixa a decisão de
> modelo; a migration é um passo posterior e separado.

## Contexto

Hoje o papel do usuário existe no schema (`enum UserRole { OWNER, MANAGER, CASHIER, STOCK }`)
e é injetado no JWT pelo Access Token Hook (`user_role`), mas **não é verificado em lugar
nenhum**: qualquer usuário autenticado de uma loja opera com **acesso total** via API. Ou
seja, temos *papéis*, mas **não temos RBAC** (enforcement por papel).

O usuário do produto pediu um modelo mais simples de papéis **dentro da loja**:

- **Admin** — acesso total à loja (configurações, cadastros, relatórios, gestão de usuários).
- **Usuário** — operação do dia a dia (PDV/venda, caixa, estoque), sem administração.

O papel de **Super Usuário** (fabricante — a equipe do NexoLoja), que enxerga/gerencia
**todas as lojas**, é uma preocupação de **plataforma** (cruza o limite do tenant/RLS) e
**não** entra neste ADR — fica no [ADR-009](./ADR-009-multi-loja-e-super-admin.md).

## Decisão

### 1. Modelo de papéis por loja (dois níveis)

Adotar dois papéis efetivos dentro da loja: **ADMIN** e **USER**. Como já existe o enum
`UserRole` com quatro valores e dados gravados (`owner@lojademo.com` é `OWNER`), a opção de
menor atrito é **mapear em vez de recriar**:

- `OWNER` e `MANAGER` → tratados como **Admin** (acesso administrativo).
- `CASHIER` e `STOCK` → tratados como **Usuário** (operação).

A camada de autorização trabalha com o conceito **Admin vs Usuário** derivado do
`UserRole`, evitando uma migration destrutiva agora. Se, no futuro, a granularidade de
quatro papéis não for usada, um ADR posterior pode **reduzir** o enum (migration dedicada).

**Decisão fechada (aprovada pelo usuário em 2026-07-01): SEM migration.** Mantemos os 4
valores do enum e derivamos Admin/Usuário na aplicação, com a seguinte **convenção de
escrita** (o que é gravado em `User.role` ao definir o papel pela tela):

| Papel no produto | `UserRole` gravado | Observação |
|---|---|---|
| **Admin** | `MANAGER` | administradores adicionais |
| **Admin (dono)** | `OWNER` | criador da loja (bootstrap) — único, não rebaixável pela tela |
| **Usuário** | `CASHIER` | operação padrão |
| (`STOCK`) | — | lido como "Usuário"; não é oferecido no seletor |

Leitura (`role → conceito`): `OWNER` e `MANAGER` ⇒ **Admin**; `CASHIER` e `STOCK` ⇒ **Usuário**.
O mapa vive numa **função pura única** em `packages/shared` (`roles.ts`), reusada na API
(enforcement) e no front (UX). O `OWNER` é preservado: a tela não altera o papel de um
`OWNER` nem permite o usuário mudar o próprio papel/estado.

### 2. RBAC de verdade (enforcement)

- **API (fonte de verdade):** middleware de autorização por papel, reusando o `user_role`
  já presente no JWT (sem consulta extra ao banco). Ações administrativas — gestão de
  usuários, editar dados/logo da loja, e (a definir) alteração de preço/ajuste de estoque —
  exigem **Admin**. Operação (venda, caixa, movimentação) é liberada para **Usuário**.
- **Front (UX):** esconder/oportunizar telas e botões conforme o papel (não é segurança —
  a segurança é a checagem da API), lendo o papel da sessão.
- O enforcement é **aditivo e testável**: uma função pura de mapeamento
  `role → permissões` em `packages/shared` (ou `packages/core`), reusada nos dois lados.

### 3. Gestão de usuários na tela de Configurações

- Nova seção em `/configuracoes` (só para Admin): **listar** usuários da loja, **convidar**
  por e-mail (`inviteUserByEmail` do Supabase Auth — item já previsto na Fase 2), **definir
  papel** (Admin/Usuário) e **ativar/desativar** (`User.isActive`, sem apagar — coerente com
  a auditoria/soft-delete do ADR-004).
- **Auditoria (ADR-004):** *mudança de papel de usuário* já está na lista fechada de eventos
  críticos → registrar `AuditEvent` (`action: "CHANGE_ROLE"`, `entity: "User"`) na troca de papel.

### Entrega em fatias

1. **Fatia 1 (esta):** função de mapeamento em `packages/shared`; `requireAdmin` na API;
   `GET /me` (papel para o front); `/users` (listar + definir papel + ativar/desativar,
   com auditoria); gate de `/configuracoes` e do item de menu. **Não** precisa de segredo
   novo nem migration — opera sobre a tabela `users` existente via Prisma.
2. **Fatia 2 (seguinte):** **convite por e-mail** (`inviteUserByEmail`) — cria o usuário no
   Supabase Auth e a linha em `users`. Exige a **`SUPABASE_SERVICE_ROLE_KEY` como secret do
   Worker** (`wrangler secret put`), decisão sensível a ser provisionada pelo usuário, mais
   um deploy. Até lá, novos usuários continuam nascendo pelo script de bootstrap.

## Consequências

- **Positivas:** fecha a Fase 2 com segurança real por papel; reaproveita o `user_role` do
  JWT (custo-zero, sem query extra); sem migration destrutiva (mapeamento na aplicação);
  aproveita a tela `/configuracoes` recém-criada.
- **Negativas / limites:** manter 4 valores de enum mapeados para 2 conceitos pode confundir
  — mitigado documentando o mapa e centralizando-o numa função pura. O convite por e-mail
  depende do Supabase Auth (`inviteUserByEmail`) e de configuração de e-mail.
- **Fora de escopo:** qualquer acesso **cross-tenant** (Super Usuário/fabricante) — ver
  ADR-009.

## Relacionadas

- **ADR-004** — Auditoria seletiva (mudança de papel é evento crítico).
- **ADR-005** — Auth via Supabase + RLS; claims de `tenant_id`/`user_role` no JWT.
- **ADR-009** — Multi-loja e Super Usuário (plataforma) — o nível acima deste.
- **CLAUDE.md** — Regra 1 (aprovar migrations) e multi-tenancy estrito.
