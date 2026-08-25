'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  formatDebtNumber,
  formatOrderNumber,
  PAYMENT_METHOD_LABELS,
  type DebtDetail,
  type PaymentMethod,
} from '@nexoloja/shared';
import { apiGet } from '@/lib/api';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Um evento do extrato de uma dívida (ADR-026): venda a prazo (+), recebimento (−) ou devolução (−). */
type Ev =
  | { kind: 'sale'; at: string; amount: number; orderId: string; orderNumber: number | null; items: { productName: string; quantity: string; total: string }[] }
  | { kind: 'payment'; at: string; amount: number; method: string; by: string | null }
  | { kind: 'return'; at: string; amount: number; reason: string; by: string | null; items: { productName: string; quantity: string; total: string }[] };

const saleCode = (n: number | null, id: string) => formatOrderNumber(n) || `#${id.slice(0, 8)}`;

/**
 * Detalhe (só leitura) de UMA dívida do cliente pelo id (ADR-026) — usado na aba **Quitadas**.
 * Cabeçalho com o código `D-000X` + status, resumo (original/recebido/devolvido/saldo) e o extrato
 * cronológico (vendas com itens, recebimentos e devoluções). Reúsa `GET /receivables/debts/:id`.
 */
export function DebtDetailModal({ debtId, onClose }: { debtId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<DebtDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await apiGet<DebtDetail>(`/receivables/debts/${debtId}`);
        if (!cancelled) setDetail(d);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debtId]);

  const timeline = useMemo(() => {
    if (!detail) return [] as Ev[];
    const events: Ev[] = [];
    for (const r of detail.receivables) {
      events.push({
        kind: 'sale',
        at: r.createdAt,
        amount: Number(r.originalAmount),
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        items: r.items.map((it) => ({ productName: it.productName, quantity: it.quantity, total: it.total })),
      });
      for (const p of r.payments) {
        events.push({ kind: 'payment', at: p.paidAt, amount: Number(p.amount), method: p.method, by: p.receivedByName });
      }
    }
    for (const rt of detail.returns ?? []) {
      events.push({
        kind: 'return',
        at: rt.createdAt,
        amount: Number(rt.abatedAmount),
        reason: rt.reason,
        by: rt.createdByName,
        items: rt.items.map((it) => ({ productName: it.productName, quantity: it.quantity, total: it.total })),
      });
    }
    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return events;
  }, [detail]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 shadow-lg"
      >
        {!detail ? (
          <p className="text-gray-600">{error ?? 'Carregando…'}</p>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1.5">
                <span className="inline-flex items-center gap-2">
                  <span className="rounded-full bg-gradient-to-r from-indigo-700 to-indigo-500 px-2.5 py-0.5 text-xs font-extrabold tracking-wide text-white">
                    {formatDebtNumber(detail.debtNumber)}
                  </span>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">
                    Quitada
                  </span>
                </span>
                <h2 className="text-xl font-extrabold">{detail.customerName ?? 'Cliente'}</h2>
                <span className="text-xs text-gray-500">
                  Aberta em {new Date(detail.openedAt).toLocaleDateString('pt-BR')}
                  {detail.closedAt ? ` · quitada em ${new Date(detail.closedAt).toLocaleDateString('pt-BR')}` : ''}
                  {' · '}
                  {detail.receivables.length} {detail.receivables.length === 1 ? 'venda' : 'vendas'}
                </span>
              </div>
              <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Fechar">
                ✕
              </button>
            </div>

            {/* Resumo da dívida. */}
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-gray-100 sm:grid-cols-4">
              {[
                { k: 'Original', v: detail.originalTotal },
                { k: 'Recebido', v: detail.settledTotal },
                { k: 'Devolvido', v: detail.returnedTotal },
                { k: 'Saldo', v: detail.balance, saldo: true },
              ].map((c) => (
                <div key={c.k} className={`p-3 ${c.saldo ? 'bg-emerald-50' : 'bg-white'}`}>
                  <p className={`text-[11px] font-bold uppercase tracking-wide ${c.saldo ? 'text-emerald-700' : 'text-gray-500'}`}>
                    {c.k}
                  </p>
                  <p className={`tabular-nums ${c.saldo ? 'text-lg font-extrabold text-emerald-700' : 'text-base font-bold text-gray-800'}`}>
                    {BRL(c.v)}
                  </p>
                </div>
              ))}
            </div>

            {/* Extrato. */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Extrato da dívida</h3>
              <ul className="space-y-2">
                {timeline.map((e, idx) => (
                  <li key={idx} className="rounded-lg border border-gray-100 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {e.kind === 'sale' ? (
                            <>
                              Venda a prazo
                              <span className="ml-1 font-normal text-gray-500">
                                · {e.items.length} {e.items.length === 1 ? 'item' : 'itens'} · {saleCode(e.orderNumber, e.orderId)}
                              </span>
                            </>
                          ) : e.kind === 'return' ? (
                            <>
                              Devolução
                              <span className="ml-1 font-normal text-gray-500">
                                · {e.items.length} {e.items.length === 1 ? 'item' : 'itens'}
                                {e.by ? ` · ${e.by}` : ''}
                              </span>
                            </>
                          ) : (
                            <>
                              Recebimento
                              <span className="ml-1 font-normal text-gray-500">
                                · {PAYMENT_METHOD_LABELS[e.method as PaymentMethod] ?? e.method}
                                {e.by ? ` · ${e.by}` : ''}
                              </span>
                            </>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">{new Date(e.at).toLocaleString('pt-BR')}</p>
                        {e.kind === 'return' && <p className="mt-0.5 text-xs text-gray-500">Motivo: {e.reason}</p>}
                      </div>
                      <p
                        className={`shrink-0 font-semibold tabular-nums ${
                          e.kind === 'sale' ? 'text-gray-800' : e.kind === 'return' ? 'text-amber-700' : 'text-green-700'
                        }`}
                      >
                        {e.kind === 'sale' ? '+' : '−'}
                        {BRL(Math.abs(e.amount))}
                      </p>
                    </div>
                    {e.kind === 'sale' && e.items.length > 0 && (
                      <ul className="mt-2 divide-y divide-gray-50 rounded-lg bg-gray-50/60">
                        {e.items.map((it, i) => (
                          <li key={i} className="flex items-center justify-between px-3 py-1.5 text-sm">
                            <span className="min-w-0 truncate text-gray-700">
                              {Number(it.quantity)}× {it.productName}
                            </span>
                            <span className="shrink-0 tabular-nums text-gray-600">{BRL(it.total)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
