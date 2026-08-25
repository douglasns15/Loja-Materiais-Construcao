/**
 * Tipos do domínio fiscal — NFC-e (modelo 65).
 *
 * Este arquivo descreve o CONTRATO do serviço, independente de provedor.
 * Nenhum tipo aqui menciona Focus NFe, Nuvem Fiscal ou PlugNotas: o provedor é
 * um detalhe substituível atrás da porta `FiscalProvider` (src/providers).
 *
 * Convenção de dinheiro: **tudo em CENTAVOS (inteiro)**, como no `packages/core`,
 * para eliminar o erro de ponto flutuante em somas de itens e impostos.
 */

/** Modelo do documento fiscal. Hoje só NFC-e; NF-e (55) entra numa fatia futura. */
export type FiscalModel = 'NFCE';

/** Ambiente da SEFAZ. Em homologação a nota NÃO tem valor fiscal. */
export type FiscalEnvironment = 'homologacao' | 'producao';

/**
 * Estados de um documento fiscal.
 *
 * - `PENDING`    criado localmente, ainda não transmitido.
 * - `AUTHORIZED` autorizado pela SEFAZ (tem chave de acesso + protocolo).
 * - `REJECTED`   rejeitado (erro de validação; a numeração pode ser reaproveitada).
 * - `DENIED`     denegado (irregularidade fiscal do emitente/destinatário; a
 *                numeração NÃO pode ser reaproveitada — estado terminal).
 * - `CANCELLED`  cancelado após autorização, dentro do prazo legal.
 * - `CONTINGENCY` emitido em contingência offline, aguardando transmissão.
 */
export type FiscalStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'REJECTED'
  | 'DENIED'
  | 'CANCELLED'
  | 'CONTINGENCY';

/** Tipo de documento do destinatário (consumidor). */
export type TaxpayerKind = 'CPF' | 'CNPJ';

/** Consumidor identificado na nota. Ausente = consumidor não identificado. */
export interface Consumer {
  kind: TaxpayerKind;
  /** Só dígitos (a validação é feita em `domain/taxpayer.ts`). */
  document: string;
  name?: string;
}

/**
 * Perfil fiscal do item — os códigos tributários que a SEFAZ exige.
 *
 * ⚠️ Estes valores NÃO são calculados por este serviço. Eles dependem do regime
 * tributário da loja (Simples Nacional × Regime Normal), da UF e da natureza da
 * operação, e devem ser definidos **com o contador do cliente** e cadastrados
 * por produto/loja. Aqui eles são apenas transportados e validados quanto ao
 * formato — nunca inferidos, porque um palpite errado gera nota rejeitada ou,
 * pior, imposto recolhido a menor.
 */
export interface ItemTaxProfile {
  /** Código Fiscal de Operações e Prestações (4 dígitos). Ex.: "5102". */
  cfop: string;
  /** NCM do produto (8 dígitos). */
  ncm: string;
  /** Origem da mercadoria (0–8, tabela da SEFAZ). */
  origin: number;
  /** CSOSN (Simples Nacional, 3 dígitos) OU CST de ICMS (2 dígitos). */
  csosnOrCst: string;
  /** Unidade comercial declarada na nota (ex.: "UN", "MT", "KG"). */
  unit: string;
}

/** Um item da nota. Valores em centavos. */
export interface FiscalItem {
  /** Código do produto na loja (`Product.sku`). */
  code: string;
  /** Código de barras (GTIN). Ausente ⇒ o provedor recebe "SEM GTIN". */
  ean?: string;
  description: string;
  /** Quantidade com até 4 casas — inteiro em MILÉSIMOS DE MILÉSIMO (×10.000). */
  quantityMilli: number;
  /** Preço unitário em centavos. */
  unitPriceCents: number;
  /** Desconto da linha em centavos (≥ 0). */
  discountCents: number;
  tax: ItemTaxProfile;
}

/** Forma de pagamento aceita pela NFC-e (tabela `tPag` simplificada). */
export type FiscalPaymentMethod = 'CASH' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'PIX' | 'STORE_CREDIT';

/** Uma parcela de pagamento declarada na nota. Valor em centavos. */
export interface FiscalPayment {
  method: FiscalPaymentMethod;
  amountCents: number;
}

/** Dados do emitente (a loja). Vêm do cadastro do tenant. */
export interface Issuer {
  /** CNPJ da loja, só dígitos. */
  cnpj: string;
  /** Código IBGE da UF (ex.: 35 = SP). */
  ufCode: number;
  /** Série da numeração fiscal (1–999). */
  series: number;
}

/**
 * Pedido de emissão. É o que a API de negócio envia a este serviço.
 *
 * `orderId` é a **chave de idempotência**: duas requisições com o mesmo
 * `(tenantId, orderId)` NUNCA podem gerar duas notas (ver `store/`).
 */
export interface IssueRequest {
  tenantId: string;
  /** Id da venda na aplicação (`Order.id`). Chave de idempotência. */
  orderId: string;
  model: FiscalModel;
  issuer: Issuer;
  /** Número sequencial da nota (nNF), controlado pela loja. */
  number: number;
  items: FiscalItem[];
  payments: FiscalPayment[];
  consumer?: Consumer;
  /** Desconto sobre o total, em centavos (além dos descontos por linha). */
  discountCents?: number;
  /** Frete em centavos. */
  freightCents?: number;
  /** Emitido em contingência offline (sem rede no momento da venda). */
  contingency?: boolean;
}

/** Documento fiscal como este serviço o persiste e devolve. */
export interface FiscalDocument {
  /** Id interno do documento neste serviço. */
  id: string;
  tenantId: string;
  orderId: string;
  model: FiscalModel;
  environment: FiscalEnvironment;
  status: FiscalStatus;
  number: number;
  series: number;
  /** Chave de acesso (44 dígitos) — presente quando autorizado. */
  accessKey?: string;
  /** Protocolo de autorização da SEFAZ. */
  protocol?: string;
  /** Total da nota em centavos (fonte: `calcDocumentTotals`). */
  totalCents: number;
  /** Código e motivo devolvidos pela SEFAZ em rejeição/denegação/cancelamento. */
  statusCode?: string;
  statusReason?: string;
  createdAt: string;
  authorizedAt?: string;
  cancelledAt?: string;
}
