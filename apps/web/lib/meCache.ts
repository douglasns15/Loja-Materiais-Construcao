import type { Me } from './useMe';

/**
 * Cache do perfil `GET /me` em `localStorage` (CS-3 / ADR-012, decisão (a)).
 *
 * O `/me` alimenta o RBAC do front (papel → esconder telas/ações, ex.: item **Configurações**) e o
 * nome/e-mail no menu. Como a navegação offline da CS-3 é por **reload**, o shell remonta a cada tela
 * e o `/me` (cross-origin, nunca cacheado) falha sem rede → `isAdmin` cairia para `false` e o item
 * some. Guardamos o último `/me` bom para o shell continuar coerente offline (papel/nome preservados).
 *
 * Só espelho de UX — a segurança real é na API. Usado **apenas offline**: online, a resposta da rede
 * sempre vence (decisão (a)); numa falha **online** (ex.: 403 de usuário desativado) NÃO se usa o
 * cache, para o gate real valer.
 */

const KEY = 'nexoloja.me';

/** Grava o último perfil conhecido (chamado a cada `/me` bem-sucedido). */
export function cacheMe(me: Me): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(me));
  } catch {
    // localStorage indisponível (modo privado/SSR) — o fallback simplesmente não persiste.
  }
}

/** Último perfil conhecido (ou `null` quando não há cache). */
export function readCachedMe(): Me | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

/** Limpa o cache (ex.: logout) para não vazar o perfil entre contas no mesmo aparelho. */
export function clearCachedMe(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // sem localStorage — nada a limpar.
  }
}
