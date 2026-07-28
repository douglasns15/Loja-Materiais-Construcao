'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PAYMENT_METHOD_LABELS,
  RECEIVABLE_STATUS_LABELS,
  receiveReceivableSchema,
  type PaymentMethod,
  type ReceivableDetail,
  type ReceivableRow,
  type ReceivablesPage,
} from '@nexoloja/shared';
import { apiGet, apiPost } from '@/lib/api';
import { OfflineNotice } from '@/components/OfflineNotice';
import { MoneyInput } from '@/components/MoneyInput';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type StatusFilter = 'open' | 'paid' | 'all';

/** Uma conta está VENCIDA quando tem vencimento e ele já passou (comparando só a data). */
function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate) < today;
}

/**
 * Contas a Receber — venda a prazo (ADR-019). Lista paginada (cursor keyset, como as demais telas
 * grandes) com busca por cliente e filtro de situação (em aberto / quitadas / todas). Clicar no
 * cliente abre o **detalhe** (itens da venda + histórico de recebimentos com data/hora). Receber
 * (total ou parcial) abate o saldo; em dinheiro vira Suprimento no caixa (feito no servidor).
 * Online-only nesta fatia.
 */
export default function ContasAReceberPage() {
  const [rows, setRows] = useState<ReceivableRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusFilter>('open');
  const [search, setSearch] = useState('');

  // Conta selecionada para receber (painel) + campos do recebimento.
  const [selected, setSelected] = useState<ReceivableRow | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [busy, setBusy] = useState(false);

  // Detalhe da conta (ao clicar no cliente): itens da venda + histórico de recebimentos.
  const [detail, setDetail] = useState<ReceivableDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const query = useCallback(
    (cursor: string | null) => {
      const p = new URLSearchParams({ status });
      if (search.trim()) p.set('q', search.trim());
      if (cursor) p.set('cursor', cursor);
      return `/receivables?${p.toString()}`;
    },
    [status, search],
  );

  const load = useCallback(async () => {
    try {
      const page = await apiGet<ReceivablesPage>(query(null));
      setRows(page.rows);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [query]);

  // Recarrega da 1ª página ao trocar filtro/busca (debounce na busca).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      load();
      return;
    }
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiGet<ReceivablesPage>(query(nextCursor));
      setRows((prev) => [...prev, ...page.rows]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const totalOwed = useMemo(
    () => rows.reduce((acc, r) => acc + (r.status === 'OPEN' ? r.balance : 0), 0),
    [rows],
  );

  async function openDetail(id: string) {
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await apiGet<ReceivableDetail>(`/receivables/${id}`);
      setDetail(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }

  function openReceive(r: ReceivableRow) {
    setSelected(r);
    setAmount(String(r.balance));
    setMethod('CASH');
    setError(null);
    setInfo(null);
  }

  async function onReceive(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    const parsed = receiveReceivableSchema.safeParse({ amount: Number(amount), method });
    if (!parsed.success) {
      setError('Informe um valor de recebimento válido.');
      return;
    }
    if (parsed.data.amount > selected.balance + 0.005) {
      setError(`O valor não pode passar do saldo devedor (${BRL(selected.balance)}).`);
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ fullyPaid: boolean; balance: number }>(
        `/receivables/${selected.id}/receive`,
        parsed.data,
      );
      setInfo(
        res.fullyPaid
          ? `Conta quitada. ✅${method === 'CASH' ? ' O valor entrou no caixa como suprimento.' : ''}`
          : `Recebimento registrado. Saldo restante: ${BRL(res.balance)}.`,
      );
      setSelected(null);
      setAmount('');
      await load();
      // Se o detalhe estava aberto para esta conta, atualiza-o também.
      if (detail && detail.id === selected.id) await openDetail(selected.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-2xl font-bold">Contas a Receber</h1>

      <OfflineNotice />

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {info && <p className="mb-4 rounded-lg bg-gray-100 px-3 py-2 text-sm">{info}</p>}

      {/* Busca + filtro de situação. */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente…"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="flex gap-1">
          {(['open', 'paid', 'all'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                status === s ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {s === 'open' ? 'Em aberto' : s === 'paid' ? 'Quitadas' : 'Todas'}
            </button>
          ))}
        </div>
      </div>

      {status === 'open' && rows.length > 0 && (
        <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">Total a receber (nesta página)</p>
          <p className="mt-1 text-2xl font-bold">{BRL(totalOwed)}</p>
        </div>
      )}

      {!loaded ? (
        <p className="text-gray-500">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-gray-500 shadow-sm">
          {search.trim()
            ? 'Nenhuma conta encontrada para essa busca.'
            : status === 'open'
              ? 'Nenhuma conta a receber em aberto. As vendas a prazo aparecem aqui.'
              : 'Nenhuma conta nesta situação.'}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Vencimento</th>
                  <th className="px-4 py-3 text-right">Original</th>
                  <th className="px-4 py-3 text-right">Recebido</th>
                  <th className="px-4 py-3 text-right">Saldo</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const overdue = r.status === 'OPEN' && isOverdue(r.dueDate);
                  return (
                    <tr key={r.id} className="border-b border-gray-50">
                      <td className="px-4 py-3">
                        {/* Clicar no cliente abre o detalhe da conta. */}
                        <button
                          type="button"
                          onClick={() => openDetail(r.id)}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {r.customerName ?? '—'}
                        </button>
                        <span className="block text-xs text-gray-400">
                          {new Date(r.createdAt).toLocaleDateString('pt-BR')}
                          {r.status !== 'OPEN' ? ` · ${RECEIVABLE_STATUS_LABELS[r.status]}` : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.dueDate ? (
                          <span className={overdue ? 'font-medium text-red-600' : 'text-gray-600'}>
                            {new Date(r.dueDate).toLocaleDateString('pt-BR')}
                            {overdue ? ' · vencida' : ''}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{BRL(r.originalAmount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-green-700">
                        {BRL(r.settledAmount)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {BRL(r.balance)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.status === 'OPEN' ? (
                          <button
                            type="button"
                            onClick={() => openReceive(r)}
                            className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
                          >
                            Receber
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">quitada</span>
                        )}
                      </td>
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

      {/* Painel de recebimento (total ou parcial). */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setSelected(null)}
        >
          <form
            onSubmit={onReceive}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-lg"
          >
            <div>
              <h2 className="text-lg font-bold">Receber de {selected.customerName ?? 'cliente'}</h2>
              <p className="text-sm text-gray-500">
                Saldo devedor: <strong>{BRL(selected.balance)}</strong>
              </p>
            </div>

            <div>
              <label htmlFor="valor" className="mb-1 block text-sm text-gray-600">
                Valor a receber
              </label>
              <MoneyInput
                id="valor"
                value={amount}
                onChange={setAmount}
                placeholder="0,00"
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
              <button
                type="button"
                onClick={() => setAmount(String(selected.balance))}
                className="mt-1 text-xs font-medium text-blue-600 hover:underline"
              >
                Receber tudo ({BRL(selected.balance)})
              </button>
            </div>

            <div>
              <label htmlFor="forma" className="mb-1 block text-sm text-gray-600">
                Forma de pagamento
              </label>
              <select
                id="forma"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              >
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
              {method === 'CASH' && (
                <p className="mt-1 text-xs text-gray-400">
                  Em dinheiro, entra no caixa aberto como suprimento.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg border border-gray-300 py-2 font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {busy ? 'Recebendo…' : 'Receber'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Detalhe da conta (itens da venda + histórico de recebimentos). */}
      {(detail || detailLoading) && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
          onClick={() => setDetail(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="my-8 w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-lg"
          >
            {detailLoading || !detail ? (
              <p className="text-gray-500">Carregando…</p>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-bold">{detail.customerName ?? 'Cliente'}</h2>
                    <p className="text-xs text-gray-500">
                      Venda de{' '}
                      {new Date(detail.orderCreatedAt ?? detail.createdAt).toLocaleString('pt-BR')}
                      {detail.createdByName ? ` · ${detail.createdByName}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetail(null)}
                    className="text-gray-400 hover:text-gray-700"
                    aria-label="Fechar"
                  >
                    ✕
                  </button>
                </div>

                {/* Situação da dívida. */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-xs text-gray-500">Original</p>
                    <p className="font-semibold tabular-nums">{BRL(detail.originalAmount)}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-xs text-gray-500">Recebido</p>
                    <p className="font-semibold tabular-nums text-green-700">
                      {BRL(detail.settledAmount)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-xs text-gray-500">Saldo</p>
                    <p className="font-semibold tabular-nums">{BRL(detail.balance)}</p>
                  </div>
                </div>
                <p className="text-sm">
                  Situação:{' '}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      detail.status === 'PAID'
                        ? 'bg-green-100 text-green-700'
                        : detail.status === 'CANCELLED'
                          ? 'bg-gray-100 text-gray-600'
                          : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {RECEIVABLE_STATUS_LABELS[detail.status]}
                  </span>
                  {detail.dueDate && (
                    <span className="ml-2 text-gray-500">
                      Vence em {new Date(detail.dueDate).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </p>

                {/* Itens da venda (a "dívida" detalhada). */}
                <div>
                  <h3 className="mb-1 text-sm font-semibold">Itens da venda</h3>
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {detail.items.map((it, idx) => (
                      <li key={idx} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="min-w-0 truncate">
                          {Number(it.quantity)}× {it.productName}
                        </span>
                        <span className="shrink-0 tabular-nums">{BRL(it.total)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-gray-400">
                    A mercadoria foi entregue na venda (a venda a prazo adia o pagamento, não a
                    entrega).
                  </p>
                </div>

                {/* Histórico de recebimentos (com data e hora). */}
                <div>
                  <h3 className="mb-1 text-sm font-semibold">Recebimentos</h3>
                  {detail.payments.length === 0 ? (
                    <p className="text-sm text-gray-500">Nenhum recebimento ainda.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                      {detail.payments.map((p) => (
                        <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                          <span>
                            <span className="text-gray-700">
                              {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                            </span>
                            <span className="block text-xs text-gray-400">
                              {new Date(p.paidAt).toLocaleString('pt-BR')}
                              {p.receivedByName ? ` · ${p.receivedByName}` : ''}
                            </span>
                          </span>
                          <span className="shrink-0 font-medium tabular-nums text-green-700">
                            {BRL(p.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {detail.status === 'OPEN' && (
                  <button
                    type="button"
                    onClick={() => {
                      const r: ReceivableRow = {
                        id: detail.id,
                        orderId: detail.orderId,
                        customerId: detail.customerId,
                        customerName: detail.customerName,
                        originalAmount: detail.originalAmount,
                        settledAmount: detail.settledAmount,
                        balance: detail.balance,
                        status: detail.status,
                        dueDate: detail.dueDate,
                        createdAt: detail.createdAt,
                        createdByName: detail.createdByName,
                      };
                      openReceive(r);
                    }}
                    className="w-full rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800"
                  >
                    Receber
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
