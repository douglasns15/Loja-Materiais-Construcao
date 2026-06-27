import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NexoLoja',
  description: 'ERP/POS multiramos',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
