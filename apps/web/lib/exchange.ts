/**
 * Carry do VALE-TROCA (ADR-033, Fatia 3) do Histórico para o PDV. Espelha o `lib/reorder.ts`: a
 * tela de Vendas registra a devolução com `intent = EXCHANGE`, guarda o vale no sessionStorage e
 * navega para `/venda`; o PDV lê UMA vez, mostra o banner da troca, abate o vale do "a pagar" e
 * envia `exchangeReturnId` na venda (o servidor amarra a devolução à venda e grava a parcela
 * `EXCHANGE_CREDIT`). sessionStorage (não local): é um repasse de navegação, não deve sobreviver a
 * fechar a aba nem vazar entre dispositivos.
 */
const KEY = 'nexoloja:exchange';

export type ExchangePayload = {
  returnId: string; // a devolução EXCHANGE que gerou o vale
  credit: number; // valor do vale (em R$)
  fromOrderNumber: number; // V-000XXX da venda de origem (p/ o banner)
};

export function writeExchangePayload(payload: ExchangePayload): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage indisponível (aba privada/limitada): a troca simplesmente não acontece.
  }
}

/** Lê e REMOVE o vale pendente (consumo único, como o reorder). */
export function takeExchangePayload(): ExchangePayload | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const p = JSON.parse(raw) as ExchangePayload;
    if (!p || typeof p.returnId !== 'string' || typeof p.credit !== 'number') return null;
    return p;
  } catch {
    return null;
  }
}
