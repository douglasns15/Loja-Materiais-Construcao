import { describe, expect, it } from 'vitest';
import {
  calcDocumentTotals,
  calcItemTotalCents,
  canCancel,
  canTransition,
  QUANTITY_SCALE,
  validateIssueRequest,
} from './document';
import type { FiscalItem, IssueRequest } from './types';

/** Item de teste: 2 un × R$ 10,00, sem desconto. */
function item(overrides: Partial<FiscalItem> = {}): FiscalItem {
  return {
    code: 'CIM-50',
    description: 'Cimento CP-II 50kg',
    quantityMilli: 2 * QUANTITY_SCALE,
    unitPriceCents: 1000,
    discountCents: 0,
    tax: { cfop: '5102', ncm: '25232910', origin: 0, csosnOrCst: '102', unit: 'UN' },
    ...overrides,
  };
}

function request(overrides: Partial<IssueRequest> = {}): IssueRequest {
  const items = overrides.items ?? [item()];
  const total = items.reduce((acc, i) => acc + calcItemTotalCents(i), 0);
  return {
    tenantId: 'tenant-1',
    orderId: 'order-1',
    model: 'NFCE',
    issuer: { cnpj: '11222333000181', ufCode: 35, series: 1 },
    number: 128,
    items,
    payments: [{ method: 'CASH', amountCents: total }],
    ...overrides,
  };
}

describe('calcItemTotalCents', () => {
  it('quantidade × preço − desconto', () => {
    expect(calcItemTotalCents(item())).toBe(2000);
    expect(calcItemTotalCents(item({ discountCents: 150 }))).toBe(1850);
  });

  it('lida com quantidade fracionada sem erro de ponto flutuante', () => {
    // 0,5 m × R$ 3,33 = R$ 1,665 → arredonda para R$ 1,67 (meio p/ cima).
    const meioMetro = item({ quantityMilli: 0.5 * QUANTITY_SCALE, unitPriceCents: 333 });
    expect(calcItemTotalCents(meioMetro)).toBe(167);
  });

  it('nunca fica negativo, mesmo com desconto maior que o bruto', () => {
    expect(calcItemTotalCents(item({ discountCents: 999_999 }))).toBe(0);
  });
});

describe('calcDocumentTotals', () => {
  it('soma itens, aplica desconto e frete', () => {
    const totals = calcDocumentTotals(
      request({ discountCents: 200, freightCents: 500, payments: [{ method: 'PIX', amountCents: 2300 }] }),
    );
    expect(totals.itemsCents).toBe(2000);
    expect(totals.totalCents).toBe(2300); // 2000 − 200 + 500
    expect(totals.paidCents).toBe(2300);
  });

  it('total nunca é negativo', () => {
    const totals = calcDocumentTotals(request({ discountCents: 999_999 }));
    expect(totals.totalCents).toBe(0);
  });

  it('ignora parcelas de pagamento negativas', () => {
    const totals = calcDocumentTotals(
      request({ payments: [{ method: 'CASH', amountCents: 2000 }, { method: 'PIX', amountCents: -50 }] }),
    );
    expect(totals.paidCents).toBe(2000);
  });
});

describe('canTransition', () => {
  it('permite o caminho feliz e o cancelamento', () => {
    expect(canTransition('PENDING', 'AUTHORIZED')).toBe(true);
    expect(canTransition('AUTHORIZED', 'CANCELLED')).toBe(true);
    expect(canTransition('PENDING', 'CONTINGENCY')).toBe(true);
    expect(canTransition('CONTINGENCY', 'AUTHORIZED')).toBe(true);
  });

  it('permite corrigir e retransmitir depois de rejeição', () => {
    expect(canTransition('REJECTED', 'PENDING')).toBe(true);
  });

  it('trata DENIED e CANCELLED como terminais', () => {
    expect(canTransition('DENIED', 'PENDING')).toBe(false);
    expect(canTransition('DENIED', 'AUTHORIZED')).toBe(false);
    expect(canTransition('CANCELLED', 'AUTHORIZED')).toBe(false);
  });

  it('não deixa cancelar o que não foi autorizado', () => {
    expect(canTransition('PENDING', 'CANCELLED')).toBe(false);
    expect(canTransition('REJECTED', 'CANCELLED')).toBe(false);
  });
});

describe('canCancel', () => {
  const authorizedAt = new Date('2026-08-22T12:00:00Z');

  it('permite dentro da janela', () => {
    expect(canCancel(authorizedAt, new Date('2026-08-22T12:29:59Z'))).toBe(true);
  });

  it('bloqueia depois da janela', () => {
    expect(canCancel(authorizedAt, new Date('2026-08-22T12:30:01Z'))).toBe(false);
  });

  it('nega se o relógio estiver inconsistente (agora antes da autorização)', () => {
    expect(canCancel(authorizedAt, new Date('2026-08-22T11:00:00Z'))).toBe(false);
  });
});

describe('validateIssueRequest', () => {
  it('aceita um pedido bem formado', () => {
    expect(validateIssueRequest(request())).toEqual([]);
  });

  it('exige que os pagamentos fechem com o total', () => {
    const issues = validateIssueRequest(request({ payments: [{ method: 'CASH', amountCents: 1999 }] }));
    expect(issues.map((i) => i.field)).toContain('payments');
  });

  it('rejeita CNPJ do emitente inválido', () => {
    const issues = validateIssueRequest(
      request({ issuer: { cnpj: '11222333000182', ufCode: 35, series: 1 } }),
    );
    expect(issues.map((i) => i.field)).toContain('issuer.cnpj');
  });

  it('rejeita CPF do consumidor inválido', () => {
    const issues = validateIssueRequest(
      request({ consumer: { kind: 'CPF', document: '52998224726' } }),
    );
    expect(issues.map((i) => i.field)).toContain('consumer.document');
  });

  it('aceita consumidor com CPF válido', () => {
    const issues = validateIssueRequest(
      request({ consumer: { kind: 'CPF', document: '529.982.247-25', name: 'Fulano' } }),
    );
    expect(issues).toEqual([]);
  });

  it('rejeita nota sem itens', () => {
    const issues = validateIssueRequest(request({ items: [], payments: [] }));
    expect(issues.map((i) => i.field)).toContain('items');
  });

  it('valida os códigos tributários de cada item, apontando o índice', () => {
    const issues = validateIssueRequest(
      request({
        items: [item(), item({ tax: { cfop: '51', ncm: '123', origin: 9, csosnOrCst: '102', unit: 'UN' } })],
      }),
    );
    const fields = issues.map((i) => i.field);
    expect(fields).toContain('items[1].tax.cfop');
    expect(fields).toContain('items[1].tax.ncm');
    expect(fields).toContain('items[1].tax.origin');
    // O item 0 está correto e não deve aparecer.
    expect(fields.some((f) => f.startsWith('items[0]'))).toBe(false);
  });

  it('valida o tamanho do GTIN quando informado', () => {
    const issues = validateIssueRequest(request({ items: [item({ ean: '12345' })] }));
    expect(issues.map((i) => i.field)).toContain('items[0].ean');
  });

  it('acumula todos os problemas em vez de parar no primeiro', () => {
    const issues = validateIssueRequest(
      request({ tenantId: '', orderId: '', items: [item({ quantityMilli: 0 })], payments: [] }),
    );
    expect(issues.length).toBeGreaterThan(3);
  });
});
