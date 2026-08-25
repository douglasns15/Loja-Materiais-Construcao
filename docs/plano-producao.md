# 🚀 Plano de corte para produção — Infra (pooler), Supabase Pro e dependências

> **Pendência 3 do pós-EF-3.** Levantamento e plano — **nada aqui foi aplicado em produção**; é análise
> para decidir *quando* e *como* endurecer a infra ao migrar de dev/demo para uma loja real.
> **Última atualização:** 2026-08-25 — acrescentada a **§4, triagem de vulnerabilidades de
> dependências**.

## TL;DR

- **Nada é urgente.** O que está no ar funciona. Os dois itens da pendência 3 são *headroom* para produção,
  não bugs.
- **Item 3a (pooler 6543):** ⚠️ **a premissa do ROADMAP estava invertida.** A recomendação oficial da
  Cloudflare é usar a **conexão de sessão (5432), NÃO a transação (6543)**, porque o Hyperdrive já é um
  pooler e empilhar pooler-sobre-pooler causa instabilidade. **O projeto já está em modo sessão (5432).**
  Ou seja, migrar para 6543 seria um **retrocesso**. O único ajuste real é o `origin_connection_limit`.
- **Item 3b (Supabase Pro):** o gatilho **não é tamanho** (o banco tem **12 MB de 500 MB**; a 500 MB só se
  chega depois de ~150 mil vendas — anos para uma loja pequena). O gatilho é **confiabilidade**: ir ao ar
  com uma loja real pagante (backups diários, sem auto-pause, e-mail com marca própria).
- **§4 (dependências, 2026-08-25):** das "17 vulnerabilidades" do `npm install`, só **8** afetam o que vai
  a produção e **1** é de fato explorável: o **ReDoS no CORS do Hono**, numa API pública. Resolve-se com
  `npm audit fix` (sem `--force`) + deploy da API. **Nunca rodar `--force`** aqui: ele faria *downgrade*
  do Prisma para 6.12.0.

---

## 1. Estado atual da conexão (verificado em 2026-07-16)

```
Worker (Hono) → adapter pg (Pool) → Cloudflare Hyperdrive → Supabase (Supavisor, sessão)
```

`npx wrangler hyperdrive get 7b728afad9a643f096bfbcdb6d0724ea`:

| Campo | Valor |
|---|---|
| `origin.host` | `aws-1-us-west-2.pooler.supabase.com` |
| `origin.port` | **5432** (Supavisor — **modo sessão**) |
| `origin.user` | `postgres.esxssekaflzewibbklpu` |
| `origin_connection_limit` | **20** |
| `caching.disabled` | `true` (correto p/ ERP — evita lista velha após escrita) |

> ⚠️ **Comentário desatualizado corrigido:** o `apps/api/wrangler.toml` dizia que o Hyperdrive foi criado
> com a `DIRECT_URL`. Na prática a origem é o **host do pooler (Supavisor) em modo sessão**, não o host
> direto (`db.<ref>.supabase.co`). O host direto do Supabase é **IPv6-only** no free tier; o pooler em
> sessão é o endpoint **IPv4** equivalente — por isso é a escolha certa aqui.

## 2. Item 3a — Otimização do pooler

### O que a premissa original supunha
O ROADMAP registrou "otimização do pooler (6543)" imaginando que trocar para a **porta 6543 (transação)**
reduziria o consumo de conexões e caberia melhor no free tier.

### O que a documentação oficial diz
> "When connecting to Supabase from Hyperdrive, you should use the **Direct connection** connection string
> rather than the pooled connection strings. Hyperdrive will perform pooling of connections."
> — Cloudflare Hyperdrive docs (Supabase)

- **Sessão (5432):** conexão dedicada por sessão, suporta todos os recursos do Postgres (incl. *prepared
  statements*, que o Prisma usa). ✅ compatível com o Hyperdrive.
- **Transação (6543):** reusa conexões agressivamente, **restringe recursos de sessão** e exige
  `?pgbouncer=true`. Empilhado sob o Hyperdrive (que já pooleia) → **instabilidade**. ❌

### Conclusão
**Não migrar para 6543.** O projeto já está no modo recomendado (sessão/5432). A pendência 3a, como estava
escrita, é essencialmente um **não-item** — o "afinamento" real do pooler se resume a:

