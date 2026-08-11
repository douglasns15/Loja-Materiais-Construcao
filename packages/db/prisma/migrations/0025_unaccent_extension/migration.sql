-- =====================================================================
-- 0025 — Extensão `unaccent` (busca acento-insensível no servidor)
-- Habilita a busca de Produtos e Clientes a IGNORAR acento no servidor (ex.: digitar
-- "vergalhao" acha "Vergalhão"), espelhando o que a busca client-side (core) já faz. As rotas
-- `GET /products/search` e `GET /customers` passam a usar `extensions.unaccent()` por token.
--
-- 100% ADITIVA e reversível: cria SÓ uma extensão do Postgres (não altera nenhuma tabela, coluna,
-- índice, dado ou política de RLS). No Supabase as extensões moram no schema `extensions` (por isso
-- o `WITH SCHEMA extensions` — e as queries chamam `extensions.unaccent(...)` qualificado, sem
-- depender de search_path). `IF NOT EXISTS` torna a aplicação idempotente. Reverter: DROP EXTENSION.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
