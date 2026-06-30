import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createPrismaClient } from '@nexoloja/db';
import { type Env, getConnectionString } from './lib/request';
import products from './routes/products';
import customers from './routes/customers';
import categories from './routes/categories';
import suppliers from './routes/suppliers';
import cashSessions from './routes/cashSessions';
import orders from './routes/orders';
import stock from './routes/stock';
import tenant from './routes/tenant';

const app = new Hono<Env>();

// CORS: libera a PWA (dev local; origens de produção entram aqui depois).
app.use(
  '*',
  cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

app.get('/health', (c) => c.json({ ok: true, service: 'nexoloja-api' }));

// Rotas de recursos
app.route('/products', products);
app.route('/customers', customers);
app.route('/categories', categories);
app.route('/suppliers', suppliers);
app.route('/cash-sessions', cashSessions);
app.route('/orders', orders);
app.route('/stock', stock);
app.route('/tenant', tenant);

/**
 * Validação do item 3: confirma que o Prisma roda no Cloudflare Worker via driver
 * adapter (`@prisma/adapter-pg`) e consegue ler o Postgres do Supabase pela edge.
 * Faz apenas uma contagem leve em `tenants`.
 */
app.get('/db-check', async (c) => {
  const connectionString = getConnectionString(c.env);
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
