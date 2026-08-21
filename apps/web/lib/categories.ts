/**
 * Categoria como devolvida pela API (`GET /categories`). Hierarquia simples via `parentId`
 * (categoria/subcategoria); a fonte de verdade da árvore é o banco. Usada na tela de Categorias
 * e no seletor de categoria do cadastro/edição de Produto.
 */
export type Category = {
  id: string;
  name: string;
  parentId: string | null;
  isActive?: boolean;
  createdAt?: string;
};

/** Opção achatada para `<select>`/listagem: o caminho completo como rótulo e a profundidade. */
export type CategoryOption = { id: string; label: string; depth: number };

/**
 * Achata a árvore de categorias numa lista ordenada, com o **caminho completo** como rótulo
 * ("Elétrica › Fios e cabos") e a profundidade (0 = raiz) para indentar. Ordena alfabético
 * (pt-BR) em cada nível. Robusto a dados degenerados: um pai que não está na lista (removido)
 * vira raiz — a categoria nunca some — e um ciclo é cortado pela marcação de visitados.
 */
export function buildCategoryOptions(cats: Category[]): CategoryOption[] {
  const ids = new Set(cats.map((c) => c.id));
  const byParent = new Map<string | null, Category[]>();
  for (const c of cats) {
    // Pai ausente (soft-deleted/órfão) ⇒ trata como raiz, para não sumir da lista.
    const key = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    const arr = byParent.get(key) ?? [];
    arr.push(c);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  const out: CategoryOption[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, prefix: string, depth: number) => {
    for (const c of byParent.get(parentId) ?? []) {
      if (visited.has(c.id)) continue; // guarda contra ciclo (pai apontando p/ descendente)
      visited.add(c.id);
      const label = prefix ? `${prefix} › ${c.name}` : c.name;
      out.push({ id: c.id, label, depth });
      walk(c.id, label, depth + 1);
    }
  };
  walk(null, '', 0);
  return out;
}

/** Mapa id → rótulo com caminho completo, para exibir a categoria de um produto. */
export function categoryLabelMap(cats: Category[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const o of buildCategoryOptions(cats)) m.set(o.id, o.label);
  return m;
}

/**
 * Ids que NÃO podem ser pai de `id` — ele mesmo + todos os descendentes. Usado para filtrar as
 * opções de "categoria-pai" no seletor de edição, evitando um ciclo que a API só barra no caso
 * trivial (`parentId === id`).
 */
export function descendantsAndSelf(cats: Category[], id: string): Set<string> {
  const byParent = new Map<string | null, Category[]>();
  for (const c of cats) {
    const arr = byParent.get(c.parentId) ?? [];
    arr.push(c);
    byParent.set(c.parentId, arr);
  }
  const blocked = new Set<string>([id]);
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    for (const child of byParent.get(cur) ?? []) {
      if (!blocked.has(child.id)) {
        blocked.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return blocked;
}
