'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_DELIVERY_SETTINGS,
  FULFILLMENT_TYPE_LABELS,
  type DeliverySettings,
  type EmployeeRow,
  type FulfillmentType,
} from '@nexoloja/shared';
import { deliverySlots, slotEnd, slotLabel } from '@nexoloja/core';
import { apiGet } from '@/lib/api';

/**
 * Etapa de agendamento da venda com retirada/entrega posterior (ADR-042), exibida na REVISÃO do PDV
 * (depois de "Concluir venda"): dia, faixa de horário, endereço e entregador (só na entrega) e
 * observações. As faixas vêm do "Período de entregas" da loja (`GET /tenant/delivery-settings`),
 * fatiadas pelo core (`deliverySlots`); "Outro horário" aceita um início livre (fim = início + faixa).
 * Componente controlado: o estado mora no PDV, que monta o payload da venda.
 */

export type ScheduleValue = {
  date: string; // AAAA-MM-DD
  start: string; // HH:MM ('' = sem faixa)
  end: string; // HH:MM
  address: string;
  /** O operador mexeu no endereço — não sobrescrever com o do cadastro. */
  addressTouched: boolean;
  /** Gravar o endereço digitado no cadastro do cliente ao confirmar. */
  saveAddress: boolean;
  courierId: string;
  notes: string;
};

export const EMPTY_SCHEDULE: ScheduleValue = {
  date: '',
  start: '',
  end: '',
  address: '',
  addressTouched: false,
  saveAddress: false,
  courierId: '',
  notes: '',
};

/** Data local de hoje em AAAA-MM-DD (o `<input type=date>` e o dia da semana são no fuso do aparelho). */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "AAAA-MM-DD" + "HH:MM" (horário local) → ISO com fuso, para o servidor gravar o instante certo. */
export function localDateTimeIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

const inputCls = 'w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm';

