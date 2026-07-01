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
});
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
