'use client';

/**
 * Filtro de período reutilizável (Relatórios, Histórico de Vendas, Estoque › Movimentações).
 *
 * Combina três formas de escolher o intervalo, todas sobre o mesmo `{ from, to }` (YYYY-MM-DD, no
 * fuso LOCAL):
 *  - Navegação dia a dia `‹ Hoje ›`: as setas deslocam a JANELA INTEIRA em 1 dia (um período de 7
 *    dias vira os 7 dias anteriores/seguintes; no default — Hoje, 1 dia — é navegação dia a dia). O
 *    rótulo central mostra "Hoje"/"Ontem"/data e, clicado, volta para Hoje. "Próximo" trava no futuro.
 *  - Atalhos Hoje / 7 dias / 30 dias.
 *  - De / Até manuais.
 *
 * Controlado: o pai é dono do estado (`value` + `onChange`) e decide como recarregar os dados.
 */
export type DateRange = { from: string; to: string };

const pad = (n: number) => String(n).padStart(2, '0');
/** Data local → YYYY-MM-DD (sem passar por UTC, que erraria o dia perto da meia-noite). */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayIso(): string {
  return isoDay(new Date());
}
/** YYYY-MM-DD → Date LOCAL (evita o parse UTC de `new Date('2026-08-10')`). */
function parseIso(iso: string): Date {
  const parts = iso.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d);
}
function addDaysIso(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}
function brDay(iso: string): string {
  const d = parseIso(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
/** Rótulo amigável de um dia: "Hoje", "Ontem" ou a data (dd/mm/aaaa). */
function friendlyDay(iso: string): string {
  const t = todayIso();
  if (iso === t) return 'Hoje';
  if (iso === addDaysIso(t, -1)) return 'Ontem';
  return brDay(iso);
}

/** Atalhos de período → `{ from, to }` em YYYY-MM-DD. `today` = só hoje (1 dia). */
export function presetRange(preset: 'today' | '7d' | '30d'): DateRange {
  const to = todayIso();
  if (preset === '7d') return { from: addDaysIso(to, -6), to };
  if (preset === '30d') return { from: addDaysIso(to, -29), to };
  return { from: to, to };
}

/** Range padrão das telas com filtro por data: só hoje. */
export function defaultRange(): DateRange {
  return presetRange('today');
}

const PRESETS: [preset: 'today' | '7d' | '30d', label: string][] = [
  ['today', 'Hoje'],
  ['7d', '7 dias'],
  ['30d', '30 dias'],
];

export function PeriodFilter({
  value,
  onChange,
  className,
  bare = false,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  className?: string;
  /** `true` = sem o cartão (fundo/sombra/padding) — para embutir numa barra de filtros existente. */
  bare?: boolean;
}) {
  const today = todayIso();
  // Base da navegação: cai para hoje se o range estiver vazio (evita setas "sem referência").
  const from = value.from || today;
  const to = value.to || today;
  const singleDay = from === to;
  const centerLabel = singleDay ? friendlyDay(from) : `${brDay(from)} – ${brDay(to)}`;
  // Desloca a janela inteira em `n` dias (preserva a duração do período).
  const shift = (n: number) => onChange({ from: addDaysIso(from, n), to: addDaysIso(to, n) });
  // Não navega para o futuro: "próximo" trava quando o fim do período já alcançou hoje.
  const canNext = to < today;

  const arrowCls =
    'rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent';

  const wrapCls = bare
    ? `flex flex-wrap items-end gap-x-4 gap-y-3 ${className ?? ''}`
    : `flex flex-wrap items-end gap-x-4 gap-y-3 rounded-2xl bg-white p-4 shadow-sm ${className ?? ''}`;

  return (
    <div className={wrapCls}>
      {/* Navegação dia a dia: ‹ [Hoje] › — as setas deslocam a janela inteira em 1 dia. */}
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Período anterior" onClick={() => shift(-1)} className={arrowCls}>
          ‹
        </button>
        <button
          type="button"
          onClick={() => onChange(presetRange('today'))}
          title="Ir para hoje"
          className="min-w-[6.5rem] rounded-lg bg-gray-100 px-3 py-1.5 text-center text-sm font-medium text-gray-800 hover:bg-gray-200"
        >
          {centerLabel}
        </button>
        <button
          type="button"
          aria-label="Próximo período"
          onClick={() => shift(1)}
          disabled={!canNext}
          className={arrowCls}
        >
          ›
        </button>
      </div>

      {/* Atalhos de período */}
      <div className="flex gap-1">
        {PRESETS.map(([preset, label]) => {
          const r = presetRange(preset);
          const active = value.from === r.from && value.to === r.to;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(r)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* De / Até manuais */}
      <label className="flex flex-col text-xs text-gray-600">
        De
        <input
          type="date"
          value={value.from}
          max={value.to || undefined}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
        />
      </label>
      <label className="flex flex-col text-xs text-gray-600">
        Até
        <input
          type="date"
          value={value.to}
          min={value.from || undefined}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
        />
      </label>
    </div>
  );
}
