import { z } from 'zod';
import { onlyDigits } from './format';

/**
 * Regras de mídia da loja (logo) — ADR-007.
 * Constantes e validação PURA reusadas no cliente (feedback imediato) e no
 * servidor (fonte de verdade). O binário vai para o Cloudflare R2; o banco
 * guarda apenas a URL (CLAUDE.md: proibido BLOB/Base64).
 */

/** Formatos de imagem aceitos para a logo. */
export const LOGO_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type LogoContentType = (typeof LOGO_ALLOWED_TYPES)[number];

/** Tamanho máximo da logo: 1 MB. */
export const LOGO_MAX_BYTES = 1_048_576;

/** Extensão de arquivo por content-type aceito (para a chave/objeto no R2, se preciso). */
export const LOGO_EXTENSION: Record<LogoContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export type LogoValidation = { ok: true } | { ok: false; error: string };

/**
 * Valida tipo e tamanho da logo. Função pura `(entrada) => saída` — sem I/O.
 * @param contentType MIME informado (ex.: `file.type` no browser, header no Worker).
 * @param sizeBytes tamanho do arquivo em bytes.
 */
export function validateLogo(
  contentType: string | null | undefined,
  sizeBytes: number,
): LogoValidation {
  if (!contentType || !LOGO_ALLOWED_TYPES.includes(contentType as LogoContentType)) {
    return { ok: false, error: 'Formato inválido. Use PNG, JPG ou WebP.' };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: 'Arquivo vazio ou inválido.' };
  }
  if (sizeBytes > LOGO_MAX_BYTES) {
    return { ok: false, error: 'A imagem excede o limite de 1 MB.' };
  }
  return { ok: true };
}

/**
 * Payload para editar os dados cadastrais da loja (`PATCH /tenant`).
 * Nome é obrigatório; CNPJ e telefone são opcionais e guardados como SÓ dígitos
 * (forma canônica — a formatação é de apresentação, ver `formatCnpj`/`formatPhoneBr`).
 * Isso torna o índice único de `cnpj` robusto (independe de pontuação); vazio → `null`.
 * Limites em dígitos: CNPJ 14, telefone 11.
 */
export const updateTenantSchema = z.object({
  name: z.string().trim().min(1, 'O nome da loja é obrigatório.').max(120),
  cnpj: z
    .string()
    .nullish()
    .transform((v) => onlyDigits(v) || null)
    .refine((v) => v === null || v.length <= 14, { message: 'CNPJ inválido.' }),
  phone: z
    .string()
    .nullish()
    .transform((v) => onlyDigits(v) || null)
    .refine((v) => v === null || v.length <= 11, { message: 'Telefone inválido.' }),
  /**
   * Taxa da maquininha por modalidade, em PERCENTUAL (ADR-016). Ex.: 3.5 = 3,5%.
   * Serve só para exibir a **margem real** — nunca altera o preço cobrado do cliente (quem
   * altera preço é o acréscimo opt-in de cada produto). `null` = não cadastrada ⇒ a margem é
   * exibida como sempre foi. Teto de 100% porque acima disso a venda nunca fecharia.
   */
  cardFeeDebitPercent: z.number().min(0).max(100).nullish(),
  cardFeeCreditPercent: z.number().min(0).max(100).nullish(),
});
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

/**
 * Onboarding de loja pelo Super Usuário (ADR-009, Fatia B): cria a loja e convida o
 * primeiro Admin (papel `OWNER`) por e-mail. `slug` é opcional — quando ausente, a API
 * deriva do nome (`slugify`). CNPJ/telefone opcionais e canônicos (só dígitos). `redirectTo`
 * é para onde o link do convite leva (a página de definição de senha do app publicado).
 */
export const createTenantSchema = z.object({
  name: z.string().trim().min(1, 'O nome da loja é obrigatório.').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Identificador (slug) inválido: use letras, números e hífen.')
    .optional(),
  cnpj: z
    .string()
    .nullish()
    .transform((v) => onlyDigits(v) || null)
    .refine((v) => v === null || v.length <= 14, { message: 'CNPJ inválido.' }),
  phone: z
    .string()
    .nullish()
    .transform((v) => onlyDigits(v) || null)
    .refine((v) => v === null || v.length <= 11, { message: 'Telefone inválido.' }),
  adminEmail: z.string().trim().toLowerCase().email('E-mail do admin inválido.'),
  adminName: z.string().trim().min(1).max(100).optional(),
  redirectTo: z.string().url().optional(),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

/** Ativar/inativar uma loja pelo painel de plataforma (`PATCH /platform/tenants/:id`). */
export const setTenantActiveSchema = z.object({
  isActive: z.boolean(),
});
export type SetTenantActiveInput = z.infer<typeof setTenantActiveSchema>;
