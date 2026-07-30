'use client';

import { useState } from 'react';
import {
  CASH_MOVEMENT_KIND_LABELS,
  isReversalRow,
  isReversibleRow,
  type CashMovementRow,
} from '@nexoloja/shared';
import { reversalKindFor } from '@nexoloja/core';

/**
 * Lista (extrato) de movimentações de caixa (ADR-006): suprimento, sangria, devolução, despesa.
 * Cada linha mostra a direção (↑ entra / ↓ sai), o rótulo da natureza, o motivo, autor e hora, e o
 * valor colorido. Reusada na tela do **Caixa** (caixa aberto) e em **Relatórios** (caixa fechado),
 * para o extrato ser idêntico nos dois lugares.
 *
 * Quando `onReverse` é passado (só na tela do Caixa aberto), cada lançamento manual estornável
 * ganha um botão **"Estornar"** com confirmação inline. Sem `onReverse` (Relatórios), a lista é
 * apenas leitura. Estornos aparecem rotulados como "Estorno de Sangria/Suprimento".
 */

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Rótulo da linha: estorno mostra "Estorno de <natureza original>"; demais, a natureza direta. */
function rowLabel(m: CashMovementRow): string {
  if (isReversalRow(m)) {
    // O estorno guarda o kind invertido; o original é o inverso dele (involução).
    return `Estorno de ${CASH_MOVEMENT_KIND_LABELS[reversalKindFor(m.kind as 'SUPPLY' | 'WITHDRAWAL')]}`;
  }
  return CASH_MOVEMENT_KIND_LABELS[m.kind];
}

export function CashMovementsList({
  movements,
  emptyLabel = 'Nenhuma movimentação neste caixa.',
  onReverse,
  reversingId,
}: {
  movements: CashMovementRow[];
  emptyLabel?: string;
  /** Ao estornar um lançamento manual (só no Caixa aberto). Ausente → lista somente leitura. */
  onReverse?: (row: CashMovementRow) => void;
  /** Id do lançamento em processo de estorno (desabilita o botão e mostra "Estornando…"). */
  reversingId?: string | null;
}) {
  // Qual linha está com a confirmação inline "Estornar? Sim / Cancelar" aberta.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (movements.length === 0) {
    return <p className="text-sm text-gray-600">{emptyLabel}</p>;
  }

  return (
    <ul className="divide-y divide-gray-100">
      {movements.map((m) => {
        const income = m.type === 'INCOME';
        const canReverse = !!onReverse && isReversibleRow(m, movements);
        const busy = reversingId === m.id;
        return (
          <li key={m.id} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className={`text-sm font-medium ${income ? 'text-green-700' : 'text-red-600'}`}>
                {income ? '↑' : '↓'} {rowLabel(m)}
              </p>
              {m.reason && <p className="text-sm text-gray-600">{m.reason}</p>}
              <p className="text-xs text-gray-500">
                {new Date(m.createdAt).toLocaleString('pt-BR')}
                {m.registeredByName ? ` · ${m.registeredByName}` : ''}
              </p>
              {canReverse &&
                (confirmingId === m.id ? (
                  <p className="mt-1 flex items-center gap-2 text-xs">
                    <span className="text-gray-600">Estornar este lançamento?</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setConfirmingId(null);
                        onReverse!(m);
                      }}
                      className="font-medium text-red-600 hover:underline disabled:opacity-60"
                    >
                      {busy ? 'Estornando…' : 'Sim, estornar'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmingId(null)}
                      className="text-gray-600 hover:underline disabled:opacity-60"
                    >
                      Cancelar
                    </button>
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(m.id)}
                    className="mt-1 text-xs font-medium text-gray-600 hover:text-red-600 hover:underline"
                  >
                    Estornar
                  </button>
                ))}
            </div>
            <span
              className={`shrink-0 text-sm font-medium tabular-nums ${income ? 'text-green-700' : 'text-red-600'}`}
            >
              {income ? '+' : '−'} {BRL(m.amount)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
