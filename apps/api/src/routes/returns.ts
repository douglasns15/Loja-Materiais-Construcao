import { Hono } from 'hono';
import { applyDefectResolution, isResolvableDefect } from '@nexoloja/core';
import { formatOrderNumber, resolveDefectSchema } from '@nexoloja/shared';
import { type Env, getPrisma, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

/**
 * Rotas de DEVOLUÇÕES pós-venda que não vivem no ciclo de uma venda específica (ADR-033). Hoje:
 * a fila de itens devolvidos com DEFEITO — o operador consulta o que está parado aguardando
 * acerto com o fornecedor e resolve cada um (repor no estoque quando o fornecedor troca, ou dar
 * baixa/perda). A devolução em si (que marca a condição) continua em `POST /orders/:id/return-items`.
 */
const returns = new Hono<Env>();
returns.use('*', requireAuth);

/**
 * Lista os itens devolvidos com DEFEITO ainda PENDENTES (ADR-033). Cada linha traz o produto, a
 * quantidade parada (unidade-base), o valor da devolução (referência p/ o acerto), o motivo, a
 * venda de origem (`V-000XXX`) e — quando dá para inferir — o fornecedor da última entrada do
 * produto (candidato à troca). A fila costuma ser curta; sem paginação nesta fatia.
 */
returns.get('/defective', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ ok: false, error: 'Contexto inválido.' }, 400);

  try {
    const prisma = getPrisma(c);
    const rows = await prisma.orderReturnItem.findMany({
      where: { tenantId, condition: 'DEFECTIVE', defectStatus: 'PENDING' },
      select: {
        id: true,
        baseQty: true,
        value: true,
        orderItem: { select: { productId: true, productName: true } },
        orderReturn: {
          select: {
            reason: true,
            createdAt: true,
            orderId: true,
            order: { select: { orderNumber: true } },
          },
        },
      },
      orderBy: { orderReturn: { createdAt: 'desc' } },
    });

    // Fornecedor candidato à troca: o da ENTRADA mais recente daquele produto (Product não tem
    // fornecedor fixo — o vínculo real vive no StockMovement de compra). Uma consulta só p/ todos
    // os produtos da fila; o primeiro (mais recente) por produto vence.
    const productIds = [...new Set(rows.map((r) => r.orderItem.productId))];
    const supByProduct = new Map<string, string>();
    if (productIds.length > 0) {
      const supRows = await prisma.stockMovement.findMany({
        where: { tenantId, productId: { in: productIds }, type: 'INCOME', supplierId: { not: null } },
        select: { productId: true, supplier: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      for (const s of supRows) {
        if (!supByProduct.has(s.productId) && s.supplier) supByProduct.set(s.productId, s.supplier.name);
      }
    }

    const data = rows.map((r) => ({
      orderReturnItemId: r.id,
      productId: r.orderItem.productId,
      productName: r.orderItem.productName,
      baseQty: Number(r.baseQty),
      value: Number(r.value),
      reason: r.orderReturn.reason,
      orderId: r.orderReturn.orderId,
      orderNumber: r.orderReturn.order.orderNumber,
      supplierName: supByProduct.get(r.orderItem.productId) ?? null,
      createdAt: r.orderReturn.createdAt.toISOString(),
    }));

    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /returns/defective falhou:', err);
    return c.json({ ok: false, error: 'Falha ao carregar os itens com defeito.' }, 500);
  }
});

/**
 * Resolve UM item devolvido com defeito (ADR-033). Em transação atômica (ADR-001):
 *  - `RESTOCK` (fornecedor trocou): o substituto entra no estoque VENDÁVEL — `StockMovement INCOME`
 *    + `Product.stockQty += base` — e sai do cache de defeituosos (`defectiveQty −= base`);
 *  - `WRITE_OFF` (baixa/perda): só sai do cache de defeituosos (nenhum estoque vendável se move);
 *  - marca a linha `RESTOCKED`/`WRITTEN_OFF` + autoria/quando (trava contra resolver 2×);
 *  - grava `AuditEvent` (ADR-004).
 */
returns.post('/defective/:id/resolve', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  if (!tenantId) return c.json({ ok: false, error: 'Contexto inválido.' }, 400);

  const itemId = c.req.param('id');
  const parsed = resolveDefectSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados da resolução inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }
  const { action, note } = parsed.data;

  try {
    const prisma = getPrisma(c);
    const line = await prisma.orderReturnItem.findFirst({
      where: { id: itemId, tenantId },
      select: {
        id: true,
        baseQty: true,
        condition: true,
        defectStatus: true,
        orderItem: { select: { productId: true, productName: true } },
        orderReturn: { select: { orderId: true, order: { select: { orderNumber: true } } } },
      },
    });
    if (!line) return c.json({ ok: false, error: 'Item não encontrado.' }, 404);
    if (line.condition !== 'DEFECTIVE') {
      return c.json({ ok: false, error: 'Este item não é um defeito.' }, 400);
    }
    if (!isResolvableDefect(line.defectStatus)) {
      return c.json({ ok: false, error: 'Este defeito já foi resolvido.' }, 409);
    }

    const base = Number(line.baseQty);
    const { defectStatus, restockToSellable } = applyDefectResolution(action);
    const userName = c.get('userName');

    const result = await prisma.$transaction(async (tx) => {
      // Sai do cache de defeituosos nas duas ações.
      let productStockQty: number | null = null;
      if (restockToSellable) {
        // Reposição do substituto: entrada no estoque vendável (ADR-001) + baixa do defeituoso.
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: line.orderItem.productId,
            type: 'INCOME',
            quantity: base,
            reason: `Troca de defeito (fornecedor) — venda ${formatOrderNumber(line.orderReturn.order.orderNumber)}`,
            syncStatus: 'SYNCED',
            userId, // autoria (ADR-010)
            registeredByName: userName,
          },
        });
        const prod = await tx.product.update({
          where: { id: line.orderItem.productId },
          data: { stockQty: { increment: base }, defectiveQty: { decrement: base } },
          select: { stockQty: true },
        });
        productStockQty = Number(prod.stockQty);
      } else {
        await tx.product.update({
          where: { id: line.orderItem.productId },
          data: { defectiveQty: { decrement: base } },
        });
      }

      await tx.orderReturnItem.update({
        where: { id: line.id },
        data: { defectStatus, resolvedAt: new Date(), resolvedById: userId, resolvedByName: userName },
      });

      await tx.auditEvent.create({
        data: {
          tenantId,
          userId,
          entity: 'OrderReturnItem',
          entityId: line.id,
          action: 'RESOLVE_DEFECT',
          meta: {
            resolution: defectStatus,
            productId: line.orderItem.productId,
            productName: line.orderItem.productName,
            baseQty: base,
            orderId: line.orderReturn.orderId,
            note: note ?? null,
          },
        },
      });

      return { productStockQty };
    });

    return c.json({
      ok: true,
      data: {
        orderReturnItemId: line.id,
        defectStatus,
        restocked: restockToSellable,
        productStockQty: result.productStockQty,
      },
    });
  } catch (err) {
    console.error('POST /returns/defective/:id/resolve falhou:', err);
    return c.json({ ok: false, error: 'Falha ao resolver o item com defeito.' }, 500);
  }
});

export default returns;
