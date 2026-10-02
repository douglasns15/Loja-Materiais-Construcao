'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  formatOrderNumber,
  FULFILLMENT_TYPE_LABELS,
  formatPhoneBr,
  type DeliveryAgendaRow,
} from '@nexoloja/shared';
import { deliveryUrgency, type DeliveryUrgency } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { todayLocal } from '@/components/ScheduleStep';

/**
 * Agenda do dia da tela Entregas (ADR-042): linha do tempo horizontal (um pedido por linha, grupos
 * Entregas / Retiradas, linha do "agora") no desktop e lista por horário no celular, com a cor por
 * urgência do core (`deliveryUrgency`), chips de filtro com contagem e a lista lateral "Próximas".
 * Clicar num pedido abre o detalhe de sempre (itens, retirada parcial, comprovante).
 */

type Chip = 'all' | 'late' | 'next' | 'DELIVERY' | 'PICKUP';

const URGENCY_STYLE: Record<DeliveryUrgency, { block: string; dot: string; text: string; label: string }> = {
  late: { block: 'border-red-600 bg-red-50 text-red-700', dot: 'bg-red-600', text: 'text-red-700', label: 'Atrasado' },
  now: { block: 'border-orange-600 bg-orange-50 text-orange-700', dot: 'bg-orange-600', text: 'text-orange-700', label: 'Agora' },
  soon: { block: 'border-amber-600 bg-amber-50 text-amber-800', dot: 'bg-amber-500', text: 'text-amber-800', label: 'Em breve' },
  plan: { block: 'border-indigo-600 bg-indigo-50 text-indigo-700', dot: 'bg-indigo-600', text: 'text-indigo-700', label: 'Agendado' },
  done: { block: 'border-gray-400 bg-gray-100 text-gray-500 line-through', dot: 'bg-gray-400', text: 'text-gray-500', label: 'Concluído' },
  route: { block: 'border-teal-600 bg-teal-50 text-teal-700', dot: 'bg-teal-600', text: 'text-teal-700', label: 'A caminho' },
};

const hm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const hoursOf = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
};

