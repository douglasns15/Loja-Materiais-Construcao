import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import { applyStockMovement } from '@nexoloja/core';
import {
  type NfeEntryInput,
  nfeEntrySchema,
  normalizeGtin,
  normalizeNcm,
  onlyDigits,
} from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireActiveTenant, requireAuth } from '../middleware/auth';

/**
 * Importação de XML de NF-e (ADR-025, Fatia 2). O XML é lido no NAVEGADOR (DOMParser) e a tela
 * De-Para casa cada item da nota com um produto do cadastro (por EAN/nome/busca manual) ou cadastra
 * na hora. Aqui o servidor recebe as linhas CONFIRMADAS e, POR ITEM em transação atômica (ADR-001):
 *  - cria o produto (se novo) ou usa o existente;
 *  - gera Entrada de estoque (StockMovement INCOME + `stockQty`), grava "último custo" e o aviso de
 *    revisão de preço quando o custo muda (mesma semântica de `POST /stock/movements`);
 *  - alimenta o catálogo global (`ProductCatalog`, upsert por EAN — efeito de rede custo-zero);
 *  - grava um `AuditEvent NFE_ITEM_IMPORTED` (chave `accessKey`+`nItem`) para a IDEMPOTÊNCIA POR
 *    ITEM: reimportar a mesma nota pré-marca só os itens que ainda não deram entrada (`GET /imported`).
 *
 * Na Fatia 2.A o operador confirma/ajusta quantidade e custo por linha (sem conversão automática de
 * unidade comercial → unidade de venda). O fornecedor é casado por CNPJ (ou criado pela nota).
 */

const nfe = new Hono<Env>();
nfe.use('*', requireAuth);

/** Ação de auditoria que marca um item de NF-e já lançado (idempotência por item). */
const NFE_IMPORT_ACTION = 'NFE_ITEM_IMPORTED';

/**
 * Resolve o fornecedor da nota ANTES do laço de itens: usa o `supplierId` informado (validando o
 * tenant) ou cria/reaproveita pelo CNPJ (`@@unique([tenantId, cnpj])`). Sem CNPJ, cria pelo nome.
 * Devolve o id do fornecedor a usar nas entradas, ou null (entrada sem vínculo).
 */
async function resolveSupplierId(
  prisma: ReturnType<typeof createPrismaClient>,
  tenantId: string,
  entry: NfeEntryInput,
): Promise<string | null> {
  if (entry.supplierId) {
    const s = await prisma.supplier.findFirst({
      where: { id: entry.supplierId, tenantId, deletedAt: null },
      select: { id: true },
    });
    return s?.id ?? null;
  }
  if (entry.createSupplier) {
    const cnpj = onlyDigits(entry.createSupplier.cnpj);
    const name = entry.createSupplier.name.trim();
    if (cnpj.length === 14) {
      const s = await prisma.supplier.upsert({
        where: { tenantId_cnpj: { tenantId, cnpj } },
        create: { tenantId, name, cnpj },
        update: {}, // já existe: mantém o cadastro atual (não sobrescreve nome/telefone do lojista)
        select: { id: true },
      });
      return s.id;
    }
    const s = await prisma.supplier.create({ data: { tenantId, name }, select: { id: true } });
    return s.id;
  }
  return null;
}

/** Resultado por item devolvido ao De-Para (a tela mostra o que entrou e o que falhou). */
type ItemResult = { nItem: number; ok: boolean; productId?: string; error?: string };

/**
 * Confirmação da importação: processa cada linha do De-Para em sua PRÓPRIA transação, para que uma
 * linha com problema (ex.: SKU duplicado) não derrube as demais. Bloqueado em loja inativa (ADR-009),
 * como a entrada de estoque manual.
 */
