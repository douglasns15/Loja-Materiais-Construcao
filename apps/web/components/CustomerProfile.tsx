'use client';

import { useEffect, useState } from 'react';
import {
  formatCpfCnpj,
  formatDateBr,
  formatOrderNumber,
  formatPhoneBr,
  RECEIVABLE_STATUS_LABELS,
  updateCustomerSchema,
  type CustomerHistory,
} from '@nexoloja/shared';
import { apiGet, apiPatch } from '@/lib/api';
import { MaskedInput } from '@/components/MaskedInput';
import { ReceivableDetailModal } from '@/components/ReceivableDetailModal';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type FullCustomer = {
  id: string;
  name: string;
  cpfCnpj: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  updatedByName: string | null;
  updatedAt: string;
};

type FormState = { name: string; cpfCnpj: string; phone: string; email: string; address: string; notes: string };
const toForm = (c: FullCustomer): FormState => ({
  name: c.name,
  cpfCnpj: c.cpfCnpj ?? '',
  phone: c.phone ?? '',
  email: c.email ?? '',
  address: c.address ?? '',
  notes: c.notes ?? '',
});

/**
 * Perfil do cliente (aberto ao clicar no nome na tela de Clientes): dados editáveis + **observações**
 * + **histórico** com tudo que está vinculado a ele — suas vendas e suas contas a receber (ADR-019).
 * Uma dívida em aberto ganha o selo "Dívida ativa" e abre o detalhe da dívida ao clicar.
 */
export function CustomerProfile({
  customerId,
  onClose,
  onSaved,
}: {
  customerId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [customer, setCustomer] = useState<FullCustomer | null>(null);
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Dívida aberta no detalhe (a partir do histórico).
  const [receivableId, setReceivableId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [c, h] = await Promise.all([
          apiGet<FullCustomer>(`/customers/${customerId}`),
          apiGet<CustomerHistory>(`/customers/${customerId}/history`),
        ]);
        if (cancelled) return;
        setCustomer(c);
        setForm(toForm(c));
        setHistory(h);
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const changed =
    customer !== null && form !== null && JSON.stringify(form) !== JSON.stringify(toForm(customer));

  async function save() {
    if (!form) return;
    // Envia só os campos com conteúdo; strings vazias viram undefined (não sobrescreve com "").
    const payload = {
      name: form.name.trim(),
      cpfCnpj: form.cpfCnpj.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      address: form.address.trim() || undefined,
      notes: form.notes.trim() || undefined,
    };
    const parsed = updateCustomerSchema.safeParse(payload);
    if (!parsed.success) {
      setError('Confira os campos: nome é obrigatório e o e-mail deve ser válido.');
      return;
    }
    setSaving(true);
    setSaved(false);
    try {
      const updated = await apiPatch<FullCustomer>(`/customers/${customerId}`, parsed.data);
      setCustomer(updated);
      setForm(toForm(updated));
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function setField(key: keyof FormState, v: string) {
    setSaved(false);
    setForm((f) => (f ? { ...f, [key]: v } : f));
  }

  function field(
    label: string,
    key: keyof FormState,
    opts?: {
      type?: string;
      full?: boolean;
      /** Máscara ao sair do campo (telefone/CPF/CNPJ); guarda só dígitos. */
      mask?: (v: string | null | undefined) => string;
      maxDigits?: number;
    },
  ) {
    const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
    return (
      <label className={`block ${opts?.full ? 'sm:col-span-2' : ''}`}>
        <span className="mb-1 block text-xs text-gray-600">{label}</span>
        {opts?.mask ? (
          <MaskedInput
            value={form?.[key] ?? ''}
            onChange={(v) => setField(key, v)}
            format={opts.mask}
            maxDigits={opts.maxDigits ?? 14}
            inputMode={opts.maxDigits === 11 ? 'tel' : 'numeric'}
            className={inputClass}
          />
        ) : (
          <input
            type={opts?.type ?? 'text'}
            value={form?.[key] ?? ''}
            onChange={(e) => setField(key, e.target.value)}
            className={inputClass}
          />
        )}
      </label>
    );
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-2xl space-y-5 rounded-2xl bg-white p-5 shadow-lg"
      >
        {loading || !form ? (
          <p className="text-gray-600">{error ?? 'Carregando…'}</p>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold">{customer?.name}</h2>
              <button
                type="button"
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            {/* Dados do cliente (editáveis). */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field('Nome', 'name', { full: true })}
              {field('CPF/CNPJ', 'cpfCnpj', { mask: formatCpfCnpj, maxDigits: 14 })}
              {field('Telefone', 'phone', { mask: formatPhoneBr, maxDigits: 11 })}
              {field('E-mail', 'email', { type: 'email', full: true })}
              {field('Endereço', 'address', { full: true })}
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs text-gray-600">Observações</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => {
                    setSaved(false);
                    setForm((f) => (f ? { ...f, notes: e.target.value } : f));
                  }}
                  rows={2}
                  maxLength={500}
                  placeholder="Anotações sobre o cliente…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={!changed || saving || !form.name.trim()}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
              {saved && !changed && <span className="text-xs text-green-700">Salvo ✓</span>}
            </div>

            {/* Histórico: contas a receber + vendas. */}
            <div className="border-t border-gray-100 pt-4">
              <h3 className="mb-2 text-sm font-semibold">Contas a receber</h3>
              {!history || history.receivables.length === 0 ? (
                <p className="text-sm text-gray-600">Nenhuma venda a prazo para este cliente.</p>
              ) : (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {history.receivables.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <span className="text-gray-600">
                          {/* Código clicável: abre o detalhe da dívida (aberta ou quitada) para consulta. */}
                          <button
                            type="button"
                            onClick={() => setReceivableId(r.id)}
                            className="font-medium text-blue-700 hover:underline"
                          >
                            {formatOrderNumber(r.orderNumber) || `#${r.orderId.slice(0, 8)}`}
                          </button>{' '}
                          · {new Date(r.createdAt).toLocaleDateString('pt-BR')} ·{' '}
                          {BRL(r.originalAmount)}
                        </span>
                        <span className="block text-xs text-gray-500">
                          Saldo {BRL(r.balance)}
                          {r.dueDate ? ` · vence ${formatDateBr(r.dueDate)}` : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReceivableId(r.id)}
                        className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
                          r.status === 'OPEN'
                            ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {r.status === 'OPEN' ? 'Dívida ativa' : RECEIVABLE_STATUS_LABELS[r.status]}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="mb-2 mt-4 text-sm font-semibold">Vendas</h3>
              {!history || history.orders.length === 0 ? (
                <p className="text-sm text-gray-600">Nenhuma venda vinculada a este cliente.</p>
              ) : (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {history.orders.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <span className="font-mono text-xs text-gray-500">#{o.id.slice(0, 8)}</span>{' '}
                        <span className="text-gray-600">
                          {new Date(o.createdAt).toLocaleString('pt-BR')}
                        </span>
                        {(o.status === 'CANCELLED' || o.status === 'RETURNED') && (
                          <span className="ml-2 text-xs text-red-600">
                            {o.status === 'CANCELLED' ? 'cancelada' : 'devolvida'}
                          </span>
                        )}
                        {o.receivableId && (
                          <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            a prazo
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 tabular-nums">{BRL(o.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {/* Detalhe da dívida (reusa o componente de Contas a Receber; aqui só leitura). */}
      {receivableId && (
        <ReceivableDetailModal receivableId={receivableId} onClose={() => setReceivableId(null)} />
      )}
    </div>
  );
}