/** "há 20 min" / "em 10 min" / "às 17:00" — contagem do cartão. */
function etaText(r: DeliveryAgendaRow, now: number): string {
  const start = new Date(r.start).getTime();
  const end = r.end ? new Date(r.end).getTime() : start;
  if (now > end) return `há ${Math.max(1, Math.round((now - end) / 60000))} min`;
  const toStart = Math.round((start - now) / 60000);
  if (toStart <= 0) return 'agora';
  if (toStart <= 90) return `em ${toStart} min`;
  return `às ${hm(r.start)}`;
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayTitle(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const label = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  if (day === todayLocal()) return `Hoje · ${label}`;
  if (day === shiftDay(todayLocal(), 1)) return `Amanhã · ${label}`;
  return label;
}

export function DeliveryAgenda({
  onOpen,
  reloadKey,
  onOpenSettings,
}: {
  onOpen: (orderId: string) => void;
  /** Muda quando algo foi alterado fora (retirada registrada) — recarrega a agenda. */
  reloadKey: number;
  /** Admin: abre o painel "Período de entregas". */
  onOpenSettings?: () => void;
}) {
  const [day, setDay] = useState(todayLocal());
  const [rows, setRows] = useState<DeliveryAgendaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chip, setChip] = useState<Chip>('all');
  // Concluídos saem do painel por padrão (liberam espaço); o filtro "Concluídos" os traz de volta.
  const [showDone, setShowDone] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await apiGet<DeliveryAgendaRow[]>(`/deliveries/agenda?day=${day}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // O "agora" anda sozinho: cores, contagem e a linha vermelha se atualizam a cada minuto.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const withUrgency = useMemo(
    () =>
      rows.map((r) => ({
        r,
        u: deliveryUrgency(
          new Date(r.start).getTime(),
          r.end ? new Date(r.end).getTime() : null,
          now,
          r.fulfillmentStatus === 'COMPLETED',
          // "Data por item": a saída de outro dia não deixa a linha deste dia "a caminho".
          !!r.dispatchedAt && !r.perItem,
        ),
      })),
    [rows, now],
  );

  // "Saiu para entrega" direto do cartão (ADR-042, fatia 3) — o detalhe também tem o botão. Dá baixa
  // no estoque e conclui (revisão 2026-10-02); em "Data por item", só os itens do dia da agenda.
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  async function dispatch(r: DeliveryAgendaRow) {
    const id = r.id;
    setDispatchingId(id);
    setError(null);
    try {
      await apiPost(`/deliveries/${id}/dispatch`, r.perItem ? { dispatched: true, day } : { dispatched: true });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDispatchingId(null);
    }
  }
  const doneCount = withUrgency.filter((x) => x.u === 'done').length;
  const visible = showDone ? withUrgency : withUrgency.filter((x) => x.u !== 'done');
  const timed = visible.filter((x) => x.r.timed);
  const untimed = visible.filter((x) => !x.r.timed);

  const counts = {
    all: timed.length + untimed.length,
    late: timed.filter((x) => x.u === 'late').length,
    next: timed.filter((x) => x.u === 'now' || x.u === 'soon').length,
    DELIVERY: visible.filter((x) => x.r.fulfillmentType === 'DELIVERY').length,
    PICKUP: visible.filter((x) => x.r.fulfillmentType === 'PICKUP').length,
  };
  const pass = (x: { r: DeliveryAgendaRow; u: DeliveryUrgency }) =>
    chip === 'all'
      ? true
      : chip === 'late'
        ? x.u === 'late'
        : chip === 'next'
          ? x.u === 'now' || x.u === 'soon'
          : x.r.fulfillmentType === chip;
  const shownTimed = timed.filter(pass);
  const shownUntimed = untimed.filter(pass);

  // Régua de horas: 08h–20h, alargada para caber os pedidos do dia.
  const startH = Math.min(8, ...timed.map((x) => Math.floor(hoursOf(x.r.start))));
  const endH = Math.max(20, ...timed.map((x) => Math.ceil(hoursOf(x.r.end ?? x.r.start) + 0.01)));
  const span = Math.max(1, endH - startH);
  const pct = (h: number) => `${(((h - startH) / span) * 100).toFixed(3)}%`;
  const isToday = day === todayLocal();
  const nowH = new Date(now).getHours() + new Date(now).getMinutes() / 60;

  const upcoming = timed
    .filter((x) => x.u !== 'done')
    .sort((a, b) => new Date(a.r.start).getTime() - new Date(b.r.start).getTime())
    .slice(0, 6);

  const chips: { k: Chip; label: string }[] = [
    { k: 'all', label: 'Todas' },
    { k: 'late', label: 'Atrasadas' },
    { k: 'next', label: 'Próximas 1h' },
    { k: 'DELIVERY', label: 'Entregas' },
    { k: 'PICKUP', label: 'Retiradas' },
  ];

  const groups: { type: 'DELIVERY' | 'PICKUP'; items: typeof shownTimed }[] = [
    { type: 'DELIVERY', items: shownTimed.filter((x) => x.r.fulfillmentType === 'DELIVERY') },
    { type: 'PICKUP', items: shownTimed.filter((x) => x.r.fulfillmentType === 'PICKUP') },
  ];

  /** Cartão (lista lateral, celular e "sem horário"). */
  const card = (x: { r: DeliveryAgendaRow; u: DeliveryUrgency }, showEta = true) => {
    const st = URGENCY_STYLE[x.u];
    const canDispatch = x.r.fulfillmentType === 'DELIVERY' && x.r.itemsPending > 0 && x.u !== 'done';
    return (
      <div
        key={x.r.id}
        role="button"
        tabIndex={0}
        onClick={() => onOpen(x.r.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(x.r.id);
          }
        }}
        className={`grid w-full cursor-pointer gap-0.5 rounded-xl border border-l-4 bg-white px-3 py-2 text-left text-sm shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 ${st.block.split(' ')[0]}`}
      >
        <span className="flex items-center justify-between gap-2 font-semibold text-gray-900">
          <span className="truncate">
            {formatOrderNumber(x.r.orderNumber)} · {FULFILLMENT_TYPE_LABELS[x.r.fulfillmentType]}
          </span>
          {showEta && x.r.timed && (
            <span className={`shrink-0 text-xs tabular-nums ${st.text}`}>
              {x.u === 'done' ? 'concluído' : etaText(x.r, now)}
            </span>
          )}
        </span>
        <span className="truncate text-xs text-gray-600">
          {x.r.customerName ?? 'Sem cliente'}
          {x.r.timed ? ` · ${hm(x.r.start)}${x.r.end ? `–${hm(x.r.end)}` : ''}` : ''}
          {x.r.customerPhone ? ` · ${formatPhoneBr(x.r.customerPhone)}` : ''}
        </span>
        {x.r.fulfillmentType === 'DELIVERY' && x.r.deliveryAddress && (
          <span className="truncate text-xs text-gray-500">{x.r.deliveryAddress}</span>
        )}
        <span className="truncate text-xs text-gray-500">{x.r.itemsSummary}</span>
        {x.r.perItem && (
          <span className="text-xs font-medium text-indigo-700">
            Data por item
            {x.r.otherDaysItems > 0
              ? ` · +${x.r.otherDaysItems} ${x.r.otherDaysItems === 1 ? 'item' : 'itens'} em outro dia`
              : ''}
          </span>
        )}
        {x.r.fulfillmentType === 'DELIVERY' && (
          <span className="text-xs text-gray-500">
            Entregador: {x.r.courierName ?? 'a definir'}
            {x.r.dispatchedAt && x.u === 'done' && (
              <span className="ml-1 font-semibold text-teal-700">· saiu às {hm(x.r.dispatchedAt)}</span>
            )}
          </span>
        )}
        {canDispatch && (
          <span className="mt-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void dispatch(x.r);
              }}
              disabled={dispatchingId === x.r.id}
              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {dispatchingId === x.r.id ? 'Registrando…' : 'Saiu p/ entrega'}
            </button>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md">
      {/* Barra: dia + chips + período de entregas. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDay((d) => shiftDay(d, -1))}
            className="h-8 w-8 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            aria-label="Dia anterior"
          >
            ‹
          </button>
          <span className="min-w-[9rem] text-center text-sm font-semibold text-gray-900">{dayTitle(day)}</span>
          <button
            type="button"
            onClick={() => setDay((d) => shiftDay(d, 1))}
            className="h-8 w-8 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            aria-label="Próximo dia"
          >
            ›
          </button>
          <input
            id="agenda-day"
            type="date"
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
            aria-label="Escolher dia"
          />
          {!isToday && (
            <button
              type="button"
              onClick={() => setDay(todayLocal())}
              className="text-xs font-medium text-indigo-700 hover:underline"
            >
              Hoje
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.k}
              type="button"
              onClick={() => setChip(c.k)}
              className={`rounded-full border px-3 py-1 text-xs ${
                chip === c.k
                  ? 'border-indigo-600 bg-indigo-50 font-semibold text-indigo-700'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {c.label} <span className="tabular-nums">{counts[c.k]}</span>
            </button>
          ))}
          {/* Liga/desliga (independe dos chips acima): mostra os concluídos junto do filtro escolhido. */}
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-pressed={showDone}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs ${
              showDone
                ? 'border-gray-500 bg-gray-100 font-semibold text-gray-800'
                : 'border-dashed border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {showDone ? '✓ ' : ''}Concluídos <span className="tabular-nums">{doneCount}</span>
          </button>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="ml-2 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/30 transition hover:bg-indigo-700 hover:shadow-lg active:translate-y-px"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" strokeLinecap="round" />
              </svg>
              Período de entregas
            </button>
          )}
        </div>
      </div>

      {error && <p className="px-4 py-3 text-sm text-red-600">{error}</p>}

      {loading && rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500">Carregando a agenda…</p>
      ) : counts.all === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500">
          {doneCount > 0 ? (
            <>
              Tudo concluído neste dia ({doneCount}).{' '}
              <button type="button" onClick={() => setShowDone(true)} className="font-medium text-indigo-700 hover:underline">
                Ver concluídos
              </button>
            </>
          ) : (
            'Nada agendado para este dia. As vendas com retirada/entrega posterior aparecem aqui no horário combinado.'
          )}
        </p>
      ) : (
        <>
          <div className="md:grid md:grid-cols-[minmax(0,1fr)_280px]">
            {/* Linha do tempo (desktop). */}
            <div className="hidden min-w-0 overflow-x-auto border-r border-gray-200 md:block">
              <div className="relative min-w-[720px] pb-2">
                <div className="sticky top-0 z-[2] grid grid-cols-[180px_1fr] border-b border-gray-200 bg-white">
                  <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">Pedido</div>
                  <div className="relative h-8">
                    {Array.from({ length: span + 1 }, (_, i) => startH + i).map((h) => (
                      <span
                        key={h}
                        className="absolute top-2 -translate-x-1/2 text-[11px] tabular-nums text-gray-500"
                        style={{ left: pct(h) }}
                      >
                        {String(h).padStart(2, '0')}h
                      </span>
                    ))}
                  </div>
                </div>
                {groups.map((g) =>
                  g.items.length === 0 ? null : (
                    <div key={g.type}>
                      <div className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                        {g.type === 'DELIVERY' ? 'Entregas' : 'Retiradas'}
                      </div>
                      {g.items.map((x) => {
                        const st = URGENCY_STYLE[x.u];
                        const s = hoursOf(x.r.start);
                        const e = x.r.end ? hoursOf(x.r.end) : s + 0.5;
                        return (
                          <div key={x.r.id} className="grid min-h-[44px] grid-cols-[180px_1fr]">
                            <div className="min-w-0 border-r border-gray-100 px-3 py-1.5 text-xs leading-tight">
                              <span className="font-semibold tabular-nums text-gray-800">
                                {formatOrderNumber(x.r.orderNumber)}
                              </span>
                              <span className="block truncate text-gray-500">{x.r.customerName ?? 'Sem cliente'}</span>
                            </div>
                            <div className="relative">
                              {Array.from({ length: span + 1 }, (_, i) => startH + i).map((h) => (
                                <div key={h} className="absolute inset-y-0 w-px bg-gray-100" style={{ left: pct(h) }} />
                              ))}
                              <button
                                type="button"
                                onClick={() => onOpen(x.r.id)}
                                title={`${x.r.customerName ?? 'Sem cliente'} · ${x.r.itemsSummary}`}
                                className={`absolute top-1.5 flex h-8 min-w-[7.5rem] items-center gap-1 overflow-hidden whitespace-nowrap rounded-md border-l-4 px-2 text-xs font-semibold ${st.block}`}
                                style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }}
                              >
                                {x.u === 'late'
                                  ? 'Atrasado · '
                                  : x.u === 'now'
                                    ? 'Agora · '
                                    : x.u === 'route'
                                      ? 'A caminho · '
                                      : ''}
                                {hm(x.r.start)}
                                {x.r.end ? `–${hm(x.r.end)}` : ''}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ),
                )}
                {shownTimed.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-gray-500">Nenhum pedido com horário neste filtro.</p>
                )}
                {/* Linha do "agora" (só no dia de hoje, dentro da régua). */}
                {isToday && nowH >= startH && nowH <= endH && (
                  <div
                    className="pointer-events-none absolute inset-y-0 z-[1] w-0.5 bg-red-600"
                    style={{ left: `calc(180px + (100% - 180px) * ${((nowH - startH) / span).toFixed(4)})` }}
                  >
                    <span className="absolute left-1.5 top-1 whitespace-nowrap rounded bg-white px-1 text-[10px] font-bold text-red-600">
                      agora {new Date(now).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Celular: a mesma agenda em lista por horário. */}
            <div className="space-y-2 p-3 md:hidden">
              {shownTimed.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-500">Nenhum pedido com horário neste filtro.</p>
              ) : (
                shownTimed.map((x, i) => {
                  const hour = new Date(x.r.start).getHours();
                  const prev = i > 0 ? new Date(shownTimed[i - 1]!.r.start).getHours() : -1;
                  return (
                    <div key={x.r.id} className="space-y-2">
                      {hour !== prev && (
                        <div className="rounded-md bg-gray-50 px-2 py-1 text-xs font-bold tabular-nums text-gray-500">
                          {String(hour).padStart(2, '0')}:00
                        </div>
                      )}
                      {card(x)}
                    </div>
                  );
                })
              )}
            </div>

            {/* Próximas (desktop): o que vem agora, com contagem regressiva. */}
            <aside className="hidden space-y-2 bg-gray-50 p-3 md:block">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Próximas</p>
              {upcoming.length === 0 ? (
                <p className="text-xs text-gray-500">Nada pendente com horário neste dia.</p>
              ) : (
                upcoming.map((x) => card(x))
              )}
            </aside>
          </div>

          {/* Pedidos só com o DIA (sem faixa de horário) — fora da régua. */}
          {shownUntimed.length > 0 && (
            <div className="border-t border-gray-200 p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                Sem horário definido ({shownUntimed.length})
              </p>
              <div className="grid gap-2 sm:grid-cols-2">{shownUntimed.map((x) => card(x, false))}</div>
            </div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-200 px-4 py-2 text-xs text-gray-500">
            {(['late', 'now', 'soon', 'plan', 'route', 'done'] as DeliveryUrgency[]).map((u) => (
              <span key={u} className="inline-flex items-center gap-1.5">
                <i className={`inline-block h-3 w-3 rounded-sm ${URGENCY_STYLE[u].dot}`} />
                {URGENCY_STYLE[u].label}
                {u === 'late' && ': passou do horário'}
                {u === 'now' && ': até 15 min'}
                {u === 'soon' && ': até 60 min'}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
