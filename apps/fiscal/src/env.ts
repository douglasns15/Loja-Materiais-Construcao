/** Bindings e contexto do Worker fiscal. */

import type { FiscalEnvironment } from './domain/types';

export type Bindings = {
  /** Adaptador ativo: "fake" | "focus" | "nuvemfiscal" | "plugnotas". */
  FISCAL_PROVIDER?: string;
  /** "homologacao" | "producao". */
  FISCAL_ENVIRONMENT?: string;
  /**
   * Segredo compartilhado que autentica a API de negócio chamando este serviço.
   * Ausente ⇒ o serviço recusa toda requisição (falha fechada, não aberta).
   */
  FISCAL_SERVICE_TOKEN?: string;
  /** Credencial do provedor fiscal real (quando houver). */
  FISCAL_PROVIDER_TOKEN?: string;
};

export type Env = { Bindings: Bindings };

/** Lê o ambiente fiscal, com `homologacao` como padrão seguro. */
export function readEnvironment(bindings: Bindings): FiscalEnvironment {
  return bindings.FISCAL_ENVIRONMENT === 'producao' ? 'producao' : 'homologacao';
}
