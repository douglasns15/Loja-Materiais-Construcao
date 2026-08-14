'use client';

import { useEffect, useMemo, useState } from 'react';
import { createSupplierSchema } from '@nexoloja/shared';
import { normalizeSearchText } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';
import { SupplierFormModal, type Supplier } from '@/components/SupplierFormModal';

/** Estado do formulário de cadastro (tudo string; opcionais vazios são omitidos no envio). */
const EMPTY_FORM = { name: '', cnpj: '', phone: '', email: '', address: '', notes: '' };

export default function SuppliersPage() {
  const online = useOnline();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  // Fornecedor aberto para editar (clicar no nome) — dados + observações + remover.
  const [editId, setEditId] = useState<string | null>(null);

  // A API de fornecedores devolve a lista inteira do tenant (sem paginação): busca é client-side,
  // igual ao filtro de produtos da tela de Estoque. Catálogo de fornecedores é pequeno.
  async function load() {
    const items = await apiGet<Supplier[]>('/suppliers');
    setSuppliers(items);
  }

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, []);

  // Filtro por nome/CNPJ/telefone/e-mail, acento-insensível (mesma normalização do resto do app).
  const filtered = useMemo(() => {
    const q = normalizeSearchText(search);
    if (!q) return suppliers;
    return suppliers.filter((s) =>
      normalizeSearchText(`${s.name} ${s.cnpj ?? ''} ${s.phone ?? ''} ${s.email ?? ''}`).includes(q),
    );
  }, [suppliers, search]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Omite campos opcionais vazios (e-mail vazio não passa na validação de e-mail).
    const payload: Record<string, string> = { name: form.name };
    if (form.cnpj) payload.cnpj = form.cnpj;
    if (form.phone) payload.phone = form.phone;
    if (form.email) payload.email = form.email;
    if (form.address) payload.address = form.address;
    if (form.notes) payload.notes = form.notes;

    const parsed = createSupplierSchema.safeParse(payload);
    if (!parsed.success) {
      setError('Confira os campos: nome é obrigatório e o e-mail deve ser válido.');
      return;
    }

    setSaving(true);
    try {
      await apiPost<Supplier>('/suppliers', parsed.data);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-bold">Fornecedores</h1>

      {/* Tela online-only (ADR-012 (c)): offline mostra o aviso de rede, não o erro cru. */}
      <OfflineNotice />

      <form
        onSubmit={onCreate}
        className="mb-6 grid grid-cols-1 gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-4"
      >
        <input
          placeholder="Nome"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
        />
        <input
          placeholder="CNPJ (opcional)"
          value={form.cnpj}
          onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
        <input
          placeholder="Telefone (opcional)"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
        <input
          placeholder="E-mail (opcional)"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
        />
        <input
          placeholder="Endereço (opcional)"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
        />
        <textarea
          placeholder="Observações (opcional)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          maxLength={500}
          className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-4"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-60 sm:col-span-4"
        >
          {saving ? 'Salvando…' : 'Adicionar fornecedor'}
        </button>
      </form>

      {/* Busca client-side (a lista já vem inteira): nome, CNPJ, telefone ou e-mail. */}
      <div className="mb-3 sm:max-w-md">
        <input
          type="search"
          placeholder="Buscar fornecedor (nome, CNPJ, telefone ou e-mail)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
          aria-label="Buscar fornecedor"
        />
      </div>

      {error && online && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-blue-200 text-left text-blue-900">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">CNPJ</th>
              <th className="px-4 py-2">Telefone</th>
              <th className="px-4 py-2">E-mail</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  {search.trim()
                    ? 'Nenhum fornecedor encontrado para a busca.'
                    : 'Nenhum fornecedor cadastrado.'}
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">
                    {/* Clicar no nome abre a edição (dados + observações + remover). */}
                    <button
                      type="button"
                      onClick={() => setEditId(s.id)}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {s.name}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{s.cnpj ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{s.phone ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{s.email ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Edição do fornecedor (dados + observações + remover). Recarrega a lista ao salvar/remover. */}
      {editId && (
        <SupplierFormModal
          supplierId={editId}
          onClose={() => setEditId(null)}
          onSaved={() => load().catch(() => {})}
          onDeleted={() => load().catch(() => {})}
        />
      )}
    </div>
  );
}
