import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import products from './routes/products';

type Bindings = {
  /** Conexão injetada pelo Cloudflare Hyperdrive (ADR-005). */
  HYPERDRIVE?: { connectionString: string };
  /** Fallback para desenvolvimento local (wrangler secret / .dev.vars). */
  DATABASE_URL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', (c) => c.json({ ok: true, service: 'nexoloja-api' }));

// Rotas de recursos
app.route('/products', products);

/**
 * Validação do item 3: confirma que o Prisma roda no Cloudflare Worker via driver
 * adapter (`@prisma/adapter-pg`) e consegue ler o Postgres do Supabase pela edge.
 * Faz apenas uma contagem leve em `tenants`.
 */
app.get('/db-check', async (c) => {
  const connectionString = c.env.HYPERDRIVE?.connectionString ?? c.env.DATABASE_URL;
  if (!connectionString) {
    return c.json(
      { ok: false, error: 'Sem connection string (HYPERDRIVE ou DATABASE_URL).' },
      500,
    );
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const tenants = await prisma.tenant.count();
    return c.json({ ok: true, tenants });
  } catch (err) {
    // Log detalhado no servidor, mensagem amigável ao cliente (CLAUDE.md).
    console.error('db-check falhou:', err);
    return c.json({ ok: false, error: 'Falha ao consultar o banco de dados.' }, 500);
  }
});

export default app;
