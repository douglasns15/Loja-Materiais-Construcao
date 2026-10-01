'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createEmployeeSchema,
  EMPLOYEE_ROLE_LABELS,
  formatPhoneBr,
  type EmployeeRole,
  type EmployeeRow,
} from '@nexoloja/shared';
import { normalizeSearchText } from '@nexoloja/core';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { useReloadOnReconnect } from '@/lib/useReloadOnReconnect';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';
import { MaskedInput } from '@/components/MaskedInput';

/**
 * Funcionários (ADR-042) — cadastro simples, SEM login, para indicar o ENTREGADOR de cada entrega
 * agendada no PDV. Admin cadastra/edita/desativa/exclui; os demais só consultam (a API também barra).
 */

const EMPTY_FORM = { name: '', phone: '', role: 'COURIER' as EmployeeRole };

const inputCls =
  'rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

export default function EmployeesPage() {
  const online = useOnline();
  const { isAdmin } = useMe();
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Falha na CARGA da lista (≠ erro de ação): liga a auto-recuperação (ADR-005).
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  // Linha em edição (na própria tabela) e linha com a exclusão aguardando confirmação.
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState(EMPTY_FORM);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function load() {
    setRows(await apiGet<EmployeeRow[]>('/employees'));
  }

  useEffect(() => {
    load()
      .then(() => setLoadFailed(false))
      .catch((e) => {
        setError((e as Error).message);
        setLoadFailed(true);
      });
  }, []);

  useReloadOnReconnect(() => {
    load()
      .then(() => setLoadFailed(false))
      .catch((e) => {
        setError((e as Error).message);
        setLoadFailed(true);
      });
  }, loadFailed);

  const filtered = useMemo(() => {
    const q = normalizeSearchText(search);
    if (!q) return rows;
    return rows.filter((r) => normalizeSearchText(`${r.name} ${r.phone ?? ''}`).includes(q));
  }, [rows, search]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createEmployeeSchema.safeParse({
      name: form.name,
      ...(form.phone ? { phone: form.phone } : {}),
      role: form.role,
    });
    if (!parsed.success) {
      setError('Informe o nome do funcionário.');
      return;
    }
    setSaving(true);
    try {
      await apiPost('/employees', parsed.data);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(r: EmployeeRow) {
    setConfirmDeleteId(null);
    setEditId(r.id);
    setEdit({ name: r.name, phone: r.phone ?? '', role: r.role });
  }

  async function saveEdit(id: string) {
    setError(null);
    if (!edit.name.trim()) {
      setError('Informe o nome do funcionário.');
      return;
    }
    try {
      await apiPatch(`/employees/${id}`, { name: edit.name.trim(), phone: edit.phone || null, role: edit.role });
      setEditId(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleActive(r: EmployeeRow) {
    setError(null);
    try {
      await apiPatch(`/employees/${r.id}`, { isActive: !r.isActive });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiDelete(`/employees/${id}`);
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-2xl font-bold text-transparent">
        Funcionários
      </h1>
      <p className="mb-5 text-sm text-gray-500">
        Cadastre os <strong>entregadores</strong> para indicar quem leva cada entrega agendada no PDV.
        Funcionário não precisa de login no sistema.
      </p>

      <OfflineNotice />

      {isAdmin && (
        <form
          onSubmit={onCreate}
          className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-md sm:grid-cols-4"
        >
          <input
            id="emp-name"
            placeholder="Nome"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            maxLength={120}
            className={`${inputCls} sm:col-span-2`}
          />
          <MaskedInput
            id="emp-phone"
            placeholder="Telefone (opcional)"
            value={form.phone}
            onChange={(v) => setForm({ ...form, phone: v })}
            format={formatPhoneBr}
            maxDigits={11}
            inputMode="tel"
            className={inputCls}
          />
          <select
            id="emp-role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as EmployeeRole })}
            className={`${inputCls} bg-white`}
            aria-label="Função"
          >
            {(Object.keys(EMPLOYEE_ROLE_LABELS) as EmployeeRole[]).map((r) => (
              <option key={r} value={r}>
                {EMPLOYEE_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 py-2 font-medium text-white shadow-sm hover:from-indigo-700 hover:to-indigo-600 disabled:opacity-60 sm:col-span-4"
          >
            {saving ? 'Salvando…' : 'Adicionar funcionário'}
          </button>
        </form>
      )}

      <div className="mb-3 sm:max-w-md">
        <input
          type="search"
          placeholder="Buscar funcionário (nome ou telefone)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`w-full ${inputCls}`}
          aria-label="Buscar funcionário"
        />
      </div>

      {error && online && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-md">
        <table className="w-full text-sm">
          <thead className="bg-indigo-50 text-left text-indigo-900">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Telefone</th>
              <th className="px-4 py-2">Função</th>
              <th className="px-4 py-2">Situação</th>
              {isAdmin && <th className="px-4 py-2 text-right">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 5 : 4} className="px-4 py-6 text-center text-gray-500">
                  {search.trim() ? 'Nenhum funcionário encontrado para a busca.' : 'Nenhum funcionário cadastrado.'}
                </td>
              </tr>
            ) : (
              filtered.map((r) =>
                editId === r.id ? (
                  <tr key={r.id} className="border-t border-gray-100 bg-indigo-50/40">
                    <td className="px-4 py-2">
                      <input
                        id={`emp-edit-name-${r.id}`}
                        value={edit.name}
                        onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                        maxLength={120}
                        className={`w-full ${inputCls} py-1`}
                        aria-label="Nome"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <MaskedInput
                        id={`emp-edit-phone-${r.id}`}
                        value={edit.phone}
                        onChange={(v) => setEdit({ ...edit, phone: v })}
                        format={formatPhoneBr}
                        maxDigits={11}
                        inputMode="tel"
                        className={`w-full ${inputCls} py-1`}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        id={`emp-edit-role-${r.id}`}
                        value={edit.role}
                        onChange={(e) => setEdit({ ...edit, role: e.target.value as EmployeeRole })}
                        className={`${inputCls} bg-white py-1`}
                        aria-label="Função"
                      >
                        {(Object.keys(EMPLOYEE_ROLE_LABELS) as EmployeeRole[]).map((x) => (
                          <option key={x} value={x}>
                            {EMPLOYEE_ROLE_LABELS[x]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-gray-500">{r.isActive ? 'Ativo' : 'Inativo'}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => saveEdit(r.id)}
                        className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                      >
                        Salvar
                      </button>{' '}
                      <button
                        type="button"
                        onClick={() => setEditId(null)}
                        className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        Cancelar
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className={`border-t border-gray-100 ${r.isActive ? '' : 'text-gray-400'}`}>
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2">{r.phone ? formatPhoneBr(r.phone) : '—'}</td>
                    <td className="px-4 py-2">{EMPLOYEE_ROLE_LABELS[r.role]}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {r.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {confirmDeleteId === r.id ? (
                          <>
                            <span className="mr-2 text-xs text-red-700">Excluir {r.name}?</span>
                            <button
                              type="button"
                              onClick={() => remove(r.id)}
                              className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
                            >
                              Excluir
                            </button>{' '}
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
                            >
                              Manter
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(r)}
                              className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleActive(r)}
                              className="rounded-lg px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                            >
                              {r.isActive ? 'Desativar' : 'Reativar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditId(null);
                                setConfirmDeleteId(r.id);
                              }}
                              className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                            >
                              Excluir
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
