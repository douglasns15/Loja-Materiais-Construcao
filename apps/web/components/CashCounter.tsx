'use client';

import { useEffect, useMemo, useState } from 'react';
import { BRL_BILL_VALUES, BRL_COIN_VALUES, sumCashCount } from '@nexoloja/core';

/**
 * **Contador de cédulas e moedas** (contador de gaveta) — pedido do Owner.
 *
 * Modal reutilizável: o operador digita a **quantidade** de cada moeda/cédula do
 * Real e o total é somado ao vivo (`sumCashCount`, função pura testada no core,
 * que soma em centavos para não ter erro de ponto flutuante). Ao confirmar,
 * devolve o total ao campo que abriu o contador — usado tanto no **Valor de
 * abertura** quanto no **Valor contado** do fechamento.
 *
 * 100% de UI: nenhuma chamada de API, nenhum estado no servidor.
 */

const BRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Rótulo curto da peça: moedas em centavos ("5¢"), cédulas em reais ("R$ 2"). */
function pieceLabel(value: number): string {
  if (value < 1) return `${Math.round(value * 100)}¢`;
  return `R$ ${value}`;
}

/** Só dígitos (a quantidade de peças é sempre um inteiro ≥ 0). */
function toQty(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

/**
 * Uma linha do contador (uma denominação). **Precisa ser um componente estável de
 * módulo** (não definido dentro do `CashCounter`): se fosse recriado a cada render, o
 * React remontaria o `<input>` a cada tecla e o campo **perderia o foco** no 1º dígito.
 */
function CounterRow({
  value,
  qty,
  onQty,
}: {
  value: number;
  qty: string;
  onQty: (raw: string) => void;
}) {
  const subtotal = sumCashCount({ [value]: Number(qty || 0) });
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-sm font-medium text-gray-700">{pieceLabel(value)}</span>
      <span className="w-4 shrink-0 text-center text-gray-500">×</span>
      <input
        type="text"
        inputMode="numeric"
        aria-label={`Quantidade de ${pieceLabel(value)}`}
        value={qty}
        onChange={(e) => onQty(e.target.value)}
        placeholder="0"
        className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-right"
      />
      <span className="ml-auto w-24 shrink-0 text-right text-sm tabular-nums text-gray-600">
        {subtotal > 0 ? BRL(subtotal) : <span className="text-gray-300">—</span>}
      </span>
    </div>
  );
}

export function CashCounter({
  title,
  onConfirm,
  onClose,
}: {
  /** Título do modal (ex.: "Contar abertura" / "Contar a gaveta"). */
  title: string;
  /** Recebe o total contado (número em reais) para preencher o campo que abriu o contador. */
  onConfirm: (total: number) => void;
  onClose: () => void;
}) {
  // Quantidade por denominação, como texto (permite campo vazio); '' conta como 0.
  const [counts, setCounts] = useState<Record<number, string>>({});

  // Esc fecha (atalho de teclado no desktop — CLAUDE.md → menos cliques).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const numericCounts = useMemo(() => {
    const out: Record<number, number> = {};
    for (const [value, qty] of Object.entries(counts)) out[Number(value)] = Number(qty || 0);
    return out;
  }, [counts]);

  const total = sumCashCount(numericCounts);

  function setQty(value: number, raw: string) {
    setCounts((prev) => ({ ...prev, [value]: toQty(raw) }));
  }

  function clearAll() {
    setCounts({});
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Moedas</p>
            <div className="space-y-2">
              {BRL_COIN_VALUES.map((v) => (
                <CounterRow key={v} value={v} qty={counts[v] ?? ''} onQty={(raw) => setQty(v, raw)} />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Cédulas</p>
            <div className="space-y-2">
              {BRL_BILL_VALUES.map((v) => (
                <CounterRow key={v} value={v} qty={counts[v] ?? ''} onQty={(raw) => setQty(v, raw)} />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-gray-200 pt-4">
          <span className="text-sm text-gray-600">Total contado</span>
          <span className="text-xl font-bold tabular-nums">{BRL(total)}</span>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={clearAll}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Limpar
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm(total);
              onClose();
            }}
            className="flex-1 rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800"
          >
            Usar total ({BRL(total)})
          </button>
        </div>
      </div>
    </div>
  );
}
