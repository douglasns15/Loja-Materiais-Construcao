'use client';

import {
  formatCnpj,
  formatOrderNumber,
  formatPhoneBr,
  formatQuoteNumber,
  paymentMethodLabel,
  type PaymentMethod,
} from '@nexoloja/shared';

export type Store = {
  name: string;
  logoUrl: string | null;
  cnpj: string | null;
  phone: string | null;
};

export type ReceiptItem = { name: string; quantity: number; unitPrice: number };

// `method` aceita string livre: a reimpressão do histórico traz parcelas já gravadas, inclusive
// "STORE_CREDIT" (crédito da loja, ADR-022 Fatia C), que não está no enum das 4 formas de balcão.
export type ReceiptPayment = { method: PaymentMethod | string; amount: number };

type Props = {
  kind: 'sale' | 'quote';
  store: Store | null;
  items: ReceiptItem[];
  total: number;
  date: string;
  discount?: number;
  /** Formas de pagamento da venda (uma ou mais). Preferir sobre `method`. */
  payments?: ReceiptPayment[];
  /** Compat: uma forma só (usado antes do pagamento dividido). */
  method?: PaymentMethod;
  change?: number;
  /** Venda a prazo (fiado — ADR-019): valor deixado a prazo; imprime a linha "A prazo". */
  creditAmount?: number;
  /** Crédito da loja usado (ADR-022, Fatia C): imprime a linha "Crédito da loja". Usado quando o
   *  crédito NÃO vem dentro de `payments` (venda recém-concluída no PDV). */
  storeCreditAmount?: number;
  /** Nome do cliente devedor (venda a prazo) — impresso junto da linha "A prazo". */
  customerName?: string | null;
  /** Código sequencial da venda (ADR-023): impresso como "Venda V-000128" abaixo do título. Só em
   *  vendas. Ausente/0 (venda offline ainda não sincronizada) imprime "código pendente". */
  orderNumber?: number | null;
  /** Código do orçamento salvo (ADR-024): impresso como "O-000045" abaixo do título. Só em orçamentos
   *  SALVOS; a cotação efêmera (não salva) não tem número. */
  quoteNumber?: number | null;
  /** Validade do orçamento (ADR-024), já formatada (ex.: "07/08/2026"). Imprime "Válido até …". */
  validUntil?: string | null;
};

const BRL = (v: number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Documento imprimível (comprovante de venda OU orçamento). Fica oculto na tela
 * e só aparece na impressão (ver regras @media print em globals.css). O modelo
 * (80mm / A4) é controlado pelo atributo data-model, definido antes de imprimir.
 */
export function ReceiptPrint({ kind, store, items, total, date, discount, payments, method, change, creditAmount, storeCreditAmount, customerName, orderNumber, quoteNumber, validUntil }: Props) {
  const isQuote = kind === 'quote';
  const subtotal = items.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0);
  const hasDiscount = (discount ?? 0) > 0;
  // Normaliza as formas de pagamento: usa `payments` (pagamento dividido) ou cai no `method` único.
  const pays: ReceiptPayment[] =
    payments && payments.length > 0 ? payments : method ? [{ method, amount: total }] : [];
  const storeCredit = storeCreditAmount ?? 0;
  // "Dividido" quando há mais de uma forma somando o pagamento (incluindo o crédito da loja).
  const multiPay = pays.length + (storeCredit > 0 ? 1 : 0) > 1;
  const hasPayBlock = pays.length > 0 || storeCredit > 0 || (creditAmount ?? 0) > 0;
  return (
    <div id="print-area" data-model="80mm">
      <header className="rc-head">
        {store?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={store.logoUrl} alt="" className="rc-logo" />
        ) : null}
        <div className="rc-store">{store?.name ?? 'Loja'}</div>
        {store?.cnpj ? <div className="rc-sub">CNPJ: {formatCnpj(store.cnpj)}</div> : null}
        {store?.phone ? <div className="rc-sub">{formatPhoneBr(store.phone)}</div> : null}
      </header>

      <div className={`rc-title ${isQuote ? 'quote' : ''}`}>
        {isQuote ? 'ORÇAMENTO' : 'COMPROVANTE DE VENDA'}
      </div>
      {/* Código do documento. Venda (ADR-023): sempre — offline sem número ⇒ "código pendente".
          Orçamento (ADR-024): só quando SALVO (tem número); a cotação efêmera não tem código. */}
      {isQuote ? (
        quoteNumber ? <div className="rc-code">{formatQuoteNumber(quoteNumber)}</div> : null
      ) : (
        <div className="rc-code">
          {formatOrderNumber(orderNumber) || 'Código pendente de sincronização'}
        </div>
      )}
      <div className="rc-date">{date}</div>
      {isQuote && validUntil ? <div className="rc-date">Válido até {validUntil}</div> : null}

      <table className="rc-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="right">Qtd</th>
            <th className="right">Unit.</th>
            <th className="right">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, idx) => (
            <tr key={idx}>
              <td>{i.name}</td>
              <td className="right">{i.quantity}</td>
              <td className="right">{BRL(i.unitPrice)}</td>
              <td className="right">{BRL(i.unitPrice * i.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {hasDiscount ? (
        <div className="rc-pay">
          <div>
            <span>Subtotal</span>
            <span>{BRL(subtotal)}</span>
          </div>
          <div>
            <span>Desconto</span>
            <span>− {BRL(discount ?? 0)}</span>
          </div>
        </div>
      ) : null}

      <div className="rc-total">
        <span>TOTAL</span>
        <span>{BRL(total)}</span>
      </div>

      {!isQuote && hasPayBlock ? (
        <div className="rc-pay">
          {pays.map((p, idx) => (
            <div key={idx}>
              {/* Uma forma só: "Pagamento — Dinheiro". Dividido: uma linha por forma, com o valor. */}
              <span>{multiPay ? paymentMethodLabel(p.method) : 'Pagamento'}</span>
              <span>{multiPay ? BRL(p.amount) : paymentMethodLabel(p.method)}</span>
            </div>
          ))}
          {storeCredit > 0 ? (
            <div>
              <span>Crédito da loja</span>
              <span>{BRL(storeCredit)}</span>
            </div>
          ) : null}
          {change && change > 0 ? (
            <div>
              <span>Troco</span>
              <span>{BRL(change)}</span>
            </div>
          ) : null}
          {creditAmount && creditAmount > 0 ? (
            <div>
              <span>A prazo{customerName ? ` — ${customerName}` : ''}</span>
              <span>{BRL(creditAmount)}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <footer className="rc-foot">
        {isQuote
          ? 'Este documento é um ORÇAMENTO — não é documento fiscal. Valores sujeitos a alteração.'
          : 'Documento sem valor fiscal.'}
      </footer>
    </div>
  );
}
