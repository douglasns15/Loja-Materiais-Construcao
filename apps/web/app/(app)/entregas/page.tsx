'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatOrderNumber,
  FULFILLMENT_STATUS_LABELS,
  type DeliveriesPage,
  type DeliveryOrderRow,
} from '@nexoloja/shared';
import { apiGet } from '@/lib/api';
import { OfflineNotice } from '@/components/OfflineNotice';
import { DeliveryDetailModal } from '@/components/DeliveryDetailModal';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type StatusFilter = 'pending' | 'completed' | 'all';

/** Uma previsão está atrasada quando já passou e ainda há item a retirar. */
function isLate(scheduledPickupAt: string | null, itemsPending: number): boolean {
  if (!scheduledPickupAt || itemsPending === 0) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(scheduledPickupAt) < today;
}

/**
 * Entregas / Retiradas (ADR-020). Pedidos com retirada/entrega futura — a mercadoria foi reservada
 * na venda e sai, parcial, aqui. Lista paginada (cursor keyset) com filtro de situação (a retirar /
 * finalizadas / todas), na mesma lógica de Contas a Receber. Clicar no pedido abre o detalhe com o
 * LOG completo (o que já saiu, o que falta, quando e por quem) e permite dar baixa. Online-only.
 */
export default function EntregasPage() {
  const [rows, setRows] = useState<DeliveryOrderRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusFilter>('pending');
  const [detailId, setDetailId] = useState<string | null>(null);

  const query = useCallback(
    (cursor: string | null) => {
      const p = new URLSearchParams({ status });
      if (cursor) p.set('cursor', cursor);
      return `/deliveries?${p.toString()}`;
    },
    [status],
  );

  const load = useCallback(async () => {
    try {
      const page = await apiGet<DeliveriesPage>(query(null));
      setRows(page.rows);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [query]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
    }
    load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiGet<DeliveriesPage>(query(nextCursor));
      setRows((prev) => [...prev, ...page.rows]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-2xl font-bold text-transparent">
        Entregas / Retiradas
      </h1>
      <p className="mb-5 text-sm text-gray-500">
        Vendas com retirada ou entrega posterior — acompanhe o que já saiu, o que falta e dê baixa.
      </p>

      <OfflineNotice />

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* Filtro de situação (controle segmentado — identidade das telas repaginadas). */}
      <div className="mb-4 inline-flex gap-0.5 rounded-xl bg-gray-100 p-1">
        {(['pending', 'completed', 'all'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${
              status === s ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-white/60'
            }`}
          >
            {s === 'pending' ? 'A retirar' : s === 'completed' ? 'Finalizadas' : 'Todas'}
          </button>
        ))}
      </div>

      {!loaded ? (
        <p className="text-gray-600">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-gray-600 shadow-sm">
          {status === 'pending'
            ? 'Nenhuma retirada pendente. As vendas com retirada/entrega posterior aparecem aqui.'
            : 'Nenhum pedido nesta situação.'}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-md">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-indigo-600 text-left text-white">
                  <th className="px-4 py-3">Cliente / venda</th>
                  <th className="px-4 py-3">Previsão</th>
                  <th className="px-4 py-3 text-center">Itens a retirar</th>
                  <th className="px-4 py-3">Situação</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const late = isLate(r.scheduledPickupAt, r.itemsPending);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setDetailId(r.id)}
                      className="cursor-pointer border-b border-gray-50 hover:bg-gray-50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-indigo-700">
                            {r.customerName ?? 'Cliente não informado'}
                          </span>
                          {/* Código da venda (ADR-023) — identifica o registro. */}
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold tabular-nums text-indigo-600">
                            {formatOrderNumber(r.orderNumber)}
                          </span>
                        </div>
                        <span className="block text-xs text-gray-500">
                          {new Date(r.createdAt).toLocaleDateString('pt-BR')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.perItemSchedule ? (
                          <span className="text-xs text-gray-500">por item</span>
                        ) : r.scheduledPickupAt ? (
                          <span className={late ? 'font-medium text-red-600' : 'text-gray-600'}>
                            {new Date(r.scheduledPickupAt).toLocaleDateString('pt-BR')}
                            {late ? ' · atrasada' : ''}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        {r.itemsPending} / {r.itemsCount}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.fulfillmentStatus === 'COMPLETED'
                              ? 'bg-green-100 text-green-800'
                              : r.fulfillmentStatus === 'PARTIAL'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-indigo-100 text-indigo-800'
                          }`}
                        >
                          {FULFILLMENT_STATUS_LABELS[r.fulfillmentStatus]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{BRL(r.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {nextCursor && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {loadingMore ? 'Carregando…' : 'Mostrar mais'}
              </button>
            </div>
          )}
        </>
      )}

      {detailId && (
        <DeliveryDetailModal
          orderId={detailId}
          onClose={() => setDetailId(null)}
          onDelivered={load}
        />
      )}
    </div>
  );
}
