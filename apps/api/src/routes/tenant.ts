import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

const tenant = new Hono<Env>();
tenant.use('*', requireAuth);

/** Dados da loja autenticada (para cabeçalho de comprovantes, etc.). */
tenant.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  try {
    const prisma = createPrismaClient(connectionString);
    const data = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, logoUrl: true, cnpj: true, phone: true },
    });
    if (!data) {
      return c.json({ ok: false, error: 'Loja não encontrada.' }, 404);
    }
    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /tenant falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar a loja.' }, 500);
  }
});

export default tenant;
