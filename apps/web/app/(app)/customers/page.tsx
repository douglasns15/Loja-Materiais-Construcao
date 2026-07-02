'use client';

import { useEffect, useState } from 'react';
import { createCustomerSchema } from '@nexoloja/shared';
import { apiGet, apiPost } from '@/lib/api';

type Customer = {
  id: string;
  name: string;
  cpfCnpj: string | null;
  phone: string | null;
  email: string | null;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', cpfCnpj: '', phone: '', email: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setCustomers(await apiGet<Customer[]>('/customers'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Omite campos opcionais vazios (e-mail vazio não passa na validação de e-mail).
    const payload: Record<string, string> = { name: form.name };
    if (form.cpfCnpj) payload.cpfCnpj = form.cpfCnpj;
    if (form.phone) payload.phone = form.phone;
    if (form.email) payload.email = form.email;

    const parsed = createCustomerSchema.safeParse(payload);
    if (!parsed.success) {
      setError('Confira os campos: nome é obrigatório e o e-mail deve ser válido.');
      return;
    }

    setSaving(true);
    try {
      await apiPost<Customer>('/customers', parsed.data);
      setForm({ name: '', cpfCnpj: '', phone: '', email: '' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-bold">Clientes</h1>

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
          placeholder="CPF/CNPJ"
          value={form.cpfCnpj}
          onChange={(e) => setForm({ ...form, cpfCnpj: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
        <input
          placeholder="Telefone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
        <input
          placeholder="E-mail"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-60 sm:col-span-4"
        >
          {saving ? 'Salvando…' : 'Adicionar cliente'}
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">CPF/CNPJ</th>
              <th className="px-4 py-2">Telefone</th>
              <th className="px-4 py-2">E-mail</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  Nenhum cliente cadastrado.
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{c.name}</td>
                  <td className="px-4 py-2 text-gray-500">{c.cpfCnpj ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-500">{c.phone ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-500">{c.email ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
