# ADR-005: Stack Tecnológica e Arquitetura Geral

**Status:** Aceito
**Data:** 2026-06-21
**Deciders:** Alexandre Papassoni (Owner do produto)

> Este ADR consolida a decisão de arquitetura do NexoLoja e **substitui parcialmente** o que estava descrito no `CLAUDE.md` (ver seção "Divergências"). O detalhamento completo (diagramas, estrutura de pastas, roadmap) está em [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md).

## Contexto

O NexoLoja é um ERP/PDV multi-tenant e modular para PMEs, com módulo específico de Material de Construção. Precisa ser acessível por **navegador, Android e iOS** com uma única base de código, ter **custo próximo de zero** no início e caminhar para **operação offline** no caixa.

Forças em jogo:

- **Um único cliente por enquanto:** uma PWA atende web + Android + iOS, eliminando a necessidade de apps nativos (React Native/Flutter) nesta fase.
- **Custo-zero:** preferência por planos gratuitos (Supabase, Cloudflare).
- **Multi-tenancy estrito:** uma loja nunca pode ver dados de outra.
- **Usabilidade:** poucos cliques, leitor de código de barras, atalhos de teclado no desktop.
- **Mudanças recentes no ecossistema (validadas em jun/2026):**
  - O deploy de Next.js no **Cloudflare Pages foi descontinuado** em favor de **Cloudflare Workers + adaptador OpenNext** (caminho oficial recomendado pela própria equipe do Next.js).
  - **Prisma** roda em Workers via *driver adapters* (`@prisma/adapter-pg`) com **Cloudflare Hyperdrive** para pooling — agora disponível no plano gratuito.
  - O free tier do **Supabase pausa o projeto após ~1 semana de inatividade** e tem limite de 500 MB — risco operacional relevante para um PDV em produção.

## Decisão

Adotar uma arquitetura **monorepo, edge-first**, com:

- **PWA única** em **Next.js (App Router) + TypeScript**, instalável em desktop/Android/iOS, com Tailwind + shadcn/ui.
- **Backend unificado** em **Hono sobre Cloudflare Workers** para operações com lógica de negócio/segredos/transações.
- **Acesso a dados híbrido:** `supabase-js` direto do cliente (protegido por **RLS**) para leituras e escritas simples; **Prisma** na API Workers para operações transacionais críticas (fechamento de caixa, movimentação de estoque, confirmação de pedidos, auditoria, URLs assinadas do R2).
- **Banco:** Supabase PostgreSQL; **Prisma como fonte única de schema e migrações**; pooling via Hyperdrive → Supavisor.
- **Autenticação:** **Supabase Auth + Row-Level Security** com claim de `tenant_id` e `role` no JWT (decisão do owner — substitui o bcrypt+JWT próprio do CLAUDE.md).
- **Mídia:** Cloudflare R2 (apenas URLs no banco, nunca BLOB).
- **Offline:** **online-first no MVP** (PWA instalável + cache de leitura); sincronização offline-first completa (IndexedDB + fila + resolução de conflitos via `syncStatus`) numa fase posterior, já prevista no schema.
- **Lógica de negócio pura** (cálculos de estoque, caixa, frete, conversão de unidades) em pacote compartilhado, testada com Vitest e reusada por cliente e servidor.

## Opções Consideradas

### Backend

#### Opção A: API dedicada em Hono sobre Cloudflare Workers — **escolhida**

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Média |
| Custo | Baixo (free tier) |
| Escalabilidade | Alta (edge, global) |
| "API unificada" (CLAUDE.md) | Alta — camada explícita reusável por futuros clientes |

**Prós:** separação limpa; pronta para futuros clientes nativos; Hono é minúsculo e ótimo em Workers; segredos e transações no servidor.
**Contras:** mais um artefato de deploy que Route Handlers colocados no Next.

#### Opção B: API dentro do Next.js (Route Handlers / Server Actions)

**Prós:** um único deploy; menos peças.
**Contras:** acopla a "API unificada" ao app de frontend; menos natural para clientes externos; mistura responsabilidades.

> Mitigação adotada: como muito CRUD vai direto via `supabase-js`+RLS, a API Hono fica **fina** — só o que precisa de servidor. Reduz a desvantagem da Opção A.

### Autenticação

#### Opção A: Supabase Auth + RLS — **escolhida**

