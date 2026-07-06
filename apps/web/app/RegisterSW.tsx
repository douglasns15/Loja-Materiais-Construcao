'use client';

import { useEffect } from 'react';

// Registra o service worker (Fase 3.A). Fica num componente client montado no
// layout raiz para rodar só no navegador, uma vez, após a hidratação.
// O SW cuida do cache do app-shell (carregamento rápido/estável e fallback
// offline). A fila de sincronização de escrita (IndexedDB → Supabase) é fatia
// futura da Fase 3, com ADR próprio.
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    // Em dev o SW só atrapalha (HMR/cache); registra apenas em produção.
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        // Falha de registro não pode derrubar o app — apenas loga.
        console.error('[PWA] Falha ao registrar o service worker:', err);
      });
    };

    // Espera a página carregar para não competir com o carregamento inicial.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
