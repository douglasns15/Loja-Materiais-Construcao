'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { STORE_ROLE_LABELS } from '@nexoloja/shared';
import { supabase } from '@/lib/supabase';
import { useMe } from '@/lib/useMe';
import { ProfileModal } from './ProfileModal';

const NAV = [
  { href: '/venda', label: 'Nova Venda' },
  { href: '/vendas', label: 'Histórico de Vendas' },
  { href: '/caixa', label: 'Caixa' },
  { href: '/products', label: 'Produtos' },
  { href: '/estoque', label: 'Estoque' },
  { href: '/customers', label: 'Clientes' },
  { href: '/relatorios', label: 'Relatórios' },
  { href: '/configuracoes', label: 'Configurações', adminOnly: true },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const { me, setMe, isAdmin } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  // Fecha o menu de conta ao clicar fora dele.
  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace('/login');
        return;
      }
      setReady(true);
    })();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (!ready) {
    return <div className="p-8 text-gray-500">Carregando…</div>;
  }

  return (
    <div className="flex h-screen">
      <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-gray-200 bg-white p-4">
        <div className="mb-6 px-2 text-xl font-bold">NexoLoja</div>
        <nav className="flex-1 space-y-1 overflow-y-auto">
          {NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div ref={accountRef} className="relative mt-2 shrink-0 border-t border-gray-200 pt-2">
          {menuOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
              <div className="px-3 py-2">
                <div className="truncate text-sm font-medium text-gray-900">
                  {me?.name ?? 'Usuário'}
                </div>
                {me?.email && (
                  <div className="truncate text-xs text-gray-500">{me.email}</div>
                )}
                {me && (
                  <div className="mt-0.5 text-xs text-gray-400">
                    {STORE_ROLE_LABELS[me.storeRole]}
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setProfileOpen(true);
                }}
                disabled={!me}
                className="block w-full border-t border-gray-100 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Meus dados
              </button>
              <button
                onClick={logout}
                className="block w-full border-t border-gray-100 px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Sair
              </button>
            </div>
          )}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            {/* Ícone de usuário */}
            <svg
              className="h-5 w-5 shrink-0 text-gray-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span className="flex-1 truncate">{me?.name ?? 'Minha conta'}</span>
            {/* Chevron (gira quando aberto) */}
            <svg
              className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>

      {profileOpen && me && (
        <ProfileModal
          me={me}
          onClose={() => setProfileOpen(false)}
          onUpdated={(updated) => setMe(updated)}
        />
      )}
    </div>
  );
}
