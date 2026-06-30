'use client';

import { useEffect, useState } from 'react';
import { createProductSchema } from '@nexoloja/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

type Product = {
  id: string;
  sku: string;
  name: string;
  costPrice: string;
  salePrice: string;
  stockQty: string;
  minStockQty: string;
  marginPercent: number;
};

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const QTY = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    sku: '',
    costPrice: '',
    salePrice: '',
    minStockQty: '',
  });
  const [saving, setSaving] = useState(false);

  // Edições do estoque mínimo por produto (id → valor digitado), antes de salvar.
  const [minEdits, setMinEdits] = useState<Record<string, string>>({});
  const [savingMinId, setSavingMinId] = useState<string | null>(null);

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
      minStockQty: form.minStockQty ? Number(form.minStockQty) : undefined,
    });
    if (!parsed.success) {
      setError('Confira os campos: nome, SKU e preços são obrigatórios.');
      return;
    }

    setSaving(true);
    try {
      await apiPost<Product>('/products', parsed.data);
      setForm({ name: '', sku: '', costPrice: '', salePrice: '', minStockQty: '' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** Salva o estoque mínimo de um produto (PATCH parcial). */
  async function saveMin(p: Product) {
    const raw = minEdits[p.id];
    if (raw === undefined) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      setError('Estoque mínimo inválido.');
      return;
    }
    setSavingMinId(p.id);
    setError(null);
    try {
      await apiPatch(`/products/${p.id}`, { minStockQty: value });
      setMinEdits((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingMinId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-bold">Produtos</h1>

      <form
        onSubmit={onCreate}
        className="mb-6 grid grid-cols-1 gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-6"
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
        <input
          placeholder="Estoque mín."
          type="number"
          step="1"
          min="0"
          value={form.minStockQty}
          onChange={(e) => setForm({ ...form, minStockQty: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-60 sm:col-span-6"
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
              <th className="px-4 py-2 text-right">Estoque mín.</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                  Nenhum produto cadastrado.
                </td>
              </tr>
            ) : (
              products.map((p) => {
                const current = minEdits[p.id] ?? p.minStockQty;
                const changed =
                  minEdits[p.id] !== undefined &&
                  Number(minEdits[p.id]) !== Number(p.minStockQty);
                return (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-4 py-2">{p.name}</td>
                    <td className="px-4 py-2 text-gray-500">{p.sku}</td>
                    <td className="px-4 py-2 text-right">{BRL(p.costPrice)}</td>
                    <td className="px-4 py-2 text-right">{BRL(p.salePrice)}</td>
                    <td className="px-4 py-2 text-right">{p.marginPercent}%</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={current}
                          onChange={(e) =>
                            setMinEdits({ ...minEdits, [p.id]: e.target.value })
                          }
                          className="w-20 rounded border border-gray-300 px-2 py-1 text-right"
                          aria-label={`Estoque mínimo de ${p.name}`}
                        />
                        <button
                          type="button"
                          onClick={() => saveMin(p)}
                          disabled={!changed || savingMinId === p.id}
                          className="rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-30"
                        >
                          {savingMinId === p.id ? '…' : 'Salvar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-400">
        Estoque mínimo é o ponto de reposição — quando o saldo fica igual ou abaixo dele
        (e maior que zero), o produto aparece como “baixo” na tela de Estoque.
      </p>
    </div>
  );
}
