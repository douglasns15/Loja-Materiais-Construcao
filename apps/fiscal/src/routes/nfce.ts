/**
 * Rotas da NFC-e.
 *
 * Contrato desenhado para o encaixe futuro na API de negócio (fatia final):
 *
 *   POST   /nfce                      emite (idempotente por tenantId+orderId)
 *   GET    /nfce/:tenantId/:orderId   consulta o documento de uma venda
 *   POST   /nfce/:tenantId/:orderId/cancel   cancela dentro do prazo legal
 *
 * O formato de resposta segue o padrão da API do NexoLoja (`{ ok, data | error }`),
 * para o encaixe não exigir tradução.
 */

import { Hono } from 'hono';
import type { Env } from '../env';
import { readEnvironment } from '../env';
import { FiscalService } from '../service';
import { FakeFiscalProvider } from '../providers/fake';
import { MemoryFiscalStore } from '../store/memory';
import { FiscalProviderError } from '../providers/provider';
import type { IssueRequest } from '../domain/types';

/**
 * Store em memória compartilhado pelo isolate.
 *
 * ⚠️ Deliberadamente efêmero: some quando o isolate recicla. A durabilidade
 * chega junto com a tabela aprovada pelo Owner (ver src/store/store.ts).
 */
const store = new MemoryFiscalStore();

const nfce = new Hono<Env>();

/**
 * Monta o serviço com o adaptador configurado.
 *
 * Hoje só existe o "fake". Um valor desconhecido falha ALTO em vez de cair
 * silenciosamente na simulação — emitir "nota" fake achando que é real seria o
 * pior desfecho possível.
 */
function buildService(env: Env['Bindings']): FiscalService {
  const providerName = env.FISCAL_PROVIDER ?? 'fake';
  if (providerName !== 'fake') {
    throw new FiscalProviderError(
      `Adaptador fiscal "${providerName}" ainda não implementado.`,
      { retryable: false, providerCode: 'ADAPTER_NOT_IMPLEMENTED' },
    );
  }
  return new FiscalService({
    provider: new FakeFiscalProvider(),
    store,
    environment: readEnvironment(env),
  });
}

nfce.post('/', async (c) => {
  let body: IssueRequest;
  try {
    body = (await c.req.json()) as IssueRequest;
  } catch {
    return c.json({ ok: false, error: 'Corpo da requisição inválido (JSON).' }, 400);
  }

  try {
    const result = await buildService(c.env).issue(body);

    switch (result.kind) {
      case 'ISSUED':
        return c.json({ ok: true, data: { status: 'ISSUED', document: result.document } }, 201);
      case 'ALREADY_ISSUED':
        // 200 (e não 409): repetir a chamada é seguro e devolve o mesmo resultado.
        return c.json({ ok: true, data: { status: 'ALREADY_ISSUED', document: result.document } });
      case 'INVALID':
        return c.json({ ok: false, error: 'Dados da nota inválidos.', issues: result.issues }, 422);
      case 'REJECTED':
        return c.json(
          { ok: false, error: `Nota rejeitada: ${result.document.statusReason}`, document: result.document },
          422,
        );
      case 'DENIED':
        return c.json(
          { ok: false, error: `Nota denegada: ${result.document.statusReason}`, document: result.document },
          422,
        );
      case 'CONTINGENCY':
        // 202: aceito, mas ainda não autorizado — será retransmitido.
        return c.json(
          { ok: true, data: { status: 'CONTINGENCY', document: result.document, reason: result.reason } },
          202,
        );
    }
  } catch (error) {
    // Falha de infra não-transitória (credencial/config) — log detalhado no
    // servidor, mensagem amigável ao cliente (padrão do CLAUDE.md).
    console.error('POST /nfce falhou:', error);
    const providerCode = error instanceof FiscalProviderError ? error.providerCode : undefined;
    return c.json(
      { ok: false, error: 'Falha ao comunicar com o provedor fiscal.', providerCode },
      502,
    );
  }
});

nfce.get('/:tenantId/:orderId', async (c) => {
  const { tenantId, orderId } = c.req.param();
  const document = await buildService(c.env).findByOrder(tenantId, orderId);
  if (!document) return c.json({ ok: false, error: 'Nota não encontrada para esta venda.' }, 404);
  return c.json({ ok: true, data: document });
});

nfce.post('/:tenantId/:orderId/cancel', async (c) => {
  const { tenantId, orderId } = c.req.param();

  let reason = '';
  try {
    const body = (await c.req.json()) as { reason?: string };
    reason = body.reason ?? '';
  } catch {
    return c.json({ ok: false, error: 'Corpo da requisição inválido (JSON).' }, 400);
  }

  try {
    const result = await buildService(c.env).cancel(tenantId, orderId, reason);

    switch (result.kind) {
      case 'CANCELLED':
        return c.json({ ok: true, data: result.document });
      case 'NOT_FOUND':
        return c.json({ ok: false, error: 'Nota não encontrada para esta venda.' }, 404);
      case 'INVALID_STATE':
        return c.json(
          { ok: false, error: `Nota no estado ${result.status} não pode ser cancelada.` },
          409,
        );
      case 'WINDOW_EXPIRED':
        return c.json(
          { ok: false, error: 'Prazo legal de cancelamento expirado. Use devolução/estorno.' },
          409,
        );
      case 'REFUSED':
        return c.json({ ok: false, error: result.reason, code: result.code }, 422);
    }
  } catch (error) {
    console.error('POST /nfce/:tenantId/:orderId/cancel falhou:', error);
    return c.json({ ok: false, error: 'Falha ao comunicar com o provedor fiscal.' }, 502);
  }
});

export default nfce;
