'use client';

import { useEffect, useState } from 'react';
import { createTenantSchema, formatCnpj } from '@nexoloja/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

type Tenant = {
  id: string;
  name: string;
  slug: string;
  cnpj: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  userCount: number;
};

type CreatedTenant = {
  id: string;
  name: string;
  slug: string;
  admin: { email: string };
};

const DATE = (v: string) => new Date(v).toLocaleDateString('pt-BR');

export default function PlataformaPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    adminEmail: '',
    adminName: '',
    cnpj: '',
    slug: '',
  });

  async function load() {
    try {
      setTenants(await apiGet<Tenant[]>('/platform/tenants'));
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
    setSuccess(null);

    // Valida no cliente (feedback imediato); a fonte de verdade é a API.
    const parsed = createTenantSchema.safeParse({
      name: form.name,
      adminEmail: form.adminEmail,
      adminName: form.adminName || undefined,
      cnpj: form.cnpj || undefined,
      slug: form.slug || undefined,
      redirectTo:
        typeof window !== 'undefined' ? `${window.location.origin}/definir-senha` : undefined,
    });
    if (!parsed.success) {
      setError('Confira os campos: nome da loja e e-mail do admin são obrigatórios.');
      return;
    }

    setSaving(true);
    try {
      const created = await apiPost<CreatedTenant>('/platform/tenants', parsed.data);
      setSuccess(
        `Loja "${created.name}" criada. Convite enviado para ${created.admin.email} — o admin define a senha pelo link do e-mail.`,
      );
      setForm({ name: '', adminEmail: '', adminName: '', cnpj: '', slug: '' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(t: Tenant) {
    setError(null);
    setSuccess(null);
    setTogglingId(t.id);
    try {
      await apiPatch(`/platform/tenants/${t.id}`, { isActive: !t.isActive });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-2xl font-bold">Lojas</h1>
      <p className="mb-6 text-sm text-gray-500">
        Gestão da plataforma — criar lojas e controlar quais estão ativas.
      </p>

      {/* Criar loja + convidar 1º Admin */}
      <form onSubmit={onCreate} className="mb-6 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 font-semibold">Nova loja</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            placeholder="Nome da loja *"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <input
            placeholder="E-mail do admin *"
            type="email"
            value={form.adminEmail}
            onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <input
            placeholder="Nome do admin (opcional)"
            value={form.adminName}
            onChange={(e) => setForm({ ...form, adminName: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <input
            placeholder="CNPJ (opcional)"
            value={form.cnpj}
            onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <input
            placeholder="Identificador/slug (opcional — gerado do nome)"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="mt-3 w-full rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-60 sm:w-auto sm:px-6"
        >
          {saving ? 'Criando…' : 'Criar loja e convidar admin'}
        </button>
        <p className="mt-2 text-xs text-gray-400">
          O admin recebe um e-mail para definir a senha e entra como dono (OWNER) da loja.
        </p>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {success && (
        <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">
          {success}
        </p>
      )}

      {/* Lista de lojas */}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2">Loja</th>
              <th className="px-4 py-2">CNPJ</th>
              <th className="px-4 py-2 text-right">Usuários</th>
              <th className="px-4 py-2">Criada</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                  Nenhuma loja cadastrada.
                </td>
              </tr>
            ) : (
              tenants.map((t) => (
                <tr key={t.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-gray-400">{t.slug}</div>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{t.cnpj ? formatCnpj(t.cnpj) : '—'}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{t.userCount}</td>
                  <td className="px-4 py-2 text-gray-500">{DATE(t.createdAt)}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        t.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {t.isActive ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => toggleActive(t)}
                      disabled={togglingId === t.id}
                      className={`rounded-lg border px-3 py-1 text-xs font-medium disabled:opacity-50 ${
                        t.isActive
                          ? 'border-gray-300 text-gray-700 hover:bg-gray-100'
                          : 'border-green-600 text-green-700 hover:bg-green-50'
                      }`}
                    >
                      {togglingId === t.id ? '…' : t.isActive ? 'Inativar' : 'Ativar'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
