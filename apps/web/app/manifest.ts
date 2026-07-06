import type { MetadataRoute } from 'next';

// Manifest do PWA (Fase 3.A). O Next serve isto em /manifest.webmanifest.
// Torna o app instalável (adicionar à tela inicial) no celular e no desktop.
// `display: standalone` abre sem a barra do navegador; `start_url` cai no login
// (que redireciona para a área logada quando já há sessão).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NexoLoja — Gestão da Loja',
    short_name: 'NexoLoja',
    description: 'ERP/POS multiramos: PDV, estoque, caixa e relatórios.',
    lang: 'pt-BR',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#111827',
    theme_color: '#111827',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
