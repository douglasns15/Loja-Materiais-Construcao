import { describe, expect, it } from 'vitest';
import {
  findHeaderRow,
  matchImportColumns,
  normalizeImportRow,
  parseCategoryPath,
  parseCsv,
  parseImportMoney,
  parseImportQty,
  parseImportUnit,
  parseYesNo,
  planProductImport,
  productImportBatchSchema,
  resolveCategoryPath,
  skuFromName,
  summarizeImportPlan,
  type ImportExistingProduct,
  type ImportPlanOptions,
  type ImportRow,
  type ImportStockPlan,
} from './productImport';

/**
 * Estoque injetado nos testes com a MESMA regra do `planOpeningCount` do core (ADR-001): sem controle
 * ⇒ untracked; contagem igual ⇒ same; senão ajuste pela diferença. O shared não depende do core.
 */
const planStock = (p: { stockQty: number; trackStock?: boolean | null }, counted: number): ImportStockPlan => {
  if (p.trackStock === false) return { kind: 'untracked' };
  const delta = Number((counted - p.stockQty).toFixed(4));
  if (delta === 0) return { kind: 'same' };
  return { kind: 'adjust', type: delta > 0 ? 'INCOME' : 'EXPENSE', quantity: Math.abs(delta) };
};

const opts = (o: Partial<ImportPlanOptions> = {}): ImportPlanOptions => ({ categories: [], planStock, ...o });

const product = (o: Partial<ImportExistingProduct> = {}): ImportExistingProduct => ({
  id: 'p1',
  sku: 'LEITE-01',
  ean: '7891000100103',
  name: 'Leite Condensado Moça',
  unit: 'UNIT',
  popularName: null,
  manufacturer: 'Nestlé',
  description: null,
  categoryId: null,
  salePrice: 7.5,
  costPrice: 5,
  stockQty: 10,
  minStockQty: 0,
  trackStock: true,
  scaleCode: null,
  ncm: null,
  ...o,
});

describe('matchImportColumns', () => {
  it('reconhece o modelo NexoLoja inteiro', () => {
    const m = matchImportColumns([
      'Nome', 'Preço de venda', 'Unidade', 'Código de barras', 'Código interno', 'Nome popular', 'Marca',
      'Descrição', 'Categoria', 'Custo', 'Estoque atual', 'Estoque mínimo', 'Controla estoque (S/N)',
      'Código na balança', 'NCM',
    ]);
    expect(m.missingRequired).toEqual([]);
    expect(m.ignored).toEqual([]);
    expect(m.recognized).toHaveLength(15);
  });

  it('casa apelidos de outros sistemas e ignora o que não conhece', () => {
    const m = matchImportColumns(['PRODUTO', 'Vlr. Venda', 'Qtde', 'Cod. Barras', 'Fornecedor']);
    expect(m.mapping).toEqual(['name', 'salePrice', 'stockQty', 'ean', null]);
    expect(m.ignored).toEqual(['Fornecedor']);
  });

  it('sem coluna de nome, a "Descrição" vira o nome', () => {
    const m = matchImportColumns(['Código', 'Descrição', 'Preço']);
    expect(m.mapping).toEqual(['sku', 'name', 'salePrice']);
    expect(m.missingRequired).toEqual([]);
  });

  it('aponta as obrigatórias que faltam e ignora coluna repetida', () => {
    const m = matchImportColumns(['Nome', 'Produto']);
    expect(m.mapping).toEqual(['name', null]);
    expect(m.missingRequired).toEqual(['salePrice']);
  });
});

describe('findHeaderRow', () => {
  it('pula linhas de título antes do cabeçalho', () => {
    expect(findHeaderRow([['Relatório de produtos'], ['Emitido em 01/10'], ['Nome', 'Preço']])).toBe(2);
    expect(findHeaderRow([['a', 'b'], ['c']])).toBe(-1);
  });
});

