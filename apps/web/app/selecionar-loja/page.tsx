'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STORE_ROLE_LABELS, type StoreRole } from '@nexoloja/shared';
import { supabase } from '@/lib/supabase';
import { apiGet } from '@/lib/api';
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
 */

type StoreOption = {
  tenantId: string;
  name: string;
  role: string;
  storeRole: StoreRole;
  tenantActive: boolean;
};

export default function SelecionarLojaPage() {
  const router = useRouter();
  const [stores, setStores] = useState<StoreOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<number>(0);
  const current = typeof window !== 'undefined' ? getActiveTenantId() : null;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace('/login');
        return;
      }
      try {
        const list = await apiGet<StoreOption[]>('/me/stores');
        setStores(list);
        if (list.length === 1) {
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
        ) : stores.length === 0 ? (
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
            <p className="mb-5 text-sm text-gray-600">Selecione a loja</p>
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
