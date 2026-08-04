import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import {
  applyReceivablePayment,
  customerAccountBalance,
  distributeAccountPayment,
  isValidReceipt,
  manualCashMovementType,
  receivableBalance,
} from '@nexoloja/core';
import { receiveReceivableSchema, updateReceivableSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireActiveTenant, requireAuth } from '../middleware/auth';

const receivables = new Hono<Env>();
receivables.use('*', requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;

type Cursor = { createdAt: string; id: string };

/** Cursor keyset opaco (base64 de `createdAt|id`), como no Histórico de Vendas. */
function encodeCursor(r: { createdAt: Date; id: string }): string {
  return Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString('base64url');
}
function decodeCursor(raw: string): Cursor | null {
  try {
    const [createdAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id || !UUID_RE.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Lista as contas a receber (venda a prazo — ADR-019), **paginada por cursor keyset** (como as
 * demais telas grandes) em `createdAt desc, id desc`. Filtros: `status` = `open` (default) /
 * `paid` (quitadas) / `all` (abertas + quitadas); `q` busca por nome do cliente; `limit`/`cursor`.
 * Responde `{ rows, nextCursor }`. Cada linha traz o **saldo devedor** (fonte única do core) e o
 * nome do cliente. */
receivables.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const statusParam = c.req.query('status');
  const OPEN_PAID: ('OPEN' | 'PAID')[] = ['OPEN', 'PAID'];
  const statusWhere =
    statusParam === 'paid'
      ? { status: 'PAID' as const }
      : statusParam === 'all'
        ? { status: { in: OPEN_PAID } }
        : { status: 'OPEN' as const };

  const q = (c.req.query('q') ?? '').trim();
  const qWhere = q ? { customer: { name: { contains: q, mode: 'insensitive' as const } } } : {};

  const limitRaw = Number(c.req.query('limit'));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), PAGE_MAX) : PAGE_DEFAULT;
  const cursorParam = c.req.query('cursor');
  const cursor = cursorParam ? decodeCursor(cursorParam) : null;
  const keyset = cursor
    ? {
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      }
    : {};

  try {
    const prisma = createPrismaClient(connectionString);
    const list = await prisma.receivable.findMany({
      where: { tenantId, ...statusWhere, ...qWhere, ...keyset },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        orderId: true,
        customerId: true,
        originalAmount: true,
        settledAmount: true,
        returnedAmount: true,
        status: true,
        dueDate: true,
        createdAt: true,
        createdByName: true,
        customer: { select: { name: true } },
      },
    });
    const hasMore = list.length > limit;
    const page = hasMore ? list.slice(0, limit) : list;
    const rows = page.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      customerId: r.customerId,
      customerName: r.customer?.name ?? null,
      originalAmount: r.originalAmount,
      settledAmount: r.settledAmount,
      balance: receivableBalance(Number(r.originalAmount), Number(r.settledAmount), Number(r.returnedAmount)),
      status: r.status,
      dueDate: r.dueDate,
      createdAt: r.createdAt,
      createdByName: r.createdByName,
    }));
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last) : null;
    return c.json({ ok: true, data: { rows, nextCursor } });
  } catch (err) {
    console.error('GET /receivables falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar as contas a receber.' }, 500);
  }
});

/**
 * CONTAS agrupadas por cliente (ADR-022, Fatia A). A "conta do cliente" é implícita: soma dos
 * saldos devedores das dívidas EM ABERTO de cada cliente — o balcão vê um saldo único por
 * pessoa em vez de N dívidas soltas. `q` busca por nome do cliente. Ordena pelo maior devedor.
 * Como só clientes COM fiado em aberto aparecem (o `groupBy` colapsa 1 linha por cliente), o
 * conjunto é naturalmente pequeno; teto defensivo de 500 (se um dia passar disso, vira busca
 * paginada). Responde `{ rows }` — cada linha: cliente, saldo total, nº de dívidas, vencimento
 * mais próximo e se está vencida. */
