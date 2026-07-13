import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import { calcSaleItemTotal, calcSaleTotals } from '@nexoloja/core';
import { cancelOrderSchema, createSaleSchema, returnOrderSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireActiveTenant, requireAuth } from '../middleware/auth';

const orders = new Hono<Env>();
orders.use('*', requireAuth);

/**
 * Lista as vendas com itens, pagamentos e status (mais recentes primeiro).
 *  - `?scope=all`: últimas vendas do tenant em qualquer sessão (base do Histórico
 *    de Vendas; inclui o estado do caixa de cada venda para decidir entre cancelar
 *    e devolver). Sem exigir caixa aberto.
 *  - padrão: vendas do caixa atualmente aberto do operador (base do cancelamento,
 *    restrito ao caixa aberto). Sem caixa aberto, retorna lista vazia.
 */
orders.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const scope = c.req.query('scope');

  try {
    const prisma = createPrismaClient(connectionString);

    if (scope === 'all') {
      const list = await prisma.order.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          items: true,
          payments: true,
          cashSession: { select: { id: true, closedAt: true } },
        },
      });
      return c.json({ ok: true, data: list });
    }

    const session = await prisma.cashSession.findFirst({
      where: { tenantId, userId, closedAt: null },
      select: { id: true },
    });
    if (!session) {
      return c.json({ ok: true, data: [] });
    }
    const list = await prisma.order.findMany({
      where: { tenantId, cashSessionId: session.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        items: true,
        payments: true,
        cashSession: { select: { id: true, closedAt: true } },
      },
    });
    return c.json({ ok: true, data: list });
  } catch (err) {
    console.error('GET /orders falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar as vendas.' }, 500);
  }
});

/**
 * Registra uma venda. Em uma única transação (ADR-001):
 *  - cria o Order (vinculado ao caixa) + OrderItems (snapshot) + Payments;
 *  - para cada item: grava StockMovement (saída) e decrementa Product.stockQty.
 * `requireActiveTenant` barra vendas novas quando a loja está inativa (ADR-009) antes de tudo.
 *
 * Dois caminhos, decididos pela presença de `id` no payload (ADR-011):
 *  - **Online (sem `id`):** o servidor gera a PK e deriva o caixa do **caixa aberto** do operador;
 *    estoque insuficiente é **bloqueado** (regra de sempre).
 *  - **Offline/sync (com `id` + `cashSessionId`):** **idempotente por PK** — se `orders.id` já
 *    existe, é no-op e devolve a venda já persistida (dedup do reenvio pós-crash, ADR-011 §2). O
 *    caixa é o informado no envelope (o que estava aberto na venda), validado contra tenant+user; e
 *    o estoque insuficiente **não bloqueia** — registra e deixa negativo para a reconciliação da
 *    ADR-001 (§6: a venda física já aconteceu). O débito de estoque ocorre aqui, no sync (§3).
 */
