'use client';

import { useEffect } from 'react';

/**
 * Fronteira de erro **da raiz** (última rede de segurança do Next). Diferente do
 * `(app)/error.tsx` — que fica dentro do shell logado e cobre erros de *render* de uma tela — este
 * captura o que **escapa** para o nível do roteador, notadamente a **falha ao baixar o chunk/RSC de
 * uma rota durante a navegação offline** (ADR-012, achado 3.E.1 / CS-3). Sem ele, esse caso caía no
 * fallback cru do Next ("Application error…"), sem casca e sem saída.
 *
 * `global-error` **substitui o layout raiz** (precisa de `<html>`/`<body>` próprios) e não recebe o
 * `globals.css`, então os estilos são inline. Pós-CS-3 a navegação offline entre telas é por reload
 * (`OfflineNav`) e telas já abertas online carregam do cache — então este fica como **última rede de
 * segurança** para o caso residual (rota cujo chunk/RSC nunca foi cacheado). **Ir para a Venda**
 * dispara uma navegação real, que o Service Worker atende do cache, tirando o operador do
 * beco-sem-saída. As vendas salvas offline seguem na fila e sincronizam sozinhas.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Erro global (raiz):', error);
  }, [error]);

  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f9fafb',
          color: '#111827',
          fontFamily:
            'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: '28rem',
            width: '100%',
            background: '#fff',
            borderRadius: '1rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            padding: '2rem',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            {offline ? 'Sem conexão para abrir esta tela' : 'Algo deu errado'}
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#4b5563', margin: '0 0 1.25rem' }}>
            {offline
              ? 'A navegação entre telas ainda precisa de internet. Recarregue para voltar a uma tela disponível — as vendas salvas offline continuam na fila e sincronizam sozinhas quando a rede voltar.'
              : 'Não foi possível abrir esta tela. Recarregue o aplicativo; se persistir, tente novamente mais tarde.'}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
            <button
              onClick={() => {
                // Navegação real (não client-side): o Service Worker atende do cache o shell/última
                // tela boa (ou a página /offline), tirando o operador do beco-sem-saída.
                window.location.href = '/venda';
              }}
              style={{
                borderRadius: '0.5rem',
                background: '#111827',
                color: '#fff',
                border: 'none',
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Ir para a Venda
            </button>
            <button
              onClick={() => reset()}
              style={{
                borderRadius: '0.5rem',
                background: '#fff',
                color: '#374151',
                border: '1px solid #d1d5db',
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
