'use client';

import { useEffect, useState } from 'react';
import { STORE_ROLE_LABELS, type StoreRole } from '@nexoloja/shared';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { useModalLayer } from '@/lib/keyboard';

/**
 * Membros de uma loja no painel da PLATAFORMA (ADR-014 §4, Fatia 4) — o Super Usuário vê quem tem acesso, concede
 * acesso DIRETO a uma conta que já existe (implantação acompanhada, implantador temporário) e revoga. Diferente do
 * convite da loja, aqui não há aceite: a plataforma é confiável. Tudo fica na auditoria da loja.
 */

type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
  storeRole: StoreRole;
  status: 'ACTIVE' | 'PENDING';
  isActive: boolean;
  invitedByName: string | null;
};

export function TenantMembersModal({
  tenant,
  onClose,
}: {
  tenant: { id: string; name: string };
  onClose: () => void;
}) {
  // Esc fecha / F8 confirma nesta janela (pilha de camadas — lib/keyboard.tsx).
  const layerRef = useModalLayer(onClose);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StoreRole>('USER');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      setMembers(await apiGet<Member[]>(`/platform/tenants/${tenant.id}/members`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.id]);

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await apiPost(`/platform/tenants/${tenant.id}/members`, { email: email.trim(), storeRole: role });
      setMsg(`Acesso concedido a ${email.trim()}.`);
      setEmail('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(m: Member) {
    if (!window.confirm(`Revogar o acesso de ${m.name} (${m.email}) à ${tenant.name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/platform/tenants/${tenant.id}/members/${m.userId}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={layerRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Membros — {tenant.name}</h2>
            <p className="text-xs text-gray-500">Quem tem acesso a esta loja e com qual papel.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Fechar">
            ✕
          </button>
        </div>

        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {msg && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}

        {members === null ? (
          <p className="text-sm text-gray-500">Carregando…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="py-1">Pessoa</th>
                <th className="py-1">Papel</th>
                <th className="py-1">Situação</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className="border-t border-gray-100">
                  <td className="py-2">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-gray-500">
                      {m.email}
                    </div>
                  </td>
                  <td className="py-2">{m.role === 'OWNER' ? 'Dono' : STORE_ROLE_LABELS[m.storeRole]}</td>
                  <td className="py-2 text-xs">
                    {m.status === 'PENDING' ? (
                      <span className="text-amber-700">Convite pendente</span>
                    ) : m.isActive ? (
                      <span className="text-green-700">Ativo</span>
                    ) : (
                      <span className="text-gray-500">Inativo</span>
                    )}
                    {m.invitedByName && <div className="text-gray-400">por {m.invitedByName}</div>}
                  </td>
                  <td className="py-2 text-right">
                    {m.role !== 'OWNER' && (
                      <button
                        onClick={() => void revoke(m)}
                        disabled={busy}
                        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                      >
                        Revogar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form onSubmit={grant} className="mt-6 border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold">Conceder acesso a uma conta existente</h3>
          <p className="mt-1 text-xs text-gray-500">
            Sem aceite (ação da plataforma). Para quem ainda não tem conta, use o convite na tela de Usuários da loja.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@exemplo.com"
              className="min-w-[220px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StoreRole)}
              className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
            >
              {(['USER', 'ADMIN'] as StoreRole[]).map((r) => (
                <option key={r} value={r}>
                  {STORE_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button
              data-confirm
              type="submit"
              disabled={busy}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Conceder
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
