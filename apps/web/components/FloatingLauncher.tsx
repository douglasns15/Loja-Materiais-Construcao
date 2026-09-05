'use client';

// Botão "Destacar" (⧉) no header (ADR-031, Fatia 1). Abre um menu com as telas destacáveis; clicar
// abre a tela num painel flutuante independente — de QUALQUER tela (ex.: abrir Produtos flutuante
// enquanto está no PDV). Desktop-only: escondido no mobile, onde a janela flutuante não se aplica.

import { useEffect, useRef, useState } from 'react';
import {
  FLOATABLE_ORDER,
  FLOATABLE_SCREENS,
  MAX_PANELS,
  useFloatingPanels,
} from '@/lib/floatingPanels';

export function FloatingLauncher() {
  const { openPanel, closePanel, isOpen, panels } = useFloatingPanels();
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false); // avisa quando bateu o teto de painéis
  const ref = useRef<HTMLDivElement>(null);

  // Fecha o menu ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function toggleScreen(key: (typeof FLOATABLE_ORDER)[number]) {
    if (isOpen(key)) {
      closePanel(key);
      setFull(false);
      return;
    }
    const ok = openPanel(key);
    setFull(!ok);
  }

  return (
    // `hidden md:block`: no mobile o launcher não aparece (janela flutuante é desktop-only).
    <div ref={ref} className="relative hidden md:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center rounded-lg p-2 text-gray-600 hover:bg-gray-100"
        title="Destacar tela em janela flutuante"
        aria-label="Destacar tela em janela flutuante"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="14" height="14" rx="2" />
          <path d="M21 8v11a2 2 0 0 1-2 2H8" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Destacar tela ({panels.length}/{MAX_PANELS})
          </div>
          {FLOATABLE_ORDER.map((key) => {
            const opened = isOpen(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleScreen(key)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                <span className="truncate">{FLOATABLE_SCREENS[key].label}</span>
                {opened ? (
                  <span className="ml-2 shrink-0 text-xs font-semibold text-indigo-600">aberta ✕</span>
                ) : (
                  <span className="ml-2 shrink-0 text-gray-400">⧉</span>
                )}
              </button>
            );
          })}
          {full && (
            <div className="border-t border-gray-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Limite de {MAX_PANELS} janelas abertas. Feche uma para abrir outra.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
