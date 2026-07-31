import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import {
  availableQty,
  calcSaleItemTotal,
  calcSaleTotals,
  closedStockMeters,
  creditSaleBalances,
  hasAltUnit,
  isClosedPrimary,
  isValidMeterStep,
  toBaseQuantity,
} from '@nexoloja/core';
import { cancelOrderSchema, createSaleSchema, returnOrderSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireActiveTenant, requireAuth } from '../middleware/auth';

const orders = new Hono<Env>();
orders.use('*', requireAuth);

/** Tamanho de página do Histórico: default 20, teto 50 (evita respostas gigantes). */
const ORDERS_PAGE_DEFAULT = 20;
const ORDERS_PAGE_MAX = 50;

/**
 * Converte o intervalo AAAA-MM-DD (opcional) em filtro Prisma de data, nas bordas do
 * fuso da loja (Brasil, UTC-3): `from` às 00:00 e `to` às 23:59:59.999 do dia. Mesmo
 * critério do relatório de vendas (coerência entre as duas telas).
 */
function buildDateFilter(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  const filter: { gte?: Date; lte?: Date } = {};
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) filter.gte = new Date(`${from}T00:00:00.000-03:00`);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) filter.lte = new Date(`${to}T23:59:59.999-03:00`);
  return filter.gte || filter.lte ? filter : undefined;
}

/**
 * Ordenação do Histórico (`scope=all`). O keyset pagina sobre o campo escolhido, então
 * cada modo é um par (campo do banco, direção); o `id` é sempre o desempate na MESMA
 * direção, garantindo ordem total estável para o cursor.
 *  - `recent` (default): mais recentes primeiro (data ↓) — contrato antigo preservado.
 *  - `oldest`: mais antigas primeiro (data ↑).
 *  - `highest` / `lowest`: maior / menor venda (por `total`).
 */
type SortField = 'createdAt' | 'total';
type SortDir = 'asc' | 'desc';
function sortConfig(sort?: string): { field: SortField; dir: SortDir } {
  switch (sort) {
    case 'oldest':
      return { field: 'createdAt', dir: 'asc' };
    case 'highest':
      return { field: 'total', dir: 'desc' };
    case 'lowest':
      return { field: 'total', dir: 'asc' };
    case 'recent':
    default:
      return { field: 'createdAt', dir: 'desc' };
  }
}

/**
 * Cursor de paginação keyset (não OFFSET, que degrada conforme a base cresce): a
 * posição é o par `<valor do campo ordenado>|<id>` da última linha entregue. Opaco para
 * o cliente, que só o devolve na próxima página (e sempre com o mesmo `sort`). O valor é
 * a data ISO (ordenação por `createdAt`) ou o total como string (ordenação por `total`).
 */
function encodeCursor(o: { createdAt: Date; total: unknown; id: string }, field: SortField): string {
  const value = field === 'createdAt' ? o.createdAt.toISOString() : String(o.total);
  return `${value}|${o.id}`;
}
function decodeCursor(cursor: string): { value: string; id: string } | null {
  const sep = cursor.indexOf('|');
  if (sep <= 0) return null;
  const value = cursor.slice(0, sep);
  const id = cursor.slice(sep + 1);
  if (!value || !id) return null;
  return { value, id };
}

/**
 * Cláusula keyset genérica: só as linhas ESTRITAMENTE após o cursor na ordem
 * (`field dir`, `id dir`). Em `desc` avança com `<`; em `asc`, com `>`. Retorna `{}`
 * (sem restrição = 1ª página) se o cursor for inválido para o campo — evita duplicar
 * linhas partindo de uma posição corrompida.
 */
function keysetWhere(
  field: SortField,
  dir: SortDir,
  cursor: { value: string; id: string },
): object {
  const cmp = dir === 'desc' ? 'lt' : 'gt';
  let fieldValue: Date | string;
  if (field === 'createdAt') {
    const d = new Date(cursor.value);
    if (Number.isNaN(d.getTime())) return {};
    fieldValue = d;
  } else {
    fieldValue = cursor.value;
  }
  return {
    OR: [
      { [field]: { [cmp]: fieldValue } },
      { [field]: fieldValue, id: { [cmp]: cursor.id } },
    ],
  };
}

