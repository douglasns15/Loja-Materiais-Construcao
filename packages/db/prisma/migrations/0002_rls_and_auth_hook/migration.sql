-- =====================================================================
-- Etapa B — Custom Access Token Hook
-- Injeta `tenant_id` e `user_role` no JWT, lendo da tabela `users`.
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
begin
  select u."tenantId", u.role::text
    into v_tenant_id, v_role
  from public.users u
  where u.id = (event->>'user_id')::uuid;

  claims := coalesce(event->'claims', '{}'::jsonb);

  if v_tenant_id is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant_id::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- O hook roda como supabase_auth_admin.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on table public.users to supabase_auth_admin;

-- =====================================================================
-- Etapa C — RLS (isolamento por tenant para o acesso direto via supabase-js)
-- A API (papel `postgres`, dono das tabelas) ignora RLS e continua isolando
-- por `tenantId` no código. Escritas diretas pelo cliente ficam bloqueadas
-- (sem política de insert/update/delete) — toda escrita passa pela API.
-- =====================================================================

-- tenant do JWT atual
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid;
$$;

-- users: o hook (supabase_auth_admin) precisa ler; usuário vê o próprio tenant
alter table public.users enable row level security;
create policy "auth_admin_read_users" on public.users
  as permissive for select to supabase_auth_admin using (true);
create policy "users_select_tenant" on public.users
  for select to authenticated using ("tenantId" = public.current_tenant_id());

-- tenants: usuário vê apenas a própria loja
alter table public.tenants enable row level security;
create policy "tenants_select_own" on public.tenants
  for select to authenticated using (id = public.current_tenant_id());

-- demais tabelas com coluna tenantId: SELECT restrito ao tenant do JWT
alter table public.tenant_modules enable row level security;
create policy "tenant_modules_select_tenant" on public.tenant_modules
  for select to authenticated using ("tenantId" = public.current_tenant_id());

alter table public.categories enable row level security;
create policy "categories_select_tenant" on public.categories
  for select to authenticated using ("tenantId" = public.current_tenant_id());

alter table public.products enable row level security;
create policy "products_select_tenant" on public.products
  for select to authenticated using ("tenantId" = public.current_tenant_id());

alter table public.customers enable row level security;
create policy "customers_select_tenant" on public.customers
  for select to authenticated using ("tenantId" = public.current_tenant_id());

alter table public.suppliers enable row level security;
create policy "suppliers_select_tenant" on public.suppliers
  for select to authenticated using ("tenantId" = public.current_tenant_id());

alter table public.cash_sessions enable row level security;
create policy "cash_sessions_select_tenant" on public.cash_sessions
  for select to authenticated using ("tenantId" = public.current_tenant_id());

alter table public.orders enable row level security;
create policy "orders_select_tenant" on public.orders
  for select to authenticated using ("tenantId" = public.current_tenant_id());

alter table public.payments enable row level security;
create policy "payments_select_tenant" on public.payments
  for select to authenticated using ("tenantId" = public.current_tenant_id());

alter table public.deliveries enable row level security;
create policy "deliveries_select_tenant" on public.deliveries
  for select to authenticated using ("tenantId" = public.current_tenant_id());

alter table public.stock_movements enable row level security;
create policy "stock_movements_select_tenant" on public.stock_movements
  for select to authenticated using ("tenantId" = public.current_tenant_id());

alter table public.audit_events enable row level security;
create policy "audit_events_select_tenant" on public.audit_events
  for select to authenticated using ("tenantId" = public.current_tenant_id());

-- order_items não tem tenantId (liga via order). RLS habilitado sem política:
-- leitura direta pelo cliente bloqueada por ora (passa pela API).
alter table public.order_items enable row level security;
