'use client';

// Janela flutuante de tela (ADR-031, Fatia 1). Provider ÚNICO no shell que guarda os painéis
// flutuantes abertos e a geometria (posição/tamanho/minimizado) de cada um. É apresentação pura —
// não toca API/banco/core/shared.
//
// Decisões de arquitetura (ver ADR-031):
// - Painel INTERNO, no mesmo documento (não `window.open`) → compartilha OutboxSyncProvider/
//   CartProvider/JWT; sem duplo dreno de outbox (ADR-011) nem rajada de conexões (ADR-005).
// - Cada painel monta o PRÓPRIO componente de página da tela, uma 2ª vez, via `next/dynamic`
//   (ssr:false). O spike (build) confirmou que reusar a `page.tsx` fora da rota compila e que o
//   chunk da tela fica lazy (não incha as outras rotas). As 5 telas são auto-contidas (estado
//   `useState` local), então a busca do painel é independente sem refatorar nada.
// - Guarda de custo (ADR-005): sem polling; carga só ao ABRIR e ao PESQUISAR (ação do usuário).
//   Teto de MAX_PANELS painéis simultâneos.

import dynamic from 'next/dynamic';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';

/** Telas destacáveis (leitura). Fatia 1: só telas de consulta — sem PDV/Caixa (transacionais). */
export type ScreenKey = 'vendas' | 'contas-a-receber' | 'products' | 'estoque' | 'relatorios';

/** Registro de cada tela destacável: rótulo (título do painel/menu) + componente lazy da página. */
type ScreenDef = { label: string; Component: ComponentType };

// Cada componente é a PRÓPRIA page.tsx da rota, carregada sob demanda (lazy) — o chunk da tela só
// entra no bundle quando o usuário abre o painel. `ssr:false` porque são client-components e o
// painel só existe no desktop, no cliente.
export const FLOATABLE_SCREENS: Record<ScreenKey, ScreenDef> = {
  products: {
    label: 'Produtos',
    Component: dynamic(() => import('@/app/(app)/products/page'), { ssr: false }),
  },
  estoque: {
    label: 'Estoque',
    Component: dynamic(() => import('@/app/(app)/estoque/page'), { ssr: false }),
  },
  vendas: {
    label: 'Histórico de Vendas',
    Component: dynamic(() => import('@/app/(app)/vendas/page'), { ssr: false }),
  },
  'contas-a-receber': {
    label: 'Contas a Receber',
    Component: dynamic(() => import('@/app/(app)/contas-a-receber/page'), { ssr: false }),
  },
  relatorios: {
    label: 'Relatórios',
    Component: dynamic(() => import('@/app/(app)/relatorios/page'), { ssr: false }),
  },
};

/** Ordem de exibição no menu do launcher. */
export const FLOATABLE_ORDER: ScreenKey[] = [
  'products',
  'estoque',
  'vendas',
  'contas-a-receber',
  'relatorios',
];

/** Teto de painéis simultâneos (guarda de custo — cada painel é uma carga de tela). */
export const MAX_PANELS = 2;

export type PanelGeometry = { x: number; y: number; w: number; h: number; minimized: boolean };
export type Panel = { key: ScreenKey } & PanelGeometry;

const STORAGE_PREFIX = 'nexoloja:float:';

// Geometria padrão de um painel ao abrir pela 1ª vez: ancorado à direita, com cascata para não
// sobrepor exatamente o painel anterior. Clampada à viewport.
function defaultGeometry(index: number): PanelGeometry {
  const w = 520;
  const h = 620;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const offset = index * 36;
  const width = Math.min(w, vw - 32);
  const height = Math.min(h, vh - 32);
  const x = Math.max(16, vw - width - 24 - offset);
  const y = Math.min(vh - height - 16, 76 + offset);
  return { x, y: Math.max(16, y), w: width, h: height, minimized: false };
}

function loadGeometry(key: ScreenKey): PanelGeometry | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const g = JSON.parse(raw) as Partial<PanelGeometry>;
    if (typeof g.x !== 'number' || typeof g.y !== 'number' || typeof g.w !== 'number' || typeof g.h !== 'number') {
      return null;
    }
    return { x: g.x, y: g.y, w: g.w, h: g.h, minimized: !!g.minimized };
  } catch {
    return null;
  }
}

function saveGeometry(key: ScreenKey, geo: PanelGeometry) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(geo));
  } catch {
    /* localStorage indisponível (aba privada, etc.) — geometria só não persiste. */
  }
}

type FloatingPanelsValue = {
  panels: Panel[];
  /** Abre (ou foca, se já aberto) o painel de uma tela. Recusa acima do teto e retorna `false`. */
  openPanel: (key: ScreenKey) => boolean;
  closePanel: (key: ScreenKey) => void;
  /** Move o painel para o topo da pilha (z-order) — o último do array é o mais à frente. */
  bringToFront: (key: ScreenKey) => void;
  /** Persiste a geometria após arrastar/redimensionar/minimizar (chamado no fim do gesto). */
  commitGeometry: (key: ScreenKey, geo: PanelGeometry) => void;
  isOpen: (key: ScreenKey) => boolean;
};

const FloatingPanelsContext = createContext<FloatingPanelsValue | null>(null);

export function FloatingPanelsProvider({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState<Panel[]>([]);

  const isOpen = useCallback((key: ScreenKey) => panels.some((p) => p.key === key), [panels]);

  const bringToFront = useCallback((key: ScreenKey) => {
    setPanels((prev) => {
      const found = prev.find((p) => p.key === key);
      if (!found || prev[prev.length - 1]?.key === key) return prev;
      return [...prev.filter((p) => p.key !== key), found];
    });
  }, []);

  const openPanel = useCallback((key: ScreenKey): boolean => {
    let ok = true;
    setPanels((prev) => {
      // Já aberto → só traz para a frente.
      if (prev.some((p) => p.key === key)) {
        const found = prev.find((p) => p.key === key)!;
        return [...prev.filter((p) => p.key !== key), found];
      }
      // Teto de painéis: recusa o excedente (a UI avisa).
      if (prev.length >= MAX_PANELS) {
        ok = false;
        return prev;
      }
      const geo = loadGeometry(key) ?? defaultGeometry(prev.length);
      return [...prev, { key, ...geo }];
    });
    return ok;
  }, []);

  const closePanel = useCallback((key: ScreenKey) => {
    setPanels((prev) => prev.filter((p) => p.key !== key));
  }, []);

  const commitGeometry = useCallback((key: ScreenKey, geo: PanelGeometry) => {
    setPanels((prev) => prev.map((p) => (p.key === key ? { ...p, ...geo } : p)));
    saveGeometry(key, geo);
  }, []);

  const value = useMemo<FloatingPanelsValue>(
    () => ({ panels, openPanel, closePanel, bringToFront, commitGeometry, isOpen }),
    [panels, openPanel, closePanel, bringToFront, commitGeometry, isOpen],
  );

  return <FloatingPanelsContext.Provider value={value}>{children}</FloatingPanelsContext.Provider>;
}

export function useFloatingPanels(): FloatingPanelsValue {
  const ctx = useContext(FloatingPanelsContext);
  if (!ctx) {
    throw new Error('useFloatingPanels deve ser usado dentro de <FloatingPanelsProvider>');
  }
  return ctx;
}
