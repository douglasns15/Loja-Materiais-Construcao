'use client';

import Link from 'next/link';
import { useCart } from '@/lib/cartStore';

/**
 * Ícone da **cesta** no topo do app (ADR-021), estilo e-commerce. Mostra a contagem de linhas do
 * carrinho num badge quando há itens e leva à Nova Venda (`/venda`); zerado, fica apagado (sem
 * badge). Lê o mesmo estado que o PDV via `useCart` (montado no shell). Sempre visível — assim o
 * operador sabe, de qualquer tela, se deixou algo na cesta.
 */
export function CartChip() {
  const { count } = useCart();
  const has = count > 0;

  return (
    <Link
      href="/venda"
      className={`relative inline-flex items-center rounded-full border p-2 transition ${
        has
          ? 'border-gray-300 bg-white text-gray-800 hover:bg-gray-100'
          : 'border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-600'
      }`}
      title={has ? `${count} ${count === 1 ? 'item' : 'itens'} na cesta` : 'Cesta vazia'}
      aria-label={has ? `Cesta com ${count} ${count === 1 ? 'item' : 'itens'}` : 'Cesta vazia'}
    >
      {/* Ícone de carrinho de compras */}
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
      {has && (
        <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-gray-900 px-1 text-xs font-bold text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
