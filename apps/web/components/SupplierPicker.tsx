'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeSearchText } from '@nexoloja/core';
import { formatCnpj } from '@nexoloja/shared';

/**
 * Seletor de fornecedor com **busca**, no MESMO formato do seletor de produto (`ProductPicker`) —
 * substitui o antigo `<select>` da Entrada de Estoque (pedido do Owner: "mesmo padrão do campo de
 * busca do Produto, mesmo layout"). Digita-se parte do nome/CNPJ e a lista aparece; clicar escolhe.
 * Sem seleção, mostra o campo de busca (estado "sem fornecedor" — o campo é opcional); com um
 * fornecedor escolhido, mostra a "pílula" + botão "Trocar". O rodapé "+ Cadastrar novo fornecedor"
 * (opcional, via `onCreateNew`) abre o quick-add sem sair da tela.
 */

type PickerSupplier = { id: string; name: string; cnpj?: string | null };

export function SupplierPicker<S extends PickerSupplier>({
  suppliers,
  value,
  onChange,
  onCreateNew,
  placeholder = 'Buscar fornecedor (opcional)…',
  disabled,
}: {
  suppliers: S[];
  /** Id do fornecedor selecionado ('' = nenhum). */
  value: string;
  onChange: (supplierId: string) => void;
  /** Abre o cadastro rápido de fornecedor (rodapé "+ Cadastrar novo fornecedor"). */
  onCreateNew?: () => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = suppliers.find((s) => s.id === value) ?? null;

  // Fecha a lista ao clicar fora (ou Esc): o fornecedor é OPCIONAL, então clicar fora deve
  // simplesmente deixar o campo como está (vazio, se nada foi escolhido) — não travar até escolher.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Lista curta: sem busca mostra os primeiros; com busca, filtra por nome/CNPJ (acento-insensível).
  const matches = useMemo(() => {
    const q = normalizeSearchText(query);
    if (!q) return suppliers.slice(0, 8);
    return suppliers.filter((s) => normalizeSearchText(`${s.name} ${s.cnpj ?? ''}`).includes(q));
  }, [suppliers, query]);

  function pick(s: S) {
    onChange(s.id);
    setQuery('');
    setOpen(false);
  }

  // Fornecedor já escolhido e sem busca aberta: "pílula" do selecionado + Trocar (Trocar = limpa).
  if (selected && !open) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{selected.name}</span>
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange('');
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="shrink-0 rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          Trocar
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <input
        ref={inputRef}
        type="search"
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:opacity-60"
        aria-label="Buscar fornecedor"
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-72 w-full divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {matches.length === 0 ? (
            <li className="px-3 py-3 text-center text-sm text-gray-500">
              {query.trim() ? 'Nenhum fornecedor encontrado.' : 'Nenhum fornecedor cadastrado.'}
            </li>
          ) : (
            matches.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => pick(s)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50"
                >
                  <span className="min-w-0 truncate font-medium">{s.name}</span>
                  {s.cnpj && (
                    <span className="shrink-0 text-xs text-gray-500">{formatCnpj(s.cnpj)}</span>
                  )}
                </button>
              </li>
            ))
          )}
          {/* Rodapé fixo: não achou? cadastra na hora. */}
          {onCreateNew && (
            <li>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onCreateNew();
                }}
                className="block w-full px-3 py-2 text-left text-sm font-medium text-blue-600 hover:bg-blue-50"
              >
                + Cadastrar novo fornecedor
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
