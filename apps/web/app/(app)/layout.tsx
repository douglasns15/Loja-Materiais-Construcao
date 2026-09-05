'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { STORE_ROLE_LABELS } from '@nexoloja/shared';
import { supabase } from '@/lib/supabase';
import { isPlatformAdmin } from '@/lib/session';
import { useMe } from '@/lib/useMe';
import { clearCachedMe } from '@/lib/meCache';
import { OutboxSyncProvider } from '@/lib/outboxSync';
import { CartProvider } from '@/lib/cartStore';
import { FloatingPanelsProvider } from '@/lib/floatingPanels';
import { ProfileModal } from './ProfileModal';
import { QueueChip } from './QueueChip';
import { AlertsChip } from './AlertsChip';
import { CartChip } from './CartChip';
import { FloatingLauncher } from '@/components/FloatingLauncher';
import { FloatingPanelHost } from '@/components/FloatingPanelHost';
import { OfflineNav } from './OfflineNav';

// Ícones do menu (SVG inline no mesmo estilo do resto do arquivo: viewBox 0 0 24 24, traço
// currentColor, largura 2, cantos redondos). Ficam inline de propósito — evita nova dependência
// (regra 4 do CLAUDE.md). Cada item do menu referencia um destes pelo nome; o trilho recolhido
// mostra SÓ o ícone, então cada rótulo tem um ícone distinto e reconhecível.
type IconName =
  | 'venda'
  | 'vendas'
  | 'orcamentos'
  | 'caixa'
  | 'contas'
  | 'entregas'
  | 'produtos'
  | 'estoque'
  | 'cadastros'
  | 'clientes'
  | 'fornecedores'
  | 'categorias'
  | 'relatorios'
  | 'configuracoes';

