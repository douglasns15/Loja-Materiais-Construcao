'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PAYMENT_METHOD_LABELS,
  RECEIVABLE_STATUS_LABELS,
  receiveReceivableSchema,
  type PaymentMethod,
  type ReceivableRow,
  type ReceivablesPage,
} from '@nexoloja/shared';
import { apiGet, apiPost } from '@/lib/api';
import { OfflineNotice } from '@/components/OfflineNotice';
import { MoneyInput } from '@/components/MoneyInput';
import { ReceivableDetailModal } from '@/components/ReceivableDetailModal';

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

  // Detalhe da conta (ao clicar no cliente): id aberto + sinal de recarga (após um recebimento).
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailReload, setDetailReload] = useState(0);

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
      // Se o detalhe está aberto, recarrega-o (o saldo/recebimentos mudaram).
      setDetailReload((n) => n + 1);
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
                          onClick={() => setDetailId(r.id)}
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

      {/* Detalhe da conta (componente reutilizável): itens, recebimentos e observação da dívida. */}
      {detailId && (
        <ReceivableDetailModal
          receivableId={detailId}
          onClose={() => setDetailId(null)}
          onReceive={openReceive}
          reloadSignal={detailReload}
        />
      )}
    </div>
  );
}
