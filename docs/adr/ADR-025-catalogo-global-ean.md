# ADR-025 — Catálogo global de EAN (enriquecimento do cadastro por código de barras e NF-e)

- **Status:** Aceito — **Fatia 1 concluída** (deploy + E2E do Owner validados em 2026-08-17);
  **Fatia 2.A (importação de XML de NF-e / De-Para) concluída** (deploy + E2E do Owner validados em
  2026-08-19). **Fatia 2.B (conversão de unidade comercial + idempotência forte) — desenho aprovado
  pelo Owner em 2026-08-19, ainda NÃO implementada** (ver §5.B; migration `0029` planejada, aguardando
  aplicação).
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

### 5.A Fatia 2.A — De-Para item-a-item (implementada, E2E validado 2026-08-19)

Entregue e no ar. Operador confirma quantidade/custo **na unidade de venda** por linha (SEM conversão
automática); fornecedor casado por CNPJ (criado se novo); **idempotência POR ITEM** via `AuditEvent
NFE_ITEM_IMPORTED` (`accessKey`+`nItem`) — reupar a nota pré-marca só o que falta. Sem migration (reusa
`Product`/`StockMovement`/`ProductCatalog`/`Supplier`/`AuditEvent`). Aprendizado do E2E (Caso 6):
auto-casamento do De-Para só por **EAN exato** ou **nome idêntico** (busca frouxa de balcão nunca
AUTO-decide vínculo); busca de Produtos passou a olhar a coluna `ean`. Ver registro de testes.

### 5.B Fatia 2.B — conversão de unidade comercial + idempotência forte (✅ IMPLEMENTADA e NO AR — 2026-08-20)

Decisões de produto do Owner (2026-08-19), fecham as duas lacunas deixadas pela 2.A:

**Eixo 1 — Conversão da unidade comercial (uCom → unidade de venda). SEM migration.** A nota traz
quantidade/custo na unidade COMERCIAL do fornecedor (`uCom`/`qCom`/`vUnCom`, ex.: 2 CX a R$ 60/CX), mas
a loja vende em outra unidade (ex.: UN). A NF-e **também** traz a unidade TRIBUTÁVEL (`uTrib`/`qTrib`/
`vUnTrib`), e em muitas notas `qTrib/qCom` **já é o fator** (2 CX → 24 UN ⇒ fator 12). **Decisão:
auto-sugerir o fator pela própria nota e o operador confirma/edita** (quando a nota não ajuda, digita).
**NÃO persistir o fator por produto agora** (vale só para a importação atual; evolução futura = lembrar
por produto/fornecedor, à la Bling/Omie).
- **Parser** (`shared/nfe.ts` + `web/lib/nfe.ts`): capturar `uTrib`/`qTrib`/`vUnTrib` (hoje só lê os
  comerciais). Adicionar ao `NFeItem`: `unitTrib`, `quantityTrib`, `unitCostTrib`.
- **Core** (`packages/core`, funções PURAS + Vitest — regra 2): `suggestNfeFactor(qCom, qTrib)` (fator
  "limpo" = inteiro dentro de tolerância; senão 1); `nfeConvertedQuantity(qCom, factor) = qCom×factor`
  (entra no estoque); `nfeConvertedUnitCost(vUnCom, factor) = vUnCom÷factor` (custo por unidade de venda,
  arredondado a 4 casas como o resto).
- **Web** (`NfeImportModal.tsx`): cada linha ganha campo **"Fator (embalagem)"** com o valor sugerido +
  cálculo ao vivo ("2 CX × 12 = 24 UN"; "R$ 60,00/CX ÷ 12 = R$ 5,00/UN"). **O payload ao servidor NÃO
  muda** — `quantity`/`newCostPrice` seguem já convertidos (unidade de venda), como na 2.A ⇒ zero mudança
  de contrato no `POST /nfe/entry` por este eixo.

