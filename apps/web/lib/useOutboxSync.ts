'use client';

import { useCallback, useEffect, useState } from 'react';
import { countPending, hasOutbox } from './outbox';
import { drainOutbox } from './syncWorker';

/**
 * Cola a fila offline (`outbox` + `drainOutbox`) na UI (ADR-011 AI 6). Mantém o contador de
 * pendentes e dispara a drenagem nos **gatilhos** previstos: evento `online`, volta ao foreground
 * (`visibilitychange`), montagem (se já online) e botão manual (`syncNow`). A concorrência é
 * barrada dentro do próprio worker (trava `draining`); aqui `syncing` é só para a UI.
 */
export function useOutboxSync() {
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    if (!hasOutbox()) return;
    try {
      setPending(await countPending());
    } catch {
      // IndexedDB indisponível — o indicador simplesmente fica em 0.
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (!hasOutbox()) return;
    setSyncing(true);
    try {
      await drainOutbox();
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    const onOnline = () => void syncNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void syncNow();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    // Tenta drenar ao montar (ex.: abriu o app já com pendências e com rede).
    if (typeof navigator !== 'undefined' && navigator.onLine) void syncNow();
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, syncNow]);

  return { pending, syncing, syncNow, refresh };
}
