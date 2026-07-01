'use client';

import { useEffect, useState } from 'react';
import { STORE_ROLE_LABELS, type StoreRole } from '@nexoloja/shared';
import { apiGet, apiPatch } from '@/lib/api';

type StoreUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  storeRole: StoreRole;
};

/**
 * Gestão de usuários da loja (ADR-008) — visível só para Admin.
 * Lista os usuários e permite definir papel (Admin/Usuário) e ativar/desativar.
 * O dono (`OWNER`) aparece como Admin, mas não é editável (a API bloqueia).
 * Convite por e-mail entra numa fatia seguinte (exige service_role no Worker).
 */
export function UsersSection({ currentUserId }: { currentUserId: string | null }) {
  const [users, setUsers] = useState<StoreUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      setUsers(await apiGet<StoreUser[]>('/users'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function patch(id: string, body: { storeRole?: StoreRole; isActive?: boolean }) {
    setBusyId(id);
    setError(null);
    try {
      const updated = await apiPatch<StoreUser>(`/users/${id}`, body);
      setUsers((list) => list.map((u) => (u.id === id ? updated : u)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const isOwner = (u: StoreUser) => u.role === 'OWNER';

  return (
    <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Usuários</h2>
      <p className="mt-1 text-sm text-gray-500">
        Defina quem é <strong>Admin</strong> (acesso total) ou <strong>Usuário</strong>{' '}
        (operação: venda, caixa, estoque). O dono da loja não pode ser alterado aqui.
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">E-mail</th>
              <th className="px-4 py-2">Papel</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const locked = isOwner(u) || u.id === currentUserId || busyId === u.id;
              return (
                <tr key={u.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-medium">
                    {u.name}
                    {u.id === currentUserId && (
                      <span className="ml-2 text-xs text-gray-400">(você)</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{u.email}</td>
                  <td className="px-4 py-2">
                    {isOwner(u) ? (
                      <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                        Dono
                      </span>
                    ) : (
                      <select
                        value={u.storeRole}
                        disabled={locked}
                        onChange={(e) =>
                          patch(u.id, { storeRole: e.target.value as StoreRole })
                        }
                        className="rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
                      >
                        {(['ADMIN', 'USER'] as StoreRole[]).map((r) => (
                          <option key={r} value={r}>
                            {STORE_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {u.isActive ? (
                      <span className="text-green-700">Ativo</span>
                    ) : (
                      <span className="text-gray-400">Inativo</span>
                    )}
                    {!isOwner(u) && u.id !== currentUserId && (
                      <button
                        onClick={() => patch(u.id, { isActive: !u.isActive })}
                        disabled={busyId === u.id}
                        className="ml-3 text-xs font-medium text-gray-600 underline hover:text-gray-900 disabled:opacity-50"
                      >
                        {u.isActive ? 'Desativar' : 'Ativar'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Convidar novos usuários por e-mail entra numa próxima etapa. Hoje o primeiro acesso de
        cada loja é criado pelo administrador do sistema.
      </p>
    </section>
  );
}
