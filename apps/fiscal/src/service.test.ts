import { describe, expect, it } from 'vitest';
import { FiscalService } from './service';
import { FakeFiscalProvider } from './providers/fake';
import { MemoryFiscalStore } from './store/memory';
import { QUANTITY_SCALE } from './domain/document';
import type { FiscalItem, IssueRequest } from './domain/types';

const NOW = new Date('2026-08-22T15:00:00Z');

function makeService(now: () => Date = () => NOW) {
  const store = new MemoryFiscalStore();
  const service = new FiscalService({
    provider: new FakeFiscalProvider({ now }),
    store,
    environment: 'homologacao',
    now,
    newId: () => 'doc-fixo',
  });
  return { service, store };
}

function item(description = 'Cimento CP-II 50kg'): FiscalItem {
  return {
    code: 'CIM-50',
    description,
    quantityMilli: 1 * QUANTITY_SCALE,
    unitPriceCents: 1000,
    discountCents: 0,
    tax: { cfop: '5102', ncm: '25232910', origin: 0, csosnOrCst: '102', unit: 'UN' },
  };
}

function request(overrides: Partial<IssueRequest> = {}): IssueRequest {
  return {
    tenantId: 'tenant-1',
    orderId: 'order-1',
    model: 'NFCE',
    issuer: { cnpj: '11222333000181', ufCode: 35, series: 1 },
    number: 128,
    items: [item()],
    payments: [{ method: 'CASH', amountCents: 1000 }],
    ...overrides,
  };
}

describe('FiscalService.issue', () => {
  it('emite e persiste o documento autorizado', async () => {
    const { service, store } = makeService();
    const result = await service.issue(request());

    expect(result.kind).toBe('ISSUED');
    if (result.kind !== 'ISSUED') return;
    expect(result.document.status).toBe('AUTHORIZED');
    expect(result.document.accessKey).toHaveLength(44);
    expect(result.document.totalCents).toBe(1000);
    // Persistido e recuperável pela chave de idempotência.
    await expect(store.findByOrder('tenant-1', 'order-1')).resolves.toMatchObject({
      status: 'AUTHORIZED',
    });
  });

  it('é IDEMPOTENTE: a mesma venda nunca gera duas notas', async () => {
    const { service } = makeService();
    const first = await service.issue(request());
    const second = await service.issue(request());

    expect(first.kind).toBe('ISSUED');
    expect(second.kind).toBe('ALREADY_ISSUED');
    if (first.kind !== 'ISSUED' || second.kind !== 'ALREADY_ISSUED') return;
    expect(second.document.accessKey).toBe(first.document.accessKey);
  });

  it('não transmite quando o pedido é inválido', async () => {
    const { service, store } = makeService();
    // Pagamento não fecha com o total.
    const result = await service.issue(request({ payments: [{ method: 'CASH', amountCents: 1 }] }));

    expect(result.kind).toBe('INVALID');
    if (result.kind !== 'INVALID') return;
    expect(result.issues.length).toBeGreaterThan(0);
    // Nada foi persistido — a numeração fiscal não foi queimada.
    await expect(store.findByOrder('tenant-1', 'order-1')).resolves.toBeNull();
  });

  it('registra rejeição e permite nova tentativa com a mesma venda', async () => {
    const { service } = makeService();
    const rejected = await service.issue(request({ items: [item('Produto REJEITAR')] }));
    expect(rejected.kind).toBe('REJECTED');

    // Corrigido o item, a mesma venda pode ser retransmitida.
    const retried = await service.issue(request());
    expect(retried.kind).toBe('ISSUED');
  });

  it('trata denegação como terminal (não permite retransmitir)', async () => {
    const { service } = makeService();
    const denied = await service.issue(request({ items: [item('Produto DENEGAR')] }));
    expect(denied.kind).toBe('DENIED');

    const retried = await service.issue(request());
    expect(retried.kind).toBe('ALREADY_ISSUED');
  });

  it('cai em CONTINGÊNCIA quando a SEFAZ está fora — a venda não pára', async () => {
    const { service, store } = makeService();
    const result = await service.issue(request({ items: [item('Produto FALHAR')] }));

    expect(result.kind).toBe('CONTINGENCY');
    if (result.kind !== 'CONTINGENCY') return;
    expect(result.document.status).toBe('CONTINGENCY');
    await expect(store.findByOrder('tenant-1', 'order-1')).resolves.toMatchObject({
      status: 'CONTINGENCY',
    });
  });
});

describe('FiscalService.cancel', () => {
  it('cancela dentro do prazo', async () => {
    let current = NOW;
    const { service } = makeService(() => current);
    await service.issue(request());

    current = new Date(NOW.getTime() + 10 * 60_000); // 10 min depois
    const result = await service.cancel('tenant-1', 'order-1', 'Cliente desistiu da compra');

    expect(result.kind).toBe('CANCELLED');
    if (result.kind !== 'CANCELLED') return;
    expect(result.document.status).toBe('CANCELLED');
  });

  it('bloqueia fora do prazo legal', async () => {
    let current = NOW;
    const { service } = makeService(() => current);
    await service.issue(request());

    current = new Date(NOW.getTime() + 31 * 60_000); // 31 min depois
    const result = await service.cancel('tenant-1', 'order-1', 'Cliente desistiu da compra');
    expect(result.kind).toBe('WINDOW_EXPIRED');
  });

  it('recusa justificativa curta', async () => {
    const { service } = makeService();
    await service.issue(request());
    const result = await service.cancel('tenant-1', 'order-1', 'engano');
    expect(result.kind).toBe('REFUSED');
  });

  it('não cancela venda sem nota', async () => {
    const { service } = makeService();
    const result = await service.cancel('tenant-1', 'inexistente', 'Cliente desistiu da compra');
    expect(result.kind).toBe('NOT_FOUND');
  });

  it('não cancela documento que não foi autorizado', async () => {
    const { service } = makeService();
    await service.issue(request({ items: [item('Produto FALHAR')] })); // fica em CONTINGENCY
    const result = await service.cancel('tenant-1', 'order-1', 'Cliente desistiu da compra');
    expect(result.kind).toBe('INVALID_STATE');
  });

  it('não cancela duas vezes', async () => {
    const { service } = makeService();
    await service.issue(request());
    await service.cancel('tenant-1', 'order-1', 'Cliente desistiu da compra');
    const again = await service.cancel('tenant-1', 'order-1', 'Cliente desistiu da compra');
    expect(again.kind).toBe('INVALID_STATE');
  });
});
