// Gera o MODELO NexoLoja de importação de produtos (ADR-041 §1–§2):
//   apps/web/public/modelos/modelo-produtos-nexoloja.xlsx
//
// Uso (na raiz do repo):  node apps/web/scripts/gerar-modelo-planilha.mjs
//
// Sem dependência: um .xlsx é um ZIP de XML (Office Open XML). Montamos o XML à mão e o ZIP com o
// `zlib` do próprio Node (deflate + crc32, Node ≥ 22.2). A biblioteca de planilha do projeto
// (`read-excel-file`) só LÊ — escrever exigiria outra dependência só para este arquivo estático.
//
// As colunas ESPELHAM `IMPORT_FIELDS`/`IMPORT_FIELD_LABELS` de packages/shared/src/productImport.ts
// (mesma ordem e mesmos títulos). Mudou lá ⇒ mude aqui e rode o script de novo.

import { deflateRawSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'modelos', 'modelo-produtos-nexoloja.xlsx');
const MAX_ROW = 5001; // validações/formatos valem até a linha 5001 (5000 produtos, o teto da importação)

/** [título, largura, texto?] — "texto" = célula formatada como Texto (código não vira 7,89E+12). */
const COLUMNS = [
  ['Nome', 40, false],
  ['Preço de venda', 15, false],
  ['Unidade', 10, false],
  ['Código de barras', 18, true],
  ['Código interno', 16, true],
  ['Nome popular', 24, false],
  ['Marca', 18, false],
  ['Descrição', 30, false],
  ['Categoria', 24, false],
  ['Custo', 12, false],
  ['Estoque atual', 14, false],
  ['Estoque mínimo', 15, false],
  ['Controla estoque (S/N)', 22, false],
  ['Código na balança', 18, true],
  ['NCM', 12, true],
];

const INSTRUCTIONS = [
  ['Como preencher a planilha de produtos — NexoLoja', 'title'],
  [''],
  ['Preencha a aba "Produtos": uma linha por produto, a partir da linha 2. Não mude os títulos da linha 1.'],
  ['Só Nome e Preço de venda são obrigatórios. Deixe vazio o que não souber — célula vazia não apaga nada no cadastro.'],
  ['Pode importar a mesma planilha de novo: o NexoLoja reconhece o produto pelo código e só atualiza, sem duplicar.'],
  [''],
  ['Coluna', 'head', 'O que colocar'],
  ['Nome', 'col', 'Nome do produto como aparece no caixa. Ex.: Arroz Tio João 5kg'],
  ['Preço de venda', 'col', 'Preço por unidade de venda. Ex.: 24,90 (aceita R$ 24,90 ou 24.90)'],
  ['Unidade', 'col', 'UN (padrão), KG, L. Lojas de obra: M, M2, M3, MIL, SC. Produto vendido a peso: KG'],
  ['Código de barras', 'col', 'O EAN da embalagem (8, 12, 13 ou 14 dígitos). Deixe vazio em produto sem código'],
  ['Código interno', 'col', 'Código da loja (se tiver). Vazio: o NexoLoja usa o código de barras ou cria um'],
  ['Nome popular', 'col', 'Como o cliente pede no balcão. Ex.: Leite moça'],
  ['Marca', 'col', 'Fabricante/marca. Ex.: Nestlé'],
  ['Descrição', 'col', 'Observação livre (aparece no ⓘ do produto no caixa)'],
  ['Categoria', 'col', 'Ex.: Sorvetes  ou  Sorvetes > Premium (categoria > subcategoria). Criada se não existir'],
  ['Custo', 'col', 'Quanto a loja paga por unidade. Ex.: 18,50'],
  ['Estoque atual', 'col', 'Quantidade na loja hoje. Em produto que já existe, vira a contagem de abertura'],
  ['Estoque mínimo', 'col', 'Ponto de reposição (alerta de estoque baixo). Ex.: 5'],
  ['Controla estoque (S/N)', 'col', 'N para o que não se conta (produção do dia, serviço). Vazio = S'],
  ['Código na balança', 'col', 'Só para quem usa etiqueta de balança: o código (PLU) do produto na balança'],
  ['NCM', 'col', 'Classificação fiscal, 8 dígitos (para a nota fiscal no futuro). Ex.: 10063021'],
  [''],
  ['Exemplo de linhas preenchidas', 'title'],
  ['Arroz Tio João 5kg | 24,90 | UN | 7896006711155 | | | Tio João | | Mercearia | 18,50 | 30 | 5 | S | |'],
  ['Queijo mussarela | 49,90 | KG | | QJ-MUS | Mussarela | | | Frios > Queijos | 32,00 | 4,250 | 1 | S | 101 |'],
  ['Sorvete pote 2L chocolate | 29,90 | UN | | | | | | Sorvetes | | | | N | |'],
];

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colLetter = (i) => String.fromCharCode(65 + i); // até 26 colunas — sobra
const inlineStr = (ref, text, style) =>
  `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${esc(text)}</t></is></c>`;

