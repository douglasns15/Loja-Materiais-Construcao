/**
 * Espelho local da **cesta persistente** do PDV (ADR-021), em `localStorage`, **por usuário**.
 *
 * A fonte de verdade da cesta é o servidor (`/cart`), sincronizada entre dispositivos; este espelho
 * existe para (1) hidratar a tela **na hora**, sem flash, e (2) manter a cesta utilizável **offline**
 * (as rotas `/cart` são cross-origin e não são cacheadas pelo Service Worker — mesma situação de
 * `/cash-sessions`, ADR-012). Guardamos também o `updatedAt` (epoch ms) para o **last-write-wins**
 * na reconciliação com o servidor.
 *
 * A chave inclui o `userId` — a cesta é pessoal (outro usuário no mesmo aparelho nunca vê a alheia).
 */
import type { CartItem } from '@nexoloja/shared';

export type { CartItem };

const KEY_PREFIX = 'nexoloja.cart:';

/** Snapshot local da cesta de um usuário: itens + relógio do last-write-wins. */
export type CartMirror = { items: CartItem[]; updatedAt: number };

const keyFor = (userId: string) => `${KEY_PREFIX}${userId}`;

/** Espelho local da cesta do usuário, ou `null` se não há (ou está corrompido/indisponível). */
export function readCachedCart(userId: string): CartMirror | null {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CartMirror>;
    if (!parsed || !Array.isArray(parsed.items) || typeof parsed.updatedAt !== 'number') return null;
    return { items: parsed.items as CartItem[], updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

/** Persiste o espelho local da cesta do usuário (chamado a cada mudança, antes do POST debounced). */
export function writeCachedCart(userId: string, items: CartItem[], updatedAt: number): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify({ items, updatedAt }));
  } catch {
    // localStorage indisponível (modo privado/SSR) — segue só com o estado em memória.
  }
}

/** Remove o espelho local da cesta do usuário (ao concluir a venda ou limpar o carrinho). */
export function clearCachedCart(userId: string): void {
  try {
    localStorage.removeItem(keyFor(userId));
  } catch {
    // localStorage indisponível — nada a limpar.
  }
}
