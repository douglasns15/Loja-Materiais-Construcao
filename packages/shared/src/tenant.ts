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