nfe.post('/entry', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = nfeEntrySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados da importação inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }
  const entry = parsed.data;
  const userId = c.get('userId');
  const userName = c.get('userName');
  const reason = (entry.notaNumber ? `Compra NF ${entry.notaNumber}` : 'Compra NF-e').slice(0, 150);

  try {
    const prisma = createPrismaClient(connectionString);
    const supplierId = await resolveSupplierId(prisma, tenantId, entry);

    const results: ItemResult[] = [];
    for (const item of entry.items) {
      try {
        const productId = await prisma.$transaction(async (tx) => {
          // Ficha p/ o catálogo global — só com EAN GTIN válido (a chave da tabela).
          const catalogEan = item.ean ? normalizeGtin(item.ean) : null;
          const catalogNcm = normalizeNcm(item.ncm);

          let pid: string;
          if (item.newProduct) {
            // Produto NOVO cadastrado a partir da nota: custo = "último custo" do item; a Entrada
            // abaixo é a fonte do saldo (nasce com stockQty = quantidade da nota).
            const np = item.newProduct;
            const created = await tx.product.create({
              data: {
                tenantId,
                sku: np.sku,
                ean: np.ean ? onlyDigits(np.ean) || null : null,
                name: np.name,
                manufacturer: np.manufacturer ?? null,
                unit: np.unit,
                costPrice: item.newCostPrice ?? 0,
                salePrice: np.salePrice,
                stockQty: item.quantity,
                createdById: userId,
                createdByName: userName,
                updatedById: userId,
                updatedByName: userName,
              },
              select: { id: true },
            });
            pid = created.id;
          } else {
            // Produto EXISTENTE: soma a entrada ao saldo e, se o operador informou um custo novo,
            // grava "último custo" + aviso de revisão de preço (a margem mudou, o preço não).
            const existing = await tx.product.findFirst({
              where: { id: item.productId, tenantId, deletedAt: null },
              select: { id: true, stockQty: true, costPrice: true },
            });
            if (!existing) throw new Error('PRODUCT_NOT_FOUND');
            const newQty = applyStockMovement(Number(existing.stockQty), 'INCOME', item.quantity);
            const costChanges =
              item.newCostPrice != null &&
              Number(item.newCostPrice) !== Number(existing.costPrice);
            await tx.product.update({
              where: { id: existing.id },
              data: {
                stockQty: newQty,
                ...(item.newCostPrice != null ? { costPrice: item.newCostPrice } : {}),
                ...(costChanges ? { priceReviewPendingAt: new Date() } : {}),
                updatedById: userId,
                updatedByName: userName,
              },
            });
            pid = existing.id;
          }

          // Entrada de estoque (ADR-001) — mesma transação, custo unitário da nota.
          await tx.stockMovement.create({
            data: {
              tenantId,
              productId: pid,
              supplierId,
              type: 'INCOME',
              quantity: item.quantity,
              unitCost: item.newCostPrice ?? null,
              reason,
              syncStatus: 'SYNCED',
              userId,
              registeredByName: userName,
            },
          });

          // Catálogo global: preenche a ficha de um EAN ainda desconhecido (efeito de rede). Não
          // sobrescreve ficha existente (mesma política de `catalog.ts`); refino de melhoria = 2.B.
          if (catalogEan) {
            await tx.productCatalog.upsert({
              where: { ean: catalogEan },
              create: {
                ean: catalogEan,
                officialName: item.officialName ?? null,
                brand: null,
                ncm: catalogNcm,
                imageUrl: null,
                source: 'nfe',
              },
              update: {},
            });
          }

          // Idempotência por item: marca (accessKey, nItem) como lançado. Sem accessKey (nota sem
          // chave de 44 díg.) ainda registra o evento p/ auditoria, mas não entra na pré-marcação.
          await tx.auditEvent.create({
            data: {
              tenantId,
              userId,
              entity: 'Product',
              entityId: pid,
              action: NFE_IMPORT_ACTION,
              meta: {
                accessKey: entry.accessKey ?? null,
                nItem: item.nItem,
                quantity: item.quantity,
                notaNumber: entry.notaNumber ?? null,
              },
            },
          });

          return pid;
        });
        results.push({ nItem: item.nItem, ok: true, productId });
      } catch (err) {
        let msg = 'Falha ao lançar o item.';
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          msg = 'Já existe um produto com esse SKU.';
        } else if (err instanceof Error && err.message === 'PRODUCT_NOT_FOUND') {
          msg = 'Produto vinculado não encontrado.';
        }
        results.push({ nItem: item.nItem, ok: false, error: msg });
      }
    }

    const imported = results.filter((r) => r.ok).length;
    return c.json({ ok: true, data: { supplierId, imported, results } }, 201);
  } catch (err) {
    console.error('POST /nfe/entry falhou:', err);
    return c.json({ ok: false, error: 'Falha ao importar a nota.' }, 500);
  }
});

/**
 * Itens de uma NF-e (por chave de acesso) que JÁ deram entrada — para o De-Para pré-marcar só o que
 * falta ao reimportar a mesma nota. Lê os `AuditEvent NFE_ITEM_IMPORTED` filtrando pelo `accessKey`
 * dentro do `meta` (JSON). Chave malformada devolve lista vazia (sem erro).
 */
nfe.get('/imported', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const accessKey = onlyDigits(c.req.query('chNFe'));
  if (accessKey.length !== 44) {
    return c.json({ ok: true, data: { accessKey: '', importedItems: [] } });
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const events = await prisma.auditEvent.findMany({
      where: {
        tenantId,
        action: NFE_IMPORT_ACTION,
        meta: { path: ['accessKey'], equals: accessKey },
      },
      select: { entityId: true, meta: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const importedItems = events.map((e) => {
      const meta = (e.meta ?? {}) as { nItem?: number };
      return {
        nItem: typeof meta.nItem === 'number' ? meta.nItem : 0,
        productId: e.entityId,
        importedAt: e.createdAt.toISOString(),
      };
    });
    return c.json({ ok: true, data: { accessKey, importedItems } });
  } catch (err) {
    console.error('GET /nfe/imported falhou:', err);
    return c.json({ ok: false, error: 'Falha ao consultar itens já importados.' }, 500);
  }
});

export default nfe;
