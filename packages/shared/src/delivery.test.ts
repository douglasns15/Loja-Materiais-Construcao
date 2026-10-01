import { describe, expect, it } from 'vitest';
import { DEFAULT_DELIVERY_SETTINGS, deliverySettingsSchema, parseDeliverySettings } from './delivery';
import { createEmployeeSchema, updateEmployeeSchema } from './employee';
import { createSaleSchema } from './sale';

// =============================================================================
// Agenda de entregas (ADR-042) — período de entregas, funcionários e campos da venda
// =============================================================================

describe('deliverySettingsSchema', () => {
  it('aceita faixa, limite e horários por dia da semana', () => {
    const r = deliverySettingsSchema.parse({
      slotMinutes: 30,
      maxPerSlot: 3,
      hours: { '1': [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
    });
    expect(r.hours['1']).toHaveLength(2);
  });
  it('aplica os padrões', () => {
    expect(deliverySettingsSchema.parse({})).toEqual(DEFAULT_DELIVERY_SETTINGS);
  });
  it('recusa fim antes do início e horário mal formatado', () => {
    expect(deliverySettingsSchema.safeParse({ hours: { '1': [{ start: '12:00', end: '08:00' }] } }).success).toBe(false);
    expect(deliverySettingsSchema.safeParse({ hours: { '1': [{ start: '8:00', end: '12:00' }] } }).success).toBe(false);
  });
  it('recusa dia da semana inexistente e faixa absurda', () => {
    expect(deliverySettingsSchema.safeParse({ hours: { '7': [] } }).success).toBe(false);
    expect(deliverySettingsSchema.safeParse({ slotMinutes: 5 }).success).toBe(false);
  });
});

describe('parseDeliverySettings', () => {
  it('coluna nula ou JSON inválido caem no padrão', () => {
    expect(parseDeliverySettings(null)).toEqual(DEFAULT_DELIVERY_SETTINGS);
    expect(parseDeliverySettings({ slotMinutes: 'x' })).toEqual(DEFAULT_DELIVERY_SETTINGS);
  });
  it('JSON válido é preservado', () => {
    expect(parseDeliverySettings({ slotMinutes: 60 }).slotMinutes).toBe(60);
  });
});

describe('funcionários', () => {
  it('nome obrigatório; função padrão = entregador', () => {
    expect(createEmployeeSchema.parse({ name: 'Zé' }).role).toBe('COURIER');
    expect(createEmployeeSchema.safeParse({ name: '  ' }).success).toBe(false);
  });
  it('edição aceita limpar o telefone e desativar', () => {
    expect(updateEmployeeSchema.parse({ phone: null, isActive: false })).toEqual({ phone: null, isActive: false });
  });
});

describe('createSaleSchema — agenda de entregas', () => {
  const base = {
    items: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 1, unitPrice: 10 }],
    payments: [{ method: 'CASH', amount: 10 }],
  };
  it('aceita retirada × entrega, faixa, endereço e entregador', () => {
    const r = createSaleSchema.safeParse({
      ...base,
      deliveryMode: 'SCHEDULED',
      fulfillmentType: 'DELIVERY',
      scheduledPickupAt: '2026-10-01T16:30:00.000Z',
      scheduledUntil: '2026-10-01T17:00:00.000Z',
      deliveryAddress: 'Rua A, 1',
      courierId: '00000000-0000-4000-8000-000000000002',
    });
    expect(r.success).toBe(true);
  });
  it('recusa tipo desconhecido e entregador que não é uuid', () => {
    expect(createSaleSchema.safeParse({ ...base, fulfillmentType: 'DRONE' }).success).toBe(false);
    expect(createSaleSchema.safeParse({ ...base, courierId: 'zé' }).success).toBe(false);
  });
});