| Dimensão | Avaliação |
|----------|-----------|
| Esforço | Baixo |
| Segurança | Alta — não reinventa auth; isolamento no banco via RLS |
| Custo | Gratuito (até 50k MAU) |
| Aderência ao CLAUDE.md | Diverge (exige atualizar o doc) |

**Prós:** isolamento multi-tenant garantido no nível do banco (RLS), o ponto mais forte possível; menos código de segurança para manter; cookies/sessão SSR prontos.
**Contras:** dependência de um serviço gerenciado; claims de tenant exigem um *auth hook*.

#### Opção B: JWT + bcrypt próprio (como no CLAUDE.md)

**Prós:** controle total, sem dependência externa de auth.
**Contras:** maior superfície de risco ("não role sua própria auth"); mais código; isolamento dependeria só da aplicação, não do banco.

### Acesso a dados em runtime

- **Escolhido:** híbrido `supabase-js` (RLS) para o trivial + **Prisma** (Workers) para o transacional. Prisma permanece como fonte de schema/migrações.
- **Alternativas:** só Prisma (mais código de API, perde real-time/RLS direto) ou só `supabase-js` (perde transações ricas e type-safety de migração).

## Análise de Trade-offs

O eixo central é **simplicidade/custo vs. controle**. As escolhas privilegiam **alavancar plataforma gerenciada** (Supabase Auth + RLS, supabase-js) para o que é commodity e **manter código próprio** (Hono + Prisma) só onde há valor de negócio e necessidade de transação/segredo. Isso minimiza superfície de segurança, mantém custo-zero e acelera o MVP. O preço é a dependência do Supabase (mitigada por Prisma manter o schema portável e por RLS ser padrão Postgres) e o risco do free tier pausar (mitigado por keep-alive e plano de upgrade no lançamento). A opção online-first evita, no MVP, a alta complexidade de sincronização com resolução de conflitos, sem fechar a porta para ela (o schema já tem `syncStatus`).

## Divergências em relação ao `CLAUDE.md`

1. **Hospedagem:** "Cloudflare Pages" → **Cloudflare Workers + OpenNext** (Pages para Next.js foi descontinuado).
2. **Autenticação:** "bcrypt + JWT/HttpOnly próprio" → **Supabase Auth + RLS** (decisão do owner).
3. **Acesso a dados:** Prisma deixa de ser o único caminho; passa a coexistir com `supabase-js`+RLS, mantendo-se como fonte de schema/migrações.

> O `CLAUDE.md` deve ser atualizado para refletir estes pontos (ação pendente, fora do escopo deste documento).

## Consequências

- **Fica mais fácil:** atingir paridade web/mobile com uma base; isolamento multi-tenant forte (RLS); custo baixo; MVP rápido.
- **Fica mais difícil:** operar dois deploys (web + api); gerenciar claims de tenant no Auth; conviver com limites do free tier do Supabase.
- **Revisar no futuro:** migrar para Supabase Pro (~US$25/mês) ao entrar em produção (resolve pausa/limites); avaliar cliente nativo se a PWA não bastar (ex: impressão fiscal/integrações de hardware); introduzir offline-first (fase 2).

## Action Items

1. [ ] Atualizar o `CLAUDE.md` com as divergências acima.
2. [ ] Validar limites diários de Hyperdrive no free tier para o volume esperado.
3. [ ] Definir o *auth hook* do Supabase que injeta `tenant_id`/`role` no JWT.
4. [ ] Aprovar `docs/ARCHITECTURE.md` e seguir para o scaffold do monorepo (fase 0).

---

## Adendo (2026-08-25): Resiliência ao **cold start** do free tier

O risco previsto na "Análise de Trade-offs" (*"risco do free tier pausar (mitigado por keep-alive…)"*) materializou-se em produção: sob uso real, com pausas entre uma ação e outra, o caminho de dados (**Worker → Hyperdrive → Supavisor → Supabase**) esfria e a **primeira consulta depois de ocioso** estoura (reset/timeout de conexão). A stack devolve um erro que, sem tratamento, aparecia ao operador como **mensagens enganosas** — nunca como "cold start":

- **"Falha na autenticação."** ao confirmar venda — na verdade a consulta do usuário no middleware `requireAuth` lançou e retornou **500** (o JWT já havia sido verificado com sucesso; não é token inválido).
- **"Caixa recuperado do cache offline — dados de HH:MM"** no PDV — o `GET /cash-sessions/current` devolveu 500 e a tela caiu no *fallback* de cache offline (ADR-012 CS-1), parecendo estar sem internet sem estar.
- **"Failed to fetch"** (falha de rede do `fetch`) e **500 "Transaction not found"** (a transação da venda passando do *timeout* padrão de 5 s do Prisma com o pool frio).

