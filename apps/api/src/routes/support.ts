import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import { calcMarginPercent } from '@nexoloja/core';
import { type Env, getConnectionString } from '../lib/request';
import { requireSupportSession } from '../middleware/auth';
import type { Context } from 'hono';

/**
 * Rotas de SESSÃO DE SUPORTE (ADR-009, Fatia E). Montadas em `/support/*` — FORA de
 * `/platform/*` de propósito, para que o `Authorization: Bearer` seja lido como o **token de
 * suporte** (não como um JWT do Supabase). Todas exigem uma sessão de suporte válida via
 * `requireSupportSession`, que já popula `supportTenantId` (a loja-alvo). **Somente-leitura**
 * nesta fatia: o Super Usuário vê a loja, não escreve. O RLS de loja NÃO é relaxado — a
 * fronteira é a checagem explícita do escopo do token.
 */
const support = new Hono<Env>();

support.use('*', requireSupportSession);

const num = (v: unknown) => Number(v ?? 0);

/** Status de venda válidos para filtro (enum `OrderStatus`). */
const ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED', 'RETURNED'] as const;

/**
 * Confere que o `:tenantId` da URL bate com o escopo do token de suporte. Devolve o id quando
 * autorizado, ou `null` (o handler responde 403). O token só vale para a loja p/ a qual foi emitido.
 */
function scopedTenant(c: Context<Env>): string | null {
  const tenantId = c.req.param('tenantId');
  return tenantId === c.get('supportTenantId') ? tenantId : null;
}

/**
 * Filtro de data no fuso da loja (Brasil, UTC-3), igual aos relatórios: `from` começa 00:00 e
 * `to` termina 23:59:59.999 daquele dia. Sem `from`/`to` retorna `undefined` (todo o histórico).
 */
function buildDateFilter(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  const filter: { gte?: Date; lte?: Date } = {};
  if (from) filter.gte = new Date(`${from}T00:00:00.000-03:00`);
  if (to) filter.lte = new Date(`${to}T23:59:59.999-03:00`);
  return filter.gte || filter.lte ? filter : undefined;
}

/**
 * Encerra a sessão de suporte (marcador de auditoria). O token é curto e sem estado no
 * servidor, então "encerrar" não revoga o token em si (ele expira sozinho); o valor aqui é a
 * trilha `AuditEvent SUPPORT_SESSION_END` e limpar o token no cliente. `tenantId`/ator vêm do
 * escopo do próprio token (não de um parâmetro, para não encerrar sessão de outra loja).
 */
support.post('/end', async (c) => {
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }
  const tenantId = c.get('supportTenantId');
  const platformAdminId = c.get('supportPlatformAdminId');
  try {
    const prisma = createPrismaClient(connectionString);
    await prisma.auditEvent.create({
      data: {
        tenantId,
        userId: platformAdminId,
        entity: 'Tenant',
        entityId: tenantId,
        action: 'SUPPORT_SESSION_END',
        meta: { platform: true, support: true },
      },
    });
    return c.json({ ok: true });
  } catch (err) {
    console.error('POST /support/end falhou:', err);
    return c.json({ ok: false, error: 'Falha ao encerrar a sessão de suporte.' }, 500);
  }
});

/**
 * Visão geral (read-only) da loja-alvo para o painel de suporte: dados da loja, contadores,
 * caixa aberto, itens com estoque baixo, últimas vendas e últimos eventos de auditoria. O
 * `:tenantId` da URL DEVE bater com o escopo do token (senão 403) — o token só autoriza a loja
 * para a qual foi emitido.
 */
support.get('/:tenantId/overview', async (c) => {
  const tenantId = c.req.param('tenantId');
  if (tenantId !== c.get('supportTenantId')) {
    return c.json({ ok: false, error: 'Sessão de suporte não autoriza esta loja.' }, 403);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        cnpj: true,
        phone: true,
        isActive: true,
        createdAt: true,
      },
    });
    if (!tenant) {
      return c.json({ ok: false, error: 'Loja não encontrada.' }, 404);
    }

    const [productCount, customerCount, userCount, openCash, withMin, recentOrders, recentAudit] =
      await Promise.all([
        prisma.product.count({ where: { tenantId, deletedAt: null } }),
        prisma.customer.count({ where: { tenantId, deletedAt: null } }),
        prisma.user.count({ where: { tenantId } }),
        prisma.cashSession.findFirst({
          where: { tenantId, closedAt: null },
          orderBy: { openedAt: 'desc' },
          select: { id: true, openedAt: true, openingAmount: true },
        }),
        // Estoque baixo exige comparar duas colunas (stockQty <= minStockQty), que o Prisma não
        // faz no `where`; buscamos só os que têm mínimo definido e filtramos em memória.
        prisma.product.findMany({
          where: { tenantId, deletedAt: null, minStockQty: { gt: 0 } },
          select: { id: true, name: true, stockQty: true, minStockQty: true },
        }),
        prisma.order.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, status: true, total: true, createdAt: true },
        }),
        prisma.auditEvent.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, action: true, entity: true, createdAt: true },
        }),
      ]);

    const lowStock = withMin
      .filter((p) => num(p.stockQty) <= num(p.minStockQty))
      .slice(0, 10)
      .map((p) => ({ id: p.id, name: p.name, stockQty: num(p.stockQty), minStockQty: num(p.minStockQty) }));

    return c.json({
      ok: true,
      data: {
        tenant: { ...tenant, createdAt: tenant.createdAt.toISOString() },
        counts: { products: productCount, customers: customerCount, users: userCount },
        openCash: openCash
          ? {
              id: openCash.id,
              openedAt: openCash.openedAt.toISOString(),
              openingAmount: num(openCash.openingAmount),
            }
          : null,
        lowStock,
        recentOrders: recentOrders.map((o) => ({
          id: o.id,
          status: o.status,
          total: num(o.total),
          createdAt: o.createdAt.toISOString(),
        })),
        recentAudit: recentAudit.map((a) => ({
          id: a.id,
          action: a.action,
          entity: a.entity,
          createdAt: a.createdAt.toISOString(),
        })),
      },
    });
  } catch (err) {
    console.error('GET /support/:tenantId/overview falhou:', err);
    return c.json({ ok: false, error: 'Falha ao carregar a loja.' }, 500);
  }
});

