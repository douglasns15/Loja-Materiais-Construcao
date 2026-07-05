import { SignJWT, jwtVerify } from 'jose';

/**
 * Token de SESSÃO DE SUPORTE (ADR-009, Fatia E — impersonation auditada). NÃO é um JWT de
 * usuário da loja nem do Supabase: é um token curto, assinado pela própria API (HS256 com o
 * secret `SUPPORT_TOKEN_SECRET` do Worker), que carrega apenas o escopo
 * `{ platformAdminId, targetTenantId, exp }`. É emitido quando um Super Usuário entra no
 * contexto de uma loja para suporte e verificado pelo middleware `requireSupportSession`.
 *
 * Segurança: o segredo é simétrico e nunca sai do Worker; o TTL é curto (a "revogação" prática
 * é a expiração + a revalidação de `platform_admins.isActive` no middleware). Não relaxa o RLS
 * — é a mesma fronteira explícita das rotas `/platform/*` (o super usuário não vira usuário da
 * loja em nenhum momento). Somente-leitura nesta fatia (ver ADR-009 → "Status de implementação").
 */

const ALG = 'HS256';
const ISSUER = 'nexoloja-platform';
const AUDIENCE = 'nexoloja-support';

/** Duração da sessão de suporte. Curta de propósito (transparência + baixa exposição). */
export const SUPPORT_SESSION_TTL_SECONDS = 30 * 60; // 30 min

export type SupportTokenPayload = {
  platformAdminId: string;
  targetTenantId: string;
};

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Assina o token de suporte e devolve o token + o instante de expiração (ISO, p/ a UI). */
export async function signSupportToken(
  secret: string,
  payload: SupportTokenPayload,
  ttlSeconds = SUPPORT_SESSION_TTL_SECONDS,
): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const token = await new SignJWT({ typ: 'support', targetTenantId: payload.targetTenantId })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.platformAdminId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key(secret));
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Verifica assinatura/validade e devolve o escopo. Lança se inválido/expirado. */
export async function verifySupportToken(
  secret: string,
  token: string,
): Promise<SupportTokenPayload> {
  const { payload } = await jwtVerify(token, key(secret), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  const targetTenantId = payload.targetTenantId;
  if (payload.typ !== 'support' || typeof targetTenantId !== 'string' || !payload.sub) {
    throw new Error('Token de suporte inválido.');
  }
  return { platformAdminId: payload.sub, targetTenantId };
}
