'use client';

import { useEffect, useRef, useState } from 'react';
import {
  useShortcuts,
  humanizeBinding,
  eventToToken,
  isModifierKey,
  NAV_TARGETS,
  SHORTCUT_CATALOG,
  type ShortcutCommand,
} from '@/lib/shortcuts';

/** Binding padrão (de fábrica) de cada comando — base para detectar o que o usuário alterou. */
const DEFAULT_BINDING = new Map(SHORTCUT_CATALOG.map((c) => [c.id, c.defaultBinding]));

/**
 * Configurações → **Acessibilidade** (ADR-032, Fatia 4). Lista os atalhos em vigor (padrões +
 * sobrescritas + customizados), permite **editar** (capturando a nova combinação por `event.code`),
 * **restaurar o padrão**, **adicionar** um atalho apontando para uma tela e **remover** os
 * customizados. Custo-zero: tudo em `localStorage` (motor em `lib/shortcuts`).
 */

const SEQUENCE_WINDOW_MS = 1200;

/**
 * Botão que CAPTURA uma combinação de teclas (mesma regra do motor): tecla com modificador ou F-key
 * vira atalho único; tecla simples sozinha pode virar líder de uma sequência (aperta outra tecla) ou,
 * se nada vier, um atalho de tecla única. Usa a fase de captura + `stopImmediatePropagation` para o
 * motor global não navegar enquanto se grava o atalho.
 */
function CaptureButton({
  onCapture,
  className,
  children,
}: {
  onCapture: (binding: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [capturing, setCapturing] = useState(false);
  const [lead, setLead] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    let first: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      window.removeEventListener('keydown', onKey, true);
      if (timer) clearTimeout(timer);
    };
    const finish = (binding: string) => {
      cleanup();
      setCapturing(false);
      setLead(null);
      onCapture(binding);
    };
    const cancel = () => {
      cleanup();
      setCapturing(false);
      setLead(null);
    };

    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') return cancel();
      if (isModifierKey(e.code)) return; // espera a tecla "de verdade"

      const hasMods = e.ctrlKey || e.altKey || e.metaKey || e.shiftKey;
      const isF = /^F\d{1,2}$/.test(e.code);

      if (first) {
        // 2º passo: tecla simples completa a sequência; qualquer outra coisa mantém só o 1º passo.
        finish(!hasMods && !isF ? `${first},${e.code}` : first);
        return;
      }
      if (hasMods || isF) return finish(eventToToken(e));

      // Tecla simples sozinha: arma como possível líder e espera a próxima.
      first = e.code;
      setLead(e.code);
      timer = setTimeout(() => finish(e.code), SEQUENCE_WINDOW_MS);
    }

    window.addEventListener('keydown', onKey, true);
    return cleanup;
  }, [capturing, onCapture]);

  if (capturing) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
        {lead ? `${lead.replace('Key', '').replace('Digit', '')} …` : 'Pressione…'}
        <span className="text-indigo-400">(Esc cancela)</span>
      </span>
    );
  }
  return (
    <button type="button" onClick={() => setCapturing(true)} className={className}>
      {children}
    </button>
  );
}

