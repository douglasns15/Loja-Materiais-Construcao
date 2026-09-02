'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatDateBr,
  formatDebtNumber,
  isDatePast,
  PAYMENT_METHOD_LABELS,
  receiveReceivableSchema,
  type AccountFilter,
  type CustomerAccountDetail,
  type CustomerAccountRow,
  type CustomerAccountsResponse,
  type DebtListRow,
  type DebtsPage,
  type PaymentMethod,
  type ReceivableItem,
  type ReceiveAccountResult,
} from '@nexoloja/shared';
import { apiGet, apiPost } from '@/lib/api';
import { OfflineNotice } from '@/components/OfflineNotice';
import { MoneyInput } from '@/components/MoneyInput';
import { CustomerAccountModal } from '@/components/CustomerAccountModal';
import { DebtDetailModal } from '@/components/DebtDetailModal';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Aba: dívidas EM ABERTO (a conta do cliente = a dívida aberta — ADR-026) ou QUITADAS (arquivadas). */
type Tab = 'open' | 'paid';

/** Formas de cartão — as que podem ter acréscimo do produto (ADR-016 × ADR-022, Fatia C.3). */
function isCardMethod(m: PaymentMethod): boolean {
  return m === 'DEBIT_CARD' || m === 'CREDIT_CARD';
}

/**
 * Contas a Receber — a DÍVIDA do cliente como conta-corrente (ADR-026, código `D-000X`). Visão
 * única por cliente, com abas **Em aberto** (a dívida aberta de cada cliente — soma as vendas a
 * prazo; "Receber" abate o saldo do mais antigo pro mais novo, FIFO) e **Quitadas** (dívidas
 * arquivadas — todas as vendas que a compunham juntas). O detalhe (resumo + extrato) abre num
 * painel. Em dinheiro, o recebimento vira Suprimento no caixa. Online-only nesta fatia.
 */
