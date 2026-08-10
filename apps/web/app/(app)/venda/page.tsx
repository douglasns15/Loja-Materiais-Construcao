'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  PAYMENT_METHOD_LABELS,
  buildSaleMutation,
  createSaleSchema,
  formatQuoteNumber,
  paymentMethodLabel,
  unitTypeLabels,
  type CreateQuoteResult,
  type PaymentMethod,
  type QuoteDetail,
  type QuoteItem,
  type SaleUnitMode,
  type UnitType,
} from '@nexoloja/shared';
import {
  calcMarginPercent,
  calcSaleTotals,
  closedStockMeters,
  hasAltUnit,
  hasPair,
  isClosedPrimary,
  isValidMeterStep,
  maxStoreCreditForSale,
  pairAvailableQty,
  paymentStatus,
  productMatchesQuery,
  resolveClosedSale,
  resolveSaleUnit,
  resolveSurcharge,
  sellsByMeter,
  splitPairLine,
  splitWholeAndRemainder,
  surchargePerBaseUnit,
  cardFeePercentFor,
  netMarginPercent,
} from '@nexoloja/core';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { cacheCashSession, readCachedCashSession } from '@/lib/cashSessionCache';
import { cacheProducts, readCachedProducts } from '@/lib/catalog';
import { enqueueMutation } from '@/lib/outbox';
import { useOutboxSyncContext } from '@/lib/outboxSync';
import { useMe } from '@/lib/useMe';
import { useOnline } from '@/lib/useOnline';
import { useCart } from '@/lib/cartStore';
import { ensureImageLoaded } from '@/lib/print';
import { ReceiptPrint, type Store } from '@/components/ReceiptPrint';
import { CartItemInfo } from '@/components/CartItemInfo';
import { StoreDisabledNotice } from '@/components/StoreDisabledNotice';
import { OfflineSalesNotice } from '@/components/OfflineSalesNotice';
import { BarcodeScanButton } from '@/components/BarcodeScanButton';
import { MoneyInput } from '@/components/MoneyInput';