receivables.get('/accounts', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const q = (c.req.query('q') ?? '').trim();
  const qWhere = q ? { customer: { name: { contains: q, mode: 'insensitive' as const } } } : {};

  try {
    const prisma = createPrismaClient(connectionString);
    // Agrega as dívidas OPEN por cliente. Numa dívida OPEN o saldo é sempre > 0 (vira PAID quando
    // recebido ≥ original), então `Σ original − Σ settled` = soma dos saldos devedores.
    const grouped = await prisma.receivable.groupBy({
      by: ['customerId'],
      where: { tenantId, status: 'OPEN', ...qWhere },
      _sum: { originalAmount: true, settledAmount: true, returnedAmount: true },
      _count: { _all: true },
      _min: { createdAt: true, dueDate: true },
      // groupBy exige orderBy quando há `take`; ordena pelo maior devedor (o sort final em JS
      // usa o saldo exato, mas isto já traz os maiores dentro do teto defensivo).
      orderBy: { _sum: { originalAmount: 'desc' } },
      take: 500,
    });
    if (grouped.length === 0) {
      return c.json({ ok: true, data: { rows: [] } });
    }

    const customerIds = grouped.map((g) => g.customerId);
    const customers = await prisma.customer.findMany({
      where: { tenantId, id: { in: customerIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(customers.map((cu) => [cu.id, cu.name]));

    const rows = grouped
      .map((g) => ({
        customerId: g.customerId,
        customerName: nameById.get(g.customerId) ?? null,
        totalBalance: receivableBalance(
          Number(g._sum.originalAmount ?? 0),
          Number(g._sum.settledAmount ?? 0),
          Number(g._sum.returnedAmount ?? 0),
        ),
        openCount: g._count._all,
        oldestCreatedAt: g._min.createdAt,
        nextDueDate: g._min.dueDate,
      }))
      // Maior devedor primeiro (visão "quem me deve"); desempate por nome.
      .sort(
        (a, b) =>
          b.totalBalance - a.totalBalance ||
          (a.customerName ?? '').localeCompare(b.customerName ?? '', 'pt-BR'),
      );

    return c.json({ ok: true, data: { rows } });
  } catch (err) {
    console.error('GET /receivables/accounts falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar as contas dos clientes.' }, 500);
  }
});

/**
 * Recebe contra a CONTA INTEIRA do cliente (ADR-022, Fatia A): um valor único abate as dívidas
 * em aberto do cliente **do mais antigo para o mais novo** (FIFO, `distributeAccountPayment` do
 * core). Em transação: se em DINHEIRO, lança **um** `CashMovement SUPPLY` pelo total no caixa
 * aberto (reúso da CX.Movimentacao — por isso exige caixa aberto), e cria um `ReceivablePayment`
 * por dívida tocada, atualizando cada saldo/situação. O caixa recebe uma linha só (o valor todo),
 * limpa. Cada `paidAt` = agora (o relatório em regime de caixa conta no dia do recebimento). */
receivables.post('/accounts/:customerId/receive', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const customerId = c.req.param('customerId');
  if (!UUID_RE.test(customerId)) {
    return c.json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  }

  const parsed = receiveReceivableSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Dados do recebimento inválidos.' }, 400);
  }
  const { amount, method, reference } = parsed.data;

  try {
    const prisma = createPrismaClient(connectionString);
    // Dívidas em aberto do cliente, da mais antiga para a mais nova (ordem do FIFO).
    const open = await prisma.receivable.findMany({
      where: { tenantId, customerId, status: 'OPEN' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        originalAmount: true,
        settledAmount: true,
        returnedAmount: true,
        customer: { select: { name: true } },
      },
    });
    if (open.length === 0) {
      return c.json({ ok: false, error: 'Este cliente não tem contas em aberto.' }, 409);
    }

    const byId = new Map(
      open.map((r) => [
        r.id,
        {
          original: Number(r.originalAmount),
          settled: Number(r.settledAmount),
          returned: Number(r.returnedAmount),
        },
      ]),
    );
    const accountRecs = open.map((r) => ({
      id: r.id,
      balance: receivableBalance(Number(r.originalAmount), Number(r.settledAmount), Number(r.returnedAmount)),
    }));
    const totalBalance = customerAccountBalance(accountRecs);
    if (!isValidReceipt(amount, totalBalance)) {
      return c.json(
        { ok: false, error: `Valor inválido: o saldo da conta é ${totalBalance.toFixed(2)}.` },
        400,
      );
    }

    // Recebimento em dinheiro precisa de caixa aberto (é onde o dinheiro entra — ADR-018).
    let openSessionId: string | null = null;
    if (method === 'CASH') {
      const session = await prisma.cashSession.findFirst({
        where: { tenantId, closedAt: null },
        select: { id: true },
      });
      if (!session) {
        return c.json({ ok: false, error: 'Abra o caixa para receber em dinheiro.' }, 404);
      }
      openSessionId = session.id;
    }

    const allocations = distributeAccountPayment(amount, accountRecs);
    const customerName = open[0]?.customer?.name ?? 'cliente';

    const result = await prisma.$transaction(async (tx) => {
      // Uma única linha no caixa pelo TOTAL recebido (não uma por dívida) — extrato limpo.
      let cashMovementId: string | null = null;
      if (method === 'CASH' && openSessionId) {
        const movement = await tx.cashMovement.create({
          data: {
            tenantId,
            cashSessionId: openSessionId,
            userId,
            type: manualCashMovementType('SUPPLY'), // INCOME
            kind: 'SUPPLY',
            amount,
            // Sem `relatedOrderId` (marcador de estorno — ver o receive por dívida). É Suprimento comum.
            reason: `Recebimento de conta — ${customerName}`,
            syncStatus: 'SYNCED',
            registeredByName: c.get('userName'), // autoria (ADR-010)
          },
        });
        cashMovementId = movement.id;
      }

      let fullyPaidCount = 0;
      for (const alloc of allocations) {
        const cur = byId.get(alloc.receivableId);
        if (!cur) continue; // defensivo — allocations vêm das dívidas carregadas
        const next = applyReceivablePayment(cur.original, cur.settled, alloc.amount, cur.returned);
        await tx.receivablePayment.create({
          data: {
            tenantId,
            receivableId: alloc.receivableId,
            amount: alloc.amount,
            method,
            reference: reference ?? null,
            cashSessionId: openSessionId,
            cashMovementId,
            receivedById: userId, // autoria (ADR-010)
            receivedByName: c.get('userName'),
          },
        });
        await tx.receivable.update({
          where: { id: alloc.receivableId },
          data: { settledAmount: next.settledAmount, status: next.status },
        });
        if (next.fullyPaid) fullyPaidCount += 1;
      }

      return { fullyPaidCount };
    });

    const remainingBalance = Number((totalBalance - amount).toFixed(2));
    return c.json(
      {
        ok: true,
        data: {
          customerId,
          received: amount,
          remainingBalance,
          fullyPaidCount: result.fullyPaidCount,
          debtsTouched: allocations.length,
          accountCleared: remainingBalance <= 0,
        },
      },
      201,
    );
  } catch (err) {
    console.error('POST /receivables/accounts/:customerId/receive falhou:', err);
    return c.json({ ok: false, error: 'Falha ao registrar o recebimento.' }, 500);
  }
});