// Estilos: 0 padrão · 1 cabeçalho (negrito branco no índigo) · 2 texto (formato "@") ·
// 3 título (negrito 14) · 4 quebra de linha · 5 cabeçalho da tabela de instruções (negrito, cinza).
const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FF3730A3"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE0E7FF"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
</cellXfs>
</styleSheet>`;

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

// Aba "Produtos": só o cabeçalho (exemplos ficam nas instruções, para não serem importados sem querer).
const productsSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet ${NS}>
<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${COLUMNS.map(([, w, text], i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${text ? ' style="2"' : ''}/>`).join('')}</cols>
<sheetData><row r="1" ht="30" customHeight="1">${COLUMNS.map(([t], i) => inlineStr(`${colLetter(i)}1`, t, 1)).join('')}</row></sheetData>
<dataValidations count="2">
<dataValidation type="list" errorStyle="warning" allowBlank="1" showErrorMessage="1" errorTitle="Unidade" error="Use UN, KG, L (ou M, M2, M3, MIL, SC em loja de obra)." sqref="C2:C${MAX_ROW}"><formula1>"UN,KG,L,M,M2,M3,MIL,SC"</formula1></dataValidation>
<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Controla estoque" error="Use S ou N." sqref="M2:M${MAX_ROW}"><formula1>"S,N"</formula1></dataValidation>
</dataValidations>
<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;

const instructionRows = INSTRUCTIONS.map((r, i) => {
  const n = i + 1;
  const [a, kind, b] = r;
  if (!a) return `<row r="${n}"/>`;
  if (kind === 'title') return `<row r="${n}">${inlineStr(`A${n}`, a, 3)}</row>`;
  if (kind === 'head') return `<row r="${n}">${inlineStr(`A${n}`, a, 5)}${inlineStr(`B${n}`, b, 5)}</row>`;
  if (kind === 'col') return `<row r="${n}">${inlineStr(`A${n}`, a)}${inlineStr(`B${n}`, b, 4)}</row>`;
  return `<row r="${n}">${inlineStr(`A${n}`, a)}</row>`;
}).join('');
const instructionsSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet ${NS}>
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="90" customWidth="1"/></cols>
<sheetData>${instructionRows}</sheetData>
<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;

const files = {
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
  '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook ${NS}>
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets><sheet name="Produtos" sheetId="1" r:id="rId1"/><sheet name="Instruções" sheetId="2" r:id="rId2"/></sheets>
</workbook>`,
  'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  'xl/styles.xml': styles,
  'xl/worksheets/sheet1.xml': productsSheet,
  'xl/worksheets/sheet2.xml': instructionsSheet,
};

/** ZIP mínimo (deflate), suficiente para o Excel/LibreOffice/Google Planilhas. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // data fixa ⇒ arquivo idêntico a cada geração
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const count = Object.keys(entries).length;
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, zip(files));
console.log(`Modelo gerado: ${OUT}`);
