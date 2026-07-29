-- =====================================================================
-- 0016 — Cesta persistente sincronizada (ADR-021)
-- Adiciona a tabela `carts`: o carrinho-rascunho do PDV, uma linha por
-- usuário (PK = userId), com os itens em JSONB. Aditiva: não altera nenhuma
-- tabela existente. A cesta é rascunho — o motor de venda/estoque (ADR-001)
-- não muda; preço/estoque são revalidados no POST /orders na hora de vender.
-- =====================================================================

-- CreateTable
CREATE TABLE "carts" (
    "userId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "carts_tenantId_idx" ON "carts"("tenantId");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- RLS — a cesta é DADO PESSOAL: isola por USUÁRIO (não só por tenant),
-- para um colega da mesma loja não ler a cesta alheia nem via supabase-js.
-- Sem política de escrita: toda escrita passa pela API (papel `postgres`),
-- que ignora o RLS e isola por código (mesmo padrão da 0002/0014).
-- =====================================================================
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carts_select_own" ON public.carts
  FOR SELECT TO authenticated USING ("userId" = auth.uid());