**Eixo 2 — Idempotência forte. PRECISA de migration `0029` (aditiva).** Hoje a idempotência é fraca: só um
`AuditEvent` com `{accessKey, nItem}` em JSON, consultado pelo `GET /imported` para PRÉ-MARCAR — **não há
constraint no banco**, então duplo-clique/corrida pode dobrar estoque. **Decisão (padrão de mercado, ver
abaixo): constraint dura no banco, por ITEM, sem "forçar".**
- **Tabela nova `nfe_import_items`** com **índice único `(tenantId, accessKey, nItem)`**, gravada na MESMA
  transação da entrada → `P2002` ⇒ rollback ⇒ **nunca dobra estoque**. Guarda `movementId` (rastreio da
  `StockMovement`, facilita estorno). Sem `accessKey` (nota sem chave de 44 díg.) não insere aqui (não há
  como deduplicar) — a entrada segue, como na 2.A.
- **API** (`routes/nfe.ts`): `POST /nfe/entry` faz o `INSERT` no `nfe_import_items` (quando há `accessKey`)
  dentro da transação de cada item; o `P2002` desse insert vira **"item já lançado"** (não erro genérico),
  abortando só aquele item. `GET /imported` passa a ler o `nfe_import_items` (indexado) **em UNIÃO com** o
  `AuditEvent` legado (notas da 2.A seguem pré-marcadas, sem backfill/regressão). Mantém o `AuditEvent
  NFE_ITEM_IMPORTED` para trilha de auditoria.
- **Web** (`NfeImportModal.tsx`): item já lançado fica **desmarcado + selo "já lançado", sem botão de
  forçar**. Correção de erro = **estornar a entrada no Estoque** (fluxo que já existe) e reimportar.

**Por que "sem forçar" (padrão de mercado):** em ERPs maduros (Bling/Omie/Tiny/Conta Azul/SAP) a chave de
acesso de 44 díg. é a identidade fiscal única da nota; reimportar reconhece a chave e **avisa "já lançada"**,
nunca duplica. Correção não é "relançar por cima" — é **estornar** (reverte estoque + financeiro,
auditável) e lançar de novo. A 2.A já é MAIS flexível que o mercado (idempotência por ITEM permite terminar
uma nota lançada pela metade); mantemos essa granularidade, mas com a garantia dura do banco. Descartadas:
"manter forçar" (menos alinhado ao mercado) e "elevar para nível de documento" (tabela `NfeImport` de
cabeçalho+itens; mais fiel aos ERPs grandes, mas escopo/migration muito maiores e perde a importação
parcial da 2.A).

**Migration `0029_nfe_import_item` — 100% aditiva, tabela nasce vazia (sem janela quebrada), reversível
(`DROP TABLE`); 0 alteração em tabela existente, 0 backfill. RLS por tenant no padrão 0019/0022 (só SELECT
p/ `authenticated`; escrita via API/papel `postgres`):**

```sql
CREATE TABLE "nfe_import_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accessKey" VARCHAR(44) NOT NULL,
    "nItem" INTEGER NOT NULL,
    "productId" UUID,
    "movementId" UUID,
    "quantity" DECIMAL(12,4) NOT NULL,
    "notaNumber" VARCHAR(20),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nfe_import_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "nfe_import_items_tenantId_accessKey_nItem_key"
    ON "nfe_import_items"("tenantId", "accessKey", "nItem");
CREATE INDEX "nfe_import_items_tenantId_accessKey_idx"
    ON "nfe_import_items"("tenantId", "accessKey");
ALTER TABLE "nfe_import_items" ADD CONSTRAINT "nfe_import_items_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfe_import_items" ADD CONSTRAINT "nfe_import_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE public.nfe_import_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nfe_import_items_select_tenant" ON public.nfe_import_items
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());
```

**✅ Status (2026-08-20):** migration `0029` **aplicada** (Owner aprovou — regra 1), **sem drift**. Fatia 2.B
IMPLEMENTADA, NO AR e **E2E do Owner VALIDADO** (caminho feliz com nota real + 5 casos de borda) — **CONCLUÍDA**.
API `b624ab67` + web `c02ecef0`. Gates: core **273/273** (+16), shared **36/36** (+1), api typecheck +
`wrangler dry-run`, web typecheck/build. Detalhes e evidências em `docs/testes/registro-de-testes.md` →
"ADR-025 — Fatia 2.B".

