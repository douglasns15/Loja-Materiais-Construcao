-- =====================================================================
-- ROLLBACK da migration 0049 (Fatia 5 do multi-loja, ADR-014) — SÓ para emergência.
-- Recria `users.tenantId`/`role` preenchendo pela LOJA DO VÍNCULO MAIS ANTIGO de cada pessoa (= a loja "de casa" de
-- antes da Fatia 5), o FK, o único (tenantId, email), o gatilho de espelho, `current_tenant_id()` e o hook com
-- `tenant_id`/`user_role`. Volta ao estado da 0048 (colunas opcionais). O código da API NÃO precisa dessas colunas.
-- Rodar no SQL Editor do Supabase; depois:
--   npx prisma migrate resolve --rolled-back 0049_users_identity_only --schema=packages/db/prisma/schema.prisma
-- e restaurar o schema.prisma da 0048 (git).
-- =====================================================================
BEGIN;

DROP INDEX IF EXISTS "users_email_key";
ALTER TABLE "users" ADD COLUMN "tenantId" UUID, ADD COLUMN "role" "UserRole";
UPDATE "users" u SET "tenantId" = m."tenantId", "role" = m.role
FROM (
  SELECT DISTINCT ON ("userId") "userId", "tenantId", role
  FROM tenant_memberships ORDER BY "userId", "createdAt"
) m
WHERE m."userId" = u.id;
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid LANGUAGE sql STABLE
AS $function$ select nullif(auth.jwt() ->> 'tenant_id', '')::uuid; $function$;

CREATE OR REPLACE FUNCTION public.current_tenant_ids()
 RETURNS uuid[] LANGUAGE sql STABLE
AS $function$
  select case
    when jsonb_typeof(auth.jwt() -> 'tenant_ids') = 'array' then
      coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(auth.jwt() -> 'tenant_ids') as x), '{}'::uuid[])
    else array_remove(array[public.current_tenant_id()], null)
  end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_home_membership()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW."tenantId" IS NULL OR NEW."role" IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW."tenantId" IS DISTINCT FROM OLD."tenantId" AND OLD."tenantId" IS NOT NULL THEN
    DELETE FROM public.tenant_memberships WHERE "userId" = OLD."id" AND "tenantId" = OLD."tenantId";
  END IF;
  INSERT INTO public.tenant_memberships ("id", "userId", "tenantId", "role", "status", "isActive", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), NEW."id", NEW."tenantId", NEW."role", 'ACTIVE', NEW."isActive", now(), now())
  ON CONFLICT ("userId", "tenantId") DO UPDATE
    SET "role" = EXCLUDED."role", "isActive" = EXCLUDED."isActive", "status" = 'ACTIVE', "updatedAt" = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_sync_home_membership
  AFTER INSERT OR UPDATE OF "tenantId", "role", "isActive" ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_home_membership();

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE
AS $function$
declare
  claims jsonb; v_tenant_id uuid; v_role text; v_is_platform boolean; v_tenant_ids jsonb;
begin
  select u."tenantId", u.role::text into v_tenant_id, v_role from public.users u where u.id = (event->>'user_id')::uuid;
  select exists(select 1 from public.platform_admins pa where pa.id = (event->>'user_id')::uuid and pa."isActive") into v_is_platform;
  claims := coalesce(event->'claims', '{}'::jsonb);
  if v_tenant_id is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant_id::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  end if;
  begin
    select coalesce(jsonb_agg(m."tenantId"::text order by m."createdAt"), '[]'::jsonb) into v_tenant_ids
    from public.tenant_memberships m where m."userId" = (event->>'user_id')::uuid and m.status = 'ACTIVE' and m."isActive";
    claims := jsonb_set(claims, '{tenant_ids}', v_tenant_ids);
  exception when others then null;
  end;
  if v_is_platform then claims := jsonb_set(claims, '{is_platform_admin}', 'true'::jsonb); end if;
  return jsonb_set(event, '{claims}', claims);
end;
$function$;

COMMIT;
