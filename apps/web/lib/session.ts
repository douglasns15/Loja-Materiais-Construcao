import { supabase } from './supabase';

/** Decodifica (sem verificar) o payload de um JWT. Uso só de UI — a verificação real é na API. */
function decodeClaims(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1];
    if (!part) return {};
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch {
    return {};
  }
}

/** Lê o claim `is_platform_admin` de um access token específico (ex.: o recém-emitido no login). */
export function tokenIsPlatformAdmin(token: string | null | undefined): boolean {
  return !!token && decodeClaims(token).is_platform_admin === true;
}

/**
 * Lê o claim `is_platform_admin` do access token da sessão atual — atalho para o front
 * rotear o Super Usuário ao painel `/plataforma` (ADR-009). A autorização de verdade é na
 * API (middleware `requirePlatformAuth`, que confia na tabela `platform_admins`).
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return tokenIsPlatformAdmin(data.session?.access_token);
}