Todas são **a mesma causa** com superfícies diferentes. A resposta tem **duas camadas** — *remediar* e *atacar a causa* — nenhuma delas altera o schema, a lógica de negócio ou o contrato de rotas:

### 1. Remediação (o soluço não chega ao operador)

- **Mensagem amigável + retry idempotente** (`apps/web/lib/api.ts`): falha de **rede/timeout** vira uma mensagem clara e os métodos **idempotentes** (GET/PATCH/DELETE) re-tentam com *backoff*. `POST` (venda) fica **fora do retry** de propósito (não idempotente — re-tentar duplicaria a venda). *(fix "Failed to fetch", commit `42081ca`.)*
- **Retry de 5xx transitório** (`apps/web/lib/api.ts` + `apps/api/src/lib/dbRetry.ts`): o retry passou a reagir também a **500/502/503/504** — um cold start que volta como 5xx (e não como queda de rede) antes escapava. No servidor, `withDbRetry()` re-tenta a **leitura** do usuário/admin nos middlewares de auth (`requireAuth`/`requirePlatformAuth`/`requireSupportSession`). Como o 500 do auth acontece **antes de qualquer escrita**, cobri-lo no servidor é seguro mesmo para o `POST /orders`. *(commit `3a57892`.)*
- **Timeout de transação folgado** (`packages/db/src/index.ts`): `transactionOptions { maxWait: 10_000, timeout: 20_000 }` — cobre a venda (várias escritas em série) quando o pool está frio, sem alterar lógica (`cpuTime` real ~200 ms). *(fix "Transaction not found", commit `44b3f45`.)*

### 2. Ataque à causa (o pool não esfria)

- **Keep-alive do pool via cron** (`apps/api/src/index.ts` handler `scheduled` + `apps/api/wrangler.toml` `[triggers]`): de 5 em 5 minutos o Worker faz um `SELECT 1` via Hyperdrive, mantendo uma conexão de origem **quente**. Assim o keep-alive absorve o cold start no lugar da venda. É uma invocação **separada** do `fetch` (não bloqueia nem concorre por conexão); `runKeepAlive` **nunca lança** para fora. 288 execuções/dia — desprezível no free tier — e, de bônus, mantém o projeto Supabase ativo, evitando o auto-pause de longa inatividade. *(commit `66b8a07`.)*

### Observabilidade

`apps/api/wrangler.toml` `[observability] enabled=true` retém logs/exceções do Worker (~3 dias no free tier), permitindo investigar um incidente transitório **depois** que acontece (antes, `wrangler tail` só mostrava eventos ao vivo). Foi o que permitiu diagnosticar o "Transaction not found".

> **Limite honesto:** o retry é rede de proteção e o keep-alive **reduz a frequência** do cold start, mas nenhum dos dois o **elimina** — a solução definitiva continua sendo o **Supabase Pro** (sem auto-pause, pool mais estável) no lançamento, já previsto em "Consequências → Revisar no futuro".

## Adendo (2026-08-27): teto de **CPU do Worker** (free) + salvaguarda do Prisma Client no deploy

Sob uso real, o operador voltou a ver "não foi possível conectar" / "caixa recuperado do cache offline" **no meio do expediente** (internet OK) e venda/estoque "caindo do nada". Desta vez **não era cold start nem o banco** (o keep-alive estava saudável, cron `*/5` `Ok`). Os logs do Worker mostraram **"Worker exceeded CPU time limit"** e **"code had hung"**.

### 1. Causa: `GET /products` estourava o teto de 10 ms de CPU do plano grátis

O **plano grátis** de Cloudflare Workers limita **10 ms de CPU por requisição** (o pago sobe para 30 s; ~US$5/mês). O `GET /products` (catálogo do PDV, chamado a cada abertura de PDV/Estoque/Produtos, **sem teto de linhas**) fazia `prisma.product.findMany()`, e o adapter do Prisma constrói **um objeto `Decimal.js` por coluna numérica (~11) por produto**. Num catálogo grande isso passa dos 10 ms → a Cloudflare mata a requisição. Como o Worker é **single-thread por isolate**, as requisições vizinhas leves (`/tenant`, `/quotes`, `/cash-sessions/current`) ficam **famintas** e são canceladas como "hung" → as mensagens enganosas de "offline"/"sem conexão" na tela (`/tenant` e `/quotes` eram **vítimas**, não a causa). Novo porque o catálogo cresceu e a esteira do Relatórios v2 elevou a concorrência.

