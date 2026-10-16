import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import { calcMarginPercent, planOpeningCount } from '@nexoloja/core';
import {
  createProductSchema,
  importNameKey,
  isAdminRole,
  planProductImport,
  PRICE_HISTORY_ACTION,
  type PriceHistoryEntry,
  productImportBatchSchema,
  updateProductSchema,
  type ImportCategory,
  type ImportExistingProduct,
  type ImportLineResult,
} from '@nexoloja/shared';
import { type Env, getConnectionString, getPrisma, getTenantId } from '../lib/request';
import { requireActiveTenant, requireAdmin, requireAuth } from '../middleware/auth';
import { priceHistoryEvent, recordPriceHistory } from '../lib/priceHistory';

/**
 * Escapa os curingas do `LIKE`/`ILIKE` (`%`, `_`, `\`) para que o token seja tratado como
 * texto literal (substring), igual ao `.includes()` do core — sem isso, um `%` digitado
 * viraria "qualquer coisa". Usa `\` como escape (o default do Postgres).
 */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Mensagem do 409 de unicidade: o índice único pode ser o do SKU ou o do código na balança (PLU,
 * ADR-040 §3) — o Prisma diz qual em `meta.target`.
 */
function uniqueConflictMessage(err: Prisma.PrismaClientKnownRequestError): string {
  const target = JSON.stringify(err.meta?.target ?? '');
  return target.includes('scaleCode')
    ? 'Já existe um produto com esse código na balança (PLU).'
    : 'Já existe um produto com esse SKU.';
}

/** Acrescenta a margem calculada (regra pura de packages/core) ao produto. */
function withMargin<T extends { costPrice: unknown; salePrice: unknown }>(p: T) {
  return {
    ...p,
    marginPercent: calcMarginPercent(Number(p.costPrice), Number(p.salePrice)),
  };
}

/**
 * Guardas do par (ADR-015). Devolve a mensagem de erro, ou `null` se está tudo certo.
 *
 * - **Auto-referência:** um produto não pode ser o próprio par.
 * - **Agregado precisa existir no tenant** (e não estar soft-deleted).
 * - **Par invertido:** se a bucha já aponta para o parafuso, cadastrar o inverso criaria
 *   DOIS preços para o mesmo par. O par é gravado de um lado só e lido dos dois.
 */
async function validatePair(
  prisma: ReturnType<typeof createPrismaClient>,
  tenantId: string,
  productId: string | null,
  pairedProductId: string | null | undefined,
): Promise<string | null> {
  if (!pairedProductId) return null;
  if (productId && pairedProductId === productId) {
    return 'Um produto não pode ser agregado a si mesmo.';
  }
  const paired = await prisma.product.findFirst({
    where: { id: pairedProductId, tenantId, deletedAt: null },
    select: { id: true, pairedProductId: true, name: true },
  });
  if (!paired) return 'Produto agregado não encontrado.';
  if (paired.pairedProductId && paired.pairedProductId === productId) {
    return `"${paired.name}" já tem este produto como agregado. O par vale para os dois lados — não precisa cadastrar de novo.`;
  }
  return null;
}

const products = new Hono<Env>();

// Todas as rotas de produtos exigem autenticação (JWT do Supabase).
products.use('*', requireAuth);

/** Página da busca de produtos (tela de gestão): default 30, teto 50. */
const PRODUCTS_PAGE_DEFAULT = 30;
const PRODUCTS_PAGE_MAX = 50;

/**
 * Cursor keyset da busca (`name asc, id asc`): par `nome|id` da última linha. O nome é
 * `encodeURIComponent`-ado (pode conter `|`); o `id` (UUID) nunca contém. Opaco para o cliente.
 */
function encodeCursor(o: { name: string; id: string }): string {
  return `${encodeURIComponent(o.name)}|${o.id}`;
}
function decodeCursor(cursor: string): { name: string; id: string } | null {
  const sep = cursor.indexOf('|');
  if (sep < 0) return null;
  const id = cursor.slice(sep + 1);
  if (!id) return null;
  try {
    return { name: decodeURIComponent(cursor.slice(0, sep)), id };
  } catch {
    return null;
  }
}

