'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STORE_ROLE_LABELS, type StoreRole } from '@nexoloja/shared';
import { supabase } from '@/lib/supabase';
import { apiGet, apiPost } from '@/lib/api';
import {
  clearActiveTenantId,
  clearStoreCaches,
  getActiveTenantId,
  pendingOfflineSales,
  switchStore,
} from '@/lib/activeStore';

/**
 * Seleção da loja (ADR-014, Fatia 2 — usuário multi-loja). Fica FORA do shell `(app)` de propósito: o
 * shell chama `GET /me`, que responde 409 enquanto a pessoa com 2+ lojas não escolheu.
 *
 * - Depois do login, todo usuário de loja passa por aqui: **uma loja ⇒ entra direto** (sem clique a
 *   mais); **2+ ⇒ escolhe**. A escolha limpa os caches da loja anterior (inclusive de outra conta que
 *   usou o aparelho) e recarrega o app na loja escolhida.
 * - "Trocar de loja" no topo do app abre esta mesma tela. Com vendas offline na fila, a troca é
 *   bloqueada até elas serem enviadas (cada venda vai para a loja em que foi feita).
 * - Convites (ADR-014 Fatia 4): "Você foi convidado para a Loja X — Aceitar/Recusar". Com convite pendente a tela
 *   NÃO entra direto (mesmo com uma loja só) — a pessoa decide antes. Quem tem 2+ lojas pode "Sair desta loja"
 *   (menos onde é Dono).
 */

type StoreOption = {
  tenantId: string;
  name: string;
  role: string;
  storeRole: StoreRole;
  tenantActive: boolean;
};

type Invite = {
  tenantId: string;
  name: string;
  storeRole: StoreRole;
  invitedByName: string | null;
};

export default function SelecionarLojaPage() {
  const router = useRouter();
  const [stores, setStores] = useState<StoreOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<number>(0);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = typeof window !== 'undefined' ? getActiveTenantId() : null;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace('/login');
        return;
      }
      try {
        const [list, pending] = await Promise.all([
          apiGet<StoreOption[]>('/me/stores'),
          apiGet<Invite[]>('/me/invites').catch(() => [] as Invite[]),
        ]);
        setStores(list);
        setInvites(pending);
        if (list.length === 1 && pending.length === 0) {
          // Uma loja só: entra direto (é o caso de quase todo mundo — nenhum clique a mais).
          setEntering(list[0]!.name);
          await switchStore(list[0]!.tenantId, '/products');
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [router]);

  async function choose(s: StoreOption) {
    if (s.tenantId !== current) {
      const pending = await pendingOfflineSales();
      if (pending > 0) {
        setBlocked(pending);
        return;
      }
    }
    setEntering(s.name);
    await switchStore(s.tenantId, '/products');
  }

  async function reload() {
    const [list, pending] = await Promise.all([apiGet<StoreOption[]>('/me/stores'), apiGet<Invite[]>('/me/invites')]);
    setStores(list);
    setInvites(pending);
  }

  async function answer(inv: Invite, accept: boolean) {
    setBusy(inv.tenantId);
    setError(null);
    try {
      await apiPost(`/me/invites/${inv.tenantId}/${accept ? 'accept' : 'decline'}`, {});
      setNotice(accept ? `Pronto! ${inv.name} entrou na sua lista de lojas.` : `Convite de ${inv.name} recusado.`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function leave(s: StoreOption) {
    if (!window.confirm(`Sair de ${s.name}? Você perde o acesso a esta loja (o que você registrou nela continua lá).`)) return;
    setBusy(s.tenantId);
    setError(null);
    try {
      await apiPost(`/me/stores/${s.tenantId}/leave`, {});
      setNotice(`Você saiu de ${s.name}.`);
      if (s.tenantId === current) clearActiveTenantId();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await clearStoreCaches();
    clearActiveTenantId();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-bold">NexoLoja</h1>

        {entering ? (
          <p className="text-sm text-gray-600">Entrando em {entering}…</p>
        ) : error ? (
          <>
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            <button onClick={logout} className="text-sm font-medium text-gray-700 hover:underline">
              Sair e entrar com outra conta
            </button>
          </>
        ) : stores === null ? (
          <p className="text-sm text-gray-600">Carregando suas lojas…</p>
        ) : stores.length === 0 && invites.length === 0 ? (
          <>
            <p className="mb-4 text-sm text-gray-700">
              Sua conta não tem acesso a nenhuma loja no momento. Fale com o administrador da loja.
            </p>
            <button onClick={logout} className="text-sm font-medium text-gray-700 hover:underline">
              Sair
            </button>
          </>
        ) : (
          <>
            {notice && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
            {invites.length > 0 && (
              <div className="mb-6">
                <p className="mb-2 text-sm font-semibold text-gray-800">Convites</p>
                <ul className="space-y-2">
                  {invites.map((inv) => (
                    <li key={inv.tenantId} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                      <p className="text-sm text-gray-800">
                        Você foi convidado para <strong>{inv.name}</strong> como {STORE_ROLE_LABELS[inv.storeRole]}
                        {inv.invitedByName ? ` (por ${inv.invitedByName})` : ''}.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => void answer(inv, true)}
                          disabled={busy === inv.tenantId}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          Aceitar
                        </button>
                        <button
                          onClick={() => void answer(inv, false)}
                          disabled={busy === inv.tenantId}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Recusar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {stores.length > 0 && <p className="mb-5 text-sm text-gray-600">Selecione a loja</p>}
            {blocked > 0 && (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Há {blocked} {blocked === 1 ? 'venda offline aguardando' : 'vendas offline aguardando'} envio
                nesta loja. Conecte-se à internet e espere o envio terminar antes de trocar de loja.
              </p>
            )}
            <ul className="space-y-2">
              {stores.map((s) => (
                <li key={s.tenantId}>
                  <button
                    onClick={() => void choose(s)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition hover:border-indigo-400 hover:bg-indigo-50 ${
                      s.tenantId === current ? 'border-indigo-500 bg-indigo-50/60' : 'border-gray-200'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-gray-900">{s.name}</span>
                      <span className="block text-xs text-gray-500">
                        {STORE_ROLE_LABELS[s.storeRole]}
                        {s.tenantId === current ? ' · loja atual' : ''}
                      </span>
                    </span>
                    {!s.tenantActive && (
                      <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                        Desativada
                      </span>
                    )}
                  </button>
                  {stores.length > 1 && s.role !== 'OWNER' && (
                    <button
                      onClick={() => void leave(s)}
                      disabled={busy === s.tenantId}
                      className="mt-1 text-xs text-gray-500 hover:text-red-600 hover:underline disabled:opacity-50"
                    >
                      Sair desta loja
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <button onClick={logout} className="mt-6 text-sm font-medium text-gray-600 hover:underline">
              Sair
            </button>
          </>
        )}
      </div>
    </main>
  );
}
