'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DailyRevenuePoint } from '@nexoloja/shared';
import { apiGet } from '@/lib/api';

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Hoje no fuso da loja (−3h), como AAAA-MM-DD — para destacar a barra de hoje. */
function todayStr(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Dia/mês curto (ex.: 26/08) a partir de AAAA-MM-DD, sem passar por Date (evita fuso). */
function dm(day: string): string {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

/**
 * Gráfico de barras do recebido por dia (Relatórios v2, Fatia 7) — SVG à mão, sem lib (custo-zero).
 * A barra de HOJE fica destacada; cada barra tem tooltip nativo (dia + valor). Busca `GET
 * /reports/daily` (Σ barras = "Recebido do período"). Alterna com a tabela via toggle no painel.
 */
export function DailyRevenueChart({ from, to }: { from: string | null; to: string | null }) {
  const [points, setPoints] = useState<DailyRevenuePoint[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    setFailed(false);
    (async () => {
      try {
        const qs = new URLSearchParams();
        if (from) qs.set('from', from);
        if (to) qs.set('to', to);
        const q = qs.toString() ? `?${qs.toString()}` : '';
        const d = await apiGet<DailyRevenuePoint[]>(`/reports/daily${q}`);
        if (!cancelled) setPoints(d);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const today = todayStr();
  const total = useMemo(() => (points ?? []).reduce((a, p) => a + p.total, 0), [points]);

  if (failed) {
    return <p className="px-4 py-6 text-center text-sm text-gray-500">Não foi possível carregar o gráfico.</p>;
  }
  if (!points) {
    return <p className="px-4 py-6 text-center text-sm text-gray-500">Carregando…</p>;
  }
  if (points.length === 0 || total === 0) {
    return <p className="px-4 py-6 text-center text-sm text-gray-500">Sem recebimentos no período.</p>;
  }

  // Geometria em coordenadas do viewBox (escala por CSS: width 100%).
  const W = 720;
  const H = 220;
  const padL = 8;
  const padR = 8;
  const padT = 16;
  const padB = 28; // rótulos de dia
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = Math.max(...points.map((p) => p.total));
  const n = points.length;
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(slot * 0.7, 42));
  // Rótulos de dia: no máx. ~8 para não embolar; sempre o 1º, o último e hoje.
  const labelStep = Math.max(1, Math.ceil(n / 8));

  return (
    <div className="px-4 py-4">
      <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
        <span>Recebido por dia</span>
        <span>
          pico do período: <strong className="text-gray-700">{BRL(max)}</strong>
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full min-w-[480px]"
          role="img"
          aria-label="Gráfico de barras do recebido por dia"
        >
          {/* Linha de base. */}
          <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="#e5e7eb" strokeWidth={1} />
          {points.map((p, i) => {
            const h = max > 0 ? (p.total / max) * plotH : 0;
            const x = padL + i * slot + (slot - barW) / 2;
            const yTop = padT + (plotH - h);
            const isToday = p.day === today;
            const showLabel = i % labelStep === 0 || i === n - 1 || isToday;
            return (
              <g key={p.day}>
                <rect
                  x={x}
                  y={yTop}
                  width={barW}
                  height={h}
                  rx={2}
                  className={isToday ? 'fill-emerald-500' : 'fill-indigo-400'}
                >
                  <title>
                    {dm(p.day)}
                    {isToday ? ' (hoje)' : ''}: {BRL(p.total)}
                  </title>
                </rect>
                {showLabel && (
                  <text
                    x={x + barW / 2}
                    y={H - 10}
                    textAnchor="middle"
                    className={`text-[11px] ${isToday ? 'fill-emerald-700 font-semibold' : 'fill-gray-400'}`}
                  >
                    {dm(p.day)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-1 text-center text-[11px] text-gray-400">
        A soma das barras é o &ldquo;Recebido no período&rdquo;. Hoje em verde.
      </p>
    </div>
  );
}
