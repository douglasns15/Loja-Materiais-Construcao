# ADR-025 — Catálogo global de EAN (enriquecimento do cadastro por código de barras e NF-e)

- **Status:** Aceito — Fatia 1 implementada (aguardando deploy + E2E do Owner)
- **Data:** 2026-08-15
- **Contexto de fase:** Fase 3 — evolução do módulo de Produtos (cadastro enriquecido, custo-zero)

## Contexto

O cadastro de produto é digitado 100% à mão. O Owner pediu para evoluí-lo ao padrão dos grandes
ERPs: **enriquecer automaticamente** o produto a partir do **código de barras (EAN/GTIN)** — lido
pela câmera ou digitado — e, adiante, a partir do **XML da NF-e de compra**. Restrições inegociáveis:

1. **Custo-zero:** sem API paga; resiliente a falha/limite de fonte externa.
2. **Compatibilidade total** com os ~367 produtos já cadastrados.
3. Não usar `.headers()` em consultas Supabase (contrato de estabilidade do Owner). *No nosso stack
   isso nem se aplica ao caminho de produtos: o web fala com dados via API Hono/Prisma; o
   `supabase-js` só existe no fluxo de auth.*

O modelo `Product` (packages/db) já É a "tabela do lojista" (preço, custo, estoque — fonte de verdade
de PDV/estoque/ADR-001). Ele NÃO tinha um campo de código de barras dedicado: o `sku` servia como
"código interno OU de barras", ambíguo. Faltava também um lugar para a **ficha técnica** (nome
oficial, marca, NCM, foto) que independe da loja.

## Decisão

### 1. Separar ficha técnica (global) de dados comerciais (por loja)

- **`Product` continua sendo a tabela do lojista** (preço/custo/estoque). Ganha só uma coluna
  **`ean`** (GTIN-8/12/13/14, opcional, nullable, indexado por `(tenantId, ean)`), **distinta** do
  `sku` interno. **Referência SOLTA** ao catálogo (sem FK dura), como a autoria (ADR-010): FK
  obrigatória quebraria produtos sem EAN e o `migrate diff` cross-schema (memória
  `prisma-cross-schema-fk-auth`). Não-única de propósito (não trava legado nem importação de nota).

- **`ProductCatalog` (`product_catalog_global`)** é uma tabela NOVA de **cache de ficha técnica por
  GTIN**, **compartilhada entre TODAS as lojas**. É a **única tabela CROSS-TENANT** do schema (sem
  `tenantId`, uma linha por código de barras). Guarda só dado **público**: `officialName`, `brand`,
  `ncm`, `imageUrl`, `source`. **Nunca** preço/custo/estoque.

**Por que um cache global e não por loja:** efeito de rede custo-zero — o que uma loja lê de uma API
externa ou importa de uma nota alimenta o cache, e a próxima loja acha **de graça**, sem nova chamada
externa. A cobertura cresce sozinha com o uso (especialmente via NF-e, ver §4).

### 2. Segurança da tabela cross-tenant (exceção consciente ao RLS-por-tenant)

Todas as outras tabelas isolam por `tenantId` via RLS. O catálogo global não tem tenant. A escolha:
**habilitar RLS SEM nenhuma policy**. Com RLS ligado e zero policies, os papéis `anon`/
`authenticated` (o caminho do `supabase-js`/PostgREST) **não enxergam nem escrevem nada**. Todo
acesso passa pela **API** (papel `postgres`/Prisma pela conexão pooled, que ignora RLS e isola por
código). Como não há dado comercial, o pior caso hipotético de exposição seria ficha técnica pública.

### 3. Smart Cache — ordem de busca de EAN (`GET /catalog/ean/:ean`)