describe('parseCsv', () => {
  it('detecta ponto e vírgula, aspas, aspas escapadas e quebra dentro de aspas', () => {
    const rows = parseCsv('﻿Nome;Preço\r\n"Arroz; tipo 1";"12,50"\r\n"Diz ""oi""";3\n"duas\nlinhas";4');
    expect(rows).toEqual([
      ['Nome', 'Preço'],
      ['Arroz; tipo 1', '12,50'],
      ['Diz "oi"', '3'],
      ['duas\nlinhas', '4'],
    ]);
  });

  it('detecta vírgula e tabulação', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('células', () => {
  it('dinheiro BR, número da planilha e erros', () => {
    expect(parseImportMoney('R$ 1.234,56')).toEqual({ value: 1234.56 });
    expect(parseImportMoney('12.5')).toEqual({ value: 12.5 });
    expect(parseImportMoney(4.5678)).toEqual({ value: 4.5678 });
    expect(parseImportMoney('')).toBeNull();
    expect(parseImportMoney('abc')).toHaveProperty('error');
    expect(parseImportMoney('-3')).toHaveProperty('error');
    expect(parseImportMoney(7891000100103)).toHaveProperty('error'); // código no lugar do preço
  });

  it('quantidade com vírgula, milhar BR e 3 casas', () => {
    expect(parseImportQty('0,850')).toEqual({ value: 0.85 });
    expect(parseImportQty('1.000')).toEqual({ value: 1000 });
    expect(parseImportQty('2.5')).toEqual({ value: 2.5 });
    expect(parseImportQty(12)).toEqual({ value: 12 });
    expect(parseImportQty('dez')).toHaveProperty('error');
    expect(parseImportQty('-1')).toHaveProperty('error');
  });

  it('S/N, unidade por apelido e categoria', () => {
    expect(parseYesNo('Sim')).toEqual({ value: true });
    expect(parseYesNo('não')).toEqual({ value: false });
    expect(parseYesNo('talvez')).toHaveProperty('error');
    expect(parseImportUnit('Quilo')).toEqual({ value: 'KILOGRAM' });
    expect(parseImportUnit('LT')).toEqual({ value: 'LITER' });
    expect(parseImportUnit('m²')).toEqual({ value: 'SQUARE_METER' });
    expect(parseImportUnit('CX')).toHaveProperty('error');
    expect(parseCategoryPath('Sorvetes >  Premium ')).toEqual({ value: ['Sorvetes', 'Premium'] });
    expect(parseCategoryPath('a > b > c')).toHaveProperty('error');
  });
});

describe('normalizeImportRow', () => {
  const mapping = matchImportColumns(['Nome', 'Preço', 'Código de barras', 'NCM', 'Código na balança']).mapping;

  it('interpreta a linha e pula linha vazia', () => {
    expect(normalizeImportRow(['', null, '  '], mapping, 3)).toBeNull();
    const n = normalizeImportRow(['  Arroz   5kg ', '24,90', 7891000100103, '1006.30.21', '0123'], mapping, 4);
    expect(n?.errors).toEqual([]);
    expect(n?.row).toEqual({ line: 4, name: 'Arroz 5kg', salePrice: 24.9, ean: '7891000100103', ncm: '10063021', scaleCode: '123' });
  });

  it('junta os erros de formato e não devolve linha', () => {
    const n = normalizeImportRow(['Arroz', 'caro', '7891000100104', '123', 'abc'], mapping, 5);
    expect(n?.row).toBeNull();
    expect(n?.errors).toHaveLength(4);
  });
});

describe('planProductImport — casamento e idempotência', () => {
  it('novo: SKU vem do código interno, senão do código de barras, senão do nome', () => {
    const rows: ImportRow[] = [
      { line: 2, name: 'Pão de mel', salePrice: 3, sku: 'PDM' },
      { line: 3, name: 'Refrigerante 2L', salePrice: 9, ean: '7894900027013' },
      { line: 4, name: 'Sorvete de Chocolate', salePrice: 12 },
    ];
    const plan = planProductImport(rows, [], opts());
    expect(plan.map((p) => (p.kind === 'create' ? p.sku : p.kind))).toEqual(['PDM', '7894900027013', 'SORVETE-DE-CHOCOLATE']);
  });

  it('SKU gerado desvia de código já usado (inclusive de produto excluído)', () => {
    const plan = planProductImport([{ line: 2, name: 'Sorvete de chocolate', salePrice: 12 }], [], opts({ takenSkus: new Set(['SORVETE-DE-CHOCOLATE']) }));
    expect(plan[0]).toMatchObject({ kind: 'create', sku: 'SORVETE-DE-CHOCOLATE-2' });
    expect(skuFromName('Açaí  300ml!')).toBe('ACAI-300ML');
  });

  it('casa por código de barras em qualquer largura (EAN-13 × GTIN-14) e pelo SKU legado', () => {
    const viaEan = planProductImport([{ line: 2, ean: '07891000100103', salePrice: 8 }], [product()], opts());
    expect(viaEan[0]).toMatchObject({ kind: 'update', patch: { salePrice: 8 } });
    const legacy = product({ ean: null, sku: '7891000100103' });
    const viaSku = planProductImport([{ line: 2, ean: '7891000100103', salePrice: 8 }], [legacy], opts());
    expect(viaSku[0]).toMatchObject({ kind: 'update', product: { id: 'p1' } });
  });

  it('sem código nenhum, casa pelo nome exato (sem acento/caixa) — reimportar não duplica', () => {
    const plan = planProductImport([{ line: 2, name: 'LEITE CONDENSADO MOCA', salePrice: 7.5 }], [product()], opts());
    expect(plan[0]!.kind).toBe('unchanged');
    const twins = [product(), product({ id: 'p2', sku: 'X' })];
    expect(planProductImport([{ line: 2, name: 'Leite condensado moça', salePrice: 7.5 }], twins, opts())[0]).toMatchObject({ kind: 'error' });
  });

  it('célula vazia não apaga e o mesmo valor vira "sem mudança"', () => {
    const plan = planProductImport([{ line: 2, ean: '7891000100103', salePrice: 7.5, costPrice: 5, stockQty: 10 }], [product()], opts());
    expect(plan[0]!.kind).toBe('unchanged');
  });

  it('atualiza só o que mudou, com o "de → para"', () => {
    const plan = planProductImport([{ line: 2, ean: '7891000100103', name: 'Leite Condensado Moça 395g', manufacturer: 'Nestlé' }], [product()], opts());
    expect(plan[0]).toMatchObject({
      kind: 'update',
      patch: { name: 'Leite Condensado Moça 395g' },
      changes: [{ field: 'name', from: 'Leite Condensado Moça', to: 'Leite Condensado Moça 395g' }],
    });
  });

  it('categoria existente casa sem acento; nova é marcada para criar', () => {
    const categories = [{ id: 'c1', name: 'Laticínios', parentId: null }, { id: 'c2', name: 'Doces', parentId: 'c1' }];
    expect(resolveCategoryPath(['laticinios', 'DOCES'], categories)).toBe('c2');
    const same = planProductImport([{ line: 2, ean: '7891000100103', category: ['Laticinios', 'Doces'] }], [product({ categoryId: 'c2' })], opts({ categories }));
    expect(same[0]!.kind).toBe('unchanged');
    const novo = planProductImport([{ line: 2, ean: '7891000100103', category: ['Mercearia'] }], [product()], opts({ categories }));
    expect(novo[0]).toMatchObject({ kind: 'update', patch: { category: ['Mercearia'] } });
  });
});

describe('planProductImport — estoque (ADR-001)', () => {
  it('produto novo controlado lança a Entrada; sem controle ignora com aviso', () => {
    const plan = planProductImport(
      [
        { line: 2, name: 'Arroz', salePrice: 25, stockQty: 30 },
        { line: 3, name: 'Frango assado', salePrice: 40, stockQty: 5, trackStock: false },
      ],
      [],
      opts(),
    );
    expect(plan[0]).toMatchObject({ kind: 'create', initialStock: 30, trackStock: true });
    expect(plan[1]).toMatchObject({ kind: 'create', initialStock: 0, trackStock: false });
    expect((plan[1] as { warnings: string[] }).warnings[0]).toMatch(/ignorado/);
  });

  it('produto existente: estoque vira contagem de abertura pela diferença', () => {
    const up = planProductImport([{ line: 2, ean: '7891000100103', stockQty: 14 }], [product()], opts());
    expect(up[0]).toMatchObject({ kind: 'update', stock: { kind: 'adjust', type: 'INCOME', quantity: 4, countedQty: 14 } });
    const down = planProductImport([{ line: 2, ean: '7891000100103', stockQty: 7.5 }], [product()], opts());
    expect(down[0]).toMatchObject({ stock: { kind: 'adjust', type: 'EXPENSE', quantity: 2.5 } });
    const untracked = planProductImport([{ line: 2, ean: '7891000100103', stockQty: 3 }], [product({ trackStock: false })], opts());
    expect(untracked[0]!.kind).toBe('unchanged');
  });
});

describe('planProductImport — erros', () => {
  it('repetição no arquivo, produto novo incompleto e unidade fechada', () => {
    const plan = planProductImport(
      [
        { line: 2, name: 'A', salePrice: 1, ean: '7894900027013' },
        { line: 3, name: 'B', salePrice: 1, ean: '07894900027013' },
        { line: 4, name: 'Sem preço' },
        { line: 5, salePrice: 2, sku: 'SEM-NOME' },
        { line: 6, name: 'Rolo de manta', salePrice: 90, unit: 'ROLL' },
        { line: 7, name: 'Tijolo', salePrice: 1, unit: 'THOUSAND' },
      ],
      [],
      opts({ constructionOn: false }),
    );
    expect(plan.map((p) => p.kind)).toEqual(['create', 'error', 'error', 'error', 'error', 'error']);
    expect(plan[1]).toMatchObject({ message: expect.stringMatching(/linha 2/) });
    expect(plan[5]).toMatchObject({ message: expect.stringMatching(/ramo/) });
  });

  it('código interno de outro produto e PLU já em uso', () => {
    const other = product({ id: 'p2', sku: 'OUTRO', ean: null, name: 'Outro', scaleCode: '123' });
    const plan = planProductImport(
      [
        { line: 2, ean: '7891000100103', sku: 'OUTRO' },
        { line: 3, name: 'Novo', salePrice: 1, scaleCode: '123' },
      ],
      [product(), other],
      opts(),
    );
    expect(plan.map((p) => p.kind)).toEqual(['error', 'error']);
  });

  it('PLU ignorado com aviso quando a loja não usa balança; unidade diferente não muda', () => {
    const plan = planProductImport([{ line: 2, ean: '7891000100103', scaleCode: '9', unit: 'KILOGRAM' }], [product()], opts({ scaleOn: false }));
    expect(plan[0]!.kind).toBe('unchanged');
    expect((plan[0] as { warnings: string[] }).warnings).toHaveLength(2);
  });

  it('resumo por tipo', () => {
    expect(summarizeImportPlan([{ kind: 'create' }, { kind: 'error' }, { kind: 'create' }])).toEqual({ create: 2, update: 0, unchanged: 0, error: 1 });
  });
});

describe('productImportBatchSchema', () => {
  it('aceita um lote válido e recusa lote vazio ou EAN malformado', () => {
    const importId = '1c9e4f0a-7a8b-4c2d-9e1f-0a1b2c3d4e5f';
    expect(productImportBatchSchema.safeParse({ importId, rows: [{ line: 2, name: 'A', salePrice: 1 }] }).success).toBe(true);
    expect(productImportBatchSchema.safeParse({ importId, rows: [] }).success).toBe(false);
    expect(productImportBatchSchema.safeParse({ importId, rows: [{ line: 2, ean: '12ab' }] }).success).toBe(false);
  });
});
