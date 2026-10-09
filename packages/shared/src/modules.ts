import { z } from 'zod';
import { unitTypeLabels, type UnitType } from './product';

/**
 * Módulos ativáveis por loja (`TenantModule`) — ADR-011.
 *
 * O primeiro flag é `OFFLINE_SALES`: habilita a fila de sincronização offline de vendas
 * (Outbox → sync). Reusa a tabela `TenantModule` que já existe (sem migration): a chave é
 * `moduleKey` e o liga/desliga é `isActive`.
 *
 * Regra do gate (ADR-011 §9): **ausência da linha OU `isActive = false` = OFF**. O default é
 * desligado de graça — uma loja só tem offline se o Super Usuário criar/ligar a linha. Offline
 * nasce como recurso de **plano pago** (fronteira comercial + botão de pânico para rollout).
 */

/** Chave do módulo de vendas offline (ADR-011). */
export const MODULE_OFFLINE_SALES = 'OFFLINE_SALES' as const;
/** Unidades de obra, corte por metro, par e peso p/ frete (ADR-039) — ligado pelo ramo Construção. */
export const MODULE_CONSTRUCTION_UNITS = 'CONSTRUCTION_UNITS' as const;
/** Etiqueta de balança: código na balança + leitura no PDV (ADR-039/040) — ramos de alimentos. */
export const MODULE_SCALE_LABEL = 'SCALE_LABEL' as const;
/** Produção com ficha técnica: do cru ao pronto (ADR-043) — ligado pelo ramo Rotisseria. */
export const MODULE_RECIPES = 'RECIPES' as const;

/** Módulos que o Super Usuário liga/desliga no painel (ordem de exibição). */
export const TENANT_MODULE_KEYS = [
  MODULE_CONSTRUCTION_UNITS,
  MODULE_SCALE_LABEL,
  MODULE_RECIPES,
  MODULE_OFFLINE_SALES,
] as const;
export type TenantModuleKey = (typeof TENANT_MODULE_KEYS)[number];

/** Rótulos PT-BR dos módulos para o painel de plataforma. */
export const TENANT_MODULE_LABELS: Record<TenantModuleKey, { label: string; hint: string }> = {
  CONSTRUCTION_UNITS: {
    label: 'Unidades de obra',
    hint: 'Milheiro, saco, barra, rolo, m/m²/m³, corte por metro, par e peso p/ frete',
  },
  SCALE_LABEL: { label: 'Etiqueta de balança', hint: 'Código na balança e leitura da etiqueta no PDV' },
  RECIPES: { label: 'Produção (ficha técnica)', hint: 'Do cru ao pronto: ficha técnica, produção e custo real' },
  OFFLINE_SALES: { label: 'Venda offline (pago)', hint: 'Fila de vendas sem internet (ADR-011)' },
};

/**
 * Ramo da loja (ADR-039) — espelha o enum `StoreSegment` do schema. Multisseleção: a mesma porta
 * pode ser Mercadinho + Sorveteria + Rotisseria. É PRESET (liga módulos e sugere categorias na
 * criação); quem liga/desliga recurso na tela é o módulo.
 */
export const storeSegmentSchema = z.enum(['CONSTRUCTION', 'GROCERY', 'ICE_CREAM', 'ROTISSERIE', 'GENERAL_RETAIL']);
export type StoreSegment = z.infer<typeof storeSegmentSchema>;

/** Rótulos PT-BR dos ramos (chips do painel). A ordem espelha o enum. */
export const STORE_SEGMENT_LABELS: Record<StoreSegment, string> = {
  CONSTRUCTION: 'Material de construção',
  GROCERY: 'Mercadinho',
  ICE_CREAM: 'Sorveteria',
  ROTISSERIE: 'Rotisseria',
  GENERAL_RETAIL: 'Varejo geral',
};

/**
 * Unidades de venda que pertencem ao módulo `CONSTRUCTION_UNITS` (ADR-039 §2): milheiro, saco,
 * barra, rolo e m/m²/m³. Ficam no core (sempre visíveis): unidade, kg, litro e pacote (ADR-030 —
 * o fardo do mercadinho).
 */
export const CONSTRUCTION_UNIT_TYPES: readonly UnitType[] = [
  'METER',
  'SQUARE_METER',
  'CUBIC_METER',
  'THOUSAND',
  'BAG',
  'ROLL',
  'BARRA',
];

/**
 * Gate de UI de um módulo (ADR-039 §3 — gating é de APRESENTAÇÃO, não de dado). `modules` é a
 * lista do `GET /me`; `null/undefined` = resposta antiga da API ou sem cache ainda ⇒ cai no
 * comportamento de sempre: as lojas antigas são todas de construção, então `CONSTRUCTION_UNITS`
 * fica LIGADO e os demais desligados (nunca some recurso por engano numa loja existente).
 */
export function moduleEnabled(modules: readonly string[] | null | undefined, key: TenantModuleKey): boolean {
  if (!modules) return key === MODULE_CONSTRUCTION_UNITS;
  return modules.includes(key);
}