1. **Cache local** (`product_catalog_global`): instantâneo, sem gasto externo.
2. **Só no miss**, fontes externas **gratuitas**, atrás de uma abstração de provider:
   - **Bluesoft Cosmos** — base BR ampla (inclui itens gerais, não só alimentos). **Opcional**: só é
     chamada se o secret `COSMOS_TOKEN` estiver provisionado (`wrangler secret put`). Sem token, é
     pulada. Free tier é rate-limited; por isso é tentada 1ª (melhor cobertura p/ construção) e o
     resultado vai pro cache, evitando repetir. **Nunca gera fatura**: sem token ⇒ sem chamada.
   - **Open Food Facts** — grátis e ilimitada, mas só alimentos/bebidas/cosméticos (útil p/ lojas de
     outros ramos; acerto baixo p/ construção). Sem token.
   O que vier de fora é **gravado no cache** (upsert por EAN). **Resiliência:** falha de
   rede/timeout/limite **nunca** vira 500 — cai como "não encontrado" e o operador cadastra à mão.
   Cada provider tem timeout curto (4 s) para não segurar o Worker.

A rota também resolve `existingProductId`: se a **própria loja** já tem produto com aquele código
(por `ean` ou pelo `sku` legado), a UI avisa "já cadastrado" em vez de duplicar.

### 4. Imagens por HOTLINK (custo-zero)

A foto do produto é guardada como **URL externa pública** (hotlink do CDN da fonte) — **nunca**
baixada para o R2 nem BLOB no banco (CLAUDE.md §6 / ADR-007). Copiar imagens a cada EAN encheria os
10 GB gratuitos e geraria GET no Worker. Trade-off: se a fonte remover a foto, o `<img>` cai no
`onError` e some (placeholder). Copiar para o R2 fica como opção **manual futura** só p/
produtos-vitrine. `Product.imageUrl` (já existente) passa a aceitar esses hotlinks.

### 5. Importação de XML da NF-e (Fatia 2 — desenho aprovado, ainda não implementado)

A nota do fornecedor traz `cEAN` + `xProd` + `NCM` + `vUnCom` + `qCom` reais dos itens que a loja
compra — é a **melhor** fonte de enriquecimento para construção. O XML é parseado **no navegador**
(DOMParser, sem dependência nova), numa **tela De-Para** (item da nota → produto do cadastro):
casamento automático por EAN; sugestão por nome; **busca manual** sempre disponível (mesmo
`ProductPicker`); cadastro na hora pré-preenchido. Confirmar um item atualiza custo ("último custo",
ADR de 2026-08-11) + gera Entrada de estoque (`StockMovement` INCOME, ADR-001, transação por item) +
alimenta o catálogo global. Detalhes na próxima fatia.

## Consequências

- **Positivas:** cadastro mais rápido; cobertura crescente e custo-zero (cache global + NF-e); nenhum
  segredo obrigatório novo (Cosmos é opcional); zero storage de imagem; compatível com o legado
  (coluna aditiva, sem backfill); nenhum acoplamento a fonte externa (tudo atrás de abstração).
- **Negativas / limites:** o catálogo global é a primeira exceção ao RLS-por-tenant (mitigada por
  RLS-sem-policy + acesso só via API); hotlink pode quebrar se a fonte remover a imagem; Open Food
  Facts tem acerto baixo para construção (mitigado pela NF-e); Cosmos free tier é rate-limited.
- **Migration `0028_ean_catalog`:** 100% aditiva/reversível (coluna `products.ean` nullable +
  índice; tabela nova `product_catalog_global` com RLS sem policy). Aprovada pelo Owner antes de
  aplicar (regra 1) e aplicada sem drift.

## Relacionadas

- **ADR-007** — Armazenamento de mídia no R2 (imagem = só URL; hotlink respeita o "nunca BLOB").
- **ADR-001** — Consistência de estoque (a importação de NF-e gera Entrada atômica).
- **ADR-010** — Autoria / referência solta (mesmo padrão do vínculo `Product.ean` → catálogo).
- **CLAUDE.md** — Custo-zero, proibição de BLOB, migração sob aprovação.
