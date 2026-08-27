'use client';

import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * Posição de um dropdown ancorado a um campo, para ser renderizado em **portal** (`position: fixed`
 * no `document.body`). Assim a lista ESCAPA de qualquer ancestral com `overflow-hidden` — como os
 * cards da repaginação (cabeçalho índigo + `rounded-2xl overflow-hidden`), que cortavam o último
 * item das buscas (ProductPicker/SupplierPicker).
 *
 * A altura é limitada ao espaço livre até a borda da viewport (`maxHeight`), então o último item é
 * sempre alcançável pela rolagem da própria lista. Quando o campo está muito perto do fim da tela,
 * a lista abre **para cima**. Recalcula ao rolar (em qualquer ancestral, via captura) e ao
 * redimensionar. Retorna `null` enquanto fechado (nada é renderizado) — evitando flash na posição
 * errada antes da primeira medição.
 */
export function useAnchoredDropdown(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    const GAP = 4; // respiro entre o campo e a lista
    const MARGIN = 8; // respiro até a borda da tela
    const MIN = 120; // altura mínima utilizável antes de decidir abrir para cima

    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom - GAP - MARGIN;
      const spaceAbove = r.top - GAP - MARGIN;
      const base: CSSProperties = { position: 'fixed', left: r.left, width: r.width, zIndex: 70 };
      if (spaceBelow < MIN && spaceAbove > spaceBelow) {
        // Campo baixo na tela: abre para cima, ancorando a base da lista no topo do campo.
        setStyle({ ...base, bottom: window.innerHeight - r.top + GAP, maxHeight: Math.max(MIN, spaceAbove) });
      } else {
        setStyle({ ...base, top: r.bottom + GAP, maxHeight: Math.max(MIN, spaceBelow) });
      }
    };

    update();
    // `true` (captura) pega rolagem em QUALQUER ancestral rolável, não só na janela.
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, anchorRef]);

  return style;
}
