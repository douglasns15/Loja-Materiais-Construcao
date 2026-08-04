'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PAYMENT_METHOD_LABELS,
  RECEIVABLE_STATUS_LABELS,
  receiveReceivableSchema,
  type AccountFilter,
  type CustomerAccountRow,
  type CustomerAccountsResponse,
  type PaymentMethod,
  type ReceivableRow,
  type ReceivablesPage,
  type ReceiveAccountResult,
} from '@nexoloja/shared';
import { apiGet, apiPost } from '@/lib/api';
import { OfflineNotice } from '@/components/OfflineNotice';
import { MoneyInput } from '@/components/MoneyInput';
import { ReceivableDetailModal } from '@/components/ReceivableDetailModal';
import { CustomerAccountModal } from '@/components/CustomerAccountModal';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type StatusFilter = 'open' | 'paid' | 'all';
/** Visão: por CLIENTE (conta que soma — ADR-022) ou por VENDA (dívida a dívida, o histórico). */
type View = 'accounts' | 'debts';

/** Uma conta/dívida está VENCIDA quando tem vencimento e ele já passou (comparando só a data). */
function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate) < today;
}

/**
 * Contas a Receber — venda a prazo (ADR-019) + conta do cliente (ADR-022, Fatia A). Duas visões:
 * **Por cliente** (padrão): a "conta" implícita de cada cliente — o saldo somado de todas as suas
 * dívidas em aberto; "Receber" abate a conta inteira do mais antigo pro mais novo (FIFO). **Por
 * venda**: a lista dívida a dívida (paginada, com em aberto/quitadas/todas e o detalhe da venda).
 * Em dinheiro, o recebimento vira Suprimento no caixa (feito no servidor). Online-only nesta fatia.
 */
