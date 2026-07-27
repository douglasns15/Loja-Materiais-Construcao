'use client';

import { CASH_MOVEMENT_KIND_LABELS, type CashMovementRow } from '@nexoloja/shared';

/**
 * Lista (extrato) de movimentações de caixa (ADR-006): suprimento, sangria, devolução, despesa.
 * Cada linha mostra a direção (↑ entra / ↓ sai), o rótulo da natureza, o motivo, autor e hora, e o
 * valor colorido. Reusada na tela do **Caixa** (caixa aberto) e em **Relatórios** (caixa fechado),
 * para o extrato ser idêntico nos dois lugares.
 */

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function CashMovementsList({
  movements,
  emptyLabel = 'Nenhuma movimentação neste caixa.',
}: {
  movements: CashMovementRow[];
  emptyLabel?: string;
}) {
  if (movements.length === 0) {
    return <p className="text-sm text-gray-500">{emptyLabel}</p>;
  }

  return (
    <ul className="divide-y divide-gray-100">
      {movements.map((m) => {
        const income = m.type === 'INCOME';
        return (
          <li key={m.id} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className={`text-sm font-medium ${income ? 'text-green-700' : 'text-red-600'}`}>
                {income ? '↑' : '↓'} {CASH_MOVEMENT_KIND_LABELS[m.kind]}
              </p>
              {m.reason && <p className="text-sm text-gray-600">{m.reason}</p>}
              <p className="text-xs text-gray-400">
                {new Date(m.createdAt).toLocaleString('pt-BR')}
                {m.registeredByName ? ` · ${m.registeredByName}` : ''}
              </p>
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
