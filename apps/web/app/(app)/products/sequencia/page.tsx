'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  findProductByCode,
  isValidGtin,
  onlyDigits,
  unitTypeLabels,
  visibleUnitTypes,
  type EanLookupResult,
  type UnitType,
} from '@nexoloja/shared';
import {
  CLOSED_PRIMARY_UNITS,
  planOpeningCount,
  quantityRuleFor,
  roundQuantity,
  tracksStock,
} from '@nexoloja/core';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useModule } from '@/lib/useModule';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';
import { BarcodeScanButton } from '@/components/BarcodeScanButton';
import { MoneyInput } from '@/components/MoneyInput';
import { buildCategoryOptions, type Category } from '@/lib/categories';

/**
 * Cadastro em sequência (ADR-041 §A) — a porta principal da implantação para quem compra sem XML.
 *
 * Ritmo de prateleira: **bipa → ficha do catálogo global preenche nome/marca/foto → preço e
 * quantidade → Enter → próximo bipe**. O foco volta sempre ao campo de leitura (leitor USB ou câmera).
 *
 * - Código NOVO ⇒ `POST /products` com `initialStock` (a API cria o produto e a Entrada de estoque na
 *   mesma transação — ADR-001). SKU = o próprio código lido (mesmo padrão da importação de NF-e).
 * - Código JÁ CADASTRADO ⇒ só pergunta a quantidade (contagem de abertura): vira ajuste de inventário
 *   (`POST /stock/adjust`, ADR-004) pela diferença para o saldo. Preço pode ser corrigido na passada.
 * - Casamento pela regra única do ADR-041 (`findProductByCode`: GTIN canônico → código interno),
 *   contra o catálogo da loja carregado uma vez ao abrir a tela (sem ida ao servidor por bipe).
 *
 * Sem rota nova nem migration — reusa contratos existentes. Tela online-only (ADR-012 (c)).
 */

/** Subconjunto do produto que a tela usa (o `GET /products` devolve o cadastro inteiro). */
type SeqProduct = {
  id: string;
  sku: string;
  ean: string | null;
  name: string;
  unit: UnitType;
  salePrice: string | number;
  stockQty: string | number;
  trackStock: boolean | null;
  imageUrl: string | null;
};

/** Item em edição: código novo (cadastrar) ou produto existente (contar). */
type Current =
  | { mode: 'new'; code: string; lookup: EanLookupResult | null; looking: boolean }
  | { mode: 'existing'; product: SeqProduct };

/** O que aconteceu com cada bipe — alimenta a lista "Últimos bipados". */
type RecentEntry = {
  key: number;
  productId: string;
  name: string;
  summary: string;
  tone: 'new' | 'count' | 'neutral';
};

/** Motivo do ajuste de inventário gerado pela contagem de abertura (vira "Ajuste de inventário: …"). */
const OPENING_REASON = 'Carga inicial (cadastro em sequência)';

/** Última unidade/categoria usadas — prateleira costuma ser da mesma categoria (ADR-041 §A). */
const PREFS_KEY = 'nexoloja:seq-cadastro-prefs';

/** Quantos bipes a lista lateral mostra (o contador da sessão conta todos). */
const RECENT_SHOWN = 12;

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Sufixo curto da unidade a partir do rótulo ("Quilograma (kg)" → "kg"; sem parênteses → rótulo). */
function unitShort(u: UnitType): string {
  const m = /\(([^)]+)\)/.exec(unitTypeLabels[u]);
  return m?.[1] ?? unitTypeLabels[u].toLowerCase();
}

/** Quantidade digitada (vírgula ou ponto) → número na precisão da unidade; '' ⇒ null; inválida ⇒ NaN. */
function parseQty(raw: string, unit: UnitType): number | null {
  const s = raw.trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n >= LOOKS_LIKE_BARCODE) return Number.NaN;
  return roundQuantity(n, quantityRuleFor(unit));
}

/**
 * Teto de sanidade para preço e quantidade: um código de barras bipado com o foco no campo errado
 * vira "7891000100103" — melhor recusar do que gravar um preço/estoque absurdo.
 */
const LOOKS_LIKE_BARCODE = 1_000_000;

const QTY = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

