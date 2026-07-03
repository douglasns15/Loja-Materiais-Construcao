import type { Bindings } from './request';

/**
 * Convida (ou reaproveita) um usuário no Supabase Auth via `inviteUserByEmail`
 * (`POST /auth/v1/invite`) usando a `service_role`. Envia o e-mail com o link de convite
 * e devolve o `id` (= `auth.users.id`). Se o e-mail já existir no Auth, recupera o `id`
 * pela API admin. Compartilhado entre o convite de usuário de loja (ADR-008, `users.ts`) e
 * o onboarding de loja pelo Super Usuário (ADR-009, `platform.ts`).
 *
 * Exige `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente (o chamador valida antes).
 */
export async function inviteAuthUser(
  env: Bindings,
  email: string,
  redirectTo?: string,
  data?: Record<string, unknown>,
): Promise<string> {
  const supabaseUrl = env.SUPABASE_URL!;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    'Content-Type': 'application/json',
  };

  const inviteUrl = new URL(`${supabaseUrl}/auth/v1/invite`);
  if (redirectTo) inviteUrl.searchParams.set('redirect_to', redirectTo);
  const res = await fetch(inviteUrl, {
    method: 'POST',
    headers,
    // `data` vira user_metadata e fica disponível no template do e-mail como
    // `{{ .Data.store_name }}` — usado para personalizar o convite.
    body: JSON.stringify({ email, ...(data ? { data } : {}) }),
  });
  if (res.ok) {
    const created = (await res.json()) as { id: string };
    return created.id;
  }

  // Já registrado no Auth: recupera o id para vincular à loja.
  const errText = await res.text();
  if (res.status === 422 || /registered|exists/i.test(errText)) {
    const list = await fetch(`${supabaseUrl}/auth/v1/admin/users`, { headers });
    const { users: authUsers = [] } = (await list.json()) as {
      users?: Array<{ id: string; email?: string }>;
    };
    const found = authUsers.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
  }
  throw new Error(`Supabase invite falhou (${res.status}): ${errText}`);
}

/**
 * Remove a identidade de login no Supabase Auth (`DELETE /auth/v1/admin/users/{id}`) via
 * `service_role`. É o que efetivamente **libera o e-mail** para um convite novo — apagar só a
 * linha em `users` corta o acesso, mas o e-mail continua "registrado" no Auth (e um re-convite
 * não reenviaria o e-mail). Usado na exclusão de usuário de loja (ADR-008). Best-effort: o
 * chamador decide se um erro aqui invalida a operação (a exclusão da linha em `users` é a parte
 * crítica/transacional). Devolve `true` se a identidade foi removida (ou já não existia).
 */
export async function deleteAuthUser(env: Bindings, id: string): Promise<boolean> {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return false;

  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    },
  });
  // 404 = já não existe no Auth: para o nosso objetivo (e-mail livre), é sucesso.
  return res.ok || res.status === 404;
}
