'use client';

import { useState } from 'react';
import type { ProjectionsReport } from '@nexoloja/shared';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const NUM = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/**
 * Seção "Projeções" (Relatórios v2, Fatia 8) — três olhares para frente, sempre rotulados **"no
 * ritmo atual"** (direcional, não promessa). Independente do filtro de período da tela: mês corrente
 * (run-rate), a receber nos próx. 30 dias (vencimentos ADR-026) e itens que vão faltar (velocidade de
 * saída). Recebe as projeções PRONTAS da página (buscadas uma vez lá, sem duplicar request).
 */
export function ProjectionsSection({ data }: { data: ProjectionsReport | null }) {
  // Carrossel dos itens em risco DENTRO do próprio card (Fatia 8, refino): ‹ › passa pelos 5.
  const [riskIdx, setRiskIdx] = useState(0);

  // As projeções vêm PRONTAS da página (buscadas uma vez, sem duplicar request). Enquanto não chegam,
  // mostra o esqueleto ("—"); nunca some (é um extra silencioso).
  const m = data?.monthRevenue;
  const monthPct =
    m && m.projected > 0 ? Math.min(100, Math.round((m.realized / m.projected) * 100)) : 0;
  const risks = data?.stockoutRisks ?? [];
  // Clampa o índice ao tamanho da lista (protege se a lista encolher entre buscas).
  const idx = risks.length > 0 ? Math.min(riskIdx, risks.length - 1) : 0;
  const risk = risks[idx];

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

      {/* 3. Vai faltar estoque — carrossel dos itens em risco dentro do card (‹ ›). */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-600">📦 Vai faltar estoque</p>
          {risks.length > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRiskIdx((idx - 1 + risks.length) % risks.length)}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50"
                aria-label="Item anterior"
              >
                ‹
              </button>
              <span className="text-[11px] tabular-nums text-gray-400">
                {idx + 1}/{risks.length}
              </span>
              <button
                type="button"
                onClick={() => setRiskIdx((idx + 1) % risks.length)}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50"
                aria-label="Próximo item"
              >
                ›
              </button>
            </div>
          )}
        </div>
        {!data ? (
          <p className="mt-1 text-2xl font-bold">—</p>
        ) : risk ? (
          <>
            <p className="mt-1 truncate text-lg font-bold" title={risk.productName}>
              {risk.productName}
            </p>
            <p className="mt-1.5 text-[11px] text-gray-500">
              acaba em <strong>~{NUM(risk.daysToStockout)} dias</strong> no ritmo atual (
              {NUM(risk.dailyVelocity)}/dia · {NUM(risk.stockQty)} em estoque)
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