orders.post('/', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = createSaleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados da venda inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }
  const sale = parsed.data;
  const isOffline = !!sale.id; // `id` gerado no cliente ⇒ venda de origem offline (ADR-011)

  try {
    const prisma = createPrismaClient(connectionString);

    // Idempotência (ADR-011 §2): venda offline já sincronizada = no-op. Devolve a persistida.
    if (sale.id) {
      const existing = await prisma.order.findFirst({
        where: { id: sale.id, tenantId },
        include: { items: true, payments: true },
      });
      if (existing) {
        const paidExisting = existing.payments.reduce((acc, p) => acc + Number(p.amount), 0);
        return c.json(
          {
            ok: true,
            data: {
              ...existing,
              change: Number((paidExisting - Number(existing.total)).toFixed(2)),
              deduped: true,
            },
          },
          200,
        );
      }
    }

    // Caixa da venda: no offline, o do envelope (pode já estar fechado no momento do sync — a venda
    // pertence àquela sessão); no online, o caixa aberto do operador. Sempre validado tenant+user.
    const session = isOffline
      ? await prisma.cashSession.findFirst({
          where: { id: sale.cashSessionId, tenantId, userId },
          select: { id: true, closedAt: true },
        })
      : await prisma.cashSession.findFirst({
          where: { tenantId, userId, closedAt: null },
          select: { id: true, closedAt: true },
        });
    if (!session) {
      return c.json(
        {
          ok: false,
          error: isOffline
            ? 'Caixa da venda offline não encontrado para esta loja/operador.'
            : 'Abra o caixa antes de registrar uma venda.',
        },
        400,
      );
    }

    // CS-4 (ADR-012, decisão (b)): a venda offline pode referenciar um caixa que já foi FECHADO
    // (noutro dispositivo) até o sync. A venda ocorreu fisicamente naquele turno, então **anexamos
    // mesmo assim** (não rejeitamos) e **marcamos para reconciliação** (AuditEvent abaixo) — a
    // divergência aparece no relatório de fechamento, como o estoque negativo do ADR-011 §6.
    const cashClosedAt = isOffline ? session.closedAt : null;

    // Carrega os produtos do tenant e valida existência (sempre) + estoque (só bloqueia online).
    const ids = sale.items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: ids }, tenantId, deletedAt: null },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    for (const item of sale.items) {
      const p = byId.get(item.productId);
      if (!p) {
        return c.json({ ok: false, error: 'Produto inexistente na venda.' }, 400);
      }
      // Estoque insuficiente: bloqueia no online; no offline registra e deixa negativo (§6).
      if (!isOffline && Number(p.stockQty) < item.quantity) {
        return c.json(
          {
            ok: false,
            error: `Estoque insuficiente para "${p.name}" (disponível: ${Number(p.stockQty)}).`,
          },
          400,
        );
      }
    }

    const { subtotal, total } = calcSaleTotals(sale.items, {
      discountAmount: sale.discountAmount,
      freightAmount: sale.freightAmount,
    });
    const paid = Number(sale.payments.reduce((acc, pmt) => acc + pmt.amount, 0).toFixed(2));
    if (paid + 1e-9 < total) {
      return c.json(
        { ok: false, error: `Pagamento insuficiente: total ${total.toFixed(2)}, pago ${paid.toFixed(2)}.` },
        400,
      );
    }

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          // Offline: usa a PK gerada no cliente (idempotência). Online: deixa o @default(uuid).
          ...(sale.id ? { id: sale.id } : {}),
          tenantId,
          userId,
          // Autoria (ADR-010): snapshot do nome de quem registrou a venda.
          registeredByName: c.get('userName'),
          customerId: sale.customerId,
          cashSessionId: session.id,
          status: 'CONFIRMED',
          subtotal,
          discountAmount: sale.discountAmount ?? 0,
          freightAmount: sale.freightAmount ?? 0,
          total,
          notes: sale.notes,
          syncStatus: 'SYNCED',
          items: {
            create: sale.items.map((item) => {
              const p = byId.get(item.productId)!;
              return {
                productId: item.productId,
                productName: p.name, // snapshot
                unit: p.unit, // snapshot
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                discount: item.discount ?? 0,
                total: calcSaleItemTotal(item),
              };
            }),
          },
          payments: {
            create: sale.payments.map((pmt) => ({
              tenantId, // denormalizado (ADR-003)
              method: pmt.method,
              amount: pmt.amount,
            })),
          },
        },
        include: { items: true, payments: true },
      });

      // ADR-001: cada item gera saída de estoque + decremento atômico do cache (pode ficar
      // negativo no sync offline — sinaliza cadastro desatualizado, vai p/ reconciliação, §6).
      for (const item of sale.items) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: item.productId,
            type: 'EXPENSE',
            quantity: item.quantity,
            reason: `Venda ${created.id}`,
            syncStatus: 'SYNCED',
            userId, // autoria (ADR-010)
            registeredByName: c.get('userName'),
          },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: { decrement: item.quantity } },
        });
      }

      // CS-4 (ADR-004/012 §b): marca de reconciliação quando a venda offline foi anexada a um caixa
      // JÁ FECHADO. Evento crítico auditável (não bloqueia a venda) — surge no relatório de fechamento.
      if (cashClosedAt) {
        // CS-5: guarda a parcela em DINHEIRO da venda no `meta` para o relatório recalcular o
        // "esperado ajustado" sem precisar de join nos pagamentos (só o dinheiro toca a gaveta;
        // cartão/PIX conciliam na maquininha, igual ao cálculo do esperado no fechamento).
        const cashAmount = Number(
          sale.payments
            .reduce((acc, pmt) => acc + (pmt.method === 'CASH' ? pmt.amount : 0), 0)
            .toFixed(2),
        );
        await tx.auditEvent.create({
          data: {
            tenantId,
            userId,
            entity: 'Order',
            entityId: created.id,
            action: 'SALE_ON_CLOSED_CASH',
            meta: {
              cashSessionId: session.id,
              cashClosedAt: cashClosedAt.toISOString(),
              total,
              cashAmount,
              offline: true,
              reconcile: true,
            },
          },
        });
      }

      return created;
    });

    return c.json(
      {
        ok: true,
        data: {
          ...order,
          change: Number((paid - total).toFixed(2)),
          // CS-4: sinaliza ao cliente que a venda foi anexada a um caixa já fechado (reconciliação).
          ...(cashClosedAt ? { syncedToClosedCash: true } : {}),
        },
      },
      201,
    );
  } catch (err) {
    // Corrida rara: dois syncs do mesmo `id` ao mesmo tempo → o 2º viola a PK. Trata como dedup.
    if (isOffline && err instanceof Error && (err as { code?: string }).code === 'P2002') {
      return c.json({ ok: true, data: { id: sale.id, deduped: true } }, 200);
    }
    console.error('POST /orders falhou:', err);
    return c.json({ ok: false, error: 'Falha ao registrar a venda.' }, 500);
  }
});

