/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pacotes do monorepo que exportam TS cru precisam ser transpilados pelo Next.
  transpilePackages: ['@nexoloja/shared'],
};

export default nextConfig;
