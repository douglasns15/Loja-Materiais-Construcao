'use client';

import { useEffect, useState } from 'react';
import { paymentMethodLabel, type PaymentComposition } from '@nexoloja/shared';
import { apiGet } from '@/lib/api';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const DATETIME = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Drill-down de UMA forma de pagamento (Relatórios v2, Fatia 3). Abre em pop-up ao clicar numa
 * forma na tabela "Por forma de pagamento": mostra a COMPOSIÇÃO daquele valor — as vendas à vista
 * (+) e os recebimentos de dívida (+) que somam o "Recebido" da forma no período. Reúsa
 * `GET /reports/payment-composition` (regime de caixa, ADR-019); por construção o total do modal
 * bate com o total da forma no `/reports/sales`.
 */
export function PaymentCompositionModal({
  method,
  from,
  to,
  onClose,
}: {
  method: string;
  from: string | null;
  to: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<PaymentComposition | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ method });
        if (from) qs.set('from', from);
        if (to) qs.set('to', to);
        const d = await apiGet<PaymentComposition>(`/reports/payment-composition?${qs.toString()}`);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [method, from, to]);

  // Fecha no Esc (o clique fora já fecha pelo overlay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="my-8 w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 shadow-lg"
      >
        {!data ? (
          <p className="text-gray-600">{error ?? 'Carregando…'}</p>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1.5">
                <span className="inline-flex items-center gap-2">
                  <span className="rounded-full bg-gradient-to-r from-indigo-700 to-indigo-500 px-2.5 py-0.5 text-xs font-extrabold tracking-wide text-white">
                    {paymentMethodLabel(method)}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600">
                    {data.rows.length} {data.rows.length === 1 ? 'lançamento' : 'lançamentos'}
                  </span>
                </span>
                <h2 className="text-xl font-extrabold">Composição do recebido</h2>
                <span className="text-xs text-gray-500">
                  O que compõe o &ldquo;Recebido&rdquo; desta forma no período — vendas à vista e
                  recebimentos de dívida.
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            {/* Total — bate com o "Recebido" desta forma na tabela (regime de caixa, ADR-019). */}
            <div className="flex items-center justify-between rounded-2xl bg-emerald-50 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                Recebido nesta forma
              </p>
              <p className="text-lg font-extrabold tabular-nums text-emerald-700">{BRL(data.total)}</p>
            </div>

            {/* Extrato — mais recente primeiro (o servidor já ordena por data). */}
            {data.rows.length === 0 ? (
              <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
                Nenhum lançamento nesta forma no período.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.rows.map((r, idx) => (
                  <li key={idx} className="rounded-lg border border-gray-100 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {r.tipo === 'venda' ? 'Venda à vista' : 'Recebimento de dívida'}
                          <span className="ml-1 font-normal text-gray-500">· {r.ref}</span>
                        </p>
                        <p className="truncate text-xs text-gray-500">{r.descricao}</p>
                        <p className="text-xs text-gray-400">{DATETIME(r.data)}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            r.tipo === 'venda'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {r.tipo === 'venda' ? 'à vista' : 'dívida'}
                        </span>
                        <p className="font-semibold tabular-nums text-green-700">+{BRL(r.valor)}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
