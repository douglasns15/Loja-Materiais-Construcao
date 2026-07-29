import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import { cartSnapshotSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

/**
 * Cesta persistente do PDV (ADR-021). Guarda o carrinho-rascunho de um usuário para que ele **não
 * se perca** ao navegar/recarregar e **siga o usuário entre dispositivos**. Uma linha por usuário
 * (PK = `userId`), com os itens em JSONB — snapshot da UI (par/acréscimo/unidade fechada), não a
 * fonte de verdade: preço/estoque são revalidados no `POST /orders` na hora de vender.
 *
 * A sincronização entre aparelhos é **last-write-wins** por `updatedAt` (rascunho — não vale um
 * merge). Isolamento por USUÁRIO: cada rota opera só sobre a cesta de `c.get('userId')`.
 */
const cart = new Hono<Env>();
cart.use('*', requireAuth);

/** Cesta do usuário autenticado. Linha inexistente ⇒ cesta vazia (não é erro). */
cart.get('/', async (c) => {
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!userId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  try {
    const prisma = createPrismaClient(connectionString);
    const row = await prisma.cart.findUnique({
      where: { userId },
      select: { items: true, updatedAt: true },
    });
    return c.json({
      ok: true,
      data: { items: row?.items ?? [], updatedAt: row?.updatedAt ?? null },
    });
  } catch (err) {
    console.error('GET /cart falhou:', err);
    return c.json({ ok: false, error: 'Falha ao carregar a cesta.' }, 500);
  }
});

/**
 * Salva (upsert) a cesta do usuário. Usa **POST** (não PUT) porque o CORS libera GET/POST/PATCH/
 * DELETE. O `tenantId` vem do contexto (JWT); o `updatedAt` é o relógio do last-write-wins.
 */
cart.post('/', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !userId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = cartSnapshotSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Cesta inválida.', issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const now = new Date();
    // Prisma não gerencia `@updatedAt` no upsert quando não há outra mudança de campo; setamos
    // explícito para o relógio do last-write-wins avançar em toda gravação.
    const row = await prisma.cart.upsert({
      where: { userId },
      create: { userId, tenantId, items: parsed.data.items, updatedAt: now },
      update: { items: parsed.data.items, updatedAt: now },
      select: { updatedAt: true },
    });
    return c.json({ ok: true, data: { updatedAt: row.updatedAt } });
  } catch (err) {
    console.error('POST /cart falhou:', err);
    return c.json({ ok: false, error: 'Falha ao salvar a cesta.' }, 500);
  }
});

/** Limpa a cesta do usuário (ao concluir a venda ou no "Limpar carrinho"). Idempotente. */
cart.delete('/', async (c) => {
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!userId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  try {
    const prisma = createPrismaClient(connectionString);
    // `deleteMany` não estoura quando a linha não existe (idempotente — limpar cesta já vazia é OK).
    await prisma.cart.deleteMany({ where: { userId } });
    return c.json({ ok: true, data: { cleared: true } });
  } catch (err) {
    console.error('DELETE /cart falhou:', err);
    return c.json({ ok: false, error: 'Falha ao limpar a cesta.' }, 500);
  }
});

export default cart;