export default function ContasAReceberPage() {
  const [tab, setTab] = useState<Tab>('open');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // ---- Aba EM ABERTO (a conta/dívida aberta de cada cliente) ----
  const [accounts, setAccounts] = useState<CustomerAccountRow[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  // Filtro (ADR-022, Fatia C): com dívida (default) / com crédito a favor / todos.
  const [acctFilter, setAcctFilter] = useState<AccountFilter>('debt');
  const [accountDetailId, setAccountDetailId] = useState<string | null>(null);
  const [accountReload, setAccountReload] = useState(0);

  // ---- Aba QUITADAS (dívidas arquivadas — ADR-026) ----
  const [paidDebts, setPaidDebts] = useState<DebtListRow[]>([]);
  const [paidLoaded, setPaidLoaded] = useState(false);
  const [paidCursor, setPaidCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [paidDebtId, setPaidDebtId] = useState<string | null>(null);

  // ---- Painel de recebimento (abate a conta/dívida inteira, FIFO) ----
  const [acctSelected, setAcctSelected] = useState<CustomerAccountRow | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [busy, setBusy] = useState(false);
  // Acréscimo de cartão ao receber (ADR-022, Fatia C.3): itens da dívida (p/ o aviso) + valor MANUAL.
  const [debtItems, setDebtItems] = useState<ReceivableItem[]>([]);
  const [surchargeInput, setSurchargeInput] = useState('');

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

  const paidQuery = useCallback(
    (cursor: string | null) => {
      const p = new URLSearchParams({ status: 'paid' });
      if (search.trim()) p.set('q', search.trim());
      if (cursor) p.set('cursor', cursor);
      return `/receivables/debts?${p.toString()}`;
    },
    [search],
  );

  const loadPaid = useCallback(async () => {
    try {
      const page = await apiGet<DebtsPage>(paidQuery(null));
      setPaidDebts(page.rows);
      setPaidCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPaidLoaded(true);
    }
  }, [paidQuery]);

  // Recarrega a aba ativa ao trocar de aba/filtro/busca (debounce na busca).
  const first = useRef(true);
  useEffect(() => {
    const run = () => (tab === 'open' ? loadAccounts() : loadPaid());
    if (first.current) {
      first.current = false;
      run();
      return;
    }
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [tab, loadAccounts, loadPaid]);

  async function loadMorePaid() {
    if (!paidCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiGet<DebtsPage>(paidQuery(paidCursor));
      setPaidDebts((prev) => [...prev, ...page.rows]);
      setPaidCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const totalOwed = useMemo(() => accounts.reduce((acc, a) => acc + a.totalBalance, 0), [accounts]);

  function openReceiveAccount(a: CustomerAccountRow) {
    setAcctSelected(a);
    setAmount(String(a.totalBalance));
    setMethod('CASH');
    setSurchargeInput('');
    setDebtItems([]);
    setError(null);
    setInfo(null);
    // Itens de TODAS as dívidas em aberto da conta — p/ o aviso de acréscimo por cartão (C.3).
    apiGet<CustomerAccountDetail>(`/receivables/accounts/${a.customerId}`)
      .then((d) => setDebtItems(d.receivables.flatMap((r) => r.items)))
      .catch(() => setDebtItems([]));
  }

  async function onReceiveAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!acctSelected) return;
    setError(null);
    const surcharge = isCardMethod(method) ? Math.max(0, Number(surchargeInput) || 0) : 0;
    const parsed = receiveReceivableSchema.safeParse({
      amount: Number(amount),
      method,
      ...(surcharge > 0 ? { surcharge } : {}),
    });
    if (!parsed.success) {
      setError('Informe um valor de recebimento válido.');
      return;
    }
    if (parsed.data.amount > acctSelected.totalBalance + 0.005) {
      setError(`O valor não pode passar do saldo da dívida (${BRL(acctSelected.totalBalance)}).`);
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
          ? `Dívida de ${acctSelected.customerName ?? 'cliente'} quitada. ✅${cashNote}`
          : `Recebido ${BRL(res.received)} (abateu ${res.debtsTouched} ${
              res.debtsTouched === 1 ? 'venda' : 'vendas'
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
      <h1 className="mb-1 w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-2xl font-bold text-transparent">
        Contas a Receber
      </h1>
      <p className="mb-5 text-sm text-gray-500">
        A dívida de cada cliente — soma as vendas a prazo, recebe o saldo, e o histórico fica todo aqui.
      </p>

      <OfflineNotice />

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {info && <p className="mb-4 rounded-lg bg-gray-100 px-3 py-2 text-sm">{info}</p>}

      {/* Abas: Em aberto × Quitadas. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-0.5 rounded-xl bg-gray-100 p-1">
          {(['open', 'paid'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${
                tab === t ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-white/60'
              }`}
            >
              {t === 'open' ? 'Em aberto' : 'Quitadas'}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:max-w-xs"
        />
      </div>

      {/* Filtro da conta (só na aba Em aberto): com dívida / com crédito / todos. */}
      {tab === 'open' && (
        <div className="mb-4 flex gap-1">
          {(['debt', 'credit', 'all'] as AccountFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setAcctFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                acctFilter === f
                  ? 'bg-indigo-600 text-white'
                  : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {f === 'debt' ? 'Com dívida' : f === 'credit' ? 'Com crédito' : 'Todos'}
            </button>
          ))}
        </div>
      )}

      {tab === 'open' ? renderOpen() : renderPaid()}

      {/* Painel de recebimento da dívida inteira (FIFO — ADR-022/026). */}
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
              <h2 className="text-lg font-bold">Receber de {acctSelected.customerName ?? 'cliente'}</h2>
              <p className="text-sm text-gray-600">
                Saldo da dívida: <strong>{BRL(acctSelected.totalBalance)}</strong>
                {acctSelected.openCount > 1 ? (
                  <span className="text-gray-500"> · {acctSelected.openCount} vendas (abate da mais antiga)</span>
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
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <button
                type="button"
                onClick={() => setAmount(String(acctSelected.totalBalance))}
                className="mt-1 text-xs font-medium text-indigo-600 hover:underline"
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
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              >
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
              {method === 'CASH' && (
                <p className="mt-1 text-xs text-gray-500">Em dinheiro, entra no caixa aberto como suprimento.</p>
              )}
            </div>

            {renderSurchargeBlock()}

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
                className="rounded-lg bg-emerald-600 py-2 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
              >
                {busy ? 'Recebendo…' : 'Receber'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Detalhe da dívida ABERTA (extrato consolidado + receber). */}
      {accountDetailId && (
        <CustomerAccountModal
          customerId={accountDetailId}
          onClose={() => setAccountDetailId(null)}
          onReceive={openReceiveAccount}
          reloadSignal={accountReload}
        />
      )}

      {/* Detalhe da dívida QUITADA (só leitura). */}
      {paidDebtId && <DebtDetailModal debtId={paidDebtId} onClose={() => setPaidDebtId(null)} />}
    </div>
  );

  // -------------------------------------------------------------------------
  // Render helpers (fecham sobre o estado do componente)
  // -------------------------------------------------------------------------

  /** Bloco de acréscimo de cartão (ADR-022, Fatia C.3): só com forma de cartão E item da dívida com
   *  acréscimo naquela forma; valor MANUAL. Fecha sobre `method`/`debtItems`/`surchargeInput`/`amount`. */
  function renderSurchargeBlock() {
    if (!isCardMethod(method)) return null;
    const perUnit = (it: ReceivableItem) =>
      Number((method === 'DEBIT_CARD' ? it.surchargeDebit : it.surchargeCredit) ?? 0);
    const items = debtItems.filter((it) => perUnit(it) > 0);
    if (items.length === 0) return null;
    const label = method === 'DEBIT_CARD' ? 'débito' : 'crédito';
    const suggested = Number(items.reduce((s, it) => s + perUnit(it) * Number(it.quantity), 0).toFixed(2));
    const surcharge = Math.max(0, Number(surchargeInput) || 0);
    return (
      <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
        <p className="text-xs font-medium text-amber-900">Acréscimo no {label} (cadastro do produto):</p>
        <ul className="space-y-0.5 text-xs text-amber-800">
          {items.map((it, i) => (
            <li key={i}>
              {it.productName} ({Number(it.quantity)}×): +{BRL(perUnit(it))}/un
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="surcharge" className="text-sm text-amber-900">
            Acréscimo a cobrar
          </label>
          <div className="flex items-center gap-1">
            <MoneyInput
              id="surcharge"
              value={surchargeInput}
              onChange={setSurchargeInput}
              placeholder="0,00"
              className="w-28 rounded-lg border border-amber-300 bg-white px-2 py-1 text-right"
            />
            <button
              type="button"
              onClick={() => setSurchargeInput(String(suggested))}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:underline"
              title={`Sugerido: ${BRL(suggested)}`}
            >
              usar sug.
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-amber-200">
          <span className="text-gray-600">Total a receber</span>
          <span className="font-semibold tabular-nums">
            {BRL(Math.max(0, Number(amount) || 0) + surcharge)}
          </span>
        </div>
      </div>
    );
  }

  /** Aba EM ABERTO: cards de dívida por cliente (código D-000X, saldo, nº de vendas, vencimento). */
  function renderOpen() {
    if (!accountsLoaded) return <p className="text-gray-600">Carregando…</p>;
    if (accounts.length === 0) {
      const msg = search.trim()
        ? 'Nenhuma dívida para essa busca.'
        : acctFilter === 'credit'
          ? 'Nenhum cliente com crédito a favor. Créditos de devolução aparecem aqui.'
          : acctFilter === 'all'
            ? 'Nenhuma dívida ou crédito.'
            : 'Nenhuma dívida em aberto. As vendas a prazo aparecem aqui, somadas por cliente.';
      return <p className="rounded-2xl bg-white p-6 text-center text-gray-600 shadow-sm">{msg}</p>;
    }
    return (
      <div className="flex flex-col gap-2.5">
        {accounts.map((a) => {
          const overdue = isDatePast(a.nextDueDate);
          return (
            <div
              key={a.customerId}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-indigo-300"
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => a.debtId && setAccountDetailId(a.customerId)}
                  className="min-w-0 text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-gray-900">{a.customerName ?? '—'}</span>
                    {a.debtNumber != null && (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-600">
                        {formatDebtNumber(a.debtNumber)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {a.openCount > 0
                      ? `${a.openCount} ${a.openCount === 1 ? 'venda' : 'vendas'}${
                          a.oldestCreatedAt
                            ? ` · desde ${new Date(a.oldestCreatedAt).toLocaleDateString('pt-BR')}`
                            : ''
                        }`
                      : 'Sem dívida em aberto'}
                  </p>
                  {a.nextDueDate && (
                    <span
                      className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        overdue ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      ● {overdue ? 'vencida' : 'vence'} {formatDateBr(a.nextDueDate)}
                    </span>
                  )}
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {a.totalBalance > 0 ? (
                    <span className="text-lg font-extrabold tabular-nums text-gray-900">
                      {BRL(a.totalBalance)}
                    </span>
                  ) : a.creditBalance > 0 ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">
                      crédito {BRL(a.creditBalance)}
                    </span>
                  ) : null}
                  {a.totalBalance > 0 && (
                    <button
                      type="button"
                      onClick={() => openReceiveAccount(a)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                    >
                      Receber
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {acctFilter !== 'credit' && totalOwed > 0 && (
          <div className="mt-1 flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Total a receber</span>
            <span className="text-xl font-extrabold tabular-nums text-gray-900">{BRL(totalOwed)}</span>
          </div>
        )}
      </div>
    );
  }

  /** Aba QUITADAS: cards de dívidas arquivadas (código D-000X, total, nº de vendas, quitação). */
  function renderPaid() {
    if (!paidLoaded) return <p className="text-gray-600">Carregando…</p>;
    if (paidDebts.length === 0) {
      return (
        <p className="rounded-2xl bg-white p-6 text-center text-gray-600 shadow-sm">
          {search.trim() ? 'Nenhuma dívida quitada para essa busca.' : 'Nenhuma dívida quitada ainda.'}
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-2.5">
        {paidDebts.map((d) => (
          <button
            key={d.debtId}
            type="button"
            onClick={() => setPaidDebtId(d.debtId)}
            className="rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-gray-900">{d.customerName ?? '—'}</span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-600">
                    {formatDebtNumber(d.debtNumber)}
                  </span>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800">
                    Quitada
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {d.salesCount} {d.salesCount === 1 ? 'venda' : 'vendas'}
                  {d.closedAt ? ` · quitada em ${new Date(d.closedAt).toLocaleDateString('pt-BR')}` : ''}
                </p>
              </div>
              <span className="shrink-0 font-bold tabular-nums text-gray-700">{BRL(d.originalTotal)}</span>
            </div>
          </button>
        ))}

        {paidCursor && (
          <div className="mt-1 text-center">
            <button
              type="button"
              onClick={loadMorePaid}
              disabled={loadingMore}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {loadingMore ? 'Carregando…' : 'Mostrar mais'}
            </button>
          </div>
        )}
      </div>
    );
  }
}