/**
 * Lista as vendas com itens, pagamentos e status (mais recentes primeiro).
 *  - `?scope=all`: Histórico de Vendas — **paginado por cursor** (keyset). Aceita
 *    `limit`, `cursor` (opaco), `from`/`to` (AAAA-MM-DD, fuso da loja) e `sort`
 *    (`recent` default / `oldest` / `highest` / `lowest`) e responde
 *    `{ rows, nextCursor }` (`nextCursor: null` na última página). O keyset ordena pelo
 *    campo do `sort` (data ou total). Inclui o estado do caixa de cada venda para
 *    decidir entre cancelar e devolver. Sem exigir caixa aberto.
 *  - padrão: vendas do caixa atualmente aberto do operador (base do cancelamento,
 *    restrito ao caixa aberto). Sem caixa aberto, retorna lista vazia (array cru,
 *    contrato antigo preservado).
 */
orders.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const scope = c.req.query('scope');

  try {
    const prisma = createPrismaClient(connectionString);

    if (scope === 'all') {
      // Página: `limit` saneado (1..MAX) e cursor keyset opcional.
      const limitRaw = Number(c.req.query('limit'));
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.min(Math.floor(limitRaw), ORDERS_PAGE_MAX)
          : ORDERS_PAGE_DEFAULT;

      const dateFilter = buildDateFilter(c.req.query('from'), c.req.query('to'));
      const { field, dir } = sortConfig(c.req.query('sort'));
      const cursorParam = c.req.query('cursor');
      const cursor = cursorParam ? decodeCursor(cursorParam) : null;

      // Keyset: só as linhas após o cursor na ordem escolhida (`field dir`, `id dir`). O
      // filtro de período (createdAt gte/lte) e o cursor coexistem por AND.
      const keyset = cursor ? keysetWhere(field, dir, cursor) : {};

      // `take: limit + 1`: a linha extra só serve para saber se há próxima página.
      const list = await prisma.order.findMany({
        where: { tenantId, ...(dateFilter ? { createdAt: dateFilter } : {}), ...keyset },
        orderBy: [{ [field]: dir }, { id: dir }],
        take: limit + 1,
        include: {
          items: true,
          payments: true,
          cashSession: { select: { id: true, closedAt: true } },
          // Venda a prazo (ADR-019): expõe a conta a receber p/ o Histórico marcar o badge "A prazo".
          receivable: { select: { originalAmount: true, settledAmount: true, status: true } },
        },
      });

      const hasMore = list.length > limit;
      const rows = hasMore ? list.slice(0, limit) : list;
      const last = rows[rows.length - 1];
      const nextCursor = hasMore && last ? encodeCursor(last, field) : null;
      return c.json({ ok: true, data: { rows, nextCursor } });
    }

    // ADR-018: caixa por loja — lista as vendas do caixa aberto da loja (sem filtro por `userId`).
    const session = await prisma.cashSession.findFirst({
      where: { tenantId, closedAt: null },
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
  // Retirada/entrega futura (ADR-020): reserva agora, baixa parcial na retirada. Online-only
  // nesta fatia (como o fiado) — a venda offline sempre baixa no ato.
  const isScheduled = sale.deliveryMode === 'SCHEDULED';
  if (isScheduled && isOffline) {
    return c.json(
      { ok: false, error: 'Venda com retirada/entrega futura não está disponível offline.' },
      400,
    );
  }

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
    // pertence àquela sessão); no online, o caixa aberto da loja. ADR-018: caixa por loja, validado só
    // por `tenantId` (RLS) — qualquer operador vende no mesmo caixa.
    const session = isOffline
      ? await prisma.cashSession.findFirst({
          where: { id: sale.cashSessionId, tenantId },
          select: { id: true, closedAt: true },
        })
      : await prisma.cashSession.findFirst({
          where: { tenantId, closedAt: null },
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

    // EF-3 (ADR-013): resolve cada linha para a UNIDADE-BASE. No modo embalagem (ALT), a baixa de
    // estoque é `quantity × conversionFactor` (ex.: 2 rolos = 200 m); a trava e o `StockMovement`
    // usam essa quantidade-base. `unit` do item vira a unidade vendida (embalagem) para o comprovante.
    const lines: {
      item: (typeof sale.items)[number];
      product: (typeof products)[number];
      baseQty: number;
      soldUnit: (typeof products)[number]['unit'];
    }[] = [];
    for (const item of sale.items) {
      const p = byId.get(item.productId);
      if (!p) {
        return c.json({ ok: false, error: 'Produto inexistente na venda.' }, 400);
      }
      const altCfg = {
        unit: p.unit,
        salePrice: Number(p.salePrice),
        altUnit: p.altUnit,
        altSalePrice: p.altSalePrice != null ? Number(p.altSalePrice) : null,
        conversionFactor: p.conversionFactor != null ? Number(p.conversionFactor) : null,
      };
      let baseQty: number;
      let soldUnit: (typeof products)[number]['unit'];
      if (isClosedPrimary(altCfg)) {
        // ADR-017: unidade fechada como principal. `saleMode` BASE = barra/rolo INTEIRO (baixa
        // `qtd × tamanho` metros); ALT = por metro (baixa `qtd` metros). O ledger é em metros e a
        // unidade vendida no comprovante INVERTE (barra ⇒ `unit`; metro ⇒ `altUnit`).
        const mode = item.saleMode === 'ALT' ? 'METER' : 'WHOLE';
        if (mode === 'METER' && !isOffline && !isValidMeterStep(item.quantity)) {
          return c.json(
            { ok: false, error: `A venda por metro de "${p.name}" deve ser em múltiplos de 0,5 m.` },
            400,
          );
        }
        baseQty = closedStockMeters(altCfg, mode, item.quantity);
        soldUnit = mode === 'WHOLE' ? p.unit : (p.altUnit ?? p.unit);
      } else {
        // EF-3 (ADR-013) / produto comum: BASE = unidade fina; ALT = embalagem (× conversionFactor).
        const isAlt = item.saleMode === 'ALT' && hasAltUnit(altCfg);
        baseQty = toBaseQuantity(altCfg, item.saleMode, item.quantity);
        soldUnit = isAlt ? (p.altUnit ?? p.unit) : p.unit;
      }
      // Estoque insuficiente (em unidade-base): bloqueia no online; no offline registra e deixa
      // negativo p/ reconciliação (§6). A venda offline de EF-3 também traz `saleMode` no envelope.
      // ADR-020: a trava é pelo DISPONÍVEL = estoque − reservado (mercadoria já comprometida com
      // retiradas futuras não pode ser vendida de novo) — vale para venda no ato E agendada.
      const available = availableQty(Number(p.stockQty), Number(p.reservedQty));
      if (!isOffline && available < baseQty) {
        return c.json(
          {
            ok: false,
            error: `Estoque insuficiente para "${p.name}" (disponível: ${available}).`,
          },
          400,
        );
      }
      lines.push({ item, product: p, baseQty, soldUnit });
    }

    const { subtotal, total } = calcSaleTotals(sale.items, {
      discountAmount: sale.discountAmount,
      freightAmount: sale.freightAmount,
    });
    const paid = Number(sale.payments.reduce((acc, pmt) => acc + pmt.amount, 0).toFixed(2));
    // Venda a prazo (fiado — ADR-019): parte (ou tudo) fica a receber. `creditAmount` > 0 exige
    // cliente, é online-only nesta fatia, e a entrada paga agora + o valor a prazo devem fechar o
    // total exatamente (sem troco no fiado). Sem `creditAmount`, é a venda à vista de sempre.
    const credit = Number((sale.creditAmount ?? 0).toFixed(2));
    if (credit > 0) {
      if (isOffline) {
        return c.json(
          { ok: false, error: 'Venda a prazo (fiado) não está disponível offline.' },
          400,
        );
      }
      if (!sale.customerId) {
        return c.json(
          { ok: false, error: 'Selecione o cliente para uma venda a prazo.' },
          400,
        );
      }
      if (!creditSaleBalances(total, paid, credit)) {
        return c.json(
          {
            ok: false,
            error: `Valores não fecham: total ${total.toFixed(2)}, pago agora ${paid.toFixed(2)} + a prazo ${credit.toFixed(2)}.`,
          },
          400,
        );
      }
    } else if (paid + 1e-9 < total) {
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
          // Retirada/entrega futura (ADR-020). Em IMMEDIATE (padrão) estes campos ficam inertes.
          // Em SCHEDULED nasce "A retirar" (nada saiu ainda); a previsão é única (do pedido) ou
          // por item conforme a flag `perItemSchedule`.
          deliveryMode: sale.deliveryMode,
          ...(isScheduled
            ? {
                fulfillmentStatus: 'PENDING' as const,
                perItemSchedule: sale.perItemSchedule ?? false,
                scheduledPickupAt:
                  !sale.perItemSchedule && sale.scheduledPickupAt
                    ? new Date(sale.scheduledPickupAt)
                    : null,
              }
            : {}),
          items: {
            create: lines.map(({ item, product, baseQty, soldUnit }) => ({
              productId: item.productId,
              productName: product.name, // snapshot
              unit: soldUnit, // snapshot da unidade VENDIDA (base ou embalagem — EF-3)
              quantity: item.quantity, // na unidade vendida (ex.: 2 rolos)
              baseQuantity: baseQty, // em unidade-base p/ o estorno (ex.: 200 m) — ADR-013
              unitPrice: item.unitPrice,
              discount: item.discount ?? 0,
              total: calcSaleItemTotal(item),
              // Par (ADR-015): agrupa os dois itens vendidos juntos, p/ o comprovante imprimir
              // UMA linha. Não afeta estoque nem estorno — cada item continua sendo um item.
              pairGroup: item.pairGroup ?? null,
              // ADR-020: previsão por item (só quando a flag "Data por item" está ligada).
              scheduledPickupAt:
                isScheduled && sale.perItemSchedule && item.scheduledPickupAt
                  ? new Date(item.scheduledPickupAt)
                  : null,
            })),
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

      // Estoque. Dois caminhos (ADR-020):
      //  - SCHEDULED (retirada futura): NÃO baixa; apenas RESERVA (incrementa o cache
      //    `reservedQty`). A baixa real (StockMovement EXPENSE + stockQty) acontece na RETIRADA,
      //    parcial, preservando o ADR-001 — só que disparada no evento de entrega.
      //  - IMMEDIATE (padrão): ADR-001 — cada item gera saída de estoque + decremento atômico do
      //    cache (pode ficar negativo no sync offline, §6). EF-3 (ADR-013): sempre em UNIDADE-BASE.
      for (const { item, baseQty } of lines) {
        if (isScheduled) {
          await tx.product.update({
            where: { id: item.productId },
            data: { reservedQty: { increment: baseQty } },
          });
          continue;
        }
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: item.productId,
            type: 'EXPENSE',
            quantity: baseQty,
            reason: `Venda ${created.id}`,
            syncStatus: 'SYNCED',
            userId, // autoria (ADR-010)
            registeredByName: c.get('userName'),
          },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: { decrement: baseQty } },
        });
      }

      // Venda a prazo (fiado — ADR-019): registra a conta a receber. A mercadoria JÁ saiu acima
      // (o fiado adia o pagamento, não a entrega — o estoque não muda); só o dinheiro fica
      // pendente. `customerId` garantido não-nulo pela validação de `credit > 0`.
      if (credit > 0) {
        await tx.receivable.create({
          data: {
            tenantId,
            orderId: created.id,
            customerId: sale.customerId!,
            originalAmount: credit,
            dueDate: sale.dueDate ? new Date(sale.dueDate) : null,
            createdById: userId, // autoria (ADR-010)
            createdByName: c.get('userName'),
          },
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
          // Fiado não tem troco (a entrada + o valor a prazo fecham o total exatamente).
          change: credit > 0 ? 0 : Number((paid - total).toFixed(2)),
          ...(credit > 0 ? { creditAmount: credit } : {}),
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

    // ADR-018: caixa por loja — cancela vendas do caixa aberto da loja (independe de quem operou).
    const session = await prisma.cashSession.findFirst({
      where: { tenantId, closedAt: null },
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

    const isScheduled = order.deliveryMode === 'SCHEDULED';
    const cancelled = await prisma.$transaction(async (tx) => {
      // Estorno de estoque. EF-3 (ADR-013): em UNIDADE-BASE (`baseQuantity`); `?? quantity` cobre
      // pedidos antigos (pré-EF-3, base == vendida, fator 1). Dois caminhos (ADR-020):
      //  - IMMEDIATE: a mercadoria saiu inteira na venda ⇒ INCOME reverso do total (ADR-001).
      //  - SCHEDULED: só saiu a parte já RETIRADA (`deliveredBaseQty`) ⇒ INCOME reverso dela; o
      //    RESERVADO remanescente (base − retirado) nunca deixou o estoque, então só se LIBERA a
      //    reserva (decrementa o cache `reservedQty`), sem StockMovement.
      for (const item of order.items) {
        const baseQty = Number(item.baseQuantity ?? item.quantity);
        const delivered = Number(item.deliveredBaseQty ?? 0);
        const returnToStock = isScheduled ? delivered : baseQty;
        const releaseReserved = isScheduled ? Math.max(0, baseQty - delivered) : 0;
        if (returnToStock > 0) {
          await tx.stockMovement.create({
            data: {
              tenantId,
              productId: item.productId,
              type: 'INCOME',
              quantity: returnToStock,
              reason: `Cancelamento da venda ${order.id}`,
              syncStatus: 'SYNCED',
              userId, // autoria (ADR-010): quem cancelou/estornou
              registeredByName: c.get('userName'),
            },
          });
        }
        if (returnToStock > 0 || releaseReserved > 0) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              ...(returnToStock > 0 ? { stockQty: { increment: returnToStock } } : {}),
              ...(releaseReserved > 0 ? { reservedQty: { decrement: releaseReserved } } : {}),
            },
          });
        }
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

    // ADR-018: caixa por loja — destino da saída de dinheiro da devolução é o caixa aberto da loja.
    const session = await prisma.cashSession.findFirst({
      where: { tenantId, closedAt: null },
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

    const isScheduled = order.deliveryMode === 'SCHEDULED';
    const returned = await prisma.$transaction(async (tx) => {
      // Estorno de estoque — mesma lógica do cancelamento (ADR-020): IMMEDIATE devolve o total;
      // SCHEDULED devolve só a parte já retirada (`deliveredBaseQty`) via INCOME e LIBERA a reserva
      // remanescente (sem StockMovement). EF-3 (ADR-013): sempre em UNIDADE-BASE (`?? quantity`).
      for (const item of order.items) {
        const baseQty = Number(item.baseQuantity ?? item.quantity);
        const delivered = Number(item.deliveredBaseQty ?? 0);
        const returnToStock = isScheduled ? delivered : baseQty;
        const releaseReserved = isScheduled ? Math.max(0, baseQty - delivered) : 0;
        if (returnToStock > 0) {
          await tx.stockMovement.create({
            data: {
              tenantId,
              productId: item.productId,
              type: 'INCOME',
              quantity: returnToStock,
              reason: `Devolução da venda ${order.id}`,
              syncStatus: 'SYNCED',
              userId, // autoria (ADR-010): quem devolveu/estornou
              registeredByName: c.get('userName'),
            },
          });
        }
        if (returnToStock > 0 || releaseReserved > 0) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              ...(returnToStock > 0 ? { stockQty: { increment: returnToStock } } : {}),
              ...(releaseReserved > 0 ? { reservedQty: { decrement: releaseReserved } } : {}),
            },
          });
        }
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
