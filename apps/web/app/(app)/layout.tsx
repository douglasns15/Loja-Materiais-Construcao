'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

const NAV = [
  { href: '/venda', label: 'Nova Venda' },
  { href: '/vendas', label: 'Histórico de Vendas' },
  { href: '/caixa', label: 'Caixa' },
  { href: '/products', label: 'Produtos' },
  { href: '/estoque', label: 'Estoque' },
  { href: '/customers', label: 'Clientes' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

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
          {NAV.map((item) => {
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
        <button
          onClick={logout}
          className="mt-2 shrink-0 rounded-lg border-t border-gray-200 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
        >
          Sair
        </button>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
