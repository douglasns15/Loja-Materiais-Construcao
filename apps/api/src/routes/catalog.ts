import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import {
  type EanLookupResult,
  type ProductCatalog,
  isValidGtin,
  normalizeGtin,
  normalizeNcm,
  onlyDigits,
} from '@nexoloja/shared';
import { type Bindings, type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

/**
 * Catálogo global de EAN (ADR-025) — busca inteligente de ficha técnica por código de barras.
 *
 * Fluxo (Smart Cache): 1º o CACHE global local (`product_catalog_global`) — instantâneo e sem gasto
 * externo; 2º, só no miss, as fontes externas GRATUITAS (Bluesoft Cosmos se houver token; Open Food
 * Facts sempre). O que vier de fora é gravado no cache para a próxima loja achar de graça — o efeito
 * de rede reduz chamadas externas com o tempo (custo-zero).
 *
 * Resiliência (regra de ouro do Owner): falha de rede/timeout/limite da API externa NUNCA vira 500 —
 * cai como "não encontrado" e o operador cadastra à mão. Cada provider tem timeout curto para não
 * segurar o Worker. A imagem é sempre HOTLINK (URL externa), nunca baixada para o R2.
 */

const catalog = new Hono<Env>();
catalog.use('*', requireAuth);

/** Teto por provider externo — um EAN não pode segurar o Worker esperando uma API lenta. */
const EXTERNAL_TIMEOUT_MS = 4000;

/** Ficha técnica parcial vinda de uma fonte externa (antes de mesclar com o cache). */
type ExternalCatalog = {
  officialName: string | null;
  brand: string | null;
  ncm: string | null;
  imageUrl: string | null;
  source: string;
};

/** `fetch` com timeout (AbortController) — converte um hang da API externa em erro tratável. */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EXTERNAL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** String não-vazia após trim, ou null. Normaliza os "" que as APIs às vezes devolvem. */
function orNull(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
}

/**
 * Bluesoft Cosmos — base BR ampla (inclui itens gerais, não só alimentos). Opcional: só é chamado
 * quando `COSMOS_TOKEN` está provisionado. Rate-limited no free tier; por isso é tentado 1º (melhor
 * cobertura p/ construção) e o resultado vai pro cache, evitando repetir a chamada.
 */
async function fetchCosmos(ean: string, token: string): Promise<ExternalCatalog | null> {
  // Defensivo: um secret provisionado por colagem interativa (`wrangler secret put`) costuma carregar
  // um espaço/quebra de linha invisível no fim — o header sairia sujo e a Cosmos responde 401. O
  // `.trim()` blinda contra isso (e contra futuras rotações do token).
  const cleanToken = token.trim();
  try {
    const res = await fetchWithTimeout(`https://api.cosmos.bluesoft.com.br/gtins/${ean}`, {
      headers: { 'X-Cosmos-Token': cleanToken, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      // 404 = produto inexistente (normal). Outros status (401 token / 429 limite) são operacionalmente
      // úteis: logamos status + TAMANHO do token (nunca o token) p/ inspeção via `wrangler tail`.
      if (res.status !== 404) {
        console.warn(`[cosmos] gtin=${ean} status=${res.status} tokenLen=${cleanToken.length}`);
      }
      return null; // 404 (não achou) / 429 (limite) / 401 (token) → sem enriquecimento, sem erro
    }
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!j) return null;
    const brand = (j.brand as Record<string, unknown> | null) ?? null;
    const ncmObj = (j.ncm as Record<string, unknown> | null) ?? null;
    return {
      officialName: orNull(j.description),
      brand: orNull(brand?.name),
      ncm: normalizeNcm(orNull(ncmObj?.code)),
      imageUrl: orNull(j.thumbnail), // URL pública do CDN da Cosmos (hotlink)
      source: 'cosmos',
    };
  } catch {
    return null; // rede/timeout: segue para o próximo provider
  }
}

/**
 * Open Food Facts — gratuito e ilimitado, porém SÓ alimentos/bebidas/cosméticos (acerto baixo p/
 * construção; útil p/ lojas de outros ramos). Sem token. Serve a foto num CDN público estável.
 */
async function fetchOpenFoodFacts(ean: string): Promise<ExternalCatalog | null> {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,brands,image_url`;
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'NexoLoja/1.0 (ERP custo-zero)' },
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!j || j.status !== 1) return null; // status 0 = produto inexistente na base
    const p = (j.product as Record<string, unknown> | null) ?? null;
    if (!p) return null;
    const name = orNull(p.product_name);
    const brand = orNull(p.brands);
    const imageUrl = orNull(p.image_url);
    // Sem nenhum campo aproveitável não vale gravar cache "vazio".
    if (!name && !brand && !imageUrl) return null;
    return { officialName: name, brand, ncm: null, imageUrl, source: 'off' };
  } catch {
    return null;
  }
}

/** Tenta as fontes externas na ordem (Cosmos → Open Food Facts). Primeira com dado vence. */
async function fetchExternal(ean: string, env: Bindings): Promise<ExternalCatalog | null> {
  if (env.COSMOS_TOKEN) {
    const cosmos = await fetchCosmos(ean, env.COSMOS_TOKEN);
    if (cosmos) return cosmos;
  }
  return fetchOpenFoodFacts(ean);
}

/** Serializa a linha do cache (Prisma) no shape público `ProductCatalog`. */
function toCatalog(row: {
  ean: string;
  officialName: string | null;
  brand: string | null;
  ncm: string | null;
  imageUrl: string | null;
  source: string | null;
}): ProductCatalog {
  return {
    ean: row.ean,
    officialName: row.officialName,
    brand: row.brand,
    ncm: row.ncm,
    imageUrl: row.imageUrl,
    source: row.source,
  };
}

/**
 * Busca inteligente de EAN. Sempre resolve `existingProductId` (se a própria loja já tem um produto
 * com esse código — evita duplicar); o enriquecimento externo só roda para GTIN estruturalmente
 * válido. Um código não-GTIN (ex.: código interno digitado) responde `found:false` sem erro.
 */
catalog.get('/ean/:ean', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const digits = onlyDigits(c.req.param('ean'));
  const gtin = normalizeGtin(digits);

  try {
    const prisma = createPrismaClient(connectionString);

    // A loja já cadastrou esse código? (por `ean` OU pelo `sku` legado, que podia guardar o barcode).
    const existing = digits
      ? await prisma.product.findFirst({
          where: { tenantId, deletedAt: null, OR: [{ ean: digits }, { sku: digits }] },
          select: { id: true },
        })
      : null;
    const existingProductId = existing?.id ?? null;

    // Não é um GTIN válido → sem consulta externa nem cache (mas devolve o "já cadastrado").
    if (!gtin) {
      const result: EanLookupResult = {
        found: false,
        catalog: null,
        source: null,
        existingProductId,
      };
      return c.json({ ok: true, data: result });
    }

    // 1ª busca: cache global local (instantâneo, sem gasto externo).
    const cached = await prisma.productCatalog.findUnique({ where: { ean: gtin } });
    if (cached) {
      const result: EanLookupResult = {
        found: true,
        catalog: toCatalog(cached),
        source: 'cache',
        existingProductId,
      };
      return c.json({ ok: true, data: result });
    }

    // 2ª busca: fontes externas gratuitas. Falha/limite/timeout → "não encontrado" (sem erro).
    const external = await fetchExternal(gtin, c.env);
    if (!external) {
      const result: EanLookupResult = {
        found: false,
        catalog: null,
        source: null,
        existingProductId,
      };
      return c.json({ ok: true, data: result });
    }

    // Grava no cache para a próxima loja achar de graça (upsert idempotente por EAN).
    const saved = await prisma.productCatalog.upsert({
      where: { ean: gtin },
      create: {
        ean: gtin,
        officialName: external.officialName,
        brand: external.brand,
        ncm: external.ncm,
        imageUrl: external.imageUrl,
        source: external.source,
      },
      update: {}, // cache-miss garantido acima; nunca sobrescreve dado bom com este caminho
    });

    const result: EanLookupResult = {
      found: true,
      catalog: toCatalog(saved),
      source: external.source,
      existingProductId,
    };
    return c.json({ ok: true, data: result });
  } catch (err) {
    console.error('GET /catalog/ean/:ean falhou:', err);
    return c.json({ ok: false, error: 'Falha ao consultar o código de barras.' }, 500);
  }
});

export default catalog;
