-- =====================================================================
-- 0029 — Idempotência FORTE da importação de NF-e (ADR-025 §5.B, Fatia 2.B)
-- Uma linha por item de nota efetivamente lançado. O índice único (tenantId, accessKey, nItem) é a
-- garantia DURA: relançar o MESMO item gera P2002 → rollback da transação da entrada → nunca dobra
-- estoque (a 2.A só tinha um AuditEvent, sem constraint). Gravado na MESMA transação do StockMovement;
-- guarda o movementId para rastreio/estorno. Notas sem chave de acesso (44 díg.) não entram aqui.
--
-- 100% ADITIVA: 1 tabela NOVA (nasce vazia → sem janela quebrada), reversível (DROP TABLE); ZERO
-- alteração em tabela existente, ZERO backfill. RLS por tenant no padrão 0019/0022 (só SELECT p/
-- authenticated; toda escrita passa pela API, papel postgres, que ignora RLS).
-- =====================================================================

-- CreateTable
CREATE TABLE "nfe_import_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accessKey" VARCHAR(44) NOT NULL,
    "nItem" INTEGER NOT NULL,
    "productId" UUID,
    "movementId" UUID,
    "quantity" DECIMAL(12,4) NOT NULL,
    "notaNumber" VARCHAR(20),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nfe_import_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nfe_import_items_tenantId_accessKey_idx" ON "nfe_import_items"("tenantId", "accessKey");

-- CreateIndex
CREATE UNIQUE INDEX "nfe_import_items_tenantId_accessKey_nItem_key" ON "nfe_import_items"("tenantId", "accessKey", "nItem");

-- AddForeignKey
ALTER TABLE "nfe_import_items" ADD CONSTRAINT "nfe_import_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfe_import_items" ADD CONSTRAINT "nfe_import_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- RLS — isolamento por tenant (padrão 0019/0022). Só SELECT para `authenticated`; a escrita passa
-- pela API (papel `postgres`, que ignora RLS).
-- =====================================================================
ALTER TABLE public.nfe_import_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nfe_import_items_select_tenant" ON public.nfe_import_items
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());
