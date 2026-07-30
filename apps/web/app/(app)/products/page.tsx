'use client';

import { useEffect, useRef, useState } from 'react';
import { createProductSchema, unitTypeLabels, type UnitType } from '@nexoloja/shared';
import { productMatchesQuery } from '@nexoloja/core';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';
import { BarcodeScanButton } from '@/components/BarcodeScanButton';
import { MoneyInput } from '@/components/MoneyInput';
import { ProductDetail, type CardFees, type ProductFull } from '@/components/ProductDetail';

/**
 * A lista usa o cadastro **completo** (`ProductFull`) porque a linha abre o painel de
 * visualizar/editar — assim o painel não precisa de um `GET /products/:id` extra
 * (cost-zero: uma requisição a menos por clique).
 */
type Product = ProductFull;

/** Página da busca (server search + keyset): linhas + cursor da próxima página. */
type ProductsPage = { rows: Product[]; nextCursor: string | null };

/** Quantos produtos por página / clique em "Mostrar mais". */
const PAGE_SIZE = 30;

/**
 * Monta a query da **tabela** (`GET /products/search`, busca no servidor + paginação). A tela de
 * gestão sempre inclui inativos (acinzentados). O catálogo do PDV segue em `GET /products` (array
 * cru), que NÃO usamos aqui para a listagem — só sob demanda para scan/par (ver `ensureCatalog`).
 */
function productsQuery(cursor: string | null, q: string): string {
  const p = new URLSearchParams({ includeInactive: 'true', limit: String(PAGE_SIZE) });
  if (q.trim()) p.set('q', q.trim());
  if (cursor) p.set('cursor', cursor);
  return `/products/search?${p.toString()}`;
}

/** Autoria (ADR-010): "por <nome> · <data>", ou "—" quando não há registro (dados antigos). */
const byLine = (name: string | null, iso?: string) =>
  name ? `${name}${iso ? ` · ${new Date(iso).toLocaleDateString('pt-BR')}` : ''}` : '—';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const QTY = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

