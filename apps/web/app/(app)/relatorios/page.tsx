'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  paymentMethodLabel,
  type CashMovementRow,
  type CashSessionReport,
  type SalesReport,
} from '@nexoloja/shared';
import { apiGet } from '@/lib/api';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';
import { CashMovementsList } from '@/components/CashMovementsList';
import { PaymentCompositionModal } from '@/components/PaymentCompositionModal';
import { PeriodFilter, defaultRange } from '@/components/PeriodFilter';
import { TopProductsCard } from '@/components/TopProductsCard';

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const DATETIME = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Rótulo amigável da forma de pagamento — inclui "Crédito da loja" (ADR-022, Fatia C). */
const methodLabel = (m: string) => paymentMethodLabel(m);

/**
 * Célula "Fechado em" com popover do turno (ADR-010): abertura/fechamento + quem abriu/fechou.
 * Funciona no desktop (hover do mouse) e no celular/PWA (toque abre/fecha). Fecha ao tocar fora,
 * Esc, rolar ou redimensionar. Usa `position: fixed` (calculado do gatilho) para não ser cortado
 * pelo `overflow-x-auto` da tabela, e VIRA PARA CIMA quando não cabe abaixo (linha perto do rodapé).
 * Não duplica as colunas financeiras — só o que não está na tabela.
 */
function CashSessionSummary({
  s,
  children,
}: {
  s: CashSessionReport;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clearTimer();
    setOpen(true);
  }, [clearTimer]);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
    setPos(null);
  }, [clearTimer]);

  const scheduleHide = useCallback(() => {
    clearTimer();
    hideTimer.current = window.setTimeout(() => {
      setOpen(false);
      setPos(null);
    }, 150);
  }, [clearTimer]);

  // Posiciona o popover só DEPOIS de renderizado, medindo a altura real: encaixa na viewport na
  // horizontal e VIRA PARA CIMA quando não cabe abaixo do gatilho (linha perto do rodapé — antes
  // ficava sempre abaixo e era cortada). `useLayoutEffect` calcula antes da pintura (sem piscar).
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current?.getBoundingClientRect();
    const pop = popRef.current;
    if (!trigger || !pop) return;
    const margin = 8;
    const gap = 6;
    const width = pop.offsetWidth || 260;
    const height = pop.offsetHeight;
    // Nunca deixa sair pela direita/esquerda (celular estreito).
    const left = Math.max(margin, Math.min(trigger.left, window.innerWidth - width - margin));
    const spaceBelow = window.innerHeight - trigger.bottom;
    const fitsBelow = spaceBelow >= height + gap + margin;
    // Prefere abaixo; vira para cima quando não cabe embaixo e há mais espaço em cima.
    let top =
      fitsBelow || spaceBelow >= trigger.top ? trigger.bottom + gap : trigger.top - height - gap;
    // Trava dentro da viewport na vertical (nunca corta topo nem base).
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    setPos({ top, left });
  }, [open]);

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
      {open && (
        <div
          ref={popRef}
          role="tooltip"
          onPointerEnter={clearTimer}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') scheduleHide();
          }}
          style={{
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            // Fica invisível até o layout effect medir e posicionar (evita flash no canto).
            visibility: pos ? 'visible' : 'hidden',
          }}
          className="fixed z-30 w-[260px] rounded-lg border border-gray-200 bg-white p-3 text-left text-xs shadow-xl"
        >
          <p className="mb-2 font-semibold text-gray-700">Turno do caixa</p>
          <dl className="space-y-2">
            <div>
              <dt className="text-gray-500">Aberto</dt>
              <dd className="text-gray-700">
                {DATETIME(s.openedAt)}
                <span className="text-gray-600"> · por {s.openedByName ?? 'não informado'}</span>
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Fechado</dt>
              <dd className="text-gray-700">
                {DATETIME(s.closedAt)}
                <span className="text-gray-600"> · por {s.closedByName ?? 'não informado'}</span>
              </dd>
            </div>
          </dl>
        </div>
      )}
    </>
  );
}

