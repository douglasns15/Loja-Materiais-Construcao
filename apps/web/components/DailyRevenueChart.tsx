'use client';

import { useEffect, useMemo, useState } from 'react';
import { paymentMethodLabel, type DailyRevenuePoint } from '@nexoloja/shared';
import { apiGet } from '@/lib/api';

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Paleta estável para as formas (atribuída pela ordem de faturamento). */
const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#0ea5e9', '#a855f7', '#f43f5e', '#64748b', '#14b8a6'];

/** Hoje no fuso da loja (−3h), como AAAA-MM-DD — para destacar o rótulo de hoje. */
function todayStr(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Dia/mês curto (ex.: 26/08) a partir de AAAA-MM-DD, sem passar por Date (evita fuso). */
function dm(day: string): string {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

/**
 * Gráfico de barras EMPILHADO do recebido por dia e por forma de pagamento (Relatórios v2, Fatia 7 —
 * refino "empilhado", padrão dos dashboards de POS/adquirente: Square/Stone/Cielo). SVG à mão, sem
 * lib (custo-zero). Junta tendência (dias) + composição (formas) num só gráfico; faz sentido até com
 * 1 dia (a barra vira o rateio por forma). Busca `GET /reports/daily` (Σ barras = "Recebido do
 * período"). O rótulo de HOJE fica em verde; tooltip nativo por dia mostra a quebra.
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

  // Formas presentes no período, ordenadas por faturamento total (cor estável por ordem).
  const methods = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of points ?? []) {
      for (const [m, v] of Object.entries(p.byMethod)) totals.set(m, (totals.get(m) ?? 0) + v);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  }, [points]);

  const colorOf = (method: string) => PALETTE[methods.indexOf(method) % PALETTE.length] ?? '#94a3b8';
  const grandTotal = useMemo(() => (points ?? []).reduce((a, p) => a + p.total, 0), [points]);

  if (failed) {
    return <p className="px-4 py-6 text-center text-sm text-gray-500">Não foi possível carregar o gráfico.</p>;
  }
  if (!points) {
    return <p className="px-4 py-6 text-center text-sm text-gray-500">Carregando…</p>;
  }
  if (points.length === 0 || grandTotal === 0) {
    return <p className="px-4 py-6 text-center text-sm text-gray-500">Sem recebimentos no período.</p>;
  }

  // Geometria em coordenadas do viewBox (escala por CSS: width 100%, altura pelo próprio viewBox).
  const W = 720;
  const H = 220;
  const padL = 8;
  const padR = 8;
  const padT = 16;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = Math.max(...points.map((p) => p.total));
  const n = points.length;
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(slot * 0.7, 42));
  const labelStep = Math.max(1, Math.ceil(n / 8));
  const baseY = padT + plotH;

  return (
    <div className="px-4 py-4">
      <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
        <span>Recebido por dia · por forma</span>
        <span>
          pico do período: <strong className="text-gray-700">{BRL(max)}</strong>
        </span>
      </div>

      {/* Legenda das formas. */}
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
        {methods.map((m) => (
          <span key={m} className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colorOf(m) }} />
            {paymentMethodLabel(m)}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full min-w-[480px]"
          role="img"
          aria-label="Gráfico de barras empilhado do recebido por dia e forma"
        >
          <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="#e5e7eb" strokeWidth={1} />
          {points.map((p, i) => {
            const x = padL + i * slot + (slot - barW) / 2;
            const isToday = p.day === today;
            // Rótulos ANCORADOS no último dia (espaçamento uniforme terminando em hoje) — evita a
            // colisão do penúltimo com o último que havia no modo 30 dias.
            const showLabel = (n - 1 - i) % labelStep === 0;
            // Empilha as formas de baixo para cima, na ordem estável da legenda.
            let yCursor = baseY;
            const segments = methods
              .filter((m) => (p.byMethod[m] ?? 0) > 0)
              .map((m) => {
                const v = p.byMethod[m] ?? 0;
                const h = max > 0 ? (v / max) * plotH : 0;
                yCursor -= h;
                return { m, v, y: yCursor, h };
              });
            const tip = `${dm(p.day)}${isToday ? ' (hoje)' : ''}: ${BRL(p.total)}\n${methods
              .filter((m) => (p.byMethod[m] ?? 0) > 0)
              .map((m) => `${paymentMethodLabel(m)}: ${BRL(p.byMethod[m] ?? 0)}`)
              .join('\n')}`;
            return (
              <g key={p.day}>
                {segments.map((s) => (
                  <rect key={s.m} x={x} y={s.y} width={barW} height={s.h} fill={colorOf(s.m)}>
                    <title>{tip}</title>
                  </rect>
                ))}
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
