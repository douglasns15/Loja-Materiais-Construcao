'use client';

import { useEffect } from 'react';

/**
 * Fronteira de erro da área logada (ADR-011, refino de resiliência offline). Um `error.tsx` de
 * segmento fica **dentro** do `layout.tsx` do grupo `(app)`, então a barra do topo (incl. o chip de
 * pendências) permanece e só a área da página mostra o fallback.
 *
 * Caso residual (pós-CS-3): a navegação offline entre telas passou a ser por **reload** (`OfflineNav`),
 * então telas **já abertas online** carregam do cache. Este fallback cobre o caso restante — abrir
 * offline uma tela cujo código **nunca** foi cacheado (ex.: rota nova, ainda não visitada após um
 * deploy): o navegador não baixa o chunk e o React lança. Vira um aviso claro, sem perder o shell.
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
        {offline ? 'Esta tela ainda não foi carregada offline' : 'Algo deu errado ao abrir a tela'}
      </h2>
      <p className="mb-4 text-sm text-gray-600">
        {offline
          ? 'Abra esta tela uma vez com internet para que ela fique disponível offline. As telas de Venda, Caixa e Pendências funcionam sem conexão depois de abertas online. As vendas salvas offline continuam na fila e sincronizam sozinhas quando a rede voltar.'
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
