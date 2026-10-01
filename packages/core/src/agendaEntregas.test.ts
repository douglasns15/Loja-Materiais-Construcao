import { describe, expect, it } from 'vitest';
import { deliverySlots, slotEnd, slotLabel } from './index';

// =============================================================================
// AGENDA DE ENTREGAS — faixas de horário (ADR-042)
// =============================================================================

const semana = {
  slotMinutes: 30,
  hours: {
    '1': [{ start: '08:00', end: '10:00' }],
    '6': [
      { start: '14:00', end: '15:00' },
      { start: '08:00', end: '09:00' },
    ],
  },
};

describe('deliverySlots', () => {
  it('fatia o intervalo do dia em faixas de 30 min', () => {
    expect(deliverySlots(semana, 1)).toEqual([
      { start: '08:00', end: '08:30' },
      { start: '08:30', end: '09:00' },
      { start: '09:00', end: '09:30' },
      { start: '09:30', end: '10:00' },
    ]);
  });
  it('vários intervalos no dia, em ordem de horário', () => {
    expect(deliverySlots(semana, 6).map((s) => s.start)).toEqual(['08:00', '08:30', '14:00', '14:30']);
  });
  it('dia sem intervalo configurado = fechado', () => {
    expect(deliverySlots(semana, 0)).toEqual([]);
  });
  it('só entram faixas que terminam dentro do intervalo', () => {
    const cfg = { slotMinutes: 30, hours: { '2': [{ start: '08:00', end: '09:45' }] } };
    expect(deliverySlots(cfg, 2).map((s) => s.start)).toEqual(['08:00', '08:30', '09:00']);
  });
  it('sem nenhum dia configurado: padrão 08:00–20:00', () => {
    const slots = deliverySlots({ slotMinutes: 30, hours: {} }, 3);
    expect(slots[0]).toEqual({ start: '08:00', end: '08:30' });
    expect(slots[slots.length - 1]).toEqual({ start: '19:30', end: '20:00' });
    expect(slots).toHaveLength(24);
  });
  it('faixa de 60 min', () => {
    expect(deliverySlots({ slotMinutes: 60, hours: { '1': [{ start: '08:00', end: '10:00' }] } }, 1)).toEqual([
      { start: '08:00', end: '09:00' },
      { start: '09:00', end: '10:00' },
    ]);
  });
});

describe('slotEnd / slotLabel', () => {
  it('fim da faixa a partir do início', () => {
    expect(slotEnd('13:30', 30)).toBe('14:00');
    expect(slotEnd('23:45', 30)).toBe('23:59');
  });
  it('rótulo da faixa', () => {
    expect(slotLabel('13:30', '14:00')).toBe('13:30–14:00');
    expect(slotLabel('13:30', null)).toBe('13:30');
    expect(slotLabel('13:30', '13:30')).toBe('13:30');
  });
});