1. **`origin_connection_limit` (hoje 20):** é o nº de backends que o Hyperdrive mantém abertos no Supabase.
   Se algum dia aparecer erro de *"too many connections"*, **baixar** esse número (ex.: 10–15) é o ajuste —
   `npx wrangler hyperdrive update <id> --origin-connection-limit <n>`. Não precisa redeploy do Worker.
2. **Conexão verdadeiramente direta (`db.<ref>.supabase.co:5432`):** só vale a pena **no Pro com add-on de
   IPv4** (ou se o Hyperdrive passar a aceitar origem IPv6). Fora isso, o pooler-sessão atual é o certo.

> **Ação:** nenhuma agora. Reavaliar `origin_connection_limit` **só se** aparecer erro de conexão sob carga.

## 3. Item 3b — Avaliar upgrade para Supabase Pro (~US$ 25/mês)

### Quanto o banco precisaria crescer? (resposta à pergunta)

Medição em 2026-07-16 (`node packages/db/scripts/db-size.mjs`): **banco total = 12 MB de 500 MB**.

E a maior parte desses 12 MB é **overhead do próprio Supabase**, não dado da aplicação:

| Origem | Peso aprox. |
|---|---|
| Schema `auth` do Supabase (`users`, `sessions`, `refresh_tokens`, `identities`, `mfa_*`, `one_time_tokens`) | ~1 MB |
| Mínimo por tabela (~48 kB cada, mesmo vazia) × ~30 tabelas + catálogos/extensões | maior parte |
| **Dado real da aplicação** (products 112 kB, orders 64 kB, stock_movements 72 kB, audit_events 96 kB, cash_sessions 48 kB…) | **< 1,5 MB** |

Hoje há 31 vendas, 60 movimentos de estoque, 50 eventos de auditoria. **O crescimento é dirigido pelas
vendas**: cada venda gera ~1 `Order` + N `OrderItem` + 1 `Payment` + N `StockMovement` (e `AuditEvent` só em
cancelamento/ajuste). Com índices, estime **~2–4 kB por venda**.

**Matemática do teto de 500 MB:**

```
(500 MB − ~10 MB de baseline) ÷ ~3 kB por venda  ≈  160.000 vendas
```

Para uma loja pequena a ~50–100 vendas/dia, isso é **~4 a 9 anos** de operação. **Concluindo: o limite de
500 MB NÃO é o gatilho — está a anos de distância.**

### Então qual é o gatilho real?

O Pro se justifica bem **antes** de qualquer problema de tamanho, por **confiabilidade**:

| Limitação do free tier | Por que dói em produção | Pro resolve |
|---|---|---|
| **Auto-pause após ~7 dias de inatividade** | Loja/ambiente que fica um tempo sem uso "acorda" com cold start. (Loja ativa **todo dia** não pausa — então isto morde mais em **pré-lançamento/demo/staging**.) | ✅ sem auto-pause |
| **Sem backups diários automáticos** | Dado de vendas/caixa de um cliente real **precisa** de backup gerenciado | ✅ backups diários + PITR opcional |
| **Teto de conexões** | Vários caixas/dispositivos simultâneos podem esbarrar no limite (ver 3a) | ✅ teto maior + IPv4 direto |
| **Não edita template de e-mail de auth** | Trava o convite com remetente/branding próprio (Custom SMTP) — já anotado na Fase 2 | ✅ Custom SMTP |
| 500 MB de banco | Só daqui a ~160 mil vendas | ✅ 8 GB (não é o motivo) |

### Recomendação

**Migrar para o Pro quando entrar a primeira loja real pagante** — é uma decisão de *prontidão* (backup +
sem-pause + marca no e-mail), não de volume. Enquanto for dev/demo, o free tier serve. Ao migrar:

- Reavaliar 3a **junto** (o Pro muda o teto de conexões e habilita IPv4 direto → pode mudar a string ideal).
- Habilitar backups e, se quiser e-mail com marca, configurar Custom SMTP (destrava o template do convite).

## 4. Vulnerabilidades de dependências — triagem de 2026-08-25

> Levantada após um `npm install` reportar "17 vulnerabilities". **O número assusta mais do que
> deveria:** o `npm audit` audita a árvore inteira, incluindo ferramenta de build que nunca chega ao
> edge. Com `npm audit --omit=dev` sobram **8** (1 moderate, 7 high) — e destas, **uma** é de fato
> explorável na nossa arquitetura.

### O que realmente vai para produção

