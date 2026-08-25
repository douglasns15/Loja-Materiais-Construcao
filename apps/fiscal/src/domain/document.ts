/**
 * Regras puras do documento fiscal: totais, transições de estado e validação
 * do pedido de emissão. Sem I/O — testável com Vitest, reusável no servidor.
 *
 * Tudo em CENTAVOS (inteiro). Quantidade em MILÉSIMOS DE MILÉSIMO (×10.000),
 * espelhando o `Decimal(12,4)` de `OrderItem.quantity` no schema.
 */

import type { FiscalItem, FiscalStatus, IssueRequest } from './types';
import { isValidCnpj, isValidTaxpayerDocument, onlyDigits } from './taxpayer';

/** Escala da quantidade: 4 casas decimais, como no schema do Prisma. */
export const QUANTITY_SCALE = 10_000;

/**
 * Total de uma linha, em centavos: `quantidade × preço unitário − desconto`.
 *
 * A multiplicação é feita em inteiros e só então dividida pela escala, com
 * **arredondamento meio-para-cima** — a mesma regra do resto do sistema. Fazer
 * em ponto flutuante produziria diferenças de centavo que a SEFAZ **rejeita**:
 * a soma dos itens precisa bater exatamente com o total declarado.
 */
export function calcItemTotalCents(item: FiscalItem): number {
  const gross = Math.round((item.quantityMilli * item.unitPriceCents) / QUANTITY_SCALE);
  return Math.max(0, gross - item.discountCents);
}

export interface DocumentTotals {
  /** Soma dos itens (já com desconto de linha). */
  itemsCents: number;
  /** Desconto aplicado sobre o total. */
  discountCents: number;
  freightCents: number;
  /** Total da nota = itens − desconto + frete (nunca negativo). */
  totalCents: number;
  /** Soma das formas de pagamento declaradas. */
  paidCents: number;
}

/** Totais do documento. Fonte única da verdade para o campo `vNF` da nota. */
export function calcDocumentTotals(request: IssueRequest): DocumentTotals {
  const itemsCents = request.items.reduce((acc, item) => acc + calcItemTotalCents(item), 0);
  const discountCents = request.discountCents ?? 0;
  const freightCents = request.freightCents ?? 0;
  const totalCents = Math.max(0, itemsCents - discountCents + freightCents);
  const paidCents = request.payments.reduce((acc, p) => acc + Math.max(0, p.amountCents), 0);
  return { itemsCents, discountCents, freightCents, totalCents, paidCents };
}

// =============================================================================
// Máquina de estados
// =============================================================================

/**
 * Transições permitidas. Estados terminais (`DENIED`, `CANCELLED`) não saem de si.
 *
 * `REJECTED` volta para `PENDING` de propósito: rejeição por erro de preenchimento
 * permite corrigir e retransmitir **com a mesma numeração**. Já `DENIED` é
 * terminal — a numeração é queimada e precisa ser inutilizada junto à SEFAZ.
 */
const ALLOWED_TRANSITIONS: Record<FiscalStatus, readonly FiscalStatus[]> = {
  PENDING: ['AUTHORIZED', 'REJECTED', 'DENIED', 'CONTINGENCY'],
  CONTINGENCY: ['AUTHORIZED', 'REJECTED', 'DENIED'],
  AUTHORIZED: ['CANCELLED'],
  REJECTED: ['PENDING'],
  DENIED: [],
  CANCELLED: [],
};

