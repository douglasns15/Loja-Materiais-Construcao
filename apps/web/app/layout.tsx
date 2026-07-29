import './globals.css';
import type { Metadata, Viewport } from 'next';
import { RegisterSW } from './RegisterSW';
import { InstallPrompt } from './InstallPrompt';

// Renderização DINÂMICA (por requisição) em todo o app. Sem isto, o Next prerenderiza as páginas
// como estáticas e o OpenNext as serve com `Cache-Control: s-maxage=31536000` (1 ANO) guardado no
// cache por POP da Cloudflare — que NÃO é invalidado no deploy. Quando um deploy troca o hash do
// CSS/JS, um POP com o HTML antigo segue apontando para assets que sumiram → página SEM ESTILO
// (incidente 2026-07-29). Dinâmico ⇒ HTML servido fresco a cada request (sem cache de 1 ano), e o
// deploy passa a valer na hora. O app é autenticado e client-side após o 1º load, então o custo de
// SSR por request é irrelevante; os assets `/_next/static` seguem imutáveis por hash.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'NexoLoja',
  description: 'ERP/POS multiramos',
  // PWA (Fase 3.A): ícones e apple-web-app. O <link rel="manifest"> é injetado
  // automaticamente pelo Next por causa de app/manifest.ts (não repetir aqui).
  applicationName: 'NexoLoja',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'NexoLoja',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
};

// Sem isto o navegador do celular renderiza na largura de desktop e dá zoom-out
// (deixa tudo minúsculo). `width=device-width` faz o layout responsivo valer no
// celular/tablet. `maximum-scale` não é fixado para não bloquear o zoom por acessibilidade.
// `themeColor` pinta a barra de status quando instalado (standalone).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#111827',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh bg-gray-50 text-gray-900 antialiased">
        {children}
        <RegisterSW />
        <InstallPrompt />
      </body>
    </html>
  );
}
