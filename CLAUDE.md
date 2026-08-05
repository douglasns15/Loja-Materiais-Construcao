# Diretrizes do Projeto: NexoLoja (ERP/POS Multiramos)

ERP/PDV **multi-tenant, modular e custo-zero** (PWA única para web/Android/iOS) para pequenas e médias empresas. Core genérico com módulos ativáveis (ex.: "Material de Construção" → milheiros, metragens, frete pesado). Foco: usabilidade ultra-simples, visual profissional e moderno.

> **Contexto completo (leia quando a tarefa exigir):** stack, monorepo, segurança e deploy em `docs/ARCHITECTURE.md`; decisões em `docs/adr/` (índice em `docs/adr/README.md`).

## Stack (resumo)
- **Front:** Next.js (App Router) + TS, hospedado em Cloudflare Workers via **OpenNext** (não Pages). PWA instalável e 100% responsivo.
- **API:** Hono sobre Cloudflare Workers (operações críticas/transacionais).
- **Dados:** Supabase (PostgreSQL) + **RLS**; Prisma = fonte única de schema/migrações. Acesso híbrido: `supabase-js` (RLS) para CRUD trivial, Prisma (API Workers) para transações. Pooling: Hyperdrive → Supavisor.
- **Auth:** Supabase Auth + RLS, com claims `tenant_id` e `role` no JWT.
- **Mídia:** Cloudflare R2 (só URL no banco). Detalhes e limites do free tier: `docs/ARCHITECTURE.md`.

## Padrões de código
- **TypeScript estrito.** Funções puras e componentização atômica.
- **Lógica de negócio** (caixa, estoque, frete) isolada em `packages/core` como funções puras `(entrada) => saída`, sem I/O, reusadas no cliente e servidor.
- **Backend:** sempre try/catch retornando mensagem amigável ao cliente + log detalhado no servidor.
- **UI/UX:** menos cliques, fontes legíveis, suporte a leitor de código de barras (`BarcodeDetector` + fallback `@zxing/library`) e atalhos de teclado no desktop.
- Monorepo: `apps/web` (PWA), `apps/api` (Hono), `packages/db` (Prisma), `packages/core` (lógica pura), `packages/shared` (tipos + Zod).

## Regras obrigatórias (Claude DEVE seguir)
1. **Migrações Prisma:** ANTES de qualquer alteração de schema/banco, explique o impacto e **peça aprovação**.
2. **Testes:** sempre escreva testes Vitest para cálculos de fechamento de caixa, estoque e fluxo de caixa (em `packages/core`).
3. **Não remova** comentários explicativos existentes no código.
4. **Antes de mudança arquitetural** (novo pacote, nova dependência de infra, alteração de fluxo entre camadas, ou qualquer coisa que contrarie uma ADR), consulte `docs/adr/` e confirme.
5. **Estoque:** toda mudança = transação atômica (insert em `StockMovement` + update em `Product.stockQty`). Fonte de verdade = `StockMovement`; `stockQty` é cache. Detalhes: [ADR-001](docs/adr/ADR-001-consistencia-de-estoque.md).
6. **Persistência custo-zero:** nunca BLOB/Base64 no banco (só URL do R2); tipos leves (enum nativo, `VarChar` com limite); sem logs de navegação/cliques no Postgres; auditoria seletiva via `AuditEvent`. Convenções completas: `docs/ARCHITECTURE.md` §7.

## Comandos
```bash
npm install            # dependências
npm run dev            # ambiente de desenvolvimento
npm run test           # testes unitários
npx prisma migrate dev # migrações
```
