-- =====================================================================
-- 0004 — Telefone do usuário (perfil / "Meus dados")
-- Coluna opcional em `users` para o telefone pessoal do usuário. Guardada como
-- só dígitos (a formatação é de apresentação, igual ao Tenant). Sem alteração de
-- RLS: as políticas de linha da 0002 já cobrem a nova coluna.
-- =====================================================================

-- AlterTable
ALTER TABLE "users" ADD COLUMN "phone" VARCHAR(20);
