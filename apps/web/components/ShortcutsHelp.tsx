'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useShortcuts, humanizeBinding, type ShortcutCommand } from '@/lib/shortcuts';

/**
 * Overlay de AJUDA dos atalhos (ADR-032, Fatia 2). Aberto por `?` (Shift+/) — a tabela dos atalhos em
 * vigor (padrões + sobrescritas + customizados), agrupada. Só leitura; a edição fica em
 * Configurações → Acessibilidade.
 */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const { catalog, customs } = useShortcuts();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const all: ShortcutCommand[] = [...catalog, ...customs];
  const groups: { title: string; items: ShortcutCommand[] }[] = [
    { title: 'Navegação', items: all.filter((c) => c.group === 'Navegação') },
    { title: 'PDV', items: all.filter((c) => c.group === 'PDV') },
    { title: 'Geral', items: all.filter((c) => c.group === 'Geral') },
  ].filter((g) => g.items.length > 0);

  return (
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
        role="dialog"
        aria-label="Atalhos de teclado"
      >
        <div className="flex items-start justify-between bg-indigo-600 px-4 py-3 text-white">
          <div>
            <h2 className="text-sm font-semibold">Atalhos de teclado</h2>
            <p className="text-[11px] text-indigo-100">
              Para navegar, aperte <kbd className="rounded bg-white/20 px-1 font-bold">N</kbd> e depois a
              letra. Editável em Configurações → Acessibilidade.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-indigo-100 hover:text-white" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto overscroll-contain p-4">
          {groups.map((g) => (
            <div key={g.title} className="mb-4 last:mb-0">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">{g.title}</p>
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
                {g.items.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-gray-700">{c.label}</span>
                    <kbd className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-800">
                      {humanizeBinding(c.defaultBinding)}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
          <p className="text-[11px] text-gray-400">Desktop apenas.</p>
          <Link
            href="/configuracoes"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            Personalizar atalhos
          </Link>
        </div>
      </div>
    </div>
  );
}
