'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PAYMENT_METHOD_LABELS,
  type CashSessionReport,
  type PaymentMethod,
  type SalesReport,
} from '@nexoloja/shared';
import { apiGet } from '@/lib/api';

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const DATETIME = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Rótulo amigável da forma de pagamento (cai no código cru se vier algo novo). */
const methodLabel = (m: string) =>
  PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m;

/** Data local no formato YYYY-MM-DD (para os inputs e a query da API). */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Atalhos de período: retornam { from, to } em YYYY-MM-DD. */
function presetRange(preset: 'today' | '7d' | '30d'): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  if (preset === '7d') from.setDate(from.getDate() - 6);
  if (preset === '30d') from.setDate(from.getDate() - 29);
  return { from: isoDay(from), to: isoDay(to) };
}

export default function RelatoriosPage() {
  const [range, setRange] = useState(() => presetRange('30d'));
  const [sales, setSales] = useState<SalesReport | null>(null);
  const [sessions, setSessions] = useState<CashSessionReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (range.from) qs.set('from', range.from);
      if (range.to) qs.set('to', range.to);
      const q = qs.toString() ? `?${qs.toString()}` : '';
      const [s, cs] = await Promise.all([
        apiGet<SalesReport>(`/reports/sales${q}`),
        apiGet<CashSessionReport[]>(`/reports/cash-sessions${q}`),
      ]);
      setSales(s);
      setSessions(cs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  const totalDivergence = useMemo(
    () => sessions.reduce((acc, s) => acc + s.divergence, 0),
    [sessions],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-2xl font-bold">Relatórios</h1>

      {/* Seletor de período */}
      <div className="mb-6 flex flex-wrap items-end gap-2 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex gap-1">
          {(
            [
              ['today', 'Hoje'],
              ['7d', '7 dias'],
              ['30d', '30 dias'],
            ] as const
          ).map(([preset, label]) => {
            const r = presetRange(preset);
            const active = range.from === r.from && range.to === r.to;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className="flex flex-col text-xs text-gray-500">
          De
          <input
            type="date"
            value={range.from}
            max={range.to || undefined}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
            className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        <label className="flex flex-col text-xs text-gray-500">
          Até
          <input
            type="date"
            value={range.to}
            min={range.from || undefined}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
            className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>
        {loading && <span className="pb-2 text-sm text-gray-400">Carregando…</span>}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* Cards de resumo de vendas */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">Faturamento</p>
          <p className="mt-1 text-2xl font-bold">{BRL(sales?.totalRevenue ?? 0)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">Vendas</p>
          <p className="mt-1 text-2xl font-bold">{sales?.salesCount ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">Ticket médio</p>
          <p className="mt-1 text-2xl font-bold">{BRL(sales?.averageTicket ?? 0)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">Canceladas</p>
          <p className="mt-1 text-2xl font-bold">{sales?.cancelledCount ?? 0}</p>
        </div>
      </div>

      {/* Totais por forma de pagamento */}
      <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
        <h2 className="px-4 py-3 font-semibold">Por forma de pagamento</h2>
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2">Forma</th>
              <th className="px-4 py-2 text-right">Recebido</th>
              <th className="px-4 py-2 text-right">Pagamentos</th>
              <th className="px-4 py-2 text-right">Participação</th>
            </tr>
          </thead>
          <tbody>
            {!sales || sales.byPaymentMethod.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  Nenhuma venda no período.
                </td>
              </tr>
            ) : (
              sales.byPaymentMethod.map((p) => (
                <tr key={p.method} className="border-t border-gray-100">
                  <td className="px-4 py-2">{methodLabel(p.method)}</td>
                  <td className="px-4 py-2 text-right font-medium">{BRL(p.total)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{p.count}</td>
                  <td className="px-4 py-2 text-right text-gray-500">
                    {p.share.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Fechamentos de caixa */}
      <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 className="font-semibold">Fechamentos de caixa</h2>
          {sessions.length > 0 && (
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                totalDivergence === 0
                  ? 'bg-gray-100 text-gray-600'
                  : totalDivergence > 0
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
              }`}
            >
              Divergência acumulada: {BRL(totalDivergence)}
            </span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2">Fechado em</th>
              <th className="px-4 py-2 text-right">Abertura</th>
              <th className="px-4 py-2 text-right">Esperado</th>
              <th className="px-4 py-2 text-right">Contado</th>
              <th className="px-4 py-2 text-right">Divergência</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  Nenhum fechamento de caixa no período.
                </td>
              </tr>
            ) : (
              sessions.map((s) => (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 text-gray-500">{DATETIME(s.closedAt)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{BRL(s.openingAmount)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{BRL(s.expectedAmount)}</td>
                  <td className="px-4 py-2 text-right font-medium">{BRL(s.closingAmount)}</td>
                  <td
                    className={`px-4 py-2 text-right font-medium ${
                      s.divergence === 0
                        ? 'text-gray-400'
                        : s.divergence > 0
                          ? 'text-green-700'
                          : 'text-red-700'
                    }`}
                  >
                    {s.divergence > 0 ? '+' : ''}
                    {BRL(s.divergence)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
