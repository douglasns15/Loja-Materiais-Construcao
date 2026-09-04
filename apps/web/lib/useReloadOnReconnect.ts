'use client';

import { useEffect, useRef } from 'react';

/**
 * Auto-recuperação de tela após um soluço transitório da rede/servidor (ADR-005).
 *
 * As telas carregam os dados UMA vez no mount. Se um soluço do free tier (cold start / rajada de
 * concorrência abrindo conexões frias — ver [[pdv-caixa-auto-recuperacao-offline]]) fizer essa carga
 * falhar mesmo depois do retry interno do `apiGet` (~7 s), a tela ficava com o erro na cara até o
 * operador **recarregar à mão**. Este hook re-tenta a carga **sozinho** enquanto a tela estiver no
 * estado de falha (`active = true`):
 *   - a cada `intervalMs` (default 15 s);
 *   - **imediatamente** quando o navegador reconecta (`online`) ou a aba volta a ficar visível
 *     (`visibilitychange`) — os gatilhos que sinalizam "a rede provavelmente voltou".
 *
 * No primeiro sucesso, o loader deve zerar o `active` (ex.: `setLoadFailed(false)`), o efeito se
 * desliga e nada mais roda. `active` DEVE refletir só a FALHA DE CARGA — nunca um erro de validação
 * ou de ação do usuário —, senão o hook re-dispararia a carga por baixo de um erro que não é de rede.
 *
 * `reload` é lido via ref (sempre a versão mais recente) para não re-assinar o intervalo/listeners a
 * cada render, e um ref de "em andamento" evita tentativas sobrepostas (cada `apiGet` já traz retry).
 *
 * @param reload    Função que recarrega os dados da tela (a mesma do mount).
 * @param active    `true` enquanto a carga estiver falha (liga o retry); `false` desliga.
 * @param intervalMs Intervalo entre tentativas automáticas (default 15000).
 */
export function useReloadOnReconnect(
  reload: () => void | Promise<void>,
  active: boolean,
  intervalMs = 15000,
): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const attempt = async () => {
      if (cancelled || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await reloadRef.current();
      } finally {
        inFlightRef.current = false;
      }
    };
    const interval = setInterval(() => void attempt(), intervalMs);
    const onOnline = () => void attempt();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void attempt();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, intervalMs]);
}
