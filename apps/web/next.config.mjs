/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pacotes do monorepo que exportam TS cru precisam ser transpilados pelo Next.
  transpilePackages: ['@nexoloja/shared'],
  // Move o indicador de dev (só aparece em dev) para não cobrir o menu lateral.
  devIndicators: {
    position: 'bottom-right',
  },
};

export default nextConfig;