/** Taxas da maquininha que vêm junto no `GET /tenant` (ADR-016). */
type StoreCardFees = {
  cardFeeDebitPercent: number | string | null;
  cardFeeCreditPercent: number | string | null;
};

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
  // Acréscimo por forma de pagamento (ADR-016). Nulos ⇒ preço igual em qualquer forma.
  surchargeDebit: string | null;
  surchargeCredit: string | null;
};
type CartItem = {
  /** Chave única da linha = `productId:saleMode` (o mesmo produto pode ir como metro E como rolo). */
  key: string;
  productId: string;
  name: string;
  /**
   * Preço **base** da unidade vendida — SEM o acréscimo por forma de pagamento (ADR-016).
   *
   * O acréscimo não pode ser congelado aqui: a forma de pagamento é escolhida depois de o
   * carrinho estar montado, e trocar de Dinheiro para Crédito no fim tem de reprecificar a
   * tela toda. Por isso ele fica em `surcharge*` e o preço efetivo é DERIVADO em `pricedCart`.
   */
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
   * ADR-017: `true` quando a linha é de um produto de **unidade fechada** (barra/rolo). Aqui o
   * `conversionFactor` é o TAMANHO em metros por unidade vendida (barra = tamanho; metro = 1), o
   * ledger é em metros e o `costPrice` já é o custo POR UNIDADE VENDIDA (não por metro), então a
   * margem/tooltip usa preço − custo direto, sem multiplicar pelo fator.
   */
  closed?: boolean;
  /**
   * Acréscimo por forma de pagamento (ADR-016), em R$ **por unidade vendida desta linha** —
   * já composto com a embalagem (EF-3: × fator) e com o par (soma dos dois lados). Zero quando
   * o produto não tem acréscimo cadastrado, que é o caso da maior parte do catálogo.
   */
  surchargeDebit: number;
  surchargeCredit: number;
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
/** Uma parcela de pagamento na tela: a forma + o valor digitado (string do MoneyInput). */
type PayLine = { method: PaymentMethod; amount: string };
/** Parcela já resolvida/persistida: forma + valor numérico (as parcelas somam o total). */
type PaidPart = { method: PaymentMethod; amount: number };

type View =
  | { kind: 'review' }
  | {
      kind: 'done';
      total: number;
      discount: number;
      change: number;
      /** Parcelas efetivamente cobradas (somam o total) — venda pode ter mais de uma forma. */
      payments: PaidPart[];
      items: CartItem[];
      date: string;
      /** `true` quando a venda foi salva na fila offline (pendente de sincronização), ADR-011. */
      pending?: boolean;
      /** Código sequencial da venda (ADR-023) — V-000128. Ausente na venda offline até sincronizar
       *  (o comprovante imprime "código pendente"). */
      orderNumber?: number | null;
      /** Venda a prazo (fiado — ADR-019): valor deixado a prazo + cliente devedor. */
      credit?: number;
      /** Crédito da loja usado nesta venda (ADR-022, Fatia C) — mostrado como forma no comprovante. */
      storeCredit?: number;
      customerName?: string | null;
    }
  | {
      kind: 'quote';
      total: number;
      discount: number;
      items: CartItem[];
      date: string;
      // ADR-024: preenchidos quando o orçamento foi SALVO (não a cotação efêmera). `quoteNumber`
      // imprime "O-000045"; `validUntil` (pt-BR) imprime "Válido até …"; `saved` mostra o aviso.
      quoteNumber?: number | null;
      validUntil?: string | null;
      saved?: boolean;
    };

/**
 * Resolve as parcelas digitadas em valores numéricos, na ordem da tela. Uma parcela com valor
 * **vazio** assume automaticamente o que **falta** para fechar o total (o "resto") — é o que deixa
 * o caso comum (uma forma só) sem digitação: a única linha vazia vira o total inteiro. Havendo mais
 * de uma linha vazia, só a primeira recebe o resto; as demais ficam em 0 (o operador as preenche).
 * O valor do DINHEIRO aqui é o **recebido** (pode passar do que falta → gera troco); a conta do
 * troco e do "pago/falta" fica com `paymentStatus` (core), e a persistência ajusta o dinheiro para
 * as parcelas somarem exatamente o total (o troco nunca vai para o caixa).
 */
function resolvePaymentLines(lines: PayLine[], total: number): PaidPart[] {
  const typed = lines.map((l) => (l.amount.trim() === '' ? null : Math.max(0, Number(l.amount) || 0)));
  const typedSum = typed.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  let remaining = Math.max(0, Number((total - typedSum).toFixed(2)));
  return lines.map((l, i) => {
    if (typed[i] != null) return { method: l.method, amount: typed[i] as number };
    const give = remaining;
    remaining = 0;
    return { method: l.method, amount: Number(give.toFixed(2)) };
  });
}

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
                <span className="text-gray-500">
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
        <div className="space-y-1 border-t border-gray-200 pt-2 text-sm text-gray-600">
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

/** Formas de pagamento de uma venda (uma linha por forma) + crédito da loja + troco, reusado na
 *  revisão e na conclusão. `storeCredit` (ADR-022, Fatia C) aparece como uma forma a mais. */
function PaymentsLines({
  payments,
  change,
  storeCredit = 0,
}: {
  payments: PaidPart[];
  change: number;
  storeCredit?: number;
}) {
  // Com crédito da loja há sempre ≥ 2 "formas" na exibição (a parcela + o crédito).
  const multi = payments.length + (storeCredit > 0 ? 1 : 0) > 1;
  return (
    <>
      {payments.map((p, i) => (
        <div key={`${p.method}-${i}`} className="flex justify-between text-sm text-gray-600">
          <span>{multi ? `Pagamento · ${PAYMENT_METHOD_LABELS[p.method]}` : 'Pagamento'}</span>
          <span>{multi ? BRL(p.amount) : PAYMENT_METHOD_LABELS[p.method]}</span>
        </div>
      ))}
      {storeCredit > 0 && (
        <div className="flex justify-between text-sm text-gray-600">
          <span>Pagamento · Crédito da loja</span>
          <span>{BRL(storeCredit)}</span>
        </div>
      )}
      {change > 0 && (
        <div className="flex justify-between text-sm">
          <span>Troco</span>
          <span>{BRL(change)}</span>
        </div>
      )}
    </>
  );
}

/**
 * Campo de quantidade do carrinho. Mantém um **rascunho** de texto interno para que o operador possa
 * **apagar o campo** e digitar um novo número. Um `<input type="number">` controlado por `value={quantity}`
 * "trava" a edição: ao apagar tudo, o campo volta ao número na hora (não dá para limpar e digitar de novo).
 * Aqui o rascunho espelha o valor real enquanto não há edição; ao digitar, comita só quando há número
 * válido; ao sair do campo (`blur`), volta a espelhar o valor real — o que aplica a trava de estoque do
 * `changeLineQty` e descarta um campo deixado vazio. Assinatura enxuta: `value` + `onCommit`.
 */
function QtyInput({
  value,
  step,
  min,
  onCommit,
  ariaLabel,
  className,
}: {
  value: number;
  step: string;
  min: string;
  onCommit: (n: number) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      min={min}
      step={step}
      value={draft ?? String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw); // deixa o campo vazio/parcial existir enquanto o operador digita
        if (raw !== '') {
          const n = Number(raw);
          if (Number.isFinite(n)) onCommit(n);
        }
      }}
      onBlur={() => setDraft(null)} // volta a espelhar o valor real (trava de estoque / limpa vazio)
      className={className}
      aria-label={ariaLabel}
    />
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
  // Cesta persistente (ADR-021): estado vem do CartProvider (servidor + espelho local, por usuário),
  // não mais de um useState local — assim não se perde ao navegar/recarregar e sincroniza entre
  // dispositivos. A API (`cart`/`setCart`/`clearCart`) é a mesma de antes para o resto da tela.
  const { cart, setCart, clearCart } = useCart();
  // Linha cujo "i" (informações do item) está aberto — chave do CartItem, ou null.
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [qty, setQty] = useState('1');
  // Pagamento dividido: uma ou mais parcelas (forma + valor). A 1ª forma é a "principal" que
  // precifica o carrinho (ADR-016). O valor vazio numa linha assume o "resto" (ver resolvePaymentLines),
  // então o caso comum — uma forma só — não exige digitar nada.
  const [payments, setPayments] = useState<PayLine[]>([{ method: 'CASH', amount: '' }]);
  // Confirmação inline do "Limpar carrinho" (evita apagar um carrinho grande por um clique).
  const [confirmClear, setConfirmClear] = useState(false);
  const [discount, setDiscount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  // Taxas da maquininha da loja (ADR-016) — informam a margem REAL no tooltip; nunca mudam preço.
  const [cardFees, setCardFees] = useState<{
    cardFeeDebitPercent: number | null;
    cardFeeCreditPercent: number | null;
  } | null>(null);
  const [printModel, setPrintModel] = useState<'80mm' | 'A4'>('80mm');
  // Salvar orçamento (ADR-024): validade default = +7 dias (editável antes de salvar) + estado de save.
  const [quoteValidity, setQuoteValidity] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [savingQuote, setSavingQuote] = useState(false);
  // Nome LIVRE de quem é o orçamento (ADR-024, 2.B) — identificação de balcão sem cadastro.
  const [quoteCustomerName, setQuoteCustomerName] = useState('');
  // Orçamento de origem (ADR-024, 2.B): quando o PDV é aberto por "Gerar venda" (`convert`) ou
  // "Editar rascunho" (`edit`) via `?quoteId=`. Carrega o número (banner), o modo e as observações
  // (preservadas ao salvar a edição). Ausente = venda/orçamento novos.
  const [sourceQuote, setSourceQuote] = useState<{
    id: string;
    number: number;
    mode: 'convert' | 'edit';
    notes: string | null;
  } | null>(null);
  // Itens do orçamento que a reconstrução NÃO conseguiu remontar (par de orçamento antigo sem o
  // parceiro, ou produto que saiu do catálogo) — sinalizados para o operador re-adicionar à mão.
  const [quoteReview, setQuoteReview] = useState<string[]>([]);
  // Roda a reconstrução do `?quoteId=` uma única vez (depois que o catálogo carrega).
  const quoteAppliedRef = useRef(false);
  // Venda a prazo (ADR-019): valor deixado a prazo, cliente devedor e vencimento opcional.
  // `creditInput` vazio/0 = venda à vista comum (nenhuma regressão). Online-only nesta fatia.
  // `showCredit` mantém a opção ESCONDIDA por padrão (PDV limpo) — só aparece quando o operador
  // clica em "Venda a prazo" (padrão dos bons PDVs: opções avançadas sob demanda).
  const [showCredit, setShowCredit] = useState(false);
  const [creditInput, setCreditInput] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerOptions, setCustomerOptions] = useState<{ id: string; name: string }[]>([]);
  // Saldo em aberto do cliente selecionado (ADR-022): alerta de "Dívida ativa" ao pôr numa conta
  // que já existe. `null` = ainda não sabido / sem dívida / offline. Só informativo.
  const [customerDebt, setCustomerDebt] = useState<number | null>(null);
  // Crédito a favor do cliente selecionado (ADR-022, Fatia C). `null` = não sabido / sem crédito /
  // offline. Libera o bloco "Usar crédito da loja" só quando > 0.
  const [customerCredit, setCustomerCredit] = useState<number | null>(null);
  const [showStoreCredit, setShowStoreCredit] = useState(false);
  const [storeCreditInput, setStoreCreditInput] = useState('');
  const [dueDate, setDueDate] = useState('');
  // Retirada/entrega futura (ADR-020) — opt-in, escondida por padrão (PDV limpo), como o fiado.
  // Quando ligada, a venda RESERVA a mercadoria (não baixa o estoque); a retirada é registrada
  // depois, parcial, na tela de Entregas. `pickupDate` é a previsão ÚNICA do pedido; se
  // `perItemSchedule` estiver ligado, a previsão vem de cada item (`itemPickupDates` por linha).
  // Online-only nesta fatia (como o fiado).
  const [showSchedule, setShowSchedule] = useState(false);
  const [pickupDate, setPickupDate] = useState('');
  const [perItemSchedule, setPerItemSchedule] = useState(false);
  const [itemPickupDates, setItemPickupDates] = useState<Record<string, string>>({});
  // Observação livre do PEDIDO (ADR-020): informações gerais que quem abrir a Entrega precisa ver
  // (ex.: "quem retira não é quem comprou"). Vai em `Order.notes` e aparece no detalhe da Entrega.
  const [orderNote, setOrderNote] = useState('');

  async function loadProducts() {
    const raw = await apiGet<(Product & { reservedQty?: string })[]>('/products');
    // ADR-020: o PDV trava pelo DISPONÍVEL = estoque − reservado. Mercadoria comprometida com
    // retiradas/entregas futuras (pedidos SCHEDULED ainda não retirados) não pode ser vendida de
    // novo. Substituímos `stockQty` pelo disponível num ponto só — toda a trava do carrinho passa
    // a respeitar o reservado sem mais edições. O servidor revalida no `POST /orders` (autoritativo).
    const list: Product[] = raw.map((p) => ({
      ...p,
      stockQty: String(Math.max(0, Number(p.stockQty) - Number(p.reservedQty ?? 0))),
    }));
    setProducts(list);
    // Rede venceu (ADR-012 CS-2): espelha o catálogo p/ o cold-start offline (best-effort).
    void cacheProducts(list);
  }

  useEffect(() => {
    (async () => {
      try {
        // O mesmo GET traz as taxas da maquininha (ADR-016), usadas só no tooltip de margem real.
        apiGet<Store & StoreCardFees>('/tenant')
          .then((s) => {
            setStore(s);
            setCardFees({
              cardFeeDebitPercent:
                s.cardFeeDebitPercent == null ? null : Number(s.cardFeeDebitPercent),
              cardFeeCreditPercent:
                s.cardFeeCreditPercent == null ? null : Number(s.cardFeeCreditPercent),
            });
          })
          .catch(() => {});
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

  // Busca de cliente para a venda a prazo (fiado). Debounce; usa a busca no servidor (`?q=`) da
  // fatia UI.Busca.Servidor. Só dispara com o campo aberto e ao menos 2 caracteres.
  useEffect(() => {
    const q = customerQuery.trim();
    if (q.length < 2) {
      setCustomerOptions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const page = await apiGet<{ rows: { id: string; name: string }[] }>(
          `/customers?q=${encodeURIComponent(q)}`,
        );
        if (!cancelled) setCustomerOptions(page.rows.map((r) => ({ id: r.id, name: r.name })));
      } catch {
        if (!cancelled) setCustomerOptions([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [customerQuery]);

  // Ao selecionar um cliente, busca o saldo em aberto dele (conta do cliente — ADR-022) para o
  // alerta de "Dívida ativa". Best-effort e online-only; some/limpa quando não há cliente.
  useEffect(() => {
    if (!customerId) {
      setCustomerDebt(null);
      setCustomerCredit(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // O detalhe da conta traz saldo devedor (alerta "Dívida ativa") E crédito a favor (ADR-022).
        const acc = await apiGet<{ totalBalance: number; creditBalance: number }>(
          `/receivables/accounts/${customerId}`,
        );
        if (!cancelled) {
          setCustomerDebt(acc.totalBalance);
          setCustomerCredit(acc.creditBalance ?? 0);
        }
      } catch {
        if (!cancelled) {
          setCustomerDebt(null);
          setCustomerCredit(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // Atalho "+ Adicionar itens" da tela de Contas a Receber (ADR-022): chega com `?customerId=` +
  // `?customerName=` → pré-seleciona o cliente e abre o bloco de venda a prazo (a saída dos itens
  // roda aqui no PDV, motor único). Lê da URL uma vez, no cliente (evita o boundary de Suspense).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cid = params.get('customerId');
    if (cid) {
      setCustomerId(cid);
      setCustomerName(params.get('customerName') ?? '');
      setShowCredit(true);
    }
  }, []);

  // Reconstrução do PDV a partir de um orçamento (ADR-024, 2.B): "Gerar venda" (`?quoteId=`) ou
  // "Editar rascunho" (`?quoteId=&edit=1`). Espera o catálogo carregar (preço/estoque saem dele) e
  // roda UMA vez (guarda no ref). Lê a URL no cliente, como o prefill de cliente acima.
  useEffect(() => {
    if (quoteAppliedRef.current || products.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const qid = params.get('quoteId');
    if (!qid) return;
    quoteAppliedRef.current = true;
    const editMode = params.get('edit') === '1';
    (async () => {
      try {
        const detail = await apiGet<QuoteDetail>(`/quotes/${qid}`);
        applyQuoteToCart(detail, editMode);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  /** Define o modelo (80mm/A4), injeta a regra @page e abre o diálogo de impressão. */
  async function imprimir() {
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
    // Garante a logo baixada antes de imprimir (some do papel se trocada agora). Ver lib/print.ts.
    await ensureImageLoaded(store?.logoUrl);
    window.print();
  }

  const discountValue = Math.max(0, Number(discount) || 0);

  // Forma PRINCIPAL (ADR-016): a 1ª parcela precifica o carrinho. Numa venda dividida, é ela que
  // define se os produtos com acréscimo saem no preço de débito/crédito (decisão do Owner, opção 1).
  const primaryMethod: PaymentMethod = payments[0]?.method ?? 'CASH';

  /**
   * Carrinho **reprecificado pela forma principal** (ADR-016) — o preço do cartão só existe aqui,
   * derivado, nunca congelado na linha. Trocar a forma principal reprecifica tudo de uma vez:
   * carrinho, totais, comprovante e o payload da venda saem todos deste mesmo array, então não
   * existe caminho em que a tela mostre um preço e o servidor cobre outro.
   */
  const pricedCart = useMemo(
    () =>
      cart.map((c) => {
        const extra =
          primaryMethod === 'DEBIT_CARD' ? c.surchargeDebit : primaryMethod === 'CREDIT_CARD' ? c.surchargeCredit : 0;
        return extra > 0
          ? { ...c, unitPrice: Number((c.unitPrice + extra).toFixed(4)) }
          : c;
      }),
    [cart, primaryMethod],
  );
  /** Quanto o carrinho inteiro subiu por causa da forma principal (0 = nenhum acréscimo). */
  const surchargeTotal = useMemo(
    () =>
      Number(
        cart
          .reduce((acc, c) => {
            const extra =
              primaryMethod === 'DEBIT_CARD'
                ? c.surchargeDebit
                : primaryMethod === 'CREDIT_CARD'
                  ? c.surchargeCredit
                  : 0;
            return acc + extra * c.quantity;
          }, 0)
          .toFixed(2),
      ),
    [cart, primaryMethod],
  );
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
    // `primaryMethod` entra nas deps porque o acréscimo por forma de pagamento (ADR-016) reprecifica
    // o carrinho — sem isso, trocar Dinheiro → Crédito mostraria o total antigo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart, discountValue, primaryMethod],
  );
  const discountTooHigh = discountValue > totals.subtotal;

  // --- Venda a prazo (ADR-019) ---
  // Valor deixado a prazo (limitado ao total) e o "a pagar AGORA" (= total − a prazo). Toda a
  // mecânica de parcelas passa a fechar o `payableNow` em vez do total — com `credit = 0` é
  // idêntico ao de sempre (zero regressão); com `credit = total`, não se paga nada agora (100% a prazo).
  const creditValue = showCredit
    ? Math.min(Math.max(0, Number(creditInput) || 0), totals.total)
    : 0;
  const isCredit = creditValue > 0;

  // --- Crédito da loja usado (ADR-022, Fatia C) ---
  // Espelha o fiado: reduz o "a pagar agora". Travado no máximo aplicável (saldo do cliente e o que
  // resta a pagar = total − a prazo), com a mesma função pura do servidor. 0 quando o bloco está oculto.
  const creditAvailable = customerCredit ?? 0;
  const maxStoreCredit = maxStoreCreditForSale(totals.total, creditValue, creditAvailable);
  const storeCreditUsed =
    showStoreCredit && creditAvailable > 0
      ? Math.min(Math.max(0, Number(storeCreditInput) || 0), maxStoreCredit)
      : 0;

  const payableNow = Number((totals.total - creditValue - storeCreditUsed).toFixed(2));

  // --- Retirada / entrega futura (ADR-020) ---
  // `isScheduled` liga o modo SCHEDULED do pedido (reserva agora, retira depois). Não altera o
  // pagamento (paga-se normalmente, à vista ou a prazo) — só a saída da mercadoria é adiada.
  const isScheduled = showSchedule;

  // --- Recebimento (pagamento dividido) ---
  // Parcelas resolvidas (vazio = resto) e a situação do recebimento (pago/falta/troco), pela mesma
  // função pura do servidor. O DINHEIRO nas parcelas é o RECEBIDO (pode passar do total → troco).
  // O alvo é o `payableNow` (parte à vista), não o total: o que fica a prazo não é "recebido".
  const resolvedPayments = useMemo(() => resolvePaymentLines(payments, payableNow), [payments, payableNow]);
  const payStatus = useMemo(
    () => paymentStatus(payableNow, resolvedPayments),
    [payableNow, resolvedPayments],
  );
  // Soma do que NÃO é dinheiro (cartão/PIX não dão troco): se passar do total, é erro do operador —
  // só o dinheiro pode exceder (vira troco). Trava a conclusão até ajustar.
  const nonCashSum = useMemo(
    () =>
      Number(
        resolvedPayments.reduce((acc, p) => acc + (p.method === 'CASH' ? 0 : p.amount), 0).toFixed(2),
      ),
    [resolvedPayments],
  );
  const nonCashOverpaid = nonCashSum > payableNow + 0.005;
  const change = payStatus.change;
  const hasCashLine = payments.some((p) => p.method === 'CASH');

  /**
   * Parcelas a PERSISTIR (somam exatamente o total): cartão/PIX como digitado e o dinheiro fecha
   * o resto (`total − Σ não-dinheiro`). Assim o troco nunca entra no caixa — o Caixa soma
   * `Payment.amount` de CASH e precisa do dinheiro LÍQUIDO da venda (invariante de sempre).
   */
  function buildPersistedPayments(): PaidPart[] {
    const nonCash = resolvedPayments
      .filter((p) => p.method !== 'CASH' && p.amount > 0)
      .map((p) => ({ method: p.method, amount: Number(p.amount.toFixed(2)) }));
    const nonCashTotal = Number(nonCash.reduce((acc, p) => acc + p.amount, 0).toFixed(2));
    // Fecha o "a pagar agora" (parte à vista): o que fica a prazo NÃO vira pagamento (ADR-019).
    const cashApplied = Number((payableNow - nonCashTotal).toFixed(2));
    return cashApplied > 0 ? [...nonCash, { method: 'CASH' as PaymentMethod, amount: cashApplied }] : nonCash;
  }

  function setLine(index: number, patch: Partial<PayLine>) {
    setPayments((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    // Sugere uma forma ainda não usada (senão repete a última) e deixa o valor vazio = "resto".
    const used = new Set(payments.map((p) => p.method));
    const next = (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).find((m) => !used.has(m));
    setPayments((prev) => [...prev, { method: next ?? prev[prev.length - 1]?.method ?? 'CASH', amount: '' }]);
  }
  function removeLine(index: number) {
    setPayments((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  // Busca do PDV: filtra por nome, nome popular, fabricante ou SKU (função pura de packages/core).
  const filteredProducts = useMemo(
    () => products.filter((p) => productMatchesQuery(p, productSearch)),
    [products, productSearch],
  );

  /**
   * Config de acréscimo por forma de pagamento (ADR-016) de um produto, no formato do core.
   * Inclui a config de embalagem porque `resolveSurcharge` precisa do fator para o modo ALT.
   */
  function surchargeCfg(p: Product) {
    return {
      ...altConfig(p),
      surchargeDebit: p.surchargeDebit != null ? Number(p.surchargeDebit) : null,
      surchargeCredit: p.surchargeCredit != null ? Number(p.surchargeCredit) : null,
    };
  }

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
    // ADR-020: quando a previsão é por item, anexa a data da linha (`itemPickupDates[key]`) ao(s)
    // item(ns) do payload. No par, os dois lados herdam a data da linha.
    const lineDate = (key: string) =>
      isScheduled && perItemSchedule && itemPickupDates[key]
        ? { scheduledPickupAt: itemPickupDates[key] }
        : {};
    // Parte do carrinho JÁ reprecificado (ADR-016) — o `unitPrice` daqui é o que será cobrado,
    // e no par o acréscimo entra antes do rateio, mantendo a soma exata dos dois itens.
    return pricedCart.flatMap((c) => {
      if (!c.pair) {
        return [
          {
            productId: c.productId,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
            saleMode: c.saleMode, // EF-3: o servidor converte a baixa p/ unidade-base
            ...lineDate(c.key),
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
          ...lineDate(c.key),
        },
        {
          productId: c.pair.partnerId,
          quantity: c.quantity,
          unitPrice: split.pairedUnitPrice,
          saleMode: 'BASE' as SaleUnitMode,
          pairGroup: group,
          ...lineDate(c.key),
        },
      ];
    });
  }

  /** Tooltip por item: margem de lucro e desconto máximo possível (até o custo). No modo embalagem
   *  (EF-3), a margem usa o preço efetivo POR UNIDADE-BASE (preço do rolo ÷ fator), comparável ao custo. */
  function itemTooltip(i: CartItem): string {
    // Taxa da forma de pagamento escolhida (ADR-016): a margem mostrada é a REAL, já
    // descontada a maquininha. Sem taxa cadastrada, é a margem de sempre.
    const fee = cardFeePercentFor(cardFees ?? {}, primaryMethod);
    const feeNote = fee > 0 ? ` (líq. da taxa de ${fee}%)` : '';
    // Par (ADR-015): preço e custo da linha já são a soma dos dois lados, então a margem
    // do par sai direto (é a margem do conjunto, que é o que interessa ao operador).
    if (i.pair) {
      const margin = netMarginPercent(i.costPrice, i.unitPrice, fee);
      return `Par: ${i.name} • Margem do par: ${margin}%${feeNote}`;
    }
    // ADR-017: unidade fechada — `costPrice` já é por unidade vendida (barra ou metro), então a
    // margem é preço − custo direto (sem multiplicar pelo fator, que aqui é o tamanho em metros).
    if (i.closed) {
      const margin = netMarginPercent(i.costPrice, i.unitPrice, fee);
      const maxDisc = Math.max(0, Number((i.unitPrice - i.costPrice).toFixed(2)));
      return maxDisc > 0
        ? `Margem: ${margin}%${feeNote} • Desconto possível: até ${BRL(maxDisc)}/un`
        : `Margem: ${margin}%${feeNote} • Sem margem para desconto`;
    }
    const effUnit = i.conversionFactor > 0 ? i.unitPrice / i.conversionFactor : i.unitPrice;
    const margin = netMarginPercent(i.costPrice, effUnit, fee);
    const maxDisc = Math.max(0, Number((i.unitPrice - i.costPrice * i.conversionFactor).toFixed(2)));
    return maxDisc > 0
      ? `Margem: ${margin}%${feeNote} • Desconto possível: até ${BRL(maxDisc)}/un`
      : `Margem: ${margin}%${feeNote} • Sem margem para desconto`;
  }

  /**
   * Constrói UMA linha de carrinho (avulsa) a partir do produto do catálogo, no modo pedido
   * (BASE/ALT — EF-3): calcula preço, fator para unidade-base, unidade vendida, custo por unidade
   * vendida e acréscimos por forma (ADR-016). PURA em relação ao estado — NÃO checa estoque nem mexe
   * no carrinho —, reusada por `addToCart` (entrada manual) e pela reconstrução de orçamento (2.B).
   * `meterInvalid` sinaliza corte por metro fora do passo de 0,5 m (quem chama decide como reagir).
   */
  function buildCartLine(
    p: Product,
    mode: SaleUnitMode,
    quantity: number,
  ): { line: CartItem; factorToBase: number; meterInvalid: boolean } {
    const closed = isClosedPrimary({
      unit: p.unit,
      conversionFactor: p.conversionFactor != null ? Number(p.conversionFactor) : null,
    });

    let unitPrice: number;
    let factorToBase: number; // metros por unidade vendida (base = 1)
    let unitType: UnitType;
    let effMode: SaleUnitMode;
    let lineCost: number; // custo POR UNIDADE VENDIDA (para a margem/tooltip)
    let surchargeDebit: number;
    let surchargeCredit: number;
    let meterInvalid = false;

    if (closed) {
      // ADR-017: unidade fechada como principal. `mode==='ALT'` só corta se houver preço/metro;
      // senão barra inteira. Ledger em metros: barra baixa `tamanho`; metro baixa 1.
      const ccfg = {
        unit: p.unit,
        conversionFactor: Number(p.conversionFactor),
        salePrice: Number(p.salePrice),
        altSalePrice: p.altSalePrice != null ? Number(p.altSalePrice) : null,
      };
      const barLen = Number(p.conversionFactor);
      const closedMode = mode === 'ALT' && sellsByMeter(ccfg) ? 'METER' : 'WHOLE';
      if (closedMode === 'METER' && !isValidMeterStep(quantity)) meterInvalid = true;
      const r = resolveClosedSale(ccfg, closedMode);
      unitPrice = r.unitPrice;
      factorToBase = r.metersPerUnit; // barra = tamanho; metro = 1
      unitType = closedMode === 'METER' ? (p.altUnit ?? p.unit) : p.unit;
      effMode = closedMode === 'METER' ? 'ALT' : 'BASE';
      // Custo por unidade vendida: a barra é o custo cheio; o metro é o custo ÷ tamanho.
      lineCost =
        closedMode === 'METER' && barLen > 0 ? Number((Number(p.costPrice) / barLen).toFixed(4)) : Number(p.costPrice);
      // ADR-016: acréscimo por unidade vendida = acréscimo por metro × metros da unidade.
      surchargeDebit = Number((surchargePerBaseUnit(surchargeCfg(p), 'DEBIT_CARD') * factorToBase).toFixed(4));
      surchargeCredit = Number((surchargePerBaseUnit(surchargeCfg(p), 'CREDIT_CARD') * factorToBase).toFixed(4));
    } else {
      const cfg = altConfig(p);
      const useAlt = mode === 'ALT' && hasAltUnit(cfg);
      effMode = useAlt ? 'ALT' : 'BASE';
      const resolved = resolveSaleUnit(cfg, effMode);
      unitPrice = resolved.unitPrice;
      factorToBase = resolved.factorToBase;
      unitType = useAlt ? (p.altUnit as UnitType) : p.unit;
      lineCost = Number(p.costPrice);
      // ADR-016: acréscimo por unidade VENDIDA — na embalagem fechada o core já multiplica pelo fator.
      surchargeDebit = resolveSurcharge(surchargeCfg(p), 'DEBIT_CARD', effMode);
      surchargeCredit = resolveSurcharge(surchargeCfg(p), 'CREDIT_CARD', effMode);
    }

    const line: CartItem = {
      key: `${p.id}:${effMode}`,
      productId: p.id,
      name: p.name,
      unitPrice,
      costPrice: lineCost,
      quantity,
      stockQty: Number(p.stockQty),
      saleMode: effMode,
      unitType,
      baseUnitType: closed ? ('METER' as UnitType) : p.unit,
      conversionFactor: factorToBase,
      closed,
      surchargeDebit,
      surchargeCredit,
    };
    return { line, factorToBase, meterInvalid };
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
    const { line, factorToBase, meterInvalid } = buildCartLine(p, mode, q);
    if (meterInvalid) {
      setError('A venda por metro deve ser em múltiplos de 0,5 m (mín. 0,5 m).');
      return;
    }
    const key = line.key;
    const existing = cart.find((c) => c.key === key);
    const newQty = (existing?.quantity ?? 0) + q;
    // Trava de estoque em UNIDADE-BASE: soma a base já consumida por OUTRAS linhas do mesmo
    // produto — inclusive as linhas de PAR, que também consomem este produto (ADR-015) — mais
    // a base desta linha (EF-3).
    const otherBase = baseUsedByProduct(p.id, key);
    if (otherBase + newQty * factorToBase > line.stockQty) {
      setError(`Estoque insuficiente para "${p.name}" (disponível: ${line.stockQty}).`);
      return;
    }
    if (existing) {
      setCart(cart.map((c) => (c.key === key ? { ...c, quantity: newQty } : c)));
    } else {
      setCart([...cart, { ...line, quantity: q }]);
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
  /**
   * Constrói a linha de PAR (ADR-015): uma linha só com o preço do par; o rateio fica em `pair` para
   * expandir em dois itens no envio. PURA quanto ao estado (não checa estoque nem mexe no carrinho) —
   * reusada por `addPairToCart` e pela reconstrução de orçamento (2.B). `stockQty` = pares possíveis.
   */
  function buildPairCartLine(p: Product, partner: Product, pairPrice: number, quantity: number): CartItem {
    const mainSide = { salePrice: Number(p.salePrice), stockQty: Number(p.stockQty) };
    const partnerSide = { salePrice: Number(partner.salePrice), stockQty: Number(partner.stockQty) };
    return {
      key: `${p.id}:PAIR:${partner.id}`,
      productId: p.id,
      name: `${p.name} + ${partner.name}`,
      // A linha carrega o preço do PAR; o rateio fica guardado em `pair` para o envio.
      unitPrice: pairPrice,
      // Custo do par = soma dos custos, p/ a margem da linha sair correta.
      costPrice: Number(p.costPrice) + Number(partner.costPrice),
      quantity,
      stockQty: pairAvailableQty(mainSide, partnerSide),
      saleMode: 'BASE',
      unitType: p.unit,
      baseUnitType: p.unit,
      conversionFactor: 1,
      // ADR-016: o par consome 1 de cada lado, então os DOIS acréscimos incidem. Somados
      // aqui, entram no preço do par ANTES do rateio — a soma dos dois itens segue exata.
      surchargeDebit: Number(
        (
          surchargePerBaseUnit(surchargeCfg(p), 'DEBIT_CARD') +
          surchargePerBaseUnit(surchargeCfg(partner), 'DEBIT_CARD')
        ).toFixed(4),
      ),
      surchargeCredit: Number(
        (
          surchargePerBaseUnit(surchargeCfg(p), 'CREDIT_CARD') +
          surchargePerBaseUnit(surchargeCfg(partner), 'CREDIT_CARD')
        ).toFixed(4),
      ),
      pair: {
        partnerId: partner.id,
        partnerName: partner.name,
        // Avulsos: o rateio é feito no envio, quando a quantidade final é conhecida.
        mainSalePrice: mainSide.salePrice,
        partnerSalePrice: partnerSide.salePrice,
        partnerStockQty: partnerSide.stockQty,
      },
    };
  }

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
    const line = buildPairCartLine(p, partner, pairPrice, q);
    const key = line.key;
    const existing = cart.find((c) => c.key === key);
    const newQty = (existing?.quantity ?? 0) + q;

    // O par consome 1 de CADA lado: checa os dois estoques, já descontando o que o carrinho
    // consumiu por outras linhas (avulsas ou de outro par).
    const usedMain = baseUsedByProduct(p.id, key);
    const usedPartner = baseUsedByProduct(partner.id, key);
    if (newQty + usedMain > Number(p.stockQty) || newQty + usedPartner > Number(partner.stockQty)) {
      setError(
        `Estoque insuficiente para o par (disponível: ${Math.max(0, line.stockQty - Math.max(usedMain, usedPartner))} par(es)).`,
      );
      return;
    }

    if (existing) {
      setCart(cart.map((c) => (c.key === key ? { ...c, quantity: newQty } : c)));
    } else {
      setCart([...cart, line]);
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

  /** Esvazia o carrinho de uma vez (após a confirmação inline). Limpa memória, espelho e servidor. */
  function limparCarrinho() {
    clearCart();
    setConfirmClear(false);
    setError(null);
  }

  /** Linha vendida por metro (ADR-017): quantidade em múltiplos de 0,5 m. */
  const isMeterLine = (c: CartItem) => c.saleMode === 'ALT' && c.baseUnitType === 'METER';

  /**
   * Edita a quantidade de uma linha JÁ no carrinho (− / + ou digitação direta), reusando a mesma
   * trava de estoque do `addToCart`: base consumida por outras linhas + esta ≤ estoque; o par
   * (ADR-015) checa os dois lados; a venda por metro exige múltiplos de 0,5. Quantidade ≤ 0
   * remove a linha (apagar o campo é um jeito natural de tirar do carrinho).
   */
  function changeLineQty(key: string, nextQty: number) {
    setError(null);
    const item = cart.find((c) => c.key === key);
    if (!item) return;
    if (!(nextQty > 0)) {
      removeFromCart(key);
      return;
    }
    if (isMeterLine(item) && !isValidMeterStep(nextQty)) {
      setError('A venda por metro deve ser em múltiplos de 0,5 m (mín. 0,5 m).');
      return;
    }
    if (item.pair) {
      const mainStock = Number(products.find((p) => p.id === item.productId)?.stockQty ?? item.stockQty);
      const partnerStock = Number(products.find((p) => p.id === item.pair!.partnerId)?.stockQty ?? 0);
      const usedMain = baseUsedByProduct(item.productId, key);
      const usedPartner = baseUsedByProduct(item.pair.partnerId, key);
      if (nextQty + usedMain > mainStock || nextQty + usedPartner > partnerStock) {
        setError(`Estoque insuficiente para o par "${item.name}".`);
        return;
      }
    } else {
      const stock = Number(products.find((p) => p.id === item.productId)?.stockQty ?? item.stockQty);
      const otherBase = baseUsedByProduct(item.productId, key);
      if (otherBase + nextQty * item.conversionFactor > stock) {
        setError(`Estoque insuficiente para "${item.name}" (disponível: ${stock}).`);
        return;
      }
    }
    setCart(cart.map((c) => (c.key === key ? { ...c, quantity: nextQty } : c)));
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
    if (nonCashOverpaid) {
      setError('O valor em cartão/PIX passou do total. Só o dinheiro gera troco.');
      return;
    }
    if (!payStatus.sufficient) {
      setError(`Pagamento insuficiente: falta ${BRL(payStatus.remaining)}.`);
      return;
    }
    setView({ kind: 'review' });
  }

  /** Confirmação: AQUI a venda é efetivada. Online → grava direto na API (estoque baixa, caixa
   *  recebe). Offline com o recurso ligado → enfileira na `outbox` (ADR-011) e o worker sincroniza
   *  quando a rede voltar. Offline sem o recurso → orienta nota manual (não enfileira). */
  async function onConfirmar() {
    setError(null);
    // Venda a prazo (fiado — ADR-019): exige cliente e é online-only nesta fatia.
    if (isCredit && !customerId) {
      setError('Selecione o cliente para a venda a prazo.');
      return;
    }
    if (isCredit && !online) {
      setError('A venda a prazo exige conexão.');
      return;
    }
    // Crédito da loja (ADR-022, Fatia C): exige cliente e conexão (online-only, como o fiado).
    if (storeCreditUsed > 0 && !customerId) {
      setError('Selecione o cliente para usar o crédito da loja.');
      return;
    }
    if (storeCreditUsed > 0 && !online) {
      setError('Usar crédito da loja exige conexão.');
      return;
    }
    // Retirada/entrega futura (ADR-020): online-only nesta fatia (reserva no servidor).
    if (isScheduled && !online) {
      setError('A venda com retirada/entrega futura exige conexão.');
      return;
    }
    // Parcelas que somam o total (troco já fora); o troco (`change`) é o excedente do dinheiro
    // recebido, calculado no core, e é só exibição — a API devolveria 0 porque o enviado fecha o total.
    const persistedPayments = buildPersistedPayments();
    const doneBase = {
      kind: 'done' as const,
      total: totals.total,
      discount: discountValue,
      payments: persistedPayments,
      // Snapshot já reprecificado (ADR-016) — o comprovante imprime o que foi cobrado.
      items: pricedCart,
      date: new Date().toLocaleString('pt-BR'),
      ...(isCredit ? { credit: creditValue, customerName } : {}),
      ...(storeCreditUsed > 0 ? { storeCredit: storeCreditUsed, customerName } : {}),
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
        payments: persistedPayments,
        ...(discountValue > 0 ? { discountAmount: discountValue } : {}),
        // Troco (informativo): viaja na fila e é gravado no sync. Omitido quando 0 (servidor grava 0).
        ...(change > 0 ? { changeAmount: change } : {}),
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
        setView({ ...doneBase, change, pending: true });
        // Cesta persistente (ADR-021): a venda foi enfileirada — esvazia a cesta (o comprovante usa
        // o snapshot em `doneBase.items`, intacto). Evita um carrinho JÁ vendido reaparecer.
        clearCart();
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
      payments: persistedPayments,
      ...(discountValue > 0 ? { discountAmount: discountValue } : {}),
      // Troco (informativo — não entra no caixa). Omitido quando 0: o servidor grava 0 por default.
      ...(change > 0 ? { changeAmount: change } : {}),
      // Venda a prazo (fiado — ADR-019): cliente + valor a prazo + vencimento opcional.
      ...(isCredit
        ? { customerId, creditAmount: creditValue, ...(dueDate ? { dueDate } : {}) }
        : {}),
      // Crédito da loja (ADR-022, Fatia C): valor usado + cliente (o servidor debita o livro-razão).
      ...(storeCreditUsed > 0 ? { creditApplied: storeCreditUsed, customerId } : {}),
      // Cliente do pedido (ADR-020): na retirada futura o cliente é OPCIONAL, mas quando informado
      // é gravado p/ a Entrega sair com nome. (No fiado o `customerId` já entra acima.)
      ...(!isCredit && isScheduled && customerId ? { customerId } : {}),
      // Retirada/entrega futura (ADR-020): modo SCHEDULED + previsão (única ou por item) + a
      // observação livre do pedido. A data por item já vai anexada em cada item por `cartToSaleItems`.
      ...(isScheduled
        ? {
            deliveryMode: 'SCHEDULED' as const,
            perItemSchedule,
            ...(!perItemSchedule && pickupDate ? { scheduledPickupAt: pickupDate } : {}),
            ...(orderNote.trim() ? { notes: orderNote.trim() } : {}),
          }
        : {}),
      // Conversão de orçamento (ADR-024, 2.B): quando o PDV foi aberto a partir de um orçamento, a
      // venda marca-o CONVERTED (no servidor, na transação da venda). Online-only.
      ...(sourceQuote ? { quoteId: sourceQuote.id } : {}),
    };
    const parsed = createSaleSchema.safeParse(payload);
    if (!parsed.success) {
      setError('Não foi possível montar a venda. Verifique o carrinho.');
      return;
    }
    setBusy(true);
    try {
      // A API devolve `change` = pago − total = 0 (as parcelas fecham o total); o troco de exibição
      // é o `change` local, do dinheiro recebido a mais. `orderNumber` (ADR-023) vem no online; no
      // offline a resposta é um stub sem número → comprovante imprime "código pendente".
      const res = await apiPost<{ change: number; orderNumber?: number | null }>('/orders', parsed.data);
      setView({ ...doneBase, change, orderNumber: res?.orderNumber ?? null });
      // ADR-024 (2.B): a venda converteu o orçamento (agora CONVERTED). Esquece a origem para uma
      // eventual "Voltar e editar → concluir" não reenviar o `quoteId` (que daria 409 já convertido).
      setSourceQuote(null);
      setQuoteReview([]);
      // Cesta persistente (ADR-021): venda registrada — esvazia a cesta em todos os aparelhos (o
      // comprovante usa o snapshot em `doneBase.items`). Evita reabrir um carrinho já vendido.
      clearCart();
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
      // O orçamento sai no preço da forma de pagamento selecionada (ADR-016) — por isso o
      // método aparece junto, para o cliente saber a que preço a cotação se refere.
      items: pricedCart,
      date: new Date().toLocaleString('pt-BR'),
    });
  }

  /** Monta os itens do orçamento salvo (ADR-024) a partir do carrinho já reprecificado — UMA linha
   *  por linha de exibição (o par vira "… (par)"; o modo por metro decora a unidade), igual ao
   *  comprovante. O servidor recalcula os totais (fonte única do core). */
  function cartToQuoteItems() {
    let group = 0;
    return pricedCart.flatMap((c) => {
      if (!c.pair) {
        const name =
          c.saleMode === 'ALT'
            ? `${c.name} — ${unitShort(c.unitType)} (${c.conversionFactor} ${unitShort(c.baseUnitType)})`
            : c.name;
        return [
          {
            productId: c.productId,
            productName: name,
            unit: c.unitType,
            saleMode: c.saleMode,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
            total: Number((c.unitPrice * c.quantity).toFixed(2)),
          },
        ];
      }
      // ADR-024 (2.B): o par é gravado FIEL — DOIS itens com o mesmo `pairGroup` e preços rateados
      // (mesmo motor da venda, `splitPairLine`), para reconstruir o par ao reabrir/converter. Na
      // exibição/nota, o `groupPairedItems` (core) volta a juntá-los em UMA linha "A + B".
      group += 1;
      const split = splitPairLine(
        { salePrice: c.pair.mainSalePrice, stockQty: 0 },
        { salePrice: c.pair.partnerSalePrice, stockQty: 0 },
        c.unitPrice, // preço do par
        c.quantity,
      );
      const mainName = products.find((x) => x.id === c.productId)?.name ?? c.name;
      const partnerUnit = products.find((x) => x.id === c.pair!.partnerId)?.unit ?? c.unitType;
      return [
        {
          productId: c.productId,
          productName: mainName,
          unit: c.unitType,
          saleMode: 'BASE' as SaleUnitMode,
          quantity: c.quantity,
          unitPrice: split.mainUnitPrice,
          total: Number((split.mainUnitPrice * c.quantity).toFixed(2)),
          pairGroup: group,
        },
        {
          productId: c.pair.partnerId,
          productName: c.pair.partnerName,
          unit: partnerUnit,
          saleMode: 'BASE' as SaleUnitMode,
          quantity: c.quantity,
          unitPrice: split.pairedUnitPrice,
          total: Number((split.pairedUnitPrice * c.quantity).toFixed(2)),
          pairGroup: group,
        },
      ];
    });
  }

  /**
   * Reconstrói o carrinho a partir de um orçamento salvo (ADR-024, 2.B). Reusa os construtores de
   * linha com preço/estoque ATUAIS do catálogo — a venda/edição parte do preço de hoje, não do
   * congelado. Pares (dois itens de mesmo `pairGroup`) são remontados; orçamentos antigos (par
   * colapsado "X (par)" sem grupo) e produtos que saíram do catálogo entram na lista de revisão.
   */
  function applyQuoteToCart(detail: QuoteDetail, editMode: boolean) {
    const review: string[] = [];
    const newCart: CartItem[] = [];
    const groups = new Map<number, QuoteItem[]>();
    const singles: QuoteItem[] = [];
    for (const it of detail.items) {
      if (it.pairGroup != null) {
        const arr = groups.get(it.pairGroup) ?? [];
        arr.push(it);
        groups.set(it.pairGroup, arr);
      } else {
        singles.push(it);
      }
    }
    for (const it of singles) {
      // Orçamento antigo (2.A) gravava o par como UMA linha "X (par)" sem grupo → parceiro perdido.
      if (it.productName.trim().endsWith('(par)')) {
        review.push(it.productName);
        continue;
      }
      const p = it.productId ? products.find((x) => x.id === it.productId) : undefined;
      if (!p) {
        review.push(it.productName);
        continue;
      }
      const { line } = buildCartLine(p, it.saleMode === 'ALT' ? 'ALT' : 'BASE', Number(it.quantity));
      newCart.push(line);
    }
    for (const arr of groups.values()) {
      const first = arr[0];
      const main = first?.productId ? products.find((x) => x.id === first.productId) : undefined;
      const qty = Number(first?.quantity ?? 0);
      const resolved = main ? resolvePair(main) : null;
      if (!main || !resolved || qty <= 0) {
        review.push(arr.map((a) => a.productName).join(' + '));
        continue;
      }
      newCart.push(buildPairCartLine(main, resolved.partner, resolved.pairPrice, qty));
    }
    setCart(newCart);
    setQuoteReview(review);
    const disc = Number(detail.discountAmount);
    setDiscount(disc > 0 ? String(disc) : '');
    if (detail.customerId) {
      setCustomerId(detail.customerId);
      setCustomerName(detail.customerName ?? '');
    } else {
      setQuoteCustomerName(detail.customerName ?? '');
    }
    if (detail.validUntil) setQuoteValidity(detail.validUntil.slice(0, 10));
    setSourceQuote({
      id: detail.id,
      number: detail.quoteNumber,
      mode: editMode ? 'edit' : 'convert',
      notes: detail.notes,
    });
  }

  /** Salva o orçamento no servidor (ADR-024) — ação EXPLÍCITA (só o que se guarda/encaminha vira
   *  documento O-000045). Mostra a confirmação com o código; a validade/status ajustam-se depois na
   *  tela Orçamentos. Anexa o cliente se um estiver selecionado (fiado/retirada compartilham o campo). */
  async function onSalvarOrcamento() {
    setError(null);
    if (cart.length === 0) {
      setError('Adicione itens para salvar um orçamento.');
      return;
    }
    if (discountTooHigh) {
      setError('O desconto não pode ser maior que o subtotal.');
      return;
    }
    setSavingQuote(true);
    try {
      // Nome de quem é o orçamento: o cadastro (quando vinculado) manda; senão, o nome livre (2.B).
      const freeName = quoteCustomerName.trim();
      const payload = {
        items: cartToQuoteItems(),
        ...(discountValue > 0 ? { discountAmount: discountValue } : {}),
        ...(quoteValidity ? { validUntil: quoteValidity } : {}),
        ...(customerId ? { customerId } : {}),
        ...(freeName ? { customerName: freeName } : {}),
      };
      // Editar rascunho (2.B): salva por cima do MESMO O-… (PATCH com `items`, discriminado pela API)
      // e preserva a observação do orçamento. Fora disso, cria um novo documento (POST).
      const editing = sourceQuote?.mode === 'edit';
      const res =
        editing && sourceQuote
          ? await apiPatch<CreateQuoteResult>(`/quotes/${sourceQuote.id}`, {
              ...payload,
              ...(sourceQuote.notes ? { notes: sourceQuote.notes } : {}),
            })
          : await apiPost<CreateQuoteResult>('/quotes', payload);
      setView({
        kind: 'quote',
        total: totals.total,
        discount: discountValue,
        items: pricedCart,
        date: new Date().toLocaleString('pt-BR'),
        quoteNumber: res.quoteNumber,
        validUntil: quoteValidity
          ? new Date(`${quoteValidity}T12:00:00`).toLocaleDateString('pt-BR')
          : null,
        saved: true,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingQuote(false);
    }
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
    clearCart();
    setConfirmClear(false);
    setPayments([{ method: 'CASH', amount: '' }]);
    setDiscount('');
    // ADR-024 (2.B): esquece o orçamento de origem, o nome livre e a lista de revisão — a próxima
    // venda/orçamento nasce do zero (não reenvia `quoteId`, não reaproveita o nome).
    setSourceQuote(null);
    setQuoteReview([]);
    setQuoteCustomerName('');
    // Limpa a venda a prazo para a próxima venda nascer à vista.
    resetCredit();
    // Limpa o uso de crédito da loja (ADR-022, Fatia C).
    resetStoreCredit();
    // Limpa a retirada futura para a próxima venda nascer no ato (ADR-020).
    resetSchedule();
  }

  /** Limpa/esconde a venda a prazo (usado ao remover a opção e ao iniciar nova venda). */
  function resetCredit() {
    setShowCredit(false);
    setCreditInput('');
    setCustomerId('');
    setCustomerName('');
    setCustomerQuery('');
    setCustomerOptions([]);
    setDueDate('');
  }

  /** Esconde/limpa o uso de crédito da loja (ADR-022, Fatia C). Não mexe no cliente (compartilhado
   *  com fiado/retirada) — só fecha o bloco e zera o valor. */
  function resetStoreCredit() {
    setShowStoreCredit(false);
    setStoreCreditInput('');
  }

  /** Limpa/esconde a retirada futura (ADR-020) — usado ao remover a opção e ao iniciar nova venda. */
  function resetSchedule() {
    setShowSchedule(false);
    setPickupDate('');
    setPerItemSchedule(false);
    setItemPickupDates({});
    setOrderNote('');
  }

  /** Seletor de cliente (busca no servidor por nome) reusado no fiado (obrigatório) e na retirada
   *  futura (opcional). Os dois recursos compartilham o cliente do pedido, então usam o MESMO
   *  estado. `accent` casa a cor da borda com o bloco (âmbar no fiado, índigo na retirada). */
  function renderCustomerPicker(accent: string) {
    return customerId ? (
      <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-gray-200">
        <span className="min-w-0 truncate">
          Cliente: <strong>{customerName}</strong>
          {/* Alerta: este cliente já tem conta em aberto — a venda cai numa dívida existente. */}
          {customerDebt != null && customerDebt > 0 && (
            <span className="ml-2 font-semibold text-red-600">
              Dívida ativa: {BRL(customerDebt)}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            setCustomerId('');
            setCustomerName('');
            setCustomerQuery('');
          }}
          className="shrink-0 text-blue-600 hover:underline"
        >
          trocar
        </button>
      </div>
    ) : (
      <div>
        <input
          value={customerQuery}
          onChange={(e) => setCustomerQuery(e.target.value)}
          placeholder="Buscar cliente por nome…"
          className={`w-full rounded-lg border ${accent} bg-white px-3 py-2 text-sm`}
        />
        {customerOptions.length > 0 && (
          <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white text-sm shadow-sm">
            {customerOptions.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    setCustomerId(o.id);
                    setCustomerName(o.name);
                    setCustomerQuery('');
                    setCustomerOptions([]);
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                >
                  {o.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (!ready) return <p className="text-gray-600">Carregando…</p>;

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
          <Summary items={pricedCart} total={totals.total} discount={discountValue} />
          <PaymentsLines
            payments={buildPersistedPayments()}
            change={change}
            storeCredit={storeCreditUsed}
          />
          {isCredit && (
            <div className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
              <span>A prazo{customerName ? ` — ${customerName}` : ''}</span>
              <span className="font-semibold tabular-nums">{BRL(creditValue)}</span>
            </div>
          )}
          <p className="text-xs text-gray-500">
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
            view.kind === 'quote' && view.saved ? (
              // ADR-024: orçamento SALVO — mostra o código O-000045 e o atalho para a tela Orçamentos.
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
                  Orçamento salvo ✅ {view.quoteNumber ? formatQuoteNumber(view.quoteNumber) : ''}
                </span>
                <Link href="/orcamentos" className="text-sm font-medium text-blue-700 hover:underline">
                  ver em Orçamentos
                </Link>
              </div>
            ) : (
              <p className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700">
                Orçamento (não é venda)
              </p>
            )
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
            <PaymentsLines
              payments={view.payments}
              change={view.change}
              storeCredit={view.storeCredit}
            />
          )}
          {view.kind === 'done' && view.credit && view.credit > 0 ? (
            <div className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
              <span>A prazo{view.customerName ? ` — ${view.customerName}` : ''}</span>
              <span className="font-semibold tabular-nums">{BRL(view.credit)}</span>
            </div>
          ) : null}

          <div className="flex items-center gap-2 border-t border-gray-200 pt-3">
            <span className="text-sm text-gray-600">Imprimir:</span>
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

          {/* ADR-024 (refino de UX): validade + "Salvar orçamento" na prévia. Só enquanto a cotação é
              efêmera (`!saved`); ao salvar, o bloco some e vira o aviso "Orçamento salvo ✅ O-000045".
              Imprimir acima = encaminhar sem guardar; salvar aqui = vira documento localizável. */}
          {isQuote && view.kind === 'quote' && !view.saved && (
            <div className="space-y-2 rounded-lg bg-gray-50 px-3 py-2">
              {/* Nome livre de quem é o orçamento (ADR-024, 2.B) — só quando NÃO há cliente
                  cadastrado vinculado (aí o nome do cadastro é a identidade). */}
              {!customerId && (
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  Nome
                  <input
                    type="text"
                    value={quoteCustomerName}
                    onChange={(e) => setQuoteCustomerName(e.target.value)}
                    maxLength={120}
                    placeholder="De quem é o orçamento (opcional)"
                    className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  Válido até
                  <input
                    type="date"
                    value={quoteValidity}
                    onChange={(e) => setQuoteValidity(e.target.value)}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
                <button
                  onClick={onSalvarOrcamento}
                  disabled={savingQuote}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  {savingQuote
                    ? 'Salvando…'
                    : sourceQuote?.mode === 'edit'
                      ? 'Salvar alterações'
                      : 'Salvar orçamento'}
                </button>
              </div>
            </div>
          )}

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
          payments={view.kind === 'done' ? view.payments : undefined}
          change={view.kind === 'done' ? view.change : undefined}
          creditAmount={view.kind === 'done' ? view.credit : undefined}
          storeCreditAmount={view.kind === 'done' ? view.storeCredit : undefined}
          customerName={view.kind === 'done' ? view.customerName : undefined}
          orderNumber={view.kind === 'done' ? view.orderNumber : undefined} // ADR-023
          quoteNumber={view.kind === 'quote' ? view.quoteNumber : undefined} // ADR-024
          validUntil={view.kind === 'quote' ? view.validUntil : undefined} // ADR-024
        />
      </div>
    );
  }

  // --- PDV (carrinho) ---
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-2xl font-bold">Venda</h1>

      {/* ADR-024 (2.B): o PDV foi aberto a partir de um orçamento — "Gerar venda" (converte ao
          concluir) ou "Editar rascunho" (Salvar grava por cima do mesmo O-…). */}
      {sourceQuote && (
        <div className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm">
          <p className="font-medium text-indigo-900">
            {sourceQuote.mode === 'edit' ? 'Editando o orçamento ' : 'Gerando venda do orçamento '}
            <span className="font-mono">{formatQuoteNumber(sourceQuote.number)}</span>
            {sourceQuote.mode === 'edit'
              ? ' — "Salvar alterações" grava por cima do mesmo código.'
              : ' — conclua a venda para convertê-lo.'}
          </p>
          {quoteReview.length > 0 && (
            <p className="mt-1 text-amber-800">
              ⚠️ Reveja estes itens (par de orçamento antigo ou produto fora do catálogo) e
              re-adicione à mão: {quoteReview.join('; ')}.
            </p>
          )}
        </div>
      )}

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

      {/* PDV em duas colunas (desktop): carrinho + pagamento + total à ESQUERDA (protagonistas),
          busca à DIREITA (fixa ao rolar, resultados só ao digitar). No celular/tablet volta a
          empilhar na ordem do DOM (busca, carrinho, pagamento, total). Posicionamento explícito de
          grid evita reordenar o DOM — cada bloco escolhe sua coluna/linha. */}
      {/* Colunas com `minmax(0,…)` (não `1fr`, que tem mínimo `auto`) para que a coluna possa
          ENCOLHER abaixo do conteúdo — sem isso, a tabela larga do carrinho estica a coluna e a
          página inteira no celular (em vez de rolar dentro do próprio `overflow-x-auto`). No mobile
          é uma coluna única `minmax(0,1fr)`; no desktop, as duas colunas do PDV. */}
      <div className="grid items-start gap-4 [grid-template-columns:minmax(0,1fr)] lg:[grid-template-columns:minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="min-w-0 rounded-2xl bg-white p-4 shadow-sm lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1">
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

        {/* Lista de resultados (autocomplete do PDV): aparece SÓ ao digitar/escanear e mostra
            os produtos que casam com a busca (nome, popular, fabricante ou SKU). Clicar adiciona ao
            carrinho com a quantidade informada. Sem busca, a área fica limpa com uma dica — o foco é
            o carrinho. Estoque zerado fica desabilitado. */}
        {productSearch.trim() ? (
        <ul className="mt-3 max-h-[28rem] divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
          {filteredProducts.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-gray-500">
              {productSearch ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado.'}
            </li>
          ) : (
            filteredProducts.map((p) => {
              const stock = Number(p.stockQty);
              const out = !(stock > 0);
              // ADR-017: unidade fechada (barra/rolo) como principal — botões próprios (barra
              // inteira × por metro) e estoque exibido em barras + sobra em metros.
              const closedP = isClosedPrimary({
                unit: p.unit,
                conversionFactor: p.conversionFactor != null ? Number(p.conversionFactor) : null,
              });
              if (closedP) {
                const barLen = Number(p.conversionFactor);
                const { whole, remainderMeters } = splitWholeAndRemainder(stock, barLen);
                const canMeter = sellsByMeter({
                  unit: p.unit,
                  conversionFactor: barLen,
                  altSalePrice: p.altSalePrice != null ? Number(p.altSalePrice) : null,
                });
                const unitName = unitShort(p.unit);
                return (
                  <li key={p.id} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-gray-500">
                          {p.popularName ? `${p.popularName} · ` : ''}
                          {p.manufacturer ? `${p.manufacturer} · ` : ''}
                          {p.sku}
                        </span>
                      </span>
                      <span className={`shrink-0 text-xs ${out ? 'text-red-500' : 'text-gray-500'}`}>
                        {out
                          ? 'sem estoque'
                          : `est. ${whole} ${unitName.toLowerCase()}${remainderMeters > 0 ? ` + ${remainderMeters} m` : ''}`}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => addToCart(p.id, 'BASE')}
                        disabled={out}
                        title={`1 ${unitName} = ${barLen} m`}
                        className="rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        + {unitName} ({barLen} m) · {BRL(p.salePrice)}
                      </button>
                      {canMeter && (
                        <button
                          type="button"
                          onClick={() => addToCart(p.id, 'ALT')}
                          disabled={out}
                          title="Venda por metro — digite a metragem em múltiplos de 0,5 m no campo Qtd"
                          className="rounded-lg border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          + por metro · {BRL(p.altSalePrice as string)}/m
                        </button>
                      )}
                    </div>
                  </li>
                );
              }
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
                        <span className="block truncate text-xs text-gray-500">
                          {p.popularName ? `${p.popularName} · ` : ''}
                          {p.manufacturer ? `${p.manufacturer} · ` : ''}
                          {p.sku}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-medium">{BRL(p.salePrice)}</span>
                        <span className={`block text-xs ${out ? 'text-red-500' : 'text-gray-500'}`}>
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
                      <span className="block truncate text-xs text-gray-500">
                        {p.popularName ? `${p.popularName} · ` : ''}
                        {p.manufacturer ? `${p.manufacturer} · ` : ''}
                        {p.sku}
                      </span>
                    </span>
                    <span className={`shrink-0 text-xs ${out ? 'text-red-500' : 'text-gray-500'}`}>
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
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-10 text-center text-sm text-gray-500">
            Digite para buscar produtos por nome, apelido, fabricante ou código.
          </p>
        )}
      </div>

      {/* Coluna esquerda (protagonista): carrinho no topo. */}
      <div className="min-w-0 rounded-2xl bg-white shadow-sm lg:col-start-1 lg:row-start-1">
        {/* Cabeçalho do carrinho: título + botão "Limpar carrinho" (só com itens). */}
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2">
          <span className="text-sm font-medium text-gray-700">
            Carrinho
            {cart.length > 0 && <span className="ml-1 text-gray-500">· {cart.length}</span>}
          </span>
          {cart.length > 0 &&
            (confirmClear ? (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-gray-600">Limpar tudo?</span>
                <button
                  type="button"
                  onClick={limparCarrinho}
                  className="rounded-lg bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700"
                >
                  Sim, limpar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="rounded-lg border border-gray-300 px-2 py-1 font-medium text-gray-600 hover:bg-gray-100"
                >
                  Cancelar
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="text-sm font-medium text-red-600 hover:text-red-700"
              >
                Limpar carrinho
              </button>
            ))}
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-blue-200 text-left text-blue-900">
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
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  Carrinho vazio.
                </td>
              </tr>
            ) : (
              pricedCart.map((i) => (
                <tr key={i.key} className="border-t border-gray-100">
                  <td className="px-4 py-2">
                    <span title={itemTooltip(i)} className="cursor-help border-b border-dotted border-gray-300">
                      {i.name}
                    </span>
                    {/* "i" em círculo: abre as informações daquele item (ADR-021). */}
                    <button
                      type="button"
                      onClick={() => setInfoKey(i.key)}
                      className="ml-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gray-300 align-middle text-[10px] font-bold leading-none text-gray-500 hover:border-gray-500 hover:text-gray-700"
                      aria-label={`Informações de ${i.name}`}
                      title="Informações do item"
                    >
                      i
                    </button>
                    {i.saleMode === 'ALT' && !i.pair && (
                      <span className="block text-xs text-gray-500">
                        embalagem fechada · ≈ {i.quantity * i.conversionFactor} {unitShort(i.baseUnitType)}
                      </span>
                    )}
                    {/* Par (ADR-015): mostra que a linha baixa os dois produtos. */}
                    {i.pair && (
                      <span className="block text-xs text-emerald-600">
                        par · baixa 1 de cada produto
                      </span>
                    )}
                    {/* Acréscimo por forma de pagamento (ADR-016): sempre visível na linha —
                        o operador precisa saber por que o preço não é o de tabela. */}
                    {(primaryMethod === 'DEBIT_CARD' ? i.surchargeDebit : primaryMethod === 'CREDIT_CARD' ? i.surchargeCredit : 0) > 0 && (
                      <span className="block text-xs text-amber-600">
                        +{BRL(primaryMethod === 'DEBIT_CARD' ? i.surchargeDebit : i.surchargeCredit)}/un no{' '}
                        {primaryMethod === 'DEBIT_CARD' ? 'débito' : 'crédito'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {/* Edição inline da quantidade: − / + (passo 0,5 no metro, senão 1) e digitação
                        direta. A trava de estoque vive em changeLineQty (mesma regra do addToCart). */}
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => changeLineQty(i.key, i.quantity - (isMeterLine(i) ? 0.5 : 1))}
                        className="h-7 w-7 shrink-0 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                        aria-label={`Diminuir quantidade de ${i.name}`}
                      >
                        −
                      </button>
                      <QtyInput
                        value={i.quantity}
                        min="0"
                        step={isMeterLine(i) ? '0.5' : '1'}
                        onCommit={(n) => changeLineQty(i.key, n)}
                        className="w-14 rounded border border-gray-300 px-1 py-1 text-right"
                        ariaLabel={`Quantidade de ${i.name}`}
                      />
                      <button
                        type="button"
                        onClick={() => changeLineQty(i.key, i.quantity + (isMeterLine(i) ? 0.5 : 1))}
                        className="h-7 w-7 shrink-0 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                        aria-label={`Aumentar quantidade de ${i.name}`}
                      >
                        +
                      </button>
                      <span className="ml-1 w-12 shrink-0 text-left text-xs text-gray-500">
                        {i.pair
                          ? `par${i.quantity > 1 ? 'es' : ''}`
                          : i.saleMode === 'ALT' && !i.pair
                            ? unitShort(i.unitType)
                            : ''}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">{BRL(i.unitPrice)}</td>
                  <td className="px-4 py-2 text-right">{BRL(i.unitPrice * i.quantity)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => removeFromCart(i.key)} className="text-gray-500 hover:text-red-600">
                      remover
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Coluna esquerda: pagamento (linha 2). */}
      <div className="min-w-0 space-y-3 rounded-2xl bg-white p-4 shadow-sm lg:col-start-1 lg:row-start-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium">Formas de pagamento</label>
            <button
              type="button"
              onClick={addLine}
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              + Adicionar forma
            </button>
          </div>

          {/* A 1ª forma (principal) reprecifica o carrinho (ADR-016). O aviso explica a diferença
              de preço antes de o cliente perguntar; numa venda dividida, deixa claro quem manda no preço. */}
          {surchargeTotal > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Acréscimo de <strong>{BRL(surchargeTotal)}</strong> no{' '}
              {primaryMethod === 'DEBIT_CARD' ? 'débito' : 'crédito'} — já incluído nos preços acima.
              {payments.length > 1 && ' A 1ª forma define o preço.'}
            </p>
          )}

          {/* Uma linha por forma. O valor vazio assume o "resto" (placeholder mostra quanto) — então
              uma forma só não exige digitar nada. No dinheiro, o valor é o RECEBIDO (gera troco). */}
          <div className="space-y-2">
            {payments.map((line, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={line.method}
                  onChange={(e) => setLine(i, { method: e.target.value as PaymentMethod })}
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-2"
                >
                  {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                      {payments.length > 1 && i === 0 ? ' (principal)' : ''}
                    </option>
                  ))}
                </select>
                <MoneyInput
                  value={line.amount}
                  onChange={(v) => setLine(i, { amount: v })}
                  placeholder={BRL(resolvedPayments[i]?.amount ?? 0)}
                  className="w-28 rounded-lg border border-gray-300 px-2 py-2 text-right"
                />
                {payments.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    className="shrink-0 rounded-lg px-2 py-2 text-lg leading-none text-gray-500 hover:text-red-600"
                    aria-label="Remover forma"
                    title="Remover forma"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          {hasCashLine && (
            <p className="text-xs text-gray-500">
              No dinheiro, informe o valor recebido — o troco é calculado automaticamente.
            </p>
          )}

          {/* Situação do recebimento: falta, troco ou pago exato. */}
          <div className="rounded-lg bg-gray-50 px-3 py-2 ring-1 ring-gray-200">
            {payStatus.remaining > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-red-800">Falta receber</span>
                <span className="text-lg font-bold text-red-700">{BRL(payStatus.remaining)}</span>
              </div>
            ) : change > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-green-800">Troco</span>
                <span className="text-2xl font-bold text-green-700">{BRL(change)}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Pago</span>
                <span className="text-lg font-bold text-gray-900">{BRL(payStatus.paid)}</span>
              </div>
            )}
            {payments.length > 1 && (
              <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                <span>Total da venda</span>
                <span>{BRL(totals.total)}</span>
              </div>
            )}
          </div>
          {nonCashOverpaid && (
            <p className="text-xs text-red-600">
              O valor em cartão/PIX passou do total. Ajuste as parcelas — só o dinheiro gera troco.
            </p>
          )}

          {/* Venda a prazo (ADR-019) — opt-in: escondida por padrão para o PDV ficar limpo (padrão
              dos bons PDVs). Um clique revela o bloco; o "×" remove e volta para venda à vista. */}
          {!showCredit ? (
            <button
              type="button"
              onClick={() => setShowCredit(true)}
              className="block text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              + Venda a prazo
            </button>
          ) : (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="credit" className="text-sm font-semibold text-amber-900">
                  A prazo
                </label>
                <div className="flex items-center gap-1">
                  <MoneyInput
                    id="credit"
                    value={creditInput}
                    onChange={setCreditInput}
                    placeholder="0,00"
                    className="w-28 rounded-lg border border-amber-300 bg-white px-2 py-1 text-right"
                  />
                  <button
                    type="button"
                    onClick={resetCredit}
                    className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-gray-500 hover:text-red-600"
                    aria-label="Remover venda a prazo"
                    title="Remover venda a prazo"
                  >
                    ×
                  </button>
                </div>
              </div>
              {isCredit && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-amber-200">
                    <span className="text-gray-600">A pagar agora</span>
                    <span className="font-semibold tabular-nums">{BRL(payableNow)}</span>
                  </div>
                  {/* Cliente devedor (obrigatório): busca no servidor por nome. */}
                  {renderCustomerPicker('border-amber-300')}
                  <div className="flex items-center justify-between">
                    <label htmlFor="due" className="text-sm text-gray-600">
                      Vencimento (opcional)
                    </label>
                    <input
                      id="due"
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-sm"
                    />
                  </div>
                  {!customerId && (
                    <p className="text-xs text-amber-700">Selecione o cliente para concluir a venda a prazo.</p>
                  )}
                  {!online && (
                    <p className="text-xs text-red-600">A venda a prazo exige conexão.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Usar crédito da loja (ADR-022, Fatia C) — opt-in, escondido por padrão. Abate o
              `creditBalance` do cliente; espelha o fiado (reduz o "a pagar agora"). */}
          {!showStoreCredit ? (
            <button
              type="button"
              onClick={() => setShowStoreCredit(true)}
              className="mt-2 block text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              + Usar crédito da loja
            </button>
          ) : (
            <div className="space-y-3 rounded-xl border border-green-200 bg-green-50/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-green-900">Crédito da loja</span>
                <button
                  type="button"
                  onClick={resetStoreCredit}
                  className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-gray-500 hover:text-red-600"
                  aria-label="Remover uso de crédito"
                  title="Remover uso de crédito"
                >
                  ×
                </button>
              </div>
              {/* Cliente dono do crédito — quando o fiado não está coletando o cliente. */}
              {!showCredit && (
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Cliente</label>
                  {renderCustomerPicker('border-green-300')}
                </div>
              )}
              {!customerId ? (
                <p className="text-xs text-green-800">
                  Selecione o cliente para ver o crédito disponível.
                </p>
              ) : creditAvailable <= 0 ? (
                <p className="text-xs text-gray-600">Este cliente não tem crédito a favor.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-green-200">
                    <span className="text-gray-600">Crédito disponível</span>
                    <span className="font-semibold tabular-nums text-green-700">
                      {BRL(creditAvailable)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="store-credit" className="text-sm text-gray-600">
                      Usar
                    </label>
                    <div className="flex items-center gap-1">
                      <MoneyInput
                        id="store-credit"
                        value={storeCreditInput}
                        onChange={setStoreCreditInput}
                        placeholder="0,00"
                        className="w-28 rounded-lg border border-green-300 bg-white px-2 py-1 text-right"
                      />
                      <button
                        type="button"
                        onClick={() => setStoreCreditInput(String(maxStoreCredit))}
                        className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:underline"
                        title={`Usar até ${BRL(maxStoreCredit)}`}
                      >
                        usar máx.
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-green-200">
                    <span className="text-gray-600">A pagar agora</span>
                    <span className="font-semibold tabular-nums">{BRL(payableNow)}</span>
                  </div>
                  {/* Aviso quando o operador digita mais que o aplicável — usamos só o máximo. */}
                  {Number(storeCreditInput) > maxStoreCredit + 0.005 && (
                    <p className="text-xs text-amber-700">
                      Máximo aplicável nesta venda: {BRL(maxStoreCredit)}. Usando {BRL(storeCreditUsed)}.
                    </p>
                  )}
                  {!online && <p className="text-xs text-red-600">Usar crédito exige conexão.</p>}
                </div>
              )}
            </div>
          )}

          {/* Retirada / entrega futura (ADR-020) — opt-in, escondida por padrão (PDV limpo). Reserva
              a mercadoria: o estoque só baixa na retirada (tela de Entregas). Compõe com o fiado. */}
          {!showSchedule ? (
            <button
              type="button"
              onClick={() => setShowSchedule(true)}
              className="mt-2 block text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              + Venda com retirada/entrega posterior
            </button>
          ) : (
            <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-indigo-900">
                  Retirada/entrega posterior
                </span>
                <button
                  type="button"
                  onClick={resetSchedule}
                  className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-gray-500 hover:text-red-600"
                  aria-label="Remover retirada futura"
                  title="Remover retirada futura"
                >
                  ×
                </button>
              </div>
              <p className="text-xs text-indigo-800">
                A mercadoria fica <strong>reservada</strong> e sai do estoque na retirada. Acompanhe
                e dê baixa (parcial ou total) na tela <strong>Entregas</strong>.
              </p>

              {/* Previsão única do pedido (quando não é por item). */}
              {!perItemSchedule && (
                <div className="flex items-center justify-between">
                  <label htmlFor="pickup" className="text-sm text-gray-600">
                    Previsão de retirada (opcional)
                  </label>
                  <input
                    id="pickup"
                    type="date"
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                    className="rounded-lg border border-indigo-300 bg-white px-2 py-1 text-sm"
                  />
                </div>
              )}

              {/* Flag "Data por item": libera um campo de data por linha do carrinho. */}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={perItemSchedule}
                  onChange={(e) => setPerItemSchedule(e.target.checked)}
                  className="h-4 w-4 rounded border-indigo-300"
                />
                Data por item
              </label>

              {perItemSchedule && (
                <div className="space-y-2">
                  {cart.length === 0 ? (
                    <p className="text-xs text-gray-500">Adicione itens ao carrinho para definir as datas.</p>
                  ) : (
                    cart.map((c) => (
                      <div key={c.key} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{c.name}</span>
                        <input
                          type="date"
                          value={itemPickupDates[c.key] ?? ''}
                          onChange={(e) =>
                            setItemPickupDates((prev) => ({ ...prev, [c.key]: e.target.value }))
                          }
                          className="rounded-lg border border-indigo-300 bg-white px-2 py-1 text-sm"
                        />
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Cliente (opcional) — para a Entrega sair com nome. Se o fiado ou o crédito da loja já
                  coletam o cliente (mesmo estado), aqui não repete o seletor. */}
              {!showCredit && !showStoreCredit && (
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Cliente (opcional)</label>
                  {renderCustomerPicker('border-indigo-300')}
                </div>
              )}

              {/* Observação livre do pedido — informações gerais que quem abrir a Entrega precisa ver
                  (ex.: "quem retira não é quem comprou"). Editável também no detalhe da Entrega. */}
              <div>
                <label htmlFor="ordernote" className="mb-1 block text-sm text-gray-600">
                  Observação do pedido (opcional)
                </label>
                <textarea
                  id="ordernote"
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Ex.: quem vai retirar é o pedreiro João; ligar antes de separar…"
                  className="w-full rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              {!online && (
                <p className="text-xs text-red-600">
                  A venda com retirada/entrega futura exige conexão.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Coluna esquerda: total + desconto + ações (linha 3). */}
        <div className="flex min-w-0 flex-col justify-between rounded-2xl bg-white p-4 shadow-sm lg:col-start-1 lg:row-start-3">
          <div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-gray-600">
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
              <MoneyInput
                id="desc"
                value={discount}
                onChange={setDiscount}
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
              disabled={
                cart.length === 0 ||
                discountTooHigh ||
                !payStatus.sufficient ||
                nonCashOverpaid ||
                (isCredit && (!customerId || !online))
              }
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
          {/* ADR-024 (refino de UX): "Orçamento" é o botão único — gera a prévia. A validade e o
              "Salvar orçamento" vivem na tela de prévia (junto do "Imprimir"), onde o operador decide
              imprimir (efêmero) OU salvar (vira o documento O-000045). Sem bloco extra no carrinho. */}
        </div>
      </div>

      {/* Modal de informações do item (ADR-021): cruza a linha da cesta com o produto do catálogo. */}
      {infoKey &&
        (() => {
          const it = pricedCart.find((c) => c.key === infoKey);
          if (!it) return null;
          return (
            <CartItemInfo
              item={it}
              product={products.find((p) => p.id === it.productId)}
              primaryMethod={primaryMethod}
              cardFees={cardFees}
              onClose={() => setInfoKey(null)}
            />
          );
        })()}
    </div>
  );
}