function loadPrefs(): { unit?: UnitType; categoryId?: string } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as { unit?: UnitType; categoryId?: string }) : {};
  } catch {
    return {};
  }
}

function savePrefs(p: { unit: UnitType; categoryId: string }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Preferência é conveniência: sem storage, só não lembra.
  }
}

const EMPTY_FORM = { name: '', brand: '', price: '', qty: '' };

export default function CadastroEmSequenciaPage() {
  const online = useOnline();
  const construction = useModule('CONSTRUCTION_UNITS');

  const [catalog, setCatalog] = useState<SeqProduct[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const categoryOptions = buildCategoryOptions(categories);

  const [code, setCode] = useState('');
  const [current, setCurrent] = useState<Current | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [unit, setUnit] = useState<UnitType>('UNIT');
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  // Remonta o campo de preço: focado, o MoneyInput mostra o próprio texto digitado (não o `value`),
  // então repor o preço após a trava de "código no campo errado" exige um campo novo.
  const [priceKey, setPriceKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const recentSeq = useRef(0);

  const scanRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  // Para onde o foco vai depois que o estado assentar (o campo pode ainda não estar montado).
  const [focusTarget, setFocusTarget] = useState<'scan' | 'name' | 'price' | 'qty' | null>('scan');
  // Descarta resposta de ficha de um bipe anterior (o implantador bipou outro antes de voltar).
  const lookupSeq = useRef(0);

  useEffect(() => {
    const prefs = loadPrefs();
    if (prefs.unit && prefs.unit in unitTypeLabels) setUnit(prefs.unit);
    if (prefs.categoryId) setCategoryId(prefs.categoryId);
  }, []);

  async function loadCatalog() {
    setLoadError(null);
    try {
      setCatalog(await apiGet<SeqProduct[]>('/products?includeInactive=true'));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }

  useEffect(() => {
    void loadCatalog();
    // Categorias: falha silenciosa (sem elas o seletor fica só com "— sem categoria —").
    apiGet<Category[]>('/categories')
      .then(setCategories)
      .catch(() => {});
  }, []);

  // Categoria lembrada que deixou de existir não deve ir no cadastro.
  useEffect(() => {
    if (categoryId && categories.length && !categories.some((c) => c.id === categoryId)) {
      setCategoryId('');
    }
  }, [categories, categoryId]);

  useEffect(() => {
    if (!focusTarget) return;
    const el =
      focusTarget === 'scan'
        ? scanRef.current
        : focusTarget === 'name'
          ? nameRef.current
          : focusTarget === 'qty'
            ? qtyRef.current
            : (document.getElementById('seq-price') as HTMLInputElement | null);
    if (el) {
      el.focus();
      el.select?.();
      setFocusTarget(null);
    }
  }, [focusTarget, current]);

  function pushRecent(entry: Omit<RecentEntry, 'key'>) {
    recentSeq.current += 1;
    setRecent((r) => [{ ...entry, key: recentSeq.current }, ...r]);
  }

  function openExisting(product: SeqProduct, prefillQty = '') {
    setCurrent({ mode: 'existing', product });
    setForm({ ...EMPTY_FORM, price: String(Number(product.salePrice)), qty: prefillQty });
    setError(null);
    setFocusTarget(tracksStock(product) ? 'qty' : 'price');
  }

  function backToScan() {
    setCurrent(null);
    setForm(EMPTY_FORM);
    setCode('');
    setFocusTarget('scan');
  }

  async function handleScan(raw: string) {
    const c = raw.trim();
    if (!c || !catalog) return;
    setError(null);
    setCode('');

    const found = findProductByCode(catalog, c);
    if (found) {
      openExisting(found);
      return;
    }

    const digits = onlyDigits(c);
    const gtin = isValidGtin(digits);
    setCurrent({ mode: 'new', code: gtin ? digits : c, lookup: null, looking: gtin });
    setForm(EMPTY_FORM);
    if (!gtin) {
      // Código interno (não-GTIN): sem ficha a consultar — o nome é digitado.
      setFocusTarget('name');
      return;
    }

    const mySeq = ++lookupSeq.current;
    let lookup: EanLookupResult | null = null;
    try {
      lookup = await apiGet<EanLookupResult>(`/catalog/ean/${digits}`);
    } catch {
      // Resiliência (ADR-025): sem ficha não trava — o nome é digitado.
    }
    if (mySeq !== lookupSeq.current) return;

    // Cadastrado por outra pessoa depois que a tela abriu: busca e trata como existente.
    if (lookup?.existingProductId) {
      try {
        const p = await apiGet<SeqProduct>(`/products/${lookup.existingProductId}`);
        if (mySeq !== lookupSeq.current) return;
        setCatalog((cat) => (cat ? [...cat.filter((x) => x.id !== p.id), p] : cat));
        openExisting(p);
        return;
      } catch {
        // Segue como novo; a API recusa SKU duplicado se for o caso.
      }
    }

    const name = lookup?.catalog?.officialName?.trim() ?? '';
    setCurrent({ mode: 'new', code: digits, lookup, looking: false });
    setForm({ ...EMPTY_FORM, name, brand: lookup?.catalog?.brand?.trim() ?? '' });
    setFocusTarget(name ? 'price' : 'name');
  }

  async function submitNew(cur: Extract<Current, { mode: 'new' }>) {
    const name = form.name.trim();
    if (!name) {
      setError('Informe o nome do produto.');
      setFocusTarget('name');
      return;
    }
    if (form.price === '') {
      setError('Informe o preço de venda.');
      setFocusTarget('price');
      return;
    }
    if (Number(form.price) >= LOOKS_LIKE_BARCODE) {
      setError('Preço alto demais — parece um código de barras bipado no campo de preço.');
      setForm((f) => ({ ...f, price: '' }));
      setPriceKey((k) => k + 1);
      setFocusTarget('price');
      return;
    }
    const qty = parseQty(form.qty, unit);
    if (qty !== null && Number.isNaN(qty)) {
      setError('Quantidade inválida (um código de barras foi bipado no campo de quantidade?).');
      setFocusTarget('qty');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const gtin = isValidGtin(cur.code);
      const created = await apiPost<SeqProduct>('/products', {
        sku: cur.code.slice(0, 60),
        ean: gtin ? cur.code : undefined,
        name: name.slice(0, 150),
        manufacturer: form.brand.trim() ? form.brand.trim().slice(0, 120) : undefined,
        imageUrl: cur.lookup?.catalog?.imageUrl ?? undefined,
        unit,
        categoryId: categoryId || undefined,
        // Custo fica para depois: a Central de Alertas lista "produtos sem custo" para completar.
        costPrice: 0,
        salePrice: Number(form.price),
        initialStock: qty && qty > 0 ? qty : undefined,
      });
      setCatalog((cat) => (cat ? [...cat, created] : cat));
      savePrefs({ unit, categoryId });
      pushRecent({
        productId: created.id,
        name: created.name,
        summary: `Novo · ${BRL(created.salePrice)}${qty && qty > 0 ? ` · ${QTY(qty)} ${unitShort(unit)}` : ''}`,
        tone: 'new',
      });
      backToScan();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitExisting(product: SeqProduct) {
    if (Number(form.price) >= LOOKS_LIKE_BARCODE) {
      setError('Preço alto demais — parece um código de barras bipado no campo de preço.');
      setForm((f) => ({ ...f, price: String(Number(product.salePrice)) }));
      setPriceKey((k) => k + 1);
      setFocusTarget('price');
      return;
    }
    const priceChanged = form.price !== '' && Number(form.price) !== Number(product.salePrice);
    const qty = tracksStock(product) ? parseQty(form.qty, product.unit) : null;
    if (qty !== null && Number.isNaN(qty)) {
      setError('Quantidade inválida (um código de barras foi bipado no campo de quantidade?).');
      setFocusTarget('qty');
      return;
    }
    const plan = qty === null ? null : planOpeningCount({ stockQty: Number(product.stockQty), trackStock: product.trackStock }, qty);

    // Enter sem mudar nada = pular para o próximo bipe.
    if (!priceChanged && (!plan || plan.kind !== 'adjust')) {
      if (plan?.kind === 'same') {
        pushRecent({
          productId: product.id,
          name: product.name,
          summary: `Estoque já conferia (${QTY(qty!)} ${unitShort(product.unit)})`,
          tone: 'neutral',
        });
      }
      backToScan();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let next = product;
      const parts: string[] = [];
      if (priceChanged) {
        await apiPatch(`/products/${product.id}`, { salePrice: Number(form.price) });
        next = { ...next, salePrice: Number(form.price) };
        parts.push(`preço ${BRL(form.price)}`);
      }
      if (plan?.kind === 'adjust') {
        await apiPost('/stock/adjust', { productId: product.id, countedQty: qty, reason: OPENING_REASON });
        next = { ...next, stockQty: qty! };
        parts.push(`contagem ${QTY(qty!)} ${unitShort(product.unit)}`);
      }
      setCatalog((cat) => (cat ? cat.map((p) => (p.id === product.id ? next : p)) : cat));
      pushRecent({ productId: product.id, name: product.name, summary: `Atualizado · ${parts.join(' · ')}`, tone: 'count' });
      backToScan();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!current || busy) return;
    if (current.mode === 'new') void submitNew(current);
    else void submitExisting(current.product);
  }

  function onCorrect(entry: RecentEntry) {
    const p = catalog?.find((x) => x.id === entry.productId);
    if (!p) return;
    lookupSeq.current += 1; // abandona ficha pendente de um bipe em andamento
    openExisting(p, tracksStock(p) ? String(Number(p.stockQty)).replace('.', ',') : '');
  }

  const ready = online && catalog !== null;
  const unitOptions = visibleUnitTypes(construction, [unit]).filter(
    (u) => !(CLOSED_PRIMARY_UNITS as readonly string[]).includes(u),
  );
  const lookup = current?.mode === 'new' ? current.lookup : null;
  const photo =
    current?.mode === 'existing' ? current.product.imageUrl : (lookup?.catalog?.imageUrl ?? null);
  const curUnit = current?.mode === 'existing' ? current.product.unit : unit;
  const counting = current?.mode === 'existing' && tracksStock(current.product);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link href="/products" className="text-sm text-indigo-600 hover:underline">
            ← Produtos
          </Link>
          <h1 className="w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-2xl font-bold text-transparent">
            Cadastro em sequência
          </h1>
          <p className="text-sm text-gray-500">
            Bipe o produto, confira o nome, digite o preço e a quantidade e aperte Enter. O foco volta
            para o próximo bipe.
          </p>
        </div>
        {recent.length > 0 && (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
            {recent.length} {recent.length === 1 ? 'item' : 'itens'} nesta passada
          </span>
        )}
      </div>

      <OfflineNotice />

      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>Não foi possível carregar os produtos da loja: {loadError}</span>
          <button
            type="button"
            onClick={() => void loadCatalog()}
            className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1 font-medium hover:bg-red-100"
          >
            Tentar de novo
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:[grid-template-columns:minmax(0,1fr)_340px]">
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md">
          {/* Leitura: sempre o ponto de partida. Leitor USB digita + Enter; celular usa a câmera. */}
          <div className="bg-indigo-600 p-4">
            <label className="mb-1 block text-xs font-medium text-indigo-100" htmlFor="seq-scan">
              Código de barras
            </label>
            <div className="flex gap-2">
              <input
                id="seq-scan"
                ref={scanRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleScan(code);
                  }
                }}
                disabled={!ready || busy}
                inputMode="numeric"
                autoComplete="off"
                placeholder={catalog === null && !loadError ? 'Carregando produtos da loja…' : 'Bipe ou digite o código e Enter'}
                className="w-full rounded-lg border-0 px-3 py-3 text-lg tracking-wide text-gray-900 disabled:bg-indigo-100"
              />
              <BarcodeScanButton
                onScan={(c) => void handleScan(c)}
                label="Ler com a câmera"
                className="shrink-0 rounded-lg bg-white/15 px-3 text-white hover:bg-white/25"
              />
            </div>
          </div>

          {!current ? (
            <p className="p-6 text-center text-sm text-gray-500">
              Aguardando o próximo bipe. Produto já cadastrado? Só pedimos a quantidade da prateleira.
            </p>
          ) : (
            <form
              onSubmit={onSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  backToScan();
                }
              }}
              className="p-4"
            >
              <div className="mb-4 flex items-start gap-3">
                {photo ? (
                  // Hotlink da ficha (ADR-025): nunca baixada; link quebrado some.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo}
                    alt=""
                    className="h-20 w-20 shrink-0 rounded-lg border border-gray-200 bg-white object-contain"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  {current.mode === 'existing' ? (
                    <>
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        Já cadastrado
                      </span>
                      <p className="mt-1 truncate text-lg font-semibold text-gray-900">{current.product.name}</p>
                      <p className="text-sm text-gray-500">
                        Código {current.product.ean || current.product.sku}
                        {tracksStock(current.product)
                          ? ` · saldo atual ${QTY(Number(current.product.stockQty))} ${unitShort(current.product.unit)}`
                          : ' · não controla estoque'}
                      </p>
                    </>
                  ) : (
                    <>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Novo
                      </span>
                      <p className="mt-1 text-sm text-gray-500">
                        Código {current.code}
                        {current.looking
                          ? ' · consultando a ficha…'
                          : lookup?.found
                            ? ' · ficha encontrada'
                            : isValidGtin(current.code)
                              ? ' · sem ficha nas fontes gratuitas — digite o nome'
                              : ' · código interno — digite o nome'}
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {current.mode === 'new' && (
                  <>
                    <label className="flex flex-col gap-1 sm:col-span-2">
                      <span className="text-xs font-medium text-gray-600">Nome</span>
                      <input
                        ref={nameRef}
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        maxLength={150}
                        disabled={current.looking}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-gray-600">Marca (opcional)</span>
                      <input
                        value={form.brand}
                        onChange={(e) => setForm({ ...form, brand: e.target.value })}
                        maxLength={120}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-gray-600">Unidade</span>
                      <select
                        value={unit}
                        onChange={(e) => setUnit(e.target.value as UnitType)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                      >
                        {unitOptions.map((u) => (
                          <option key={u} value={u}>
                            {unitTypeLabels[u]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 sm:col-span-2">
                      <span className="text-xs font-medium text-gray-600">Categoria (opcional — fica lembrada)</span>
                      <select
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                      >
                        <option value="">— sem categoria —</option>
                        {categoryOptions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600">
                    Preço de venda{curUnit !== 'UNIT' ? ` (por ${unitShort(curUnit)})` : ''}
                  </span>
                  <MoneyInput
                    key={priceKey}
                    id="seq-price"
                    value={form.price}
                    onChange={(v) => setForm((f) => ({ ...f, price: v }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg"
                  />
                </label>
                {(current.mode === 'new' || counting) && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-600">
                      {current.mode === 'new'
                        ? `Quantidade na prateleira (${unitShort(curUnit)}, opcional)`
                        : `Quantidade contada (${unitShort(curUnit)})`}
                    </span>
                    <input
                      ref={qtyRef}
                      value={form.qty}
                      onChange={(e) => setForm({ ...form, qty: e.target.value.replace(/[^\d.,]/g, '') })}
                      inputMode="decimal"
                      placeholder={current.mode === 'existing' ? 'Vazio = não mexe no estoque' : '0'}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg"
                    />
                  </label>
                )}
              </div>

              {current.mode === 'existing' && !counting && (
                <p className="mt-3 text-xs text-gray-500">
                  Este produto não controla estoque (produção do dia/serviço) — só o preço pode ser ajustado aqui.
                </p>
              )}

              {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={busy || (current.mode === 'new' && current.looking)}
                  className="rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? 'Salvando…' : current.mode === 'new' ? 'Cadastrar e próximo (Enter)' : 'Salvar e próximo (Enter)'}
                </button>
                <button
                  type="button"
                  onClick={backToScan}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
                >
                  Pular
                </button>
                <span className="text-xs text-gray-400">Esc também pula</span>
              </div>
            </form>
          )}
        </div>

        {/* Últimos bipados: conferir e corrigir sem sair do fluxo. */}
        <aside className="h-fit overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md">
          <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-800">
            Últimos bipados
          </div>
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">Nada ainda nesta passada.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recent.slice(0, RECENT_SHOWN).map((r) => (
                <li key={r.key} className="flex items-center gap-2 px-4 py-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      r.tone === 'new' ? 'bg-emerald-500' : r.tone === 'count' ? 'bg-indigo-500' : 'bg-gray-300'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{r.name}</p>
                    <p className="truncate text-xs text-gray-500">{r.summary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCorrect(r)}
                    disabled={busy}
                    className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Corrigir
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
