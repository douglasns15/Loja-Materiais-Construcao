'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PAYMENT_METHOD_LABELS,
  type CashSessionReport,
  type PaymentMethod,
  type SalesReport,
} from '@nexoloja/shared';
import { apiGet } from '@/lib/api';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';

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

/**
 * Célula "Fechado em" com popover do turno (ADR-010): abertura/fechamento + quem abriu/fechou.
 * Funciona no desktop (hover do mouse) e no celular/PWA (toque abre/fecha). Fecha ao tocar fora,
 * Esc, rolar ou redimensionar. Usa `position: fixed` (calculado do gatilho) para não ser cortado
 * pelo `overflow-x-auto` da tabela. Não duplica as colunas financeiras — só o que não está na tabela.
 */
function CashSessionSummary({
  s,
  children,
}: {
  s: CashSessionReport;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<number | null>(null);
  const open = pos !== null;

  const clearTimer = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clearTimer();
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 260;
    // Encaixa na viewport (celular estreito): nunca deixa o popover sair pela direita/esquerda.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ top: r.bottom + 6, left });
  }, [clearTimer]);

  const hide = useCallback(() => {
    clearTimer();
    setPos(null);
  }, [clearTimer]);

  const scheduleHide = useCallback(() => {
    clearTimer();
    hideTimer.current = window.setTimeout(() => setPos(null), 150);
  }, [clearTimer]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: Event) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open, hide]);

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={() => (open ? hide() : show())}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') show();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') scheduleHide();
        }}
        className="cursor-help border-b border-dotted border-gray-400 text-left text-gray-600 hover:text-gray-900"
      >
        {children}
      </button>
      {open && pos && (
        <div
          role="tooltip"
          onPointerEnter={clearTimer}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') scheduleHide();
          }}
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-30 w-[260px] rounded-lg border border-gray-200 bg-white p-3 text-left text-xs shadow-xl"
        >
          <p className="mb-2 font-semibold text-gray-700">Turno do caixa</p>
          <dl className="space-y-2">
            <div>
              <dt className="text-gray-400">Aberto</dt>
              <dd className="text-gray-700">
                {DATETIME(s.openedAt)}
                <span className="text-gray-500"> · por {s.openedByName ?? 'não informado'}</span>
              </dd>
            </div>
            <div>
              <dt className="text-gray-400">Fechado</dt>
              <dd className="text-gray-700">
                {DATETIME(s.closedAt)}
                <span className="text-gray-500"> · por {s.closedByName ?? 'não informado'}</span>
              </dd>
            </div>
          </dl>
        </div>
      )}
    </>
  );
}

export default function RelatoriosPage() {
  const online = useOnline();
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

      {/* Tela online-only (ADR-012 (c)): offline mostra o aviso de rede, não o erro cru. */}
      <OfflineNotice />

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

      {error && online && <p className="mb-4 text-sm text-red-600">{error}</p>}

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
      <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-sm">
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
      <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-sm">
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
                  <td className="px-4 py-2 text-gray-500">
                    {/* Popover do turno (ADR-010): abertura/fechamento + quem abriu/fechou.
                        Hover no desktop, toque no celular/PWA; não duplica as colunas financeiras. */}
                    <CashSessionSummary s={s}>{DATETIME(s.closedAt)}</CashSessionSummary>
                    {/* CS-4 (ADR-012 §b): vendas offline anexadas após o fechamento → reconciliar. */}
                    {s.lateSalesCount > 0 && (
                      <span
                        className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                        title="Vendas offline lançadas neste caixa após o fechamento (conferir na reconciliação)"
                      >
                        {s.lateSalesCount} após fechamento · {BRL(s.lateSalesTotal)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">{BRL(s.openingAmount)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">
                    {BRL(s.expectedAmount)}
                    {/* CS-5: esperado ajustado quando houve vendas em dinheiro após o fechamento. */}
                    {s.lateSalesCount > 0 && s.lateCashSalesTotal > 0 && (
                      <span
                        className="mt-0.5 block text-xs text-amber-700"
                        title={`Esperado + dinheiro das vendas tardias (${BRL(s.lateCashSalesTotal)})`}
                      >
                        ajust. {BRL(s.adjustedExpected)}
                      </span>
                    )}
                  </td>
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
                    {/* CS-5: divergência recalculada contra o esperado ajustado. */}
                    {s.lateSalesCount > 0 && s.lateCashSalesTotal > 0 && (
                      <span
                        className={`mt-0.5 block text-xs ${
                          s.adjustedDivergence === 0
                            ? 'text-gray-400'
                            : s.adjustedDivergence > 0
                              ? 'text-green-700'
                              : 'text-red-700'
                        }`}
                        title="Divergência recalculada incluindo o dinheiro das vendas tardias"
                      >
                        ajust. {s.adjustedDivergence > 0 ? '+' : ''}
                        {BRL(s.adjustedDivergence)}
                      </span>
                    )}
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
