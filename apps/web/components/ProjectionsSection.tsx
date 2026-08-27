'use client';

import { useEffect, useState } from 'react';
import type { ProjectionsReport } from '@nexoloja/shared';
import { apiGet } from '@/lib/api';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const NUM = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/**
 * Seção "Projeções" (Relatórios v2, Fatia 8) — três olhares para frente, sempre rotulados **"no
 * ritmo atual"** (direcional, não promessa). Independente do filtro de período da tela: mês corrente
 * (run-rate), a receber nos próx. 30 dias (vencimentos ADR-026) e itens que vão faltar (velocidade de
 * saída). Busca uma vez ao montar (`GET /reports/projections`).
 */
export function ProjectionsSection() {
  const [data, setData] = useState<ProjectionsReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await apiGet<ProjectionsReport>('/reports/projections');
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null; // silencioso: projeções são um extra, não travam a tela

  const m = data?.monthRevenue;
  const monthPct =
    m && m.projected > 0 ? Math.min(100, Math.round((m.realized / m.projected) * 100)) : 0;
  const top = data?.stockoutRisks[0];
  const moreRisks = data ? Math.max(0, data.stockoutRisks.length - 1) : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {/* 1. Faturamento projetado do mês (run-rate). */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-medium text-gray-600">🔮 Faturamento projetado do mês</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{data ? BRL(m!.projected) : '—'}</p>
        {data && (
          <>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${monthPct}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500">
              {BRL(m!.realized)} realizados em {m!.daysElapsed}/{m!.daysInMonth} dias · no ritmo atual (
              {BRL(m!.dailyAverage)}/dia)
            </p>
          </>
        )}
      </div>

      {/* 2. A receber (próximos 30 dias). */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-medium text-gray-600">📥 A receber (próx. 30 dias)</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {data ? BRL(data.upcomingReceivables.total) : '—'}
        </p>
        {data && (
          <p className="mt-1.5 text-[11px] text-gray-500">
            {data.upcomingReceivables.count}{' '}
            {data.upcomingReceivables.count === 1 ? 'dívida vence' : 'dívidas vencem'} no período
          </p>
        )}
      </div>

      {/* 3. Vai faltar estoque (velocidade de saída). */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-medium text-gray-600">📦 Vai faltar estoque</p>
        {!data ? (
          <p className="mt-1 text-2xl font-bold">—</p>
        ) : top ? (
          <>
            <p className="mt-1 truncate text-lg font-bold" title={top.productName}>
              {top.productName}
            </p>
            <p className="mt-1.5 text-[11px] text-gray-500">
              acaba em <strong>~{NUM(top.daysToStockout)} dias</strong> no ritmo atual (
              {NUM(top.dailyVelocity)}/dia · {NUM(top.stockQty)} em estoque)
              {moreRisks > 0 && <> · +{moreRisks} no limite</>}
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-lg font-bold text-emerald-700">Tudo certo</p>
            <p className="mt-1.5 text-[11px] text-gray-500">
              Nenhum item rompe nos próximos 14 dias no ritmo atual.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
