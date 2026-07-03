'use client';

import { useEffect, useState } from 'react';
import { STORE_ROLE_LABELS, type StoreRole } from '@nexoloja/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';

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
 * Convite por e-mail (ADR-008, fatia 2) cria o usuário no Supabase Auth + linha em `users`.
 */
export function UsersSection({ currentUserId }: { currentUserId: string | null }) {
  const [users, setUsers] = useState<StoreUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // --- Convite por e-mail ---
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<StoreRole>('USER');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null);

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

  async function remove(u: StoreUser) {
    if (
      !window.confirm(
        `Excluir o usuário "${u.name}" (${u.email})? Esta ação remove o acesso de vez e libera o e-mail. ` +
          `Se o usuário tiver histórico de vendas/caixa, use "Desativar".`,
      )
    ) {
      return;
    }
    setBusyId(u.id);
    setError(null);
    try {
      await apiDelete(`/users/${u.id}`);
      setUsers((list) => list.filter((x) => x.id !== u.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviteMsg(null);
    const email = inviteEmail.trim();
    if (!email) {
      setInviteMsg({ ok: false, text: 'Informe o e-mail do convidado.' });
      return;
    }
    setInviting(true);
    try {
      const created = await apiPost<StoreUser>('/users/invite', {
        email,
        storeRole: inviteRole,
        redirectTo: `${window.location.origin}/definir-senha`,
      });
      // Insere/atualiza na lista sem refazer o GET.
      setUsers((list) => {
        const rest = list.filter((u) => u.id !== created.id);
        return [created, ...rest];
      });
      setInviteEmail('');
      setInviteRole('USER');
      setInviteMsg({ ok: true, text: `Convite enviado para ${created.email}.` });
    } catch (err) {
      setInviteMsg({ ok: false, text: (err as Error).message });
    } finally {
      setInviting(false);
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
                      <>
                        <button
                          onClick={() => patch(u.id, { isActive: !u.isActive })}
                          disabled={busyId === u.id}
                          className="ml-3 text-xs font-medium text-gray-600 underline hover:text-gray-900 disabled:opacity-50"
                        >
                          {u.isActive ? 'Desativar' : 'Ativar'}
                        </button>
                        <button
                          onClick={() => remove(u)}
                          disabled={busyId === u.id}
                          className="ml-3 text-xs font-medium text-red-600 underline hover:text-red-800 disabled:opacity-50"
                        >
                          Excluir
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form onSubmit={invite} className="mt-6 border-t border-gray-100 pt-6">
        <h3 className="text-sm font-semibold text-gray-900">Convidar novo usuário</h3>
        <p className="mt-1 text-xs text-gray-500">
          Enviaremos um e-mail com um link para a pessoa definir a senha e acessar a loja.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label htmlFor="invite-email" className="block text-xs font-medium text-gray-600">
              E-mail
            </label>
            <input
              id="invite-email"
              type="email"
              autoComplete="off"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="pessoa@exemplo.com"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="block text-xs font-medium text-gray-600">
              Papel
            </label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as StoreRole)}
              className="mt-1 rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-gray-900 focus:outline-none"
            >
              {(['USER', 'ADMIN'] as StoreRole[]).map((r) => (
                <option key={r} value={r}>
                  {STORE_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={inviting}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {inviting ? 'Enviando…' : 'Convidar'}
          </button>
        </div>
        {inviteMsg && (
          <p className={`mt-3 text-sm ${inviteMsg.ok ? 'text-green-600' : 'text-red-600'}`}>
            {inviteMsg.text}
          </p>
        )}
      </form>
    </section>
  );
}
