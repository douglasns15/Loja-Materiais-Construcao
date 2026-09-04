'use client';

import { useEffect, useMemo, useState } from 'react';
import { createCategorySchema } from '@nexoloja/shared';
import { normalizeSearchText } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { useReloadOnReconnect } from '@/lib/useReloadOnReconnect';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';
import { CategoryFormModal } from '@/components/CategoryFormModal';
import { buildCategoryOptions, type Category } from '@/lib/categories';

export default function CategoriesPage() {
  const online = useOnline();
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Falha na CARGA da lista (≠ erro de validação/ação): liga a auto-recuperação (ADR-005).
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  // Categoria aberta para editar (clicar no nome) — nome + pai + remover.
  const [editId, setEditId] = useState<string | null>(null);

  // A API devolve a lista inteira do tenant (sem paginação); a busca é client-side, como
  // Fornecedores. Catálogo de categorias é pequeno.
  async function load() {
    const items = await apiGet<Category[]>('/categories');
    setCategories(items);
  }

  useEffect(() => {
    load()
      .then(() => setLoadFailed(false))
      .catch((e) => {
        setError((e as Error).message);
        setLoadFailed(true);
      });
  }, []);

  // Auto-recuperação (ADR-005): se a carga falhar por um soluço transitório, re-tenta sozinha.
  useReloadOnReconnect(() => {
    load()
      .then(() => setLoadFailed(false))
      .catch((e) => {
        setError((e as Error).message);
        setLoadFailed(true);
      });
  }, loadFailed);

  // Lista achatada com caminho completo (pai › filho) e profundidade para indentar.
  const options = useMemo(() => buildCategoryOptions(categories), [categories]);

  // Filtro por caminho, acento-insensível (mesma normalização do resto do app).
  const filtered = useMemo(() => {
    const q = normalizeSearchText(search);
    if (!q) return options;
    return options.filter((o) => normalizeSearchText(o.label).includes(q));
  }, [options, search]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload: Record<string, string> = { name: name.trim() };
    if (parentId) payload.parentId = parentId;

    const parsed = createCategorySchema.safeParse(payload);
    if (!parsed.success) {
      setError('Informe um nome para a categoria (até 80 caracteres).');
      return;
    }

    setSaving(true);
    try {
      await apiPost<Category>('/categories', parsed.data);
      setName('');
      setParentId('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-2xl font-bold text-transparent">
        Categorias
      </h1>
      <p className="mb-5 text-sm text-gray-500">
        Organize seus produtos em categorias e subcategorias. Toque numa <strong>categoria</strong>{' '}
        para renomear, mudar o pai ou remover.
      </p>

      {/* Tela online-only (ADR-012 (c)): offline mostra o aviso de rede, não o erro cru. */}
      <OfflineNotice />

      <form
        onSubmit={onCreate}
        className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-md sm:grid-cols-4"
      >
        <input
          placeholder="Nome da categoria"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className="rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:col-span-2"
        />
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          aria-label="Categoria-pai (opcional)"
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">— principal (sem pai) —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 py-2 font-medium text-white shadow-sm hover:from-indigo-700 hover:to-indigo-600 disabled:opacity-60"
        >
          {saving ? 'Salvando…' : 'Adicionar categoria'}
        </button>
      </form>

      {/* Busca client-side (a lista já vem inteira): por nome ou caminho. */}
      <div className="mb-3 sm:max-w-md">
        <input
          type="search"
          placeholder="Buscar categoria…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          aria-label="Buscar categoria"
        />
      </div>

      {error && online && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-md">
        <table className="w-full text-sm">
          <thead className="bg-indigo-50 text-left text-indigo-900">
            <tr>
              <th className="px-4 py-2">Categoria</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-gray-500">
                  {search.trim()
                    ? 'Nenhuma categoria encontrada para a busca.'
                    : 'Nenhuma categoria cadastrada.'}
                </td>
              </tr>
            ) : (
              filtered.map((o) => {
                // Quando há busca, mostra o caminho completo; sem busca, a árvore indentada
                // (só o nome do nível, recuado pela profundidade).
                const cat = categories.find((c) => c.id === o.id);
                const leaf = cat?.name ?? o.label;
                return (
                  <tr key={o.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => setEditId(o.id)}
                        className="text-left font-medium text-indigo-700 hover:underline"
                        style={search.trim() ? undefined : { paddingLeft: `${o.depth * 1.25}rem` }}
                      >
                        {o.depth > 0 && !search.trim() && (
                          <span className="mr-1 text-gray-400" aria-hidden>
                            ↳
                          </span>
                        )}
                        {search.trim() ? o.label : leaf}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Clique numa categoria para renomear, mudar o pai ou remover. Depois, escolha a categoria no
        cadastro de cada produto (campo “Categoria”).
      </p>

      {/* Edição da categoria (nome + pai + remover). Recarrega a lista ao salvar/remover. */}
      {editId && (
        <CategoryFormModal
          categoryId={editId}
          categories={categories}
          onClose={() => setEditId(null)}
          onSaved={() => load().catch(() => {})}
          onDeleted={() => load().catch(() => {})}
        />
      )}
    </div>
  );
}
