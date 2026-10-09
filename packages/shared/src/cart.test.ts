import { describe, expect, it } from 'vitest';
import { cartSnapshotSchema, persistableCartItems, UNLIMITED_STOCK_QTY, type CartItem } from './cart';

// Cesta persistente (ADR-021) × produto sem controle de estoque (ADR-040 §2): o disponível infinito
// precisa virar finito antes de ir ao JSON, senão o `POST /cart` recusa a cesta inteira.
const line = (over: Partial<CartItem> = {}): CartItem => ({
  key: 'p1:BASE',
  productId: '11111111-1111-4111-8111-111111111111',
  name: 'Coca-Cola 2L',
  unitPrice: 11.99,
  costPrice: 0,
  quantity: 1,
  stockQty: 10,
  saleMode: 'BASE',
  unitType: 'UNIT',
  baseUnitType: 'UNIT',
  conversionFactor: 1,
  surchargeDebit: 0,
  surchargeCredit: 0,
  ...over,
});

describe('persistableCartItems', () => {
  it('troca o disponível infinito por um finito enorme e passa no schema da cesta', () => {
    const [out] = persistableCartItems([line({ stockQty: Infinity })]);
    expect(out!.stockQty).toBe(UNLIMITED_STOCK_QTY);
    const roundTrip = JSON.parse(JSON.stringify({ items: [out] }));
    expect(cartSnapshotSchema.safeParse(roundTrip).success).toBe(true);
  });

  it('sem a troca, o JSON grava null e a cesta é recusada (o bug corrigido)', () => {
    const raw = JSON.parse(JSON.stringify({ items: [line({ stockQty: Infinity })] }));
    expect(cartSnapshotSchema.safeParse(raw).success).toBe(false);
  });

  it('também trata o outro lado do par e preserva o disponível finito', () => {
    const pair = {
      partnerId: '22222222-2222-4222-8222-222222222222',
      partnerName: 'Bucha',
      mainSalePrice: 1,
      partnerSalePrice: 1,
      partnerStockQty: Infinity,
    };
    const [a, b] = persistableCartItems([line({ stockQty: 7 }), line({ key: 'p1:PAIR', pair })]);
    expect(a!.stockQty).toBe(7);
    expect(b!.pair!.partnerStockQty).toBe(UNLIMITED_STOCK_QTY);
  });
});
