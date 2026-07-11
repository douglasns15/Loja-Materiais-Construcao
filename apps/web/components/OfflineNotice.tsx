'use client';

import { useOnline } from '@/lib/useOnline';

/**
 * Aviso de conexão para telas **online-only** (ADR-012, decisão (c)): as consultas e cadastros que
 * não são offline-capable no MVP (Produtos, Estoque, Clientes, Relatórios, Histórico de Vendas).
 * Só o PDV (`/venda`) e a leitura do Caixa operam offline (cold-start, CS-1/CS-2).
 *
 * Só aparece **offline**. Substitui o erro técnico de rede ("Failed to fetch") por um aviso
 * amigável — o ADR pede "o aviso de rede, **não** a tela vazia". A casca da tela segue montada (o
 * Service Worker a cacheia), mas os dados que dependem da API só voltam com a conexão.
 */
export function OfflineNotice() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="font-semibold text-amber-800">Sem conexão com a internet</p>
      <p className="text-sm text-amber-700">
        Esta tela precisa de internet para carregar os dados. Só o PDV e o Caixa funcionam offline —
        as demais voltam a exibir os dados assim que a conexão retornar.
      </p>
    </div>
  );
}