/**
 * Lista produtos do tenant (nunca os soft-deletados).
 *
 * Por padrão traz **só os ativos** (`isActive`) — assim PDV, Estoque e qualquer outro
 * consumidor de `/products` deixam de oferecer produtos desativados sem precisar mudar nada.
 * A tela de gestão de Produtos pede `?includeInactive=true` para também listar os inativos
 * (acinzentados, com opção de reativar).
 */
products.get('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  try {
    const prisma = getPrisma(c);
    const includeInactive = c.req.query('includeInactive') === 'true';
    // SEM teto: um PDV jamais pode esconder um produto do catálogo. O `take: 100` anterior
    // truncava silenciosamente em ordem alfabética — passando de 100 produtos, os de nome
    // "tardio" (ex.: "Vass…") sumiam de Produtos/Estoque/Venda mesmo existindo no banco. O
    // escopo já é o catálogo do próprio tenant (RLS), então listar tudo é o correto. Se algum
    // dia um catálogo ficar realmente grande, o caminho é busca no servidor (`?q=`) + paginação,
    // não um corte cego que oculta dados.
    //
    // Usa `$queryRaw` (NÃO `findMany`) DE PROPÓSITO — otimização de CPU do Worker (ADR-005). O
    // catálogo inteiro trafega a cada abertura de PDV/Estoque/Produtos; com `findMany`, o adapter do
    // Prisma constrói um objeto `Decimal.js` por coluna numérica (são ~11) POR PRODUTO. Num catálogo
    // grande isso estourava o teto de **10 ms de CPU** do Worker no plano grátis ("Worker exceeded CPU
    // time limit"), matando ESTA requisição e faminta­ndo as vizinhas na mesma isolate (o PDV caía no
    // falso "caixa recuperado do cache offline"). No SQL cru o Postgres devolve os numéricos já como
    // STRING — exatamente o que o cliente espera (os tipos são `string`) e normaliza via `Number()`,
    // sem construir Decimal. Mesmo padrão já comprovado em produção no `GET /products/search`. Sem
    // `select` para não derrubar nenhum campo que Produtos/Estoque/PDV consomem — o ganho vem de
    // evitar o Decimal, não de cortar colunas.
    const conditions: Prisma.Sql[] = [
      Prisma.sql`p."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`p."deletedAt" IS NULL`,
    ];
    if (!includeInactive) {
      conditions.push(Prisma.sql`p."isActive" = true`);
    }
    const items = await prisma.$queryRaw<
      Array<Record<string, unknown> & { costPrice: unknown; salePrice: unknown }>
    >(Prisma.sql`
      SELECT * FROM "products" p
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY p."name" ASC
    `);
    return c.json({ ok: true, data: items.map(withMargin) });
  } catch (err) {
    console.error('GET /products falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar produtos.' }, 500);
  }
});

/**
 * Busca paginada de produtos para a **tela de gestão** (não é o catálogo do PDV — este segue
 * em `GET /` como array cru, intocado, porque PDV/Estoque/offline dependem dele inteiro).
 *
 * Aceita `q` (nome/nome popular/fabricante/SKU, case-insensitive), `limit`, `cursor` (keyset
 * opaco) e `includeInactive`. Responde `{ rows, nextCursor }` (`nextCursor: null` na última
 * página) com a margem calculada. Ordena por `name asc, id asc`. Assim a tela abre leve e
 * procura no servidor em vez de baixar a base inteira e rolar.
 *
 * ⚠️ Registrada ANTES de `/:id` para o Hono não casar "search" como um id.
 */
products.get('/search', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  try {
    const prisma = getPrisma(c);
    const includeInactive = c.req.query('includeInactive') === 'true';

    const limitRaw = Number(c.req.query('limit'));
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), PRODUCTS_PAGE_MAX)
        : PRODUCTS_PAGE_DEFAULT;

    const q = c.req.query('q')?.trim();
    const cursorParam = c.req.query('cursor');
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;

    // Busca tokenizada (AND, ordem-livre) e ACENTO-insensível, espelhando `productMatchesQuery`
    // do core: a query é quebrada em palavras e CADA palavra precisa aparecer em algum dos campos
    // (nome/nome popular/fabricante/SKU/EAN). `extensions.unaccent()` dobra o acento dos DOIS lados
    // (dado e busca) — só ele exige SQL cru, pois o Prisma não expressa unaccent. `ILIKE` cobre a
    // caixa. Montado com `Prisma.sql` (parametrizado ⇒ à prova de injeção); keyset e ordenação
    // (name asc, id asc) preservados. `unaccent` mora no schema `extensions` no Supabase.
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const conditions: Prisma.Sql[] = [
      Prisma.sql`p."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`p."deletedAt" IS NULL`,
    ];
    if (!includeInactive) {
      conditions.push(Prisma.sql`p."isActive" = true`);
    }
    for (const token of tokens) {
      const pat = `%${likeEscape(token)}%`;
      conditions.push(Prisma.sql`(
        extensions.unaccent(p."name") ILIKE extensions.unaccent(${pat})
        OR extensions.unaccent(coalesce(p."popularName", '')) ILIKE extensions.unaccent(${pat})
        OR extensions.unaccent(coalesce(p."manufacturer", '')) ILIKE extensions.unaccent(${pat})
        OR extensions.unaccent(p."sku") ILIKE extensions.unaccent(${pat})
        OR extensions.unaccent(coalesce(p."ean", '')) ILIKE extensions.unaccent(${pat})
      )`);
    }
    if (cursor) {
      conditions.push(
        Prisma.sql`(p."name" > ${cursor.name} OR (p."name" = ${cursor.name} AND p."id" > ${cursor.id}::uuid))`,
      );
    }

    const list = await prisma.$queryRaw<
      Array<Record<string, unknown> & { id: string; name: string; costPrice: unknown; salePrice: unknown }>
    >(Prisma.sql`
      SELECT * FROM "products" p
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY p."name" ASC, p."id" ASC
      LIMIT ${limit + 1}
    `);

    const hasMore = list.length > limit;
    const rows = hasMore ? list.slice(0, limit) : list;
    const last = rows[rows.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last) : null;
    return c.json({ ok: true, data: { rows: rows.map(withMargin), nextCursor } });
  } catch (err) {
    console.error('GET /products/search falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar produtos.' }, 500);
  }
});

