/* Service Worker do NexoLoja — Fase 3.A (PWA) + CS-3 (navegação offline entre telas).
 *
 * Escopo: deixar o app instalável e carregar rápido/estável, com um fallback offline
 * decente para a casca (shell) e os assets. NÃO faz sincronização de escrita nem
 * cacheia dados de negócio — a fila offline vive no IndexedDB (ADR-011).
 *
 * Regras de segurança do cache num ERP/POS:
 *  - Só intercepta GET e SÓ mesma origem (o front). As chamadas à API
 *    (nexoloja-api.*) e ao Supabase Auth são CROSS-ORIGIN e passam direto pela
 *    rede — nunca são cacheadas (evita servir estoque/venda/caixa velhos).
 *  - Navegações: network-first (rede manda; cache é só rede de segurança).
 *
 * CS-3 (ADR-012, decisão (c)) — navegação offline entre telas por **reload**:
 *  - O componente `OfflineNav` converte o clique em `<Link>` numa navegação real quando
 *    offline; um full-load embute o RSC inicial no HTML (sem o fetch `?_rsc=`, que este
 *    SW não intercepta e falharia offline).
 *  - Para o reload funcionar offline, o **documento** da rota **e todos os seus chunks
 *    `/_next/static/…`** precisam estar em cache. `router.prefetch` (client) só aquece o
 *    RSC, não o JS — então o aquecimento de verdade é feito aqui: `warmRoutes()` busca o
 *    HTML de cada rota offline-capable, **extrai as URLs `/_next/static/` do próprio HTML**
 *    (onde o chunk da página aparece como `<script>`) e as cacheia. É disparado no
 *    `install` e por mensagem `WARM_ROUTES` do cliente (no load online e ao reconectar).
 *  - Os chunks têm nome com **hash** (imutáveis) e ficam num cache **não-versionado**
 *    (`STATIC`) que **sobrevive a deploys** — assim um bump de versão não joga fora o que
 *    já foi aquecido. Só o cache de documentos/casca (`SHELL`) é versionado.
 */

const VERSION = 'v3';
const SHELL = `nexoloja-shell-${VERSION}`; // documentos + manifest/ícones (versionado)
const STATIC = 'nexoloja-static'; // /_next/static/* imutáveis por hash (NÃO versionado)

// Telas cujo shell é aquecido para a navegação por reload funcionar offline (CS-3, ADR-012).
// Inclui TODAS as telas do menu — as offline-capable (venda/caixa/pendências) funcionam por completo;
// as online-only (estoque/produtos/…) abrem o shell + banner "Sem conexão" em vez do beco `/offline`.
// Mantido em sincronia com `WARM_ROUTES` do shell `(app)/layout.tsx`.
const WARM_ROUTES = [
  '/venda',
  '/vendas',
  '/caixa',
  '/products',
  '/estoque',
  '/customers',
  '/relatorios',
  '/configuracoes',
  '/pendencias',
  '/offline',
];

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
      const cache = await caches.open(SHELL);
      // addAll falha tudo se um item falhar; toleramos faltas individuais.
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
      // Aquece as rotas offline-capable (documento + chunks) já na instalação (online).
      await warmRoutes(WARM_ROUTES);
      // Ativa a nova versão imediatamente (sem esperar fechar todas as abas).
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Limpa só caches de casca de versões antigas; o STATIC (chunks imutáveis) é preservado.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('nexoloja-shell-') && k !== SHELL)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// O cliente pede o aquecimento das rotas offline (no load online e ao reconectar).
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'WARM_ROUTES') {
    const routes = Array.isArray(data.routes) ? data.routes : WARM_ROUTES;
    event.waitUntil(warmRoutes(routes));
  }
});

/**
 * Aquece as rotas offline-capable: busca o HTML de cada rota, cacheia o **documento** (SHELL)
 * e cacheia todos os **chunks `/_next/static/…`** referenciados no HTML (STATIC). Assim a
 * navegação por reload (offline) encontra documento + JS no cache. Requer rede (roda online).
 */
async function warmRoutes(routes) {
  const shell = await caches.open(SHELL);
  const staticCache = await caches.open(STATIC);
  await Promise.all(
    routes.map(async (route) => {
      try {
        const resp = await fetch(route, { credentials: 'same-origin' });
        if (!resp || !resp.ok) return;
        const html = await resp.clone().text();
        await shell.put(route, resp);
        // Extrai as URLs de assets estáticos da própria origem (src="/_next/static/..." etc.).
        const urls = new Set();
        const re = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;
        let m;
        while ((m = re.exec(html))) urls.add(m[1]);
        await Promise.all(
          [...urls].map((u) =>
            staticCache.match(u).then((hit) => (hit ? undefined : staticCache.add(u).catch(() => {}))),
          ),
        );
      } catch {
        // Offline / rota indisponível: aquece na próxima vez que houver rede.
      }
    }),
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
          const cache = await caches.open(SHELL);
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

  // Chunks versionados do Next (`/_next/static/`): imutáveis por hash → cache-first no STATIC
  // (não-versionado; sobrevive a deploys). Serve idêntico online e offline.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const resp = await fetch(request);
          if (resp && resp.ok) cache.put(request, resp.clone()).catch(() => {});
          return resp;
        } catch {
          return Response.error();
        }
      })(),
    );
    return;
  }

  // Demais assets estáticos da origem (ícones, manifest): stale-while-revalidate no SHELL.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
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

// Assets estáticos não-versionados da própria origem (ícones, manifest, fontes).
function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/icons/') ||
    /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|css)$/.test(url.pathname)
  );
}
