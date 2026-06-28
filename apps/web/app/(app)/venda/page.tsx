'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  PAYMENT_METHOD_LABELS,
  createSaleSchema,
  type PaymentMethod,
} from '@nexoloja/shared';
import { calcSaleTotals } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { ReceiptPrint, type Store } from '@/components/ReceiptPrint';

type Product = { id: string; name: string; sku: string; salePrice: string; stockQty: string };
type CartItem = { productId: string; name: string; unitPrice: number; quantity: number; stockQty: number };
type Result =
  | { type: 'sale'; total: number; change: number; method: PaymentMethod; items: CartItem[]; date: string }
  | { type: 'quote'; total: number; items: CartItem[]; date: string };

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function VendaPage() {
  const [ready, setReady] = useState(false);
  const [caixaOpen, setCaixaOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selected, setSelected] = useState('');
  const [qty, setQty] = useState('1');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [received, setReceived] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [printModel, setPrintModel] = useState<'80mm' | 'A4'>('80mm');

  async function loadProducts() {
    setProducts(await apiGet<Product[]>('/products'));
  }

  useEffect(() => {
    (async () => {
      try {
        apiGet<Store>('/tenant').then(setStore).catch(() => {});
        const session = await apiGet<{ id: string } | null>('/cash-sessions/current');
        setCaixaOpen(!!session);
        if (session) await loadProducts();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  /** Define o modelo (80mm/A4), injeta a regra @page e abre o diálogo de impressão. */
  function imprimir() {
    const area = document.getElementById('print-area');
    if (area) area.setAttribute('data-model', printModel);
    let style = document.getElementById('print-page-style') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'print-page-style';
      document.head.appendChild(style);
    }
    style.textContent =
      printModel === '80mm'
        ? '@media print { @page { size: 80mm auto; margin: 4mm; } }'
        : '@media print { @page { size: A4; margin: 14mm; } }';
    window.print();
  }

  const totals = useMemo(
    () => calcSaleTotals(cart.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice }))),
    [cart],
  );
  const change = method === 'CASH' && received ? Number(received) - totals.total : 0;

  function addToCart() {
    setError(null);
    const p = products.find((x) => x.id === selected);
    const q = Number(qty);
    if (!p || !(q > 0)) {
      setError('Selecione um produto e uma quantidade válida.');
      return;
    }
    const stock = Number(p.stockQty);
    const existing = cart.find((c) => c.productId === p.id);
    const newQty = (existing?.quantity ?? 0) + q;
    if (newQty > stock) {
      setError(`Estoque insuficiente para "${p.name}" (disponível: ${stock}).`);
      return;
    }
    if (existing) {
      setCart(cart.map((c) => (c.productId === p.id ? { ...c, quantity: newQty } : c)));
    } else {
      setCart([
        ...cart,
        { productId: p.id, name: p.name, unitPrice: Number(p.salePrice), quantity: q, stockQty: stock },
      ]);
    }
    setSelected('');
    setQty('1');
  }

  function removeFromCart(productId: string) {
    setCart(cart.filter((c) => c.productId !== productId));
  }

  async function onConcluir() {
    setError(null);
    const payload = {
      items: cart.map((c) => ({ productId: c.productId, quantity: c.quantity, unitPrice: c.unitPrice })),
      payments: [{ method, amount: totals.total }],
    };
    const parsed = createSaleSchema.safeParse(payload);
    if (!parsed.success) {
      setError('Não foi possível montar a venda. Verifique o carrinho.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ change: number }>('/orders', parsed.data);
      setResult({
        type: 'sale',
        total: totals.total,
        change: res.change,
        method,
        items: cart,
        date: new Date().toLocaleString('pt-BR'),
      });
      setCart([]);
      setReceived('');
      await loadProducts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onOrcamento() {
    if (cart.length === 0) {
      setError('Adicione itens para gerar um orçamento.');
      return;
    }
    setResult({
      type: 'quote',
      total: totals.total,
      items: cart,
      date: new Date().toLocaleString('pt-BR'),
    });
  }

  function novaVenda() {
    setResult(null);
    setError(null);
  }

  if (!ready) return <p className="text-gray-500">Carregando…</p>;

  if (!caixaOpen) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="mb-4 text-2xl font-bold">Venda</h1>
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="mb-3 text-gray-600">É preciso ter um caixa aberto para vender.</p>
          <Link href="/caixa" className="inline-block rounded-lg bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-800">
            Ir para o Caixa
          </Link>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="mb-4 text-2xl font-bold">{result.type === 'sale' ? 'Venda concluída' : 'Orçamento'}</h1>
        <div className="space-y-3 rounded-2xl bg-white p-6 shadow-sm">
          {result.type === 'sale' ? (
            <p className="inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
              Venda registrada ✅
            </p>
          ) : (
            <p className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700">
              Orçamento (não é venda)
            </p>
          )}
          <ul className="divide-y divide-gray-100 text-sm">
            {result.items.map((i) => (
              <li key={i.productId} className="flex justify-between py-1">
                <span>{i.quantity}× {i.name}</span>
                <span>{BRL(i.unitPrice * i.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-gray-200 pt-2 font-medium">
            <span>Total</span>
            <span>{BRL(result.total)}</span>
          </div>
          {result.type === 'sale' && (
            <>
              <div className="flex justify-between text-sm text-gray-500">
                <span>Pagamento</span>
                <span>{PAYMENT_METHOD_LABELS[result.method]}</span>
              </div>
              {result.change > 0 && (
                <div className="flex justify-between text-sm">
                  <span>Troco</span>
                  <span>{BRL(result.change)}</span>
                </div>
              )}
            </>
          )}
          <div className="flex items-center gap-2 border-t border-gray-200 pt-3">
            <span className="text-sm text-gray-500">Imprimir:</span>
            <select
              value={printModel}
              onChange={(e) => setPrintModel(e.target.value as '80mm' | 'A4')}
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="80mm">Térmica 80mm</option>
              <option value="A4">A4</option>
            </select>
            <button
              onClick={imprimir}
              className="rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-100"
            >
              Imprimir
            </button>
          </div>
          <button onClick={novaVenda} className="w-full rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800">
            Nova venda
          </button>
        </div>

        <ReceiptPrint
          kind={result.type}
          store={store}
          items={result.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice }))}
          total={result.total}
          date={result.date}
          method={result.type === 'sale' ? result.method : undefined}
          change={result.type === 'sale' ? result.change : undefined}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold">Venda</h1>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex flex-wrap gap-2 rounded-2xl bg-white p-4 shadow-sm">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="min-w-[12rem] flex-1 rounded-lg border border-gray-300 px-3 py-2"
        >
          <option value="">Selecione um produto…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {BRL(p.salePrice)} (est. {Number(p.stockQty)})
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          step="1"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-24 rounded-lg border border-gray-300 px-3 py-2"
        />
        <button onClick={addToCart} className="rounded-lg bg-gray-200 px-4 py-2 font-medium hover:bg-gray-300">
          Adicionar
        </button>
      </div>

      <div className="mb-4 overflow-hidden rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2">Produto</th>
              <th className="px-4 py-2 text-right">Qtd</th>
              <th className="px-4 py-2 text-right">Preço</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {cart.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  Carrinho vazio.
                </td>
              </tr>
            ) : (
              cart.map((i) => (
                <tr key={i.productId} className="border-t border-gray-100">
                  <td className="px-4 py-2">{i.name}</td>
                  <td className="px-4 py-2 text-right">{i.quantity}</td>
                  <td className="px-4 py-2 text-right">{BRL(i.unitPrice)}</td>
                  <td className="px-4 py-2 text-right">{BRL(i.unitPrice * i.quantity)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => removeFromCart(i.productId)} className="text-gray-400 hover:text-red-600">
                      remover
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <label className="block text-sm font-medium">Forma de pagamento</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          >
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
          {method === 'CASH' && (
            <div>
              <label className="block text-sm font-medium">Valor recebido</label>
              <input
                type="number"
                step="0.01"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                placeholder={BRL(totals.total)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
              {received !== '' && (
                <p className="mt-1 text-sm text-gray-500">
                  Troco: {BRL(Math.max(0, change))}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between rounded-2xl bg-white p-4 shadow-sm">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-gray-500">
              <span>Subtotal</span>
              <span>{BRL(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>{BRL(totals.total)}</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={onConcluir}
              disabled={busy || cart.length === 0}
              className="rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {busy ? 'Concluindo…' : 'Concluir venda'}
            </button>
            <button
              onClick={onOrcamento}
              disabled={cart.length === 0}
              className="rounded-lg border border-gray-300 py-2 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              Orçamento
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