/**
 * Detalhe da CONTA de um cliente (ADR-022, Fatia A.2): tudo que compõe o extrato/timeline da
 * conta — as vendas a prazo do cliente (em aberto e quitadas; canceladas ficam de fora) com seus
 * itens, e os recebimentos de cada uma. A UI monta o LOG único (venda → +itens, recebimento →
 * −valor) em ordem cronológica. `totalBalance`/`openCount` resumem o que ele ainda deve. Teto de
 * 100 vendas (a conta de um cliente de fiado é naturalmente pequena; o histórico completo fica no
 * perfil/"Por venda"). Só leitura — sem migration. */
receivables.get('/accounts/:customerId', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const customerId = c.req.param('customerId');
  if (!UUID_RE.test(customerId)) {
    return c.json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true, name: true, debtNotes: true, creditBalance: true },
    });
    if (!customer) {
      return c.json({ ok: false, error: 'Cliente não encontrado.' }, 404);
    }

    const list = await prisma.receivable.findMany({
      // OPEN + PAID compõem o extrato; CANCELLED (venda caiu) fica de fora.
      where: { tenantId, customerId, status: { in: ['OPEN', 'PAID'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], // mais antiga primeiro (ordem do extrato)
      take: 100,
      select: {
        id: true,
        orderId: true,
        originalAmount: true,
        settledAmount: true,
        returnedAmount: true,
        status: true,
        dueDate: true,
        createdAt: true,
        order: {
          select: {
            total: true,
            items: {
              select: {
                productName: true,
                unit: true,
                quantity: true,
                unitPrice: true,
                total: true,
                pairGroup: true,
              },
            },
          },
        },
        payments: {
          orderBy: { paidAt: 'asc' },
          select: {
            id: true,
            amount: true,
            method: true,
            paidAt: true,
            receivedByName: true,
            reference: true,
          },
        },
      },
    });

    const receivables = list.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      originalAmount: r.originalAmount,
      settledAmount: r.settledAmount,
      balance: receivableBalance(Number(r.originalAmount), Number(r.settledAmount), Number(r.returnedAmount)),
      status: r.status,
      dueDate: r.dueDate,
      createdAt: r.createdAt,
      orderTotal: r.order?.total ?? null,
      items: r.order?.items ?? [],
      payments: r.payments,
    }));

    // Devoluções do cliente (ADR-022, Fatia B): eventos PRÓPRIOS do extrato (append-only — a venda
    // original fica intacta). A UI os intercala na timeline. `abatedAmount` abate o saldo devedor;
    // `excessAmount` virou crédito/dinheiro (`target`), fora do saldo. Cada linha (`OrderReturnItem`)
    // guarda a quantidade em UNIDADE-BASE (estorno de estoque) — reconvertemos para a unidade VENDIDA
    // pelo mesmo fator do PDV (`baseQty/soldQty`), para casar com o que a venda mostra.
    const returnRows = await prisma.orderReturn.findMany({
      where: { tenantId, customerId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        createdAt: true,
        totalValue: true,
        abatedAmount: true,
        excessAmount: true,
        target: true,
        reason: true,
        createdByName: true,
        items: {
          select: {
            baseQty: true,
            value: true,
            orderItem: {
              select: { productName: true, quantity: true, baseQuantity: true },
            },
          },
        },
      },
    });
    const returns = returnRows.map((rt) => ({
      id: rt.id,
      createdAt: rt.createdAt,
      totalValue: rt.totalValue,
      abatedAmount: rt.abatedAmount,
      excessAmount: rt.excessAmount,
      target: rt.target,
      reason: rt.reason,
      createdByName: rt.createdByName,
      items: rt.items.map((li) => {
        const soldQty = Number(li.orderItem.quantity);
        const baseQty = Number(li.orderItem.baseQuantity ?? li.orderItem.quantity);
        const basePerSold = soldQty > 0 ? baseQty / soldQty : 1;
        const returnedSold = basePerSold > 0 ? Number(li.baseQty) / basePerSold : Number(li.baseQty);
        return {
          productName: li.orderItem.productName,
          quantity: returnedSold.toFixed(4), // devolvido, na unidade vendida
          total: li.value,
        };
      }),
    }));

    const totalBalance = customerAccountBalance(
      receivables.filter((r) => r.status === 'OPEN').map((r) => ({ id: r.id, balance: r.balance })),
    );
    const openCount = receivables.filter((r) => r.status === 'OPEN').length;

    return c.json({
      ok: true,
      data: {
        customerId: customer.id,
        customerName: customer.name,
        debtNotes: customer.debtNotes, // observação da DÍVIDA (separada do cadastro — ADR-022)
        creditBalance: Number(customer.creditBalance), // crédito a favor (ADR-022 Fatia B)
        totalBalance,
        openCount,
        receivables,
        returns,
      },
    });
  } catch (err) {
    console.error('GET /receivables/accounts/:customerId falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar a conta do cliente.' }, 500);
  }
});

