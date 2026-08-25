/**
 * Orquestração da emissão fiscal — costura domínio, provedor e persistência.
 *
 * É aqui que moram as garantias que o serviço promete:
 *  1. **Idempotência**: `(tenantId, orderId)` nunca gera duas notas.
 *  2. **Validar antes de transmitir**: erro de preenchimento não queima
 *     numeração fiscal nem chamada paga ao provedor.
 *  3. **Falha de infra vira contingência**, não erro para o operador: se a SEFAZ
 *     está fora, a venda não pode parar no balcão.
 *
 * Não há I/O direto aqui além das portas injetadas — o que torna tudo testável.
 */

import { calcDocumentTotals, canCancel, canTransition, validateIssueRequest, type ValidationIssue } from './domain/document';
import type { FiscalDocument, FiscalEnvironment, IssueRequest } from './domain/types';
import { FiscalProviderError, type FiscalProvider } from './providers/provider';
import type { FiscalDocumentStore } from './store/store';

/** Resultado da tentativa de emissão, do ponto de vista de quem chamou. */
export type IssueResult =
  | { kind: 'ISSUED'; document: FiscalDocument }
  /** Já existia nota para esta venda — devolve a existente, não emite outra. */
  | { kind: 'ALREADY_ISSUED'; document: FiscalDocument }
  | { kind: 'INVALID'; issues: ValidationIssue[] }
  | { kind: 'REJECTED'; document: FiscalDocument }
  | { kind: 'DENIED'; document: FiscalDocument }
  /** SEFAZ/provedor indisponível: documento fica em contingência para reenvio. */
  | { kind: 'CONTINGENCY'; document: FiscalDocument; reason: string };

export type CancelResult =
  | { kind: 'CANCELLED'; document: FiscalDocument }
  | { kind: 'NOT_FOUND' }
  /** Estado atual não permite cancelar (ex.: nota não autorizada). */
  | { kind: 'INVALID_STATE'; status: FiscalDocument['status'] }
  /** Fora do prazo legal de cancelamento. */
  | { kind: 'WINDOW_EXPIRED' }
  | { kind: 'REFUSED'; code: string; reason: string };

export interface FiscalServiceDeps {
  provider: FiscalProvider;
  store: FiscalDocumentStore;
  environment: FiscalEnvironment;
  /** Relógio injetável — mantém os testes determinísticos. */
  now?: () => Date;
  /** Gerador de id do documento. Injetável para teste. */
  newId?: () => string;
}

export class FiscalService {
  private readonly provider: FiscalProvider;
  private readonly store: FiscalDocumentStore;
  private readonly environment: FiscalEnvironment;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(deps: FiscalServiceDeps) {
    this.provider = deps.provider;
    this.store = deps.store;
    this.environment = deps.environment;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  /**
   * Emite a NFC-e de uma venda.
   *
   * A ordem dos passos é deliberada: idempotência → validação → transmissão.
   * Consultar a nota existente ANTES de validar evita que uma mudança de regra
   * de validação impeça alguém de recuperar uma nota já autorizada.
   */
  async issue(request: IssueRequest): Promise<IssueResult> {
    const existing = await this.store.findByOrder(request.tenantId, request.orderId);
    if (existing && existing.status !== 'REJECTED') {
      // REJECTED é o único estado que permite nova tentativa com a mesma venda:
      // o erro era de preenchimento e a numeração pode ser reaproveitada.
      return { kind: 'ALREADY_ISSUED', document: existing };
    }

    const issues = validateIssueRequest(request);
    if (issues.length > 0) return { kind: 'INVALID', issues };

    const totals = calcDocumentTotals(request);
    const base: FiscalDocument = {
      id: existing?.id ?? this.newId(),
      tenantId: request.tenantId,
      orderId: request.orderId,
      model: request.model,
      environment: this.environment,
      status: 'PENDING',
      number: request.number,
      series: request.issuer.series,
      totalCents: totals.totalCents,
      createdAt: existing?.createdAt ?? this.now().toISOString(),
    };

    let outcome;
    try {
      outcome = await this.provider.issue(request);
    } catch (error) {
      // Falha de INFRA. Se for transitória, a venda não pode parar: o documento
      // fica em contingência e é retransmitido depois. Se não for transitória
      // (credencial errada, payload recusado), propaga — é bug/config, e mascarar
      // isso como contingência esconderia um problema que precisa de atenção.
      if (error instanceof FiscalProviderError && error.retryable) {
        const document: FiscalDocument = { ...base, status: 'CONTINGENCY' };
        await this.store.save(document);
        return { kind: 'CONTINGENCY', document, reason: error.message };
      }
      throw error;
    }

    if (outcome.kind === 'AUTHORIZED') {
      const document: FiscalDocument = {
        ...base,
        status: 'AUTHORIZED',
        accessKey: outcome.accessKey,
        protocol: outcome.protocol,
        authorizedAt: outcome.authorizedAt,
      };
      await this.store.save(document);
      return { kind: 'ISSUED', document };
    }

    const status = outcome.kind === 'DENIED' ? 'DENIED' : 'REJECTED';
    const document: FiscalDocument = {
      ...base,
      status,
      statusCode: outcome.code,
      statusReason: outcome.reason,
    };
    await this.store.save(document);
    return outcome.kind === 'DENIED'
      ? { kind: 'DENIED', document }
      : { kind: 'REJECTED', document };
  }

  /** Consulta um documento pelo id da venda. */
  async findByOrder(tenantId: string, orderId: string): Promise<FiscalDocument | null> {
    return this.store.findByOrder(tenantId, orderId);
  }

  /**
   * Cancela uma nota autorizada, respeitando a máquina de estados e o prazo legal.
   * As duas checagens locais (estado e janela) rodam ANTES de chamar o provedor,
   * porque uma tentativa fora de prazo é recusa certa e desperdiça chamada.
   */
  async cancel(tenantId: string, orderId: string, reason: string): Promise<CancelResult> {
    const document = await this.store.findByOrder(tenantId, orderId);
    if (!document) return { kind: 'NOT_FOUND' };

    if (!canTransition(document.status, 'CANCELLED') || !document.accessKey) {
      return { kind: 'INVALID_STATE', status: document.status };
    }
    if (document.authorizedAt && !canCancel(new Date(document.authorizedAt), this.now())) {
      return { kind: 'WINDOW_EXPIRED' };
    }

    const outcome = await this.provider.cancel({ accessKey: document.accessKey, reason });
    if (outcome.kind === 'REFUSED') {
      return { kind: 'REFUSED', code: outcome.code, reason: outcome.reason };
    }

    const cancelled: FiscalDocument = {
      ...document,
      status: 'CANCELLED',
      cancelledAt: outcome.cancelledAt,
      statusReason: reason,
    };
    await this.store.save(cancelled);
    return { kind: 'CANCELLED', document: cancelled };
  }
}
