-- =====================================================================
-- 0047 — Usuário multi-loja, Fatia 3: RLS com N lojas (ADR-014, opção RLS-B; aprovada pelo Owner 2026-10-14)
--   1. Hook do login (`custom_access_token_hook`) grava também `tenant_ids` = lojas com vínculo ACTIVE + isActive.
--      Mantém `tenant_id`/`user_role` (loja "de casa") até a Fatia 5. Leitura dos vínculos protegida por bloco de
--      exceção: se falhar, o token sai como antes (só `tenant_id`) — o login NUNCA quebra por causa da lista.
--   2. `current_tenant_ids()` → uuid[]: lista do token; token sem a lista (emitido antes desta migration) usa a
--      loja única `tenant_id` — ninguém perde acesso na transição.
--   3. As políticas de leitura por loja trocam `= current_tenant_id()` por `= ANY(current_tenant_ids())` (ALTER
--      POLICY, nomeadas, uma a uma — nenhuma tabela fica sem política no meio do caminho).
-- A API segue impondo a LOJA ATIVA única (header x-active-tenant); o RLS passa a ser "as lojas da pessoa".
-- Convenção para tabelas novas: USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[])).
-- Reversível: packages/db/scripts/rollback-0047.sql (restaura o hook e as políticas de loja única).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Hook: o Supabase Auth (role supabase_auth_admin) passa a ler os vínculos.
-- ---------------------------------------------------------------------
GRANT SELECT ON TABLE public.tenant_memberships TO supabase_auth_admin;
CREATE POLICY "auth_admin_read_memberships" ON public.tenant_memberships
  FOR SELECT TO supabase_auth_admin USING (true);

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
  v_tenant_ids jsonb;
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

  -- Multi-loja (ADR-014 Fatia 3): todas as lojas com vínculo aceito e ativo. Qualquer falha aqui é engolida
  -- de propósito: o token sai sem `tenant_ids` e o `current_tenant_ids()` cai na loja única (`tenant_id`).
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

  if v_is_platform then
    claims := jsonb_set(claims, '{is_platform_admin}', 'true'::jsonb);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$function$;

-- ---------------------------------------------------------------------
-- 2. Lojas do token.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_tenant_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
AS $function$
  select case
    when jsonb_typeof(auth.jwt() -> 'tenant_ids') = 'array' then
      coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(auth.jwt() -> 'tenant_ids') as x), '{}'::uuid[])
    else
      array_remove(array[public.current_tenant_id()], null)
  end;
$function$;

-- ---------------------------------------------------------------------
-- 3. Políticas de leitura por loja: "uma das lojas do token". `(SELECT …)` faz o Postgres calcular a lista UMA vez
--    por consulta (initPlan), não por linha.
-- ---------------------------------------------------------------------
ALTER POLICY "audit_events_select_tenant" ON public.audit_events USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "cash_movements_select_tenant" ON public.cash_movements USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "cash_sessions_select_tenant" ON public.cash_sessions USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "categories_select_tenant" ON public.categories USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "customer_credits_select_tenant" ON public.customer_credits USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "customers_select_tenant" ON public.customers USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "debts_select_tenant" ON public.debts USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "deliveries_select_tenant" ON public.deliveries USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "delivery_accounts_select_tenant" ON public.delivery_accounts USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "employees_select_tenant" ON public.employees USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "nfe_import_items_select_tenant" ON public.nfe_import_items USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "order_item_deliveries_select_tenant" ON public.order_item_deliveries USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "order_return_items_select_tenant" ON public.order_return_items USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "order_returns_select_tenant" ON public.order_returns USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "orders_select_tenant" ON public.orders USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "payments_select_tenant" ON public.payments USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "production_lines_select_tenant" ON public.production_lines USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "productions_select_tenant" ON public.productions USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "products_select_tenant" ON public.products USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "quote_items_select_tenant" ON public.quote_items USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "quotes_select_tenant" ON public.quotes USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "receivable_payments_select_tenant" ON public.receivable_payments USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "receivables_select_tenant" ON public.receivables USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "recipe_items_select_tenant" ON public.recipe_items USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "recipes_select_tenant" ON public.recipes USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "stock_movements_select_tenant" ON public.stock_movements USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "suppliers_select_tenant" ON public.suppliers USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "tenant_modules_select_tenant" ON public.tenant_modules USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "users_select_tenant" ON public.users USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "tenants_select_own" ON public.tenants USING (id = ANY ((SELECT public.current_tenant_ids())::uuid[]));
ALTER POLICY "tenant_memberships_select_tenant_or_own" ON public.tenant_memberships
  USING ("tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[]) OR "userId" = auth.uid());