/**
 * Vendas da loja-alvo (read-only) com filtros: período (`?from=&to=`, fuso da loja) e status
 * (`?status=CONFIRMED|CANCELLED|RETURNED|DRAFT`). Traz itens, pagamentos e o cliente de cada
 * venda para permitir "ver detalhes" na tela sem uma segunda chamada. Cap de 200 (mais recentes).
 */
support.get('/:tenantId/orders', async (c) => {
  const tenantId = scopedTenant(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Sessão de suporte não autoriza esta loja.' }, 403);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const from = c.req.query('from') || undefined;
  const to = c.req.query('to') || undefined;
  const statusRaw = c.req.query('status') || undefined;
  const status = ORDER_STATUSES.find((s) => s === statusRaw);
  const createdAt = buildDateFilter(from, to);

  try {
    const prisma = createPrismaClient(connectionString);
    const orders = await prisma.order.findMany({
      where: { tenantId, ...(status ? { status } : {}), ...(createdAt ? { createdAt } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        items: true,
        payments: { select: { id: true, method: true, amount: true } },
        customer: { select: { name: true } },
        cashSession: { select: { closedAt: true } },
      },
    });

    return c.json({
      ok: true,
      data: orders.map((o) => ({
        id: o.id,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        subtotal: num(o.subtotal),
        discountAmount: num(o.discountAmount),
        freightAmount: num(o.freightAmount),
        total: num(o.total),
        customerName: o.customer?.name ?? null,
        cashClosed: o.cashSession ? o.cashSession.closedAt !== null : null,
        items: o.items.map((it) => ({
          id: it.id,
          productName: it.productName,
          unit: it.unit,
          quantity: num(it.quantity),
          unitPrice: num(it.unitPrice),
          discount: num(it.discount),
          total: num(it.total),
        })),
        payments: o.payments.map((p) => ({ id: p.id, method: p.method, amount: num(p.amount) })),
      })),
    });
  } catch (err) {
    console.error('GET /support/:tenantId/orders falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar as vendas.' }, 500);
  }
});

/**
 * Produtos/materiais cadastrados da loja-alvo (read-only) com filtros: busca por nome/SKU
 * (`?q=`) e "só estoque baixo" (`?lowStock=1`). Traz preço/custo/margem, estoque atual/mínimo,
 * categoria e a flag de baixo. Cap de 300 (ordenado por nome).
 */
support.get('/:tenantId/products', async (c) => {
  const tenantId = scopedTenant(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Sessão de suporte não autoriza esta loja.' }, 403);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const q = (c.req.query('q') || '').trim();
  const lowOnly = c.req.query('lowStock') === '1';

  try {
    const prisma = createPrismaClient(connectionString);
    const products = await prisma.product.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { sku: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 300,
      include: { category: { select: { name: true } } },
    });

    const mapped = products
      .map((p) => {
        const stockQty = num(p.stockQty);
        const minStockQty = num(p.minStockQty);
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          unit: p.unit,
          categoryName: p.category?.name ?? null,
          costPrice: num(p.costPrice),
          salePrice: num(p.salePrice),
          marginPercent: calcMarginPercent(num(p.costPrice), num(p.salePrice)),
          stockQty,
          minStockQty,
          isActive: p.isActive,
          low: minStockQty > 0 && stockQty <= minStockQty,
        };
      })
      .filter((p) => (lowOnly ? p.low : true));

    return c.json({ ok: true, data: mapped });
  } catch (err) {
    console.error('GET /support/:tenantId/products falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar os produtos.' }, 500);
  }
});

/**
 * Movimentações de estoque da loja-alvo (read-only), mais recentes primeiro. Filtro opcional
 * por produto (`?productId=`). Traz nome/unidade do produto e o fornecedor (quando entrada de
 * compra). Base do "ver detalhes" de um material na aba de estoque. Cap de 100.
 */
support.get('/:tenantId/stock-movements', async (c) => {
  const tenantId = scopedTenant(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Sessão de suporte não autoriza esta loja.' }, 403);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const productId = c.req.query('productId') || undefined;

  try {
    const prisma = createPrismaClient(connectionString);
    const movements = await prisma.stockMovement.findMany({
      where: { tenantId, ...(productId ? { productId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        product: { select: { name: true, unit: true } },
        supplier: { select: { name: true } },
      },
    });

    return c.json({
      ok: true,
      data: movements.map((m) => ({
        id: m.id,
        type: m.type,
        quantity: num(m.quantity),
        unitCost: m.unitCost === null ? null : num(m.unitCost),
        reason: m.reason,
        createdAt: m.createdAt.toISOString(),
        productName: m.product?.name ?? null,
        unit: m.product?.unit ?? null,
        supplierName: m.supplier?.name ?? null,
      })),
    });
  } catch (err) {
    console.error('GET /support/:tenantId/stock-movements falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar as movimentações de estoque.' }, 500);
  }
});

export default support;
