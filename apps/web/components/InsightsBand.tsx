'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  INSIGHT_RULE_META,
  INSIGHT_RULE_IDS,
  insightBestCustomer,
  insightCashDivergence,
  insightDominantPaymentMethod,
  insightLowMarginTopProduct,
  insightMonthProjection,
  type Insight,
  type InsightRuleId,
} from '@nexoloja/core';
import {
  paymentMethodLabel,
  type CashSessionReport,
  type ProjectionsReport,
  type SalesReport,
  type TopCustomerRow,
  type TopProductRow,
} from '@nexoloja/shared';
import { apiGet } from '@/lib/api';

const STORAGE_KEY = 'nexoloja:report-insights';

/** Lê as preferências liga/desliga do localStorage (todas ligadas por padrão). Tolerante a erro. */
function loadEnabled(): Record<InsightRuleId, boolean> {
  const base = Object.fromEntries(INSIGHT_RULE_IDS.map((id) => [id, true])) as Record<InsightRuleId, boolean>;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Record<InsightRuleId, boolean>>;
    for (const id of INSIGHT_RULE_IDS) if (typeof saved[id] === 'boolean') base[id] = saved[id]!;
  } catch {
    /* storage indisponível/corrompido — segue com o padrão */
  }
  return base;
}

const CHIP_STYLE: Record<Insight['severity'], string> = {
  info: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
};
const CHIP_ICON: Record<Insight['severity'], string> = { info: '💡', good: '🏆', warn: '⚠️' };

/**
 * Faixa de INSIGHTS configuráveis no topo de Relatórios (v2, Fatia 9). Aplica regras PURAS de `core`
 * sobre os agregados do período; cada regra pode ser ligada/desligada pelo dono (preferência por
 * dispositivo em localStorage — custo-zero). Um insight só aparece quando a condição é REAL. Busca o
 * mínimo extra (top produto/cliente + projeção) e reusa `sales`/`sessions` já carregados na página.
 */
export function InsightsBand({
  sales,
  sessions,
  from,
  to,
}: {
  sales: SalesReport | null;
  sessions: CashSessionReport[];
  from: string | null;
  to: string | null;
}) {
  const [enabled, setEnabled] = useState<Record<InsightRuleId, boolean>>(() =>
    Object.fromEntries(INSIGHT_RULE_IDS.map((id) => [id, true])) as Record<InsightRuleId, boolean>,
  );
  const [configOpen, setConfigOpen] = useState(false);
  const [topProduct, setTopProduct] = useState<TopProductRow[] | null>(null);
  const [topCustomer, setTopCustomer] = useState<TopCustomerRow | null>(null);
  const [projections, setProjections] = useState<ProjectionsReport | null>(null);

  // Carrega as preferências no cliente (evita divergência de hidratação).
  useEffect(() => {
    setEnabled(loadEnabled());
  }, []);

  const toggle = (id: InsightRuleId) => {
    setEnabled((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage indisponível — mantém em memória nesta sessão */
      }
      return next;
    });
  };

  // Dados extras que as regras precisam (top produto p/ margem, top cliente, projeção do mês).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams();
        if (from) qs.set('from', from);
        if (to) qs.set('to', to);
        const q = qs.toString() ? `&${qs.toString()}` : '';
        const [prods, custs, proj] = await Promise.all([
          apiGet<TopProductRow[]>(`/reports/top-products?limit=5${q}`),
          apiGet<TopCustomerRow[]>(`/reports/top-customers?limit=1${q}`),
          apiGet<ProjectionsReport>('/reports/projections'),
        ]);
        if (cancelled) return;
        setTopProduct(prods);
        setTopCustomer(custs[0] ?? null);
        setProjections(proj);
      } catch {
        /* insights são um extra — falha silenciosa não trava a tela */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const totalDivergence = useMemo(
    () => sessions.reduce((acc, s) => acc + s.divergence, 0),
    [sessions],
  );

  // Aplica só as regras LIGADAS; cada uma vira insight quando a condição é real.
  const insights = useMemo(() => {
    const out: Insight[] = [];
    const push = (id: InsightRuleId, ins: Insight | null) => {
      if (enabled[id] && ins) out.push(ins);
    };
    if (sales) {
      push(
        'dominant-method',
        insightDominantPaymentMethod(
          sales.byPaymentMethod.map((m) => ({ label: paymentMethodLabel(m.method), share: m.share })),
        ),
      );
    }
    if (topProduct) {
      push(
        'low-margin-product',
        insightLowMarginTopProduct(
          topProduct.map((p) => ({
            name: p.productName,
            revenue: p.revenue,
            marginPercent: p.marginPercent,
            costCoverage: p.costCoverage,
          })),
        ),
      );
    }
    if (projections) push('month-projection', insightMonthProjection(projections.monthRevenue.projected));
    push('cash-divergence', insightCashDivergence(totalDivergence));
    if (topCustomer) push('best-customer', insightBestCustomer(topCustomer.customerName, topCustomer.revenue));
    return out;
  }, [enabled, sales, topProduct, projections, topCustomer, totalDivergence]);

  return (
    <div className="mb-4 flex items-start gap-2">
      <div className="flex flex-1 flex-wrap gap-2">
        {insights.length === 0 ? (
          <span className="text-sm text-gray-400">Sem destaques no período.</span>
        ) : (
          insights.map((ins) => (
            <span
              key={ins.id}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${CHIP_STYLE[ins.severity]}`}
            >
              <span aria-hidden="true">{CHIP_ICON[ins.severity]}</span>
              {ins.text}
            </span>
          ))
        )}
      </div>

      {/* Configuração liga/desliga por regra. */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setConfigOpen((v) => !v)}
          aria-expanded={configOpen}
          className="flex h-7 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-600 hover:bg-gray-50"
          title="Configurar insights"
        >
          ⚙ Insights
        </button>
        {configOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setConfigOpen(false)} aria-hidden="true" />
            <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
              <p className="px-2 py-1 text-xs font-semibold text-gray-500">Mostrar quais insights</p>
              {INSIGHT_RULE_META.map((r) => (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={enabled[r.id]}
                    onChange={() => toggle(r.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-800">{r.label}</span>
                    <span className="block text-[11px] text-gray-500">{r.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