**Correção** (`apps/api/src/routes/products.ts`, `GET /`): troca de `findMany` por **`$queryRaw SELECT *`** — mesmo padrão já em produção no `GET /products/search`. O Postgres devolve os numéricos como **string** (formato que o cliente já espera — os tipos são `string` — e normaliza via `Number()`), **sem construir `Decimal`**. `SELECT *` de propósito: mantém **todos os campos** (PDV/Estoque/Produtos consomem conjuntos diferentes); o ganho vem de **evitar o Decimal**, não de cortar colunas. Sem schema/migração/`core`/`shared`; contrato de rota inalterado (§8.2 intocada). *(API Version `0e315f13`.)*

### 2. Salvaguarda de deploy: Prisma Client **sempre fresco**

O 1º deploy desta correção **quebrou a venda em produção**: `PrismaClientValidationError: Unknown argument \`unitCost\``. Causa = o **Prisma Client gerado no `node_modules` local estava stale** — os TIPOS (`index.d.ts`) tinham `OrderItem.unitCost` (ADR-027/migration 0032), mas o RUNTIME que o Worker usa para validar (a cópia embutida `.prisma/client/schema.prisma` + `wasm.js`) fora gerado ANTES da Fatia 2. Por isso `tsc`/build (tipos) passam e a falha só aparece **em runtime**, no `create` do pedido — e o `wrangler deploy` empacota o client do `node_modules` local. Recuperação: `wrangler rollback` (restaura a venda em segundos) → `prisma generate` → redeploy → venda de teste validando `POST /orders` no `wrangler tail`.

**Salvaguarda permanente:** `apps/api/package.json` ganhou `"predeploy": "npx prisma generate --schema ../../packages/db/prisma/schema.prisma"`, então **todo `npm run deploy` regenera o Client fresco do schema atual antes de subir** — nunca mais fica stale. NÃO é upgrade de versão (segue **6.19.3**; a v7 continua evitada — ver adiante). Regra de deploy da API: `prisma generate` (agora automático) → conferir → build → deploy → **validar o caminho de ESCRITA (`POST /orders`)**, não só telas de leitura → rollback pronto se a escrita falhar.

> **Nota sobre versão:** este incidente **não** teria sido evitado por atualizar o Prisma — o custo de CPU vinha do **uso** (`findMany`/`Decimal.js`), não da versão. A v7 segue evitada de propósito (rodava SQL sem criar migrations + problema de conexão pela edge); subir para v7 exige revalidação isolada de edge + migrations.

## Adendo (2026-09-04): auto-recuperação do fallback offline na **camada da tela**

Sob uso real, o operador relatou o PDV **preso** em "Caixa recuperado do cache offline — dados de HH:MM" por **~7 minutos**, ~3×/dia. Causa: a leitura do caixa (`GET /cash-sessions/current`) roda **uma única vez no mount** (`useEffect(… , [])`). Se um soluço transitório do free tier (cold start / teto de CPU do Worker) fizer essa leitura falhar mesmo depois da janela de retry do `apiGet` (~7 s), a tela cai no *fallback* de cache offline (CS-1) e **fica lá** — as camadas de baixo (keep-alive + retry do ADR-005) recuperam a API em segundos, mas **nada na tela re-tenta**, então o soluço de segundos virava uma parada de minutos até o operador **recarregar à mão**.

**Correção (web-only, `apps/web/app/(app)/venda/page.tsx` e `.../caixa/page.tsx`):** enquanto a tela está no *fallback* offline (`cachedSessionAt`/`cachedSession != null`), um efeito re-tenta a rede **sozinho** — a cada **15 s** e **imediatamente** ao evento `online` (navegador reconecta) ou `visibilitychange` (aba volta a ficar visível). No **primeiro sucesso**, o estado troca para o dado fresco, o banner some e o efeito se desliga. Um *ref* de "em andamento" evita tentativas sobrepostas (cada `apiGet` já traz ~7 s de retry). O banner ganhou o texto "reconectando automaticamente…" + botão **"Tentar reconectar agora"** (agência ao operador). Sem schema/migração/`core`/`shared`/contrato de rota.

