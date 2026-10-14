-- =====================================================================
-- 0046 — Usuário multi-loja, Fatia 1: vínculo usuário↔loja (ADR-014, aprovada pelo Owner 2026-10-14)
--   * enum MembershipStatus (ACTIVE | PENDING) + tabela tenant_memberships (papel POR loja).
--   * Backfill: 1 vínculo ACTIVE por usuário atual, copiando users.tenantId/role/isActive.
--   * RLS: leitura pela loja do token OU os próprios vínculos da pessoa.
--   * Gatilho de espelho (dual-source temporário): enquanto users.tenantId/role existirem, criar usuário ou
--     mudar loja/papel/ativo em `users` atualiza o vínculo "de casa" — nenhum caminho de escrita (API ou
--     scripts) fica dessincronizado. Removido na Fatia 5, junto com essas colunas.
-- Aditiva: nada existente muda; o app segue lendo `users` (sem mudança de comportamento).
-- Reversível: DROP TRIGGER users_sync_home_membership ON users; DROP FUNCTION public.sync_home_membership();
--             DROP TABLE tenant_memberships; DROP TYPE "MembershipStatus".
-- =====================================================================

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'PENDING');

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "invitedByName" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_memberships_tenantId_idx" ON "tenant_memberships"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_userId_tenantId_key" ON "tenant_memberships"("userId", "tenantId");

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Backfill: o vínculo "de casa" de cada usuário existente (mesma loja, papel e situação de hoje).
-- ---------------------------------------------------------------------
INSERT INTO "tenant_memberships" ("id", "userId", "tenantId", "role", "status", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."id", u."tenantId", u."role", 'ACTIVE', u."isActive", u."createdAt", now()
FROM "users" u
ON CONFLICT ("userId", "tenantId") DO NOTHING;

-- ---------------------------------------------------------------------
-- RLS (padrão ADR-003). A pessoa enxerga os vínculos da loja do token e os PRÓPRIOS (lista de lojas dela).
-- Escrita só pela API (role do banco, que ignora RLS) — sem políticas de escrita para `authenticated`.
-- ---------------------------------------------------------------------
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_memberships_select_tenant_or_own" ON public.tenant_memberships
  FOR SELECT TO authenticated
  USING ("tenantId" = public.current_tenant_id() OR "userId" = auth.uid());

-- ---------------------------------------------------------------------
-- Gatilho de espelho users → vínculo "de casa" (dual-source até a Fatia 5).
-- Dispara SÓ ao criar usuário ou ao gravar tenantId/role/isActive (não em nome/telefone, venda, caixa…).
-- Mudou de loja "de casa" (script de mover usuário) ⇒ o vínculo antigo sai e o novo entra.
-- Exclusão do usuário não precisa de gatilho: o FK com ON DELETE CASCADE apaga os vínculos.
-- Na mesma transação da gravação: se falhar, a gravação inteira é desfeita (nunca diverge).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_home_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."tenantId" IS DISTINCT FROM OLD."tenantId" THEN
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
