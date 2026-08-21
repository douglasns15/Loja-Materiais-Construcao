'use client';

import { useEffect, useMemo, useState } from 'react';
import { createCategorySchema, updateCategorySchema } from '@nexoloja/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import {
  buildCategoryOptions,
  descendantsAndSelf,
  type Category,
} from '@/lib/categories';

const inputClass =
  'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900';

/**
 * Modal único de cadastro de Categoria — serve para **criar** (sem `categoryId`) e **editar**
 * (com `categoryId`; carrega os dados, permite salvar e remover). Espelha o `SupplierFormModal`.
 * `categories` é a lista completa (do tenant), usada para montar o seletor de **categoria-pai** —
 * na edição, exclui a própria categoria e seus descendentes (evita ciclo que a API só barra no
 * caso trivial). `onSaved` devolve o registro salvo para quem quiser já selecioná-lo.
 */
export function CategoryFormModal({
  categoryId,
  categories,
  onClose,
  onSaved,
  onDeleted,
}: {
  categoryId?: string;
  categories: Category[];
  onClose: () => void;
  onSaved: (category: Category) => void;
  onDeleted?: () => void;
}) {
  const isEdit = !!categoryId;
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opções de categoria-pai: todas menos a própria e seus descendentes (na edição), para não
  // criar um ciclo. No modo criar, todas são candidatas a pai.
  const parentOptions = useMemo(() => {
    const blocked = isEdit && categoryId ? descendantsAndSelf(categories, categoryId) : new Set<string>();
    return buildCategoryOptions(categories).filter((o) => !blocked.has(o.id));
  }, [categories, categoryId, isEdit]);

  // Modo edição: carrega os dados atuais da categoria.
  useEffect(() => {
    if (!categoryId) return;
    let cancelled = false;
    setLoading(true);
    apiGet<Category>(`/categories/${categoryId}`)
      .then((cat) => {
        if (cancelled) return;
        setName(cat.name ?? '');
        setParentId(cat.parentId ?? '');
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Payload: nome obrigatório; pai só quando escolhido (vazio = categoria de primeiro nível).
    const payload: Record<string, string> = { name: name.trim() };
    if (parentId) payload.parentId = parentId;

    const schema = isEdit ? updateCategorySchema : createCategorySchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setError('Informe um nome para a categoria (até 80 caracteres).');
      return;
    }

    setSaving(true);
    try {
      const saved = isEdit
        ? await apiPatch<Category>(`/categories/${categoryId}`, parsed.data)
        : await apiPost<Category>('/categories', parsed.data);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onRemove() {
    if (!categoryId) return;
    if (!confirm(`Remover a categoria "${name}"? Ela deixa de aparecer nas listas.`)) return;
    setError(null);
    setRemoving(true);
    try {
      await apiDelete(`/categories/${categoryId}`);
      onDeleted?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setRemoving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Editar categoria' : 'Nova categoria'}</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <p className="py-6 text-center text-gray-500">Carregando…</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="cat-name" className="block text-sm font-medium text-gray-700">
                Nome <span className="text-red-500">*</span>
              </label>
              <input
                id="cat-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                autoFocus
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="cat-parent" className="block text-sm font-medium text-gray-700">
                Categoria-pai
              </label>
              <select
                id="cat-parent"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className={`${inputClass} bg-white`}
              >
                <option value="">— categoria principal (sem pai) —</option>
                {parentOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Deixe em branco para uma categoria principal, ou escolha um pai para virar subcategoria.
              </p>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex items-center justify-between gap-3 pt-1">
              {/* Remover só no modo edição (soft-delete, ADR-004). */}
              {isEdit ? (
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={removing || saving}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {removing ? 'Removendo…' : 'Remover'}
                </button>
              ) : (
                <span />
              )}
              <button
                type="submit"
                disabled={saving || removing}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Cadastrar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
