'use client';

import { useEffect, useState } from 'react';

/**
 * Estado de conexão do navegador (`navigator.onLine`) reativo a `online`/`offline` (ADR-011).
 * Assume online no 1º render (SSR/hydration) e corrige no cliente — evita flicker e o falso
 * "offline" durante a hidratação. Usado para avisos e para desabilitar ações que exigem rede
 * (ex.: abrir caixa, que nesta fatia ainda é online-only).
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return online;
}