**Generalização para o app inteiro (hook `apps/web/lib/useReloadOnReconnect.ts`):** o mesmo self-heal foi extraído num hook e aplicado a **todas as telas de dados** (estoque, produtos, clientes, fornecedores, categorias, vendas, orçamentos, contas-a-receber, entregas, relatórios). Antes elas carregavam uma vez no mount e, num soluço, ficavam com o **erro na cara** até o operador recarregar. O hook re-tenta a carga sozinho (15 s + `online` + `visibilitychange`) **enquanto a carga estiver falha** — sinalizada por um `loadFailed` DEDICADO por tela, **separado** do `error` de validação/ação (senão o hook re-dispararia a carga por baixo de um erro que não é de rede). venda/caixa mantêm o self-heal próprio (o *fallback* deles é o cache de caixa, não um erro de carga).

> **Onde isto se encaixa:** o keep-alive **reduz a frequência** do soluço; o retry do `apiGet` **absorve** o soluço curto; esta auto-recuperação é a **rede de segurança que faltava na camada da tela** para o soluço que escapa dos dois não virar uma parada de minutos. Continua **não eliminando** o soluço na origem — ver a causa raiz abaixo.

### Investigação da causa raiz (2026-09-04): a **rajada de concorrência** abre conexões demais

O soluço acontecia **no meio do expediente, internet OK, ~3×/dia** — não era ocioso. A investigação achou o amplificador estrutural: **cada request abria 2 conexões ao banco**, porque `createPrismaClient` (`packages/db/src/index.ts`) instanciava um `pg.Pool` **novo** a cada chamada, e ele é chamado **uma vez no `requireAuth`** (leitura do usuário) **e de novo dentro de cada handler**. Abrir o PDV dispara ~5-6 requests em paralelo (`/me`, `/alerts`, `/tenant`, `/cash-sessions/current`, `/products`, carrinho) → **~10-12 conexões abrindo de uma vez**. O keep-alive mantém só **UMA** conexão quente, então a rajada abre conexões **frias** que estouram a janela de retry → **500** no `/cash-sessions/current` → o *fallback* "offline". O sino de Alertas (`AlertsChip`) piorava: re-disparava `/alerts` (4 queries) **a cada foco da janela** — no balcão, a cada alt-tab.

**Correção em três frentes** (nenhuma altera schema/migração/`core`/contrato de rota; muda o **fluxo entre camadas** de como o client é obtido — aprovado pelo Owner, regra 4):

- **(A) Uma conexão por request** + **(B) reuso entre requests do isolate**: `createPrismaClient` passou a **cachear o `PrismaClient` por connection string** (`Map` vivo pelo isolate). Como todos os call sites usam a mesma connection string (Hyperdrive), `requireAuth` e o handler passam a **compartilhar** a instância (2 → 1 por request) e requests seguintes do mesmo isolate **reusam** (quase zera o churn de pools). Seguro: nenhum código faz `$disconnect()`/`pool.end()` por request (os pools de hoje já vivem até o isolate morrer — só que sem reuso), o `pg.Pool` se auto-cura de conexões mortas e o `withDbRetry` cobre o transitório. Lazy (criado dentro da request, nunca no escopo de módulo) — o padrão aceito no Workers.
- **(C) Throttle do sino** (`apps/web/.../AlertsChip.tsx`): o refetch de `/alerts` por **foco** da janela só dispara se passou **≥60 s** do último — corta a rajada repetida a cada alt-tab.

> **Validação da parte (B):** o reuso de conexão **entre requests** do isolate é o único ponto que depende do comportamento da edge (Workers + Hyperdrive + `pg`). Deve ser validado no deploy com um **E2E que force concorrência**: abrir o PDV (rajada) **e** concluir uma **venda real** (`POST /orders`, transação interativa) — se a venda e as leituras concorrentes passarem, o reuso está OK. **Rollback trivial** se a edge reclamar de I/O cross-request: remover o cache de `createPrismaClient` (volta a criar por chamada) mantém as partes (A-via-contexto não aplicada aqui) e (C) intactas em espírito — na prática, reverter só o `Map`.

> **Limite honesto:** (A)+(B)+(C) **reduzem drasticamente** o churn e a frequência da rajada, mas o teto de conexões do free tier continua lá — a solução definitiva segue sendo **Supabase Pro** (sem auto-pause, pool estável) + Workers **pago** (CPU 30 s vs. 10 ms) no lançamento.