/**
 * Campo do formulário com o **rótulo acima** do controle (não dentro, como placeholder).
 * Pedido do Owner: com o nome só no placeholder, ele sumia ao preencher e a pessoa se
 * perdia de qual campo estava. O `<label>` envolve o controle — clicar no texto foca o
 * campo (acessível, sem precisar de `id`). Para campos compostos (SKU + botão de escanear,
 * peso + kg/g) usamos um `<div>` com `<span>` no lugar, para não aninhar botão dentro de label.
 */
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}

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
    // Acréscimo por forma de pagamento (ADR-016). Vazios ⇒ preço único em todas as formas.
    surchargeDebit: '',
    surchargeCredit: '',
  });
  const [saving, setSaving] = useState(false);
  // Nome do produto usado como base pelo botão "Copiar" (mostra um aviso sobre o form).
  const [copiedFromName, setCopiedFromName] = useState<string | null>(null);

  // Busca NO SERVIDOR (nome/popular/fabricante/SKU): `search` é o campo; a query dispara com debounce.
  const [search, setSearch] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Catálogo COMPLETO — carregado sob demanda (lazy) só quando scan/par/detalhe precisa varrer tudo
  // (o par reverso do ADR-015 exige o catálogo inteiro). A tela abre sem baixá-lo. `null` = ainda não
  // carregado. `catalogPromise` dedup as chamadas concorrentes de `ensureCatalog`.
  const [catalog, setCatalog] = useState<Product[] | null>(null);
  const catalogPromise = useRef<Promise<Product[]> | null>(null);

  // Taxas da maquininha da loja (ADR-016) — só para o painel exibir a margem REAL por
  // modalidade. Nunca alteram preço; falha silenciosa (a margem simplesmente não desconta taxa).
  const [cardFees, setCardFees] = useState<CardFees | null>(null);

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

  /** Carrega a 1ª página da tabela para um termo (busca no servidor; substitui a lista). */
  async function loadListing(q: string = search) {
    const page = await apiGet<ProductsPage>(productsQuery(null, q));
    setProducts(page.rows);
    setNextCursor(page.nextCursor);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await apiGet<ProductsPage>(productsQuery(nextCursor, search));
      setProducts((prev) => [...prev, ...page.rows]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  /**
   * Garante o catálogo completo em memória (lazy). Usa o `GET /products?includeInactive=true`
   * existente (array cru). Dedup por `catalogPromise` para focos/cliques concorrentes não
   * dispararem várias buscas. Em falha, limpa a promise para permitir nova tentativa.
   */
  async function ensureCatalog(): Promise<Product[]> {
    if (catalog) return catalog;
    if (!catalogPromise.current) {
      catalogPromise.current = apiGet<Product[]>('/products?includeInactive=true')
        .then((all) => {
          setCatalog(all);
          return all;
        })
        .catch((e) => {
          catalogPromise.current = null;
          throw e;
        });
    }
    return catalogPromise.current;
  }

  /** Após criar/editar: recarrega a listagem e, se o catálogo já foi carregado, atualiza-o também. */
  async function reloadAll() {
    await loadListing();
    if (catalog || catalogPromise.current) {
      try {
        const all = await apiGet<Product[]>('/products?includeInactive=true');
        setCatalog(all);
        catalogPromise.current = Promise.resolve(all);
      } catch {
        /* mantém o catálogo anterior se a atualização falhar */
      }
    }
  }

  /** Abre o painel Ver/editar e garante o catálogo (o par reverso do ADR-015 varre todos os produtos). */
  function openDetail(id: string) {
    setDetailId(id);
    void ensureCatalog().catch(() => {});
  }

  // Busca no servidor com debounce (300 ms): recarrega a 1ª página a cada termo, sem baixar a base
  // inteira. Roda também na montagem (termo vazio = primeiros PAGE_SIZE em ordem alfabética).
  useEffect(() => {
    const t = setTimeout(() => {
      loadListing(search).catch((e) => setError((e as Error).message));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    // As taxas da maquininha (ADR-016) vêm do Prisma como `Decimal` → JSON as **string**
    // (ex.: "3.50"), igual a costPrice/salePrice. O core (`cardFeePercentFor`) faz `.toFixed`,
    // que só existe em `number` — então convertemos aqui, exatamente como a tela de Nova Venda
    // já faz. Sem isso, abrir o painel de um produto com taxa cadastrada quebrava a tela inteira
    // (`"3.50".toFixed is not a function` → fronteira de erro).
    apiGet<{
      cardFeeDebitPercent: number | string | null;
      cardFeeCreditPercent: number | string | null;
    }>('/tenant')
      .then((s) =>
        setCardFees({
          cardFeeDebitPercent:
            s.cardFeeDebitPercent == null ? null : Number(s.cardFeeDebitPercent),
          cardFeeCreditPercent:
            s.cardFeeCreditPercent == null ? null : Number(s.cardFeeCreditPercent),
        }),
      )
      .catch(() => setCardFees(null));
  }, []);

  // Remove o destaque da linha escaneada depois de alguns segundos.
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 2500);
    return () => clearTimeout(t);
  }, [highlightId]);

  // Rola até a linha destacada QUANDO ela aparece na listagem. Como o scan agora recarrega a
  // tabela pelo servidor (assíncrono), a linha não existe no DOM na hora do scan — este efeito
  // dispara de novo a cada atualização de `products` e rola assim que a linha entra.
  useEffect(() => {
    if (!highlightId) return;
    document.getElementById(`prod-row-${highlightId}`)?.scrollIntoView({ block: 'center' });
  }, [highlightId, products]);

  // ADR-017: unidade fechada (barra/rolo) como principal — muda a apresentação do cadastro
  // (tamanho + preço da barra + preço por metro opcional) e a conversão da entrada em barras.
  const isClosedUnit = form.unit === 'BARRA' || form.unit === 'ROLL';
  // Artigo correto por unidade fechada (evita "Preço da Rolo"): rolo é masculino, barra feminino.
  const unitArticle = form.unit === 'ROLL' ? 'do rolo' : 'da barra';

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
      // ADR-017: p/ unidade fechada (barra/rolo) o estoque inicial é digitado em BARRAS e vira
      // metros (× tamanho), pois o ledger é em metros.
      initialStock: form.initialStock
        ? isClosedUnit && Number(form.conversionFactor) > 0
          ? Number(form.initialStock) * Number(form.conversionFactor)
          : Number(form.initialStock)
        : undefined,
      // Unidade alternativa (EF-3): só envia se preenchido; os 3 juntos habilitam o modo no PDV.
      // ADR-017: na unidade fechada, altUnit é fixo em METER (a régua fina) e o preço por metro
      // (opcional) mora em altSalePrice; conversionFactor é o tamanho da barra em metros.
      altUnit: isClosedUnit ? 'METER' : form.altUnit || undefined,
      conversionFactor: form.conversionFactor ? Number(form.conversionFactor) : undefined,
      altSalePrice: form.altSalePrice ? Number(form.altSalePrice) : undefined,
      // Par (ADR-015): só vale com os dois preenchidos; sem produto agregado o preço é ignorado.
      pairedProductId: form.pairedProductId || undefined,
      pairPrice:
        form.pairedProductId && form.pairPrice ? Number(form.pairPrice) : undefined,
      // Acréscimo por pagamento (ADR-016): opt-in — vazio não vira coluna, o produto
      // simplesmente não muda de preço no cartão.
      surchargeDebit: form.surchargeDebit ? Number(form.surchargeDebit) : undefined,
      surchargeCredit: form.surchargeCredit ? Number(form.surchargeCredit) : undefined,
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
        surchargeDebit: '',
        surchargeCredit: '',
      });
      setCopiedFromName(null);
      await reloadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Processa um código lido (Enter do leitor físico OU câmera). O SKU é o código de barras.
   * Como a listagem agora é paginada no servidor, a decisão (achou/não achou) é feita sobre o
   * **catálogo completo** (lazy) — não sobre a página visível — para não classificar como "código
   * novo" um produto que só não está na página atual:
   * - achou 1 → põe o código na busca (o servidor traz a linha) e a destaca (o efeito de scroll rola até ela);
   * - não achou nada → é um código novo: joga no campo SKU do cadastro e foca em Nome;
   * - vários → só filtra a lista pelo código, para o operador escolher.
   */
  async function handleScannedCode(raw: string) {
    const code = raw.trim();
    if (!code) return;
    let all: Product[];
    try {
      all = await ensureCatalog();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const matches = all.filter((p) => productMatchesQuery(p, code));
    const found = matches.length === 1 ? matches[0] : undefined;
    if (found) {
      setSearch(code); // servidor traz a linha; o efeito de highlight rola até ela quando aparecer
      setHighlightId(found.id);
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

  /**
   * "Copiar": usa um produto como base para um novo cadastro — preenche o formulário com os
   * dados dele, mas **zera o que tem de ser único/deliberado**: SKU (código de barras é único),
   * estoque inicial (não duplica a Entrada) e o par (ADR-015 — configuração por produto). O
   * operador então ajusta o nome/SKU e adiciona.
   */
  function copyFrom(p: Product) {
    setForm({
      name: p.name,
      popularName: p.popularName ?? '',
      manufacturer: p.manufacturer ?? '',
      sku: '',
      description: p.description ?? '',
      unit: p.unit,
      costPrice: String(Number(p.costPrice)),
      salePrice: String(Number(p.salePrice)),
      weight: p.weightKg === null ? '' : String(Number(p.weightKg)),
      weightUnit: 'kg',
      minStockQty: String(Number(p.minStockQty)),
      initialStock: '',
      altUnit: p.altUnit ?? '',
      conversionFactor: p.conversionFactor === null ? '' : String(Number(p.conversionFactor)),
      altSalePrice: p.altSalePrice === null ? '' : String(Number(p.altSalePrice)),
      pairedProductId: '',
      pairPrice: '',
      surchargeDebit: p.surchargeDebit === null ? '' : String(Number(p.surchargeDebit)),
      surchargeCredit: p.surchargeCredit === null ? '' : String(Number(p.surchargeCredit)),
    });
    setCopiedFromName(p.name);
    setDetailId(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    requestAnimationFrame(() => nameRef.current?.focus());
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
      await reloadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingMinId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-2xl font-bold">Produtos</h1>

      {/* Tela online-only (ADR-012 (c)): offline mostra o aviso de rede, não o erro cru. */}
      <OfflineNotice />

      <form
        onSubmit={onCreate}
        className="mb-6 grid grid-cols-1 gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-6"
      >
        {copiedFromName && (
          <div className="flex items-start justify-between gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 sm:col-span-6">
            <span>
              Copiado de <strong>{copiedFromName}</strong> como base. Defina um <strong>SKU</strong>{' '}
              novo (código de barras é único) e ajuste o que precisar. Estoque inicial e par não são
              copiados.
            </span>
            <button
              type="button"
              onClick={() => setCopiedFromName(null)}
              className="shrink-0 text-blue-400 hover:text-blue-700"
              aria-label="Dispensar aviso"
            >
              ✕
            </button>
          </div>
        )}
        <Field label="Nome" className="sm:col-span-2">
          <input
            ref={nameRef}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </Field>
        <Field label="Nome popular (opcional)" className="sm:col-span-2">
          <input
            value={form.popularName}
            onChange={(e) => setForm({ ...form, popularName: e.target.value })}
            title="Nome popular/regional pelo qual o produto também é buscado no PDV. Ex.: 'Ferro 8' para 'Vergalhão CA-50 8mm'."
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </Field>
        <Field label="Fabricante (opcional)" className="sm:col-span-2">
          <input
            value={form.manufacturer}
            onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
            maxLength={120}
            title="Fabricante/marca do produto (ex.: Votorantim, Tigre). Também é usado na busca."
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </Field>
        {/* Composto (input + botão de escanear): usa div/span p/ não aninhar botão em <label>. */}
        <div className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-medium text-gray-600">SKU / código de barras</span>
          <div className="flex gap-2">
            <input
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
            <BarcodeScanButton
              onScan={(code) => setForm((f) => ({ ...f, sku: code.trim() }))}
              label="Escanear código de barras para o SKU"
            />
          </div>
        </div>
        <Field label={isClosedUnit ? `Custo ${unitArticle}` : 'Custo'}>
          <MoneyInput
            value={form.costPrice}
            onChange={(v) => setForm({ ...form, costPrice: v })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </Field>
        <Field label={isClosedUnit ? `Preço ${unitArticle}` : 'Preço de venda'}>
          <MoneyInput
            value={form.salePrice}
            onChange={(v) => setForm({ ...form, salePrice: v })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </Field>
        {/* Unidade de venda (UnitType) — como o produto é vendido/medido. */}
        <Field label="Unidade de venda" className="sm:col-span-2">
          <select
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value as UnitType })}
            title="Unidade de venda do produto (ex.: saco de cimento, milheiro de tijolo, metro de fio)."
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
            aria-label="Unidade de venda"
          >
            {(Object.keys(unitTypeLabels) as UnitType[]).map((u) => (
              <option key={u} value={u}>
                {unitTypeLabels[u]}
              </option>
            ))}
          </select>
        </Field>
        {/* Peso: digita em kg ou g; guardamos canônico em kg (banco). Opcional. */}
        <div className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-medium text-gray-600">Peso (opcional)</span>
          <div className="flex gap-2">
            <input
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
        </div>
        <Field label="Estoque mínimo">
          <input
            type="number"
            step="1"
            min="0"
            value={form.minStockQty}
            onChange={(e) => setForm({ ...form, minStockQty: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </Field>
        <Field
          label={isClosedUnit ? 'Estoque inicial (barras)' : 'Estoque inicial (opcional)'}
          className="sm:col-span-2"
        >
          <input
            type="number"
            step="any"
            min="0"
            value={form.initialStock}
            onChange={(e) => setForm({ ...form, initialStock: e.target.value })}
            title={
              isClosedUnit
                ? 'Quantas barras/rolos inteiros entram no cadastro. Convertido para metros pelo tamanho (ex.: 10 barras × 6 m = 60 m).'
                : "Se preenchido, gera uma Entrada de estoque no cadastro (aparece no Estoque como 'Estoque inicial'). Deixe vazio para o produto nascer com 0."
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </Field>
        {/* Descrição/observação (opcional, até 500 caracteres). */}
        <Field label="Descrição / observação (opcional)" className="sm:col-span-4">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={500}
            rows={2}
            title="Detalhes ou observações do produto (opcional). Ex.: marca, especificação técnica, cor."
            className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2"
          />
        </Field>
        {/* ADR-017: barra/rolo como principal — tamanho da barra + preço por metro (opcional). */}
        {isClosedUnit && (
          <fieldset className="rounded-xl border border-dashed border-indigo-300 bg-indigo-50/40 p-3 sm:col-span-6">
            <legend className="px-1 text-xs font-medium text-indigo-700">
              {unitTypeLabels[form.unit]} — tamanho e venda por metro
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                placeholder={`Tamanho: 1 ${unitTypeLabels[form.unit]} = ? metros`}
                type="number"
                step="any"
                min="0"
                value={form.conversionFactor}
                onChange={(e) => setForm({ ...form, conversionFactor: e.target.value })}
                title="Comprimento de 1 barra/rolo em metros (ex.: barra de 6 m → 6). O estoque é contado em metros."
                className="rounded-lg border border-gray-300 px-3 py-2"
              />
              <MoneyInput
                placeholder="Preço por metro (opcional)"
                value={form.altSalePrice}
                onChange={(v) => setForm({ ...form, altSalePrice: v })}
                title="Preço do corte avulso por metro. Deixe vazio para vender só a barra/rolo inteiro."
                className="rounded-lg border border-gray-300 px-3 py-2"
              />
            </div>
            <p className="mt-2 text-xs text-gray-600">
              Custo e preço acima são da <strong>{unitTypeLabels[form.unit]} inteira</strong>. O
              estoque é contado em metros e mostrado como barras + sobra. Preço por metro vazio ⇒
              só vende inteiro.
            </p>
          </fieldset>
        )}
        {/* Venda em unidade alternativa (EF-3, ADR-013): embalagem fechada com preço próprio. */}
        {!isClosedUnit && (
        <fieldset className="rounded-xl border border-dashed border-gray-300 p-3 sm:col-span-6">
          <legend className="px-1 text-xs font-medium text-gray-600">
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
            <MoneyInput
              placeholder="Preço da embalagem fechada"
              value={form.altSalePrice}
              onChange={(v) => setForm({ ...form, altSalePrice: v })}
              title="Preço próprio de 1 embalagem fechada (costuma sair mais barato por unidade-base que o avulso)."
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Preencha os três para habilitar a escolha “{unitTypeLabels[form.unit]} × embalagem” no PDV.
          </p>
        </fieldset>
        )}
        {/* Produto agregado — venda em par (ADR-015). Ex.: parafuso nº10 + bucha nº10. */}
        <fieldset className="rounded-xl border border-dashed border-gray-300 p-3 sm:col-span-6">
          <legend className="px-1 text-xs font-medium text-gray-600">
            Vendido em par (opcional) — ex.: parafuso + bucha, com preço do par
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select
              value={form.pairedProductId}
              onChange={(e) => setForm({ ...form, pairedProductId: e.target.value })}
              // Catálogo completo é lazy: carrega ao focar (o par é recurso pontual, não custa na abertura).
              onFocus={() => void ensureCatalog().catch(() => {})}
              title="O outro produto do par. Cada um segue com seu preço e estoque próprios."
              className="rounded-lg border border-gray-300 bg-white px-3 py-2"
              aria-label="Produto agregado"
            >
              <option value="">
                {catalog === null ? '— carregando catálogo… —' : '— sem produto agregado —'}
              </option>
              {(catalog ?? [])
                .filter((p) => p.isActive)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({BRL(p.salePrice)})
                  </option>
                ))}
            </select>
            <MoneyInput
              placeholder="Preço do par (os dois juntos)"
              value={form.pairPrice}
              onChange={(v) => setForm({ ...form, pairPrice: v })}
              disabled={form.pairedProductId === ''}
              title="Preço total dos dois itens vendidos juntos (ex.: R$ 0,70 o par)."
              className="rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-50"
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            No PDV o operador escolhe vender avulso ou o par. Vale para os dois lados — não
            precisa cadastrar de novo no outro produto.
          </p>
        </fieldset>
        {/* Acréscimo por forma de pagamento (ADR-016). Opt-in: só sobe o preço de quem for
            preenchido aqui — nunca é derivado da taxa da maquininha da loja. */}
        <fieldset className="rounded-xl border border-dashed border-gray-300 p-3 sm:col-span-6">
          <legend className="px-1 text-xs font-medium text-gray-600">
            Acréscimo por forma de pagamento (opcional) — quanto o preço SOBE no cartão
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MoneyInput
              placeholder="Acréscimo no débito (R$)"
              value={form.surchargeDebit}
              onChange={(v) => setForm({ ...form, surchargeDebit: v })}
              title="Quanto SOMAR ao preço quando a venda for no débito. Não é o preço final nem um custo."
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
            <MoneyInput
              placeholder="Acréscimo no crédito (R$)"
              value={form.surchargeCredit}
              onChange={(v) => setForm({ ...form, surchargeCredit: v })}
              title="Quanto SOMAR ao preço quando a venda for no crédito. Não é o preço final nem um custo."
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          {/* Prévia do preço resultante — evita a confusão "digitei o preço final?". */}
          {Number(form.salePrice) > 0 &&
          (Number(form.surchargeDebit) > 0 || Number(form.surchargeCredit) > 0) ? (
            <p className="mt-2 text-xs text-gray-600">
              Preço à vista {BRL(form.salePrice)} · no débito{' '}
              <strong>{BRL(Number(form.salePrice) + (Number(form.surchargeDebit) || 0))}</strong> ·
              no crédito{' '}
              <strong>{BRL(Number(form.salePrice) + (Number(form.surchargeCredit) || 0))}</strong>
            </p>
          ) : (
            <p className="mt-2 text-xs text-gray-500">
              Deixe vazio para cobrar o mesmo preço em qualquer forma de pagamento. Dinheiro e PIX
              nunca têm acréscimo.
            </p>
          )}
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
          <thead className="bg-blue-200 text-left text-blue-900">
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
            {products.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-gray-500">
                  {search.trim()
                    ? 'Nenhum produto encontrado para a busca.'
                    : 'Nenhum produto cadastrado.'}
                </td>
              </tr>
            ) : (
              products.map((p) => {
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
                    } ${!p.isActive ? 'bg-gray-50' : ''}`}
                  >
                    <td className="px-4 py-2">
                      {/* Nome clicável: abre o cadastro completo (visualizar/editar). */}
                      <button
                        type="button"
                        onClick={() => openDetail(p.id)}
                        className={`text-left font-medium hover:text-blue-700 hover:underline ${
                          p.isActive ? 'text-gray-900' : 'text-gray-500'
                        }`}
                        title="Ver / editar o cadastro deste produto"
                      >
                        {p.name}
                      </button>
                      {!p.isActive && (
                        <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-medium text-amber-700">
                          Inativo
                        </span>
                      )}
                      {p.popularName && (
                        <span className="block text-xs text-gray-500">{p.popularName}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{p.manufacturer ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{p.sku}</td>
                    <td className="px-4 py-2 text-right">{BRL(p.costPrice)}</td>
                    <td className="px-4 py-2 text-right">{BRL(p.salePrice)}</td>
                    <td className="px-4 py-2 text-right">{p.marginPercent}%</td>
                    <td className="px-4 py-2 text-xs text-gray-600">
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
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => copyFrom(p)}
                          className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          title="Usar como base para um novo produto (não copia SKU, estoque inicial nem par)"
                        >
                          Copiar
                        </button>
                        <button
                          type="button"
                          onClick={() => openDetail(p.id)}
                          className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Ver / editar
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

      {/* Paginação keyset: só aparece quando o servidor sinaliza mais páginas. */}
      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
          >
            {loadingMore ? 'Carregando…' : 'Mostrar mais'}
          </button>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-500">
        Clique no nome do produto para ver o cadastro completo e editar. Estoque mínimo é o
        ponto de reposição — quando o saldo fica igual ou abaixo dele (e maior que zero), o
        produto aparece como “baixo” na tela de Estoque.
      </p>

      {/* Painel de visualizar/editar o cadastro (fatia EP). `allProducts` = catálogo lazy (par ADR-015). */}
      {detail && (
        <ProductDetail
          product={detail}
          allProducts={catalog ?? []}
          cardFees={cardFees}
          onClose={() => setDetailId(null)}
          onSaved={reloadAll}
        />
      )}
    </div>
  );
}
