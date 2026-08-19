import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import { calcMarginPercent } from '@nexoloja/core';
import { createProductSchema, updateProductSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

/**
 * Escapa os curingas do `LIKE`/`ILIKE` (`%`, `_`, `\`) para que o token seja tratado como
 * texto literal (substring), igual ao `.includes()` do core — sem isso, um `%` digitado
 * viraria "qualquer coisa". Usa `\` como escape (o default do Postgres).
 */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
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
    const prisma = createPrismaClient(connectionString);
    const includeInactive = c.req.query('includeInactive') === 'true';
    // SEM teto: um PDV jamais pode esconder um produto do catálogo. O `take: 100` anterior
    // truncava silenciosamente em ordem alfabética — passando de 100 produtos, os de nome
    // "tardio" (ex.: "Vass…") sumiam de Produtos/Estoque/Venda mesmo existindo no banco. O
    // escopo já é o catálogo do próprio tenant (RLS), então listar tudo é o correto. Se algum
    // dia um catálogo ficar realmente grande, o caminho é busca no servidor (`?q=`) + paginação,
    // não um corte cego que oculta dados.
    const items = await prisma.product.findMany({
      where: { tenantId, deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });
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
    const prisma = createPrismaClient(connectionString);
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
    const prisma = createPrismaClient(connectionString);
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
    const prisma = createPrismaClient(connectionString);
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

    let created;
    if (initialStock && initialStock > 0) {
      // Estoque inicial (ADR-001): cria o produto E gera a Entrada (StockMovement INCOME) na
      // MESMA transação — o saldo nunca é escrito "solto" no cache. `stockQty` e a soma dos
      // movimentos ficam consistentes (reconciliação bate). A entrada carrega a autoria (ADR-010).
      created = await prisma.$transaction(async (tx) => {
        const p = await tx.product.create({
          data: { ...productData, tenantId, stockQty: initialStock, ...authorship },
        });
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
      created = await prisma.product.create({
        data: { ...productData, tenantId, ...authorship },
      });
    }
    return c.json({ ok: true, data: withMargin(created) }, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return c.json({ ok: false, error: 'Já existe um produto com esse SKU.' }, 409);
      }
      if (err.code === 'P2003') {
        return c.json({ ok: false, error: 'Tenant ou categoria inexistente.' }, 400);
      }
    }
    console.error('POST /products falhou:', err);
    return c.json({ ok: false, error: 'Falha ao criar o produto.' }, 500);
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
    const prisma = createPrismaClient(connectionString);
    const id = c.req.param('id');
    // Par (ADR-015): mesmas guardas da criação, agora com o id para pegar auto-referência.
    if (parsed.data.pairedProductId !== undefined) {
      const pairError = await validatePair(prisma, tenantId, id, parsed.data.pairedProductId);
      if (pairError) return c.json({ ok: false, error: pairError }, 400);
    }
    // Item 5 da esteira: `dismissPriceReview` NÃO é coluna — é um sinal. Traduz em limpar
    // `priceReviewPendingAt` e não vaza para o Prisma (senão o update quebraria por campo
    // desconhecido). Separado do resto do payload por desestruturação.
    const { dismissPriceReview, ...patchData } = parsed.data;
    // updateMany garante o escopo do tenant (proteção antes do RLS da Fase 2).
    const result = await prisma.product.updateMany({
      where: { id, tenantId, deletedAt: null },
      // Autoria (ADR-010): registra quem alterou por último + snapshot do nome.
      data: {
        ...patchData,
        ...(dismissPriceReview ? { priceReviewPendingAt: null } : {}),
        updatedById: c.get('userId'),
        updatedByName: c.get('userName'),
      },
    });
    if (result.count === 0) {
      return c.json({ ok: false, error: 'Produto não encontrado.' }, 404);
    }
    const updated = await prisma.product.findFirst({ where: { id, tenantId } });
    return c.json({ ok: true, data: updated ? withMargin(updated) : null });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return c.json({ ok: false, error: 'Já existe um produto com esse SKU.' }, 409);
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
    const prisma = createPrismaClient(connectionString);
    const id = c.req.param('id');
    const userId = c.get('userId');
    const userName = c.get('userName');
    const count = await prisma.$transaction(async (tx) => {
      const del = await tx.product.updateMany({
        where: { id, tenantId, deletedAt: null },
        // Autoria (ADR-010): quem excluiu + snapshot (o "quando" é o próprio deletedAt).
        data: { deletedAt: new Date(), deletedById: userId, deletedByName: userName },
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
