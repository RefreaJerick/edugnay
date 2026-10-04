const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { getPrivateStorageDirectory } = require('./privateStorage');

const templateDirectory = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms');
const exportDirectory = getPrivateStorageDirectory('SF_EXPORT_DIRECTORY', 'sf-exports');

fs.mkdirSync(exportDirectory, { recursive: true });

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolvePartPath(basePath, targetPath) {
  if (targetPath.startsWith('/')) return targetPath.slice(1);
  const parts = basePath.split('/');
  parts.pop();
  targetPath.split('/').forEach(part => {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  });
  return parts.join('/');
}

function excelDateSerial(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(timestamp) ? (timestamp - Date.UTC(1899, 11, 30)) / 86400000 : null;
}

function cellContent(value, type) {
  if (value === null || value === undefined || value === '') return { attributes: '', content: '' };

  if (type === 'number' || type === 'date') {
    const number = type === 'date' ? excelDateSerial(value) : Number(value);
    if (Number.isFinite(number)) return { attributes: '', content: `<v>${number}</v>` };
    return { attributes: '', content: '' };
  }

  const text = String(value);
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return {
    attributes: ' t="inlineStr"',
    content: `<is><t${preserve}>${escapeXml(text)}</t></is>`
  };
}

function replaceCell(xml, address, value, type) {
  const safeAddress = String(address || '').toUpperCase();
  if (!/^[A-Z]+\d+$/.test(safeAddress)) throw createError('The SF template contains an invalid mapped cell.', 500);

  const cellPattern = new RegExp(`(<c\\b(?=[^>]*\\br="${safeAddress}")[^>]*?)\\s*(?:/>|>[\\s\\S]*?<\\/c>)`, 'i');
  if (!cellPattern.test(xml)) throw createError(`Mapped cell ${safeAddress} is missing from the official SF template.`, 500);

  const nextValue = cellContent(value, type);
  return xml.replace(cellPattern, (match, attributes) => {
    const cleanedAttributes = attributes.replace(/\s+t="[^"]*"/i, '');
    return `${cleanedAttributes}${nextValue.attributes}>${nextValue.content}</c>`;
  });
}