/** `true` se a transição de estado é permitida. */
export function canTransition(from: FiscalStatus, to: FiscalStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Prazo legal para cancelar uma NFC-e, em minutos.
 *
 * ⚠️ 30 minutos é o prazo geral, mas **varia por UF** e muda por norma. Este
 * valor é um padrão conservador e deve ser confirmado com o contador do cliente
 * e/ou parametrizado por loja antes de ir a produção.
 */
export const CANCEL_WINDOW_MINUTES = 30;

/** `true` se ainda está dentro da janela de cancelamento. */
export function canCancel(authorizedAt: Date, now: Date, windowMinutes = CANCEL_WINDOW_MINUTES): boolean {
  const elapsedMs = now.getTime() - authorizedAt.getTime();
  if (elapsedMs < 0) return false; // relógio inconsistente: nega por segurança
  return elapsedMs <= windowMinutes * 60_000;
}

// =============================================================================
// Validação do pedido de emissão
// =============================================================================

/** Um problema encontrado no pedido. `field` aponta o caminho do campo. */
export interface ValidationIssue {
  field: string;
  message: string;
}

const CFOP_RE = /^\d{4}$/;
const NCM_RE = /^\d{8}$/;

/**
 * Valida o pedido ANTES de gastar numeração fiscal e uma chamada ao provedor.
 *
 * Cobre o que é objetivamente verificável sem consultar a SEFAZ: consistência
 * aritmética, formato dos códigos tributários e validade dos documentos. NÃO
 * tenta adivinhar regra tributária — CFOP/CST/CSOSN chegam prontos do cadastro
 * (ver `ItemTaxProfile` em types.ts).
 *
 * Retorna **todos** os problemas de uma vez (não pára no primeiro), para o
 * operador corrigir tudo numa tacada.
 */
export function validateIssueRequest(request: IssueRequest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!request.tenantId) issues.push({ field: 'tenantId', message: 'Loja não informada.' });
  if (!request.orderId) issues.push({ field: 'orderId', message: 'Venda não informada.' });

  if (!isValidCnpj(request.issuer.cnpj)) {
    issues.push({ field: 'issuer.cnpj', message: 'CNPJ do emitente inválido.' });
  }
  if (!Number.isInteger(request.issuer.series) || request.issuer.series < 1 || request.issuer.series > 999) {
    issues.push({ field: 'issuer.series', message: 'Série deve estar entre 1 e 999.' });
  }
  if (!Number.isInteger(request.number) || request.number < 1) {
    issues.push({ field: 'number', message: 'Número da nota deve ser inteiro positivo.' });
  }

  if (request.items.length === 0) {
    issues.push({ field: 'items', message: 'A nota precisa de ao menos um item.' });
  }

  request.items.forEach((item, index) => {
    const at = (field: string) => `items[${index}].${field}`;
    if (item.quantityMilli <= 0) {
      issues.push({ field: at('quantityMilli'), message: 'Quantidade deve ser maior que zero.' });
    }
    if (item.unitPriceCents < 0) {
      issues.push({ field: at('unitPriceCents'), message: 'Preço unitário não pode ser negativo.' });
    }
    if (item.discountCents < 0) {
      issues.push({ field: at('discountCents'), message: 'Desconto não pode ser negativo.' });
    }
    if (!item.description.trim()) {
      issues.push({ field: at('description'), message: 'Descrição do item é obrigatória.' });
    }
    if (!CFOP_RE.test(item.tax.cfop)) {
      issues.push({ field: at('tax.cfop'), message: 'CFOP deve ter 4 dígitos.' });
    }
    if (!NCM_RE.test(item.tax.ncm)) {
      issues.push({ field: at('tax.ncm'), message: 'NCM deve ter 8 dígitos.' });
    }
    if (!Number.isInteger(item.tax.origin) || item.tax.origin < 0 || item.tax.origin > 8) {
      issues.push({ field: at('tax.origin'), message: 'Origem deve estar entre 0 e 8.' });
    }
    // GTIN, quando informado, precisa ter um dos tamanhos válidos.
    if (item.ean && ![8, 12, 13, 14].includes(onlyDigits(item.ean).length)) {
      issues.push({ field: at('ean'), message: 'GTIN deve ter 8, 12, 13 ou 14 dígitos.' });
    }
  });

  if (request.consumer) {
    if (!isValidTaxpayerDocument(request.consumer.kind, request.consumer.document)) {
      issues.push({
        field: 'consumer.document',
        message: `${request.consumer.kind} do consumidor inválido.`,
      });
    }
  }

  const totals = calcDocumentTotals(request);
  if (totals.totalCents <= 0) {
    issues.push({ field: 'items', message: 'Total da nota deve ser maior que zero.' });
  }
  // A SEFAZ exige que a soma dos pagamentos feche com o total da nota.
  if (request.payments.length === 0) {
    issues.push({ field: 'payments', message: 'Informe ao menos uma forma de pagamento.' });
  } else if (totals.paidCents !== totals.totalCents) {
    issues.push({
      field: 'payments',
      message: `Soma dos pagamentos (${totals.paidCents}) difere do total da nota (${totals.totalCents}).`,
    });
  }

  return issues;
}
