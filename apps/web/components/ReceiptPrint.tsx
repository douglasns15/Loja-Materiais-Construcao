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

// Progresso de retirada por item (ADR-020), em unidade-base (mesma base de `deliveredBaseQty`/
// `remainingBaseQty` do servidor): quanto já saiu e quanto falta. Alimenta o bloco "Situação da
// retirada" na REIMPRESSÃO do comprovante — o cupom do PDV (venda recém-concluída) não passa isto.
export type ReceiptPickupLine = { name: string; delivered: number; remaining: number };

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
  /** Retirada/entrega futura (ADR-020): imprime a faixa em destaque "FALTA RETIRAR — traga esta nota
   *  para retirar a mercadoria". Usado no comprovante de retirada (PDV e tela de Entregas). */
  pickupNotice?: boolean;
  /** Quando o comprovante de retirada é de uma venda 100% paga (sem saldo a prazo), a faixa mostra
   *  "PAGO — FALTA RETIRAR"; numa venda a prazo (saldo em aberto) mostra só "FALTA RETIRAR". */
  pickupPaid?: boolean;
  /** Progresso da retirada por item (ADR-020). Passado só na REIMPRESSÃO pela tela de Entregas; a
   *  partir dele o comprovante mostra o bloco "Situação da retirada" (retirou X · falta Y) e adapta
   *  a faixa (RETIRADA PARCIAL / RETIRADA CONCLUÍDA). Ausente no cupom do PDV ⇒ comportamento antigo. */
  pickupLines?: ReceiptPickupLine[];
};

const BRL = (v: number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Quantidade sem casas inúteis (5 em vez de 5,0000; mantém frações reais como 2,5).
const QTY = (v: number) => {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
};

/**
 * Documento imprimível (comprovante de venda OU orçamento). Fica oculto na tela
 * e só aparece na impressão (ver regras @media print em globals.css). O modelo
 * (80mm / A4) é controlado pelo atributo data-model, definido antes de imprimir.
 */
export function ReceiptPrint({ kind, store, items, total, date, discount, payments, method, change, creditAmount, storeCreditAmount, customerName, orderNumber, quoteNumber, validUntil, pickupNotice, pickupPaid, pickupLines }: Props) {
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
  // Dinheiro recebido (só quando houve troco): as parcelas guardam o dinheiro APLICADO (que fecha o
  // total); o recebido = aplicado + troco. Mostrar o quanto o cliente entregou, além do troco.
  const hasChange = (change ?? 0) > 0;
  const cashApplied = pays.reduce((acc, p) => (p.method === 'CASH' ? acc + p.amount : acc), 0);
  const cashReceived = cashApplied + (change ?? 0);
  // Progresso da retirada (ADR-020): só existe na reimpressão pela tela de Entregas. `pickupStarted`
  // = já houve ao menos uma retirada parcial (o bloco só aparece então; no cupom do PDV recém-vendido
  // nada saiu ⇒ não passa `pickupLines`). `pickupDone` = nada mais falta.
  const pickupDelivered = pickupLines?.reduce((acc, l) => acc + l.delivered, 0) ?? 0;
  const pickupRemaining = pickupLines?.reduce((acc, l) => acc + l.remaining, 0) ?? 0;
  const pickupStarted = pickupDelivered > 0;
  const pickupDone = !!pickupLines && pickupLines.length > 0 && pickupRemaining <= 0;
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

      {/* Comprovante de retirada (ADR-020): faixa em destaque. "Pago" só quando não há saldo a prazo.
          Quando há progresso de retirada (reimpressão): "RETIRADA PARCIAL" enquanto falta algo e
          "RETIRADA CONCLUÍDA" quando tudo saiu. Sem `pickupLines` (cupom do PDV) ⇒ texto antigo. */}
      {pickupNotice ? (
        <div className="rc-notice">
          <div className="rc-notice-title">
            {pickupDone
              ? '✔ RETIRADA CONCLUÍDA'
              : `${pickupPaid ? '✔ PAGO — ' : ''}${pickupStarted ? 'RETIRADA PARCIAL — ' : ''}FALTA RETIRAR`}
          </div>
          <div className="rc-notice-text">
            {pickupDone
              ? 'Toda a mercadoria já foi retirada.'
              : 'Traga esta nota para retirar a mercadoria.'}
          </div>
        </div>
      ) : null}

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
          {hasChange ? (
            <div>
              <span>Dinheiro recebido</span>
              <span>{BRL(cashReceived)}</span>
            </div>
          ) : null}
          {hasChange ? (
            <div>
              <span>Troco</span>
              <span>{BRL(change as number)}</span>
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

      {/* Situação da retirada (ADR-020): só na reimpressão APÓS uma retirada parcial. Lista cada item
          com o que já saiu e o que ainda falta (em unidade-base, como o rastreio de estoque), com
          "falta" em destaque; linha zerada vira "retirado ✓". Fecha o gap de reimprimir a nota e ela
          seguir mostrando as quantidades cheias sem dizer o que já foi retirado. */}
      {pickupNotice && pickupStarted ? (
        <div className="rc-pickup">
          <div className="rc-pickup-head">SITUAÇÃO DA RETIRADA</div>
          {pickupLines!.map((l, idx) => (
            <div className="rc-pickup-row" key={idx}>
              <span className="rc-pickup-name">{l.name}</span>
              <span className="rc-pickup-qty">
                {l.remaining > 0 ? (
                  <>
                    retirou {QTY(l.delivered)} · <strong>falta {QTY(l.remaining)}</strong>
                  </>
                ) : (
                  'retirado ✓'
                )}
              </span>
            </div>
          ))}
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