async function getWorksheetPath(zip, sheetName) {
  const workbookPath = 'xl/workbook.xml';
  const relationshipsPath = 'xl/_rels/workbook.xml.rels';
  const workbookFile = zip.file(workbookPath);
  const relationshipsFile = zip.file(relationshipsPath);
  if (!workbookFile || !relationshipsFile) throw createError('The official SF workbook package is incomplete.', 500);

  const workbookXml = await workbookFile.async('string');
  const escapedName = String(sheetName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sheetMatch = new RegExp(`<sheet\\b(?=[^>]*\\bname="${escapedName}")[^>]*\\br:id="([^"]+)"[^>]*/?>`, 'i').exec(workbookXml);
  if (!sheetMatch) throw createError(`Worksheet "${sheetName}" is missing from the official SF template.`, 500);

  const relationshipsXml = await relationshipsFile.async('string');
  const relationshipMatch = new RegExp(`<Relationship\\b(?=[^>]*\\bId="${sheetMatch[1]}")[^>]*\\bTarget="([^"]+)"[^>]*/?>`, 'i').exec(relationshipsXml);
  if (!relationshipMatch) throw createError(`Worksheet "${sheetName}" could not be opened.`, 500);

  const worksheetPath = resolvePartPath(workbookPath, relationshipMatch[1]);
  if (!zip.file(worksheetPath)) throw createError(`Worksheet "${sheetName}" could not be opened.`, 500);
  return worksheetPath;
}

function getOfficialTemplatePath(filePath, formCode) {
  const fileName = path.basename(String(filePath || ''));
  if (fileName !== { SF1: 'sf1.xlsx', SF2: 'sf2.xlsx' }[formCode]) {
    throw createError('The official SF template file is unavailable.', 500);
  }
  const resolvedPath = path.resolve(templateDirectory, fileName);
  if (!resolvedPath.startsWith(`${templateDirectory}${path.sep}`) || !fs.existsSync(resolvedPath)) {
    throw createError('The official SF template file is unavailable.', 500);
  }
  return resolvedPath;
}

function getCombinedTemplatePath() {
  const resolvedPath = path.resolve(templateDirectory, 'sf1-sf2.xlsx');
  if (!resolvedPath.startsWith(`${templateDirectory}${path.sep}`) || !fs.existsSync(resolvedPath)) {
    throw createError('The combined SF1 and SF2 workbook template is unavailable.', 500);
  }
  return resolvedPath;
}

function applyCells(worksheetXml, cells) {
  if (!Array.isArray(cells) || cells.length > 10000) throw createError('Invalid school form cells.');
  cells.forEach(cell => { worksheetXml = replaceCell(worksheetXml, cell.cellAddress, cell.value, cell.type); });
  return worksheetXml;
}

async function createExportWorkbook(template, cells) {
  const templatePath = getOfficialTemplatePath(template.filePath, template.formCode || 'SF1');
  const source = await fs.promises.readFile(templatePath);
  const zip = await JSZip.loadAsync(source);
  const stylesFile = zip.file('xl/styles.xml');
  if (!stylesFile) throw createError('The official SF template is missing its styles.', 500);

  const originalStyles = await stylesFile.async('nodebuffer');
  const worksheetPath = await getWorksheetPath(zip, template.sheetName);
  const sourceWorksheet = await zip.file(worksheetPath).async('string');
  const pages = template.formCode === 'SF2' ? cells : [cells];
  if (!Array.isArray(pages) || !pages.length || pages.length > 100) throw createError('Invalid school form pages.', 500);
  for (let index = 0; index < pages.length; index += 1) {
    let worksheetXml = sourceWorksheet;
    pages[index].forEach(cell => { worksheetXml = replaceCell(worksheetXml, cell.cellAddress, cell.value, cell.type); });
    const pagePath = index === 0 ? worksheetPath : `xl/worksheets/sheet${index + 2}.xml`;
    zip.file(pagePath, worksheetXml);
    if (index === 0) continue;
    const drawingNumber = index + 2;
    const baseRels = await zip.file('xl/worksheets/_rels/sheet2.xml.rels').async('string');
    zip.file(`xl/worksheets/_rels/sheet${drawingNumber}.xml.rels`, baseRels
      .replace('drawing2.xml', `drawing${drawingNumber}.xml`)
      .replace('printerSettings2.bin', `printerSettings${drawingNumber}.bin`));
    zip.file(`xl/drawings/drawing${drawingNumber}.xml`, await zip.file('xl/drawings/drawing2.xml').async('nodebuffer'));
    zip.file(`xl/drawings/_rels/drawing${drawingNumber}.xml.rels`, await zip.file('xl/drawings/_rels/drawing2.xml.rels').async('nodebuffer'));
    zip.file(`xl/printerSettings/printerSettings${drawingNumber}.bin`, await zip.file('xl/printerSettings/printerSettings2.bin').async('nodebuffer'));
  }
  if (pages.length > 1) {
    let workbook = await zip.file('xl/workbook.xml').async('string');
    let relationships = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    let contentTypes = await zip.file('[Content_Types].xml').async('string');
    for (let index = 1; index < pages.length; index += 1) {
      const partNumber = index + 2;
      const name = `SF2 Page ${index + 1}`;
      workbook = workbook.replace('</sheets>', `<sheet name="${name}" sheetId="${partNumber}" r:id="rId${10 + index}"/></sheets>`);
      workbook = workbook.replace('</definedNames>', `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">'${name}'!$10:$12</definedName></definedNames>`);
      relationships = relationships.replace('</Relationships>', `<Relationship Id="rId${10 + index}" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet" Target="worksheets/sheet${partNumber}.xml"/></Relationships>`);
      contentTypes = contentTypes.replace('</Types>', `<Override PartName="/xl/worksheets/sheet${partNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing${partNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    }
    zip.file('xl/workbook.xml', workbook);
    zip.file('xl/_rels/workbook.xml.rels', relationships);
    zip.file('[Content_Types].xml', contentTypes);
  }
  const afterStyles = await zip.file('xl/styles.xml').async('nodebuffer');
  if (!originalStyles.equals(afterStyles)) throw createError('The SF workbook styles changed unexpectedly.', 500);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function createCombinedExportWorkbook(forms) {
  if (!Array.isArray(forms) || forms.length !== 2
    || new Set(forms.map(form => form?.formCode)).size !== 2
    || !forms.some(form => form.formCode === 'SF1') || !forms.some(form => form.formCode === 'SF2')) {
    throw createError('A combined workbook must contain one verified SF1 and one verified SF2.');
  }

  const sf1 = forms.find(form => form.formCode === 'SF1');
  const sf2 = forms.find(form => form.formCode === 'SF2');
  if (!Array.isArray(sf1.pages) || sf1.pages.length !== 1
    || !Array.isArray(sf2.pages) || !sf2.pages.length || sf2.pages.length > 100) {
    throw createError('The combined workbook contains invalid form pages.');
  }

  const source = await fs.promises.readFile(getCombinedTemplatePath());
  const zip = await JSZip.loadAsync(source);
  const stylesFile = zip.file('xl/styles.xml');
  if (!stylesFile) throw createError('The combined workbook is missing its styles.', 500);
  const originalStyles = await stylesFile.async('nodebuffer');
  const sf1Path = await getWorksheetPath(zip, 'School Form 1 (SF1)');
  const sf2Path = await getWorksheetPath(zip, 'School Form 2 (SF2)');
  const sf1Xml = await zip.file(sf1Path).async('string');
  const sf2Xml = await zip.file(sf2Path).async('string');
  zip.file(sf1Path, applyCells(sf1Xml, sf1.pages[0]));

  const baseRelationsPath = 'xl/worksheets/_rels/sheet2.xml.rels';
  const baseDrawingPath = 'xl/drawings/drawing2.xml';
  const baseDrawingRelationsPath = 'xl/drawings/_rels/drawing2.xml.rels';
  const basePrinterSettingsPath = 'xl/printerSettings/printerSettings2.bin';
  const baseRelations = zip.file(baseRelationsPath);
  const baseDrawing = zip.file(baseDrawingPath);
  const baseDrawingRelations = zip.file(baseDrawingRelationsPath);
  const basePrinterSettings = zip.file(basePrinterSettingsPath);
  if (!baseRelations || !baseDrawing || !baseDrawingRelations || !basePrinterSettings) {
    throw createError('The combined workbook is missing SF2 print or image settings.', 500);
  }

  let workbook = await zip.file('xl/workbook.xml').async('string');
  let workbookRelations = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  let contentTypes = await zip.file('[Content_Types].xml').async('string');
  const sheetTags = [...workbook.matchAll(/<sheet\b[^>]*\/?\s*>/g)].map(match => match[0]);
  const sheetIds = sheetTags.map(tag => Number(/\bsheetId="(\d+)"/.exec(tag)?.[1] || 0));
  const relationIds = [...workbookRelations.matchAll(/\bId="rId(\d+)"/g)].map(match => Number(match[1]));
  const nextSheetId = Math.max(0, ...sheetIds) + 1;
  const nextRelationId = Math.max(0, ...relationIds) + 1;
  const worksheetXml = sf2Xml;
  const additionalSheets = [];
  const additionalRelations = [];
  const additionalDefinedNames = [];
  const additionalContentTypes = [];

  for (let pageIndex = 0; pageIndex < sf2.pages.length; pageIndex += 1) {
    const partNumber = pageIndex + 2;
    const sheetName = pageIndex === 0 ? 'School Form 2 (SF2)' : `SF2 Page ${pageIndex + 1}`;
    const pageCells = sf2.pages[pageIndex];
    const pageXml = applyCells(worksheetXml, pageCells);
    const sheetPath = pageIndex === 0 ? sf2Path : `xl/worksheets/sheet${partNumber}.xml`;
    zip.file(sheetPath, pageXml);
    if (pageIndex === 0) continue;

    const drawingNumber = partNumber + 1;
    const sheetId = nextSheetId + pageIndex - 1;
    const relationshipId = `rId${nextRelationId + pageIndex - 1}`;
    const nextName = `SF2 Page ${pageIndex + 1}`;
    const sheetRelations = (await baseRelations.async('string'))
      .replaceAll('drawing2.xml', `drawing${drawingNumber}.xml`)
      .replaceAll('printerSettings2.bin', `printerSettings${drawingNumber}.bin`);
    zip.file(`xl/worksheets/_rels/sheet${partNumber}.xml.rels`, sheetRelations);
    zip.file(`xl/drawings/drawing${drawingNumber}.xml`, await baseDrawing.async('nodebuffer'));
    zip.file(`xl/drawings/_rels/drawing${drawingNumber}.xml.rels`, await baseDrawingRelations.async('nodebuffer'));
    zip.file(`xl/printerSettings/printerSettings${drawingNumber}.bin`, await basePrinterSettings.async('nodebuffer'));
    additionalSheets.push(`<sheet name="${escapeXml(nextName)}" sheetId="${sheetId}" r:id="${relationshipId}"/>`);
    additionalRelations.push(`<Relationship Id="${relationshipId}" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet" Target="worksheets/sheet${partNumber}.xml"/>`);
    additionalDefinedNames.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${pageIndex + 1}">'${escapeXml(nextName)}'!$10:$12</definedName>`);
    additionalContentTypes.push(`<Override PartName="/xl/worksheets/sheet${partNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing${drawingNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  }

  if (additionalSheets.length) {
    workbook = workbook.replace('</sheets>', `${additionalSheets.join('')}</sheets>`);
    if (workbook.includes('</definedNames>')) {
      workbook = workbook.replace('</definedNames>', `${additionalDefinedNames.join('')}</definedNames>`);
    } else {
      workbook = workbook.replace('</sheets>', `</sheets><definedNames>${additionalDefinedNames.join('')}</definedNames>`);
    }
    workbookRelations = workbookRelations.replace('</Relationships>', `${additionalRelations.join('')}</Relationships>`);
    contentTypes = contentTypes.replace('</Types>', `${additionalContentTypes.join('')}</Types>`);
    zip.file('xl/workbook.xml', workbook);
    zip.file('xl/_rels/workbook.xml.rels', workbookRelations);
    zip.file('[Content_Types].xml', contentTypes);
  }

  const afterStyles = await zip.file('xl/styles.xml').async('nodebuffer');
  if (!originalStyles.equals(afterStyles)) throw createError('The combined workbook styles changed unexpectedly.', 500);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function saveExport(buffer, formCode) {
  const fileName = `${String(formCode).toLowerCase()}-${crypto.randomUUID()}.xlsx`;
  const filePath = path.join(exportDirectory, fileName);
  await fs.promises.writeFile(filePath, buffer, { flag: 'wx' });
  return { fileName, filePath, publicPath: fileName };
}

function getExportFilePath(publicPath) {
  const fileName = path.basename(String(publicPath || ''));
  if (!/^sf[12]-[a-f0-9-]{36}\.xlsx$/.test(fileName)) throw createError('The requested export file is invalid.', 400);
  const legacy = String(publicPath).replace(/^\/+/, '').startsWith('uploads/sf-exports/');
  const directory = legacy ? path.resolve(__dirname, '..', 'uploads', 'sf-exports') : exportDirectory;
  const filePath = path.resolve(directory, fileName);
  if (!filePath.startsWith(`${directory}${path.sep}`)) throw createError('The requested export file is invalid.', 400);
  return filePath;
}

module.exports = {
  createCombinedExportWorkbook,
  createExportWorkbook,
  getExportFilePath,
  saveExport
};
