-- =====================================================================
-- 0028 — Código de barras (EAN) no produto + catálogo global de EAN (ADR-025)
--
-- Evolui o cadastro de produtos para enriquecimento automático via leitura de EAN e importação de
-- XML de NF-e. Duas mudanças, ambas 100% ADITIVAS e reversíveis:
--
--  (1) `products.ean` — código de barras GTIN-8/12/13/14 OPCIONAL, distinto do `sku` (código interno).
--      Nullable, sem DEFAULT, sem backfill: nenhuma das linhas existentes muda (nascem com ean NULL =
--      comportamento de hoje, o scanner segue casando pelo `sku`). Não-único de propósito (não quebra
--      legado nem a importação de nota); a unicidade por loja fica na aplicação. Índice para a busca
--      por código de barras e para o casamento De-Para da NF-e.
--
--  (2) `product_catalog_global` — cache de ficha técnica por GTIN, COMPARTILHADO entre todas as lojas.
--      Exceção consciente ao multi-tenancy: é a ÚNICA tabela CROSS-TENANT do schema (sem `tenantId`,
--      uma linha por código de barras). Guarda só ficha técnica PÚBLICA (nome oficial, marca, NCM,
--      foto por hotlink) — nunca preço/custo/estoque, que continuam no `products` de cada loja. O que
--      uma loja lê de uma API externa ou importa de uma nota alimenta o cache; a próxima loja acha de
--      graça, sem nova chamada externa (efeito de rede custo-zero).
--
-- SEGURANÇA — como a tabela cross-tenant fica protegida sem policy de tenant:
--   Habilitamos RLS SEM nenhuma policy. Com RLS ligado e zero policies, os papéis `anon`/
--   `authenticated` (o caminho do supabase-js/PostgREST) NÃO enxergam nem escrevem NADA na tabela.
--   Todo acesso passa pela API (papel `postgres`/Prisma pela conexão pooled, que ignora RLS e isola
--   por código). Como não há dado comercial aqui, o pior caso hipotético seria ficha técnica pública.
--
-- CUSTO-ZERO (CLAUDE.md §6 / ADR-007): `imageUrl` guarda a URL EXTERNA pública da foto (hotlink do
--   CDN da fonte) — nunca binário no banco nem cópia no R2.
-- =====================================================================

-- AlterTable: código de barras GTIN opcional no produto do lojista (distinto do sku interno).
ALTER TABLE "products" ADD COLUMN     "ean" VARCHAR(14);

-- CreateIndex: busca por código de barras (scanner) + casamento na importação de NF-e.
CREATE INDEX "products_tenantId_ean_idx" ON "products"("tenantId", "ean");

-- CreateTable: catálogo global cross-tenant (cache de ficha técnica por GTIN). SEM tenantId.
CREATE TABLE "product_catalog_global" (
    "ean" VARCHAR(14) NOT NULL,
    "officialName" VARCHAR(200),
    "brand" VARCHAR(120),
    "ncm" VARCHAR(8),
    "imageUrl" VARCHAR(500),
    "source" VARCHAR(30),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_catalog_global_pkey" PRIMARY KEY ("ean")
);

-- =====================================================================
-- RLS — exceção consciente (tabela cross-tenant, ver cabeçalho). RLS LIGADO e SEM policy: bloqueia
-- 100% o acesso via supabase-js (anon/authenticated); toda leitura/escrita passa pela API.
-- =====================================================================
ALTER TABLE public.product_catalog_global ENABLE ROW LEVEL SECURITY;