/** Detalhe de um produto. */
products.get('/:id', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  try {
    const prisma = getPrisma(c);
    const item = await prisma.product.findFirst({
      where: { id: c.req.param('id'), tenantId, deletedAt: null },
    });
    if (!item) {
      return c.json({ ok: false, error: 'Produto não encontrado.' }, 404);
    }
    return c.json({ ok: true, data: withMargin(item) });
  } catch (err) {
    console.error('GET /products/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar o produto.' }, 500);
  }
});

/** Cria um produto. */
products.post('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const prisma = getPrisma(c);
    // Autoria (ADR-010): na criação, criado = alterado (mesmo operador/nome-snapshot).
    const userId = c.get('userId');
    const userName = c.get('userName');
    // `initialStock` NÃO é coluna do produto — é convenição de cadastro (ver abaixo). Separa.
    const { initialStock, ...productData } = parsed.data;
    // Par (ADR-015): valida antes de criar (produto novo ainda não tem id p/ auto-referência).
    const pairError = await validatePair(prisma, tenantId, null, productData.pairedProductId);
    if (pairError) return c.json({ ok: false, error: pairError }, 400);
    const authorship = {
      createdById: userId,
      createdByName: userName,
      updatedById: userId,
      updatedByName: userName,
    };

    // Histórico de custo/preço (2026-10-16): o cadastro é a 1ª linha (custo e preço iniciais).
    const createHistory = {
      tenantId,
      userId,
      userName,
      source: 'PRODUCT_CREATE' as const,
      before: null,
      after: { costPrice: productData.costPrice, salePrice: productData.salePrice },
    };

    let created;
    // ADR-040 §2: produto SEM controle de estoque nasce sem saldo — `initialStock` é ignorado.
    if (productData.trackStock !== false && initialStock && initialStock > 0) {
      // Estoque inicial (ADR-001): cria o produto E gera a Entrada (StockMovement INCOME) na
      // MESMA transação — o saldo nunca é escrito "solto" no cache. `stockQty` e a soma dos
      // movimentos ficam consistentes (reconciliação bate). A entrada carrega a autoria (ADR-010).
      created = await prisma.$transaction(async (tx) => {
        const p = await tx.product.create({
          data: { ...productData, tenantId, stockQty: initialStock, ...authorship },
        });
        await recordPriceHistory(tx, { ...createHistory, productId: p.id });
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: p.id,
            type: 'INCOME',
            quantity: initialStock,
            unitCost: productData.costPrice, // custo do cadastro como custo da entrada inicial
            reason: 'Estoque inicial (cadastro)',
            syncStatus: 'SYNCED',
            userId,
            registeredByName: userName,
          },
        });
        return p;
      });
    } else {
      created = await prisma.$transaction(async (tx) => {
        const p = await tx.product.create({ data: { ...productData, tenantId, ...authorship } });
        await recordPriceHistory(tx, { ...createHistory, productId: p.id });
        return p;
      });
    }
    return c.json({ ok: true, data: withMargin(created) }, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return c.json({ ok: false, error: uniqueConflictMessage(err) }, 409);
      }
      if (err.code === 'P2003') {
        return c.json({ ok: false, error: 'Tenant ou categoria inexistente.' }, 400);
      }
    }
    console.error('POST /products falhou:', err);
    return c.json({ ok: false, error: 'Falha ao criar o produto.' }, 500);
  }
});

