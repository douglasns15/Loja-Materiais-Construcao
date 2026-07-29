'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { CartItem } from '@nexoloja/shared';
import { apiDelete, apiGet, apiPost } from './api';
import { clearCachedCart, readCachedCart, writeCachedCart } from './cart';

/**
 * Store da **cesta persistente** do PDV (ADR-021). Montado **uma vez** no shell (`(app)/layout.tsx`),
 * como o `OutboxSyncProvider` — assim o **PDV** e o **ícone do topo** leem o MESMO estado.
 *
 * A cesta é a fonte de verdade no servidor (`/cart`), sincronizada entre dispositivos, com um espelho
 * `localStorage` por usuário para resposta instantânea + uso offline (ADR-012). Reconciliação por
 * `updatedAt` = **last-write-wins**. As gravações no servidor são **debounced** (junta edições rápidas
 * de quantidade num único write — free tier).
 */
type CartValue = {
  cart: CartItem[];
  /** Mesma assinatura de `useState` — o PDV usa forma-valor e forma-função sem mudança. */
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  /** Esvazia a cesta (concluir venda / "Limpar carrinho"): limpa memória, espelho e servidor. */
  clearCart: () => void;
  /** Nº de linhas distintas (alimenta o badge do ícone no topo). */
  count: number;
  /** `true` enquanto um `POST /cart` está em voo (indicador discreto). */
  syncing: boolean;
};

const CartContext = createContext<CartValue | null>(null);

/** Janela do debounce do `POST /cart` — colapsa edições rápidas (ex.: − / + de quantidade). */
const PUSH_DEBOUNCE_MS = 1000;

export function CartProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const [cart, setCartState] = useState<CartItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  // Refs para as funções estáveis não dependerem de `userId`/estado nas deps.
  const userIdRef = useRef<string | null>(userId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Espelho em ref do carrinho atual — deixa o `setCart` resolver a forma-função e fazer os efeitos
  // colaterais (espelho + push) FORA do updater de estado (mantendo o reducer puro).
  const cartRef = useRef<CartItem[]>(cart);
  cartRef.current = cart;

  /** Envia o espelho atual ao servidor (só online). Falha silenciosa: o espelho segura o estado. */
  const pushNow = useCallback(async (uid: string) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const mirror = readCachedCart(uid);
    if (!mirror) return;
    try {
      setSyncing(true);
      await apiPost('/cart', { items: mirror.items });
    } catch {
      // Offline/erro transitório: mantém o espelho; a reconciliação (online/hidratação) empurra depois.
    } finally {
      setSyncing(false);
    }
  }, []);

  /** Agenda um `POST /cart` debounced para o usuário. */
  const schedulePush = useCallback(
    (uid: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void pushNow(uid);
      }, PUSH_DEBOUNCE_MS);
    },
    [pushNow],
  );

  /**
   * Reconcilia com o servidor por `updatedAt` (last-write-wins): busca `GET /cart`; se o servidor
   * for mais novo (ou igual), adota-o; se o local for mais novo (ex.: editado offline), empurra o
   * local. Usado na hidratação (troca de usuário) e ao voltar `online`.
   */
  const reconcile = useCallback(async (uid: string) => {
    try {
      const res = await apiGet<{ items: CartItem[]; updatedAt: string | null }>('/cart');
      if (userIdRef.current !== uid) return; // usuário trocou no meio — descarta
      const serverMs = res.updatedAt ? Date.parse(res.updatedAt) : 0;
      const localMs = readCachedCart(uid)?.updatedAt ?? 0;
      if (serverMs >= localMs) {
        // Servidor vence (ou empate): adota sem re-empurrar (updatedAt do servidor no espelho).
        setCartState(res.items);
        writeCachedCart(uid, res.items, serverMs);
      } else if (typeof navigator === 'undefined' || navigator.onLine) {
        // Local é mais novo (editado offline antes): empurra para o servidor.
        await apiPost('/cart', { items: readCachedCart(uid)?.items ?? [] }).catch(() => {});
      }
    } catch {
      // Offline / cold-start: mantém o espelho já carregado (a rede reconcilia ao voltar).
    }
  }, []);

  // Hidratação e reconciliação ao (re)definir o usuário: espelho na hora + rede vence em seguida.
  useEffect(() => {
    userIdRef.current = userId;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!userId) {
      setCartState([]);
      return;
    }
    const mirror = readCachedCart(userId);
    setCartState(mirror?.items ?? []);
    void reconcile(userId);
  }, [userId, reconcile]);

  // Ao voltar `online`, reconcilia (empurra o que foi editado offline / puxa mudança de outro aparelho).
  useEffect(() => {
    function onOnline() {
      const uid = userIdRef.current;
      if (uid) void reconcile(uid);
    }
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [reconcile]);

  // Alerta ao fechar/recarregar com itens na cesta (pedido do Owner).
  useEffect(() => {
    if (cart.length === 0) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [cart.length]);

  // Flush best-effort do POST pendente ao esconder/fechar a aba (não perder um fechamento rápido).
  useEffect(() => {
    function flush() {
      const uid = userIdRef.current;
      if (uid && timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        void pushNow(uid);
      }
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') flush();
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [pushNow]);

  /**
   * `setCart` com a assinatura de `useState`: aplica a mudança, grava o espelho na hora (com um novo
   * `updatedAt`) e agenda o `POST /cart` debounced. O PDV continua chamando `setCart(...)` igual.
   */
  const setCart = useCallback<Dispatch<SetStateAction<CartItem[]>>>(
    (updater) => {
      const next =
        typeof updater === 'function'
          ? (updater as (p: CartItem[]) => CartItem[])(cartRef.current)
          : updater;
      cartRef.current = next;
      setCartState(next);
      const uid = userIdRef.current;
      if (uid) {
        writeCachedCart(uid, next, Date.now());
        schedulePush(uid);
      }
    },
    [schedulePush],
  );

  /** Esvazia a cesta em memória, no espelho e no servidor (idempotente). */
  const clearCart = useCallback(() => {
    const uid = userIdRef.current;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    cartRef.current = [];
    setCartState([]);
    if (uid) {
      clearCachedCart(uid);
      if (typeof navigator === 'undefined' || navigator.onLine) {
        void apiDelete('/cart').catch(() => {});
      }
    }
  }, []);

  return (
    <CartContext.Provider value={{ cart, setCart, clearCart, count: cart.length, syncing }}>
      {children}
    </CartContext.Provider>
  );
}

/** Lê a cesta e ações. Deve ser usado dentro do `<CartProvider>` (shell do app). */
export function useCart(): CartValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart deve ser usado dentro de <CartProvider>');
  }
  return ctx;
}
