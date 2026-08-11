'use client';

import {
  formatCnpj,
  formatOrderNumber,
  formatPhoneBr,
  PAYMENT_METHOD_LABELS,
  RECEIVABLE_STATUS_LABELS,
  type CustomerAccountDetail,
  type PaymentMethod,
  type ReceivableDetail,
} from '@nexoloja/shared';
import type { Store } from '@/components/ReceiptPrint';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Cabeçalho da loja (logo/nome/CNPJ/telefone), comum aos documentos imprimíveis. */
function StoreHeader({ store }: { store: Store | null }) {
  return (
    <header className="rc-head">
      {store?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={store.logoUrl} alt="" className="rc-logo" />
      ) : null}
      <div className="rc-store">{store?.name ?? 'Loja'}</div>
      {store?.cnpj ? <div className="rc-sub">CNPJ: {formatCnpj(store.cnpj)}</div> : null}
      {store?.phone ? <div className="rc-sub">{formatPhoneBr(store.phone)}</div> : null}
    </header>
  );
}

/**
 * Documento imprimível do RESUMO DE UMA DÍVIDA (conta a receber — ADR-019/022). Espelha o
 * `ReceiptPrint`: fica oculto na tela e só aparece na impressão (regras `@media print` em
 * globals.css, reusa as classes `rc-*`), funcionando em 80mm e A4. Cabeçalho da loja + código da
 * venda de origem (V-000128) + situação (original/recebido/devolvido/saldo) + itens + recebimentos.
 * O nome do PDF (V-000128.pdf) é definido por quem chama `printArea` (ver lib/print.ts).
 */
export function ReceivablePrint({ store, detail }: { store: Store | null; detail: ReceivableDetail }) {
  const returned = Number(detail.returnedAmount ?? 0);
  const code = formatOrderNumber(detail.orderNumber);
  return (
    <div id="print-area" data-model="80mm">
      <StoreHeader store={store} />

      <div className="rc-title">RESUMO DA DÍVIDA</div>
      {code ? <div className="rc-code">Venda {code}</div> : null}
      <div className="rc-date">
        {detail.customerName ?? 'Cliente'} ·{' '}
        {new Date(detail.orderCreatedAt ?? detail.createdAt).toLocaleString('pt-BR')}
      </div>

      {/* Situação da dívida. */}
      <div className="rc-pay">
        <div>
          <span>Original</span>
          <span>{BRL(detail.originalAmount)}</span>
        </div>
        <div>
          <span>Recebido</span>
          <span>{BRL(detail.settledAmount)}</span>
        </div>
        {returned > 0 ? (
          <div>
            <span>Devolvido</span>
            <span>{BRL(detail.returnedAmount)}</span>
          </div>
        ) : null}
        <div>
          <span>Situação</span>
          <span>{RECEIVABLE_STATUS_LABELS[detail.status]}</span>
        </div>
        {detail.dueDate ? (
          <div>
            <span>Vencimento</span>
            <span>{new Date(detail.dueDate).toLocaleDateString('pt-BR')}</span>
          </div>
        ) : null}
      </div>

      <div className="rc-total">
        <span>SALDO DEVEDOR</span>
        <span>{BRL(detail.balance)}</span>
      </div>

      {/* Itens da venda que originou a dívida. */}
      <table className="rc-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="right">Qtd</th>
            <th className="right">Total</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((it, idx) => (
            <tr key={idx}>
              <td>{it.productName}</td>
              <td className="right">{Number(it.quantity)}</td>
              <td className="right">{BRL(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Recebimentos (com data e forma). */}
      {detail.payments.length > 0 ? (
        <div className="rc-pay">
          <div>
            <span style={{ fontWeight: 700 }}>Recebimentos</span>
            <span />
          </div>
          {detail.payments.map((p) => (
            <div key={p.id}>
              <span>
                {new Date(p.paidAt).toLocaleDateString('pt-BR')} ·{' '}
                {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
              </span>
              <span>{BRL(p.amount)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Devoluções desta venda (ADR-022, Fatia B) — evento próprio. */}
      {(detail.returns ?? []).length > 0 ? (
        <div className="rc-pay">
          <div>
            <span style={{ fontWeight: 700 }}>Devoluções</span>
            <span />
          </div>
          {(detail.returns ?? []).map((rt) => (
            <div key={rt.id}>
              <span>{new Date(rt.createdAt).toLocaleDateString('pt-BR')}</span>
              <span>− {BRL(rt.totalValue)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <footer className="rc-foot">
        Resumo de conta a receber — documento sem valor fiscal.
      </footer>
    </div>
  );
}

/**
 * Documento imprimível do RESUMO DA CONTA de um cliente (visão "Por Cliente" — ADR-022): tudo o que
 * ele deve, consolidado. Espelha o `ReceivablePrint`, mas no nível da CONTA (não de uma venda):
 * saldo devedor total + crédito a favor + as dívidas em aberto (uma por venda, com código e saldo)
 * + os itens em aberto somados por produto (líquido de devoluções). O PDF é nomeado pelo cliente
 * (ver `CustomerAccountModal`).
 */
export function CustomerAccountPrint({
  store,
  detail,
}: {
  store: Store | null;
  detail: CustomerAccountDetail;
}) {
  // Só as dívidas ainda EM ABERTO (saldo > 0) — o resumo é do que o cliente deve hoje.
  const openDebts = detail.receivables.filter((r) => r.balance > 0);
  return (
    <div id="print-area" data-model="80mm">
      <StoreHeader store={store} />

      <div className="rc-title">RESUMO DA CONTA</div>
      <div className="rc-date">
        {detail.customerName ?? 'Cliente'} · emitido em {new Date().toLocaleString('pt-BR')}
      </div>

      <div className="rc-total">
        <span>SALDO DEVEDOR</span>
        <span>{BRL(detail.totalBalance)}</span>
      </div>
      <div className="rc-pay">
        <div>
          <span>Dívidas em aberto</span>
          <span>{detail.openCount}</span>
        </div>
        {detail.creditBalance > 0 ? (
          <div>
            <span>Crédito a favor</span>
            <span>{BRL(detail.creditBalance)}</span>
          </div>
        ) : null}
      </div>

      {/* Dívidas em aberto, uma por venda (código + data + saldo). */}
      {openDebts.length > 0 ? (
        <table className="rc-table">
          <thead>
            <tr>
              <th>Dívida</th>
              <th className="right">Data</th>
              <th className="right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {openDebts.map((r) => (
              <tr key={r.id}>
                <td>{formatOrderNumber(r.orderNumber) || '—'}</td>
                <td className="right">{new Date(r.createdAt).toLocaleDateString('pt-BR')}</td>
                <td className="right">{BRL(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {/* Itens em aberto (consolidado por produto, líquido de devoluções). */}
      {(detail.openItems ?? []).length > 0 ? (
        <>
          <div className="rc-code" style={{ textAlign: 'left', marginTop: 8 }}>
            Itens em aberto
          </div>
          <table className="rc-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="right">Qtd</th>
                <th className="right">Total</th>
              </tr>
            </thead>
            <tbody>
              {(detail.openItems ?? []).map((it, idx) => (
                <tr key={idx}>
                  <td>{it.productName}</td>
                  <td className="right">{Number(it.quantity)}</td>
                  <td className="right">{BRL(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <footer className="rc-foot">
        Resumo da conta do cliente — documento sem valor fiscal.
      </footer>
    </div>
  );
}
