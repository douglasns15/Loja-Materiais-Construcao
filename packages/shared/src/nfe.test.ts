import { describe, expect, it } from 'vitest';
import {
  buildNfeHeader,
  buildNfeItem,
  nfeAccessKeyFromId,
  nfeItemKey,
  normalizeNfeEan,
  parseNfeDecimal,
} from './nfe';

// Decimais da NF-e afetam ESTOQUE e CUSTO — teste obrigatório (CLAUDE.md regra 2). O padrão é ponto
// decimal sem separador de milhar; toleramos vírgula por segurança e nunca deixamos passar NaN.
describe('parseNfeDecimal', () => {
  it('lê o formato da NF-e (ponto decimal, muitas casas)', () => {
    expect(parseNfeDecimal('1234.5600')).toBe(1234.56);
    expect(parseNfeDecimal('0.0100')).toBe(0.01);
    expect(parseNfeDecimal('12')).toBe(12);
  });

  it('tolera vírgula decimal', () => {
    expect(parseNfeDecimal('1234,56')).toBe(1234.56);
  });

  it('vazio/nulo/inválido/negativo vira 0 (nunca NaN)', () => {
    expect(parseNfeDecimal('')).toBe(0);
    expect(parseNfeDecimal(null)).toBe(0);
    expect(parseNfeDecimal(undefined)).toBe(0);
    expect(parseNfeDecimal('abc')).toBe(0);
    expect(parseNfeDecimal('-5')).toBe(0);
  });
});

describe('nfeAccessKeyFromId', () => {
  const key = '35200114200166000187550010000000015123456789'; // 44 dígitos
  it('extrai 44 dígitos do atributo Id (prefixo "NFe") ou do chNFe', () => {
    expect(nfeAccessKeyFromId(`NFe${key}`)).toBe(key);
    expect(nfeAccessKeyFromId(key)).toBe(key);
  });
  it('devolve null quando não há exatamente 44 dígitos', () => {
    expect(nfeAccessKeyFromId('NFe123')).toBeNull();
    expect(nfeAccessKeyFromId(null)).toBeNull();
    expect(nfeAccessKeyFromId('')).toBeNull();
  });
});

describe('normalizeNfeEan', () => {
  it('aceita GTIN válido (vira chave de catálogo)', () => {
    expect(normalizeNfeEan('7891000100103')).toBe('7891000100103');
  });
  it('trata "SEM GTIN"/vazio/inválido como null', () => {
    expect(normalizeNfeEan('SEM GTIN')).toBeNull();
    expect(normalizeNfeEan('')).toBeNull();
    expect(normalizeNfeEan('7891000100104')).toBeNull(); // dígito verificador errado
  });
});

describe('buildNfeItem', () => {
  it('normaliza um item completo (EAN válido, NCM com pontos, decimais)', () => {
    const item = buildNfeItem({
      nItem: '1',
      supplierCode: 'CIM50',
      ean: '7891000100103',
      name: '  Cimento CP-II 50kg  ',
      ncm: '2523.29.10',
      unit: 'SC',
      quantity: '10.0000',
      unitCost: '28.5000',
      total: '285.00',
    });
    expect(item).toEqual({
      nItem: 1,
      supplierCode: 'CIM50',
      ean: '7891000100103',
      rawEan: '7891000100103',
      name: 'Cimento CP-II 50kg',
      ncm: '25232910',
      unit: 'SC',
      quantity: 10,
      unitCost: 28.5,
      total: 285,
    });
  });

  it('item "SEM GTIN": guarda o cru em rawEan mas não vira chave de catálogo (ean null)', () => {
    const item = buildNfeItem({
      nItem: 2,
      ean: 'SEM GTIN',
      name: 'Vergalhão CA-50 8mm',
      quantity: '100',
      unitCost: '7.9',
    });
    expect(item.ean).toBeNull();
    expect(item.rawEan).toBe('SEM GTIN');
    expect(item.ncm).toBeNull();
    expect(item.quantity).toBe(100);
    expect(item.unitCost).toBe(7.9);
    expect(item.total).toBe(0); // vProd ausente
  });
});

describe('buildNfeHeader', () => {
  it('normaliza chave, número e CNPJ (14 dígitos) do emitente', () => {
    const h = buildNfeHeader({
      accessKey: 'NFe35200114200166000187550010000000015123456789',
      number: '12345',
      supplierName: '  Construfer Ltda  ',
      supplierCnpj: '14.200.166/0001-87',
    });
    expect(h).toEqual({
      accessKey: '35200114200166000187550010000000015123456789',
      number: '12345',
      supplierName: 'Construfer Ltda',
      supplierCnpj: '14200166000187',
    });
  });

  it('CNPJ malformado e chave ausente viram null', () => {
    const h = buildNfeHeader({ supplierCnpj: '123', number: '', supplierName: null });
    expect(h.supplierCnpj).toBeNull();
    expect(h.accessKey).toBeNull();
    expect(h.number).toBeNull();
    expect(h.supplierName).toBeNull();
  });
});

describe('nfeItemKey', () => {
  const key = '35200114200166000187550010000000015123456789';
  it('compõe <chNFe>:<nItem> quando há chave', () => {
    expect(nfeItemKey(key, 3)).toBe(`${key}:3`);
  });
  it('sem chave (nota sem 44 dígitos) não há idempotência → null', () => {
    expect(nfeItemKey(null, 3)).toBeNull();
    expect(nfeItemKey(key, 0)).toBeNull();
  });
});
