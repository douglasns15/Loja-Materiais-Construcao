'use client';

import { useCallback, useEffect, useState } from 'react';
import { countOutbox, hasOutbox, subscribeOutbox } from './outbox';
import { drainOutbox } from './syncWorker';

/**
 * Cola a fila offline (`outbox` + `drainOutbox`) na UI (ADR-011 AI 6). Mantém os contadores de
 * pendentes e de itens com falha e dispara a drenagem nos **gatilhos** previstos: evento `online`,
 * volta ao foreground (`visibilitychange`), montagem (se já online) e botão manual (`syncNow`).
 * Assina o pub/sub da `outbox`, então enfileirar/sincronizar/podar em qualquer lugar reflete aqui
 * sem polling. A concorrência é barrada dentro do worker (trava `draining`); `syncing` é só p/ UI.
 */
export function useOutboxSync() {
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    if (!hasOutbox()) return;
    try {
      const { pending: p, failed: f } = await countOutbox();
      setPending(p);
      setFailed(f);
    } catch {
      // IndexedDB indisponível — os indicadores simplesmente ficam em 0.
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
    // Qualquer mudança na fila (enfileirar/sincronizar/podar/descartar) reatualiza os contadores.
    const unsubscribe = subscribeOutbox(() => void refresh());
    const onOnline = () => void syncNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void syncNow();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    // Tenta drenar ao montar (ex.: abriu o app já com pendências e com rede).
    if (typeof navigator !== 'undefined' && navigator.onLine) void syncNow();
    return () => {
      unsubscribe();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, syncNow]);

  return { pending, failed, syncing, syncNow, refresh };
}
