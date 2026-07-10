'use client';

import { useOnline } from '@/lib/useOnline';

/**
 * Aviso de conexão do PDV/Caixa (ADR-011 §9). Só aparece quando o navegador está **offline**.
 * O texto depende do flag `OFFLINE_SALES` da loja e do `context`:
 *
 * - **OFF** (padrão): a loja não tem o recurso pago. Sem internet, o plano B é a **nota manual**.
 * - **ON**: a loja tem o módulo habilitado. A fila de sincronização (Outbox) chega na próxima
 *   fatia da Fase 3; por ora o aviso só sinaliza que o recurso está ligado.
 *
 * `context`:
 * - `'sale'` (padrão): tela de venda com caixa já aberto.
 * - `'cash-open'`: caixa fechado. Abrir caixa ainda é **online-only** nesta fatia (ADR-011
 *   sequenciou venda → estoque → caixa), então o aviso deixa isso explícito.
 *
 * Nesta fatia o componente é **apenas informativo** — não enfileira. É a leitura do flag + aviso.
 */
export function OfflineSalesNotice({
  offlineSales,
  context = 'sale',
}: {
  offlineSales: boolean;
  context?: 'sale' | 'cash-open';
}) {
  const online = useOnline();
  if (online) return null;

  if (offlineSales) {
    return (
      <div className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
        <p className="font-semibold text-indigo-800">Sem conexão — vendas offline habilitadas</p>
        <p className="text-sm text-indigo-700">
          {context === 'cash-open'
            ? 'A abertura de caixa ainda precisa de internet nesta versão — a venda offline cobre quedas depois do caixa aberto. Abra o caixa assim que a conexão voltar.'
            : 'Esta loja tem o recurso de vendas offline. A sincronização automática entra na próxima atualização; por ora, aguarde a conexão voltar para registrar.'}
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="font-semibold text-amber-800">Sem conexão com a internet</p>
      <p className="text-sm text-amber-700">
        {context === 'cash-open'
          ? 'A abertura de caixa precisa de internet. Enquanto a conexão não volta, registre as vendas em '
          : 'As vendas offline não estão habilitadas nesta loja. Registre a venda em '}
        <b>nota manual</b> e lance no sistema assim que a conexão voltar.
      </p>
    </div>
  );
}
