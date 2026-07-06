/* Service Worker do NexoLoja — Fase 3.A (PWA instalável + cache de app-shell).
 *
 * Escopo desta fatia: deixar o app instalável e carregar rápido/estável, com um
 * fallback offline decente para a casca (shell) e os assets. NÃO faz sincronização
 * de escrita nem cacheia dados de negócio — isso é fatia futura (fila IndexedDB →
 * Supabase, com ADR próprio).
 *
 * Regras de segurança do cache num ERP/POS:
 *  - Só intercepta GET e SÓ mesma origem (o front). As chamadas à API
 *    (nexoloja-api.*) e ao Supabase Auth são CROSS-ORIGIN e passam direto pela
 *    rede — nunca são cacheadas (evita servir estoque/venda/caixa velhos).
 *  - Navegações: network-first (rede manda; cache é só rede de segurança).
 */

const VERSION = 'v1';
const CACHE = `nexoloja-shell-${VERSION}`;

// Casca mínima pré-cacheada na instalação (carrega mesmo offline).
const PRECACHE = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll falha tudo se um item falhar; toleramos faltas individuais.
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
      // Ativa a nova versão imediatamente (sem esperar fechar todas as abas).
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Limpa caches de versões antigas.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('nexoloja-shell-') && k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// Assets versionados/estáticos da própria origem → cache-first com revalidação.
function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|css|js)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Só GET; deixa POST/PATCH/DELETE (vendas, caixa, estoque) sempre na rede.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Só mesma origem. API e Supabase (cross-origin) passam direto pela rede.
  if (url.origin !== self.location.origin) return;

  // Navegações (abrir/trocar de página): network-first, cache como fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          // Guarda a última versão boa da página para uso offline.
          const cache = await caches.open(CACHE);
          cache.put(request, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cached = await caches.match(request);
          return cached || (await caches.match('/offline')) || Response.error();
        }
      })(),
    );
    return;
  }

  // Assets estáticos: stale-while-revalidate (serve do cache e atualiza atrás).
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((resp) => {
            if (resp && resp.ok) cache.put(request, resp.clone()).catch(() => {});
            return resp;
          })
          .catch(() => undefined);
        return cached || (await network) || Response.error();
      })(),
    );
  }
});