### 6. UX de aplicação da ficha ao cadastro (nunca sobrescreve sozinho)

A ficha do catálogo (nome oficial/marca/foto) **completa** o cadastro do lojista, mas o `Product.name` é
o nome **comercial da loja** (§1) — muitas fontes trazem nome técnico feio/incompleto. Então a UI nunca
grava a ficha automaticamente:

- **No cadastro novo** (`EanEnrichmentCard`): ao ler/digitar um GTIN válido, mostra a ficha e um botão
  **"Preencher"** que só preenche o que o operador **ainda não digitou** (não sobrescreve).
- **Na edição** (`ProductDetail` → **"🔄 Sincronizar dados pelo EAN"**): busca a ficha e **propõe as
  diferenças** (nome, marca, foto) num painel ficha × cadastro. Campo **vazio** vem **marcado** (preencher
  é seguro); campo com valor **divergente** vem **desmarcado** (substituir o que já foi digitado é
  **opt-in**), e "Aplicar selecionados" grava só o escolhido. *(Evolução 2026-08-17, pedido do Owner: antes
  a sincronização só preenchia campo vazio e nunca tocava no nome.)* O campo EAN da edição também tem o
  leitor de câmera (`BarcodeScanButton`), igual ao cadastro novo.

### 7. Casamento por GTIN canônico (GTIN-14) + fallback de SKU no auto-vínculo (✅ NO AR — 2026-09-03)

O auto-vínculo do De-Para (`matchProduct` em `NfeImportModal.tsx`) casava o item da nota com um produto
do cadastro comparando o EAN por **texto exato** (`onlyDigits(p.ean) === item.ean`) e olhando **só** o
campo `ean`. Isso deixava dois furos, achados numa importação real (loja Maria ConstruLar):

1. **Larguras diferentes do mesmo código.** A NF-e traz o EAN-13 da unidade (`7896202400440`); o cadastro
   podia ter a forma de caixa **GTIN-14** (`07896202400440`). Como GTIN-8/UPC-12/EAN-13/GTIN-14 são o
   MESMO número zero-preenchido a 14, a comparação de texto falhava e o produto não casava.
2. **Código de barras no SKU.** A causa nº 1 histórica: o barcode fora cadastrado no `sku` com `ean` vazio
   → o matcher nunca casava por EAN.

**Decisão.** Comparar pela **chave canônica GTIN-14**: novo helper puro `gtinKey(raw)` em
`packages/shared/src/catalog.ts` devolve os dígitos de um GTIN válido **zero-preenchidos até 14** (forma
que a GS1 usa para comparar GTINs — *lossless*). O matcher passou a casar `gtinKey(item.ean)` contra
`gtinKey(p.ean)` **OU** `gtinKey(p.sku)` (SKU como fallback). Só um GTIN estruturalmente válido vira
chave dos dois lados, então é **igualdade forte**, não a busca frouxa de balcão.

**Por que NÃO "cortar o zero à esquerda":** um EAN-13 pode legitimamente começar com 0 (todo UPC-A de 12
dígitos vira EAN-13 com um 0 na frente); cortar corromperia o código. Zero-padding a 14 é a única
normalização segura. O servidor NÃO mudou: o backfill de `ean` (`nfe.ts`) já é teste de vazio, e com o
matcher casando os produtos com barcode-no-SKU o campo `ean` deles se preenche na 1ª nota que casar.

**Limpeza de dados (única, 2026-09-03).** Além do fix de código, os produtos legados com `ean` vazio +
barcode válido no `sku` tiveram o código copiado para `ean` (script de leitura + `UPDATE` em transação,
guarda `ean IS NULL`; loja Maria ConstruLar: 53 produtos, 0 colisões). Isso já vale sem depender do
deploy. Sem migração e sem mudança de contrato de API (regra 7 não se aplica). Gates: shared **vitest
11/11** (novos testes de `gtinKey`), tsc web+shared 0. NO AR: web Version `6c875ae0`. Evidências em
`docs/testes/registro-de-testes.md` → "Estoque.ImportacaoNFe — casamento por GTIN-14".

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