/** Detalhe de uma conta a receber + o histórico de recebimentos (para o painel "Receber"). */
receivables.get('/:id', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'Conta não encontrada.' }, 404);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const r = await prisma.receivable.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        orderId: true,
        customerId: true,
        originalAmount: true,
        settledAmount: true,
        returnedAmount: true,
        status: true,
        dueDate: true,
        notes: true,
        createdAt: true,
        createdByName: true,
        customer: { select: { name: true, debtNotes: true } },
        // Itens da venda de origem (a "dívida" detalhada) + o total da venda.
        order: {
          select: {
            total: true,
            createdAt: true,
            items: {
              select: {
                productName: true,
                unit: true,
                quantity: true,
                unitPrice: true,
                total: true,
                pairGroup: true,
              },
            },
            payments: { select: { method: true, amount: true } },
          },
        },
        payments: {
          orderBy: { paidAt: 'desc' },
          select: {
            id: true,
            amount: true,
            method: true,
            paidAt: true,
            receivedByName: true,
            reference: true,
          },
        },
      },
    });
    if (!r) {
      return c.json({ ok: false, error: 'Conta não encontrada.' }, 404);
    }
    return c.json({
      ok: true,
      data: {
        id: r.id,
        orderId: r.orderId,
        customerId: r.customerId,
        customerName: r.customer?.name ?? null,
        // Observação da DÍVIDA/conta (separada do cadastro — ADR-022). É a que a UI edita nas duas
        // visões; `notes` (nota da venda, legado da 0015) segue no payload por compatibilidade.
        debtNotes: r.customer?.debtNotes ?? null,
        originalAmount: r.originalAmount,
        settledAmount: r.settledAmount,
        balance: receivableBalance(Number(r.originalAmount), Number(r.settledAmount), Number(r.returnedAmount)),
        status: r.status,
        dueDate: r.dueDate,
        notes: r.notes,
        createdAt: r.createdAt,
        createdByName: r.createdByName,
        orderTotal: r.order?.total ?? null,
        orderCreatedAt: r.order?.createdAt ?? null,
        items: r.order?.items ?? [],
        orderPayments: r.order?.payments ?? [],
        payments: r.payments,
      },
    });
  } catch (err) {
    console.error('GET /receivables/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar a conta.' }, 500);
  }
});

