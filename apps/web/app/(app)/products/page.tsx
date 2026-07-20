'use client';

import { useEffect, useRef, useState } from 'react';
import { createProductSchema, unitTypeLabels, type UnitType } from '@nexoloja/shared';
import { productMatchesQuery } from '@nexoloja/core';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';
import { BarcodeScanButton } from '@/components/BarcodeScanButton';
import { ProductDetail, type ProductFull } from '@/components/ProductDetail';

/**
 * A lista usa o cadastro **completo** (`ProductFull`) porque a linha abre o painel de
 * visualizar/editar — assim o painel não precisa de um `GET /products/:id` extra
 * (cost-zero: uma requisição a menos por clique).
 */
type Product = ProductFull;

/** Autoria (ADR-010): "por <nome> · <data>", ou "—" quando não há registro (dados antigos). */
const byLine = (name: string | null, iso?: string) =>
  name ? `${name}${iso ? ` · ${new Date(iso).toLocaleDateString('pt-BR')}` : ''}` : '—';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const QTY = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

export default function ProductsPage() {
  const online = useOnline();
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    popularName: '',
    manufacturer: '',
    sku: '',
    description: '',
    unit: 'UNIT' as UnitType,
    costPrice: '',
    salePrice: '',
    // Peso: o usuário digita na unidade escolhida (kg/g); guardamos canônico em kg no envio.
    weight: '',
    weightUnit: 'kg' as 'kg' | 'g',
    minStockQty: '',
    initialStock: '',
    // Venda em unidade alternativa (EF-3, ADR-013). Vazios ⇒ produto de uma unidade só.
    altUnit: '' as UnitType | '',
    conversionFactor: '',
    altSalePrice: '',
    // Produto agregado — venda em par (ADR-015). Vazios ⇒ produto sem par.
    pairedProductId: '',
    pairPrice: '',
  });
  const [saving, setSaving] = useState(false);

  // Busca local: nome, nome popular, fabricante ou SKU (função pura de packages/core).
  const [search, setSearch] = useState('');
  const filtered = products.filter((p) => productMatchesQuery(p, search));

  // Produto aberto no painel de visualizar/editar (null = painel fechado).
  const [detailId, setDetailId] = useState<string | null>(null);
  // Lê da lista (e não de um estado próprio) para o painel refletir o recarregamento pós-save.
  const detail = products.find((p) => p.id === detailId) ?? null;

  // Enter-scan (leitor físico): destaca a linha do produto encontrado por alguns segundos.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Ref do campo Nome do cadastro — foca ao escanear um código ainda não cadastrado.
  const nameRef = useRef<HTMLInputElement>(null);

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

  // Remove o destaque da linha escaneada depois de alguns segundos.
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 2500);
    return () => clearTimeout(t);
  }, [highlightId]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Peso canônico em kg (mesmo padrão de CNPJ/telefone: UI formata, banco guarda canônico).
    // Digitado em gramas → divide por 1000; `weightKg` só vai quando > 0.
    const weightRaw = form.weight ? Number(form.weight) : 0;
    const weightKg =
      weightRaw > 0 ? (form.weightUnit === 'g' ? weightRaw / 1000 : weightRaw) : undefined;

    const parsed = createProductSchema.safeParse({
      name: form.name,
      // Nome popular é opcional: string vazia vira undefined (não envia coluna vazia).
      popularName: form.popularName.trim() || undefined,
      // Fabricante/marca — opcional; também entra na busca (nome/popular/fabricante/SKU).
      manufacturer: form.manufacturer.trim() || undefined,
      sku: form.sku,
      description: form.description.trim() || undefined,
      unit: form.unit,
      costPrice: Number(form.costPrice),
      salePrice: Number(form.salePrice),
      weightKg,
      minStockQty: form.minStockQty ? Number(form.minStockQty) : undefined,
      // Se preenchido, a API gera a Entrada de estoque atomicamente (ADR-001); vazio = nasce em 0.
      initialStock: form.initialStock ? Number(form.initialStock) : undefined,
      // Unidade alternativa (EF-3): só envia se preenchido; os 3 juntos habilitam o modo no PDV.
      altUnit: form.altUnit || undefined,
      conversionFactor: form.conversionFactor ? Number(form.conversionFactor) : undefined,
      altSalePrice: form.altSalePrice ? Number(form.altSalePrice) : undefined,
      // Par (ADR-015): só vale com os dois preenchidos; sem produto agregado o preço é ignorado.
      pairedProductId: form.pairedProductId || undefined,
      pairPrice:
        form.pairedProductId && form.pairPrice ? Number(form.pairPrice) : undefined,
    });
    if (!parsed.success) {
      setError('Confira os campos: nome, SKU e preços são obrigatórios.');
      return;
    }
    // Par (ADR-015): agregado sem preço salvaria um par que o PDV nunca ofereceria.
    if (form.pairedProductId && !(Number(form.pairPrice) > 0)) {
      setError('Informe o preço do par (ou remova o produto agregado).');
      return;
    }

    setSaving(true);
    try {
      await apiPost<Product>('/products', parsed.data);
      setForm({
        name: '',
        popularName: '',
        manufacturer: '',
        sku: '',
        description: '',
        unit: 'UNIT',
        costPrice: '',
        salePrice: '',
        weight: '',
        weightUnit: 'kg',
        minStockQty: '',
        initialStock: '',
        altUnit: '',
        conversionFactor: '',
        altSalePrice: '',
        pairedProductId: '',
        pairPrice: '',
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Processa um código lido (Enter do leitor físico OU câmera). O SKU é o código de barras:
   * - achou 1 produto → rola até a linha e a destaca (o produto já existe; ajuste ali mesmo);
   * - não achou nada → é um código novo: joga no campo SKU do cadastro e foca em Nome, para
   *   registrar o produto lido na hora;
   * - vários → só filtra a lista pelo código, para o operador escolher.
   */
  function handleScannedCode(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const matches = products.filter((p) => productMatchesQuery(p, code));
    const found = matches.length === 1 ? matches[0] : undefined;
    if (found) {
      setSearch(code); // garante que a linha está visível
      setHighlightId(found.id);
      // Rola após o re-render (a linha só existe no DOM depois do commit da busca).
      requestAnimationFrame(() =>
        document.getElementById(`prod-row-${found.id}`)?.scrollIntoView({ block: 'center' }),
      );
    } else if (matches.length === 0) {
      // Código não cadastrado → começa o cadastro já com o SKU preenchido.
      setForm((f) => ({ ...f, sku: code }));
      setSearch('');
      nameRef.current?.focus();
    } else {
      setSearch(code); // vários resultados: filtra a lista
    }
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    handleScannedCode(search);
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

      {/* Tela online-only (ADR-012 (c)): offline mostra o aviso de rede, não o erro cru. */}
      <OfflineNotice />

      <form
        onSubmit={onCreate}
        className="mb-6 grid grid-cols-1 gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-6"
      >
        <input
          ref={nameRef}
          placeholder="Nome"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
        />
        <input
          placeholder="Nome popular (opcional)"
          value={form.popularName}
          onChange={(e) => setForm({ ...form, popularName: e.target.value })}
          title="Nome popular/regional pelo qual o produto também é buscado no PDV. Ex.: 'Ferro 8' para 'Vergalhão CA-50 8mm'."
          className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
        />
        <input
          placeholder="Fabricante (opcional)"
          value={form.manufacturer}
          onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
          maxLength={120}
          title="Fabricante/marca do produto (ex.: Votorantim, Tigre). Também é usado na busca."
          className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
        />
        <div className="flex gap-2 sm:col-span-2">
          <input
            placeholder="SKU / código de barras"
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
          <BarcodeScanButton
            onScan={(code) => setForm((f) => ({ ...f, sku: code.trim() }))}
            label="Escanear código de barras para o SKU"
          />
        </div>
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
        {/* Unidade de venda (UnitType) — como o produto é vendido/medido. */}
        <select
          value={form.unit}
          onChange={(e) => setForm({ ...form, unit: e.target.value as UnitType })}
          title="Unidade de venda do produto (ex.: saco de cimento, milheiro de tijolo, metro de fio)."
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 sm:col-span-2"
          aria-label="Unidade de venda"
        >
          {(Object.keys(unitTypeLabels) as UnitType[]).map((u) => (
            <option key={u} value={u}>
              {unitTypeLabels[u]}
            </option>
          ))}
        </select>
        {/* Peso: digita em kg ou g; guardamos canônico em kg (banco). Opcional. */}
        <div className="flex gap-2 sm:col-span-2">
          <input
            placeholder="Peso (opcional)"
            type="number"
            step="any"
            min="0"
            value={form.weight}
            onChange={(e) => setForm({ ...form, weight: e.target.value })}
            title="Peso do produto por unidade de venda. Escolha kg ou g ao lado; guardamos em kg."
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
          <select
            value={form.weightUnit}
            onChange={(e) => setForm({ ...form, weightUnit: e.target.value as 'kg' | 'g' })}
            className="rounded-lg border border-gray-300 bg-white px-2 py-2"
            aria-label="Unidade do peso"
          >
            <option value="kg">kg</option>
            <option value="g">g</option>
          </select>
        </div>
        <input
          placeholder="Estoque mín."
          type="number"
          step="1"
          min="0"
          value={form.minStockQty}
          onChange={(e) => setForm({ ...form, minStockQty: e.target.value })}
          className="rounded-lg border border-gray-300 px-3 py-2"
        />
        <input
          placeholder="Estoque inicial (opcional)"
          type="number"
          step="any"
          min="0"
          value={form.initialStock}
          onChange={(e) => setForm({ ...form, initialStock: e.target.value })}
          title="Se preenchido, gera uma Entrada de estoque no cadastro (aparece no Estoque como 'Estoque inicial'). Deixe vazio para o produto nascer com 0."
          className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
        />
        {/* Descrição/observação (opcional, até 500 caracteres). */}
        <textarea
          placeholder="Descrição / observação (opcional)"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          maxLength={500}
          rows={2}
          title="Detalhes ou observações do produto (opcional). Ex.: marca, especificação técnica, cor."
          className="resize-y rounded-lg border border-gray-300 px-3 py-2 sm:col-span-4"
        />
        {/* Venda em unidade alternativa (EF-3, ADR-013): embalagem fechada com preço próprio. */}
        <fieldset className="rounded-xl border border-dashed border-gray-300 p-3 sm:col-span-6">
          <legend className="px-1 text-xs font-medium text-gray-500">
            Venda em unidade alternativa (opcional) — ex.: fio por metro OU rolo fechado
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <select
              value={form.altUnit}
              onChange={(e) => setForm({ ...form, altUnit: e.target.value as UnitType | '' })}
              title="Unidade da embalagem fechada (ex.: Rolo). Deixe em branco para vender só na unidade principal."
              className="rounded-lg border border-gray-300 bg-white px-3 py-2"
              aria-label="Unidade da embalagem alternativa"
            >
              <option value="">— sem embalagem alternativa —</option>
              {(Object.keys(unitTypeLabels) as UnitType[]).map((u) => (
                <option key={u} value={u}>
                  {unitTypeLabels[u]}
                </option>
              ))}
            </select>
            <input
              placeholder={`Tamanho (${unitTypeLabels[form.unit]} por embalagem)`}
              type="number"
              step="any"
              min="0"
              value={form.conversionFactor}
              onChange={(e) => setForm({ ...form, conversionFactor: e.target.value })}
              title="Quantas unidades-base cabem em 1 embalagem fechada. Ex.: rolo de 100 m → 100."
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
            <input
              placeholder="Preço da embalagem fechada"
              type="number"
              step="0.01"
              min="0"
              value={form.altSalePrice}
              onChange={(e) => setForm({ ...form, altSalePrice: e.target.value })}
              title="Preço próprio de 1 embalagem fechada (costuma sair mais barato por unidade-base que o avulso)."
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Preencha os três para habilitar a escolha “{unitTypeLabels[form.unit]} × embalagem” no PDV.
          </p>
        </fieldset>
        {/* Produto agregado — venda em par (ADR-015). Ex.: parafuso nº10 + bucha nº10. */}
        <fieldset className="rounded-xl border border-dashed border-gray-300 p-3 sm:col-span-6">
          <legend className="px-1 text-xs font-medium text-gray-500">
            Vendido em par (opcional) — ex.: parafuso + bucha, com preço do par
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select
              value={form.pairedProductId}
              onChange={(e) => setForm({ ...form, pairedProductId: e.target.value })}
              title="O outro produto do par. Cada um segue com seu preço e estoque próprios."
              className="rounded-lg border border-gray-300 bg-white px-3 py-2"
              aria-label="Produto agregado"
            >
              <option value="">— sem produto agregado —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({BRL(p.salePrice)})
                </option>
              ))}
            </select>
            <input
              placeholder="Preço do par (os dois juntos)"
              type="number"
              step="0.01"
              min="0"
              value={form.pairPrice}
              onChange={(e) => setForm({ ...form, pairPrice: e.target.value })}
              disabled={form.pairedProductId === ''}
              title="Preço total dos dois itens vendidos juntos (ex.: R$ 0,70 o par)."
              className="rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-50"
            />
          </div>
          <p className="mt-2 text-xs text-gray-400">
            No PDV o operador escolhe vender avulso ou o par. Vale para os dois lados — não
            precisa cadastrar de novo no outro produto.
          </p>
        </fieldset>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-60 sm:col-span-6"
        >
          {saving ? 'Salvando…' : 'Adicionar produto'}
        </button>
      </form>

      {/* Erro cru só quando online (offline vira "Failed to fetch" — o aviso acima já explica). */}
      {error && online && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mb-3 flex gap-2 sm:max-w-md">
        <input
          type="search"
          placeholder="Buscar ou escanear (nome, popular, fabricante ou SKU)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onSearchKeyDown}
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
          aria-label="Buscar produto"
        />
        <BarcodeScanButton onScan={handleScannedCode} label="Escanear para buscar ou cadastrar" />
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Fabricante</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2 text-right">Custo</th>
              <th className="px-4 py-2 text-right">Venda</th>
              <th className="px-4 py-2 text-right">Margem</th>
              <th className="px-4 py-2">Última alteração</th>
              <th className="px-4 py-2 text-right">Estoque mín.</th>
              <th className="px-4 py-2 text-right">Cadastro</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-gray-400">
                  {search
                    ? 'Nenhum produto encontrado para a busca.'
                    : 'Nenhum produto cadastrado.'}
                </td>
              </tr>
            ) : (
              filtered.map((p) => {
                const current = minEdits[p.id] ?? p.minStockQty;
                const changed =
                  minEdits[p.id] !== undefined &&
                  Number(minEdits[p.id]) !== Number(p.minStockQty);
                return (
                  <tr
                    key={p.id}
                    id={`prod-row-${p.id}`}
                    className={`border-t border-gray-100 transition-colors ${
                      highlightId === p.id ? 'bg-yellow-100' : ''
                    }`}
                  >
                    <td className="px-4 py-2">
                      {/* Nome clicável: abre o cadastro completo (visualizar/editar). */}
                      <button
                        type="button"
                        onClick={() => setDetailId(p.id)}
                        className="text-left font-medium text-gray-900 hover:text-blue-700 hover:underline"
                        title="Ver / editar o cadastro deste produto"
                      >
                        {p.name}
                      </button>
                      {p.popularName && (
                        <span className="block text-xs text-gray-400">{p.popularName}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{p.manufacturer ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-500">{p.sku}</td>
                    <td className="px-4 py-2 text-right">{BRL(p.costPrice)}</td>
                    <td className="px-4 py-2 text-right">{BRL(p.salePrice)}</td>
                    <td className="px-4 py-2 text-right">{p.marginPercent}%</td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {byLine(p.updatedByName, p.updatedAt)}
                    </td>
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
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setDetailId(p.id)}
                        className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Ver / editar
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-400">
        Clique no nome do produto para ver o cadastro completo e editar. Estoque mínimo é o
        ponto de reposição — quando o saldo fica igual ou abaixo dele (e maior que zero), o
        produto aparece como “baixo” na tela de Estoque.
      </p>

      {/* Painel de visualizar/editar o cadastro (fatia EP). */}
      {detail && (
        <ProductDetail
          product={detail}
          allProducts={products}
          onClose={() => setDetailId(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
