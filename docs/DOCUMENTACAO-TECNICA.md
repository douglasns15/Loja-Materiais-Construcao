# NexoLoja — Documentação Técnica

> **Documento vivo · consolidado.** Reúne, em um só lugar, a visão técnica completa do projeto:
> tecnologias, linguagens, banco, hospedagem, APIs, segurança, modelo de dados, glossário de siglas
> e diagramas de arquitetura.
>
> **Produto:** ERP/PDV multi-tenant, modular e custo-zero (PWA única para Web/Android/iOS).
> **Última atualização:** 2026-08-20 · **Fontes:** `docs/ARCHITECTURE.md`, `docs/adr/` (ADR-001…025), código do monorepo.

---

## Índice

1. [Visão geral em 30 segundos](#1-visão-geral-em-30-segundos)
2. [Glossário de siglas e termos](#2-glossário-de-siglas-e-termos)
3. [Stack tecnológica completa](#3-stack-tecnológica-completa)
4. [Linguagens e por que cada uma](#4-linguagens-e-por-que-cada-uma)
5. [Arquitetura — diagramas C4](#5-arquitetura--diagramas-c4)
6. [Fluxo de uma requisição (dois caminhos)](#6-fluxo-de-uma-requisição-dois-caminhos)
7. [Estrutura do monorepo](#7-estrutura-do-monorepo)
8. [Backend — API Hono](#8-backend--api-hono)
9. [Frontend — PWA Next.js](#9-frontend--pwa-nextjs)
10. [Banco de dados e modelo](#10-banco-de-dados-e-modelo)
11. [Segurança e multi-tenancy](#11-segurança-e-multi-tenancy)
12. [Hospedagem e deploy](#12-hospedagem-e-deploy)
13. [Estratégia offline](#13-estratégia-offline)
14. [Qualidade, testes e CI/CD](#14-qualidade-testes-e-cicd)
15. [Decisões de arquitetura (ADRs)](#15-decisões-de-arquitetura-adrs)
16. [Ambiente de desenvolvimento](#16-ambiente-de-desenvolvimento)

---

## 1. Visão geral em 30 segundos

NexoLoja é um **ERP/PDV** (gestão + ponto de venda) para pequenas e médias lojas, com foco inicial em
**material de construção**. Roda como **uma única PWA** (Progressive Web App) que se instala no desktop,
Android e iOS a partir do mesmo código. A arquitetura é **edge-first**: o código executa perto do usuário
na rede da Cloudflare, e o banco é um PostgreSQL gerenciado pelo Supabase com isolamento por loja garantido
**no próprio banco** (RLS). Tudo foi desenhado para operar dentro dos **planos gratuitos** (custo-zero) no
início e escalar sem retrabalho.

| Dimensão | Escolha |
|---|---|
| Padrão de app | PWA instalável (uma base → Web + Android + iOS) |
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript |
| Backend | Hono sobre Cloudflare Workers |
| Banco | Supabase PostgreSQL + Row-Level Security |
| ORM | Prisma 6 (fonte única de schema e migrações) |
| Auth | Supabase Auth (JWT com claims `tenant_id` e `role`) |
| Hospedagem | Cloudflare Workers (web + API) via OpenNext e Wrangler |
| Mídia | Cloudflare R2 (só a URL no banco) |
| Monorepo | Turborepo + npm workspaces |

---

## 2. Glossário de siglas e termos

Referência rápida — cada sigla que aparece na documentação e no código.

### Produto / negócio

| Sigla / termo | Significado | O que é no NexoLoja |
|---|---|---|
| **ERP** | *Enterprise Resource Planning* | Sistema de gestão da empresa (estoque, financeiro, clientes, fornecedores). |
| **PDV / POS** | Ponto de Venda / *Point of Sale* | Tela de venda no balcão: carrinho, pagamentos, caixa. |
| **Multi-tenant** | Multi-inquilino | Uma instalação atende várias lojas (*tenants*) isoladas entre si. |
| **Tenant** | Inquilino | Cada loja é um tenant, identificada por `tenant_id` (UUID). |
| **Fiado** | Venda a prazo | Cliente leva agora e paga depois → vira *conta a receber*. |
| **Sangria / Suprimento** | — | Retirada / reforço de dinheiro no caixa (movimentações que não são venda). |
| **Milheiro / Saco / m² / m³** | — | Unidades do ramo de construção (venda por milheiro de tijolo, saco de cimento, metragem). |
| **RBAC** | *Role-Based Access Control* | Autorização por papel: `OWNER`, `MANAGER`, `CASHIER`, `STOCK`. |
| **EAN / GTIN** | *European Article Number* / *Global Trade Item Number* | Código de barras global do produto (usado no catálogo — ADR-025). |
| **NFC-e / NF-e** | Nota Fiscal (Consumidor) eletrônica | Emissão fiscal — planejada para fase futura via API de terceiros. |

### Técnicas / infraestrutura

| Sigla / termo | Significado | Papel no projeto |
|---|---|---|
| **PWA** | *Progressive Web App* | App web instalável, com service worker e ícone na tela inicial. |
| **SPA / SSR** | *Single-Page App* / *Server-Side Rendering* | Next.js faz render no servidor (edge) + hidratação no cliente. |
| **RLS** | *Row-Level Security* | Regras no PostgreSQL que filtram linhas por `tenant_id` — o pilar do isolamento. |
| **JWT** | *JSON Web Token* | Token assinado da sessão; carrega as *claims* `tenant_id` e `role`. |
| **Claim** | Afirmação | Campo dentro do JWT (ex.: qual tenant, qual papel). |
| **ORM** | *Object-Relational Mapping* | Prisma: mapeia tabelas ↔ tipos TypeScript e versiona migrações. |
| **CRUD** | *Create, Read, Update, Delete* | Operações básicas de dados. |
| **Edge** | Borda da rede | Servidores Cloudflare distribuídos globalmente, perto do usuário. |
| **Worker** | — | Unidade de execução serverless da Cloudflare (roda a web e a API). |
| **R2** | Object storage da Cloudflare | Guarda imagens/mídia; o banco guarda só a URL. |
| **Hyperdrive** | — | Pooler/acelerador de conexões da Cloudflare para o Postgres. |
| **Supavisor** | — | Pooler de conexões do lado do Supabase. |
| **UUID** | *Universally Unique Identifier* | ID gerado no cliente (habilita offline sem colisão). |
| **CORS** | *Cross-Origin Resource Sharing* | Regra que autoriza o web a chamar a API em outra origem. |
| **CI/CD** | *Continuous Integration / Continuous Delivery* | Pipeline automático de lint, testes, migrações e deploy. |
| **ADR** | *Architecture Decision Record* | Documento curto que registra uma decisão técnica e o porquê. |
| **C4** | Modelo de diagramas (*Context, Container, Component, Code*) | Padrão usado para os diagramas de arquitetura deste doc. |
| **HMR** | *Hot Module Replacement* | Recarga instantânea em desenvolvimento. |

---

## 3. Stack tecnológica completa

Cada camada, a tecnologia escolhida e a justificativa. (Versões conforme os `package.json` do monorepo.)

| Camada | Tecnologia | Versão | Por quê |
|---|---|---|---|
| **App / Frontend** | Next.js (App Router) | `^15.1.3` | SSR no edge, ecossistema maduro, vira PWA. |
| **UI runtime** | React + React DOM | `^19.0.0` | Base de componentes; concurrent features. |
| **PWA / Offline shell** | Service Worker + Web App Manifest | — | Instalável; cache de assets e leituras. |
| **UI / estilo** | Tailwind CSS | `^3.4.17` | Utilitário, rápido e consistente. |
| **Leitor de código de barras** | `BarcodeDetector` API + `@zxing/library` | `^0.21.3` | Nativo do navegador quando disponível, com fallback. |
| **Backend / API** | Hono | `^4.6.14` | Framework minúsculo, ótimo no edge (Workers). |
| **JWT no backend** | `jose` | `^5.9.6` | Verificação/decodificação de JWT sem dependências pesadas. |
| **ORM / schema** | Prisma + `@prisma/client` | `^6.19.3` | Type-safety e migrações versionadas. |
| **Driver / adapter** | `@prisma/adapter-pg` + `pg` | `6.19.3` / `^8.13.1` | Conexão Postgres compatível com Workers. |
| **Acesso trivial (cliente)** | `@supabase/supabase-js` | `^2.45.4` | CRUD direto sob RLS, menos código. |
| **Banco** | Supabase PostgreSQL | — | Postgres gerenciado, plano gratuito. |
| **Pooling** | Cloudflare Hyperdrive → Supavisor | — | Conexões eficientes a partir de Workers. |
| **Autenticação** | Supabase Auth + RLS | — | JWT com claims de tenant/role; isolamento no banco. |
| **Mídia** | Cloudflare R2 | — | Object storage; só a URL vai ao banco. |
| **Validação de dados** | Zod | `^3.24.1` | Schemas compartilhados (tipos + validação em runtime). |
| **Testes unitários** | Vitest | `^2.1.8` | Cobre os cálculos puros de `packages/core`. |
| **Testes e2e** | Playwright | — | Fluxos ponta-a-ponta (planejado/faseado). |
| **Monorepo / build** | Turborepo + npm workspaces | `^2.3.3` | Build incremental e código compartilhado. |
| **Runtime de deploy** | Cloudflare Workers | — | Web (via OpenNext) e API (via Wrangler). |
| **Adaptador web→Workers** | `@opennextjs/cloudflare` | `^1.20.1` | Roda Next.js em Workers (não em Pages). |
| **CLI de deploy** | Wrangler | `^4.107.0` | Publica os Workers e gera tipos. |
| **Linguagem** | TypeScript | `^5.7.2` | Estrito, ponta a ponta (front, back, core, schemas). |
| **Runtime local** | Node.js | `>= 20` (rec. 24 LTS) | Ambiente de desenvolvimento e scripts. |

---

## 4. Linguagens e por que cada uma

O projeto é **TypeScript-first, ponta a ponta** — uma linguagem só, do banco à tela.

- **TypeScript** — 100% do código de aplicação: frontend (`apps/web`), backend (`apps/api`), lógica de
  negócio pura (`packages/core`), schema/tipos (`packages/db`, `packages/shared`). Modo estrito.
- **SQL (PostgreSQL)** — expresso majoritariamente via Prisma; SQL direto nas **policies RLS** e em
  scripts operacionais (`packages/db/scripts/`).
- **Prisma Schema Language (PSL)** — DSL declarativa em `packages/db/prisma/schema.prisma`, fonte única
  do modelo de dados e das migrações.
- **CSS (via Tailwind)** — utilitário; `globals.css` + `tailwind.config.ts`.
- **JavaScript (`.mjs`)** — apenas em scripts utilitários/deploy (`scripts/*.mjs`) e arquivos de config.

**Por que uma linguagem só?** A lógica de caixa/estoque/frete vive em `packages/core` como funções puras
`(entrada) => saída` e é **reusada tanto no cliente** (cálculo otimista, resposta instantânea) **quanto no
servidor** (cálculo autoritativo). Isso só é barato porque cliente e servidor falam TypeScript.

### 4.1 Linguagem × Runtime × Framework × Biblioteca

Quatro conceitos que costumam ser confundidos. Entendê-los evita afirmações imprecisas do tipo
*"o backend está em Node"* ou *"TypeScript é uma biblioteca do Node"* — **ambas erradas**.

| Conceito | O que é | Análogia | No NexoLoja |
|---|---|---|---|
| **Linguagem** | O idioma em que o código é escrito | O idioma que você fala | **TypeScript** (front, back, core, schemas) |
| **Runtime** | *Onde* o código executa de fato | O lugar onde o idioma é falado | **Cloudflare Workers** (backend e web); navegador (front); Node só como ferramenta local |
| **Framework** | Estrutura que organiza o código e "dá as rédeas" do fluxo | O esqueleto do prédio | **Hono** (API), **Next.js** (web) |
| **Biblioteca** | Código pronto que *você* chama quando precisa | Ferramenta na caixa | `jose`, `zod`, `@zxing/library`, `supabase-js` |

**Relações que valem gravar:**

- **TypeScript não é biblioteca nem pertence ao Node.** É uma **linguagem** (superset de JavaScript,
  criada pela Microsoft). Ela sempre é **compilada para JavaScript** antes de rodar — nenhum runtime
  executa TypeScript diretamente.

  ```
  código TypeScript ──(compilador tsc)──► JavaScript ──► roda no runtime (Workers, navegador, Node…)
  ```

- **Node.js é um runtime, não a linguagem.** É *um* lugar onde JavaScript roda — não o único. Aqui o
  backend **não roda em Node**: roda em **Cloudflare Workers** (motor V8/`workerd`, com APIs web-padrão
  como `fetch`/`crypto`, sem `fs`/`net` do Node). Node aparece só como **ferramenta local** de
  build/testes/scripts (`npm`, `turbo`, `vitest`, `wrangler dev`).

- **Framework × Biblioteca:** o framework chama o *seu* código (inversão de controle — o Hono decide
  quando sua rota roda); a biblioteca é o *seu* código que chama ela (você decide quando usar o `zod`).

> **Frase correta para o backend:** "escrito em **TypeScript** (linguagem), estruturado com **Hono**
> (framework), executando em **Cloudflare Workers** (runtime)". Não é Node, e TypeScript não é biblioteca.

---

## 5. Arquitetura — diagramas C4

### 5.1 Contexto (C4 nível 1) — quem usa e com o que conversa

```mermaid
flowchart TD
    User["👤 Operador da loja<br/>(caixa, gerente, dono, estoquista)"]
    Admin["👤 Admin da plataforma<br/>(super-usuário)"]

    subgraph NexoLoja["NexoLoja — ERP/PDV (PWA)"]
        Sys["Sistema NexoLoja"]
    end

    Supabase["☁️ Supabase<br/>(PostgreSQL + Auth)"]
    Cloudflare["☁️ Cloudflare<br/>(Workers + R2 + Hyperdrive)"]
    Fiscal["🧾 API Fiscal de terceiros<br/>(NFC-e/NF-e — fase futura)"]

    User -->|usa no navegador/celular| Sys
    Admin -->|onboarding de lojas| Sys
    Sys -->|dados + login| Supabase
    Sys -->|hospedagem + mídia| Cloudflare
    Sys -.->|emissão fiscal| Fiscal
```

### 5.2 Containers (C4 nível 2) — as peças que executam

```mermaid
flowchart TD
    subgraph Cliente["Dispositivos — Desktop / Android / iOS"]
        PWA["PWA Next.js<br/>(instalável, service worker)"]
    end

    subgraph CF["Cloudflare (edge)"]
        WEB["Next.js em Workers<br/>(OpenNext)"]
        API["API Hono<br/>(Workers)"]
        HYP["Hyperdrive<br/>(pooling)"]
        R2["R2<br/>(imagens)"]
    end

    subgraph SB["Supabase"]
        AUTH["Supabase Auth<br/>(JWT + claims tenant/role)"]
        DB[("PostgreSQL<br/>+ RLS")]
    end

    PWA -->|HTML/JS| WEB
    PWA -->|"CRUD simples (RLS)"| DB
    PWA -->|"login / sessão"| AUTH
    PWA -->|"operações críticas"| API
    PWA -->|"upload via URL assinada"| R2
    API -->|"Prisma (transações)"| HYP --> DB
    API -->|"gera URL assinada"| R2
    AUTH -.->|"emite JWT"| PWA
    DB -.->|"valida JWT nas policies"| AUTH
```

**Leitura:** o cliente fala **direto com o banco** (via `supabase-js`) para o que é trivial — protegido
por RLS — e só recorre à **API Hono** quando há transação, segredo ou regra de negócio que precisa rodar
no servidor: fechamento de caixa, movimentação de estoque, confirmação de pedido, auditoria, geração de
URL assinada do R2.

### 5.3 Componentes internos (C4 nível 3) — o monorepo

```mermaid
flowchart LR
    subgraph apps["apps/"]
        web["web<br/>PWA Next.js"]
        api["api<br/>Hono / Workers"]
    end
    subgraph packages["packages/"]
        core["core<br/>lógica pura: caixa,<br/>estoque, frete, unidades"]
        db["db<br/>Prisma: schema,<br/>client, migrações"]
        shared["shared<br/>tipos + Zod"]
    end

    web --> shared
    web --> core
    api --> core
    api --> db
    api --> shared
    db --> shared
```

> `packages/core` **não importa I/O** (banco, rede). São funções puras testadas com Vitest e reusadas
> no cliente e no servidor — o coração testável do sistema.

---

## 6. Fluxo de uma requisição (dois caminhos)

O sistema tem **dois caminhos de dados deliberados**. A regra: leitura/CRUD trivial vai direto ao banco;
qualquer coisa transacional ou com regra de negócio passa pela API.

```mermaid
sequenceDiagram
    autonumber
    participant U as PWA (cliente)
    participant A as Supabase Auth
    participant DB as PostgreSQL (RLS)
    participant API as API Hono (Workers)
    participant HD as Hyperdrive

    Note over U,A: Login (uma vez por sessão)
    U->>A: e-mail + senha
    A-->>U: JWT (claims: tenant_id, role)

    Note over U,DB: Caminho 1 — leitura trivial (ex.: listar produtos)
    U->>DB: supabase-js (SELECT) + JWT
    DB->>DB: policy RLS: tenant_id = jwt.tenant_id
    DB-->>U: só as linhas do tenant

    Note over U,API: Caminho 2 — operação crítica (ex.: confirmar venda)
    U->>API: POST /orders + JWT
    API->>API: middleware valida JWT, extrai tenant/role
    API->>HD: transação Prisma (Order + StockMovement + Payment)
    HD->>DB: executa atômico
    DB-->>API: ok
    API-->>U: mensagem amigável + dados
```

**Princípios que o fluxo garante:**
- O cliente **nunca** informa o próprio `tenant_id` numa operação crítica — a API o extrai do JWT.
- Estoque só muda em **transação atômica** (`StockMovement` + `Product.stockQty`) — ver ADR-001.
- Segredos (service-role, chaves R2) ficam **só nos Workers**, nunca no cliente.

---

## 7. Estrutura do monorepo

```
nexoloja/
├── apps/
│   ├── web/                  # PWA Next.js (App Router)
│   │   ├── app/              # rotas: (app), login, definir-senha, plataforma, offline
│   │   ├── components/       # componentes de UI
│   │   ├── lib/              # supabase client, query client, helpers
│   │   ├── public/           # ícones, service worker
│   │   ├── open-next.config.ts
│   │   └── wrangler.jsonc    # config do Worker web
│   └── api/                  # API Hono (Cloudflare Workers)
│       └── src/
│           ├── routes/       # 19 grupos, ~80 endpoints (orders, cashSessions, stock, nfe, catalog…)
│           ├── middleware/   # auth (valida JWT), tenant, erros
│           └── lib/          # helpers de servidor
├── packages/
│   ├── db/                   # Prisma: schema, client, migrações, scripts
│   │   └── prisma/schema.prisma
│   ├── core/                 # lógica de negócio PURA (Vitest) — sem I/O
│   │   └── src/              # cálculos: barra/metro, forma de pagamento, unidades…
│   └── shared/               # tipos + schemas Zod compartilhados
├── docs/
│   ├── ARCHITECTURE.md       # arquitetura de referência
│   ├── DOCUMENTACAO-TECNICA.md  # ESTE documento
│   ├── ROADMAP.md            # execução
│   └── adr/                  # ADR-001 … ADR-025
├── turbo.json                # pipeline Turborepo
└── package.json              # npm workspaces
```

**Regra de ouro:** `packages/core` é puro. Nada de banco/rede lá dentro — só matemática de negócio,
testável exaustivamente e compartilhada entre as duas apps.

---

## 8. Backend — API Hono

- **Framework:** [Hono](https://hono.dev) `^4.6.14`, otimizado para Cloudflare Workers.
- **Autenticação:** middleware valida o JWT (via `jose`), extrai `tenant_id`/`role` e injeta o contexto
  em toda operação Prisma. **Nunca** confia em `tenantId` vindo do corpo da requisição.
- **Acesso a dados:** Prisma 6 com `@prisma/adapter-pg`, através do Hyperdrive (pooling).
- **Padrão de erro:** sempre `try/catch` → mensagem amigável ao cliente + log detalhado no servidor.
- **CORS:** libera as origens do web (dev + produção).

### 8.1 Autenticação e escopo (vale para todos os endpoints)

- **Base:** `https://nexoloja-api.imortal.workers.dev`. Todas as rotas de negócio ficam sob um grupo montado (ex.: `/orders`, `/cash-sessions`).
- **Token:** `Authorization: Bearer <JWT>` do Supabase Auth. O middleware valida (via `jose`), extrai `tenant_id`/`role` das claims e injeta no contexto. **Nunca** se confia em `tenantId` vindo do corpo.
- **Guardas especiais:**
  - `requireActiveTenant` — bloqueia escrita em loja inativa/suspensa (ADR-009). Marcado com 🔒 abaixo.
  - `/catalog/*` usa o header `x-tenant-id` (leitura cross-tenant do catálogo global, ADR-025), não a claim.
  - `/platform/*` exige **PlatformAdmin** (super-usuário da plataforma), não papel de loja.
  - `/support/*` exige um **token de suporte** com escopo de uma loja específica; o `:tenantId` da URL precisa bater com o escopo do token (senão 403). Acesso **somente-leitura** (ADR-009, Fatia E).
- **Erro:** sempre `{ ok: false, error: '<mensagem amigável>' }` + log detalhado no servidor.

### 8.2 Referência de endpoints

> Fonte de verdade = `apps/api/src/routes/`. **Ao criar/alterar qualquer rota, atualize esta tabela** (ver a nota de manutenção no fim da seção). 🔒 = exige loja ativa (`requireActiveTenant`).

**Utilitárias (`index.ts`, sem auth de loja)**

| Método · Rota | O que faz |
|---|---|
| `GET /health` | Liveness do Worker. |
| `GET /db-check` | Sanidade da conexão com o banco. |
| `GET /public/logo/:tenantId` | Redireciona para o logo público da loja no R2. |

**`/orders` — Vendas (PDV)**

| Método · Rota | O que faz |
|---|---|
| `GET /` | Lista vendas (paginação por cursor + filtro de período). Busca no Histórico (`?scope=all`, ignora o período): `number` (código V-000128), `customer` (nome do cliente — só casa vendas com cliente vinculado) e `value` (total exato). As linhas incluem o nome do cliente quando há. |
| `POST /` 🔒 | Confirma a venda: transação `Order` + `OrderItem` + `Payment` + `StockMovement` (ADR-001). |
| `POST /:id/cancel` 🔒 | Cancela venda do caixa aberto (estorna estoque; sai do faturamento). |
| `POST /:id/return` 🔒 | Devolução **total**: marca `RETURNED`, estorna estoque, saída no caixa. Exige caixa aberto. |
| `POST /:id/return-items` 🔒 | Devolução **parcial** por item; excedente vira crédito na loja ou dinheiro no caixa (ADR-022). |

**`/cash-sessions` — Caixa (compartilhado por loja, ADR-018)**

| Método · Rota | O que faz |
|---|---|
| `GET /current` | Caixa aberto da loja (ou nenhum). |
| `POST /open` 🔒 | Abre o caixa (fundo inicial). |
| `POST /close` 🔒 | Fecha o caixa: conferência, contador de cédulas, mini-DRE. |
| `GET /movements` | Extrato do caixa (vendas + sangrias/suprimentos). |
| `POST /movement` 🔒 | Registra sangria/suprimento. |
| `POST /movement/:id/reverse` 🔒 | Estorna uma movimentação. |

**`/stock` — Estoque (transação atômica, ADR-001)**

| Método · Rota | O que faz |
|---|---|
| `GET /movements` | Histórico de movimentações (livro-razão). |
| `GET /summary` | Resumo/posição de estoque. |
| `POST /movements` 🔒 | Entrada/saída manual (`StockMovement` + `stockQty`). |
| `POST /adjust` 🔒 | Ajuste/inventário (acerta o saldo com auditoria). |

**`/products` e `/categories` — Catálogo local**

| Método · Rota | O que faz |
|---|---|
| `GET /products` · `GET /products/search` | Lista e busca de produtos (nome, SKU, `popularName`, EAN). |
| `GET /products/:id` | Detalhe do produto. |
| `POST /products` 🔒 · `PATCH /products/:id` 🔒 · `DELETE /products/:id` 🔒 | Cria / edita / remove (soft-delete). |
| `GET /categories` · `GET /categories/:id` | Lista e detalhe de categorias. |
| `POST /categories` 🔒 · `PATCH /categories/:id` 🔒 · `DELETE /categories/:id` 🔒 | CRUD de categorias. |

**`/catalog` — Catálogo global por EAN (ADR-025)**

| Método · Rota | O que faz |
|---|---|
| `GET /ean/:ean` | Resolve um EAN: acha produto existente da loja e/ou enriquece nome/marca do catálogo global. |

**`/nfe` — Importação de XML de NF-e (ADR-025, Fatia 2)**

| Método · Rota | O que faz |
|---|---|
| `POST /entry` 🔒 | Confirma o De-Para item-a-item → gera Entrada de estoque; cada linha em sua própria transação. |
| `GET /imported` | Lista itens já importados de uma nota (por `chNFe`) — idempotência. |

**`/customers` e `/suppliers` — Pessoas**

| Método · Rota | O que faz |
|---|---|
| `GET /customers` · `GET /customers/:id` | Lista (busca no servidor) e detalhe. |
| `GET /customers/:id/history` | Histórico de compras/fiado do cliente. |
| `POST /customers` 🔒 · `PATCH /customers/:id` 🔒 · `DELETE /customers/:id` 🔒 | CRUD de clientes. |
| `GET /suppliers` · `GET /suppliers/:id` | Lista e detalhe de fornecedores. |
| `POST /suppliers` 🔒 · `PATCH /suppliers/:id` 🔒 · `DELETE /suppliers/:id` 🔒 | CRUD de fornecedores. |

**`/receivables` — Fiado / contas a receber (ADR-019, ADR-022, ADR-026)**

| Método · Rota | O que faz |
|---|---|
| `GET /` | Lista dívidas (contas a receber). |
| `GET /accounts` | Saldo devedor **consolidado por cliente** (1 linha por pessoa) — aba **Em aberto**. Cada linha inclui `debtId`/`debtNumber` da dívida ABERTA do cliente (ADR-026, código `D-000X`). |
| `GET /accounts/:customerId` | Extrato da conta (dívida aberta) de um cliente; inclui `debtId`/`debtNumber`/`debtOpenedAt` (ADR-026). |
| `POST /accounts/:customerId/receive` 🔒 | Recebe pagamento **FIFO** distribuído nas dívidas abertas (um `CashMovement` pelo total). Ao zerar, fecha a **dívida** (ADR-026: `PAID`+`closedAt`). |
| `GET /debts` | Lista de **dívidas** por status (ADR-026) — default `paid` (aba **Quitadas**), paginada por `closedAt`. Cada linha: `debtNumber`, cliente, `originalTotal`, `salesCount`, `openedAt`/`closedAt`. |
| `GET /debts/:id` | Extrato de **uma dívida** pelo id (ADR-026): cabeçalho (código/status/datas), resumo (original/recebido/devolvido/saldo) e as vendas a prazo com itens + recebimentos + devoluções. Usado no detalhe da aba Quitadas. |
| `GET /:id` | Detalhe de uma dívida. |
| `PATCH /:id` 🔒 | Edita a dívida (ex.: notas, vencimento). |
| `POST /:id/receive` 🔒 | Recebe pagamento de **uma** dívida específica. Ao quitar o último recebível, fecha a **dívida** (ADR-026). |

**`/deliveries` — Entrega / retirada futura (ADR-020) · conta de retiradas (ADR-028)**

| Método · Rota | O que faz |
|---|---|
| `GET /` | Lista **AGRUPADA por cliente** (ADR-028): devolve `{ cards, nextCursor }`, onde cada card é `{ kind: 'account', account }` — uma conta de retiradas (`E-0001`) com os agregados (`ordersCount`, `total`, `itemsPending`, `nextPickupAt`) e o extrato `orders` (as vendas `V-000XXX`) — ou `{ kind: 'order', order }` para uma venda SCHEDULED **sem cliente** (avulsa, não entra em conta). Paginação keyset num tempo comum (`openedAt` da conta / `createdAt` da avulsa), mesclando os dois fluxos. `?status=pending` (default) / `completed` / `all` filtra por status da conta e por `fulfillmentStatus` das avulsas. **Busca** (varre todas as situações, ignora `status`): `?code=` casa a conta pelo `accountNumber` (`E-000X`) OU uma venda dela pelo `orderNumber` (`V-000XXX`), e as avulsas pelo `orderNumber`; `?customer=` filtra a conta pelo nome do cliente (avulsas não têm cliente ⇒ ficam de fora). |
| `GET /:id` | Detalhe de UMA venda de retirada: inclui `orderNumber`, `discountAmount`, os itens com `unitPrice`/`total` e `outstandingBalance` (saldo a prazo em aberto, `0` quando 100% pago) — usados para reimprimir o **comprovante de retirada** ("PAGO — FALTA RETIRAR" quando saldo `0`; só "FALTA RETIRAR" quando há saldo a prazo). |
| `PATCH /:id` 🔒 | Atualiza status/dados da entrega. |
| `POST /:id/deliver` 🔒 | Confirma entrega/retirada → efetiva a saída de estoque adiada. Ao finalizar a última venda da conta (todas COMPLETED), **fecha a conta** (`DeliveryAccount.status = COMPLETED` + `closedAt`, ADR-028). |

**`/quotes` — Orçamentos salvos (ADR-024)**

| Método · Rota | O que faz |
|---|---|
| `GET /` · `GET /:id` | Lista e detalhe de orçamentos (`O-000045`). |
| `POST /` 🔒 · `PATCH /:id` 🔒 · `DELETE /:id` 🔒 | Cria / edita (ciclo de vida, validade, conversão em venda) / remove. |

**`/cart` — Cesta persistente sincronizada (ADR-021)**

| Método · Rota | O que faz |
|---|---|
| `GET /` | Carrega a cesta do usuário (entre dispositivos). |
| `POST /` | Salva/substitui a cesta (rascunho; preços revalidados na venda). |
| `DELETE /` | Limpa a cesta. |

**`/reports` — Relatórios**

| Método · Rota | O que faz |
|---|---|
| `GET /sales` | Vendas por período (faturamento CONFIRMED, canceladas à parte, total por forma de pagamento) + **lucro bruto/margem estimados** (base de mercadoria vendida, custo carimbado ADR-027, com cobertura) — Fatia 6. Com `?compare=1` (e intervalo), inclui `previous` = KPIs da janela ANTERIOR equivalente para os selos ▲/▼ (Fatia 4). |
| `GET /payment-composition` | Drill-down de UMA forma (`?method=&from=&to=`): as linhas (venda à vista + recebimento de dívida) que somam o "Recebido" da forma — Σ linhas = total daquela forma no `/sales` (Fatia 3, Relatórios v2). |
| `GET /top-products` | Ranking de produtos no período (`?q=&orderBy=faturamento\|lucro&from=&to=&limit=`): faturamento, qtd, nº de vendas e lucro/margem (custo carimbado, ADR-027) com cobertura. Busca sem acento (Fatia 5). |
| `GET /product-customers/:productId` | "Quem mais compra" um produto (`?from=&to=`): top clientes por faturamento naquele produto — detalhe do pop-up (Fatia 5). |
| `GET /top-customers` | Ranking de clientes no período (`?q=&orderBy=faturamento\|lucro&from=&to=&limit=`): total comprado, nº de compras, lucro/margem (custo carimbado) e **dívida atual** (saldo em aberto agora). Só clientes identificados (Fatia 5). |
| `GET /customer-products/:customerId` | "O que costuma comprar" um cliente (`?from=&to=`): top produtos por faturamento daquele cliente — detalhe do pop-up (Fatia 5). |
| `GET /daily` | Recebido por DIA no período (`?from=&to=`) para o gráfico de barras (Fatia 7): à vista pela data da venda + fiado por `paidAt`, por dia (fuso −3h). Σ dias = "Recebido do período". |
| `GET /projections` | Projeções "no ritmo atual" (Fatia 8), independentes do filtro: faturamento do mês (run-rate), a receber próx. 30 dias (vencimentos ADR-026) e itens que vão faltar (velocidade típica = mediana dos dias com venda × frequência — robusta a pico único, mas pega quem vende regularmente; StockMovement EXPENSE 30d). |
| `GET /cash-sessions` | Relatório de caixas fechados (`?from=&to=`). Com `?breakdown=1` cada sessão inclui a quebra da mini-DRE (`cashInflow`, `cashMovementsIn`, `cashMovementsOut`) — usado pela tela do Caixa ("Caixas de hoje") para reimprimir o comprovante de fechamento completo; ausente no fluxo padrão (Relatórios) para não onerar. |

**`/tenant`, `/me`, `/users` — Loja, sessão e usuários**

| Método · Rota | O que faz |
|---|---|
| `GET /tenant` · `PATCH /tenant` 🔒 | Dados da loja / edição. Inclui taxas da maquininha (ADR-016) e `blindCashClose` (fechamento cego do caixa, por loja). |
| `POST /tenant/logo` 🔒 · `DELETE /tenant/logo` 🔒 | Upload (URL assinada R2) / remoção do logo. |
| `GET /me` · `PATCH /me` | Perfil da sessão (+ memberships) / edição do próprio perfil. |
| `GET /users` | Lista usuários da loja. |
| `POST /users/invite` 🔒 · `PATCH /users/:id` 🔒 · `DELETE /users/:id` 🔒 | Convida / edita papel / remove usuário (RBAC, ADR-008). |

**`/platform` — Administração da plataforma (super-usuário)**

| Método · Rota | O que faz |
|---|---|
| `GET /me` | Dados do PlatformAdmin logado. |
| `GET /tenants` · `POST /tenants` | Lista lojas / onboarding de nova loja. |
| `PATCH /tenants/:id` · `PATCH /tenants/:id/modules` | Edita a loja / ativa-desativa módulos. |
| `POST /tenants/:id/support` | Abre uma sessão de suporte (emite token com escopo da loja). |

**`/support` — Painel de suporte (somente-leitura, token com escopo de loja)**

| Método · Rota | O que faz |
|---|---|
| `POST /end` | Encerra a sessão de suporte. |
| `GET /:tenantId/overview` | Visão geral da loja-alvo (contadores, caixa, estoque baixo, últimas vendas/auditoria). |
| `GET /:tenantId/orders` · `GET /:tenantId/products` · `GET /:tenantId/stock-movements` | Leituras da loja-alvo para diagnóstico. |

> 🛠️ **Nota de manutenção (obrigatória):** esta seção (8.2) é o espelho de `apps/api/src/routes/`. **Sempre que uma rota da API for criada, removida ou tiver o comportamento/contrato alterado, atualize esta tabela na mesma mudança** — método, rota, o que faz e guardas de auth. Mantém a documentação como fonte confiável (mesma disciplina do log de ADRs). Ver também a regra 7 do [`CLAUDE.md`](../CLAUDE.md).

---

## 9. Frontend — PWA Next.js

- **Framework:** Next.js 15 (App Router) + React 19, em TypeScript estrito.
- **Rotas principais (`apps/web/app/`):** `(app)` (área logada), `login`, `definir-senha`, `plataforma`
  (super-admin), `offline` (fallback do service worker).
- **PWA:** `manifest.ts` (Web App Manifest) + registro de service worker (`RegisterSW.tsx`) +
  `InstallPrompt.tsx` para instalação.
- **Estilo:** Tailwind CSS (`tailwind.config.ts`, `globals.css`) + PostCSS/Autoprefixer.
- **Dados no cliente:**
  - `supabase-js` para CRUD trivial (sob RLS) — leituras de catálogo, clientes etc.
  - `fetch` para a API Hono nas operações críticas.
- **Código de barras:** `BarcodeDetector` nativo com fallback `@zxing/library`. O leitor físico
  (modo *Enter-scan*) já funciona; a câmera é evolução planejada.
- **UX:** menos cliques, fontes legíveis, atalhos de teclado no desktop.

---

## 10. Banco de dados e modelo

- **SGBD:** PostgreSQL gerenciado pelo Supabase.
- **Fonte do schema:** Prisma (`packages/db/prisma/schema.prisma`) — única fonte de verdade das migrações.
- **Conexões:** runtime pela porta pooler (6543, pgbouncer via `DATABASE_URL`); migrações pela porta
  direta (5432 via `DIRECT_URL`).

### Modelo de dados (visão de alto nível)

```mermaid
erDiagram
    Tenant ||--o{ User : "tem"
    Tenant ||--o{ Product : "tem"
    Tenant ||--o{ Customer : "tem"
    Tenant ||--o{ Order : "tem"
    Tenant ||--o{ CashSession : "tem"
    Category ||--o{ Product : "classifica"
    ProductCatalog ||--o{ Product : "enriquece por EAN"
    Order ||--o{ OrderItem : "contém"
    Order ||--o{ Payment : "recebe"
    Order ||--o| Receivable : "gera (fiado)"
    Receivable ||--o{ ReceivablePayment : "quita"
    Order ||--o{ OrderReturn : "devolve"
    OrderReturn ||--o{ OrderReturnItem : "item"
    Customer ||--o{ CustomerCredit : "acumula crédito"
    Order ||--o{ Delivery : "entrega"
    Product ||--o{ StockMovement : "movimenta"
    CashSession ||--o{ CashMovement : "registra"
    Quote ||--o{ QuoteItem : "contém"
```

### Principais entidades (34 modelos + 12 enums)

| Grupo | Modelos |
|---|---|
| **Plataforma / lojas** | `Tenant`, `TenantModule`, `PlatformAdmin`, `User` |
| **Catálogo** | `Category`, `Product`, `ProductCatalog` |
| **Pessoas** | `Customer`, `Supplier` |
| **Venda / PDV** | `Order`, `OrderItem`, `Payment`, `Cart` |
| **Caixa** | `CashSession`, `CashMovement` |
| **Fiado / crédito** | `Receivable`, `ReceivablePayment`, `CustomerCredit` |
| **Devolução** | `OrderReturn`, `OrderReturnItem` |
| **Entrega** | `Delivery`, `OrderItemDelivery` |
| **Orçamento** | `Quote`, `QuoteItem` |
| **Estoque / auditoria** | `StockMovement`, `AuditEvent` |

**Enums de domínio:** `SyncStatus`, `TransactionType`, `OrderStatus`, `CashMovementKind`,
`ReceivableStatus`, `ReturnTarget`, `QuoteStatus`, `UnitType`, `UserRole`, `DeliveryStatus`,
`DeliveryMode`, `FulfillmentStatus`.

### Convenções de persistência (custo-zero, obrigatórias)

- **Nunca** BLOB/Base64 no banco — só a URL do R2 (ADR-007).
- **Tipos leves:** `enum` nativo em vez de `Text`; `VarChar` com limite estrito; sempre o tipo mais
  estreito que atende ao dado.
- **Sem logs de navegação/cliques** no Postgres. Auditoria é seletiva via `AuditEvent` (ADR-004);
  `StockMovement` já é auditoria natural do estoque.
- **Estoque:** `StockMovement` é a fonte de verdade; `Product.stockQty` é **cache** (ADR-001).
- **Offline por design:** IDs UUID gerados no cliente + campo `syncStatus` (`PENDING`/`SYNCED`/`CONFLICT`).

---

## 11. Segurança e multi-tenancy

O isolamento entre lojas é garantido **no banco**, não só na aplicação — a defesa mais forte possível.

- **Identidade:** Supabase Auth emite um JWT por usuário; um *auth hook* injeta `tenant_id` e `role`
  nas *claims*.
- **RLS (Row-Level Security):** toda tabela com `tenantId` tem policy do tipo:

  ```sql
  CREATE POLICY tenant_isolation ON products
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
  ```

  Mesmo que o cliente fale direto com o Postgres via `supabase-js`, é **impossível** ler/escrever dados
  de outro tenant.
- **API Hono:** valida o JWT em middleware e nunca confia em `tenantId` do corpo da requisição.
- **RBAC (papéis):** `OWNER`, `MANAGER`, `CASHIER`, `STOCK` controlam autorização fina (ex.: só
  OWNER/MANAGER fecham caixa com divergência) — ADR-008.
- **Segredos:** chaves de service-role e do R2 ficam só nos Workers (variáveis do Wrangler).
- **Sessão:** cookies HttpOnly gerenciados pelo helper SSR do Supabase.

---

## 12. Hospedagem e deploy

| Componente | Onde roda | Como publica | URL de produção |
|---|---|---|---|
| **Web (PWA)** | Cloudflare Workers | OpenNext (`opennextjs-cloudflare build && deploy`) | https://nexoloja-web.imortal.workers.dev |
| **API** | Cloudflare Workers | Wrangler (`wrangler deploy`) | https://nexoloja-api.imortal.workers.dev |
| **Banco** | Supabase | `prisma migrate deploy` (no CI) | — |
| **Pooling** | Cloudflare Hyperdrive → Supavisor | Config apontando ao pooler do Supabase | — |
| **Mídia** | Cloudflare R2 | Upload via URL assinada gerada pela API | — |

- As variáveis `NEXT_PUBLIC_*` são **embutidas no build** (não são secrets de runtime). Ao trocar a URL
  do web, atualizar *Site URL* / *Redirect URLs* no Supabase Auth e o CORS da API.
- **CI/CD:** GitHub Actions roda `turbo run lint test`, depois aplica migrações e publica os dois Workers.

### Riscos operacionais conhecidos

1. **Free tier do Supabase pausa após ~1 semana de inatividade** e limita a 500 MB. Mitigação **em vigor**:
   *cron* de **keep-alive** a cada 5 min (ver "Resiliência ao cold start" abaixo) mantém o projeto ativo;
   **upgrade para o plano Pro (~US$ 25/mês) no lançamento** resolve de vez pausa e limites.
2. **Limites diários do Hyperdrive no free tier** — validar contra o volume esperado de queries.

### Resiliência ao **cold start** (free tier)

O caminho de dados (**Worker → Hyperdrive → Supavisor → Supabase**) **esfria** quando fica ocioso entre
uma ação e outra: a **primeira consulta depois da pausa** pode estourar (reset/timeout de conexão) e a
API devolve um **5xx transitório**. Sem tratamento, isso chegava ao operador como mensagens enganosas —
*"Falha na autenticação."* ao confirmar venda (era a query do usuário no auth falhando, **não** o token),
o *fallback* falso *"recuperado do cache offline"* no PDV, *"Failed to fetch"* e o 500 *"Transaction not
found"*. **Mesma causa, superfícies diferentes.** O tratamento tem duas camadas (sem tocar schema, lógica
de negócio ou contrato de rotas — a referência de endpoints §8.2 permanece inalterada):

| Camada | Mecanismo | Onde |
|---|---|---|
| **Remediar** | Mensagem amigável + **retry** dos métodos idempotentes (GET/PATCH/DELETE) em falha de rede/timeout **e em 5xx transitório**. `POST` (venda) fica fora do retry (não idempotente). | `apps/web/lib/api.ts` |
| **Remediar** | `withDbRetry()` re-tenta a **leitura** de usuário/admin nos middlewares de auth (o 500 do auth ocorre **antes** de qualquer escrita → seguro). | `apps/api/src/lib/dbRetry.ts`, `middleware/auth.ts` |
| **Remediar** | *Timeout* de transação folgado (`maxWait 10s / timeout 20s`) p/ a venda não morrer com o pool frio. | `packages/db/src/index.ts` |
| **Atacar a causa** | **Keep-alive**: cron de 5 min dispara o handler `scheduled`, que faz `SELECT 1` via Hyperdrive e mantém uma conexão **quente** — absorve o cold start no lugar da venda. Invocação separada do `fetch`; nunca bloqueia requisições. | `apps/api/src/index.ts` + `wrangler.toml [triggers]` |
| **Diagnóstico** | `[observability] enabled=true` retém logs/exceções (~3 dias) p/ investigar incidentes **após** ocorrerem. | `apps/api/wrangler.toml` |

Detalhamento e histórico dos commits: **ADR-005 → Adendo "Resiliência ao cold start"**. Limite honesto:
retry e keep-alive **reduzem** a incidência, não a **eliminam** — a solução definitiva é o **Supabase Pro**
no lançamento.

---

## 13. Estratégia offline

O schema **já nasce preparado** para offline, então a implementação faseada não gera retrabalho.

| Fase | Capacidade |
|---|---|
| **MVP (online-first)** | PWA instalável; cache de assets e leituras (catálogo, clientes) via service worker. Escrita exige conexão. |
| **Offline-first (fase 2/3)** | Caixa opera sem internet: vendas gravadas em **IndexedDB** com **fila de sincronização**; ao reconectar, a fila envia ao servidor (ADR-011, ADR-012). |
| **Resolução de conflitos** | `syncStatus` (`PENDING`/`SYNCED`/`CONFLICT`) + UUIDs gerados no cliente evitam colisão. Conflitos de estoque reconciliados conforme ADR-001. |

---

## 14. Qualidade, testes e CI/CD

- **Testes unitários — Vitest:** obrigatórios para os cálculos de **caixa, estoque e fluxo de caixa** em
  `packages/core` (funções puras). Ex.: `barra.test.ts`, `payment-method.test.ts`, `index.test.ts`.
- **Testes e2e — Playwright:** fluxos ponta-a-ponta (faseado).
- **Lint / typecheck:** `turbo run lint`; `tsc --noEmit` por workspace.
- **Pipeline (GitHub Actions):** `lint` + `test` → migrações (`prisma migrate deploy`) → deploy dos dois
  Workers (Wrangler / OpenNext).
- **Regra de código:** TypeScript estrito; funções puras; backend sempre com `try/catch` (mensagem
  amigável + log detalhado); não remover comentários explicativos existentes.

---

## 15. Decisões de arquitetura (ADRs)

Toda decisão técnica relevante vira um **ADR** em [`docs/adr/`](adr/). Índice completo em
[`docs/adr/README.md`](adr/README.md). Destaques:

| ADR | Tema | Status |
|---|---|---|
| **005** | Stack e arquitetura geral | Aceito |
| **001** | Consistência de estoque (`stockQty` × `StockMovement`) | Aceito (implementado) |
| **004** | Soft-delete e auditoria seletiva | Aceito (implementado) |
| **007** | Mídia no Cloudflare R2 (nunca BLOB no banco) | Aceito |
| **008** | Papéis e RBAC dentro da loja | Aceito |
| **009** | Multi-loja, onboarding e super-usuário | Aceito |
| **011 / 012** | Fila de sincronização e cold-start offline-first | Aceito |
| **016** | Preço e margem por forma de pagamento | Aceito (implementado) |
| **019 / 022** | Venda a prazo (fiado) e conta acumulada do cliente | Aceito (implementado) |
| **024** | Orçamentos salvos | Aceito (implementado) |
| **025** | Catálogo global por EAN | Aceito (Fatias 1, 2.A e 2.B no ar) |

> **Regra 1 do `CLAUDE.md`:** qualquer ADR que altere o banco só é aplicado após explicação de impacto e
> **aprovação explícita**.

---

## 16. Ambiente de desenvolvimento

### Pré-requisitos
- Node.js **≥ 20** (recomendado 24 LTS)
- Acesso ao projeto Supabase (convite do mantenedor)

### Subir localmente

```bash
npm install          # postinstall já gera o Prisma Client
npm run dev:all      # web (3000) + API (8787)
```

### Comandos principais

| Comando | O que faz |
|---|---|
| `npm run dev` | Só o PWA (porta 3000) |
| `npm run dev:api` | Só a API (porta 8787) |
| `npm run dev:all` | Web + API |
| `npm run test` | Testes unitários (Vitest) |
| `npm run lint` | Lint de todos os workspaces |
| `npm run build` | Build de todos os workspaces |
| `npm run db:generate` | Gera o Prisma Client |
| `npm run db:migrate` | Cria/aplica migration em dev |
| `npm run db:deploy` | Aplica migrations pendentes |

> ⚠️ **Não há banco de dev separado:** o ambiente local aponta para o **banco de produção**. Use a loja
> `loja-demo` e evite escritas ao explorar. Conexão deve usar **porta 5432 + `?sslmode=require`**.

---

### Referências internas
- Arquitetura de referência: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
- Decisões: [`docs/adr/`](adr/) · índice em [`docs/adr/README.md`](adr/README.md)
- Execução / progresso: [`docs/ROADMAP.md`](ROADMAP.md)
- Diretrizes de contribuição: [`CLAUDE.md`](../CLAUDE.md)