/** Atualiza a observação livre de uma dívida (ADR-019). Qualquer operador (é anotação de balcão). */
receivables.patch('/:id', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'Conta não encontrada.' }, 404);
  }
  const parsed = updateReceivableSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Dados inválidos.' }, 400);
  }
  const notes = parsed.data.notes?.trim() ? parsed.data.notes.trim() : null;

  try {
    const prisma = createPrismaClient(connectionString);
    // Garante que a conta é da loja antes de atualizar (RLS reforçado no código).
    const found = await prisma.receivable.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!found) {
      return c.json({ ok: false, error: 'Conta não encontrada.' }, 404);
    }
    await prisma.receivable.update({ where: { id }, data: { notes } });
    return c.json({ ok: true, data: { id, notes } });
  } catch (err) {
    console.error('PATCH /receivables/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao salvar a observação.' }, 500);
  }
});

/** Registra um recebimento (total ou parcial) de uma conta a receber (ADR-019). Em transação:
 * grava o `ReceivablePayment`, abate o saldo (`applyReceivablePayment` do core → OPEN/PAID) e, se
 * for em DINHEIRO, lança um `CashMovement SUPPLY` no caixa aberto (reúso da CX.Movimentacao) — por
 * isso o recebimento em dinheiro EXIGE caixa aberto. O `paidAt` (agora) é o dia do recebimento, que
 * o relatório usa para contar o fiado como recebido NAQUELE dia (regime de caixa). */