/**
 * Rótulo de seção (mesma identidade do mockup v2): texto em caixa-alta discreto + linha divisória
 * que preenche o restante da largura. Dá ritmo às seções sem competir com o título da tela.
 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center gap-3">
      <span className="text-xs font-extrabold uppercase tracking-wide text-gray-500">{children}</span>
      <span className="h-px flex-1 bg-gray-200" />
    </div>
  );
}

export default function RelatoriosPage() {
  const online = useOnline();
  // Abre em "Hoje" (default das telas com filtro por data). A navegação ‹ › percorre os dias.
  const [range, setRange] = useState(() => defaultRange());
  const [sales, setSales] = useState<SalesReport | null>(null);
  const [sessions, setSessions] = useState<CashSessionReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drill-down do extrato por fechamento: lazy (busca só ao expandir) e cacheado por sessão,
  // para reabrir sem novo request. Um fechamento expandido por vez (toggle).
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [movementsBySession, setMovementsBySession] = useState<Record<string, CashMovementRow[]>>({});
  const [loadingMovements, setLoadingMovements] = useState<string | null>(null);
  // Drill-down por forma de pagamento (Fatia 3): a forma clicada abre a composição num pop-up.
  const [composeMethod, setComposeMethod] = useState<string | null>(null);

  const toggleMovements = useCallback(
    async (sessionId: string) => {
      if (expandedSession === sessionId) {
        setExpandedSession(null);
        return;
      }
      setExpandedSession(sessionId);
      if (movementsBySession[sessionId]) return; // já em cache — não refaz o request
      setLoadingMovements(sessionId);
      try {
        const rows = await apiGet<CashMovementRow[]>(
          `/cash-sessions/movements?sessionId=${sessionId}`,
        );
        setMovementsBySession((prev) => ({ ...prev, [sessionId]: rows }));
      } catch {
        setMovementsBySession((prev) => ({ ...prev, [sessionId]: [] }));
      } finally {
        setLoadingMovements(null);
      }
    },
    [expandedSession, movementsBySession],
  );

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
    <div className="mx-auto max-w-6xl">
      {/* Identidade das telas repaginadas (PDV Opção A): título em gradiente índigo + subtítulo. */}
      <h1 className="mb-1 w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-2xl font-bold text-transparent">
        Relatórios
      </h1>
      <p className="mb-5 text-sm text-gray-500">
        O placar do período — o que entrou, por onde entrou e como fechou cada caixa.
      </p>

      {/* Tela online-only (ADR-012 (c)): offline mostra o aviso de rede, não o erro cru. */}
      <OfflineNotice />

      {/* Seletor de período (‹ Hoje › + atalhos + De/Até) — componente compartilhado. */}
      <div className="mb-6">
        <PeriodFilter value={range} onChange={setRange} />
        {loading && <span className="mt-2 block text-sm text-gray-500">Carregando…</span>}
      </div>

      {error && online && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <SectionLabel>Resultado do período</SectionLabel>

      {/* Cards de resumo de vendas */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          {/* Regime de caixa (ADR-019): dinheiro que entrou no período — inclui recebimentos de
              fiado no dia em que foram recebidos, não a parte a prazo ainda não paga. */}
          <p className="text-xs text-gray-600" title="Dinheiro recebido no período (inclui recebimentos de fiado no dia do recebimento).">
            Recebido no período
          </p>
          <p className="mt-1 text-2xl font-bold">{BRL(sales?.totalRevenue ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-600">Vendas</p>
          <p className="mt-1 text-2xl font-bold">{sales?.salesCount ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-600">Ticket médio</p>
          <p className="mt-1 text-2xl font-bold">{BRL(sales?.averageTicket ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-600">Canceladas</p>
          <p className="mt-1 text-2xl font-bold">{sales?.cancelledCount ?? 0}</p>
        </div>
      </div>

      {/* Informativo (ADR-019): total VENDIDO a prazo no período. É o que foi GERADO naquele
          período, independentemente de já ter sido pago — não muda quando um recebimento é feito
          (o recebimento aparece em "Recebido no período"). Só aparece quando houve venda a prazo. */}
      {sales && sales.creditSalesGenerated > 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
          Vendas a prazo geradas no período:{' '}
          <strong>{BRL(sales.creditSalesGenerated)}</strong> — total vendido a prazo (não muda ao
          receber; os recebimentos entram em &ldquo;Recebido no período&rdquo;).
        </p>
      )}

      <SectionLabel>Composição do recebido</SectionLabel>

      {/* Totais por forma de pagamento */}
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 className="font-semibold">Por forma de pagamento</h2>
          {sales && sales.byPaymentMethod.length > 0 && (
            <span className="text-xs text-gray-500">Clique numa forma para ver a composição</span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-blue-200 text-left text-blue-900">
            <tr>
              <th className="px-4 py-2">Forma</th>
              <th className="px-4 py-2 text-right">Recebido</th>
              <th className="px-4 py-2 text-right">Pagamentos</th>
              <th className="px-4 py-2 text-right">Participação</th>
              <th className="px-4 py-2" aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>
            {!sales || sales.byPaymentMethod.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  Nenhuma venda no período.
                </td>
              </tr>
            ) : (
              sales.byPaymentMethod.map((p) => (
                // Drill-down (Fatia 3): clicar abre a composição daquela forma num pop-up. Linha
                // acessível por teclado (Enter/Espaço) — o `<tr>` vira botão.
                <tr
                  key={p.method}
                  onClick={() => setComposeMethod(p.method)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setComposeMethod(p.method);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Ver composição de ${methodLabel(p.method)}`}
                  className="cursor-pointer border-t border-gray-100 transition hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none"
                >
                  <td className="px-4 py-2 font-medium text-indigo-700">{methodLabel(p.method)}</td>
                  <td className="px-4 py-2 text-right font-medium">{BRL(p.total)}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{p.count}</td>
                  <td className="px-4 py-2 text-right text-gray-600">
                    {p.share.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                  </td>
                  <td className="px-2 py-2 text-right text-gray-400" aria-hidden="true">
                    ›
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SectionLabel>Produtos e clientes</SectionLabel>

      {/* Ranking de produtos (Fatia 5A) — card colapsável com busca e detalhe em pop-up. */}
      <TopProductsCard from={range.from ?? null} to={range.to ?? null} />

      <SectionLabel>Caixa</SectionLabel>

      {/* Fechamentos de caixa */}
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
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
          <thead className="bg-blue-200 text-left text-blue-900">
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
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  Nenhum fechamento de caixa no período.
                </td>
              </tr>
            ) : (
              sessions.map((s) => (
                <Fragment key={s.id}>
                <tr className="border-t border-gray-100">
                  <td className="px-4 py-2 text-gray-600">
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
                    {/* Drill-down do extrato daquele turno (suprimentos/sangrias/devoluções/despesas). */}
                    <button
                      type="button"
                      onClick={() => toggleMovements(s.id)}
                      aria-expanded={expandedSession === s.id}
                      className="mt-1 block text-xs font-medium text-gray-600 hover:text-gray-900"
                    >
                      {expandedSession === s.id ? '▾' : '▸'} movimentações
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right text-gray-600">{BRL(s.openingAmount)}</td>
                  <td className="px-4 py-2 text-right text-gray-600">
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
                        ? 'text-gray-500'
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
                            ? 'text-gray-500'
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
                {expandedSession === s.id && (
                  <tr className="border-t border-gray-100 bg-gray-50">
                    <td colSpan={5} className="px-4 py-3">
                      {loadingMovements === s.id ? (
                        <p className="text-sm text-gray-500">Carregando…</p>
                      ) : (
                        <CashMovementsList
                          movements={movementsBySession[s.id] ?? []}
                          emptyLabel="Nenhuma movimentação neste caixa."
                        />
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pop-up do drill-down por forma de pagamento (Fatia 3). */}
      {composeMethod && (
        <PaymentCompositionModal
          method={composeMethod}
          from={range.from ?? null}
          to={range.to ?? null}
          onClose={() => setComposeMethod(null)}
        />
      )}
    </div>
  );
}
