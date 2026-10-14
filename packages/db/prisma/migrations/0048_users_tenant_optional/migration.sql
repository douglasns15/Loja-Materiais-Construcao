-- =====================================================================
-- 0048 — Usuário multi-loja, Fatia 5 (passo 1 de 2): `users` deixa de exigir loja/papel (ADR-014; aprovada pelo
-- Owner 2026-10-14). Só AFROUXA — o código em produção segue funcionando; o passo 2 (0049) remove as colunas depois
-- que a API parar de ler/gravar `users.tenantId/role`.
--   1. `users.tenantId` e `users.role` aceitam NULL (e `role` perde o default).
--   2. Gatilho de espelho: usuário sem loja/papel na tabela antiga é ignorado (o vínculo é criado pela API).
--   3. RLS de `users`: "eu mesmo + pessoas com vínculo ACEITO em uma das minhas lojas" (antes: `users.tenantId`).
--      Convite PENDENTE não conta — os dados de quem ainda não aceitou não ficam visíveis (privacidade, Fatia 4).
-- Reversível: SET NOT NULL de volta (dados intactos) + função/política anteriores (0046/0047).
-- =====================================================================

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "tenantId" DROP NOT NULL,
ALTER COLUMN "role" DROP NOT NULL,
ALTER COLUMN "role" DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.sync_home_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Fatia 5: a API cria o vínculo explicitamente e não grava mais loja/papel em `users`.
  IF NEW."tenantId" IS NULL OR NEW."role" IS NULL THEN
    RETURN NEW;
  END IF;
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

ALTER POLICY "users_select_tenant" ON public.users
  USING (
    "id" = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tenant_memberships m
      WHERE m."userId" = users."id"
        AND m.status = 'ACTIVE'
        AND m."tenantId" = ANY ((SELECT public.current_tenant_ids())::uuid[])
    )
  );
