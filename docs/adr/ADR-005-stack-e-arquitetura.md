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
