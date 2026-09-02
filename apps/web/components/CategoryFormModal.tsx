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
  'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

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
  // Confirmação de exclusão com impacto (subcategorias que sobem de nível + produtos afetados).
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // `products < 0` = não foi possível contar (sem rede); a exclusão ainda pode prosseguir.
  const [impact, setImpact] = useState<{ children: number; products: number } | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);

  // Subcategorias diretas: contagem síncrona da lista já carregada (não precisa de rede). São as
  // que "passam a ser principais" ao excluir (viram raiz, pois não repromovemos ao avô).
  const directChildren = useMemo(
    () => (categoryId ? categories.filter((c) => c.parentId === categoryId).length : 0),
    [categories, categoryId],
  );

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
    // Recomeça em estado neutro (troca de categoria com o modal aberto não herda a confirmação).
    setConfirmingDelete(false);
    setImpact(null);
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

  // Passo 1: abre a confirmação e calcula o impacto. Os produtos vinculados são contados **sob
  // demanda** (só ao iniciar a exclusão) — a tela de Categorias não carrega o catálogo à toa.
  async function startRemove() {
    if (!categoryId) return;
    setError(null);
    setConfirmingDelete(true);
    setLoadingImpact(true);
    try {
      // Só os produtos ligados a ESTA categoria ficam sem categoria (os das subcategorias seguem
      // vinculados a elas). `includeInactive` p/ refletir o efeito real no banco.
      const products = await apiGet<{ categoryId: string | null }[]>(
        '/products?includeInactive=true',
      );
      const count = products.filter((p) => p.categoryId === categoryId).length;
      setImpact({ children: directChildren, products: count });
    } catch {
      // Sem a contagem de produtos (falha de rede): ainda dá p/ excluir, mostrando só as subcategorias.
      setImpact({ children: directChildren, products: -1 });
    } finally {
      setLoadingImpact(false);
    }
  }

  // Passo 2: executa o soft-delete (ADR-004) de fato.
  async function confirmRemove() {
    if (!categoryId) return;
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
          <h2 className="w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-lg font-semibold text-transparent">
            {isEdit ? 'Editar categoria' : 'Nova categoria'}
          </h2>
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

            {confirmingDelete ? (
              // Confirmação com impacto: mostra, ANTES de excluir, o que a exclusão afeta — em vez
              // de a pessoa descobrir depois olhando os produtos. Mantém o soft-delete (ADR-004).
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-800">Excluir “{name}”?</p>
                <div className="mt-2 space-y-1 text-xs text-red-700">
                  {loadingImpact ? (
                    <p>Verificando o que será afetado…</p>
                  ) : (
                    <>
                      {impact && impact.children > 0 && (
                        <p>
                          • <strong>{impact.children}</strong>{' '}
                          {impact.children === 1 ? 'subcategoria passa' : 'subcategorias passam'} a ser
                          {impact.children === 1 ? ' categoria principal' : ' categorias principais'}.
                        </p>
                      )}
                      {impact && impact.products > 0 && (
                        <p>
                          • <strong>{impact.products}</strong>{' '}
                          {impact.products === 1 ? 'produto vinculado fica' : 'produtos vinculados ficam'}{' '}
                          <strong>sem categoria</strong>.
                        </p>
                      )}
                      {impact && impact.products === 0 && impact.children === 0 && (
                        <p>Nenhuma subcategoria ou produto usa esta categoria.</p>
                      )}
                      {impact && impact.products < 0 && (
                        <p>
                          Não foi possível conferir os produtos vinculados agora — eles ficarão sem
                          categoria se houver.
                        </p>
                      )}
                      <p className="pt-1 text-red-600">
                        Ela sai das listas (o histórico é preservado; pode recriar depois).
                      </p>
                    </>
                  )}
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingDelete(false);
                      setImpact(null);
                    }}
                    disabled={removing}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={confirmRemove}
                    disabled={removing || loadingImpact}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {removing ? 'Excluindo…' : 'Excluir'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 pt-1">
                {/* Remover só no modo edição (soft-delete, ADR-004). */}
                {isEdit ? (
                  <button
                    type="button"
                    onClick={startRemove}
                    disabled={removing || saving}
                    className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Remover
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  disabled={saving || removing}
                  className="rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:from-indigo-700 hover:to-indigo-600 disabled:opacity-50"
                >
                  {saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Cadastrar'}
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
