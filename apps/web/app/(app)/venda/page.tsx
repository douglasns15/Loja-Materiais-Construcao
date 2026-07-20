'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  PAYMENT_METHOD_LABELS,
  buildSaleMutation,
  createSaleSchema,
  unitTypeLabels,
  type PaymentMethod,
  type SaleUnitMode,
  type UnitType,
} from '@nexoloja/shared';
import {
  calcMarginPercent,
  calcSaleTotals,
  hasAltUnit,
  hasPair,
  pairAvailableQty,
  productMatchesQuery,
  resolveSaleUnit,
  splitPairLine,
} from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { cacheCashSession, readCachedCashSession } from '@/lib/cashSessionCache';
import { cacheProducts, readCachedProducts } from '@/lib/catalog';
import { enqueueMutation } from '@/lib/outbox';
import { useOutboxSyncContext } from '@/lib/outboxSync';
import { useMe } from '@/lib/useMe';
import { useOnline } from '@/lib/useOnline';
import { ReceiptPrint, type Store } from '@/components/ReceiptPrint';
import { StoreDisabledNotice } from '@/components/StoreDisabledNotice';
import { OfflineSalesNotice } from '@/components/OfflineSalesNotice';
import { BarcodeScanButton } from '@/components/BarcodeScanButton';

type Product = {
  id: string;
  name: string;
  popularName: string | null;
  /** Fabricante/marca — também entra na busca do PDV (ex.: digitar "Votoran"). */
  manufacturer: string | null;
  sku: string;
  salePrice: string;
  costPrice: string;
  stockQty: string;
  unit: UnitType;
  // Venda em unidade alternativa (EF-3, ADR-013). Nulos ⇒ produto de uma unidade só.
  altUnit: UnitType | null;
  altSalePrice: string | null;
  conversionFactor: string | null;
  // Produto agregado — venda em par (ADR-015). Nulos ⇒ produto sem par.
  pairedProductId: string | null;
  pairPrice: string | null;
};
type CartItem = {
  /** Chave única da linha = `productId:saleMode` (o mesmo produto pode ir como metro E como rolo). */
  key: string;
  productId: string;
  name: string;
  unitPrice: number;
  costPrice: number;
  quantity: number;
  /** Estoque disponível em UNIDADE-BASE (metros), como vem do catálogo. */
  stockQty: number;
  // EF-3: modo de venda, unidade vendida, unidade-base e fator de conversão (BASE = 1).
  saleMode: SaleUnitMode;
  unitType: UnitType;
  baseUnitType: UnitType;
  conversionFactor: number;
  /**
   * Venda em par (ADR-015). Presente ⇒ esta linha é **um par**: no carrinho e no comprovante
   * aparece como UMA linha ("Parafuso + Bucha nº10") com `unitPrice` = preço do par, mas na
   * hora de enviar é **expandida em dois itens** com os preços rateados e o mesmo `pairGroup`
   * (é o que mantém estoque, cancelamento e devolução funcionando item a item).
   */
  pair?: {
    partnerId: string;
    partnerName: string;
    /**
     * Preços **avulsos** dos dois lados — a base do rateio. Guardamos os avulsos (e não o
     * resultado do rateio) porque o rateio depende da QUANTIDADE da linha: é feito sobre o
     * total (`splitPairLine`) na hora de montar o pedido, senão o arredondamento por linha
     * do servidor faz 5 pares de R$0,70 custarem R$3,51.
     */
    mainSalePrice: number;
    partnerSalePrice: number;
    partnerStockQty: number;
  };
};

