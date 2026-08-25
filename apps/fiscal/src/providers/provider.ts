/**
 * PORTA do provedor fiscal — o contrato que qualquer integração deve cumprir.
 *
 * O domínio (src/domain) e as rotas (src/routes) só conhecem esta interface.
 * Focus NFe, Nuvem Fiscal, PlugNotas ou um mock de testes entram como
 * ADAPTADORES intercambiáveis, sem que uma linha do domínio mude. Isso é o que
 * permite construir e testar a emissão inteira **antes** de contratar alguém.
 *
 * Princípio de erro (mesmo espírito de `classifyHttpOutcome` no packages/core):
 * desfecho de NEGÓCIO (rejeição da SEFAZ) é valor de retorno, não exceção;
 * exceção é reservada para falha de INFRA (rede, credencial, indisponibilidade).
 */

import type { FiscalEnvironment, IssueRequest } from '../domain/types';

/** Nota autorizada pela SEFAZ. */
export interface AuthorizedOutcome {
  kind: 'AUTHORIZED';
  accessKey: string;
  protocol: string;
  authorizedAt: string;
  /** URL do QR Code / consulta pública, quando o provedor devolve. */
  qrCodeUrl?: string;
}

/**
 * Nota rejeitada: erro de preenchimento. A numeração PODE ser reaproveitada
 * após correção.
 */
export interface RejectedOutcome {
  kind: 'REJECTED';
  code: string;
  reason: string;
}

/**
 * Nota denegada: irregularidade fiscal do emitente ou do destinatário. A
 * numeração é queimada e precisa ser inutilizada — estado terminal.
 */
export interface DeniedOutcome {
  kind: 'DENIED';
  code: string;
  reason: string;
}

export type IssueOutcome = AuthorizedOutcome | RejectedOutcome | DeniedOutcome;

export interface CancelAcceptedOutcome {
  kind: 'CANCELLED';
  protocol: string;
  cancelledAt: string;
}

export interface CancelRefusedOutcome {
  kind: 'REFUSED';
  code: string;
  reason: string;
}

export type CancelOutcome = CancelAcceptedOutcome | CancelRefusedOutcome;

export interface CancelRequest {
  accessKey: string;
  /** Justificativa exigida pela SEFAZ (mínimo 15 caracteres). */
  reason: string;
}

/**
 * Falha de INFRAESTRUTURA ao falar com o provedor/SEFAZ.
 *
 * `retryable` distingue o que adianta re-tentar (timeout, 5xx, SEFAZ fora do ar)
 * do que não adianta (credencial inválida, payload malformado). Quem chama usa
 * essa marca para decidir entre re-enfileirar ou parar — e, no caso do NexoLoja,
 * para decidir se cai em **contingência offline**.
 */
export class FiscalProviderError extends Error {
  readonly retryable: boolean;
  readonly providerCode?: string;

  constructor(message: string, options: { retryable: boolean; providerCode?: string }) {
    super(message);
    this.name = 'FiscalProviderError';
    this.retryable = options.retryable;
    this.providerCode = options.providerCode;
  }
}

/** Contrato que todo adaptador de provedor fiscal implementa. */
export interface FiscalProvider {
  /** Identificador curto do adaptador ("fake", "focus", "nuvemfiscal"…). */
  readonly name: string;
  /** Ambiente em que o adaptador está operando. */
  readonly environment: FiscalEnvironment;

  /** Transmite a nota. Lança `FiscalProviderError` só em falha de infra. */
  issue(request: IssueRequest): Promise<IssueOutcome>;

  /** Solicita o cancelamento de uma nota autorizada. */
  cancel(request: CancelRequest): Promise<CancelOutcome>;
}
