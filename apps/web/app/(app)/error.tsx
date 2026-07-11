'use client';

import { useEffect } from 'react';

/**
 * Fronteira de erro da área logada (ADR-011, refino de resiliência offline). Um `error.tsx` de
 * segmento fica **dentro** do `layout.tsx` do grupo `(app)`, então a barra do topo (incl. o chip de
 * pendências) permanece e só a área da página mostra o fallback.
 *
 * Caso principal: navegar **offline** para uma tela cujo código ainda não está em cache — o
 * navegador não consegue baixar o chunk e o React lança. Antes isso virava tela branca ("Application
 * error"); agora vira um aviso claro, sem perder o shell. (A navegação offline entre telas depende do
 * cache de leitura da fatia futura de offline-first; a fila de vendas offline segue intacta.)
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log detalhado no console (o servidor não vê erros de cliente).
    console.error('Erro ao abrir a tela:', error);
  }, [error]);

  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  return (
    <div className="mx-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
      <h2 className="mb-2 text-lg font-semibold text-gray-900">
        {offline ? 'Esta tela precisa de internet para abrir' : 'Algo deu errado ao abrir a tela'}
      </h2>
      <p className="mb-4 text-sm text-gray-600">
        {offline
          ? 'Ainda não é possível navegar entre telas sem conexão. Volte a ficar online para abrir esta página — as vendas salvas offline continuam na fila e sincronizam sozinhas quando a rede voltar.'
          : 'Tente novamente. Se o problema continuar, recarregue o aplicativo.'}
      </p>
      <button
        onClick={reset}
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        Tentar novamente
      </button>
    </div>
  );
}