/**
 * Cancela uma venda (ADR-004). Restrito ao caixa aberto do operador para não
 * corromper caixas já fechados. Em uma única transação:
 *  - estorna o estoque: para cada item, grava StockMovement INCOME (reverso da
 *    saída da venda) e incrementa Product.stockQty (ADR-001);
 *  - marca o Order como CANCELLED;
 *  - registra AuditEvent CANCEL_ORDER com o motivo.
 * Os Payments são preservados (auditoria); o caixa recalcula sozinho porque o
 * cálculo de entrada em dinheiro ignora pedidos CANCELLED.
 */
orders.post('/:id/cancel', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const orderId = c.req.param('id');
  const parsed = cancelOrderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Informe o motivo do cancelamento.', issues: parsed.error.flatten() },
      400,
    );
  }
  const { reason } = parsed.data;

  try {
    const prisma = createPrismaClient(connectionString);

    // Caixa aberto do operador: o cancelamento só vale para vendas dele.
    const session = await prisma.cashSession.findFirst({
      where: { tenantId, userId, closedAt: null },
      select: { id: true },
    });
    if (!session) {
      return c.json({ ok: false, error: 'Abra o caixa para cancelar uma venda.' }, 400);
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { items: true },
    });
    if (!order) {
      return c.json({ ok: false, error: 'Venda não encontrada.' }, 404);
    }
    if (order.status === 'CANCELLED') {
      return c.json({ ok: false, error: 'Esta venda já foi cancelada.' }, 409);
    }
    if (order.status !== 'CONFIRMED') {
      return c.json({ ok: false, error: 'Só é possível cancelar vendas confirmadas.' }, 400);
    }
    if (order.cashSessionId !== session.id) {
      return c.json(
        { ok: false, error: 'Só é possível cancelar vendas do caixa aberto atual.' },
        400,
      );
    }

    const cancelled = await prisma.$transaction(async (tx) => {
      // ADR-001: estorna cada item — movimento reverso (INCOME) + incremento do cache.
      for (const item of order.items) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: item.productId,
            type: 'INCOME',
            quantity: item.quantity,
            reason: `Cancelamento da venda ${order.id}`,
            syncStatus: 'SYNCED',
            userId, // autoria (ADR-010): quem cancelou/estornou
            registeredByName: c.get('userName'),
          },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: { increment: item.quantity } },
        });
      }

      const updated = await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
        include: { items: true, payments: true },
      });

      // Evento crítico (ADR-004): cancelamento de venda.
      await tx.auditEvent.create({
        data: {
          tenantId,
          userId,
          entity: 'Order',
          entityId: order.id,
          action: 'CANCEL_ORDER',
          meta: {
            reason,
            total: Number(order.total),
            itemsCount: order.items.length,
            cashSessionId: session.id,
          },
        },
      });

      return updated;
    });

    return c.json({ ok: true, data: cancelled });
  } catch (err) {
    console.error('POST /orders/:id/cancel falhou:', err);
    return c.json({ ok: false, error: 'Falha ao cancelar a venda.' }, 500);
  }
});

