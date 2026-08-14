'use client';

import { useState } from 'react';
import { createCustomerSchema } from '@nexoloja/shared';
import { apiPost } from '@/lib/api';

/** Cliente recém-criado devolvido ao chamador (o PDV já o seleciona). */
export type CreatedCustomer = { id: string; name: string };

const inputClass =
  'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900';

/**
 * Cadastro rápido de cliente a partir do PDV — quando o operador busca e o cliente ainda não existe,
 * cadastra na hora sem sair da venda. Só CRIAÇÃO (o cadastro completo/edição vive em Clientes).
 * `initialName` vem do que já foi digitado na busca; `onCreated` devolve o cliente para selecionar.
 */
export function CustomerQuickAddModal({
  initialName = '',
  onClose,
  onCreated,
}: {
  initialName?: string;
  onClose: () => void;
  onCreated: (customer: CreatedCustomer) => void;
}) {
  const [form, setForm] = useState({
    name: initialName,
    cpfCnpj: '',
    phone: '',
    email: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Omite os opcionais vazios (e-mail vazio reprova na validação de e-mail).
    const payload: Record<string, string> = { name: form.name.trim() };
    if (form.cpfCnpj.trim()) payload.cpfCnpj = form.cpfCnpj.trim();
    if (form.phone.trim()) payload.phone = form.phone.trim();
    if (form.email.trim()) payload.email = form.email.trim();
    if (form.notes.trim()) payload.notes = form.notes.trim();

    const parsed = createCustomerSchema.safeParse(payload);
    if (!parsed.success) {
      setError('Confira os campos: nome é obrigatório e o e-mail deve ser válido.');
      return;
    }

    setSaving(true);
    try {
      const created = await apiPost<CreatedCustomer>('/customers', parsed.data);
      onCreated(created);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Novo cliente</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="qc-name" className="block text-sm font-medium text-gray-700">
              Nome <span className="text-red-500">*</span>
            </label>
            <input
              id="qc-name"
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
            <label htmlFor="qc-cpf" className="block text-sm font-medium text-gray-700">
              CPF/CNPJ
            </label>
            <input
              id="qc-cpf"
              type="text"
              value={form.cpfCnpj}
              onChange={(e) => setForm({ ...form, cpfCnpj: e.target.value })}
              maxLength={18}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="qc-phone" className="block text-sm font-medium text-gray-700">
              Telefone
            </label>
            <input
              id="qc-phone"
              type="text"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              maxLength={20}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="qc-email" className="block text-sm font-medium text-gray-700">
              E-mail
            </label>
            <input
              id="qc-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              maxLength={150}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="qc-notes" className="block text-sm font-medium text-gray-700">
              Observações
            </label>
            <textarea
              id="qc-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              maxLength={500}
              className={inputClass}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Salvando…' : 'Cadastrar e selecionar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
