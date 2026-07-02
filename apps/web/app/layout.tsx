import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'NexoLoja',
  description: 'ERP/POS multiramos',
};

// Sem isto o navegador do celular renderiza na largura de desktop e dá zoom-out
// (deixa tudo minúsculo). `width=device-width` faz o layout responsivo valer no
// celular/tablet. `maximum-scale` não é fixado para não bloquear o zoom por acessibilidade.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
