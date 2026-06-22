# Diretrizes do Projeto: NexoLoja (ERP/POS Multiramos)

## Visão Geral do Sistema
- **Objetivo:** Sistema de gestão comercial completo, ultra-simples quando a usabilidade e profissional, design moderno, para pequenas e médias empresas.
- **Arquitetura:** Multi-tenant, modular e edge-first. O core é genérico, com módulos específicos ativáveis (ex: módulo "Material de Construção" ativa controle de milheiros, metragens, frete/entrega pesada).
- **Plataformas:** PWA única acessível por navegador (Desktop), Android e iOS - uma base de código para todas as plataformas.

## Stack Tecnológica e Infraestrutura (Foco: Custo-Zero & Offline-First)

> **IMPORTANTE:** Consulte `docs/ARCHITECTURE.md` e `docs/adr/ADR-005-stack-e-arquitetura.md` para detalhes completos da arquitetura.

- **Banco de Dados Central:** Supabase (PostgreSQL) - Plano Gratuito.
  - ⚠️ **Limitação conhecida:** Free tier pausa após ~1 semana de inatividade e limita 500 MB. Planejar upgrade para Pro (~US$25/mês) em produção.
- **Armazenamento de Mídia:** Cloudflare R2 (10GB gratuitos para fotos de produtos, evitando inflar o banco de dados).
- **Backend / APIs:** Hono sobre Cloudflare Workers (TypeScript) - API unificada para operações críticas (transações, segredos, lógica de negócio).
- **Frontend (PWA):** Next.js (App Router) + TypeScript hospedado em **Cloudflare Workers via OpenNext** (não Pages - foi descontinuado).
  - *Nota:* O sistema deve ser 100% responsivo, com design adaptável e focado em computadores, tablets e celulares.
  - *Nota:* Configurado como PWA (Progressive Web App) instalável pelo navegador (PC, Tablet e Celular).
  - *Nota:* **MVP é online-first** com cache de leitura. Offline-first completo (IndexedDB + fila de sincronização) será implementado na Fase 3.
- **Autenticação:** Supabase Auth + Row-Level Security (RLS) com claims de `tenant_id` e `role` no JWT.
- **ORM/Schema:** Prisma como fonte única de schema e migrações. Acesso híbrido: `supabase-js` direto do cliente (protegido por RLS) para CRUD simples + Prisma na API Workers para transações.
- **Pooling:** Cloudflare Hyperdrive → Supavisor (pooler do Supabase).

## Padrões de Código e Arquitetura

> **IMPORTANTE:** Consulte `docs/ARCHITECTURE.md` para estrutura completa do monorepo e decisões arquiteturais.

- **Monorepo:** Turborepo + npm workspaces com estrutura:
  - `apps/web/` - PWA Next.js
  - `apps/api/` - API Hono (Cloudflare Workers)
  - `packages/db/` - Prisma (schema, client, migrações)
  - `packages/core/` - Lógica de negócio PURA (sem I/O) - funções testáveis para cálculos de caixa, estoque, frete
  - `packages/shared/` - Tipos e schemas Zod compartilhados
- **Estilo:** TypeScript estrito. Prefira funções puras e componentização atômica.
- **Lógica de Negócio:** Isolada em `packages/core` como funções puras `(entrada) => saída`, testadas com Vitest e reusadas no cliente e servidor.
- **Tratamento de Erros:** Sempre use blocos try/catch no backend retornando mensagens amigáveis para o cliente e logs detalhados no servidor.
- **Interface (UI/UX):** Foco absoluto em usabilidade. Menos cliques, fontes legíveis, suporte a leitores de código de barras (`BarcodeDetector` API + fallback `@zxing/library`) e comandos rápidos de teclado no desktop.
- **Segurança:** Multi-tenancy estrito garantido no banco via RLS (Row-Level Security). Isolamento no nível do PostgreSQL, não apenas na aplicação.

## Comandos Úteis do Projeto
- Instalar dependências: `npm install`
- Rodar ambiente de desenvolvimento: `npm run dev`
- Executar testes unitários: `npm run test`
- Rodar migrações do banco: `npx prisma migrate dev`

## Regras de Interação com o Claude
1. **ANTES** de escrever qualquer código que altere o banco de dados (migrações Prisma), explique o impacto e peça aprovação.
2. **Sempre** escreva testes unitários (Vitest) para funções de cálculo de fechamento de caixa, estoque e fluxo de caixa (em `packages/core`).
3. Não remova comentários explicativos existentes no código.
4. Consulte as ADRs em `docs/adr/` antes de fazer mudanças arquiteturais significativas.

## Diretrizes de Otimização de Banco de Dados (Foco em Cost-Zero)
- **Imagens:** Proibido salvar arquivos binários (BLOB/Base64) no banco. Salve apenas a URL gerada pelo Cloudflare R2.
- **Tipos de Dados:** Use os tipos mais leves possíveis (ex: enums nativos do PostgreSQL em vez de `Text`, `VarChar` com limite estrito).
- **Logs e Auditoria:** 
  - **NÃO** salvar logs de cliques ou histórico de navegação no PostgreSQL.
  - **Auditoria seletiva** (ADR-004): apenas eventos críticos são registrados na tabela `AuditEvent`:
    - Cancelamento de venda
    - Alteração de preço de produto
    - Ajuste manual de estoque
    - Fechamento de caixa com divergência
    - Mudança de papel de usuário
  - `StockMovement` já funciona como auditoria natural do estoque.

## Decisões Arquiteturais Importantes (ADRs)

> **Consulte `docs/adr/` para detalhes completos de cada decisão.**

### ADR-001: Consistência de Estoque
- `Product.stockQty` é um **cache desnormalizado** para leitura rápida (custo-zero).
- `StockMovement` é a **fonte de verdade auditável**.
- **Regra:** Toda mudança de estoque DEVE ser feita em transação atômica (insert em `StockMovement` + update em `Product.stockQty`).
- Existe rotina de reconciliação para corrigir divergências: `stockQty = Σ INCOME − Σ EXPENSE`.

### ADR-002: Status de Entrega
- `Delivery.status` usa enum `DeliveryStatus` (não Int) para type-safety e consistência com o resto do schema.

### ADR-003: Multi-tenancy em Payment
- `Payment` possui `tenantId` denormalizado para isolamento robusto e RLS direto.
- Não possui `syncStatus` próprio - sincroniza atomicamente com o `Order` pai.

### ADR-004: Soft-Delete e Auditoria Seletiva
- Entidades de cadastro (`Product`, `Customer`, `Supplier`, `Category`) possuem `deletedAt` para soft-delete.
- Auditoria seletiva via tabela `AuditEvent` - apenas eventos críticos (ver lista acima).

### ADR-005: Stack e Arquitetura
- PWA única (Next.js) para web/mobile.
- API dedicada (Hono sobre Workers) separada do frontend.
- Supabase Auth + RLS para autenticação e isolamento multi-tenant.
- Acesso híbrido: `supabase-js` (RLS) para trivial + Prisma (Workers) para transacional.
- MVP online-first; offline-first completo na Fase 3.