/** Rótulo curto de uma unidade (sem o parêntese): "Metro (m)" → "Metro"; "Rolo" → "Rolo". */
const unitShort = (u: UnitType) => unitTypeLabels[u].replace(/\s*\(.*\)$/, '');
type View =
  | { kind: 'review' }
  | {
      kind: 'done';
      total: number;
      discount: number;
      change: number;
      method: PaymentMethod;
      items: CartItem[];
      date: string;
      /** `true` quando a venda foi salva na fila offline (pendente de sincronização), ADR-011. */
      pending?: boolean;
    }
  | { kind: 'quote'; total: number; discount: number; items: CartItem[]; date: string };

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Lista de itens + subtotal/desconto/total (reusado em revisão, venda e orçamento). */
function Summary({ items, total, discount }: { items: CartItem[]; total: number; discount: number }) {
  const subtotal = items.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0);
  return (
    <>
      <ul className="divide-y divide-gray-100 text-sm">
        {items.map((i) => (
          <li key={i.key} className="flex justify-between py-1">
            <span>
              {i.quantity}
              {i.pair ? ` par${i.quantity > 1 ? 'es' : ''} ` : ''}
              {!i.pair && (i.saleMode === 'ALT' ? ` ${unitShort(i.unitType)} ` : '× ')}
              {i.name}
              {i.saleMode === 'ALT' && !i.pair && (
                <span className="text-gray-400">
                  {' '}
                  (≈ {i.quantity * i.conversionFactor} {unitShort(i.baseUnitType)})
                </span>
              )}
            </span>
            <span>{BRL(i.unitPrice * i.quantity)}</span>
          </li>
        ))}
      </ul>
      {discount > 0 && (
        <div className="space-y-1 border-t border-gray-200 pt-2 text-sm text-gray-500">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{BRL(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Desconto</span>
            <span>− {BRL(discount)}</span>
          </div>
        </div>
      )}
      <div className={`flex justify-between font-medium ${discount > 0 ? '' : 'border-t border-gray-200 pt-2'}`}>
        <span>Total</span>
        <span>{BRL(total)}</span>
      </div>
    </>
  );
}

export default function VendaPage() {
  const { me, offlineSales } = useMe();
  const online = useOnline();
  const { pending, syncing, syncNow } = useOutboxSyncContext();
  const [ready, setReady] = useState(false);
  const [caixaOpen, setCaixaOpen] = useState(false);
  // Caixa aberto no momento (guardado para carimbar a venda offline — ADR-011 §5).
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Horário do snapshot do caixa quando o estado veio do cache offline (ADR-012 CS-1, decisão (a));
  // `null` = leitura fresca da rede. Alimenta o rótulo "dados de HH:MM".
  const [cachedSessionAt, setCachedSessionAt] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selected, setSelected] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [qty, setQty] = useState('1');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [received, setReceived] = useState('');
  const [discount, setDiscount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [printModel, setPrintModel] = useState<'80mm' | 'A4'>('80mm');

  async function loadProducts() {
    const list = await apiGet<Product[]>('/products');
    setProducts(list);
    // Rede venceu (ADR-012 CS-2): espelha o catálogo p/ o cold-start offline (best-effort).
    void cacheProducts(list);
  }

  useEffect(() => {
    (async () => {
      try {
        apiGet<Store>('/tenant').then(setStore).catch(() => {});
        const session = await apiGet<{
          id: string;
          openedAt: string;
          openingAmount: string;
          openedByName: string | null;
        } | null>('/cash-sessions/current');
        // Rede venceu (ADR-012 (a)): sobrescreve/limpa o cache do caixa e opera com dado fresco.
        cacheCashSession(session);
        setCaixaOpen(!!session);
        setSessionId(session?.id ?? null);
        setCachedSessionAt(null);
        if (session) await loadProducts();
      } catch (e) {
        // Offline (cold-start): sem a API, recupera o último caixa aberto conhecido e o catálogo em
        // cache para o PDV seguir vendável após remontar/reabrir (achados 3.E.2 / ADR-012 CS-1+CS-2).
        const cached = readCachedCashSession();
        if (cached) {
          setCaixaOpen(true);
          setSessionId(cached.id);
          setCachedSessionAt(cached.cachedAt);
          setProducts(await readCachedProducts());
        } else {
          setError((e as Error).message);
        }
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

  const discountValue = Math.max(0, Number(discount) || 0);
  /**
   * Total do carrinho calculado sobre **exatamente os itens que serão enviados** (pares já
   * expandidos em dois, com o preço rateado), usando a mesma função do servidor. Antes o total
   * era somado sobre as linhas do carrinho, e o par — uma linha na tela, dois itens no envio —
   * podia divergir do servidor por centavos ("Pagamento insuficiente: total 3.51, pago 3.50",
   * achado no E2E de 2026-07-20). Somando o que se envia, front e servidor não têm como discordar.
   */
  const totals = useMemo(
    () =>
      calcSaleTotals(
        cartToSaleItems().map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice })),
        { discountAmount: discountValue },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart, discountValue],
  );
  const discountTooHigh = discountValue > totals.subtotal;
  const change = method === 'CASH' && received ? Number(received) - totals.total : 0;

  // Busca do PDV: filtra por nome, nome popular, fabricante ou SKU (função pura de packages/core).
  const filteredProducts = useMemo(
    () => products.filter((p) => productMatchesQuery(p, productSearch)),
    [products, productSearch],
  );

  /** Config de unidade alternativa (EF-3) de um produto, no formato do core. */
  function altConfig(p: Product) {
    return {
      salePrice: Number(p.salePrice),
      altUnit: p.altUnit,
      altSalePrice: p.altSalePrice != null ? Number(p.altSalePrice) : null,
      conversionFactor: p.conversionFactor != null ? Number(p.conversionFactor) : null,
    };
  }

  /**
   * Resolve o par de um produto (ADR-015). O par vale dos **dois lados**: ou o produto aponta
   * para o agregado (`pairedProductId`), ou outro produto aponta para ele. Devolve o parceiro e
   * o preço do par, ou `null` se não há par vendável (sem cadastro, ou o parceiro sumiu do
   * catálogo por soft-delete). O par é sempre na unidade-base — não se combina com embalagem (EF-3).
   */
  function resolvePair(p: Product): { partner: Product; pairPrice: number } | null {
    if (hasPair({ pairedProductId: p.pairedProductId, pairPrice: Number(p.pairPrice) })) {
      const partner = products.find((x) => x.id === p.pairedProductId);
      if (partner) return { partner, pairPrice: Number(p.pairPrice) };
    }
    // Lado reverso: quem aponta para este produto (cadastrado no outro, vale igual).
    const owner = products.find(
      (x) =>
        x.pairedProductId === p.id &&
        hasPair({ pairedProductId: x.pairedProductId, pairPrice: Number(x.pairPrice) }),
    );
    return owner ? { partner: owner, pairPrice: Number(owner.pairPrice) } : null;
  }

  /**
   * Quanto do estoque (em unidade-base) de um produto já está comprometido pelo carrinho,
   * ignorando a linha `exceptKey`. Conta as três formas de o produto aparecer: linha avulsa
   * (com o fator da embalagem), lado principal de um par e lado agregado de um par — cada par
   * consome 1 de cada lado. Sem isso, misturar avulso e par estouraria o estoque real.
   */
  function baseUsedByProduct(productId: string, exceptKey?: string): number {
    return cart
      .filter((c) => c.key !== exceptKey)
      .reduce((acc, c) => {
        if (c.pair) {
          const consumes = c.productId === productId || c.pair.partnerId === productId;
          return acc + (consumes ? c.quantity : 0);
        }
        return acc + (c.productId === productId ? c.quantity * c.conversionFactor : 0);
      }, 0);
  }

  /**
   * Expande o carrinho no formato do payload da venda. **Cada par vira DOIS itens** com os
   * preços já rateados e o mesmo `pairGroup` (numerado por venda) — o servidor grava dois
   * `OrderItem`, então estoque, cancelamento e devolução seguem funcionando item a item.
   */
  function cartToSaleItems() {
    let group = 0;
    return cart.flatMap((c) => {
      if (!c.pair) {
        return [
          {
            productId: c.productId,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
            saleMode: c.saleMode, // EF-3: o servidor converte a baixa p/ unidade-base
          },
        ];
      }
      group += 1;
      // Rateio sobre o TOTAL da linha (não por unidade): o servidor arredonda cada linha a 2
      // casas, então ratear por unidade fazia os dois arredondamentos subirem juntos.
      const split = splitPairLine(
        { salePrice: c.pair.mainSalePrice, stockQty: 0 },
        { salePrice: c.pair.partnerSalePrice, stockQty: 0 },
        c.unitPrice, // preço do par
        c.quantity,
      );
      return [
        {
          productId: c.productId,
          quantity: c.quantity,
          unitPrice: split.mainUnitPrice,
          saleMode: 'BASE' as SaleUnitMode,
          pairGroup: group,
        },
        {
          productId: c.pair.partnerId,
          quantity: c.quantity,
          unitPrice: split.pairedUnitPrice,
          saleMode: 'BASE' as SaleUnitMode,
          pairGroup: group,
        },
      ];
    });
  }

  /** Tooltip por item: margem de lucro e desconto máximo possível (até o custo). No modo embalagem
   *  (EF-3), a margem usa o preço efetivo POR UNIDADE-BASE (preço do rolo ÷ fator), comparável ao custo. */
  function itemTooltip(i: CartItem): string {
    // Par (ADR-015): preço e custo da linha já são a soma dos dois lados, então a margem
    // do par sai direto (é a margem do conjunto, que é o que interessa ao operador).
    if (i.pair) {
      const margin = calcMarginPercent(i.costPrice, i.unitPrice);
      return `Par: ${i.name} • Margem do par: ${margin}%`;
    }
    const effUnit = i.conversionFactor > 0 ? i.unitPrice / i.conversionFactor : i.unitPrice;
    const margin = calcMarginPercent(i.costPrice, effUnit);
    const maxDisc = Math.max(0, Number((i.unitPrice - i.costPrice * i.conversionFactor).toFixed(2)));
    return maxDisc > 0
      ? `Margem: ${margin}% • Desconto possível: até ${BRL(maxDisc)}/un`
      : `Margem: ${margin}% • Sem margem para desconto`;
  }

  // `productId` padrão = seleção do dropdown; o scanner/Enter passa o id do único match da busca.
  // `mode` (EF-3): 'ALT' vende a embalagem fechada (rolo); default 'BASE' = venda de sempre.
  function addToCart(productId: string = selected, mode: SaleUnitMode = 'BASE') {
    setError(null);
    const p = products.find((x) => x.id === productId);
    const q = Number(qty);
    if (!p || !(q > 0)) {
      setError('Selecione um produto e uma quantidade válida.');
      return;
    }
    const cfg = altConfig(p);
    const useAlt = mode === 'ALT' && hasAltUnit(cfg);
    const effMode: SaleUnitMode = useAlt ? 'ALT' : 'BASE';
    const { unitPrice, factorToBase } = resolveSaleUnit(cfg, effMode);
    const unitType = useAlt ? (p.altUnit as UnitType) : p.unit;

    const stock = Number(p.stockQty);
    const key = `${p.id}:${effMode}`;
    const existing = cart.find((c) => c.key === key);
    const newQty = (existing?.quantity ?? 0) + q;
    // Trava de estoque em UNIDADE-BASE: soma a base já consumida por OUTRAS linhas do mesmo
    // produto — inclusive as linhas de PAR, que também consomem este produto (ADR-015) — mais
    // a base desta linha (EF-3).
    const otherBase = baseUsedByProduct(p.id, key);
    if (otherBase + newQty * factorToBase > stock) {
      setError(`Estoque insuficiente para "${p.name}" (disponível: ${stock}).`);
      return;
    }
    if (existing) {
      setCart(cart.map((c) => (c.key === key ? { ...c, quantity: newQty } : c)));
    } else {
      setCart([
        ...cart,
        {
          key,
          productId: p.id,
          name: p.name,
          unitPrice,
          costPrice: Number(p.costPrice),
          quantity: q,
          stockQty: stock,
          saleMode: effMode,
          unitType,
          baseUnitType: p.unit,
          conversionFactor: factorToBase,
        },
      ]);
    }
    setSelected('');
    setQty('1');
    // Limpa a busca para o próximo item/leitura de código começar do zero.
    setProductSearch('');
  }

  /**
   * Adiciona o **par** ao carrinho (ADR-015): uma linha só, com o preço do par, que na hora de
   * enviar vira dois itens. O preço de cada lado sai do rateio puro do core (`splitPairPrice`),
   * e a trava exige estoque **dos dois** produtos — o par consome 1 de cada.
   */
  function addPairToCart(productId: string = selected) {
    setError(null);
    const p = products.find((x) => x.id === productId);
    const q = Number(qty);
    if (!p || !(q > 0)) {
      setError('Selecione um produto e uma quantidade válida.');
      return;
    }
    const resolved = resolvePair(p);
    if (!resolved) {
      setError('Este produto não tem par cadastrado.');
      return;
    }
    const { partner, pairPrice } = resolved;

    const mainSide = { salePrice: Number(p.salePrice), stockQty: Number(p.stockQty) };
    const partnerSide = { salePrice: Number(partner.salePrice), stockQty: Number(partner.stockQty) };

    const key = `${p.id}:PAIR:${partner.id}`;
    const existing = cart.find((c) => c.key === key);
    const newQty = (existing?.quantity ?? 0) + q;

    // O par consome 1 de CADA lado: checa os dois estoques, já descontando o que o carrinho
    // consumiu por outras linhas (avulsas ou de outro par).
    const maxPairs = pairAvailableQty(mainSide, partnerSide);
    const usedMain = baseUsedByProduct(p.id, key);
    const usedPartner = baseUsedByProduct(partner.id, key);
    if (newQty + usedMain > mainSide.stockQty || newQty + usedPartner > partnerSide.stockQty) {
      setError(
        `Estoque insuficiente para o par (disponível: ${Math.max(0, maxPairs - Math.max(usedMain, usedPartner))} par(es)).`,
      );
      return;
    }

    if (existing) {
      setCart(cart.map((c) => (c.key === key ? { ...c, quantity: newQty } : c)));
    } else {
      setCart([
        ...cart,
        {
          key,
          productId: p.id,
          name: `${p.name} + ${partner.name}`,
          // A linha carrega o preço do PAR; o rateio fica guardado em `pair` para o envio.
          unitPrice: pairPrice,
          // Custo do par = soma dos custos, p/ a margem da linha sair correta.
          costPrice: Number(p.costPrice) + Number(partner.costPrice),
          quantity: q,
          stockQty: maxPairs,
          saleMode: 'BASE',
          unitType: p.unit,
          baseUnitType: p.unit,
          conversionFactor: 1,
          pair: {
            partnerId: partner.id,
            partnerName: partner.name,
            // Avulsos: o rateio é feito no envio, quando a quantidade final é conhecida.
            mainSalePrice: mainSide.salePrice,
            partnerSalePrice: partnerSide.salePrice,
            partnerStockQty: partnerSide.stockQty,
          },
        },
      ]);
    }
    setSelected('');
    setQty('1');
    setProductSearch('');
  }

  /**
   * Enter no campo de busca: se a busca isolou UM único produto (típico ao escanear o SKU/código
   * de barras — o leitor "digita" o código e manda Enter), adiciona direto ao carrinho. Prepara o
   * fluxo de leitor físico (HID) sem depender de câmera. Ignora quando há 0 ou vários resultados.
   */
  function onProductSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const only = filteredProducts.length === 1 ? filteredProducts[0] : undefined;
    if (only) {
      addToCart(only.id);
    }
  }

  /**
   * Código lido pela CÂMERA (BarcodeScanButton): se casar com um único produto, adiciona direto ao
   * carrinho; se casar com 0 ou vários, joga o código na busca para o operador escolher na lista.
   */
  function addByScan(code: string) {
    const matches = products.filter((p) => productMatchesQuery(p, code));
    const only = matches.length === 1 ? matches[0] : undefined;
    if (only) {
      addToCart(only.id);
    } else {
      setProductSearch(code);
    }
  }

  function removeFromCart(key: string) {
    setCart(cart.filter((c) => c.key !== key));
  }

  /** "Concluir venda" agora só abre a REVISÃO — nada é gravado ainda. */
  function onConcluir() {
    setError(null);
    if (cart.length === 0) {
      setError('Carrinho vazio.');
      return;
    }
    if (discountTooHigh) {
      setError('O desconto não pode ser maior que o subtotal.');
      return;
    }
    setView({ kind: 'review' });
  }

  /** Confirmação: AQUI a venda é efetivada. Online → grava direto na API (estoque baixa, caixa
   *  recebe). Offline com o recurso ligado → enfileira na `outbox` (ADR-011) e o worker sincroniza
   *  quando a rede voltar. Offline sem o recurso → orienta nota manual (não enfileira). */
  async function onConfirmar() {
    setError(null);
    const localChange = method === 'CASH' && received ? Math.max(0, Number(received) - totals.total) : 0;
    const doneBase = {
      kind: 'done' as const,
      total: totals.total,
      discount: discountValue,
      method,
      items: cart,
      date: new Date().toLocaleString('pt-BR'),
    };

    // --- Offline: enfileira a venda (só com o recurso OFFLINE_SALES ligado) ---
    if (!online) {
      if (!offlineSales) {
        setError('Sem conexão e as vendas offline não estão habilitadas. Use nota manual.');
        return;
      }
      if (!sessionId) {
        setError('Não foi possível identificar o caixa aberto para salvar a venda offline.');
        return;
      }
      const id = crypto.randomUUID();
      const sale = {
        id,
        cashSessionId: sessionId,
        // Pares viram dois itens com preço rateado + `pairGroup` (ADR-015).
        items: cartToSaleItems(),
        payments: [{ method, amount: totals.total }],
        ...(discountValue > 0 ? { discountAmount: discountValue } : {}),
      };
      const parsed = createSaleSchema.safeParse(sale);
      if (!parsed.success) {
        setError('Não foi possível montar a venda. Verifique o carrinho.');
        return;
      }
      setBusy(true);
      try {
        await enqueueMutation(buildSaleMutation(id, sessionId, parsed.data));
        // Baixa otimista no estado LOCAL (sem rede não dá para recarregar do servidor): mantém a
        // trava de estoque coerente para as próximas vendas offline. O débito real é no sync (§3).
        const next = products.map((p) => {
          // EF-3: soma a baixa em UNIDADE-BASE de todas as linhas do produto (metro + rolo).
          // ADR-015: `baseUsedByProduct` já conta os PARES, que debitam 1 de cada lado —
          // inclusive quando este produto é o agregado, e não o principal da linha.
          const baseSold = baseUsedByProduct(p.id);
          return baseSold > 0 ? { ...p, stockQty: String(Number(p.stockQty) - baseSold) } : p;
        });
        setProducts(next);
        // Persiste a baixa no cache do catálogo (ADR-012 CS-2): ao remontar offline, o estoque
        // exibido já reflete as vendas offline anteriores (último conhecido − baixas otimistas).
        void cacheProducts(next);
        setView({ ...doneBase, change: localChange, pending: true });
        // O indicador "X pendentes" atualiza sozinho: `enqueueMutation` notifica o pub/sub da
        // `outbox`, e o contexto de sync reatualiza os contadores (aqui e no chip do topo).
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }

    // --- Online: grava direto na API (caminho de sempre) ---
    const payload = {
      // Pares viram dois itens com preço rateado + `pairGroup` (ADR-015).
      items: cartToSaleItems(),
      payments: [{ method, amount: totals.total }],
      ...(discountValue > 0 ? { discountAmount: discountValue } : {}),
    };
    const parsed = createSaleSchema.safeParse(payload);
    if (!parsed.success) {
      setError('Não foi possível montar a venda. Verifique o carrinho.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ change: number }>('/orders', parsed.data);
      setView({ ...doneBase, change: res.change });
      await loadProducts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onOrcamento() {
    setError(null);
    if (cart.length === 0) {
      setError('Adicione itens para gerar um orçamento.');
      return;
    }
    if (discountTooHigh) {
      setError('O desconto não pode ser maior que o subtotal.');
      return;
    }
    setView({
      kind: 'quote',
      total: totals.total,
      discount: discountValue,
      items: cart,
      date: new Date().toLocaleString('pt-BR'),
    });
  }

  /** Volta ao PDV mantendo o carrinho (revisão e orçamento não gravam nada). */
  function voltar() {
    setView(null);
    setError(null);
  }

  /** Começa do zero, limpando carrinho e campos. */
  function novaVenda() {
    setView(null);
    setError(null);
    setCart([]);
    setReceived('');
    setDiscount('');
  }

  if (!ready) return <p className="text-gray-500">Carregando…</p>;

  // Loja desativada pelo Super Usuário (ADR-009): venda nova bloqueada (a API também barra).
  if (me?.tenantActive === false) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="mb-4 text-2xl font-bold">Venda</h1>
        <StoreDisabledNotice message="O registro de novas vendas está bloqueado. Fale com o suporte para reativar a loja." />
      </div>
    );
  }

  if (!caixaOpen) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="mb-4 text-2xl font-bold">Venda</h1>
        {/* Sem caixa aberto + offline: abrir caixa ainda exige internet (ADR-011). */}
        <OfflineSalesNotice offlineSales={offlineSales} context="cash-open" />
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="mb-3 text-gray-600">É preciso ter um caixa aberto para vender.</p>
          <Link href="/caixa" className="inline-block rounded-lg bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-800">
            Ir para o Caixa
          </Link>
        </div>
      </div>
    );
  }

  // --- Revisão (pré-confirmação): nada gravado, estoque intacto ---
  if (view?.kind === 'review') {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="mb-4 text-2xl font-bold">Revisar venda</h1>
        <div className="space-y-3 rounded-2xl bg-white p-6 shadow-sm">
          <p className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700">
            Confira antes de confirmar
          </p>
          <Summary items={cart} total={totals.total} discount={discountValue} />
          <div className="flex justify-between text-sm text-gray-500">
            <span>Pagamento</span>
            <span>{PAYMENT_METHOD_LABELS[method]}</span>
          </div>
          {method === 'CASH' && received !== '' && (
            <div className="flex justify-between text-sm">
              <span>Troco</span>
              <span>{BRL(Math.max(0, change))}</span>
            </div>
          )}
          <p className="text-xs text-gray-400">
            O estoque só é baixado ao confirmar. Você pode voltar e editar sem afetar nada.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={voltar}
              disabled={busy}
              className="rounded-lg border border-gray-300 py-2 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              ← Voltar e editar
            </button>
            <button
              onClick={onConfirmar}
              disabled={busy}
              className="rounded-lg bg-green-600 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-60"
            >
              {busy ? 'Confirmando…' : 'Confirmar venda'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Venda concluída (gravada) ou Orçamento ---
  if (view) {
    const isQuote = view.kind === 'quote';
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="mb-4 text-2xl font-bold">
          {isQuote ? 'Orçamento' : view.kind === 'done' && view.pending ? 'Venda salva offline' : 'Venda concluída'}
        </h1>
        <div className="space-y-3 rounded-2xl bg-white p-6 shadow-sm">
          {isQuote ? (
            <p className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700">
              Orçamento (não é venda)
            </p>
          ) : view.kind === 'done' && view.pending ? (
            <p className="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-700">
              Salva offline — pendente de sincronização
            </p>
          ) : (
            <p className="inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
              Venda registrada ✅
            </p>
          )}
          <Summary items={view.items} total={view.total} discount={view.discount} />
          {view.kind === 'done' && (
            <>
              <div className="flex justify-between text-sm text-gray-500">
                <span>Pagamento</span>
                <span>{PAYMENT_METHOD_LABELS[view.method]}</span>
              </div>
              {view.change > 0 && (
                <div className="flex justify-between text-sm">
                  <span>Troco</span>
                  <span>{BRL(view.change)}</span>
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

          {isQuote ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={voltar}
                className="rounded-lg border border-gray-300 py-2 font-medium text-gray-700 hover:bg-gray-100"
              >
                ← Voltar e editar
              </button>
              <button onClick={novaVenda} className="rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800">
                Nova venda
              </button>
            </div>
          ) : (
            <button onClick={novaVenda} className="w-full rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800">
              Nova venda
            </button>
          )}
        </div>

        <ReceiptPrint
          kind={isQuote ? 'quote' : 'sale'}
          store={store}
          items={view.items.map((i) => ({
            // EF-3: no comprovante, o nome carrega a embalagem vendida ("Fio — Rolo (100 m)").
            // ADR-015: o par já é UMA linha ("Parafuso + Bucha"), com o preço do par — o cliente
            // não vê preços rateados, que mudariam se ele comprasse os itens separados.
            name: i.pair
              ? `${i.name} (par)`
              : i.saleMode === 'ALT'
                ? `${i.name} — ${unitShort(i.unitType)} (${i.conversionFactor} ${unitShort(i.baseUnitType)})`
                : i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          }))}
          total={view.total}
          discount={view.discount}
          date={view.date}
          method={view.kind === 'done' ? view.method : undefined}
          change={view.kind === 'done' ? view.change : undefined}
        />
      </div>
    );
  }

  // --- PDV (carrinho) ---
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold">Venda</h1>

      {/* Aviso de conexão (ADR-011 §9): só aparece offline; texto depende do flag OFFLINE_SALES. */}
      <OfflineSalesNotice offlineSales={offlineSales} />

      {/* Cold-start offline (ADR-012 CS-1, decisão (a)): o caixa veio do último snapshot conhecido.
          Rotula a origem para o operador saber que o dado pode estar defasado. */}
      {cachedSessionAt !== null && (
        <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Caixa recuperado do cache offline — dados de{' '}
          {new Date(cachedSessionAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
        </p>
      )}

      {/* Indicador de vendas pendentes de sincronização (ADR-011 AI 6/9). */}
      {pending > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <p className="text-sm font-medium text-indigo-800">
            {pending} {pending === 1 ? 'venda pendente' : 'vendas pendentes'} de sincronização
          </p>
          {online && (
            <button
              onClick={() => void syncNow()}
              disabled={syncing}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
            </button>
          )}
        </div>
      )}

      {/* Mostra erros quando online ou com o recurso offline ligado (aí o operador precisa vê-los);
          offline sem o recurso, esconde o ruído de rede — o aviso acima já orienta a nota manual. */}
      {error && (online || offlineSales) && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex basis-full gap-2">
            <input
              type="search"
              placeholder="Buscar ou escanear (nome, popular, fabricante ou SKU)…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              onKeyDown={onProductSearchKeyDown}
              className="min-w-[12rem] flex-1 rounded-lg border border-gray-300 px-3 py-2"
              aria-label="Buscar produto"
            />
            <BarcodeScanButton onScan={addByScan} label="Escanear produto" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Quantidade
            <input
              type="number"
              min="0"
              step="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-24 rounded-lg border border-gray-300 px-3 py-2"
              aria-label="Quantidade"
            />
          </label>
        </div>

        {/* Lista de resultados (autocomplete do PDV): aparece conforme se digita/escaneia e mostra
            os produtos que casam com a busca (nome, popular, fabricante ou SKU). Clicar adiciona ao carrinho
            com a quantidade informada — sem precisar abrir dropdown. Sem termo, lista o catálogo todo
            (rolável) para navegar. Estoque zerado fica desabilitado. */}
        <ul className="mt-3 max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
          {filteredProducts.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-gray-400">
              {productSearch ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado.'}
            </li>
          ) : (
            filteredProducts.map((p) => {
              const stock = Number(p.stockQty);
              const out = !(stock > 0);
              const alt = hasAltUnit(altConfig(p));
              // ADR-015: par vendável (dos dois lados) e com estoque nos DOIS produtos.
              const pairInfo = resolvePair(p);
              // Produto de unidade única e sem par: clicar na linha adiciona (bom p/ scan).
              if (!alt && !pairInfo) {
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addToCart(p.id)}
                      disabled={out}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-gray-400">
                          {p.popularName ? `${p.popularName} · ` : ''}
                          {p.sku}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-medium">{BRL(p.salePrice)}</span>
                        <span className={`block text-xs ${out ? 'text-red-500' : 'text-gray-400'}`}>
                          {out ? 'sem estoque' : `est. ${stock}`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              }
              // EF-3 / ADR-015: produto com embalagem alternativa e/ou par → botões de escolha
              // (unidade-base × embalagem fechada × par).
              const factor = Number(p.conversionFactor);
              const pairsLeft = pairInfo
                ? pairAvailableQty(
                    { salePrice: Number(p.salePrice), stockQty: stock },
                    {
                      salePrice: Number(pairInfo.partner.salePrice),
                      stockQty: Number(pairInfo.partner.stockQty),
                    },
                  )
                : 0;
              return (
                <li key={p.id} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-gray-400">
                        {p.popularName ? `${p.popularName} · ` : ''}
                        {p.manufacturer ? `${p.manufacturer} · ` : ''}
                        {p.sku}
                      </span>
                    </span>
                    <span className={`shrink-0 text-xs ${out ? 'text-red-500' : 'text-gray-400'}`}>
                      {out ? 'sem estoque' : `est. ${stock} ${unitShort(p.unit)}`}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => addToCart(p.id, 'BASE')}
                      disabled={out}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      + {unitShort(p.unit)} · {BRL(p.salePrice)}
                    </button>
                    {alt && (
                      <button
                        type="button"
                        onClick={() => addToCart(p.id, 'ALT')}
                        disabled={out}
                        title={`1 ${unitShort(p.altUnit as UnitType)} = ${factor} ${unitShort(p.unit)}`}
                        className="rounded-lg border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        + {unitShort(p.altUnit as UnitType)} ({factor} {unitShort(p.unit)}) · {BRL(p.altSalePrice as string)}
                      </button>
                    )}
                    {/* Par (ADR-015): exige estoque dos DOIS produtos. */}
                    {pairInfo && (
                      <button
                        type="button"
                        onClick={() => addPairToCart(p.id)}
                        disabled={pairsLeft <= 0}
                        title={
                          pairsLeft > 0
                            ? `Par com ${pairInfo.partner.name} · avulsos ${BRL(
                                Number(p.salePrice) + Number(pairInfo.partner.salePrice),
                              )}`
                            : `Sem estoque de "${pairInfo.partner.name}" para formar o par`
                        }
                        className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        + par c/ {pairInfo.partner.name} · {BRL(pairInfo.pairPrice)}
                        {pairsLeft > 0 && (
                          <span className="ml-1 text-emerald-500">({pairsLeft} disp.)</span>
                        )}
                      </button>
                    )}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div className="mb-4 overflow-x-auto rounded-2xl bg-white shadow-sm">
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
                <tr key={i.key} className="border-t border-gray-100">
                  <td className="px-4 py-2">
                    <span title={itemTooltip(i)} className="cursor-help border-b border-dotted border-gray-300">
                      {i.name}
                    </span>
                    {i.saleMode === 'ALT' && !i.pair && (
                      <span className="block text-xs text-gray-400">
                        embalagem fechada · ≈ {i.quantity * i.conversionFactor} {unitShort(i.baseUnitType)}
                      </span>
                    )}
                    {/* Par (ADR-015): mostra que a linha baixa os dois produtos. */}
                    {i.pair && (
                      <span className="block text-xs text-emerald-600">
                        par · baixa 1 de cada produto
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {i.quantity}
                    {i.pair ? ` par${i.quantity > 1 ? 'es' : ''}` : ''}
                    {i.saleMode === 'ALT' && !i.pair ? ` ${unitShort(i.unitType)}` : ''}
                  </td>
                  <td className="px-4 py-2 text-right">{BRL(i.unitPrice)}</td>
                  <td className="px-4 py-2 text-right">{BRL(i.unitPrice * i.quantity)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => removeFromCart(i.key)} className="text-gray-400 hover:text-red-600">
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
                <div className="mt-2 flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 ring-1 ring-green-200">
                  <span className="text-sm font-medium text-green-800">Troco</span>
                  <span className="text-2xl font-bold text-green-700">{BRL(Math.max(0, change))}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between rounded-2xl bg-white p-4 shadow-sm">
          <div>
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
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-3">
              <label htmlFor="desc" className="text-sm text-gray-600">
                Desconto (R$)
              </label>
              <input
                id="desc"
                type="number"
                step="0.01"
                min="0"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                placeholder="0,00"
                className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-right"
              />
            </div>
            {discountTooHigh && (
              <p className="mt-1 text-xs text-red-600">O desconto não pode ser maior que o subtotal.</p>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={onConcluir}
              disabled={cart.length === 0 || discountTooHigh}
              className="rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Concluir venda
            </button>
            <button
              onClick={onOrcamento}
              disabled={cart.length === 0 || discountTooHigh}
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