/**
 * Opções do seletor de unidade (cadastro, detalhe, importação de NF-e). Sem o módulo de obra, só
 * as unidades do core. `keep` preserva a unidade JÁ gravada no produto mesmo com o módulo
 * desligado — desligar módulo nunca impede de ver/editar o que existe (ADR-039 §3). A ordem
 * segue a do enum.
 */
export function visibleUnitTypes(
  constructionOn: boolean,
  keep: ReadonlyArray<string | null | undefined> = [],
): UnitType[] {
  const all = Object.keys(unitTypeLabels) as UnitType[];
  if (constructionOn) return all;
  return all.filter((u) => !CONSTRUCTION_UNIT_TYPES.includes(u) || keep.includes(u));
}

/** Chaves dos módulos ATIVOS da loja — o que o `GET /me` devolve para a web gatear telas. */
export function activeModuleKeys(modules: readonly TenantModuleFlag[] | null | undefined): string[] {
  return (modules ?? []).filter((m) => m.isActive === true).map((m) => m.moduleKey);
}

/** Formato mínimo de um módulo de loja para avaliar o gate (subconjunto de `TenantModule`). */
export type TenantModuleFlag = { moduleKey: string; isActive: boolean };

/**
 * Avalia se a venda offline está LIGADA para a loja. Função pura `(entrada) => saída` — sem I/O.
 * ON somente quando existe a linha `OFFLINE_SALES` **e** ela está `isActive`. Ausência = OFF.
 */
export function isOfflineSalesOn(modules: readonly TenantModuleFlag[] | null | undefined): boolean {
  if (!modules) return false;
  return modules.some((m) => m.moduleKey === MODULE_OFFLINE_SALES && m.isActive === true);
}

/**
 * Payload para ligar/desligar um módulo de loja pelo painel de plataforma
 * (`PATCH /platform/tenants/:id/modules`). Aceita só as chaves conhecidas (`TENANT_MODULE_KEYS`:
 * offline + os módulos de ramo do ADR-039) — chave nova entra aqui, sem afrouxar a validação.
 */
/**
 * Layout da etiqueta de balança da loja (ADR-040 §3), guardado em `TenantModule.config` do
 * `SCALE_LABEL` (sem migration): dígitos do PLU (4/5/6), dígitos do valor (5/6), se há dígito
 * verificador do valor e se o valor embutido é preço ou peso. Configs antigas (só `pluDigits` +
 * `value`) seguem válidas: `valueDigits` = 6 e `valueCheckDigit` = false por padrão — o mesmo
 * comportamento de antes. A combinação precisa caber em 13 dígitos (espelha `scaleLayoutFits`, core).
 */
export const scaleLabelLayoutSchema = z
  .object({
    pluDigits: z.union([z.literal(4), z.literal(5), z.literal(6)]),
    valueDigits: z.union([z.literal(5), z.literal(6)]).default(6),
    valueCheckDigit: z.boolean().default(false),
    value: z.enum(['PRICE', 'WEIGHT']),
  })
  .refine((l) => 1 + l.pluDigits + l.valueDigits + (l.valueCheckDigit ? 1 : 0) + 1 <= 13, {
    message: 'Esse formato não cabe nos 13 dígitos da etiqueta.',
  });
export type ScaleLabelLayoutInput = z.infer<typeof scaleLabelLayoutSchema>;

/**
 * Layout padrão (loja que ainda não configurou): "2 CCCC 0 VVVVVV D" — PLU de 4 dígitos, valor de 6,
 * preço — recomendação do ADR-040 §3.
 */
export const DEFAULT_SCALE_LABEL_LAYOUT_INPUT: ScaleLabelLayoutInput = {
  pluDigits: 4,
  valueDigits: 6,
  valueCheckDigit: false,
  value: 'PRICE',
};

/** Lê o `config` do módulo `SCALE_LABEL`; ausente/malformado ⇒ o layout padrão. */
export function parseScaleLabelLayout(config: unknown): ScaleLabelLayoutInput {
  const parsed = scaleLabelLayoutSchema.safeParse(config);
  return parsed.success ? parsed.data : DEFAULT_SCALE_LABEL_LAYOUT_INPUT;
}

/** Rótulos PT-BR do layout para o painel. */
export const SCALE_LABEL_VALUE_LABELS: Record<ScaleLabelLayoutInput['value'], string> = {
  PRICE: 'Preço total',
  WEIGHT: 'Peso (gramas)',
};

export const setTenantModuleSchema = z
  .object({
    moduleKey: z.enum(TENANT_MODULE_KEYS),
    isActive: z.boolean(),
    /** Só para `SCALE_LABEL`: grava o layout da etiqueta. Ausente = não mexe no que já está gravado. */
    config: scaleLabelLayoutSchema.optional(),
  })
  .refine((v) => v.config === undefined || v.moduleKey === MODULE_SCALE_LABEL, {
    message: 'Só o módulo de etiqueta de balança tem configuração.',
    path: ['config'],
  });
export type SetTenantModuleInput = z.infer<typeof setTenantModuleSchema>;
