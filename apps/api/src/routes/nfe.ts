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
 *  - grava uma linha em `nfe_import_items` com a constraint DURA (tenantId, accessKey, nItem) —
 *    IDEMPOTÊNCIA FORTE da 2.B: relançar o mesmo item gera P2002 ⇒ rollback ⇒ nunca dobra estoque;
 *  - mantém o `AuditEvent NFE_ITEM_IMPORTED` para a trilha de auditoria. `GET /imported` lê a tabela
 *    nova em UNIÃO com o AuditEvent legado, pré-marcando só os itens que ainda não deram entrada.
 *
 * O operador confirma/ajusta quantidade e custo por linha; a conversão da unidade comercial → unidade
 * de venda (fator de embalagem, 2.B) é feita no cliente, então o payload já chega convertido. O
 * fornecedor é casado por CNPJ (ou criado pela nota).
 */

const nfe = new Hono<Env>();
nfe.use('*', requireAuth);

/** Ação de auditoria que marca um item de NF-e já lançado (idempotência por item). */
const NFE_IMPORT_ACTION = 'NFE_ITEM_IMPORTED';

/**
 * Resolve o fornecedor da nota ANTES do laço de itens: usa o `supplierId` informado (validando o
 * tenant) ou cria/reaproveita pelo CNPJ (`@@unique([tenantId, cnpj])`). Sem CNPJ, cria pelo nome.
 * Devolve `{ id, name }` do fornecedor (o `name` é o snapshot exibido no histórico de importação),
 * ou null (entrada sem vínculo).
 */
