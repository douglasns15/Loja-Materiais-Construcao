'use client';

// Renderiza todos os painéis flutuantes abertos em PORTAL no document.body (ADR-031, Fatia 1),
// escapando de qualquer `overflow-hidden` do shell — mesmo padrão do useAnchoredDropdown. O z-order
// segue a ordem do array (o último é o mais à frente). Desktop-only: no mobile (largura < 768px) a
// janela flutuante não faz sentido, então nada é renderizado.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPanels } from '@/lib/floatingPanels';
import { FloatingPanel } from './FloatingPanel';

export function FloatingPanelHost() {
  const { panels, closePanel, bringToFront, commitGeometry } = useFloatingPanels();
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  if (!mounted || !isDesktop || panels.length === 0) return null;

  return createPortal(
    // Camada de portal: não captura cliques por si (pointer-events-none); cada painel reativa os
    // seus (pointer-events-auto), então o resto do app continua clicável entre os painéis.
    <div className="pointer-events-none fixed inset-0 z-40">
      {panels.map((p, i) => (
        <FloatingPanel
          key={p.key}
          screen={p.key}
          geometry={p}
          zIndex={40 + i}
          onFocus={() => bringToFront(p.key)}
          onClose={() => closePanel(p.key)}
          onCommit={(geo) => commitGeometry(p.key, geo)}
        />
      ))}
    </div>,
    document.body,
  );
}
