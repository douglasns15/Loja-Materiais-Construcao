// =============================================================================
// Rotina de reconciliação de estoque (ADR-001).
//
// StockMovement é a FONTE DE VERDADE auditável; Product.stockQty é um cache
// desnormalizado para leitura rápida. Quando o cache diverge do histórico
// (ex.: dado de seed/legado ajustado fora do fluxo de `applyStockMovement`),
// esta rotina recalcula `stockQty = Σ INCOME − Σ EXPENSE` e corrige o cache.
//
// Só toca DADO (UPDATE em products.stockQty). NÃO cria migration nem
// StockMovement — o histórico já é a verdade; aqui o cache é alinhado a ele.
//
// Uso (a partir da RAIZ do repositório):
//   node packages/db/scripts/reconcile-stock.mjs            # dry-run (só relata)
//   node packages/db/scripts/reconcile-stock.mjs --apply    # aplica as correções
//   node packages/db/scripts/reconcile-stock.mjs --tenant loja-demo [--apply]
//
// Requer no .env (raiz): DATABASE_URL
// =============================================================================
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// Carrega o .env da raiz (node não faz isso sozinho).
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?/);
  if (m) process.env[m[1]] = m[2];
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const tenantIdx = args.indexOf('--tenant');
const TENANT_SLUG = tenantIdx >= 0 ? args[tenantIdx + 1] : null;

// Quantidades são Decimal(12,4): compara/arredonda em 4 casas para evitar ruído de ponto flutuante.
const round4 = (n) => Math.round(n * 1e4) / 1e4;

async function main() {
  const prisma = new PrismaClient();
  try {
    // Escopo opcional por loja (slug). Sem --tenant, reconcilia todas as lojas.
    let tenantFilter = {};
    const tenants = new Map(); // id -> slug (para exibição)
    if (TENANT_SLUG) {
      const t = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true, slug: true } });
      if (!t) throw new Error(`Loja com slug "${TENANT_SLUG}" não encontrada.`);
      tenantFilter = { tenantId: t.id };
      tenants.set(t.id, t.slug);
    } else {
      for (const t of await prisma.tenant.findMany({ select: { id: true, slug: true } })) tenants.set(t.id, t.slug);
    }

    // Cache atual (todos os produtos, inclusive soft-deleted — o cache existe de qualquer forma).
    const products = await prisma.product.findMany({
      where: { ...tenantFilter },
      select: { id: true, tenantId: true, sku: true, name: true, stockQty: true, deletedAt: true },
    });

    // Σ por (produto, tipo) direto no banco (groupBy + _sum, cost-zero — não trafega o histórico).
    const rows = await prisma.stockMovement.groupBy({
      by: ['productId', 'type'],
      where: { ...tenantFilter },
      _sum: { quantity: true },
    });
    const sums = new Map(); // productId -> { income, expense }
    for (const r of rows) {
      const cur = sums.get(r.productId) ?? { income: 0, expense: 0 };
      const qty = Number(r._sum.quantity ?? 0);
      if (r.type === 'INCOME') cur.income += qty;
      else cur.expense += qty;
      sums.set(r.productId, cur);
    }

    // Divergências: cache ≠ Σ INCOME − Σ EXPENSE.
    const divergences = [];
    for (const p of products) {
      const s = sums.get(p.id) ?? { income: 0, expense: 0 };
      const expected = round4(s.income - s.expense);
      const current = round4(Number(p.stockQty));
      if (expected !== current) {
        divergences.push({ ...p, income: s.income, expense: s.expense, expected, current, delta: round4(expected - current) });
      }
    }

    console.log(`\nReconciliação de estoque (ADR-001) — ${APPLY ? 'APLICAR' : 'DRY-RUN (só relata)'}`);
    console.log(`Escopo: ${TENANT_SLUG ? `loja "${TENANT_SLUG}"` : 'TODAS as lojas'} · ${products.length} produto(s) analisado(s)\n`);

    if (divergences.length === 0) {
      console.log('✅ Nenhuma divergência: o cache já bate com Σ INCOME − Σ EXPENSE.');
      return;
    }

    console.log(`⚠️  ${divergences.length} divergência(s) encontrada(s):\n`);
    for (const d of divergences) {
      const flag = d.deletedAt ? ' [soft-deleted]' : '';
      console.log(
        `  • ${d.name} (${d.sku})${flag} [loja ${tenants.get(d.tenantId) ?? d.tenantId}]\n` +
          `      Σ INCOME ${d.income} − Σ EXPENSE ${d.expense} = ${d.expected}  ·  cache atual = ${d.current}  ·  correção ${d.delta > 0 ? '+' : ''}${d.delta}`,
      );
    }

    if (!APPLY) {
      console.log('\nDry-run: nada foi alterado. Rode de novo com --apply para corrigir o cache.');
      return;
    }

    // Aplica: cada produto num UPDATE (só o cache; a verdade já está nos movimentos).
    let fixed = 0;
    for (const d of divergences) {
      await prisma.product.update({ where: { id: d.id }, data: { stockQty: d.expected } });
      fixed++;
    }
    console.log(`\n✅ ${fixed} produto(s) reconciliado(s): stockQty ajustado para Σ INCOME − Σ EXPENSE.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('ERRO na reconciliação:', e.message);
  process.exit(1);
});
