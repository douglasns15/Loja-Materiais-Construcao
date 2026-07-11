'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { STORE_ROLE_LABELS } from '@nexoloja/shared';
import { supabase } from '@/lib/supabase';
import { isPlatformAdmin } from '@/lib/session';
import { useMe } from '@/lib/useMe';
import { OutboxSyncProvider } from '@/lib/outboxSync';
import { ProfileModal } from './ProfileModal';
import { QueueChip } from './QueueChip';

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

// Lembra a preferência de recolher a barra no desktop entre sessões.
const COLLAPSE_KEY = 'nexoloja:sidebar-collapsed';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const { me, setMe, isAdmin } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // Gaveta no celular/tablet (overlay) e recolher no desktop (esconde a barra).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
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

  // Restaura a preferência de recolher (desktop) salva no navegador.
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
  }, []);

  // Ao navegar, fecha a gaveta do celular (evita ficar aberta sobre a tela nova).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace('/login');
        return;
      }
      // Super Usuário não pertence a loja — não fica preso no shell de loja.
      if (await isPlatformAdmin()) {
        router.replace('/plataforma');
        return;
      }
      setReady(true);
    })();
  }, [router]);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (!ready) {
    return <div className="p-8 text-gray-500">Carregando…</div>;
  }

  const currentLabel = NAV.find((item) => item.href === pathname)?.label ?? 'NexoLoja';

  return (
    <OutboxSyncProvider>
    <div className="flex h-dvh">
      {/* Fundo escuro por trás da gaveta (só no celular/tablet). */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-40 flex h-dvh w-64 shrink-0 flex-col border-r border-gray-200 bg-white p-4 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          drawerOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'
        } ${collapsed ? 'md:hidden' : ''}`}
      >
        <div className="mb-6 flex items-center justify-between px-2">
          <span className="text-xl font-bold">NexoLoja</span>
          {/* Recolher a barra (desktop). No celular a gaveta fecha pelo fundo/atalho. */}
          <button
            onClick={toggleCollapsed}
            className="hidden rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 md:inline-flex"
            title="Recolher menu"
            aria-label="Recolher menu"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
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

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior: hambúrguer (celular) + abrir menu recolhido (desktop). */}
        <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          {/* Celular/tablet: abre a gaveta */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg p-1 text-gray-600 hover:bg-gray-100 md:hidden"
            aria-label="Abrir menu"
          >
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          {/* Desktop: aparece só quando a barra está recolhida, para reabrir */}
          {collapsed && (
            <button
              onClick={toggleCollapsed}
              className="hidden rounded-lg p-1 text-gray-600 hover:bg-gray-100 md:inline-flex"
              aria-label="Expandir menu"
              title="Expandir menu"
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
          )}
          <span className="truncate font-semibold text-gray-800">{currentLabel}</span>
          {/* Status da fila offline (aparece só quando há vendas na fila) — drenagem global. */}
          <QueueChip />
        </header>

        {/* Aviso de loja desativada pelo Super Usuário (ADR-009): visível no topo de toda tela.
            As vendas novas ficam bloqueadas (a API barra e a tela de Nova Venda também). */}
        {me?.tenantActive === false && (
          <div className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <svg className="mt-0.5 h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>
              <strong>Loja desativada.</strong> Estão bloqueados: <strong>novas vendas</strong>,{' '}
              <strong>abertura de caixa</strong> e <strong>entrada de estoque</strong>. Fale com o
              suporte para reativar a loja.
            </span>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>

      {profileOpen && me && (
        <ProfileModal
          me={me}
          onClose={() => setProfileOpen(false)}
          onUpdated={(updated) => setMe(updated)}
        />
      )}
    </div>
    </OutboxSyncProvider>
  );
}
