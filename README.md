# NexoLoja

Sistema de gestão comercial (ERP/PDV) para pequenas e médias empresas, com módulo específico para **lojas de material de construção**. PWA única para desktop, Android e iOS.

- **Arquitetura:** multi-tenant, modular, edge-first — ver [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Decisões técnicas:** [`docs/adr/`](docs/adr/)
- **Progresso:** [`docs/ROADMAP.md`](docs/ROADMAP.md)

| Ambiente | URL |
|---|---|
| Web (produção) | https://nexoloja-web.imortal.workers.dev |
| API (produção) | https://nexoloja-api.imortal.workers.dev |

---

## Stack

Next.js (App Router) · Hono sobre Cloudflare Workers · Prisma + Supabase (PostgreSQL) · Supabase Auth + RLS · Cloudflare Hyperdrive e R2 · Turborepo.

```
apps/web/       PWA Next.js            packages/core/    lógica de negócio pura (Vitest)
apps/api/       API Hono (Workers)     packages/db/      Prisma: schema, migrations, scripts
                                       packages/shared/  tipos + schemas Zod
```

---

## Rodando localmente

### Pré-requisitos

- **Node.js ≥ 20** (recomendado: 24 LTS) — `node -v`
- Acesso ao projeto **Supabase** (peça o convite ao mantenedor)

### Passo a passo

```bash
# 1. Instalar dependências (o postinstall já gera o Prisma Client)
npm install

# 2. Configurar as variáveis de ambiente (ver tabela abaixo)
cp .env.example .env
cp apps/web/.env.local.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
cp apps/api/.dev.vars.example apps/api/.dev.vars

# 3. Subir web + API
npm run dev:all
```

Web em http://localhost:3000 · API em http://localhost:8787

> **Windows (cmd):** use `copy` no lugar de `cp`.

### Variáveis de ambiente

São **três** arquivos, cada um com um propósito. Não existe um `.env` único — o Next e o wrangler leem de lugares diferentes.

| Arquivo | Quem lê | Contém |
|---|---|---|
| `.env` (raiz) | Prisma e scripts de `packages/db` | `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_*` |
| `apps/web/.env.local` | Next.js | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL` |
| `apps/api/.env` | wrangler (emulação local do Hyperdrive) | `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` |
| `apps/api/.dev.vars` | wrangler (bindings/secrets do Worker) | `DATABASE_URL` e secrets opcionais |

Os valores vêm do painel do Supabase (**Project Settings → Database / API**). Todos os arquivos acima estão no `.gitignore`.

⚠️ **Dois detalhes que costumam travar o setup:**

1. A conexão do banco deve usar a **porta 5432** (pooler em modo *sessão*) e incluir **`?sslmode=require`** no `apps/api/.env`. A porta 6543 (modo transação) restringe os *prepared statements* do Prisma.
2. A variável do Hyperdrive **precisa estar em `apps/api/.env`** — o wrangler não a lê do `.dev.vars`.

### Credenciais de acesso

Não há cadastro público: usuários são provisionados. Para criar um usuário na loja demo:

```bash
node packages/db/scripts/create-user.mjs seu@email.com SuaSenha#2026 OWNER loja-demo
```

Papéis válidos: `OWNER`, `MANAGER`, `CASHIER`, `STOCK` (ver [ADR-008](docs/adr/ADR-008-papeis-e-rbac.md)).

> ⚠️ **Não existe banco de desenvolvimento separado.** O ambiente local aponta para o **banco de produção** — vendas, cancelamentos e ajustes de estoque gravam em dados reais. Use a loja `loja-demo` e evite escritas ao explorar.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Só o PWA (porta 3000) |
| `npm run dev:api` | Só a API (porta 8787) |
| `npm run dev:all` | Ambos |
| `npm run test` | Testes unitários (Vitest) |
| `npm run lint` | Lint de todos os workspaces |
| `npm run build` | Build de todos os workspaces |
| `npm run db:generate` | Gera o Prisma Client |
| `npm run db:migrate` | Cria/aplica migration em desenvolvimento |
| `npm run db:deploy` | Aplica migrations pendentes |

Scripts operacionais úteis em `packages/db/scripts/`: `db-size.mjs` (tamanho do banco), `inspect-users.mjs` (somente leitura), `reconcile-stock.mjs` ([ADR-001](docs/adr/ADR-001-consistencia-de-estoque.md)).

---

## Deploy

```bash
cd apps/web && npm run deploy    # OpenNext → Cloudflare Workers
cd apps/api && npx wrangler deploy
```

Requer `wrangler` autenticado. Migrations são aplicadas com `npm run db:deploy`. Checklist de go-live em [`docs/plano-producao.md`](docs/plano-producao.md).

---

## Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| `'turbo' não é reconhecido` | Dependências não instaladas | `npm install` na raiz |
| `Please upgrade your Node.js version` | Node < 20 | Instalar Node 24 LTS |
| Erro em `createClient` (supabase) ao abrir o site | Falta `apps/web/.env.local` | Criar a partir do `.example` e **reiniciar** o dev server |
| `you should use a local Postgres connection string to emulate Hyperdrive` | Falta `apps/api/.env` | Criar a partir do `.example` |
| **"Falha na autenticação"** nas telas (login funciona) | Prisma Client não gerado | `npm run db:generate` |
| Erro de *prepared statement* nas consultas | Conexão na porta 6543 | Usar 5432 + `?sslmode=require` |

> A mensagem "Falha na autenticação" é enganosa: ela vem do `catch` do `requireAuth` (HTTP 500) e indica falha **na consulta ao banco**, não no token. O erro real aparece no terminal da API (`requireAuth: falha ao resolver usuário: ...`).

---

## Convenções

Antes de contribuir, leia [`CLAUDE.md`](CLAUDE.md) — diretrizes de código, banco e segurança. Em resumo:

- Lógica de negócio em `packages/core` como **funções puras**, com testes (obrigatório para caixa, estoque e fluxo de caixa).
- Toda alteração de banco exige **aprovação prévia** e uma migration versionada.
- Multi-tenancy é garantido por **RLS no PostgreSQL**, não apenas na aplicação.
- Decisões arquiteturais significativas viram um **ADR** em `docs/adr/`.
