/**
 * Escolha da loja ativa (ADR-014, Fatia 2) — módulo MÍNIMO, sem dependências, para o `api.ts` poder
 * ler a loja sem importar os caches (evita import circular). A orquestração da troca (limpar caches,
 * checar fila offline, recarregar) fica em `activeStore.ts`.
 */

const KEY = 'nexoloja.activeTenant';

/** Rota da tela de seleção de loja (login com 2+ lojas e "trocar de loja"). */
export const SELECT_STORE_PATH = '/selecionar-loja';

export function getActiveTenantId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setActiveTenantId(tenantId: string): void {
  try {
    localStorage.setItem(KEY, tenantId);
  } catch {
    // sem localStorage: segue sem header (a API usa a única loja, se houver só uma).
  }
}

export function clearActiveTenantId(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nada a limpar
  }
}

/** `true` se a mudança de `localStorage` vista em OUTRA aba é a troca da loja ativa. */
export function isActiveTenantStorageEvent(e: StorageEvent): boolean {
  return e.key === KEY;
}
