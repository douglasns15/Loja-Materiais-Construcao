-- =====================================================================
-- 0049 — Usuário multi-loja, Fatia 5 (passo 2 de 2): `users` vira SÓ a identidade (ADR-014; aprovada pelo Owner
-- 2026-10-14). Pré-requisito cumprido: a API (590296e3) não lê nem grava mais `users.tenantId/role`; os vínculos
-- (`tenant_memberships`) são a única fonte de loja e papel (conferido: 10/10 iguais antes da 0048).
--   1. Hook do login: só `tenant_ids` (+ `is_platform_admin`). Saem `tenant_id`/`user_role` (loja única legada).
--   2. `current_tenant_ids()` lê só a lista; a antiga `current_tenant_id()` é removida (nenhuma política a usa).
--   3. Sai o gatilho de espelho `users → vínculo de casa` (0046).
--   4. Saem `users.tenantId` (+ FK e o único (tenantId, email)) e `users.role`; e-mail passa a ser ÚNICO.
-- IRREVERSÍVEL nos dados das colunas (cópia dos vínculos). Volta: packages/db/scripts/rollback-0049.sql (recria e
-- preenche pelo vínculo mais antigo de cada pessoa). Torna obsoleto o rollback-0047.sql.
-- =====================================================================

-- 1. Hook — não lê mais `users`.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  claims jsonb;
  v_is_platform boolean;
  v_tenant_ids jsonb;
begin
  claims := coalesce(event->'claims', '{}'::jsonb);

  -- Lojas com vínculo aceito e ativo (ADR-014). Falha aqui é engolida de propósito: o token sai sem a lista
  -- (RLS = nenhuma loja), mas o login NUNCA quebra.
  begin
    select coalesce(jsonb_agg(m."tenantId"::text order by m."createdAt"), '[]'::jsonb)
      into v_tenant_ids
    from public.tenant_memberships m
    where m."userId" = (event->>'user_id')::uuid
      and m.status = 'ACTIVE'
      and m."isActive";
    claims := jsonb_set(claims, '{tenant_ids}', v_tenant_ids);
  exception when others then
    null;
  end;

  select exists(
    select 1 from public.platform_admins pa
    where pa.id = (event->>'user_id')::uuid and pa."isActive"
  ) into v_is_platform;
  if v_is_platform then
    claims := jsonb_set(claims, '{is_platform_admin}', 'true'::jsonb);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$function$;

-- 2. Lojas do token: só a lista.
CREATE OR REPLACE FUNCTION public.current_tenant_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    (select array_agg(x::uuid) from jsonb_array_elements_text(auth.jwt() -> 'tenant_ids') as x),
    '{}'::uuid[]
  );
$function$;
DROP FUNCTION public.current_tenant_id();

-- 3. Sem espelho.
DROP TRIGGER users_sync_home_membership ON public.users;
DROP FUNCTION public.sync_home_membership();

-- 4. `users` = identidade. (Gerado pelo `prisma migrate diff`.)
-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_tenantId_fkey";

-- DropIndex
DROP INDEX "users_tenantId_email_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "role",
DROP COLUMN "tenantId";

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
