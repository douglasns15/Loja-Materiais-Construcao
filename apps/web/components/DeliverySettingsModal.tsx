'use client';

import { useEffect, useState } from 'react';
import {
  DEFAULT_DELIVERY_SETTINGS,
  deliverySettingsSchema,
  type DeliverySettings,
} from '@nexoloja/shared';
import { deliverySlots } from '@nexoloja/core';
import { apiGet, apiPut } from '@/lib/api';

/**
 * Período de entregas (ADR-042), editado na tela Entregas (Admin): tamanho da faixa, limite de
 * pedidos por faixa e os horários de atendimento de cada dia da semana (até 2 intervalos — manhã e
 * tarde). Dia sem intervalo = sem entregas/retiradas. Nenhum dia configurado = sem restrição.
 */

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DAY_KEYS = ['0', '1', '2', '3', '4', '5', '6'] as const;
type DayKey = (typeof DAY_KEYS)[number];
type Range = { start: string; end: string };

export function DeliverySettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [settings, setSettings] = useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<DeliverySettings>('/tenant/delivery-settings')
      .then(setSettings)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const rangesOf = (k: DayKey): Range[] => settings.hours[k] ?? [];
  const setRanges = (k: DayKey, ranges: Range[]) =>
    setSettings((s) => {
      const hours = { ...s.hours };
      if (ranges.length === 0) delete hours[k];
      else hours[k] = ranges;
      return { ...s, hours };
    });

  const configured = DAY_KEYS.some((k) => rangesOf(k).length > 0);

  /** Atalho: aplica os horários de segunda aos dias úteis (ter–sex). */
  function copyMondayToWeekdays() {
    const mon = rangesOf('1');
    setSettings((s) => {
      const hours = { ...s.hours };
      for (const k of ['2', '3', '4', '5'] as DayKey[]) {
        if (mon.length) hours[k] = mon.map((r) => ({ ...r }));
        else delete hours[k];
      }
      return { ...s, hours };
    });
  }

  async function save() {
    setError(null);
    const parsed = deliverySettingsSchema.safeParse(settings);
    if (!parsed.success) {
      setError('Confira os horários: o fim de cada intervalo precisa ser depois do início.');
      return;
    }
    setSaving(true);
    try {
      await apiPut('/tenant/delivery-settings', parsed.data);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Período de entregas"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 bg-indigo-600 px-5 py-4 text-white">
          <div>
            <h2 className="text-lg font-bold">Período de entregas</h2>
            <p className="text-xs text-indigo-100">Faixas que o PDV oferece ao agendar retirada ou entrega.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-indigo-100 hover:bg-white/10 hover:text-white"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          {loading ? (
            <p className="text-sm text-gray-500">Carregando…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-gray-600">
                  Tamanho da faixa
                  <select
                    id="ds-slot"
                    value={settings.slotMinutes}
                    onChange={(e) => setSettings({ ...settings, slotMinutes: Number(e.target.value) })}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    {[15, 20, 30, 45, 60, 90, 120].map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium text-gray-600">
                  Limite de pedidos por faixa
                  <input
                    id="ds-max"
                    type="number"
                    min={1}
                    max={999}
                    placeholder="Sem limite"
                    value={settings.maxPerSlot ?? ''}
                    onChange={(e) =>
                      setSettings({ ...settings, maxPerSlot: e.target.value ? Math.max(1, Number(e.target.value)) : null })
                    }
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-800">Horários de atendimento</span>
                  <button
                    type="button"
                    onClick={copyMondayToWeekdays}
                    className="text-xs font-medium text-indigo-700 hover:underline"
                  >
                    Copiar segunda para terça–sexta
                  </button>
                </div>
                {!configured && (
                  <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Nenhum dia configurado: o PDV oferece faixas das 08:00 às 20:00 todos os dias.
                  </p>
                )}
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                  {DAY_KEYS.map((k, i) => {
                    const ranges = rangesOf(k);
                    const open = ranges.length > 0;
                    const slots = open ? deliverySlots({ slotMinutes: settings.slotMinutes, hours: { [k]: ranges } }, i).length : 0;
                    return (
                      <div key={k} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <label className="flex w-28 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={open}
                            onChange={(e) =>
                              setRanges(k, e.target.checked ? [{ start: '08:00', end: '18:00' }] : [])
                            }
                            className="h-4 w-4 accent-indigo-600"
                          />
                          {WEEKDAYS[i]}
                        </label>
                        {open ? (
                          <div className="flex flex-1 flex-wrap items-center gap-2">
                            {ranges.map((r, ri) => (
                              <span key={ri} className="inline-flex items-center gap-1 text-sm">
                                <input
                                  type="time"
                                  value={r.start}
                                  onChange={(e) =>
                                    setRanges(k, ranges.map((x, xi) => (xi === ri ? { ...x, start: e.target.value } : x)))
                                  }
                                  className="rounded-md border border-gray-300 px-1.5 py-0.5 text-sm"
                                  aria-label={`${WEEKDAYS[i]}: início do intervalo ${ri + 1}`}
                                />
                                –
                                <input
                                  type="time"
                                  value={r.end}
                                  onChange={(e) =>
                                    setRanges(k, ranges.map((x, xi) => (xi === ri ? { ...x, end: e.target.value } : x)))
                                  }
                                  className="rounded-md border border-gray-300 px-1.5 py-0.5 text-sm"
                                  aria-label={`${WEEKDAYS[i]}: fim do intervalo ${ri + 1}`}
                                />
                                {ranges.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => setRanges(k, ranges.filter((_, xi) => xi !== ri))}
                                    className="px-1 text-gray-400 hover:text-red-600"
                                    aria-label="Remover intervalo"
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            ))}
                            {ranges.length < 2 && (
                              <button
                                type="button"
                                onClick={() => setRanges(k, [...ranges, { start: '14:00', end: '18:00' }])}
                                className="text-xs font-medium text-indigo-700 hover:underline"
                              >
                                + intervalo
                              </button>
                            )}
                            <span className="ml-auto text-xs tabular-nums text-gray-500">{slots} faixas</span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">sem atendimento</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || loading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? 'Salvando…' : 'Salvar período'}
          </button>
        </div>
      </div>
    </div>
  );
}