Só 11 pacotes de runtime: `next`, `react`, `react-dom`, `@supabase/supabase-js`, `@zxing/library`
(web); `hono`, `jose` (api); `hono` (fiscal); `@prisma/client`, `@prisma/adapter-pg`, `pg` (db);
`zod` (shared). Todo o resto — turbo, wrangler, esbuild, OpenNext, tailwind/postcss, vitest, CLI do
Prisma, sharp — é **build-time**.

### Triagem item a item

| Pacote | Severidade | Aplica-se a nós? | Ação |
|---|---|---|---|
| **hono** ≤4.12.33 | moderate | **SIM — ReDoS no middleware de CORS**, e o `apps/api` usa `cors()` numa API pública. Um `Access-Control-Request-Headers` malicioso queima CPU do Worker. As outras 3 advisories (proxy helper, language middleware, `hono/jsx` memo) **não se aplicam** — não usamos nenhum | **Corrigir — é a mais urgente, apesar de "moderate"** |
| **next** 15.5.19 | high | Baixo. 7 das 8 advisories exigem **Server Actions**, **rewrites** ou **Image Optimization**; verificado no código: zero `'use server'`, zero `next/image`, sem `rewrites`. A PWA fala com a API por `fetch` | Corrigir (é o app público; correção não-breaking) |
| **postcss** 8.5.15 | high | Baixo — processa **nosso** CSS em build. Os ataques exigem CSS malicioso na entrada | Corrigir junto |
| **nanoid** 3.3.15 | high | Baixo — transitivo de build; o loop exige `size` controlado pelo atacante | Corrigir junto |
| **sharp** 0.34.5 | high | Baixo — CVEs do libvips via imagem maliciosa; sem `next/image`, a superfície é mínima | Corrigir junto |
| **deepmerge-ts** (via `@prisma/config` → `prisma`) | high | **Não** — o CLI do Prisma é build-time, nunca vai ao edge; exigiria alguém controlando a config local | **NÃO corrigir — ver abaixo** |

### ⚠️ Por que NÃO corrigir o `deepmerge-ts`

O `npm audit fix --force` propõe instalar **`prisma@6.12.0`** — isto é um **downgrade** a partir do
6.19.3, que deixaria o CLI dessincronizado do `@prisma/client` 6.19.3. Soma-se a isso a decisão já
registrada no ROADMAP de manter o **Prisma 6 fixado** por estabilidade de conexão pela edge.

**Regra:** nunca rodar `npm audit fix --force` neste repositório. Ele sobe/baixa versões major e pode
quebrar o deploy (Prisma, wrangler, Next, OpenNext).

### Procedimento

```bash
npm audit fix          # SEM --force — resolve 7 dos 8, sem mudança de major
npm run test           # 320 testes (core + fiscal)
npm run build
cd apps/api && npx wrangler deploy --dry-run
```

> **Deploy da API é obrigatório** para a correção do CORS do Hono valer — atualizar o lock não basta,
> o middleware vive no Worker em execução.

### Encaminhamento

Correção pontual não é a resposta sustentável. O que resolve de verdade é **`npm audit` no CI +
Dependabot**, para novos avisos aparecerem como sinal monitorado em vez de susto num `npm install`.
Entra junto com o item de CI do bloco de confiabilidade
([`PRODUCT-ROADMAP.md`](PRODUCT-ROADMAP.md) — Horizonte 0, bloco B).

---

## 5. Checklist de corte para produção (para o dia do go-live)

- [ ] Assinar Supabase Pro (sem auto-pause + backups diários).
- [ ] Confirmar/ajustar `origin_connection_limit` do Hyperdrive sob carga real.
- [ ] (Opcional) Avaliar conexão direta IPv4 vs. manter pooler-sessão.
- [ ] Custom SMTP + template PT-BR do convite (branding) — destrava a melhoria de e-mail da Fase 2.
- [ ] Rever CORS da API para a origem de produção da PWA (não só `localhost`).
- [ ] Corrigir o comentário do `apps/api/wrangler.toml` se a origem do Hyperdrive mudar.
- [ ] Rodar `npm audit fix` (sem `--force`) e **deployar a API** — corrige o ReDoS do CORS (§4).
- [ ] Testar a **restauração** de um backup (backup não testado não é backup).

---

## Fontes

- [Supabase · Cloudflare Hyperdrive docs](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/)
- [Supavisor and Connection Terminology Explained · Supabase](https://supabase.com/docs/guides/troubleshooting/supavisor-and-connection-terminology-explained-9pr_ZO)
- [Supabase · Cloudflare Workers docs](https://developers.cloudflare.com/workers/databases/third-party-integrations/supabase/)
