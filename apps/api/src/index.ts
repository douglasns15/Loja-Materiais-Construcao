import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createPrismaClient } from '@nexoloja/db';
import { type Bindings, type Env, getConnectionString } from './lib/request';
import { runKeepAlive } from './lib/keepAlive';
import products from './routes/products';
import catalog from './routes/catalog';
import nfe from './routes/nfe';
import customers from './routes/customers';
import categories from './routes/categories';
import suppliers from './routes/suppliers';
import cashSessions from './routes/cashSessions';
import orders from './routes/orders';
import quotes from './routes/quotes';
import receivables from './routes/receivables';
import deliveries from './routes/deliveries';
import cart from './routes/cart';
import stock from './routes/stock';
import tenant from './routes/tenant';
import reports from './routes/reports';
import alerts from './routes/alerts';
import me from './routes/me';
import usersRoute from './routes/users';
import platform from './routes/platform';
import support from './routes/support';

const app = new Hono<Env>();

// CORS: libera a PWA (dev local + web publicado no Cloudflare via OpenNext).
app.use(
  '*',
  cors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://nexoloja-web.imortal.workers.dev',
    ],
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

app.get('/health', (c) => c.json({ ok: true, service: 'nexoloja-api' }));

/**
 * Leitura pública da logo da loja servida pelo próprio Worker a partir do R2
 * (ADR-007). Sem autenticação — a URL é referenciada em <img> (comprovantes,
 * tela de configurações). A `logoUrl` gravada no banco carrega `?v=<ts>` para
 * invalidar cache a cada novo upload, por isso o cache pode ser longo.
 */
app.get('/public/logo/:tenantId', async (c) => {
  const bucket = c.env.MEDIA;
  if (!bucket) return c.notFound();
  const obj = await bucket.get(`logos/${c.req.param('tenantId')}`);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: obj.httpEtag,
    },
  });
});

// Rotas de recursos
app.route('/products', products);
app.route('/catalog', catalog);
app.route('/nfe', nfe);
app.route('/customers', customers);
app.route('/categories', categories);
app.route('/suppliers', suppliers);
app.route('/cash-sessions', cashSessions);
app.route('/orders', orders);
app.route('/quotes', quotes);
app.route('/receivables', receivables);
app.route('/deliveries', deliveries);
app.route('/cart', cart);
app.route('/stock', stock);
app.route('/tenant', tenant);
app.route('/reports', reports);
app.route('/alerts', alerts);
app.route('/me', me);
app.route('/users', usersRoute);
app.route('/platform', platform);
// Sessão de suporte (ADR-009, Fatia E). Fora de `/platform/*` de propósito: o Bearer aqui é o
// token de suporte (não um JWT do Supabase), verificado por `requireSupportSession`.
app.route('/support', support);

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

/**
 * Export do Worker como MÓDULO com dois handlers:
 * - `fetch`: a API HTTP (a app Hono acima) — atende vendas/caixa/etc.
 * - `scheduled`: o keep-alive do pool (cron de 5 em 5 min, ver wrangler.toml `[triggers]`).
 *   É uma invocação SEPARADA do `fetch` — roda em paralelo, não bloqueia nem concorre com as
 *   requisições reais. `ctx.waitUntil` mantém o Worker vivo até o `SELECT 1` terminar; o próprio
 *   `runKeepAlive` nunca lança, então uma falha do keep-alive jamais afeta o atendimento.
 */
export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runKeepAlive(env));
  },
};
