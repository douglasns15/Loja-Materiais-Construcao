-- =====================================================================
-- ROLLBACK da migration 0047 (RLS multi-loja, ADR-014 Fatia 3) — SÓ para emergência.
-- Restaura o hook de loja única e as políticas `= current_tenant_id()` (estado da 0046).
-- Rodar no SQL Editor do Supabase (ou psql com DIRECT_URL). Depois, marcar a 0047 como revertida:
--   npx prisma migrate resolve --rolled-back 0047_rls_multi_tenant --schema=packages/db/prisma/schema.prisma
-- Tokens já emitidos com `tenant_ids` continuam válidos: as políticas voltam a olhar só o `tenant_id`.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
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
$function$;

ALTER POLICY "audit_events_select_tenant" ON public.audit_events USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "cash_movements_select_tenant" ON public.cash_movements USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "cash_sessions_select_tenant" ON public.cash_sessions USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "categories_select_tenant" ON public.categories USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "customer_credits_select_tenant" ON public.customer_credits USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "customers_select_tenant" ON public.customers USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "debts_select_tenant" ON public.debts USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "deliveries_select_tenant" ON public.deliveries USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "delivery_accounts_select_tenant" ON public.delivery_accounts USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "employees_select_tenant" ON public.employees USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "nfe_import_items_select_tenant" ON public.nfe_import_items USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "order_item_deliveries_select_tenant" ON public.order_item_deliveries USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "order_return_items_select_tenant" ON public.order_return_items USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "order_returns_select_tenant" ON public.order_returns USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "orders_select_tenant" ON public.orders USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "payments_select_tenant" ON public.payments USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "production_lines_select_tenant" ON public.production_lines USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "productions_select_tenant" ON public.productions USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "products_select_tenant" ON public.products USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "quote_items_select_tenant" ON public.quote_items USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "quotes_select_tenant" ON public.quotes USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "receivable_payments_select_tenant" ON public.receivable_payments USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "receivables_select_tenant" ON public.receivables USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "recipe_items_select_tenant" ON public.recipe_items USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "recipes_select_tenant" ON public.recipes USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "stock_movements_select_tenant" ON public.stock_movements USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "suppliers_select_tenant" ON public.suppliers USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "tenant_modules_select_tenant" ON public.tenant_modules USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "users_select_tenant" ON public.users USING ("tenantId" = public.current_tenant_id());
ALTER POLICY "tenants_select_own" ON public.tenants USING (id = public.current_tenant_id());
ALTER POLICY "tenant_memberships_select_tenant_or_own" ON public.tenant_memberships
  USING ("tenantId" = public.current_tenant_id() OR "userId" = auth.uid());

DROP POLICY IF EXISTS "auth_admin_read_memberships" ON public.tenant_memberships;
REVOKE SELECT ON TABLE public.tenant_memberships FROM supabase_auth_admin;
DROP FUNCTION IF EXISTS public.current_tenant_ids();

COMMIT;
