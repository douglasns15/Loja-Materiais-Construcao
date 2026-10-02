import { describe, expect, it } from 'vitest';
import { planDispatch, statusAfterRouteReturn } from './index';

// =============================================================================
// Saída para entrega × "Voltou / não entregue" (ADR-042, revisão 2026-10-02)
// =============================================================================

const DAY1 = Date.UTC(2026, 9, 2);
const DAY2 = Date.UTC(2026, 9, 5);

describe('planDispatch', () => {
  it('sai tudo o que falta e conclui o pedido', () => {
    const r = planDispatch(
      [
        { id: 'a', baseQuantity: 3, deliveredBaseQty: 1 },
        { id: 'b', baseQuantity: 1.2, deliveredBaseQty: 0 },
      ],
      { perItemSchedule: false },
    );
    expect(r.lines).toEqual([
      { id: 'a', qty: 2 },
      { id: 'b', qty: 1.2 },
    ]);
    expect(r.nextStatus).toBe('COMPLETED');
  });

  it('ignora linhas já entregues', () => {
    const r = planDispatch(
      [
        { id: 'a', baseQuantity: 2, deliveredBaseQty: 2 },
        { id: 'b', baseQuantity: 0.412, deliveredBaseQty: 0 },
      ],
      { perItemSchedule: false },
    );
    expect(r.lines).toEqual([{ id: 'b', qty: 0.412 }]);
    expect(r.nextStatus).toBe('COMPLETED');
  });

  it('"Data por item" com dia: só os itens daquele dia; o pedido fica parcial', () => {
    const r = planDispatch(
      [
        { id: 'a', baseQuantity: 10, deliveredBaseQty: 0, dayMs: DAY1 },
        { id: 'b', baseQuantity: 4, deliveredBaseQty: 0, dayMs: DAY2 },
      ],
      { perItemSchedule: true, dayMs: DAY1 },
    );
    expect(r.lines).toEqual([{ id: 'a', qty: 10 }]);
    expect(r.nextStatus).toBe('PARTIAL');
  });

  it('"Data por item" sem dia: sai tudo', () => {
    const r = planDispatch(
      [
        { id: 'a', baseQuantity: 10, deliveredBaseQty: 0, dayMs: DAY1 },
        { id: 'b', baseQuantity: 4, deliveredBaseQty: 0, dayMs: DAY2 },
      ],
      { perItemSchedule: true },
    );
    expect(r.lines).toHaveLength(2);
    expect(r.nextStatus).toBe('COMPLETED');
  });

  it('nada pendente ⇒ nenhuma linha', () => {
    const r = planDispatch([{ id: 'a', baseQuantity: 1, deliveredBaseQty: 1 }], { perItemSchedule: false });
    expect(r.lines).toEqual([]);
    expect(r.nextStatus).toBe('COMPLETED');
  });
});

describe('statusAfterRouteReturn', () => {
  it('voltou tudo ⇒ pedido volta a "A retirar" (PENDING)', () => {
    expect(
      statusAfterRouteReturn(
        [
          { id: 'a', baseQuantity: 2, deliveredBaseQty: 2 },
          { id: 'b', baseQuantity: 1.2, deliveredBaseQty: 1.2 },
        ],
        [
          { id: 'a', qty: 2 },
          { id: 'b', qty: 1.2 },
        ],
      ),
    ).toBe('PENDING');
  });

  it('havia retirada anterior à saída ⇒ PARTIAL', () => {
    expect(
      statusAfterRouteReturn([{ id: 'a', baseQuantity: 3, deliveredBaseQty: 3 }], [{ id: 'a', qty: 2 }]),
    ).toBe('PARTIAL');
  });

  it('nunca fica negativo', () => {
    expect(
      statusAfterRouteReturn([{ id: 'a', baseQuantity: 1, deliveredBaseQty: 0.5 }], [{ id: 'a', qty: 1 }]),
    ).toBe('PENDING');
  });
});
