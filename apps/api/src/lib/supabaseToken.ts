import { createLocalJWKSet, createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';

/**
 * Verificação do access token do Supabase Auth (usada por `requireAuth` e `requirePlatformAuth`).
 * Separada do middleware para ser testável (`supabaseToken.test.ts`).
 */

// O conjunto de chaves públicas (JWKS) do Supabase é cacheado no isolate do Worker.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksUrl: string | undefined;

function getJwks(supabaseUrl: string) {
  const url = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
  if (!jwks || jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksUrl = url;
  }
  return jwks;
}

/**
 * Chaves públicas LOCAIS (var `SUPABASE_JWKS` do `wrangler.toml`) — verificação sem rede.
 *
 * Por que (2026-10-14): o JWKS remoto é baixado na 1ª requisição de cada isolate NOVO (e de novo a
 * cada 10 min, o `cacheMaxAge` do `jose`). Medido: ~1,2 s; quando passa dos 5 s do `jose`, a
 * verificação lança e respondíamos 401 "Token inválido" com um token VÁLIDO (visto em produção logo
 * após um deploy) — e um POST não é re-tentado pela web. Com as chaves locais não há download.
 * O remoto continua como RESERVA: token assinado por uma chave que ainda não está na var (rotação de
 * chave no Supabase) cai nele. São chaves PÚBLICAS — não é segredo. Rotação de chave ⇒ atualizar a var.
 */
let localJwks: ReturnType<typeof createLocalJWKSet> | null = null;
let localJwksRaw: string | undefined;

function getLocalJwks(raw: string | undefined) {
  if (!raw) return null;
  if (localJwksRaw !== raw) {
    localJwksRaw = raw;
    try {
      localJwks = createLocalJWKSet(JSON.parse(raw));
    } catch (err) {
      console.error('SUPABASE_JWKS inválida — usando só o JWKS remoto:', err);
      localJwks = null;
    }
  }
  return localJwks;
}

/**
 * Falha ao OBTER as chaves (rede/timeout/resposta ruim do Supabase) — transitória, não diz nada sobre
 * o token. Erros do próprio token (assinatura, expirado, malformado) são `JOSEError` de outros códigos.
 */
function isKeyFetchFailure(err: unknown): boolean {
  if (!(err instanceof errors.JOSEError)) return true; // ex.: TypeError do fetch
  if (err.code === 'ERR_JWKS_TIMEOUT' || err.code === 'ERR_JWKS_INVALID') return true;
  return err.code === 'ERR_JOSE_GENERIC' && /200 OK/.test(err.message);
}

export type TokenCheck = { ok: true; sub: string } | { ok: false; transient: boolean };

/**
 * Verifica o access token do Supabase: assinatura (ES256) + emissor + audiência. Tenta as chaves
 * locais; chave desconhecida (`ERR_JWKS_NO_MATCHING_KEY`) ⇒ JWKS remoto. Nunca aceita token sem
 * assinatura conferida. `transient` = não deu para obter as chaves (responder 503, não 401).
 */
export async function verifySupabaseToken(token: string, supabaseUrl: string, rawJwks: string | undefined): Promise<TokenCheck> {
  const opts = { issuer: `${supabaseUrl}/auth/v1`, audience: 'authenticated' };
  try {
    let payload: JWTPayload | undefined;
    const local = getLocalJwks(rawJwks);
    if (local) {
      try {
        ({ payload } = await jwtVerify(token, local, opts));
      } catch (err) {
        if (!(err instanceof errors.JOSEError) || err.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw err;
        console.warn('JWT com chave fora da SUPABASE_JWKS (rotação?) — conferindo no JWKS remoto.');
      }
    }
    if (!payload) ({ payload } = await jwtVerify(token, getJwks(supabaseUrl), opts));
    if (!payload.sub) return { ok: false, transient: false };
    return { ok: true, sub: payload.sub };
  } catch (err) {
    if (isKeyFetchFailure(err)) {
      console.error('Falha ao obter as chaves (JWKS) do Supabase:', err);
      return { ok: false, transient: true };
    }
    return { ok: false, transient: false };
  }
}

/** Resposta de token recusado: 503 quando a falha foi ao obter as chaves (a web re-tenta), senão 401. */
export const TOKEN_UNAVAILABLE = 'Não foi possível validar o login agora. Tente de novo em instantes.';
