/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pacotes do monorepo que exportam TS cru precisam ser transpilados pelo Next.
  transpilePackages: ['@nexoloja/shared'],
  // Move o indicador de dev (só aparece em dev) para não cobrir o menu lateral.
  devIndicators: {
    position: 'bottom-right',
  },
  // Cache-Control dos DOCUMENTOS (HTML/RSC): o padrão do Next para páginas prerenderizadas era
  // `s-maxage=31536000` (1 ANO) em cache compartilhado. Num app de assets versionados por hash isso
  // é perigoso: quando um deploy troca o hash do CSS/JS, um POP da Cloudflare que guardou o HTML
  // antigo segue servindo referência a assets que NÃO existem mais → a página abre SEM ESTILO
  // (incidente 2026-07-29). Forçamos `no-store` nos documentos para nenhum cache compartilhado
  // segurar HTML velho. Os assets imutáveis (`/_next/static`, `/_next/image`) ficam FORA da regra
  // e seguem cacheáveis por hash (imutáveis) — é o certo para eles.
  async headers() {
    return [
      {
        source: '/((?!_next/static|_next/image).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