/** Motivo da Entrada/ajuste gerado pelo "Estoque atual" da planilha (ADR-041 §4). */
const IMPORT_STOCK_REASON = 'Carga inicial (planilha)';

/**
 * Importação de catálogo por planilha (ADR-041 §1–§6, Fatia 3) — recebe UM LOTE (≤100 linhas já
 * interpretadas no navegador) e o grava numa transação. **Só admin.**
 *
 * A API não confia na pré-visualização: relê o cadastro DENTRO da transação e roda o MESMO
 * `planProductImport` (shared) — casamento por código de barras → código interno → nome, célula vazia
 * não apaga. Por isso é idempotente: reenviar o lote (retry de rede) dá "sem mudança" no que já entrou.
 *
 * - Produto novo: criado com o "Estoque atual" como Entrada "Carga inicial (planilha)" (ADR-001).
 * - Produto existente: atualiza só o que mudou; o estoque vira contagem de abertura pela DIFERENÇA
 *   (`planOpeningCount`, relida com `FOR UPDATE` para uma venda simultânea não ser apagada). Custo
 *   mudou sem preço na planilha ⇒ acende o aviso de revisão de preço (mesma regra da NF-e).
 * - Categoria "A > B" criada se não existir.
 * - Um único `AuditEvent` `IMPORT_PRODUCTS` por importação (`importId`), somado lote a lote (regra 6).
 *
 * Gating de módulo é só de tela (ADR-039 §3): aqui tudo é aceito. Lote com conflito de código
 * concorrente (P2002) volta 409 e não grava nada.
 */
