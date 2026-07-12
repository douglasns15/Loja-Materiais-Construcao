'use client';

import { useEffect } from 'react';

/**
 * CS-3 (ADR-012) — navegação offline entre telas por **recarga** (navegação por reload).
 *
 * Problema (achado 3.F.CS-2.2): a navegação client-side do Next (App Router) via `<Link>` busca o
 * payload **RSC** da rota destino (`GET /rota?_rsc=...`) pela rede. O Service Worker não intercepta
 * esse pedido e, offline, ele falha → o roteador lança → cai no fallback cru ("Application error…").
 *
 * Solução (a "navegação por reload" já prevista na decisão (c) do ADR-012): **offline**, converter os
 * cliques em links internos numa **navegação real** (full load) em vez da client-side. Uma navegação
 * real embute o RSC inicial no próprio HTML (não faz o fetch `?_rsc=`), então o SW consegue servir o
 * documento (network-first) + os chunks (`/_next/static/`, SWR) do cache. É equivalente a "reabrir o
 * app offline", caminho já validado (CS-1/CS-2).
 *
 * **Online não faz nada:** a navegação client-side rápida do Next é preservada.
 */
export function OfflineNav() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Só offline; online preserva a navegação client-side do Next.
      if (navigator.onLine) return;
      // Ignora cliques já tratados, botão não-primário e com modificador (abrir em nova aba, etc.).
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }

      const anchor = (e.target as Element | null)?.closest?.('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;
      // target=_blank/_parent, download e âncoras externas seguem o comportamento padrão do navegador.
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // link externo → deixa passar
      // Âncora no mesmo documento (#): deixa o navegador rolar, não recarrega.
      if (url.pathname === window.location.pathname && url.hash) return;
      // Já estamos exatamente nesta rota → evita recarga desnecessária.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      // Intercepta: full-load em vez de client-side nav (evita o fetch RSC que falha offline). A
      // captura + stopPropagation impede o handler do <Link> do Next de disparar o router.push.
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(url.href);
    }

    // Fase de captura, para rodar antes do handler bubbling do <Link> do Next.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return null;
}
