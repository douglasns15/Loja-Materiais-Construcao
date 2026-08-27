'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { productMatchesQuery } from '@nexoloja/core';
import { useAnchoredDropdown } from '@/lib/useAnchoredDropdown';

/**
 * Seletor de produto com **busca**, no mesmo formato do PDV (Nova Venda) — substitui o
 * antigo `<select>` gigante nos formulários de Estoque (Entrada / Ajuste). Digita-se parte
 * do nome/apelido/fabricante/SKU (via `productMatchesQuery`, a mesma função pura do PDV) e a
 * lista aparece SÓ ao digitar; clicar escolhe o produto. Sem digitar, mostra o item já
 * selecionado (com botão "Trocar") ou o placeholder.
 *
 * Genérico o suficiente para qualquer lista que traga os campos da busca; o rótulo de
 * estoque de cada linha vem de fora (`formatStock`) para respeitar a formatação da tela
 * (ex.: "X barras + Y m" da unidade fechada, ADR-017).
 */

/** Campos mínimos que o picker precisa (a busca do core usa nome/apelido/fabricante/SKU). */
type PickerProduct = {
  id: string;
  name: string;
  sku: string;
  popularName: string | null;
  manufacturer: string | null;
};

export function ProductPicker<P extends PickerProduct>({
  products,
  value,
  onChange,
  formatStock,
  placeholder = 'Buscar produto ou SKU…',
  disabled,
}: {
  products: P[];
  /** Id do produto selecionado ('' = nenhum). */
  value: string;
  onChange: (productId: string) => void;
  /** Rótulo de estoque do produto (ex.: "0 rolo em estoque"), definido pela tela. */
  formatStock: (p: P) => string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = products.find((p) => p.id === value) ?? null;

  const matches = useMemo(
    () => (query.trim() ? products.filter((p) => productMatchesQuery(p, query)) : []),
    [products, query],
  );

  // A lista aparece SÓ ao digitar; renderizada em PORTAL (position: fixed) para não ser cortada
  // por ancestrais com overflow-hidden (cards da repaginação). `menuStyle` a posiciona e limita
  // sua altura ao espaço da viewport — o último item fica sempre alcançável pela rolagem.
  const showList = open && query.trim().length > 0;
  const menuStyle = useAnchoredDropdown(containerRef, showList);

  // Fecha ao clicar fora (campo + lista portada) ou Esc. Checar a lista também é essencial: como
  // ela vive no body (portal), um clique nela seria "fora" e a fecharia ANTES do onClick do item.
  useEffect(() => {
    if (!showList) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
      setQuery('');
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
  }, [showList]);

  function pick(p: P) {
    onChange(p.id);
    setQuery('');
    setOpen(false);
  }

  // Produto já escolhido e sem busca aberta: mostra a "pílula" do selecionado + Trocar.
  if (selected && !open) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{selected.name}</span>{' '}
          <span className="text-gray-500">({formatStock(selected)})</span>
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange('');
            setOpen(true);
            // Foca o campo de busca assim que ele aparece.
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
        aria-label="Buscar produto"
      />
      {showList &&
        menuStyle &&
        typeof document !== 'undefined' &&
        createPortal(
          <ul
            ref={listRef}
            style={menuStyle}
            className="divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
          >
            {matches.length === 0 ? (
              <li className="px-3 py-4 text-center text-sm text-gray-500">
                Nenhum produto encontrado.
              </li>
            ) : (
              matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-gray-500">
                        {p.popularName ? `${p.popularName} · ` : ''}
                        {p.manufacturer ? `${p.manufacturer} · ` : ''}
                        {p.sku}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-gray-500">{formatStock(p)}</span>
                  </button>
                </li>
              ))
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}
