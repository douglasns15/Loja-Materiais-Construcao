import { z } from 'zod';
import { onlyDigits } from './format';

/**
 * Catálogo global de EAN (ADR-025) — helpers puros de GTIN e schemas compartilhados web + API.
 *
 * O catálogo é o cache de ficha técnica por código de barras, alimentado por leitura de EAN
 * (API externa) e pela importação de XML de NF-e. Estes utilitários são PUROS (sem I/O), então
 * rodam igual no cliente (feedback imediato) e no servidor (fonte de verdade) — mesmo padrão de
 * `format.ts`. A consulta externa em si e o upsert no banco vivem na API (`routes/catalog.ts`).
 */

/** Comprimentos válidos de GTIN (EAN-8, UPC-A/12, EAN-13, GTIN-14). */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * Dígito verificador GS1 (mod-10) sobre o "corpo" do código (sem o último dígito). Pesos 3 e 1
 * alternados a partir da direita do corpo. Vale para EAN-8/12/13/14 (o algoritmo é o mesmo).
 */
function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = body.charCodeAt(body.length - 1 - i) - 48; // dígito da direita p/ esquerda
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * `true` quando o código é um GTIN estruturalmente válido (comprimento 8/12/13/14 E dígito
 * verificador correto). Usado para decidir se vale consultar a API externa / usar como chave do
 * catálogo — NÃO para bloquear o cadastro (um código industrial sem GTIN ainda pode ser guardado
 * no `Product.ean`, apenas não dispara enriquecimento).
 */
export function isValidGtin(raw: string): boolean {
  const digits = onlyDigits(raw);
  if (!GTIN_LENGTHS.has(digits.length)) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits[digits.length - 1]);
  return gtinCheckDigit(body) === check;
}

/**
 * Normaliza um código para uso como CHAVE do catálogo global: só dígitos, e apenas se for um GTIN
 * válido. Devolve `null` quando não é um GTIN (aí não consultamos fonte externa nem gravamos cache).
 */
export function normalizeGtin(raw: string): string | null {
  const digits = onlyDigits(raw);
  return isValidGtin(digits) ? digits : null;
}

/**
 * Chave CANÔNICA de um GTIN para COMPARAÇÃO/casamento: os dígitos de um GTIN válido preenchidos com
 * zeros à ESQUERDA até 14 (forma GTIN-14). GTIN-8/UPC-12/EAN-13/GTIN-14 são o MESMO número zero-
 * preenchido a 14, então padronizar a 14 unifica as diferentes larguras do MESMO item numa única
 * string comparável (ex.: EAN-13 "7896202400440" e a forma de caixa "07896202400440" viram a mesma
 * chave). Devolve `null` quando não é um GTIN válido.
 *
 * IMPORTANTE: NUNCA "remove" zeros à esquerda — só COMPLETA até 14. Um EAN-13 pode legitimamente
 * começar com 0 (todo UPC-A de 12 dígitos vira EAN-13 com um 0 na frente); cortar o zero corromperia
 * o código. Zero-padding é lossless e é a forma que a GS1 usa para comparar GTINs. Use esta chave só
 * para IGUALDADE de códigos; para GRAVAR no cadastro/catálogo continue usando `normalizeGtin` (mantém
 * a largura de origem, legível para humanos).
 */
export function gtinKey(raw: string): string | null {
  const digits = onlyDigits(raw);
  return isValidGtin(digits) ? digits.padStart(14, '0') : null;
}

/**
 * Acha, numa lista de produtos da loja, o que tem o código lido (ADR-041 — motor único de casamento):
 * 1. por **GTIN** (`gtinKey`) contra o `ean` OU o `sku` (cadastro legado guardava o código de barras
 *    no SKU) — EAN-13 e GTIN-14 do mesmo item casam;
 * 2. senão, por **igualdade exata** (sem espaços nas pontas) do código interno (`sku`) ou do `ean` —
 *    cobre código interno/industrial que não é GTIN.
 * Devolve o primeiro que casar, ou `null` (código novo ⇒ cadastrar).
 */
export function findProductByCode<T extends { sku: string; ean?: string | null }>(
  products: readonly T[],
  code: string,
): T | null {
  const raw = code.trim();
  if (!raw) return null;
  const key = gtinKey(raw);
  if (key) {
    const byGtin = products.find((p) => gtinKey(p.ean ?? '') === key || gtinKey(p.sku) === key);
    if (byGtin) return byGtin;
  }
  return products.find((p) => p.sku.trim() === raw || (p.ean ?? '').trim() === raw) ?? null;
}

/**
 * `true` quando o texto da busca do PDV parece um **código** (lido pelo leitor ou digitado), e não um
 * nome: sem espaços, com pelo menos 4 caracteres e algum dígito. É o gatilho do "Cadastrar agora"
 * (ADR-041 §B) — busca por nome sem resultado não oferece cadastro (não há código para o SKU).
 */
export function looksLikeProductCode(query: string): boolean {
  const q = query.trim();
  return q.length >= 4 && !/\s/.test(q) && /\d/.test(q);
}

/**
 * Normaliza um NCM para 8 dígitos (a NF-e às vezes traz com pontos: "2523.29.10"). Devolve `null`
 * se, após limpar, não sobrarem exatamente 8 dígitos — evita gravar NCM malformado.
 */
export function normalizeNcm(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = onlyDigits(raw);
  return digits.length === 8 ? digits : null;
}

/**
 * Ficha técnica global de um EAN (linha de `product_catalog_global`). Só dado PÚBLICO — nunca
 * preço/custo/estoque, que vivem no `Product` de cada loja. `imageUrl` é hotlink externo (custo-zero).
 */
export const productCatalogSchema = z.object({
  ean: z.string().min(8).max(14),
  officialName: z.string().max(200).nullable().optional(),
  brand: z.string().max(120).nullable().optional(),
  ncm: z.string().max(8).nullable().optional(),
  imageUrl: z.string().url().max(500).nullable().optional(),
  source: z.string().max(30).nullable().optional(),
});
export type ProductCatalog = z.infer<typeof productCatalogSchema>;

/**
 * Resposta da busca inteligente de EAN (`GET /catalog/ean/:ean`).
 * - `found`: houve ficha técnica (do cache ou de fonte externa)?
 * - `catalog`: a ficha, quando encontrada.
 * - `source`: de onde veio ('cache' | 'off' | 'cosmos' | 'nfe' | 'manual' | null).
 * - `existingProductId`: se a PRÓPRIA loja já tem um produto com esse EAN, o id — para a UI
 *   avisar "já cadastrado" em vez de duplicar (o escopo do tenant é resolvido no servidor pelo JWT).
 */
export const eanLookupResultSchema = z.object({
  found: z.boolean(),
  catalog: productCatalogSchema.nullable(),
  source: z.string().nullable(),
  existingProductId: z.string().uuid().nullable(),
});
export type EanLookupResult = z.infer<typeof eanLookupResultSchema>;
