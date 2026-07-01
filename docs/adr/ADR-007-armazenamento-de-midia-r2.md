# ADR-007 — Armazenamento de mídia no Cloudflare R2 (logo da loja)

- **Status:** Aceito
- **Data:** 2026-07-01
- **Contexto de fase:** Fase 2 — MVP funcional (upload de logo da loja)

## Contexto

O sistema precisa guardar imagens (começando pela **logo da loja**, usada no cabeçalho
dos comprovantes — o `ReceiptPrint` já exibe `logoUrl` quando existe). A diretriz de
custo-zero do projeto (CLAUDE.md) **proíbe salvar binários (BLOB/Base64) no PostgreSQL**:
o banco guarda apenas a **URL** da imagem. A mídia mora no **Cloudflare R2** (10 GB
gratuitos), conforme a stack definida no ADR-005.

Havia duas formas de subir o binário para o R2:

- **A) Presigned PUT (S3 API):** a API gera uma URL assinada e o cliente sobe a imagem
  direto no R2. O binário não passa pela API, mas exige: chaves de acesso S3 como
  segredos do Worker, configuração de CORS no bucket, uma lib de assinatura SigV4
  (`aws4fetch`) e um fluxo de 3 passos no cliente (pedir URL → `PUT` no R2 → confirmar).
- **B) R2 binding no Worker:** o bucket é ligado ao Worker via `[[r2_buckets]]`; o cliente
  envia a imagem para a API e o Worker faz `env.MEDIA.put()`. Sem chaves S3, sem CORS de
  bucket, sem lib de assinatura. Mais simples e idiomático na Cloudflare.

## Decisão

**Adotamos o R2 binding (opção B) para a logo da loja.**

A logo é uma imagem pequena (≤ 1 MB), então passar pela API é irrelevante em custo/latência,
e ganhamos simplicidade de infra e **zero segredos novos** para gerenciar (o binding é a
própria credencial). O presigned PUT continua sendo a escolha certa para um caso futuro de
**upload de fotos de produtos em massa / arquivos grandes** (Fase 3), quando o binário não
deve tocar o Worker — mas essa decisão fica para aquele momento.

### Como a imagem é servida (leitura pública)

Em vez de exigir um **domínio público de bucket** (r2.dev ou custom domain) + CORS, a
imagem é **servida pelo próprio Worker** num endpoint público não autenticado
`GET /public/logo/:tenantId`, que faz `env.MEDIA.get()` e responde com o `Content-Type`
correto e `Cache-Control` longo. Vantagens:

- Único comando de nuvem necessário: **criar o bucket**. Sem domínio público, sem CORS.
- URL fica no nosso próprio domínio (a API), não num subdomínio r2.dev descartável.
- Controle direto dos headers de cache.

A `logoUrl` gravada no banco é **absoluta** e carrega um parâmetro de versão para
invalidar cache do navegador a cada novo upload:
`https://<api>/public/logo/<tenantId>?v=<timestamp>`.

### Chave do objeto e ciclo de vida

- **Chave:** `logos/<tenantId>` — uma logo por loja. Reenviar **sobrescreve** o objeto
  (sem órfãos acumulando no bucket). O cache-bust `?v=` na URL cobre a sobrescrita.
- **Upload** (`POST /tenant/logo`, autenticado): valida tipo e tamanho, faz `put()` no R2
  e atualiza `Tenant.logoUrl` — tudo na mesma requisição. Não há BLOB no banco (só a URL).
- **Remoção** (`DELETE /tenant/logo`, autenticado): apaga o objeto do R2 e zera
  `Tenant.logoUrl`.

### Validação (compartilhada web + API)

Constantes e validação pura ficam em `packages/shared` (`tenant.ts`) e são reusadas no
cliente (feedback imediato) e no servidor (fonte de verdade):

- **Formatos aceitos:** PNG, JPEG, WebP.
- **Tamanho máximo:** 1 MB.
- **Sem redimensionamento** nesta fase (o `ReceiptPrint` já limita a altura via CSS).

## Consequências

- **Positivas:** infra mínima (um binding), nenhum segredo novo, sem CORS/domínio de
  bucket, sem BLOB no banco. Fluxo de upload simples (uma chamada).
- **Negativas / limites:** cada leitura da logo invoca o Worker (mitigado por
  `Cache-Control` longo + cache-bust por versão; volume de leitura de logo é baixo —
  comprovantes e tela de configurações). Sem redimensionamento server-side.
- **Futuro:** fotos de produtos em massa devem reavaliar **presigned PUT** (ADR próprio)
  para não trafegar binários grandes pelo Worker; possível migração para domínio público
  de bucket se o volume de leitura crescer.

## Relacionadas

- **ADR-005** — Stack e arquitetura (R2 como storage de mídia; API Hono sobre Workers).
- **CLAUDE.md** — Diretrizes de otimização de banco (proibido BLOB/Base64; só URL).