export function AccessibilitySection() {
  const { catalog, customs, setBinding, resetBinding, resetAll, addCustom, removeCustom, conflict } =
    useShortcuts();
  const [error, setError] = useState<string | null>(null);
  // Rascunho do "adicionar atalho": tela escolhida + combinação capturada.
  const [newHref, setNewHref] = useState<string>(NAV_TARGETS[0]?.href ?? '');
  const [newBinding, setNewBinding] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (msg: string) => {
    setError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 4000);
  };

  /** Aplica um atalho capturado a um comando existente, bloqueando se a combinação já for de outro. */
  function applyBinding(cmd: ShortcutCommand, binding: string) {
    const clash = conflict(binding, cmd.id);
    if (clash) {
      flash(`"${humanizeBinding(binding)}" já é de "${clash.label}". Escolha outra.`);
      return;
    }
    setError(null);
    setBinding(cmd.id, binding);
  }

  function addNew() {
    if (!newHref || !newBinding) return;
    const clash = conflict(newBinding, '');
    if (clash) {
      flash(`"${humanizeBinding(newBinding)}" já é de "${clash.label}". Escolha outra.`);
      return;
    }
    const target = NAV_TARGETS.find((t) => t.href === newHref);
    addCustom(target?.label ?? 'Tela', newHref, newBinding);
    setNewBinding(null);
    setError(null);
  }

  // Só os padrões que foram ALTERADOS ganham o botão "Restaurar" (comparando com o de fábrica).
  const isOverridden = (cmd: ShortcutCommand) => DEFAULT_BINDING.get(cmd.id) !== cmd.defaultBinding;

  // `show-help` (o `?`) é fixo por caractere (layout-independente) — não entra na edição.
  const editable = catalog.filter((c) => c.id !== 'show-help');
  const groups: { title: string; items: ShortcutCommand[] }[] = [
    { title: 'Navegação', items: editable.filter((c) => c.group === 'Navegação') },
    { title: 'PDV', items: editable.filter((c) => c.group === 'PDV') },
  ].filter((g) => g.items.length > 0);

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Acessibilidade · Atalhos de teclado</h2>
          <p className="mt-1 text-sm text-gray-600">
            Para navegar, aperte <kbd className="rounded bg-gray-100 px-1 font-bold">N</kbd> e depois a
            letra da tela; as F-keys disparam ações do PDV. Pressione{' '}
            <kbd className="rounded bg-gray-100 px-1 font-bold">?</kbd> em qualquer tela para ver a lista.
            Vale no computador (teclado físico).
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Restaurar todos os atalhos padrão? Suas edições serão desfeitas.')) resetAll();
          }}
          className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          Restaurar padrões
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
          {error}
        </p>
      )}

      {groups.map((g) => (
        <div key={g.title} className="mt-5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">{g.title}</p>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {g.items.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{c.label}</span>
                <kbd className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-800">
                  {humanizeBinding(c.defaultBinding)}
                </kbd>
                <div className="flex shrink-0 items-center gap-1.5">
                  <CaptureButton
                    onCapture={(b) => applyBinding(c, b)}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                  >
                    Editar
                  </CaptureButton>
                  {isOverridden(c) && (
                    <button
                      type="button"
                      onClick={() => resetBinding(c.id)}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-gray-400 hover:text-gray-600"
                      title="Voltar ao padrão"
                    >
                      Restaurar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* Meus atalhos (customizados) */}
      <div className="mt-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">Meus atalhos</p>
        {customs.length > 0 && (
          <ul className="mb-3 divide-y divide-gray-100 rounded-xl border border-gray-100">
            {customs.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{c.label}</span>
                <kbd className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-800">
                  {humanizeBinding(c.defaultBinding)}
                </kbd>
                <div className="flex shrink-0 items-center gap-1.5">
                  <CaptureButton
                    onCapture={(b) => applyBinding(c, b)}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                  >
                    Editar
                  </CaptureButton>
                  <button
                    type="button"
                    onClick={() => removeCustom(c.id)}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-red-500 hover:text-red-700"
                  >
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Adicionar novo: tela + combinação */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-gray-300 p-3">
          <select
            value={newHref}
            onChange={(e) => setNewHref(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            aria-label="Tela do novo atalho"
          >
            {NAV_TARGETS.map((t) => (
              <option key={t.href} value={t.href}>
                {t.label}
              </option>
            ))}
          </select>
          <CaptureButton
            onCapture={(b) => setNewBinding(b)}
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            {newBinding ? `Combinação: ${humanizeBinding(newBinding)}` : 'Definir combinação'}
          </CaptureButton>
          <button
            type="button"
            onClick={addNew}
            disabled={!newBinding}
            className="rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:from-indigo-700 hover:to-indigo-600 disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>
      </div>
    </section>
  );
}