/**
 * Devolve uma venda de caixa já FECHADO (ADR-006). Diferente do cancelamento
 * (restrito ao caixa aberto), a devolução preserva a venda e o caixa originais e,
 * em uma única transação:
 *  - estorna o estoque: para cada item, StockMovement INCOME reverso + incremento
 *    de Product.stockQty (ADR-001, reaproveita o motor do cancelamento);
 *  - lança a SAÍDA de dinheiro no caixa de HOJE: CashMovement EXPENSE/RETURN com o
 *    valor total da venda (reduz o esperado do caixa aberto atual);
 *  - marca o Order como RETURNED (bloqueia devolução dupla; segue contando como
 *    faturamento do dia original — o relatório só exclui CANCELLED);
 *  - registra AuditEvent RETURN_ORDER com o motivo.
 * Exige um caixa aberto (destino da saída). Vendas do próprio caixa aberto devem
 * ser canceladas (não devolvidas).
 */
orders.post('/:id/return', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const orderId = c.req.param('id');
  const parsed = returnOrderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Informe o motivo da devolução.', issues: parsed.error.flatten() },
      400,
    );
  }
  const { reason } = parsed.data;

  try {
    const prisma = createPrismaClient(connectionString);

    // Caixa aberto do operador: destino da saída de dinheiro da devolução.
    const session = await prisma.cashSession.findFirst({
      where: { tenantId, userId, closedAt: null },
      select: { id: true },
    });
    if (!session) {
      return c.json({ ok: false, error: 'Abra o caixa para registrar a devolução.' }, 400);
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { items: true },
    });
    if (!order) {
      return c.json({ ok: false, error: 'Venda não encontrada.' }, 404);
    }
    if (order.status === 'RETURNED') {
      return c.json({ ok: false, error: 'Esta venda já foi devolvida.' }, 409);
    }
    if (order.status === 'CANCELLED') {
      return c.json({ ok: false, error: 'Esta venda foi cancelada; não há o que devolver.' }, 409);
    }
    if (order.status !== 'CONFIRMED') {
      return c.json({ ok: false, error: 'Só é possível devolver vendas confirmadas.' }, 400);
    }
    // Venda do próprio caixa aberto: o certo é cancelar (estorno na mesma sessão).
    if (order.cashSessionId === session.id) {
      return c.json(
        { ok: false, error: 'Esta venda é do caixa aberto atual; use Cancelar em vez de Devolver.' },
        400,
      );
    }

    const total = Number(order.total);

    const returned = await prisma.$transaction(async (tx) => {
      // ADR-001: estorna cada item — movimento reverso (INCOME) + incremento do cache.
      for (const item of order.items) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: item.productId,
            type: 'INCOME',
            quantity: item.quantity,
            reason: `Devolução da venda ${order.id}`,
            syncStatus: 'SYNCED',
            userId, // autoria (ADR-010): quem devolveu/estornou
            registeredByName: c.get('userName'),
          },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: { increment: item.quantity } },
        });
      }

      // ADR-006: saída de dinheiro no caixa de HOJE (não no caixa original).
      const movement = await tx.cashMovement.create({
        data: {
          tenantId,
          cashSessionId: session.id,
          userId,
          type: 'EXPENSE',
          kind: 'RETURN',
          amount: total,
          reason: reason,
          relatedOrderId: order.id,
          syncStatus: 'SYNCED',
          registeredByName: c.get('userName'), // autoria (ADR-010)
        },
      });

      const updated = await tx.order.update({
        where: { id: order.id },
        data: { status: 'RETURNED' },
        include: { items: true, payments: true },
      });

      // Evento crítico (ADR-004/006): devolução de venda.
      await tx.auditEvent.create({
        data: {
          tenantId,
          userId,
          entity: 'Order',
          entityId: order.id,
          action: 'RETURN_ORDER',
          meta: {
            reason,
            total,
            itemsCount: order.items.length,
            originalCashSessionId: order.cashSessionId,
            refundCashSessionId: session.id,
            cashMovementId: movement.id,
          },
        },
      });

      return { order: updated, movement };
    });

    return c.json({ ok: true, data: returned });
  } catch (err) {
    console.error('POST /orders/:id/return falhou:', err);
    return c.json({ ok: false, error: 'Falha ao registrar a devolução.' }, 500);
  }
});

export default orders;