receivables.post('/:id/receive', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'Conta não encontrada.' }, 404);
  }

  const parsed = receiveReceivableSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Dados do recebimento inválidos.' }, 400);
  }
  const { amount, method, reference } = parsed.data;

  try {
    const prisma = createPrismaClient(connectionString);
    const receivable = await prisma.receivable.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        orderId: true,
        originalAmount: true,
        settledAmount: true,
        returnedAmount: true,
        status: true,
        customer: { select: { name: true } },
      },
    });
    if (!receivable) {
      return c.json({ ok: false, error: 'Conta não encontrada.' }, 404);
    }
    if (receivable.status !== 'OPEN') {
      return c.json({ ok: false, error: 'Esta conta não está em aberto.' }, 409);
    }

    const original = Number(receivable.originalAmount);
    const settled = Number(receivable.settledAmount);
    const returned = Number(receivable.returnedAmount);
    const balance = receivableBalance(original, settled, returned);
    if (!isValidReceipt(amount, balance)) {
      return c.json(
        { ok: false, error: `Valor inválido: o saldo devedor é ${balance.toFixed(2)}.` },
        400,
      );
    }

    // Recebimento em dinheiro precisa de caixa aberto (é onde o dinheiro entra — ADR-018).
    let openSessionId: string | null = null;
    if (method === 'CASH') {
      const session = await prisma.cashSession.findFirst({
        where: { tenantId, closedAt: null },
        select: { id: true },
      });
      if (!session) {
        return c.json(
          { ok: false, error: 'Abra o caixa para receber em dinheiro.' },
          404,
        );
      }
      openSessionId = session.id;
    }

    const next = applyReceivablePayment(original, settled, amount, returned);

    const result = await prisma.$transaction(async (tx) => {
      // Em dinheiro: entra no caixa de HOJE como Suprimento (reúso da CX.Movimentacao). Cartão/PIX
      // não tocam a gaveta — só o registro do recebimento (e o relatório em regime de caixa).
      let cashMovementId: string | null = null;
      if (method === 'CASH' && openSessionId) {
        const movement = await tx.cashMovement.create({
          data: {
            tenantId,
            cashSessionId: openSessionId,
            userId,
            type: manualCashMovementType('SUPPLY'), // INCOME
            kind: 'SUPPLY',
            amount,
            reason: `Recebimento a prazo — ${receivable.customer?.name ?? 'cliente'}`,
            // NÃO setar `relatedOrderId` aqui: esse campo, num lançamento manual (SUPPLY/WITHDRAWAL),
            // é o marcador de ESTORNO (isReversalRow) — usá-lo faria o recebimento aparecer como
            // "Estorno de Sangria" no extrato. O elo com a venda existe pelo outro lado
            // (ReceivablePayment.cashMovementId → receivable → order). É um Suprimento comum.
            syncStatus: 'SYNCED',
            registeredByName: c.get('userName'), // autoria (ADR-010)
          },
        });
        cashMovementId = movement.id;
      }

      const payment = await tx.receivablePayment.create({
        data: {
          tenantId,
          receivableId: receivable.id,
          amount,
          method,
          reference: reference ?? null,
          cashSessionId: openSessionId,
          cashMovementId,
          receivedById: userId, // autoria (ADR-010)
          receivedByName: c.get('userName'),
        },
      });

      const updated = await tx.receivable.update({
        where: { id: receivable.id },
        data: { settledAmount: next.settledAmount, status: next.status },
        select: { id: true, originalAmount: true, settledAmount: true, status: true },
      });

      return { payment, updated };
    });

    return c.json(
      {
        ok: true,
        data: {
          ...result.updated,
          balance: receivableBalance(
            Number(result.updated.originalAmount),
            Number(result.updated.settledAmount),
            returned, // devolvido não muda num recebimento (ADR-022)
          ),
          fullyPaid: next.fullyPaid,
          paymentId: result.payment.id,
        },
      },
      201,
    );
  } catch (err) {
    console.error('POST /receivables/:id/receive falhou:', err);
    return c.json({ ok: false, error: 'Falha ao registrar o recebimento.' }, 500);
  }
});

export default receivables;
