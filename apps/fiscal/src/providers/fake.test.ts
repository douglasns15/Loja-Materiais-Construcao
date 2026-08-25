import { describe, expect, it } from 'vitest';
import { FakeFiscalProvider, MIN_CANCEL_REASON_LENGTH } from './fake';
import { FiscalProviderError } from './provider';
import { isValidAccessKey, parseAccessKey } from '../domain/accessKey';
import { QUANTITY_SCALE } from '../domain/document';
import type { FiscalItem, IssueRequest } from '../domain/types';

const NOW = new Date('2026-08-22T15:00:00Z');
const provider = new FakeFiscalProvider({ now: () => NOW });

function item(description: string): FiscalItem {
  return {
    code: 'CIM-50',
    description,
    quantityMilli: 1 * QUANTITY_SCALE,
    unitPriceCents: 1000,
    discountCents: 0,
    tax: { cfop: '5102', ncm: '25232910', origin: 0, csosnOrCst: '102', unit: 'UN' },
  };
}

function request(description = 'Cimento CP-II 50kg', overrides: Partial<IssueRequest> = {}): IssueRequest {
  return {
    tenantId: 'tenant-1',
    orderId: 'order-1',
    model: 'NFCE',
    issuer: { cnpj: '11222333000181', ufCode: 35, series: 1 },
    number: 128,
    items: [item(description)],
    payments: [{ method: 'CASH', amountCents: 1000 }],
    ...overrides,
  };
}

describe('FakeFiscalProvider.issue', () => {
  it('autoriza o caminho feliz com chave válida', async () => {
    const outcome = await provider.issue(request());
    expect(outcome.kind).toBe('AUTHORIZED');
    if (outcome.kind !== 'AUTHORIZED') return;
    expect(isValidAccessKey(outcome.accessKey)).toBe(true);
    expect(outcome.protocol).toBeTruthy();
    expect(outcome.authorizedAt).toBe(NOW.toISOString());
  });

  it('grava na chave a UF, o CNPJ e o número da nota', async () => {
    const outcome = await provider.issue(request());
    if (outcome.kind !== 'AUTHORIZED') throw new Error('esperava AUTHORIZED');
    const parts = parseAccessKey(outcome.accessKey);
    expect(parts?.ufCode).toBe(35);
    expect(parts?.cnpj).toBe('11222333000181');
    expect(parts?.number).toBe(128);
    expect(parts?.model).toBe(65);
  });

  it('é determinístico — o mesmo pedido gera a mesma chave', async () => {
    const a = await provider.issue(request());
    const b = await provider.issue(request());
    if (a.kind !== 'AUTHORIZED' || b.kind !== 'AUTHORIZED') throw new Error('esperava AUTHORIZED');
    expect(a.accessKey).toBe(b.accessKey);
  });

  it('marca contingência na forma de emissão (tpEmis = 9)', async () => {
    const outcome = await provider.issue(request('Cimento', { contingency: true }));
    if (outcome.kind !== 'AUTHORIZED') throw new Error('esperava AUTHORIZED');
    expect(parseAccessKey(outcome.accessKey)?.emissionType).toBe(9);
  });

  it('rejeita (corrigível) quando simulado', async () => {
    const outcome = await provider.issue(request('Produto REJEITAR'));
    expect(outcome.kind).toBe('REJECTED');
    if (outcome.kind !== 'REJECTED') return;
    expect(outcome.code).toBeTruthy();
  });

  it('denega (terminal) quando simulado', async () => {
    const outcome = await provider.issue(request('Produto DENEGAR'));
    expect(outcome.kind).toBe('DENIED');
  });

  it('lança erro de infra retryable quando simulado', async () => {
    await expect(provider.issue(request('Produto FALHAR'))).rejects.toBeInstanceOf(FiscalProviderError);
    await expect(provider.issue(request('Produto FALHAR'))).rejects.toMatchObject({ retryable: true });
  });
});

describe('FakeFiscalProvider.cancel', () => {
  it('aceita cancelamento com justificativa suficiente', async () => {
    const outcome = await provider.cancel({
      accessKey: '3'.repeat(44),
      reason: 'Cliente desistiu da compra no balcao',
    });
    expect(outcome.kind).toBe('CANCELLED');
  });

  it('recusa justificativa curta (regra da SEFAZ)', async () => {
    const outcome = await provider.cancel({ accessKey: '3'.repeat(44), reason: 'engano' });
    expect(outcome.kind).toBe('REFUSED');
    if (outcome.kind !== 'REFUSED') return;
    expect(outcome.reason).toContain(String(MIN_CANCEL_REASON_LENGTH));
  });
});