export function ScheduleStep({
  type,
  value,
  onChange,
  customerId,
  customerName,
  perItemSchedule,
}: {
  type: FulfillmentType;
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  customerId: string;
  customerName: string;
  /** "Data por item" ligada no checkout: as datas vêm de cada item, sem faixa única. */
  perItemSchedule: boolean;
}) {
  const [settings, setSettings] = useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS);
  const [couriers, setCouriers] = useState<EmployeeRow[]>([]);
  const [customStart, setCustomStart] = useState(false);
  const isDelivery = type === 'DELIVERY';
  const set = (patch: Partial<ScheduleValue>) => onChange({ ...value, ...patch });

  // Período de entregas + entregadores ativos: carregados uma vez ao abrir a etapa (best-effort —
  // sem eles a etapa segue com o padrão e sem entregador).
  useEffect(() => {
    apiGet<DeliverySettings>('/tenant/delivery-settings').then(setSettings).catch(() => {});
    apiGet<EmployeeRow[]>('/employees?activeOnly=true')
      .then((rows) => setCouriers(rows.filter((r) => r.role === 'COURIER')))
      .catch(() => {});
  }, []);

  // Endereço do cadastro do cliente pré-preenche a entrega (enquanto o operador não mexer).
  useEffect(() => {
    if (!isDelivery || !customerId || value.addressTouched) return;
    let alive = true;
    apiGet<{ address: string | null }>(`/customers/${customerId}`)
      .then((c) => {
        if (alive && c.address && !value.addressTouched) onChange({ ...value, address: c.address });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDelivery, customerId]);

  const weekday = value.date ? new Date(`${value.date}T12:00:00`).getDay() : new Date().getDay();
  const slots = useMemo(() => deliverySlots(settings, weekday), [settings, weekday]);
  // Hoje: faixas que já terminaram ficam de fora.
  const nowHHMM = new Date().toTimeString().slice(0, 5);
  const visibleSlots = value.date === todayLocal() ? slots.filter((s) => s.end > nowHHMM) : slots;
  const pickedIsListed = visibleSlots.some((s) => s.start === value.start);

  return (
    <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-indigo-900">
          {FULFILLMENT_TYPE_LABELS[type]} agendada
        </span>
        <span className="text-xs text-indigo-700">
          {isDelivery ? 'a loja leva até o cliente' : 'o cliente busca na loja'}
        </span>
      </div>

      {perItemSchedule ? (
        <p className="text-xs text-indigo-800">
          “Data por item” está ligada: as datas vêm de cada item (definidas no carrinho).
        </p>
      ) : (
        <>
          <label className="block text-xs font-medium text-gray-600">
            Dia
            <input
              id="sched-date"
              type="date"
              value={value.date}
              min={todayLocal()}
              onChange={(e) => set({ date: e.target.value, start: '', end: '' })}
              className={`mt-1 ${inputCls}`}
            />
          </label>

          <div>
            <span className="text-xs font-medium text-gray-600">
              Faixa de horário{isDelivery ? '' : ' (opcional)'}
            </span>
            {visibleSlots.length === 0 && !customStart ? (
              <p className="mt-1 text-xs text-gray-500">
                Sem faixas de atendimento neste dia. Use “Outro horário” ou escolha outro dia.
              </p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {visibleSlots.map((s) => {
                  const on = value.start === s.start && !customStart;
                  return (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => {
                        setCustomStart(false);
                        set(on ? { start: '', end: '' } : { start: s.start, end: s.end });
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-xs tabular-nums ${
                        on
                          ? 'border-indigo-600 bg-indigo-600 font-semibold text-white'
                          : 'border-indigo-200 bg-white text-gray-700 hover:border-indigo-400'
                      }`}
                    >
                      {slotLabel(s.start, s.end)}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCustomStart((v) => !v)}
                className="text-xs font-medium text-indigo-700 hover:underline"
              >
                {customStart ? 'Usar as faixas da loja' : '+ Outro horário'}
              </button>
              {customStart && (
                <input
                  id="sched-custom-start"
                  type="time"
                  value={pickedIsListed ? '' : value.start}
                  onChange={(e) =>
                    set(
                      e.target.value
                        ? { start: e.target.value, end: slotEnd(e.target.value, settings.slotMinutes) }
                        : { start: '', end: '' },
                    )
                  }
                  className="rounded-lg border border-indigo-200 bg-white px-2 py-1 text-sm"
                  aria-label="Início do horário"
                />
              )}
              {value.start && (
                <span className="text-xs text-indigo-800">
                  Escolhido: <strong className="tabular-nums">{slotLabel(value.start, value.end)}</strong>
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {isDelivery && (
        <>
          <label className="block text-xs font-medium text-gray-600">
            Endereço da entrega{customerName ? ` — ${customerName}` : ''}
            <input
              id="sched-address"
              value={value.address}
              onChange={(e) => set({ address: e.target.value, addressTouched: true })}
              maxLength={300}
              placeholder="Rua, número, complemento · bairro"
              className={`mt-1 ${inputCls}`}
            />
          </label>
          {customerId && value.addressTouched && value.address.trim() && (
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={value.saveAddress}
                onChange={(e) => set({ saveAddress: e.target.checked })}
                className="h-4 w-4 accent-indigo-600"
              />
              Salvar este endereço no cadastro do cliente
            </label>
          )}
          <label className="block text-xs font-medium text-gray-600">
            Entregador (opcional)
            <select
              id="sched-courier"
              value={value.courierId}
              onChange={(e) => set({ courierId: e.target.value })}
              className={`mt-1 ${inputCls}`}
            >
              <option value="">— definir depois —</option>
              {couriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {couriers.length === 0 && (
            <p className="text-xs text-gray-500">
              Nenhum entregador cadastrado. Cadastre em Cadastros › Funcionários.
            </p>
          )}
        </>
      )}

      <label className="block text-xs font-medium text-gray-600">
        Observações {isDelivery ? 'da entrega' : 'da retirada'} (opcional)
        <textarea
          id="sched-notes"
          value={value.notes}
          onChange={(e) => set({ notes: e.target.value })}
          rows={2}
          maxLength={500}
          placeholder={isDelivery ? 'Ex.: portão azul; troco para R$ 100' : 'Ex.: quem retira é o João'}
          className={`mt-1 ${inputCls}`}
        />
      </label>
    </div>
  );
}