const ICON_PATHS: Record<IconName, ReactNode> = {
  // Carrinho de compras — Nova Venda.
  venda: (
    <>
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </>
  ),
  // Relógio com seta (histórico) — Histórico de Vendas.
  vendas: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  // Prancheta com lista — Orçamentos.
  orcamentos: (
    <>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </>
  ),
  // Carteira — Caixa.
  caixa: (
    <>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </>
  ),
  // Cifrão num círculo — Contas a Receber.
  contas: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
      <path d="M12 18V6" />
    </>
  ),
  // Caminhão — Entregas.
  entregas: (
    <>
      <path d="M5 18H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v11" />
      <path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-2" />
      <path d="M9 18h6" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  // Caixa/pacote — Produtos.
  produtos: (
    <>
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  // Camadas — Estoque.
  estoque: (
    <>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </>
  ),
  // Pasta — grupo Cadastros.
  cadastros: (
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  ),
  // Pessoas — Clientes.
  clientes: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  // Prédio — Fornecedores.
  fornecedores: (
    <>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </>
  ),
  // Etiqueta — Categorias.
  categorias: (
    <>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </>
  ),
  // Barras — Relatórios.
  relatorios: (
    <>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </>
  ),
  // Engrenagem — Configurações.
  configuracoes: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

function NavIcon({ name, className = 'h-5 w-5 shrink-0' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

// O menu suporta itens simples (`href`) e GRUPOS recolhíveis (`group` + `children`) — o grupo
// "Cadastros" junta os cadastros menos frequentes (Clientes, Fornecedores) para não alongar a barra.
// Todo item tem um `icon`: no modo retraído (trilho) só o ícone aparece.
type NavLink = { href: string; label: string; icon: IconName; adminOnly?: boolean };
type NavGroup = { group: string; icon: IconName; children: NavLink[] };
type NavEntry = NavLink | NavGroup;
const isGroup = (e: NavEntry): e is NavGroup => 'group' in e;

const NAV: NavEntry[] = [
  { href: '/venda', label: 'Nova Venda', icon: 'venda' },
  { href: '/vendas', label: 'Histórico de Vendas', icon: 'vendas' },
  { href: '/orcamentos', label: 'Orçamentos', icon: 'orcamentos' },
  { href: '/caixa', label: 'Caixa', icon: 'caixa' },
  { href: '/contas-a-receber', label: 'Contas a Receber', icon: 'contas' },
  { href: '/entregas', label: 'Entregas', icon: 'entregas' },
  { href: '/products', label: 'Produtos', icon: 'produtos' },
  { href: '/estoque', label: 'Estoque', icon: 'estoque' },
  {
    group: 'Cadastros',
    icon: 'cadastros',
    children: [
      { href: '/customers', label: 'Clientes', icon: 'clientes' },
      { href: '/fornecedores', label: 'Fornecedores', icon: 'fornecedores' },
      { href: '/categorias', label: 'Categorias', icon: 'categorias' },
    ],
  },
  { href: '/relatorios', label: 'Relatórios', icon: 'relatorios' },
  { href: '/configuracoes', label: 'Configurações', icon: 'configuracoes', adminOnly: true },
];

// Rótulo da tela atual no topo (achata os grupos para procurar pelo href).
const NAV_LINKS: NavLink[] = NAV.flatMap((e) => (isGroup(e) ? e.children : [e]));

// Lembra a preferência de FIXAR a barra no desktop entre sessões (fixo = ocupa espaço e empurra o
// conteúdo; não-fixo = trilho de ícones que expande no hover, sobre o conteúdo).
const SIDEBAR_PINNED_KEY = 'nexoloja:sidebar-pinned';
// Lembra quais grupos do menu (ex.: "Cadastros") ficam abertos.
const GROUPS_KEY = 'nexoloja:nav-groups-open';

// CS-3 (ADR-012): telas cujo **shell** deve estar em cache para a navegação por reload funcionar
// offline. Inclui TODAS as telas do menu — não só as offline-capable (venda/caixa/pendências): as
// online-only (estoque/produtos/…) precisam abrir offline para mostrar o **shell + menu + banner
// "Sem conexão"** (decisão (c) do ADR-012), em vez de cair no beco-sem-saída `/offline`. Os dados
// dessas telas seguem online-only; só o casulo é aquecido. `/pendencias` entra aqui porque não está
// no menu (o chip só aparece com fila offline), então nunca seria aquecida por navegação normal.
const WARM_ROUTES = [
  '/venda',
  '/vendas',
  '/orcamentos',
  '/caixa',
  '/contas-a-receber',
  '/entregas',
  '/products',
  '/estoque',
  '/customers',
  '/fornecedores',
  '/categorias',
  '/relatorios',
  '/configuracoes',
  '/pendencias',
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const { me, setMe, isAdmin } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // Gaveta no celular/tablet (overlay). No desktop a barra é fixa ou vira trilho retrátil.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Desktop: barra FIXA (empurra o conteúdo) x RETRÁTIL (trilho de ícones). Default = fixa.
  const [pinned, setPinned] = useState(true);
  // Desktop retrátil: `true` enquanto o mouse/foco está sobre o trilho (expande o flyout).
  const [railHover, setRailHover] = useState(false);
  // Grupos recolhíveis do menu (ex.: "Cadastros"): mapa label→aberto, lembrado entre sessões.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
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

  // Restaura a preferência de fixar (desktop) e a de grupos abertos, salvas no navegador.
  useEffect(() => {
    // Ausência da chave = default fixo (só é retrátil quando o usuário optou por isso).
    setPinned(localStorage.getItem(SIDEBAR_PINNED_KEY) !== '0');
    try {
      setOpenGroups(JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}'));
    } catch {
      /* preferência ausente/corrompida → começa vazio (grupos usam o default) */
    }
  }, []);

  // Ao navegar, fecha a gaveta do celular (evita ficar aberta sobre a tela nova).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // CS-3: aquece as rotas offline-capable enquanto online (inclui `/pendencias`, que não está no
  // menu). Re-aquece ao reconectar, pois todo deploy troca o hash dos chunks. O aquecimento real é
  // feito pelo Service Worker (mensagem `WARM_ROUTES`), que busca o HTML de cada rota e cacheia o
  // documento + os chunks `/_next/static/` referenciados — o que a navegação por reload precisa
  // offline. `router.prefetch` só aquece o RSC (não o JS), então serve apenas para acelerar a
  // navegação client-side online; o cache offline vem do SW.
  useEffect(() => {
    if (!ready) return;
    const warm = () => {
      if (!navigator.onLine) return;
      for (const r of WARM_ROUTES) router.prefetch(r);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((reg) => reg.active?.postMessage({ type: 'WARM_ROUTES', routes: WARM_ROUTES }))
          .catch(() => {});
      }
    };
    warm();
    window.addEventListener('online', warm);
    return () => window.removeEventListener('online', warm);
  }, [ready, router]);

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

  function togglePinned() {
    setPinned((v) => {
      const next = !v;
      localStorage.setItem(SIDEBAR_PINNED_KEY, next ? '1' : '0');
      // Ao voltar a fixar, zera o hover para não deixar o flyout "preso" aberto.
      if (next) setRailHover(false);
      return next;
    });
  }

  // Um grupo abre por default quando a rota atual é um dos seus filhos; senão, segue a preferência.
  const isGroupOpen = (g: NavGroup) =>
    openGroups[g.group] ?? g.children.some((c) => c.href === pathname);

  function toggleGroup(g: NavGroup) {
    setOpenGroups((prev) => {
      const next = { ...prev, [g.group]: !isGroupOpen(g) };
      localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function logout() {
    clearCachedMe();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (!ready) {
    return <div className="p-8 text-gray-600">Carregando…</div>;
  }

  const currentLabel = NAV_LINKS.find((item) => item.href === pathname)?.label ?? 'NexoLoja';

  // No desktop, a barra mostra os rótulos quando: está fixa; OU está retraída mas com o mouse/foco
  // em cima (flyout); OU o menu de conta está aberto (evita recolher com o popup na tela). Quando
  // NÃO mostra rótulos, o trilho fica só com ícones — os rótulos/chevrons ganham `md:hidden` (no
  // celular continuam visíveis, pois lá é a gaveta w-64, sem prefixo `md:`).
  const desktopExpanded = pinned || railHover || menuOpen;
  const labelHidden = !desktopExpanded;

  return (
    <OutboxSyncProvider>
    {/* Cesta persistente (ADR-021): provider único no shell — o PDV e o ícone do topo compartilham
        o mesmo estado. `userId` vem do `me` (a cesta é por usuário). */}
    <CartProvider userId={me?.id ?? null}>
    {/* Janela flutuante de tela (ADR-031): provider único no shell; os painéis compartilham cesta/
        outbox/JWT com o app (mesmo documento). Só apresentação — desktop-only. */}
    <FloatingPanelsProvider>
    {/* CS-3: offline, converte a navegação entre telas em recarga (evita o fetch RSC que falha). */}
    <OfflineNav />
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
        onMouseEnter={() => !pinned && setRailHover(true)}
        onMouseLeave={() => !pinned && setRailHover(false)}
        // Foco entrando/saindo do trilho expande/recolhe (usuário de teclado vê os rótulos).
        onFocusCapture={() => !pinned && setRailHover(true)}
        onBlurCapture={(e) => {
          if (!pinned && !e.currentTarget.contains(e.relatedTarget as Node)) setRailHover(false);
        }}
        className={`fixed left-0 top-0 z-40 flex h-dvh w-64 shrink-0 flex-col border-r border-gray-200 bg-white p-4 transition-all duration-200 md:translate-x-0 ${
          drawerOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'
        } ${
          pinned
            ? 'md:static md:z-auto md:w-64'
            : `md:fixed ${railHover || menuOpen ? 'md:w-64 md:shadow-xl' : 'md:w-16'}`
        }`}
      >
        <div className="mb-6 flex items-center justify-between px-2">
          <span className={`text-xl font-bold ${labelHidden ? 'md:hidden' : ''}`}>NexoLoja</span>
          {/* Fixar/retrair a barra (desktop). No celular a gaveta fecha pelo fundo/atalho. */}
          <button
            onClick={togglePinned}
            className="hidden rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 md:inline-flex"
            title={pinned ? 'Recolher menu' : 'Fixar menu'}
            aria-label={pinned ? 'Recolher menu' : 'Fixar menu'}
          >
            {/* Chevron: aponta p/ a esquerda (recolher) quando fixo; p/ a direita (fixar) no trilho. */}
            <svg
              className={`h-5 w-5 transition-transform ${pinned ? '' : 'rotate-180'}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
          {NAV.map((entry) => {
            // Item simples (link direto).
            if (!isGroup(entry)) {
              if (entry.adminOnly && !isAdmin) return null;
              const active = pathname === entry.href;
              return (
                <Link
                  key={entry.href}
                  href={entry.href}
                  title={entry.label}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
                  } ${labelHidden ? 'md:justify-center md:px-2' : ''}`}
                >
                  <NavIcon name={entry.icon} />
                  <span className={`flex-1 truncate ${labelHidden ? 'md:hidden' : ''}`}>{entry.label}</span>
                </Link>
              );
            }

            // Grupo recolhível (ex.: "Cadastros"): cabeçalho + filhos indentados. No trilho recolhido
            // só a pasta aparece; ao passar o mouse a barra expande e o grupo volta ao normal.
            const open = isGroupOpen(entry);
            const hasActiveChild = entry.children.some((c) => c.href === pathname);
            return (
              <div key={entry.group}>
                <button
                  type="button"
                  onClick={() => toggleGroup(entry)}
                  title={entry.group}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    hasActiveChild && !open
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-700 hover:bg-gray-100'
                  } ${labelHidden ? 'md:justify-center md:px-2' : ''}`}
                  aria-expanded={open}
                >
                  <NavIcon name={entry.icon} />
                  <span className={`flex-1 text-left ${labelHidden ? 'md:hidden' : ''}`}>{entry.group}</span>
                  <svg
                    className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''} ${labelHidden ? 'md:hidden' : ''}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {open && (
                  <div className={`mt-1 space-y-1 pl-3 ${labelHidden ? 'md:hidden' : ''}`}>
                    {entry.children.map((child) => {
                      const active = pathname === child.href;
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          title={child.label}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                            active ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          <NavIcon name={child.icon} className="h-4 w-4 shrink-0" />
                          <span className="flex-1 truncate">{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div ref={accountRef} className="relative mt-2 shrink-0 border-t border-gray-200 pt-2">
          {menuOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-full min-w-[12rem] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
              <div className="px-3 py-2">
                <div className="truncate text-sm font-medium text-gray-900">
                  {me?.name ?? 'Usuário'}
                </div>
                {me?.email && (
                  <div className="truncate text-xs text-gray-600">{me.email}</div>
                )}
                {me && (
                  <div className="mt-0.5 text-xs text-gray-500">
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
            title={me?.name ?? 'Minha conta'}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 ${
              labelHidden ? 'md:justify-center md:px-2' : ''
            }`}
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            {/* Ícone de usuário */}
            <svg
              className="h-5 w-5 shrink-0 text-gray-600"
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
            <span className={`flex-1 truncate ${labelHidden ? 'md:hidden' : ''}`}>{me?.name ?? 'Minha conta'}</span>
            {/* Chevron (gira quando aberto) */}
            <svg
              className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${menuOpen ? 'rotate-180' : ''} ${labelHidden ? 'md:hidden' : ''}`}
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

      {/* Espaçador em fluxo: quando a barra é retrátil (fixed/overlay), reserva a faixa do trilho
          (w-16) para o conteúdo não ficar embaixo dele. No mobile some (a gaveta é overlay). */}
      {!pinned && <div className="hidden w-16 shrink-0 md:block" aria-hidden="true" />}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior: hambúrguer (celular) abre a gaveta. No desktop o trilho fica sempre
            visível, então não há botão de "expandir" aqui. */}
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
          <span className="truncate font-semibold text-gray-800">{currentLabel}</span>
          {/* Status da fila offline (aparece só quando há vendas na fila) — drenagem global. */}
          <QueueChip />
          {/* Grupo à direita: sino de pendências (ADR-029) + cesta (ADR-021), sempre visíveis. */}
          <div className="ml-auto flex items-center gap-1">
            {/* Destacar tela em janela flutuante (ADR-031) — desktop-only. */}
            <FloatingLauncher />
            {/* Central de pendências: alertas de cadastro calculados sob demanda. */}
            <AlertsChip />
            {/* Ícone da cesta: mostra a contagem do carrinho de qualquer tela; leva ao PDV. */}
            <CartChip />
          </div>
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
    {/* Janela(s) flutuante(s) abertas — em portal no body, por cima do conteúdo (desktop-only). */}
    <FloatingPanelHost />
    </FloatingPanelsProvider>
    </CartProvider>
    </OutboxSyncProvider>
  );
}
