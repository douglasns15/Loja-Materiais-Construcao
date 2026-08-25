/**
 * Adaptador FAKE — SEFAZ simulada, determinística e sem rede.
 *
 * Existe para que todo o fluxo (validar → emitir → consultar → cancelar) seja
 * construído e testado **antes** de contratar um provedor real, e para servir de
 * referência de comportamento quando o adaptador real for escrito.
 *
 * ⚠️ NUNCA emite documento com valor fiscal. Se `FISCAL_ENVIRONMENT=producao`
 * apontar para este adaptador, o serviço recusa a subida (ver src/index.ts).
 *
 * Regras de simulação (escolhidas para exercitar os caminhos de erro):
 *  - item com descrição contendo "REJEITAR"  → REJECTED (erro corrigível)
 *  - item com descrição contendo "DENEGAR"   → DENIED   (terminal)
 *  - item com descrição contendo "FALHAR"    → erro de infra retryable
 *  - caso contrário                          → AUTHORIZED
 */

import { buildAccessKey, EMISSION_NORMAL, EMISSION_OFFLINE_CONTINGENCY, MODEL_NFCE } from '../domain/accessKey';
import type { FiscalEnvironment, IssueRequest } from '../domain/types';
import {
  FiscalProviderError,
  type CancelOutcome,
  type CancelRequest,
  type FiscalProvider,
  type IssueOutcome,
} from './provider';

/** Justificativa de cancelamento exigida pela SEFAZ: mínimo de 15 caracteres. */
export const MIN_CANCEL_REASON_LENGTH = 15;

export interface FakeProviderOptions {
  /** Relógio injetável — mantém os testes determinísticos. */
  now?: () => Date;
  /**
   * Gerador do código numérico da chave (cNF). Injetável para tornar a chave
   * reproduzível em teste; em produção seria aleatório.
   */
  numericCode?: (request: IssueRequest) => number;
}

/**
 * Deriva um cNF estável a partir do pedido (hash simples e determinístico).
 * Assim, reemitir o MESMO pedido gera a MESMA chave — o que torna a
 * idempotência verificável de ponta a ponta.
 */
function defaultNumericCode(request: IssueRequest): number {
  const seed = `${request.tenantId}:${request.orderId}:${request.number}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100_000_000;
  }
  return hash;
}

export class FakeFiscalProvider implements FiscalProvider {
  readonly name = 'fake';
  readonly environment: FiscalEnvironment = 'homologacao';

  private readonly now: () => Date;
  private readonly numericCode: (request: IssueRequest) => number;

  constructor(options: FakeProviderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.numericCode = options.numericCode ?? defaultNumericCode;
  }

  async issue(request: IssueRequest): Promise<IssueOutcome> {
    const descriptions = request.items.map((i) => i.description.toUpperCase());

    if (descriptions.some((d) => d.includes('FALHAR'))) {
      throw new FiscalProviderError('SEFAZ simulada indisponível.', {
        retryable: true,
        providerCode: 'SIM-503',
      });
    }
    if (descriptions.some((d) => d.includes('DENEGAR'))) {
      return {
        kind: 'DENIED',
        code: '302',
        reason: 'Rejeição simulada: irregularidade fiscal do destinatário.',
      };
    }
    if (descriptions.some((d) => d.includes('REJEITAR'))) {
      return {
        kind: 'REJECTED',
        code: '539',
        reason: 'Rejeição simulada: duplicidade de número da nota.',
      };
    }

    const at = this.now();
    const accessKey = buildAccessKey({
      ufCode: request.issuer.ufCode,
      year: at.getUTCFullYear(),
      month: at.getUTCMonth() + 1,
      cnpj: request.issuer.cnpj,
      model: MODEL_NFCE,
      series: request.issuer.series,
      number: request.number,
      emissionType: request.contingency ? EMISSION_OFFLINE_CONTINGENCY : EMISSION_NORMAL,
      numericCode: this.numericCode(request),
    });

    return {
      kind: 'AUTHORIZED',
      accessKey,
      protocol: `SIM${accessKey.slice(-15)}`,
      authorizedAt: at.toISOString(),
      qrCodeUrl: `https://exemplo.invalid/nfce/qr?chNFe=${accessKey}&tpAmb=2`,
    };
  }

  async cancel(request: CancelRequest): Promise<CancelOutcome> {
    if (request.reason.trim().length < MIN_CANCEL_REASON_LENGTH) {
      return {
        kind: 'REFUSED',
        code: '242',
        reason: `Justificativa deve ter ao menos ${MIN_CANCEL_REASON_LENGTH} caracteres.`,
      };
    }
    return {
      kind: 'CANCELLED',
      protocol: `SIMCANC${request.accessKey.slice(-10)}`,
      cancelledAt: this.now().toISOString(),
    };
  }
}