export default function ContasAReceberPage() {
  const [view, setView] = useState<View>('accounts');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // ---- Visão POR CLIENTE (contas) ----
  const [accounts, setAccounts] = useState<CustomerAccountRow[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  // Filtro da conta (ADR-022, Fatia C): com dívida (default) / com crédito / todos.
  const [acctFilter, setAcctFilter] = useState<AccountFilter>('debt');
  const [acctSelected, setAcctSelected] = useState<CustomerAccountRow | null>(null);
  // Extrato consolidado da conta (ao clicar no cliente): customerId aberto + sinal de recarga.
  const [accountDetailId, setAccountDetailId] = useState<string | null>(null);
  const [accountReload, setAccountReload] = useState(0);

  // ---- Visão POR VENDA (dívidas) — comportamento anterior, preservado ----
  const [rows, setRows] = useState<ReceivableRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [debtsLoaded, setDebtsLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [selected, setSelected] = useState<ReceivableRow | null>(null);

  // Campos do recebimento (compartilhados: só um painel aberto por vez).
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [busy, setBusy] = useState(false);

  // Detalhe da dívida (ao clicar): id aberto + sinal de recarga (após um recebimento).
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailReload, setDetailReload] = useState(0);

  const loadAccounts = useCallback(async () => {
    try {
      const p = new URLSearchParams({ filter: acctFilter });
      if (search.trim()) p.set('q', search.trim());
      const res = await apiGet<CustomerAccountsResponse>(`/receivables/accounts?${p.toString()}`);
      setAccounts(res.rows);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAccountsLoaded(true);
    }
  }, [search, acctFilter]);

  const debtsQuery = useCallback(
    (cursor: string | null) => {
      const p = new URLSearchParams({ status });
      if (search.trim()) p.set('q', search.trim());
      if (cursor) p.set('cursor', cursor);
      return `/receivables?${p.toString()}`;
    },
    [status, search],
  );

  const loadDebts = useCallback(async () => {
    try {
      const page = await apiGet<ReceivablesPage>(debtsQuery(null));
      setRows(page.rows);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDebtsLoaded(true);
    }
  }, [debtsQuery]);

  // Recarrega a visão ativa ao trocar de aba/filtro/busca (debounce na busca).
  const first = useRef(true);
  useEffect(() => {
    const run = () => (view === 'accounts' ? loadAccounts() : loadDebts());
    if (first.current) {
      first.current = false;
      run();
      return;
    }
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [view, loadAccounts, loadDebts]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiGet<ReceivablesPage>(debtsQuery(nextCursor));
      setRows((prev) => [...prev, ...page.rows]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const totalOwedPage = useMemo(
    () => accounts.reduce((acc, a) => acc + a.totalBalance, 0),
    [accounts],
  );

  // --- Abrir painéis de recebimento ---
  function openReceiveDebt(r: ReceivableRow) {
    setSelected(r);
    setAcctSelected(null);
    setAmount(String(r.balance));
    setMethod('CASH');
    setError(null);
    setInfo(null);
  }
  function openReceiveAccount(a: CustomerAccountRow) {
    setAcctSelected(a);
    setSelected(null);
    setAmount(String(a.totalBalance));
    setMethod('CASH');
    setError(null);
    setInfo(null);
  }

  async function onReceiveDebt(e: React.FormEvent) {
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
      await loadDebts();
      setDetailReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onReceiveAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!acctSelected) return;
    setError(null);
    const parsed = receiveReceivableSchema.safeParse({ amount: Number(amount), method });
    if (!parsed.success) {
      setError('Informe um valor de recebimento válido.');
      return;
    }
    if (parsed.data.amount > acctSelected.totalBalance + 0.005) {
      setError(`O valor não pode passar do saldo da conta (${BRL(acctSelected.totalBalance)}).`);
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<ReceiveAccountResult>(
        `/receivables/accounts/${acctSelected.customerId}/receive`,
        parsed.data,
      );
      const cashNote = method === 'CASH' ? ' O valor entrou no caixa como suprimento.' : '';
      setInfo(
        res.accountCleared
          ? `Conta de ${acctSelected.customerName ?? 'cliente'} quitada. ✅${cashNote}`
          : `Recebido ${BRL(res.received)} (abateu ${res.debtsTouched} ${
              res.debtsTouched === 1 ? 'dívida' : 'dívidas'
            }). Saldo restante: ${BRL(res.remainingBalance)}.${cashNote}`,
      );
      setAcctSelected(null);
      setAmount('');
      await loadAccounts();
      setAccountReload((n) => n + 1); // se o extrato está aberto, recarrega (saldo/atividades mudaram)
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

      {/* Alternância de visão: por cliente (conta que soma) × por venda (dívida a dívida). */}
      <div className="mb-4 inline-flex rounded-lg border border-gray-300 p-0.5">
        {(['accounts', 'debts'] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              view === v ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            {v === 'accounts' ? 'Por cliente' : 'Por venda'}
          </button>
        ))}
      </div>

      {/* Busca + (na visão por venda) filtro de situação. */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente…"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        {view === 'debts' ? (
          <div className="flex gap-1">
            {(['open', 'paid', 'all'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  status === s
                    ? 'bg-gray-900 text-white'
                    : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {s === 'open' ? 'Em aberto' : s === 'paid' ? 'Quitadas' : 'Todas'}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex gap-1">
            {(['debt', 'credit', 'all'] as AccountFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setAcctFilter(f)}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  acctFilter === f
                    ? 'bg-gray-900 text-white'
                    : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {f === 'debt' ? 'Com dívida' : f === 'credit' ? 'Com crédito' : 'Todos'}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === 'accounts'
        ? renderAccounts()
        : renderDebts()}

      {/* Painel de recebimento da CONTA inteira (FIFO — ADR-022). */}
      {acctSelected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setAcctSelected(null)}
        >
          <form
            onSubmit={onReceiveAccount}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-lg"
          >
            <div>
              <h2 className="text-lg font-bold">
                Receber de {acctSelected.customerName ?? 'cliente'}
              </h2>
              <p className="text-sm text-gray-600">
                Saldo da conta: <strong>{BRL(acctSelected.totalBalance)}</strong>
                {acctSelected.openCount > 1 ? (
                  <span className="text-gray-500">
                    {' '}
                    · {acctSelected.openCount} dívidas (abate da mais antiga)
                  </span>
                ) : null}
              </p>
            </div>

            <div>
              <label htmlFor="acct-valor" className="mb-1 block text-sm text-gray-600">
                Valor a receber
              </label>
              <MoneyInput
                id="acct-valor"
                value={amount}
                onChange={setAmount}
                placeholder="0,00"
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
              <button
                type="button"
                onClick={() => setAmount(String(acctSelected.totalBalance))}
                className="mt-1 text-xs font-medium text-blue-600 hover:underline"
              >
                Receber tudo ({BRL(acctSelected.totalBalance)})
              </button>
            </div>

            <div>
              <label htmlFor="acct-forma" className="mb-1 block text-sm text-gray-600">
                Forma de pagamento
              </label>
              <select
                id="acct-forma"
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
                <p className="mt-1 text-xs text-gray-500">
                  Em dinheiro, entra no caixa aberto como suprimento.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAcctSelected(null)}
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

      {/* Painel de recebimento de UMA dívida (ADR-019). */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setSelected(null)}
        >
          <form
            onSubmit={onReceiveDebt}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-lg"
          >
            <div>
              <h2 className="text-lg font-bold">Receber de {selected.customerName ?? 'cliente'}</h2>
              <p className="text-sm text-gray-600">
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
                <p className="mt-1 text-xs text-gray-500">
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

      {/* Extrato consolidado da conta (visão por cliente): timeline de vendas + recebimentos. */}
      {accountDetailId && (
        <CustomerAccountModal
          customerId={accountDetailId}
          onClose={() => setAccountDetailId(null)}
          onReceive={openReceiveAccount}
          reloadSignal={accountReload}
        />
      )}

      {/* Detalhe da dívida (componente reutilizável): itens, recebimentos e observação. */}
      {detailId && (
        <ReceivableDetailModal
          receivableId={detailId}
          onClose={() => setDetailId(null)}
          onReceive={openReceiveDebt}
          reloadSignal={detailReload}
        />
      )}
    </div>
  );

  // -------------------------------------------------------------------------
  // Render helpers (fecham sobre o estado do componente)
  // -------------------------------------------------------------------------

  function renderAccounts() {
    if (!accountsLoaded) return <p className="text-gray-600">Carregando…</p>;
    if (accounts.length === 0) {
      const emptyMsg = search.trim()
        ? 'Nenhuma conta para essa busca.'
        : acctFilter === 'credit'
          ? 'Nenhum cliente com crédito a favor. Créditos de devolução aparecem aqui.'
          : acctFilter === 'all'
            ? 'Nenhuma conta com dívida ou crédito.'
            : 'Nenhuma conta em aberto. As vendas a prazo aparecem aqui, somadas por cliente.';
      return (
        <p className="rounded-2xl bg-white p-6 text-center text-gray-600 shadow-sm">{emptyMsg}</p>
      );
    }
    return (
      <>
        {acctFilter !== 'credit' && (
          <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-600">Total a receber ({accounts.length} clientes)</p>
            <p className="mt-1 text-2xl font-bold">{BRL(totalOwedPage)}</p>
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-600">
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Vencimento mais próximo</th>
                <th className="px-4 py-3 text-right">Dívidas</th>
                <th className="px-4 py-3 text-right">Saldo da conta</th>
                <th className="px-4 py-3 text-right">Crédito</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const overdue = isOverdue(a.nextDueDate);
                return (
                  <tr key={a.customerId} className="border-b border-gray-50">
                    <td className="px-4 py-3">
                      {/* Clicar no cliente abre o extrato consolidado da conta. */}
                      <button
                        type="button"
                        onClick={() => setAccountDetailId(a.customerId)}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {a.customerName ?? '—'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {a.nextDueDate ? (
                        <span className={overdue ? 'font-medium text-red-600' : 'text-gray-600'}>
                          {new Date(a.nextDueDate).toLocaleDateString('pt-BR')}
                          {overdue ? ' · vencida' : ''}
                        </span>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">{a.openCount}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {a.totalBalance > 0 ? BRL(a.totalBalance) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {a.creditBalance > 0 ? (
                        <span className="font-medium text-green-700">{BRL(a.creditBalance)}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {a.totalBalance > 0 ? (
                        <button
                          type="button"
                          onClick={() => openReceiveAccount(a)}
                          className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
                        >
                          Receber
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function renderDebts() {
    if (!debtsLoaded) return <p className="text-gray-600">Carregando…</p>;
    if (rows.length === 0) {
      return (
        <p className="rounded-2xl bg-white p-6 text-center text-gray-600 shadow-sm">
          {search.trim()
            ? 'Nenhuma conta encontrada para essa busca.'
            : status === 'open'
              ? 'Nenhuma conta a receber em aberto. As vendas a prazo aparecem aqui.'
              : 'Nenhuma conta nesta situação.'}
        </p>
      );
    }
    return (
      <>
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-600">
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
                      <button
                        type="button"
                        onClick={() => setDetailId(r.id)}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {r.customerName ?? '—'}
                      </button>
                      <span className="block text-xs text-gray-500">
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
                        <span className="text-gray-500">—</span>
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
                          onClick={() => openReceiveDebt(r)}
                          className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
                        >
                          Receber
                        </button>
                      ) : (
                        <span className="text-xs text-gray-500">quitada</span>
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
    );
  }
}
