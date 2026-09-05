'use client';

// Uma janela flutuante (ADR-031, Fatia 1). Moldura arrastável/redimensionável escrita à mão com
// pointer events — sem dependência nova (regra 4). Renderiza o PRÓPRIO componente de página da tela
// (lazy) no corpo; a geometria é local durante o gesto e persistida no fim (via onCommit) para não
// re-renderizar o provider a cada movimento do mouse.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { FLOATABLE_SCREENS, type PanelGeometry, type ScreenKey } from '@/lib/floatingPanels';

const MIN_W = 340;
const MIN_H = 220;
const TITLE_H = 40; // altura aproximada da barra de título (usada como piso visível ao arrastar)

type Props = {
  screen: ScreenKey;
  geometry: PanelGeometry;
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
  onCommit: (geo: PanelGeometry) => void;
};

function clamp(geo: PanelGeometry): PanelGeometry {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.max(MIN_W, Math.min(geo.w, vw - 8));
  const h = Math.max(MIN_H, Math.min(geo.h, vh - 8));
  // Mantém sempre a barra de título alcançável na tela (não deixa sumir além das bordas).
  const x = Math.max(8 - w + TITLE_H * 2, Math.min(geo.x, vw - TITLE_H * 2));
  const y = Math.max(0, Math.min(geo.y, vh - TITLE_H));
  return { ...geo, x, y, w, h };
}

export function FloatingPanel({ screen, geometry, zIndex, onFocus, onClose, onCommit }: Props) {
  const { label, Component } = FLOATABLE_SCREENS[screen];
  const [geo, setGeo] = useState<PanelGeometry>(geometry);
  // Estado do gesto em andamento (ref para não re-renderizar e não sofrer com closure velha).
  const gesture = useRef<
    | null
    | {
        mode: 'drag' | 'resize';
        startX: number;
        startY: number;
        origin: PanelGeometry;
      }
  >(null);

  function onPointerMove(e: ReactPointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (g.mode === 'drag') {
      setGeo(clamp({ ...g.origin, x: g.origin.x + dx, y: g.origin.y + dy }));
    } else {
      setGeo(clamp({ ...g.origin, w: g.origin.w + dx, h: g.origin.h + dy }));
    }
  }

  function endGesture(e: ReactPointerEvent) {
    if (!gesture.current) return;
    gesture.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ponteiro já solto */
    }
    onCommit(geo);
  }

  function startDrag(e: ReactPointerEvent) {
    // Não inicia arrasto ao clicar nos botões da barra (minimizar/fechar).
    if ((e.target as HTMLElement).closest('button')) return;
    onFocus();
    gesture.current = { mode: 'drag', startX: e.clientX, startY: e.clientY, origin: geo };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function startResize(e: ReactPointerEvent) {
    e.stopPropagation();
    onFocus();
    gesture.current = { mode: 'resize', startX: e.clientX, startY: e.clientY, origin: geo };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function toggleMinimize() {
    const next = { ...geo, minimized: !geo.minimized };
    setGeo(next);
    onCommit(next);
  }

  return (
    <div
      className="pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border border-gray-300 bg-white shadow-2xl ring-1 ring-black/5"
      style={{
        left: geo.x,
        top: geo.y,
        width: geo.w,
        height: geo.minimized ? undefined : geo.h,
        zIndex,
      }}
      onPointerDown={onFocus}
      role="dialog"
      aria-label={`Janela flutuante: ${label}`}
    >
      {/* Barra de título = alça de arrasto. */}
      <div
        className="flex shrink-0 cursor-move touch-none select-none items-center gap-2 border-b border-gray-200 bg-gradient-to-r from-indigo-700 to-indigo-500 px-3 py-2 text-white"
        onPointerDown={startDrag}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        {/* Ícone de janela flutuante */}
        <svg className="h-4 w-4 shrink-0 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="14" height="14" rx="2" />
          <path d="M21 8v11a2 2 0 0 1-2 2H8" />
        </svg>
        <span className="flex-1 truncate text-sm font-semibold">{label}</span>
        <button
          type="button"
          onClick={toggleMinimize}
          className="rounded p-1 text-white/90 hover:bg-white/20"
          title={geo.minimized ? 'Restaurar' : 'Minimizar'}
          aria-label={geo.minimized ? 'Restaurar' : 'Minimizar'}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {geo.minimized ? <path d="M4 20h16M4 4h16v12H4z" /> : <path d="M5 12h14" />}
          </svg>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-white/90 hover:bg-white/20"
          title="Fechar"
          aria-label="Fechar"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Corpo: a tela reusada (instância independente). Rola dentro do painel. */}
      {!geo.minimized && (
        <div className="relative flex-1 overflow-auto bg-gray-50 p-3">
          <Component />
        </div>
      )}

      {/* Alça de redimensionar — no canto do painel (fora do scroll do corpo). */}
      {!geo.minimized && (
        <div
          onPointerDown={startResize}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
          title="Redimensionar"
          aria-hidden="true"
        >
          <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15 15 21M21 9 9 21" />
          </svg>
        </div>
      )}
    </div>
  );
}
