'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { apiGet } from '@/lib/api';

type PlatformMe = { isPlatformAdmin: boolean; id: string; name: string; email: string };

/**
 * Shell do painel de PLATAFORMA (Super Usuário / fabricante, ADR-009). Separado do shell de
 * loja `(app)`: o super usuário não pertence a um tenant. Guard: exige sessão + `GET /platform/me`
 * (autorizado pela tabela `platform_admins` na API). Quem não é super usuário é mandado ao app.
 */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<PlatformMe | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace('/login');
        return;
      }
      try {
        setMe(await apiGet<PlatformMe>('/platform/me'));
        setReady(true);
      } catch {
        // Não é super usuário → vai para o app de loja.
        router.replace('/products');
      }
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
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">NexoLoja</span>
          <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs font-medium text-white">
            Plataforma
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-gray-500 sm:inline">{me?.email}</span>
          <button
            onClick={logout}
            className="rounded-lg px-3 py-1 font-medium text-red-600 hover:bg-red-50"
          >
            Sair
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
    </div>
  );
}
