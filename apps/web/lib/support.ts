/**
 * Armazenamento do token de SESSÃO DE SUPORTE no cliente (ADR-009, Fatia E). O token é curto e
 * de escopo único (uma loja) — fica em `sessionStorage` (some ao fechar a aba; não é persistido).
 * Chaveado por `tenantId` para não misturar sessões de lojas diferentes.
 */

export type SupportSession = {
  token: string;
  expiresAt: string;
  tenantName: string;
};

const key = (tenantId: string) => `nexoloja.support.${tenantId}`;

export function saveSupportSession(tenantId: string, session: SupportSession): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(key(tenantId), JSON.stringify(session));
}

export function loadSupportSession(tenantId: string): SupportSession | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(key(tenantId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SupportSession;
  } catch {
    return null;
  }
}

export function clearSupportSession(tenantId: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(key(tenantId));
}