async function resolveSupplier(
  prisma: ReturnType<typeof createPrismaClient>,
  tenantId: string,
  entry: NfeEntryInput,
): Promise<{ id: string; name: string } | null> {
  if (entry.supplierId) {
    const s = await prisma.supplier.findFirst({
      where: { id: entry.supplierId, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    return s ? { id: s.id, name: s.name } : null;
  }
  if (entry.createSupplier) {
    const cnpj = onlyDigits(entry.createSupplier.cnpj);
    const name = entry.createSupplier.name.trim();
    if (cnpj.length === 14) {
      const s = await prisma.supplier.upsert({
        where: { tenantId_cnpj: { tenantId, cnpj } },
        create: { tenantId, name, cnpj },
        update: {}, // já existe: mantém o cadastro atual (não sobrescreve nome/telefone do lojista)
        select: { id: true, name: true },
      });
      return { id: s.id, name: s.name };
    }
    const s = await prisma.supplier.create({
      data: { tenantId, name },
      select: { id: true, name: true },
    });
    return { id: s.id, name: s.name };
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
    const supplier = await resolveSupplier(prisma, tenantId, entry);
    const supplierId = supplier?.id ?? null;
    // Snapshot p/ o histórico: nome do fornecedor (resolvido) e nome do arquivo XML importado.
    const supplierName = supplier?.name ?? entry.createSupplier?.name?.trim() ?? null;
    const fileName = entry.fileName?.trim() || null;

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
                // Lembra o fator de embalagem (ex.: 50) para as próximas notas deste produto.
                ...(item.packFactor && item.packFactor > 1 ? { nfePackFactor: item.packFactor } : {}),
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
              select: { id: true, stockQty: true, costPrice: true, ean: true },
            });
            if (!existing) throw new Error('PRODUCT_NOT_FOUND');
            const newQty = applyStockMovement(Number(existing.stockQty), 'INCOME', item.quantity);
            const costChanges =
              item.newCostPrice != null &&
              Number(item.newCostPrice) !== Number(existing.costPrice);
            // Preço de venda (opcional ao casar): se o operador informou um preço novo, ele já revisou
            // a margem AGORA — grava o preço e LIMPA o aviso de revisão. Se NÃO mexeu no preço mas o
            // custo mudou, acende o aviso (margem mudou, preço não). Precedência: preço informado vence.
            const setsSalePrice = item.newSalePrice != null;
            const priceReview = setsSalePrice
              ? { priceReviewPendingAt: null }
              : costChanges
                ? { priceReviewPendingAt: new Date() }
                : {};
            // Backfill do EAN: quando o operador CASA o item com um produto cujo `ean` está VAZIO e a
            // nota traz um GTIN válido, grava o código no cadastro — assim a PRÓXIMA importação casa
            // sozinha por EAN (a causa nº 1 de "não lincou por EAN": o código estava só no SKU).
            // Nunca sobrescreve um EAN já preenchido (o operador pode ter casado, de propósito, um
            // produto com código diferente). `ean` é NÃO-único no schema (unicidade fica na aplicação),
            // então este update nunca dispara P2002 nem derruba a entrada de estoque.
            const backfillEan = catalogEan && !onlyDigits(existing.ean ?? '') ? catalogEan : null;
            await tx.product.update({
              where: { id: existing.id },
              data: {
                stockQty: newQty,
                ...(item.newCostPrice != null ? { costPrice: item.newCostPrice } : {}),
                ...(setsSalePrice ? { salePrice: item.newSalePrice } : {}),
                ...priceReview,
                ...(backfillEan ? { ean: backfillEan } : {}),
                // Troca de unidade (opcional ao casar): muda a unidade de venda do cadastro.
                ...(item.newUnit ? { unit: item.newUnit } : {}),
                // Lembra o fator de embalagem para as próximas notas deste produto.
                ...(item.packFactor && item.packFactor > 1 ? { nfePackFactor: item.packFactor } : {}),
                updatedById: userId,
                updatedByName: userName,
              },
            });
            pid = existing.id;
          }

          // Entrada de estoque (ADR-001) — mesma transação, custo unitário da nota.
          const movement = await tx.stockMovement.create({
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
            select: { id: true },
          });

          // Idempotência FORTE (ADR-025 §5.B, Eixo 2): grava o item lançado com a constraint dura
          // (tenantId, accessKey, nItem). Só quando há chave de acesso (sem ela não há como
          // deduplicar). Se este item JÁ foi lançado, o `P2002` aborta a transação inteira ⇒
          // rollback ⇒ NUNCA dobra estoque. Convertido num sentinela para virar "já lançado" (não
          // erro genérico) — como o cadastro do produto acontece ANTES, um P2002 aqui é sempre da
          // idempotência, nunca do SKU.
          if (entry.accessKey) {
            try {
              await tx.nfeImportItem.create({
                data: {
                  tenantId,
                  accessKey: entry.accessKey,
                  nItem: item.nItem,
                  productId: pid,
                  movementId: movement.id,
                  quantity: item.quantity,
                  notaNumber: entry.notaNumber ?? null,
                  fileName,
                  supplierName,
                  createdById: userId,
                },
              });
            } catch (e) {
              if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                throw new Error('ALREADY_IMPORTED');
              }
              throw e;
            }
          }

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
        if (err instanceof Error && err.message === 'ALREADY_IMPORTED') {
          msg = 'Item já lançado nesta nota.';
        } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
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
 * falta ao reimportar a mesma nota. Lê a tabela `nfe_import_items` (indexada, idempotência forte da
 * 2.B) **em UNIÃO com** os `AuditEvent NFE_ITEM_IMPORTED` legados (notas lançadas na 2.A seguem
 * pré-marcadas, sem backfill/regressão). Dedup por `nItem` (a tabela nova é autoritativa). Chave
 * malformada devolve lista vazia (sem erro).
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
    type Imported = { nItem: number; productId: string | null; importedAt: string };
    const [rows, events] = await Promise.all([
      prisma.nfeImportItem.findMany({
        where: { tenantId, accessKey },
        select: { nItem: true, productId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.auditEvent.findMany({
        where: {
          tenantId,
          action: NFE_IMPORT_ACTION,
          meta: { path: ['accessKey'], equals: accessKey },
        },
        select: { entityId: true, meta: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Dedup por nItem: começa com o legado (AuditEvent da 2.A) e deixa a tabela nova sobrescrever.
    const byNItem = new Map<number, Imported>();
    for (const e of events) {
      const meta = (e.meta ?? {}) as { nItem?: number };
      const nItem = typeof meta.nItem === 'number' ? meta.nItem : 0;
      if (nItem > 0) {
        byNItem.set(nItem, { nItem, productId: e.entityId, importedAt: e.createdAt.toISOString() });
      }
    }
    for (const r of rows) {
      if (r.nItem > 0) {
        byNItem.set(r.nItem, {
          nItem: r.nItem,
          productId: r.productId,
          importedAt: r.createdAt.toISOString(),
        });
      }
    }
    const importedItems = [...byNItem.values()];
    return c.json({ ok: true, data: { accessKey, importedItems } });
  } catch (err) {
    console.error('GET /nfe/imported falhou:', err);
    return c.json({ ok: false, error: 'Falha ao consultar itens já importados.' }, 500);
  }
});

/**
 * HISTÓRICO de importações (tela Estoque). Agrupa `nfe_import_items` por CHAVE DE ACESSO — cada grupo
 * é "uma importação" —, trazendo o resumo exibido na lista: data (última entrada do grupo), nº de
 * itens, número da nota, fornecedor e nome do arquivo. Ordena da mais recente para a mais antiga e
 * pagina por CURSOR (`before` = ISO da última linha da página anterior) para "buscar mais antigas".
 * Busca opcional (`q`) filtra por nota/fornecedor/arquivo (unaccent, como o catálogo). Usa `$queryRaw`
 * com GROUP BY — os campos de resumo são iguais dentro do grupo, então `MAX()` só os "puxa". Notas sem
 * chave de acesso (raras) não entram aqui (não têm linha nesta tabela), como na idempotência forte.
 */
nfe.get('/imports', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const rawLimit = Number(c.req.query('limit'));
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50) : 20;
  const q = (c.req.query('q') ?? '').trim();
  const beforeRaw = c.req.query('before');
  const before = beforeRaw ? new Date(beforeRaw) : null;

  try {
    const prisma = createPrismaClient(connectionString);
    // HAVING dinâmico: cursor de paginação + busca. Os campos de resumo são constantes no grupo,
    // então filtramos pelos seus `MAX()` (funciona igual a filtrar o valor da coluna).
    const having: Prisma.Sql[] = [];
    if (before && !Number.isNaN(before.getTime())) {
      having.push(Prisma.sql`MAX(p."createdAt") < ${before}`);
    }
    if (q) {
      const pat = `%${q}%`;
      having.push(Prisma.sql`(
        extensions.unaccent(coalesce(MAX(p."notaNumber"), '')) ILIKE extensions.unaccent(${pat})
        OR extensions.unaccent(coalesce(MAX(p."fileName"), '')) ILIKE extensions.unaccent(${pat})
        OR extensions.unaccent(coalesce(MAX(p."supplierName"), '')) ILIKE extensions.unaccent(${pat})
      )`);
    }
    const havingSql = having.length
      ? Prisma.sql`HAVING ${Prisma.join(having, ' AND ')}`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<
      {
        accessKey: string;
        importedAt: Date;
        itemCount: number;
        notaNumber: string | null;
        fileName: string | null;
        supplierName: string | null;
      }[]
    >(Prisma.sql`
      SELECT p."accessKey" AS "accessKey",
             MAX(p."createdAt") AS "importedAt",
             COUNT(*)::int AS "itemCount",
             MAX(p."notaNumber") AS "notaNumber",
             MAX(p."fileName") AS "fileName",
             MAX(p."supplierName") AS "supplierName"
      FROM "nfe_import_items" p
      WHERE p."tenantId" = ${tenantId}::uuid
      GROUP BY p."accessKey"
      ${havingSql}
      ORDER BY MAX(p."createdAt") DESC
      LIMIT ${limit}
    `);

    const imports = rows.map((r) => ({
      accessKey: r.accessKey,
      importedAt: r.importedAt.toISOString(),
      itemCount: Number(r.itemCount),
      notaNumber: r.notaNumber,
      fileName: r.fileName,
      supplierName: r.supplierName,
    }));
    // Cursor da próxima página: só quando a página veio cheia (pode haver mais antigas).
    const nextCursor =
      imports.length === limit ? imports[imports.length - 1]?.importedAt ?? null : null;
    return c.json({ ok: true, data: { imports, nextCursor } });
  } catch (err) {
    console.error('GET /nfe/imports falhou:', err);
    return c.json({ ok: false, error: 'Falha ao carregar o histórico de importações.' }, 500);
  }
});

/**
 * DETALHE de uma importação: os itens lançados de uma nota (por chave de acesso), com o NOME do
 * produto (join) e a quantidade que entrou. Devolve também o cabeçalho (nota/fornecedor/arquivo/data)
 * a partir das próprias linhas. Chave malformada → 400. Alimenta a linha expansível do histórico.
 */
nfe.get('/imports/:accessKey', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const accessKey = onlyDigits(c.req.param('accessKey'));
  if (accessKey.length !== 44) {
    return c.json({ ok: false, error: 'Chave de acesso inválida.' }, 400);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const rows = await prisma.nfeImportItem.findMany({
      where: { tenantId, accessKey },
      select: {
        nItem: true,
        quantity: true,
        productId: true,
        notaNumber: true,
        fileName: true,
        supplierName: true,
        createdAt: true,
        product: { select: { name: true, unit: true } },
      },
      orderBy: { nItem: 'asc' },
    });
    if (rows.length === 0) {
      return c.json({ ok: false, error: 'Importação não encontrada.' }, 404);
    }

    const header = {
      accessKey,
      notaNumber: rows.find((r) => r.notaNumber)?.notaNumber ?? null,
      fileName: rows.find((r) => r.fileName)?.fileName ?? null,
      supplierName: rows.find((r) => r.supplierName)?.supplierName ?? null,
      // Data da importação = a mais recente das entradas do grupo (reimportações parciais somam datas).
      importedAt: rows
        .reduce((max, r) => (r.createdAt > max ? r.createdAt : max), rows[0]!.createdAt)
        .toISOString(),
    };
    const items = rows.map((r) => ({
      nItem: r.nItem,
      productName: r.product?.name ?? '(produto removido)',
      unit: r.product?.unit ?? null,
      quantity: r.quantity.toString(),
    }));
    return c.json({ ok: true, data: { ...header, items } });
  } catch (err) {
    console.error('GET /nfe/imports/:accessKey falhou:', err);
    return c.json({ ok: false, error: 'Falha ao carregar os itens da importação.' }, 500);
  }
});

export default nfe;
