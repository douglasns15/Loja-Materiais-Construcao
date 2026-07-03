-- =====================================================================
-- 0005 — Identidade de plataforma (Super Usuário / fabricante), ADR-009
-- ---------------------------------------------------------------------
-- Tabela cross-tenant `platform_admins`: marca contas da equipe do fabricante,
-- ACIMA de qualquer loja. NÃO tem `tenantId`/FK (é cross-tenant). O acesso a
-- várias lojas é feito por rotas `/platform/*` dedicadas (API dona do banco),
-- NUNCA relaxando o RLS das tabelas de loja. Migration ADITIVA: não altera
-- nenhuma tabela existente.
-- =====================================================================

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- =====================================================================
-- RLS — nega acesso direto do cliente (só a API-dono lê). O access token
-- hook roda como `supabase_auth_admin` e precisa ler para injetar o claim,
-- então recebe uma política de SELECT dedicada (mesmo padrão de `users` na 0002).
-- =====================================================================
ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_admin_read_platform_admins" ON "platform_admins"
  AS PERMISSIVE FOR SELECT TO supabase_auth_admin USING (true);

GRANT SELECT ON TABLE "platform_admins" TO supabase_auth_admin;

-- =====================================================================
-- Estende o Custom Access Token Hook (0002): além de `tenant_id`/`user_role`,
-- injeta `is_platform_admin: true` quando o usuário estiver em `platform_admins`
-- e ativo. Mantém 100% do comportamento anterior para usuários de loja.
-- =====================================================================
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  v_tenant_id uuid;
  v_role text;
  v_is_platform boolean;
begin
  select u."tenantId", u.role::text
    into v_tenant_id, v_role
  from public.users u
  where u.id = (event->>'user_id')::uuid;

  select exists(
    select 1 from public.platform_admins pa
    where pa.id = (event->>'user_id')::uuid and pa."isActive"
  ) into v_is_platform;

  claims := coalesce(event->'claims', '{}'::jsonb);

  if v_tenant_id is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant_id::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  end if;

  if v_is_platform then
    claims := jsonb_set(claims, '{is_platform_admin}', 'true'::jsonb);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Reafirma as permissões do hook (idempotente com a 0002).
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
