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

### 2.B — RLS (políticas SQL) — ⏭️ pendente
### 2.C — Convite de funcionários por e-mail — ⏭️ pendente
### 2.D — UI (Next.js) — ⏭️ pendente
