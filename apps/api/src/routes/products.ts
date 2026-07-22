import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import { calcMarginPercent } from '@nexoloja/core';
import { createProductSchema, updateProductSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

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
    // updateMany garante o escopo do tenant (proteção antes do RLS da Fase 2).
    const result = await prisma.product.updateMany({
      where: { id, tenantId, deletedAt: null },
      // Autoria (ADR-010): registra quem alterou por último + snapshot do nome.
      data: { ...parsed.data, updatedById: c.get('userId'), updatedByName: c.get('userName') },
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
