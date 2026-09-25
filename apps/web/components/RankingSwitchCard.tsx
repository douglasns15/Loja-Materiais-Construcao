'use client';

import { useState } from 'react';
import type { TopCustomerRow, TopProductRow } from '@nexoloja/shared';
import { TopCustomersCard } from './TopCustomersCard';
import { TopProductsCard } from './TopProductsCard';

type View = 'mais-vendidos' | 'clientes';

/**
 * Card da direita de "Produtos e clientes" nos Relatórios: alterna, pelo próprio título ("Mais
 * vendidos ▾"), entre os 10 produtos MAIS VENDIDOS (por quantidade, em unidade-base) e os 10
 * MELHORES CLIENTES. Abre em "Mais vendidos" — ao lado do ranking por faturamento, mostra o que
 * mais SAI × o que mais FATURA; o de clientes só conta vendas com cliente identificado, então fica
 * a um clique. O seletor é um `<select>` nativo com cara de título: acessível, funciona no celular e
 * não é cortado pelo `overflow-hidden` do card (armadilha dos dropdowns absolutos).
 */
export function RankingSwitchCard({
  from,
  to,
  bestSellers,
  customers,
  initialLoading = false,
}: {
  from: string | null;
  to: string | null;
  /** Ranking por quantidade já buscado pela página. */
  bestSellers: TopProductRow[];
  /** Ranking de clientes (faturamento) já buscado pela página. */
  customers: TopCustomerRow[];
  initialLoading?: boolean;
}) {
  const [view, setView] = useState<View>('mais-vendidos');

  const title = (
    <label className="relative inline-flex min-w-0 items-center">
      <span className="sr-only">Escolher ranking</span>
      <select
        value={view}
        onChange={(e) => setView(e.target.value as View)}
        className="cursor-pointer appearance-none rounded-lg bg-transparent py-0.5 pl-1 pr-6 font-semibold text-gray-900 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <option value="mais-vendidos">Mais vendidos</option>
        <option value="clientes">Melhores clientes</option>
      </select>
      <span className="pointer-events-none absolute right-1 text-xs text-indigo-600" aria-hidden="true">
        ▾
      </span>
    </label>
  );

  return view === 'mais-vendidos' ? (
    <TopProductsCard
      mode="quantidade"
      title={title}
      from={from}
      to={to}
      initial={bestSellers}
      initialLoading={initialLoading}
    />
  ) : (
    <TopCustomersCard title={title} from={from} to={to} initial={customers} initialLoading={initialLoading} />
  );
}
