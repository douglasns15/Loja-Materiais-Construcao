'use client';

import { useEffect, useState } from 'react';
import { createSupplierSchema, formatCnpj, formatPhoneBr, updateSupplierSchema } from '@nexoloja/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { MaskedInput } from '@/components/MaskedInput';

/** Fornecedor como devolvido pela API (`/suppliers`). */
export type Supplier = {
  id: string;
  name: string;
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** Campos editáveis do formulário (tudo string; opcionais vazios são omitidos no envio). */
type Form = { name: string; cnpj: string; phone: string; email: string; address: string; notes: string };
const EMPTY: Form = { name: '', cnpj: '', phone: '', email: '', address: '', notes: '' };

const inputClass =
  'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900';

/** Monta o payload sem os opcionais vazios (e-mail vazio reprova na validação de e-mail). */
function buildPayload(form: Form): Record<string, string> {
  const p: Record<string, string> = { name: form.name.trim() };
  if (form.cnpj.trim()) p.cnpj = form.cnpj.trim();
  if (form.phone.trim()) p.phone = form.phone.trim();
  if (form.email.trim()) p.email = form.email.trim();
  if (form.address.trim()) p.address = form.address.trim();
  if (form.notes.trim()) p.notes = form.notes.trim();
  return p;
}

/**
 * Modal único de cadastro de Fornecedor — serve para **criar** (sem `supplierId`) e **editar**
 * (com `supplierId`; carrega os dados, permite salvar e remover). Reusado na tela de Fornecedores e
 * no atalho "+ Novo fornecedor" da Entrada de Estoque. `onSaved` devolve o registro salvo (criado ou
 * atualizado) para quem quiser já selecioná-lo (caso do Estoque).
 */
export function SupplierFormModal({
  supplierId,
  onClose,
  onSaved,
  onDeleted,
}: {
  supplierId?: string;
  onClose: () => void;
  onSaved: (supplier: Supplier) => void;
  onDeleted?: () => void;
}) {
  const isEdit = !!supplierId;
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modo edição: carrega os dados atuais do fornecedor.
  useEffect(() => {
    if (!supplierId) return;
    let cancelled = false;
    setLoading(true);
    apiGet<Supplier>(`/suppliers/${supplierId}`)
      .then((s) => {
        if (cancelled) return;
        setForm({
          name: s.name ?? '',
          cnpj: s.cnpj ?? '',
          phone: s.phone ?? '',
          email: s.email ?? '',
          address: s.address ?? '',
          notes: s.notes ?? '',
        });
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload = buildPayload(form);
    const schema = isEdit ? updateSupplierSchema : createSupplierSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setError('Confira os campos: nome é obrigatório e o e-mail deve ser válido.');
      return;
    }

    setSaving(true);
    try {
      const saved = isEdit
        ? await apiPatch<Supplier>(`/suppliers/${supplierId}`, parsed.data)
        : await apiPost<Supplier>('/suppliers', parsed.data);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onRemove() {
    if (!supplierId) return;
    if (!confirm(`Remover o fornecedor "${form.name}"? Ele deixa de aparecer nas listas.`)) return;
    setError(null);
    setRemoving(true);
    try {
      await apiDelete(`/suppliers/${supplierId}`);
      onDeleted?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setRemoving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Editar fornecedor' : 'Novo fornecedor'}</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <p className="py-6 text-center text-gray-500">Carregando…</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="sup-name" className="block text-sm font-medium text-gray-700">
                Nome <span className="text-red-500">*</span>
              </label>
              <input
                id="sup-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={120}
                required
                autoFocus
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="sup-cnpj" className="block text-sm font-medium text-gray-700">
                CNPJ
              </label>
              <MaskedInput
                id="sup-cnpj"
                value={form.cnpj}
                onChange={(v) => setForm({ ...form, cnpj: v })}
                format={formatCnpj}
                maxDigits={14}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="sup-phone" className="block text-sm font-medium text-gray-700">
                Telefone
              </label>
              <MaskedInput
                id="sup-phone"
                value={form.phone}
                onChange={(v) => setForm({ ...form, phone: v })}
                format={formatPhoneBr}
                maxDigits={11}
                inputMode="tel"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="sup-email" className="block text-sm font-medium text-gray-700">
                E-mail
              </label>
              <input
                id="sup-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                maxLength={150}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="sup-address" className="block text-sm font-medium text-gray-700">
                Endereço
              </label>
              <input
                id="sup-address"
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                maxLength={300}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="sup-notes" className="block text-sm font-medium text-gray-700">
                Observações
              </label>
              <textarea
                id="sup-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                maxLength={500}
                className={inputClass}
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex items-center justify-between gap-3 pt-1">
              {/* Remover só no modo edição (soft-delete, ADR-004). */}
              {isEdit ? (
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={removing || saving}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {removing ? 'Removendo…' : 'Remover'}
                </button>
              ) : (
                <span />
              )}
              <button
                type="submit"
                disabled={saving || removing}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Cadastrar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
