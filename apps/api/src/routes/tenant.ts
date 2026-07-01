import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import { updateTenantSchema, validateLogo } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

/** Chave do objeto da logo no R2 — uma por loja; reenviar sobrescreve (ADR-007). */
const logoKey = (tenantId: string) => `logos/${tenantId}`;

/** URL pública (servida pelo próprio Worker) com cache-bust por versão. */
const logoUrl = (origin: string, tenantId: string) =>
  `${origin}/public/logo/${tenantId}?v=${Date.now()}`;

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

/** Edita os dados cadastrais da loja (nome obrigatório; CNPJ/telefone opcionais). */
tenant.patch('/', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateTenantSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const prisma = createPrismaClient(connectionString);
    await prisma.tenant.update({ where: { id: tenantId }, data: parsed.data });
    const data = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, logoUrl: true, cnpj: true, phone: true },
    });
    return c.json({ ok: true, data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return c.json({ ok: false, error: 'Já existe uma loja com esse CNPJ.' }, 409);
    }
    console.error('PATCH /tenant falhou:', err);
    return c.json({ ok: false, error: 'Falha ao salvar os dados da loja.' }, 500);
  }
});

/**
 * Upload da logo da loja (ADR-007). O binário é enviado como corpo cru da
 * requisição com o `Content-Type` da imagem; o Worker valida tipo/tamanho,
 * grava no R2 (`env.MEDIA`) e salva SÓ a URL em `Tenant.logoUrl` (nunca BLOB).
 */
tenant.post('/logo', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  const bucket = c.env.MEDIA;
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  if (!bucket) {
    return c.json({ ok: false, error: 'Armazenamento de mídia indisponível.' }, 500);
  }

  const contentType = c.req.header('Content-Type');
  let body: ArrayBuffer;
  try {
    body = await c.req.arrayBuffer();
  } catch {
    return c.json({ ok: false, error: 'Falha ao ler a imagem enviada.' }, 400);
  }

  // Validação (mesma regra do cliente, ADR-007): fonte de verdade no servidor.
  const check = validateLogo(contentType, body.byteLength);
  if (!check.ok) {
    return c.json({ ok: false, error: check.error }, 400);
  }

  try {
    await bucket.put(logoKey(tenantId), body, {
      httpMetadata: { contentType: contentType as string },
    });
    const url = logoUrl(new URL(c.req.url).origin, tenantId);
    const prisma = createPrismaClient(connectionString);
    await prisma.tenant.update({ where: { id: tenantId }, data: { logoUrl: url } });
    return c.json({ ok: true, data: { logoUrl: url } });
  } catch (err) {
    console.error('POST /tenant/logo falhou:', err);
    return c.json({ ok: false, error: 'Falha ao enviar a logo.' }, 500);
  }
});

/** Remove a logo: apaga o objeto no R2 e zera `Tenant.logoUrl` (ADR-007). */
tenant.delete('/logo', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  const bucket = c.env.MEDIA;
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  if (!bucket) {
    return c.json({ ok: false, error: 'Armazenamento de mídia indisponível.' }, 500);
  }
  try {
    await bucket.delete(logoKey(tenantId));
    const prisma = createPrismaClient(connectionString);
    await prisma.tenant.update({ where: { id: tenantId }, data: { logoUrl: null } });
    return c.json({ ok: true, data: { logoUrl: null } });
  } catch (err) {
    console.error('DELETE /tenant/logo falhou:', err);
    return c.json({ ok: false, error: 'Falha ao remover a logo.' }, 500);
  }
});

export default tenant;