products.post('/import', requireAdmin, requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const parsed = productImportBatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Linhas da planilha inválidas.', issues: parsed.error.flatten() }, 400);
  }
  const batch = parsed.data;
  const userId = c.get('userId');
  const userName = c.get('userName');

  try {
    const prisma = getPrisma(c);
    const data = await prisma.$transaction(async (tx) => {
      // Cadastro atual em SQL cru (numéricos como float, sem Decimal — ADR-005), INCLUINDO os
      // excluídos: o SKU deles segue ocupando o índice único.
      const all = await tx.$queryRaw<Array<ImportExistingProduct & { deleted: boolean }>>(Prisma.sql`
        SELECT p."id", p."sku", p."ean", p."name", p."unit"::text AS "unit", p."popularName",
               p."manufacturer", p."description", p."categoryId",
               p."salePrice"::float8 AS "salePrice", p."costPrice"::float8 AS "costPrice",
               p."stockQty"::float8 AS "stockQty", p."minStockQty"::float8 AS "minStockQty",
               p."trackStock", p."scaleCode", p."ncm", (p."deletedAt" IS NOT NULL) AS "deleted"
        FROM "products" p
        WHERE p."tenantId" = ${tenantId}::uuid
      `);
      const categories: ImportCategory[] = await tx.category.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true, parentId: true },
      });
      const plan = planProductImport(
        batch.rows,
        all.filter((p) => !p.deleted),
        { categories, planStock: planOpeningCount, takenSkus: new Set(all.map((p) => p.sku)) },
      );

      // Categoria pelo caminho: reusa (sem acento/caixa) ou cria o que faltar, nível a nível.
      const catCache = [...categories];
      const ensureCategory = async (path: string[]): Promise<string> => {
        let parentId: string | null = null;
        for (const part of path) {
          const key = importNameKey(part);
          let found = catCache.find((x) => x.parentId === parentId && importNameKey(x.name) === key);
          if (!found) {
            found = await tx.category.create({
              data: { tenantId, name: part, parentId },
              select: { id: true, name: true, parentId: true },
            });
            catCache.push(found);
          }
          parentId = found.id;
        }
        return parentId!;
      };

      const authorship = { updatedById: userId, updatedByName: userName };
      const movements: Prisma.StockMovementCreateManyInput[] = [];

      // --- Produtos novos ---
      const creates: Prisma.ProductCreateManyInput[] = [];
      for (const item of plan) {
        if (item.kind !== 'create') continue;
        const r = item.row;
        const id = crypto.randomUUID();
        creates.push({
          id,
          tenantId,
          sku: item.sku,
          ean: r.ean ?? null,
          name: r.name!,
          popularName: r.popularName ?? null,
          manufacturer: r.manufacturer ?? null,
          description: r.description ?? null,
          categoryId: r.category ? await ensureCategory(r.category) : null,
          unit: item.unit,
          costPrice: r.costPrice ?? 0,
          salePrice: r.salePrice!,
          minStockQty: r.minStockQty ?? 0,
          trackStock: item.trackStock,
          scaleCode: r.scaleCode ?? null,
          ncm: r.ncm ?? null,
          stockQty: item.initialStock,
          createdById: userId,
          createdByName: userName,
          ...authorship,
        });
        if (item.initialStock > 0) {
          movements.push({
            tenantId,
            productId: id,
            type: 'INCOME',
            quantity: item.initialStock,
            unitCost: r.costPrice ?? 0,
            reason: IMPORT_STOCK_REASON,
            syncStatus: 'SYNCED',
            userId,
            registeredByName: userName,
          });
        }
      }
      if (creates.length) await tx.product.createMany({ data: creates });
      // Histórico de custo/preço (2026-10-16): uma linha por produto novo (valores iniciais) e por
      // produto existente cujo custo/preço a planilha mudou — gravadas juntas no fim do lote.
      const historyBase = {
        tenantId,
        userId,
        userName,
        source: 'SPREADSHEET' as const,
        detail: batch.fileName ?? null,
      };
      const priceEvents: Prisma.AuditEventCreateManyInput[] = [];
      for (const cr of creates) {
        const ev = priceHistoryEvent({
          ...historyBase,
          productId: cr.id!,
          before: null,
          after: { costPrice: Number(cr.costPrice ?? 0), salePrice: Number(cr.salePrice) },
        });
        if (ev) priceEvents.push(ev);
      }

      // --- Produtos existentes ---
      // Saldo relido com trava de linha só para quem terá ajuste: uma venda entre a leitura acima e a
      // gravação não pode ser "desfeita" pela contagem.
      const adjustIds = plan.flatMap((i) => (i.kind === 'update' && i.stock.kind === 'adjust' ? [i.product.id] : []));
      const fresh = new Map<string, number>();
      if (adjustIds.length) {
        const locked = await tx.$queryRaw<Array<{ id: string; stockQty: number }>>(Prisma.sql`
          SELECT "id", "stockQty"::float8 AS "stockQty" FROM "products"
          WHERE "id" IN (${Prisma.join(adjustIds.map((id) => Prisma.sql`${id}::uuid`))})
          FOR UPDATE
        `);
        for (const l of locked) fresh.set(l.id, l.stockQty);
      }
      // UM único UPDATE para todas as linhas "Atualiza" do lote (`UPDATE … FROM (VALUES …)`). Medido em
      // produção (2026-10-14): o lote é limitado pela IDA E VOLTA ao banco (~0,2–0,3 s por comando), não
      // por CPU — um `update` por produto faria 100 atualizações estourarem os 20 s da transação. A
      // importação nunca APAGA dado (célula vazia = manter), então NULL na lista = "não mexe" (`COALESCE`).
      // `review`: 0 mantém o aviso de revisão de preço, 1 limpa (a planilha trouxe preço), 2 acende (só o
      // custo mudou — mesma precedência da NF-e). `delta` = diferença do estoque (contagem de abertura).
      let stockAdjustments = 0;
      const updateRows: Prisma.Sql[] = [];
      for (const item of plan) {
        if (item.kind !== 'update') continue;
        const { patch, row } = item;
        let delta = 0;
        if (item.stock.kind === 'adjust' && item.stock.countedQty != null) {
          const current = fresh.get(item.product.id) ?? item.product.stockQty;
          const s = planOpeningCount({ stockQty: current, trackStock: item.product.trackStock }, item.stock.countedQty);
          if (s.kind === 'adjust') {
            delta = s.type === 'INCOME' ? s.quantity : -s.quantity;
            movements.push({
              tenantId,
              productId: item.product.id,
              type: s.type,
              quantity: s.quantity,
              reason: IMPORT_STOCK_REASON,
              syncStatus: 'SYNCED',
              userId,
              registeredByName: userName,
            });
            stockAdjustments++;
          }
        }
        const categoryId = patch.category ? await ensureCategory(patch.category) : null;
        const review = row.salePrice != null ? 1 : patch.costPrice !== undefined ? 2 : 0;
        const ev = priceHistoryEvent({
          ...historyBase,
          productId: item.product.id,
          before: { costPrice: item.product.costPrice, salePrice: item.product.salePrice },
          after: { costPrice: patch.costPrice, salePrice: patch.salePrice },
        });
        if (ev) priceEvents.push(ev);
        updateRows.push(Prisma.sql`(
          ${item.product.id}::uuid, ${patch.name ?? null}::text, ${patch.sku ?? null}::text, ${patch.ean ?? null}::text,
          ${patch.popularName ?? null}::text, ${patch.manufacturer ?? null}::text, ${patch.description ?? null}::text,
          ${patch.salePrice ?? null}::numeric, ${patch.costPrice ?? null}::numeric, ${patch.minStockQty ?? null}::numeric,
          ${patch.scaleCode ?? null}::text, ${patch.ncm ?? null}::text, ${categoryId}::uuid,
          ${delta}::numeric, ${review}::int
        )`);
      }
      if (updateRows.length) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "products" AS p SET
            "name" = COALESCE(v.name, p."name"),
            "sku" = COALESCE(v.sku, p."sku"),
            "ean" = COALESCE(v.ean, p."ean"),
            "popularName" = COALESCE(v.popular, p."popularName"),
            "manufacturer" = COALESCE(v.manufacturer, p."manufacturer"),
            "description" = COALESCE(v.description, p."description"),
            "salePrice" = COALESCE(v.sale, p."salePrice"),
            "costPrice" = COALESCE(v.cost, p."costPrice"),
            "minStockQty" = COALESCE(v.min, p."minStockQty"),
            "scaleCode" = COALESCE(v.scale, p."scaleCode"),
            "ncm" = COALESCE(v.ncm, p."ncm"),
            "categoryId" = COALESCE(v.cat, p."categoryId"),
            "stockQty" = p."stockQty" + v.delta,
            "priceReviewPendingAt" = CASE v.review WHEN 1 THEN NULL WHEN 2 THEN now() ELSE p."priceReviewPendingAt" END,
            "updatedById" = ${userId ?? null}::uuid,
            "updatedByName" = ${userName ?? null}::text,
            "updatedAt" = now()
          FROM (VALUES ${Prisma.join(updateRows)}) AS v(
            id, name, sku, ean, popular, manufacturer, description, sale, cost, min, scale, ncm, cat, delta, review
          )
          WHERE p."id" = v.id AND p."tenantId" = ${tenantId}::uuid
        `);
      }
      if (movements.length) await tx.stockMovement.createMany({ data: movements });
      if (priceEvents.length) await tx.auditEvent.createMany({ data: priceEvents });

      // --- Auditoria: um evento por importação, somado lote a lote ---
      const results: ImportLineResult[] = plan.map((i) =>
        i.kind === 'error'
          ? { line: i.line, status: 'error', message: i.message }
          : { line: i.line, status: i.kind === 'create' ? 'created' : i.kind === 'update' ? 'updated' : 'unchanged' },
      );
      const counts = {
        created: creates.length,
        updated: results.filter((r) => r.status === 'updated').length,
        unchanged: results.filter((r) => r.status === 'unchanged').length,
        errors: results.filter((r) => r.status === 'error').length,
        stockMovements: movements.length,
        stockAdjustments,
      };
      const prev = await tx.auditEvent.findFirst({
        where: { id: batch.importId, tenantId, action: 'IMPORT_PRODUCTS' },
        select: { meta: true },
      });
      if (prev) {
        const m = (prev.meta ?? {}) as Record<string, number>;
        await tx.auditEvent.update({
          where: { id: batch.importId },
          data: {
            meta: {
              ...m,
              batches: (m.batches ?? 0) + 1,
              ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, (m[k] ?? 0) + v])),
            },
          },
        });
      } else {
        await tx.auditEvent.create({
          data: {
            id: batch.importId,
            tenantId,
            userId,
            entity: 'ProductImport',
            entityId: batch.importId,
            action: 'IMPORT_PRODUCTS',
            meta: { fileName: batch.fileName ?? null, batches: 1, ...counts },
          },
        });
      }
      return { results, counts };
    });
    return c.json({ ok: true, data });
  } catch (err) {
    // Conflito de unicidade: P2002 (createMany) ou P2010 com 23505 do Postgres (o UPDATE em SQL cru).
    const uniqueClash =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === 'P2002' || (err.code === 'P2010' && JSON.stringify(err.meta ?? {}).includes('23505')));
    if (uniqueClash) {
      console.warn('POST /products/import conflito de código:', (err as Prisma.PrismaClientKnownRequestError).meta);
      return c.json(
        {
          ok: false,
          error: 'Outro cadastro usou um destes códigos (SKU ou balança) agora há pouco. Reabra a planilha e importe de novo.',
        },
        409,
      );
    }
    console.error('POST /products/import falhou:', err);
    return c.json({ ok: false, error: 'Falha ao importar este lote da planilha.' }, 500);
  }
});

/**
 * Histórico de custo e preço de um produto (2026-10-16): as linhas "de → para" gravadas a cada
 * alteração (ver lib/priceHistory.ts), da mais recente para a mais antiga, teto de 200. Só leitura;
 * lê o `AuditEvent` pelo índice (tenantId, entity, entityId).
 */
products.get('/:id/price-history', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ ok: false, error: 'Produto inválido.' }, 400);
  try {
    const prisma = getPrisma(c);
    const rows = await prisma.auditEvent.findMany({
      where: { tenantId, entity: 'Product', entityId: id, action: PRICE_HISTORY_ACTION },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, createdAt: true, meta: true },
    });
    const num = (v: unknown) => (v == null ? null : Number(v));
    const data: PriceHistoryEntry[] = rows.map((r) => {
      const m = (r.meta ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        byName: (m.byName as string | null) ?? null,
        source: String(m.source ?? ''),
        costBefore: num(m.costBefore),
        costAfter: num(m.costAfter),
        priceBefore: num(m.priceBefore),
        priceAfter: num(m.priceAfter),
        detail: (m.detail as string | null) ?? null,
      };
    });
    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /products/:id/price-history falhou:', err);
    return c.json({ ok: false, error: 'Falha ao carregar o histórico de custo e preço.' }, 500);
  }
});

/** Atualiza um produto (parcial). */
products.patch('/:id', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateProductSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const prisma = getPrisma(c);
    const id = c.req.param('id');
    // Par (ADR-015): mesmas guardas da criação, agora com o id para pegar auto-referência.
    if (parsed.data.pairedProductId !== undefined) {
      const pairError = await validatePair(prisma, tenantId, id, parsed.data.pairedProductId);
      if (pairError) return c.json({ ok: false, error: pairError }, 400);
    }
    // Item 5 da esteira: `dismissPriceReview` NÃO é coluna — é um sinal. Traduz em limpar
    // `priceReviewPendingAt` e não vaza para o Prisma (senão o update quebraria por campo
    // desconhecido). Separado do resto do payload por desestruturação.
    const { dismissPriceReview, markReviewed, ...patchData } = parsed.data;
    // Cadastro no caixa (ADR-041 §B): `markReviewed` também é sinal (vira `pendingReview: false`) e
    // é a conferência do ADMIN — o operador cadastra no caixa, mas não se auto-confere.
    if (markReviewed && !isAdminRole(c.get('role'))) {
      return c.json({ ok: false, error: 'Só o administrador marca o produto como conferido.' }, 403);
    }
    // ADR-040 §2: desligar o controle com mercadoria RESERVADA (retirada futura pendente) deixaria a
    // reserva órfã — a retirada não baixaria nem liberaria. Recusa até as retiradas acabarem.
    if (patchData.trackStock === false) {
      const cur = await prisma.product.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { reservedQty: true },
      });
      if (cur && Number(cur.reservedQty) > 0) {
        return c.json(
          {
            ok: false,
            error:
              'Este produto tem retiradas pendentes (mercadoria reservada). Conclua ou cancele as retiradas antes de desligar o controle de estoque.',
          },
          409,
        );
      }
    }
    // Histórico de custo/preço (2026-10-16): mexeu em custo ou preço ⇒ lê o "antes" e grava a linha
    // na MESMA transação do update.
    const touchesPrice = patchData.costPrice !== undefined || patchData.salePrice !== undefined;
    // updateMany garante o escopo do tenant (proteção antes do RLS da Fase 2).
    const result = await prisma.$transaction(async (tx) => {
      const before = touchesPrice
        ? await tx.product.findFirst({
            where: { id, tenantId, deletedAt: null },
            select: { costPrice: true, salePrice: true },
          })
        : null;
      const r = await tx.product.updateMany({
        where: { id, tenantId, deletedAt: null },
        // Autoria (ADR-010): registra quem alterou por último + snapshot do nome.
        data: {
          ...patchData,
          ...(dismissPriceReview ? { priceReviewPendingAt: null } : {}),
          ...(markReviewed ? { pendingReview: false } : {}),
          updatedById: c.get('userId'),
          updatedByName: c.get('userName'),
        },
      });
      if (r.count > 0 && before) {
        await recordPriceHistory(tx, {
          tenantId,
          productId: id,
          userId: c.get('userId'),
          userName: c.get('userName'),
          source: 'PRODUCT_EDIT',
          before: { costPrice: before.costPrice.toString(), salePrice: before.salePrice.toString() },
          after: { costPrice: patchData.costPrice, salePrice: patchData.salePrice },
        });
      }
      return r;
    });
    if (result.count === 0) {
      return c.json({ ok: false, error: 'Produto não encontrado.' }, 404);
    }
    const updated = await prisma.product.findFirst({ where: { id, tenantId } });
    return c.json({ ok: true, data: updated ? withMargin(updated) : null });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return c.json({ ok: false, error: uniqueConflictMessage(err) }, 409);
    }
    console.error('PATCH /products/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao atualizar o produto.' }, 500);
  }
});

/**
 * Soft-delete (ADR-004): marca `deletedAt`. **Definitivo** — não há reativação (diferente de
 * `isActive`, que é reversível). Numa transação, também **desfaz o par (ADR-015) do outro lado**:
 * no soft-delete o `onDelete: SetNull` do FK não dispara, então o produto que apontava para este
 * ficaria referenciando um item que sumiu do catálogo. Zeramos esse vínculo reverso.
 */
products.delete('/:id', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  try {
    const prisma = getPrisma(c);
    const id = c.req.param('id');
    const userId = c.get('userId');
    const userName = c.get('userName');
    const count = await prisma.$transaction(async (tx) => {
      const del = await tx.product.updateMany({
        where: { id, tenantId, deletedAt: null },
        // Autoria (ADR-010): quem excluiu + snapshot (o "quando" é o próprio deletedAt).
        // ADR-040 §3: o índice do PLU é único comum (não parcial) ⇒ o excluído LIBERA o código na balança.
        data: { deletedAt: new Date(), deletedById: userId, deletedByName: userName, scaleCode: null },
      });
      if (del.count === 0) return 0;
      // Par (ADR-015): limpa o vínculo reverso para não deixar referência pendurada.
      await tx.product.updateMany({
        where: { pairedProductId: id, tenantId, deletedAt: null },
        data: {
          pairedProductId: null,
          pairPrice: null,
          updatedById: userId,
          updatedByName: userName,
        },
      });
      return del.count;
    });
    if (count === 0) {
      return c.json({ ok: false, error: 'Produto não encontrado.' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('DELETE /products/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao remover o produto.' }, 500);
  }
});

export default products;
