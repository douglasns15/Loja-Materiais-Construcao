'use client';

import { useEffect, useState } from 'react';
import { createProductSchema } from '@nexoloja/shared';
import { apiGet, apiPost } from '@/lib/api';

type Product = {
  id: string;
  sku: string;
  name: string;
  costPrice: string;
  salePrice: string;
  marginPercent: number;
};

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', sku: '', costPrice: '', salePrice: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setProducts(await apiGet<Product[]>('/products'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = createProductSchema.safeParse({
      name: form.name,
      sku: form.sku,
      costPrice: Number(form.costPrice),
      salePrice: Number(form.salePrice),
    });
    if (!parsed.success) {
      setError('Confira os campos: nome, SKU e preços são obrigatórios.');
      return;
    }

    setSaving(true);
    try {
      await apiPost<Product>('/products', parsed.data);
      setForm({ name: '', sku: '', costPrice: '', salePrice: '' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-bold">Produtos</h1>

      <form
        onSubmit={onCreate}
        className="mb-6 grid grid-cols-1 gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-5"
      >
        <input
          placeholder="Nome"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
        />
        <input
          placeholder="SKU"
          value={form.sku}
          onChange={(e) => setForm({ ...form, sku: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
        <input
          placeholder="Custo"
          type="number"
          step="0.01"
          value={form.costPrice}
          onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
        <input
          placeholder="Venda"
          type="number"
          step="0.01"
          value={form.salePrice}
          onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-60 sm:col-span-5"
        >
          {saving ? 'Salvando…' : 'Adicionar produto'}
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2 text-right">Custo</th>
              <th className="px-4 py-2 text-right">Venda</th>
              <th className="px-4 py-2 text-right">Margem</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  Nenhum produto cadastrado.
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2 text-gray-500">{p.sku}</td>
                  <td className="px-4 py-2 text-right">{BRL(p.costPrice)}</td>
                  <td className="px-4 py-2 text-right">{BRL(p.salePrice)}</td>
                  <td className="px-4 py-2 text-right">{p.marginPercent}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
