'use client';

import { useEffect, useState } from 'react';
import { createCustomerSchema, formatCpfCnpj, formatPhoneBr } from '@nexoloja/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';
import { MaskedInput } from '@/components/MaskedInput';
import { CustomerProfile } from '@/components/CustomerProfile';

type Customer = {
  id: string;
  name: string;
  cpfCnpj: string | null;
  phone: string | null;
  email: string | null;
  updatedByName: string | null;
  updatedAt: string;
};

/** Página do cadastro (busca no servidor + paginação keyset): linhas + cursor da próxima página. */
type CustomersPage = { rows: Customer[]; nextCursor: string | null };

/** Quantos clientes por página / clique em "Mostrar mais". */
const PAGE_SIZE = 20;

/** Autoria (ADR-010): "por <nome> · <data>", ou "—" quando não há registro (dados antigos). */
const byLine = (name: string | null, iso?: string) =>
  name ? `${name}${iso ? ` · ${new Date(iso).toLocaleDateString('pt-BR')}` : ''}` : '—';

/** Monta a query de `GET /customers` com busca e cursor. */
function customersQuery(cursor: string | null, q: string): string {
  const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (q.trim()) p.set('q', q.trim());
  if (cursor) p.set('cursor', cursor);
  return `/customers?${p.toString()}`;
}

export default function CustomersPage() {
  const online = useOnline();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', cpfCnpj: '', phone: '', email: '', notes: '' });
  const [saving, setSaving] = useState(false);
  // Busca no servidor: `search` é o que está no campo; a query dispara com debounce.
  const [search, setSearch] = useState('');
  // Perfil do cliente aberto (clicar no nome) — dados + observações + histórico.
  const [profileId, setProfileId] = useState<string | null>(null);

  // Carrega a 1ª página para um termo (substitui a lista). O termo default vem do estado.
  async function load(q: string = search) {
    const page = await apiGet<CustomersPage>(customersQuery(null, q));
    setCustomers(page.rows);
    setNextCursor(page.nextCursor);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await apiGet<CustomersPage>(customersQuery(nextCursor, search));
      setCustomers((prev) => [...prev, ...page.rows]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  // Busca no servidor com debounce (300 ms): recarrega a 1ª página a cada termo, sem baixar a
  // base inteira. Roda também na montagem (termo vazio = primeiros PAGE_SIZE em ordem alfabética).
  useEffect(() => {
    const t = setTimeout(() => {
      load(search).catch((e) => setError((e as Error).message));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Omite campos opcionais vazios (e-mail vazio não passa na validação de e-mail).
    const payload: Record<string, string> = { name: form.name };
    if (form.cpfCnpj) payload.cpfCnpj = form.cpfCnpj;
    if (form.phone) payload.phone = form.phone;
    if (form.email) payload.email = form.email;
    if (form.notes) payload.notes = form.notes;

    const parsed = createCustomerSchema.safeParse(payload);
    if (!parsed.success) {
      setError('Confira os campos: nome é obrigatório e o e-mail deve ser válido.');
      return;
    }

    setSaving(true);
    try {
      await apiPost<Customer>('/customers', parsed.data);
      setForm({ name: '', cpfCnpj: '', phone: '', email: '', notes: '' });
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
        <MaskedInput
          placeholder="CPF/CNPJ"
          value={form.cpfCnpj}
          onChange={(v) => setForm({ ...form, cpfCnpj: v })}
          format={formatCpfCnpj}
          maxDigits={14}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
        <MaskedInput
          placeholder="Telefone"
          value={form.phone}
          onChange={(v) => setForm({ ...form, phone: v })}
          format={formatPhoneBr}
          maxDigits={11}
          inputMode="tel"
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
        <input
          placeholder="E-mail"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
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
          {saving ? 'Salvando…' : 'Adicionar cliente'}
        </button>
      </form>

      {/* Busca no servidor: procura por nome, CPF/CNPJ, telefone ou e-mail (não baixa tudo). */}
      <div className="mb-3 sm:max-w-md">
        <input
          type="search"
          placeholder="Buscar cliente (nome, CPF/CNPJ, telefone ou e-mail)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
          aria-label="Buscar cliente"
        />
      </div>

      {error && online && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-blue-200 text-left text-blue-900">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">CPF/CNPJ</th>
              <th className="px-4 py-2">Telefone</th>
              <th className="px-4 py-2">E-mail</th>
              <th className="px-4 py-2">Última alteração</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  {search.trim()
                    ? 'Nenhum cliente encontrado para a busca.'
                    : 'Nenhum cliente cadastrado.'}
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">
                    {/* Clicar no nome abre o perfil (dados + observações + histórico). */}
                    <button
                      type="button"
                      onClick={() => setProfileId(c.id)}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {c.name}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{c.cpfCnpj ? formatCpfCnpj(c.cpfCnpj) : '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{c.phone ? formatPhoneBr(c.phone) : '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{c.email ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {byLine(c.updatedByName, c.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação keyset: só aparece quando o servidor sinaliza mais páginas. */}
      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
          >
            {loadingMore ? 'Carregando…' : 'Mostrar mais'}
          </button>
        </div>
      )}

      {/* Perfil do cliente (dados + observações + histórico). Recarrega a lista ao salvar. */}
      {profileId && (
        <CustomerProfile
          customerId={profileId}
          onClose={() => setProfileId(null)}
          onSaved={() => load().catch(() => {})}
        />
      )}
    </div>
  );
}
