import './globals.css';
import type { Metadata, Viewport } from 'next';
import { RegisterSW } from './RegisterSW';
import { InstallPrompt } from './InstallPrompt';

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
