/**
 * Cache do flag `OFFLINE_SALES` em `localStorage` (ADR-011 §9, AI 5).
 *
 * O flag "de verdade" vem do `GET /me`. Mas se o app abrir **já sem internet** (cold start
 * offline), o `/me` falha e não há como saber se a loja tem o recurso — o aviso cairia no padrão
 * OFF (nota manual) mesmo numa loja ON. Guardamos o último valor conhecido para esse fallback ser
 * confiável. Só cache de UX; a segurança/decisão real continua no servidor.
 */

const KEY = 'nexoloja.offlineSales';

/** Grava o último valor conhecido do flag (chamado a cada `/me` bem-sucedido). */
export function cacheOfflineSales(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // localStorage indisponível (modo privado/SSR) — o fallback simplesmente não persiste.
  }
}

/** Último valor conhecido do flag (default `false` = OFF quando não há cache). */
export function readCachedOfflineSales(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
