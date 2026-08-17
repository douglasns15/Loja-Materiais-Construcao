import {
  buildNfeHeader,
  buildNfeItem,
  normalizeGtin,
  type NFeDoc,
  type NFeItem,
} from '@nexoloja/shared';

/**
 * Leitura do XML de NF-e no NAVEGADOR (ADR-025, Fatia 2). Usa o `DOMParser` nativo — sem dependência
 * nova, custo-zero — para extrair os campos crus e delega a normalização (decimais, EAN, chave) aos
 * construtores PUROS de `@nexoloja/shared` (testados em Vitest). Aqui só há caminhada no DOM; nenhuma
 * regra de negócio. Erros de XML viram exceção tratável (a tela mostra "arquivo inválido").
 */

/** Primeiro texto de uma tag descendente (NF-e usa namespace default; casamos pelo nome local). */
function tagText(root: Element | Document, tag: string): string | null {
  const el = root.getElementsByTagName(tag)[0];
  return el?.textContent?.trim() ?? null;
}

/**
 * `cEAN` é o campo preferencial; algumas notas trazem "SEM GTIN" nele mas um GTIN válido em
 * `cEANTrib`. Escolhe o primeiro que é GTIN válido; senão devolve o `cEAN` cru (para exibir/guardar).
 */
function pickEanRaw(prod: Element): string | null {
  const cEAN = tagText(prod, 'cEAN');
  const cEANTrib = tagText(prod, 'cEANTrib');
  if (cEAN && normalizeGtin(cEAN)) return cEAN;
  if (cEANTrib && normalizeGtin(cEANTrib)) return cEANTrib;
  return cEAN ?? cEANTrib;
}

/** Converte o texto de um XML de NF-e em `NFeDoc` normalizado. Lança se o XML for inválido. */
export function parseNfeXml(xml: string): NFeDoc {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  // O DOMParser não lança em XML malformado — sinaliza com um <parsererror> no documento.
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('XML inválido — verifique se o arquivo é o XML da NF-e.');
  }
  const infNFe = doc.getElementsByTagName('infNFe')[0];
  if (!infNFe) {
    throw new Error('Não parece um XML de NF-e (elemento infNFe ausente).');
  }

  const emit = infNFe.getElementsByTagName('emit')[0] ?? null;
  const header = buildNfeHeader({
    accessKey: infNFe.getAttribute('Id') ?? tagText(infNFe, 'chNFe'),
    number: tagText(infNFe, 'nNF'),
    supplierName: emit ? tagText(emit, 'xNome') : null,
    supplierCnpj: emit ? tagText(emit, 'CNPJ') : null,
  });

  const items: NFeItem[] = [];
  const dets = infNFe.getElementsByTagName('det');
  for (let i = 0; i < dets.length; i++) {
    const det = dets[i];
    if (!det) continue;
    const prod = det.getElementsByTagName('prod')[0];
    if (!prod) continue;
    items.push(
      buildNfeItem({
        nItem: det.getAttribute('nItem') ?? String(i + 1),
        supplierCode: tagText(prod, 'cProd'),
        ean: pickEanRaw(prod),
        name: tagText(prod, 'xProd'),
        ncm: tagText(prod, 'NCM'),
        unit: tagText(prod, 'uCom'),
        quantity: tagText(prod, 'qCom'),
        unitCost: tagText(prod, 'vUnCom'),
        total: tagText(prod, 'vProd'),
      }),
    );
  }

  return { header, items };
}
