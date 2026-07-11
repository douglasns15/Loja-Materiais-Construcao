/**
 * Cache do caixa aberto em `localStorage` (ADR-012, Fatia CS-1, decisão (a)).
 *
 * O PDV (`/venda`) e a tela de Caixa (`/caixa`) leem `GET /cash-sessions/current` para saber se há
 * caixa aberto e recuperar o `sessionId` que carimba a venda offline (ADR-011 §5). Essa chamada é
 * cross-origin e **nunca é cacheada** pelo Service Worker (ADR-011 §7), então offline ela falha —
 * e, ao remontar/reabrir sem rede, o PDV assumia "caixa fechado" e não deixava vender (achado
 * 3.E.2). Guardamos o último caixa aberto conhecido para o cold-start offline:
 *
 * - **Online:** a rede sempre vence — toda leitura OK sobrescreve este cache (ou o limpa, se o
 *   caixa vier `null`/fechado). Nunca servimos do cache com rede disponível.
 * - **Offline:** servimos este snapshot e a UI o rotula com o horário em que foi lido
 *   ("dados de HH:MM"), para o operador saber que pode estar defasado.
 *
 * Só cache de UX no aparelho — sem migration, sem custo de free tier. A verdade financeira
 * (esperado/entradas do caixa) continua no servidor; aqui guardamos apenas a **identidade do turno
 * aberto** (o mínimo para o PDV seguir vendável e carimbar a venda).
 */

const KEY = 'nexoloja.cashSession';

/** Campos da sessão de caixa que o cold-start offline precisa (subconjunto do `GET current`). */
export type CachedCashSession = {
  id: string;
  openedAt: string;
  openingAmount: string;
  openedByName: string | null;
  /** Momento em que este snapshot foi lido do servidor (epoch ms) — alimenta o rótulo "dados de HH:MM". */
  cachedAt: number;
};

/** Formato mínimo aceito de uma sessão vinda da API (os campos extras são ignorados). */
type SessionInput = {
  id: string;
  openedAt: string;
  openingAmount: string;
  openedByName: string | null;
};

/**
 * Persiste o caixa aberto atual (chamar a cada `GET /cash-sessions/current` bem-sucedido).
 * Recebendo `null` (caixa fechado online) — ou ao fechar o caixa — **limpa** o cache.
 */
export function cacheCashSession(session: SessionInput | null): void {
  try {
    if (!session) {
      localStorage.removeItem(KEY);
      return;
    }
    const snapshot: CachedCashSession = {
      id: session.id,
      openedAt: session.openedAt,
      openingAmount: session.openingAmount,
      openedByName: session.openedByName ?? null,
      cachedAt: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage indisponível (modo privado/SSR) — o cold-start offline simplesmente não persiste.
  }
}

/** Último caixa aberto conhecido, ou `null` se não há cache (ou está corrompido). */
export function readCachedCashSession(): CachedCashSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedCashSession>;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.cachedAt !== 'number') return null;
    return {
      id: parsed.id,
      openedAt: parsed.openedAt ?? '',
      openingAmount: parsed.openingAmount ?? '0',
      openedByName: parsed.openedByName ?? null,
      cachedAt: parsed.cachedAt,
    };
  } catch {
    return null;
  }
}

/** Remove o cache do caixa (ao fechar o caixa). */
export function clearCachedCashSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // localStorage indisponível — nada a limpar.
  }
}
