const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const { getFormEntryType, isFormEntryCell, isFormEntryPlaceholder } = require('./sfEntryCells');
const { getPrivateStorageDirectory } = require('./privateStorage');
const { SF9 } = require('./sf9');

const templateDirectory = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms');
const exportDirectory = getPrivateStorageDirectory('SF_EXPORT_DIRECTORY', 'sf-exports');
const editableTemplateCache = new Map();

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

  if (type === 'dateText') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return { attributes: '', content: '' };
    const text = `${match[2]}/${match[3]}/${match[1]}`;
    return { attributes: ' t="inlineStr"', content: `<is><t>${text}</t></is>` };
  }

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
  const nextValue = cellContent(value, type);
  if (!cellPattern.test(xml)) {
    const rowNumber = Number(/\d+$/.exec(safeAddress)[0]);
    const targetColumn = columnIndex(safeAddress.replace(/\d+$/, ''));
    const newCell = `<c r="${safeAddress}">${nextValue.attributes}${nextValue.content}</c>`;
    const rowPattern = new RegExp(`(<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*>)([\\s\\S]*?)(<\\/row>)`, 'i');
    if (!rowPattern.test(xml)) throw createError(`Mapped cell ${safeAddress} is missing from the official SF template.`, 500);
    return xml.replace(rowPattern, (rowMatch, opening, rowCells, closing) => {
      let inserted = false;
      const orderedCells = rowCells.replace(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/gi, cellXml => {
        const cellColumn = columnIndex(/\br="([A-Z]+)\d+"/i.exec(cellXml)?.[1] || 'A');
        if (!inserted && cellColumn > targetColumn) {
          inserted = true;
          return newCell + cellXml;
        }
        return cellXml;
      });
      return `${opening}${inserted ? orderedCells : orderedCells + newCell}${closing}`;
    });
  }

  return xml.replace(cellPattern, (match, attributes) => {
    const cleanedAttributes = attributes.replace(/\s+t="[^"]*"/i, '');
    return `${cleanedAttributes}${nextValue.attributes}>${nextValue.content}</c>`;
  });
}

function columnIndex(label) {
  return [...String(label || '').toUpperCase()].reduce((number, character) => number * 26 + character.charCodeAt(0) - 64, 0);
}

function shiftRowReference(reference, offset) {
  const value = String(reference || '');
  const separator = value.lastIndexOf('!');
  const prefix = separator >= 0 ? value.slice(0, separator + 1) : '';
  const range = separator >= 0 ? value.slice(separator + 1) : value;
  return prefix + range.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/gi, (match, column, rowValue) => {
    const row = Number(rowValue);
    return `${column}${row >= 42 ? row + offset : row}`;
  });
}

function cloneSf9SubjectRow(rowXml, rowNumber) {
  const opening = /^<row\b[^>]*>/.exec(rowXml)?.[0];
  const cells = [...rowXml.matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)]
    .map(match => match[0])
    .filter(cell => {
      const column = /\br="([A-Z]+)\d+"/i.exec(cell)?.[1]?.toUpperCase();
      return column && columnIndex(column) >= columnIndex('B') && columnIndex(column) <= columnIndex('K');
    })
    .map(cell => {
      const attributes = /^<c\b([^>]*)/.exec(cell)?.[1] || '';
      const column = /\br="([A-Z]+)\d+"/i.exec(cell)?.[1]?.toUpperCase();
      const cleanAttributes = attributes.replace(/\br="[^"]*"/i, `r="${column}${rowNumber}"`)
        .replace(/\s+t="[^"]*"/i, '')
        .replace(/\s*\/$/, '');
      return `<c${cleanAttributes}/>`;
    });
  if (!opening || !cells.length) throw createError('The SF9 subject-row formatting is unavailable.', 500);
  const rowAttributes = opening.slice(4, -1).replace(/\br="\d+"/, `r="${rowNumber}"`);
  return `<row${rowAttributes}>${cells.join('')}</row>`;
}

async function extendSf9SubjectRows(zip, worksheetPath, subjectCount) {
  const extraRows = Math.max(0, subjectCount - SF9.baseSubjectRows);
  if (!extraRows) return;
  if (extraRows > 190) throw createError('SF9 supports up to 200 assigned subjects per learner report.', 422);

  const worksheetXml = await zip.file(worksheetPath).async('string');
  const sheetData = /<sheetData\b([^>]*)>([\s\S]*?)<\/sheetData>/.exec(worksheetXml);
  if (!sheetData) throw createError('The SF9 worksheet data is unavailable.', 500);
  const sourceRow = [...sheetData[2].matchAll(/<row\b[^>]*>[^]*?<\/row>/g)]
    .map(match => match[0]).find(row => Number(/\br="(\d+)"/.exec(row)?.[1]) === 39);
  if (!sourceRow) throw createError('The SF9 worksheet is missing a subject row to extend.', 500);

  const insertedRows = Array.from({ length: extraRows }, (_, index) => cloneSf9SubjectRow(sourceRow, 42 + index));
  const rows = [];
  let insertionComplete = false;
  const rowTags = [...sheetData[2].matchAll(/<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g)].map(match => match[0]);
  rowTags.forEach(row => {
    const rowNumber = Number(/\br="(\d+)"/.exec(row)?.[1] || 0);
    if (!insertionComplete && rowNumber >= 42) {
      rows.push(...insertedRows);
      insertionComplete = true;
    }
    if (rowNumber >= 42) {
      const shiftedCells = row.replace(/(<c\b[^>]*\br=")([A-Z]+)(\d+)(")/gi,
        (tag, before, column, cellRow, after) => Number(cellRow) >= 42
          ? `${before}${column}${Number(cellRow) + extraRows}${after}` : tag);
      rows.push(shiftedCells.replace(/(<row\b[^>]*\br=")(\d+)(")/,
        (tag, before, rowValue, after) => `${before}${Number(rowValue) + extraRows}${after}`));
    } else {
      rows.push(row);
    }
  });
  if (!insertionComplete) rows.push(...insertedRows);

  let extended = worksheetXml.replace(sheetData[0], `<sheetData${sheetData[1]}>${rows.join('')}</sheetData>`);
  extended = extended.replace(/<dimension\b([^>]*\bref=")([^"]+)("[^>]*\/?)/, (tag, before, reference, after) =>
    `<dimension${before}${shiftRowReference(reference, extraRows)}${after}`);
  extended = extended.replace(/<mergeCells\b([^>]*)>([\s\S]*?)<\/mergeCells>/, (block, attributes, content) => {
    const mergeTags = [...content.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"[^>]*\/>/g)].map(match => match[0]);
    const row39Merges = mergeTags.map(tag => /\bref="([^"]+)"/.exec(tag)?.[1])
      .filter(reference => reference && /^([A-Z]+)39:([A-Z]+)39$/i.test(reference));
    const shifted = mergeTags.map(tag => tag.replace(/\bref="([^"]+)"/, (match, reference) =>
      `ref="${shiftRowReference(reference, extraRows)}"`));
    const additions = [];
    row39Merges.forEach(reference => {
      for (let row = 42; row < 42 + extraRows; row += 1) {
        additions.push(`<mergeCell ref="${reference.replace(/39/g, String(row))}"/>`);
      }
    });
    return `<mergeCells${attributes.replace(/\bcount="\d+"/, `count="${mergeTags.length + additions.length}"`)}>${[...shifted, ...additions].join('')}</mergeCells>`;
  });
  extended = extended.replace(/<rowBreaks\b[^>]*>[\s\S]*?<\/rowBreaks>/, block =>
    block.replace(/(<brk\b[^>]*\bid=")(\d+)(")/g, (match, before, row, after) =>
      `${before}${Number(row) >= 42 ? Number(row) + extraRows : row}${after}`));
  zip.file(worksheetPath, extended);

  const workbookPath = 'xl/workbook.xml';
  const workbookXml = await zip.file(workbookPath).async('string');
  const updatedWorkbook = workbookXml.replace(/(<definedName\b(?=[^>]*\bname="_xlnm\.Print_Area")[^>]*>)([\s\S]*?)(<\/definedName>)/g,
    (tag, opening, reference, closing) => `${opening}${shiftRowReference(reference, extraRows)}${closing}`);
  zip.file(workbookPath, updatedWorkbook);
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
  if (fileName !== { SF1: 'sf1.xlsx', SF2: 'sf2.xlsx', SF3: 'sf3.xlsx', SF5: 'sf5.xlsx', SF8: 'sf8.xlsx', SF9: 'sf9.xlsx' }[formCode]) {
    throw createError('The official SF template file is unavailable.', 500);
  }
  const resolvedPath = path.resolve(templateDirectory, fileName);
  if (!resolvedPath.startsWith(`${templateDirectory}${path.sep}`) || !fs.existsSync(resolvedPath)) {
    throw createError('The official SF template file is unavailable.', 500);
  }
  return resolvedPath;
}

async function loadEditableTemplate(formCode, filePath, sheetName) {
  const cacheKey = `${formCode}:${sheetName}`;
  if (!editableTemplateCache.has(cacheKey)) {
    const promise = fs.promises.readFile(getOfficialTemplatePath(filePath, formCode))
      .then(buffer => {
        const workbook = new ExcelJS.Workbook();
        return workbook.xlsx.load(buffer).then(() => workbook);
      });
    editableTemplateCache.set(cacheKey, promise);
  }
  return editableTemplateCache.get(cacheKey);
}

async function getEditableCells(template, mappedCells = []) {
  const workbook = await loadEditableTemplate(template.formCode, template.filePath, template.sheetName);
  const worksheet = workbook.getWorksheet(template.sheetName);
  if (!worksheet) throw createError('The official SF template worksheet is unavailable.', 500);
  const mappedAddresses = new Set(mappedCells.map(cell => String(cell.cellAddress || '').toUpperCase()));
  const editableCells = [];
  const lastRelevantRow = template.formCode === 'SF9' ? 51 : worksheet.rowCount;
  const lastRelevantColumn = template.formCode === 'SF9' ? 29 : worksheet.columnCount;
  for (let rowNumber = 1; rowNumber <= lastRelevantRow; rowNumber += 1) {
    for (let columnNumber = 1; columnNumber <= lastRelevantColumn; columnNumber += 1) {
      const cell = worksheet.getCell(rowNumber, columnNumber);
      const address = cell.address.toUpperCase();
      if (!isFormEntryCell(template.formCode, address)) continue;
      if (cell.isMerged && cell.master.address.toUpperCase() !== address) continue;
      if (cell.value && typeof cell.value === 'object' && (cell.value.formula || cell.value.sharedFormula)) continue;
      const mapped = mappedAddresses.has(address);
      const sourceText = cell.value === null || cell.value === undefined ? '' : String(cell.text || cell.value).trim();
      if (!mapped && sourceText && !isFormEntryPlaceholder(template.formCode, address)) continue;
      editableCells.push({ cellAddress: address, type: getFormEntryType(template.formCode, address, cell) });
    }
  }
  if (template.formCode === 'SF9') {
    const subjectRows = new Set(mappedCells.map(cell => /^B(\d+)$/.exec(String(cell.cellAddress || '').toUpperCase()))
      .filter(match => match && Number(match[1]) >= 32)
      .map(match => Number(match[1])));
    const subjectCount = subjectRows.size;
    if (subjectCount > 200) throw createError('SF9 supports up to 200 assigned subjects per learner report.', 422);
    const existing = new Set(editableCells.map(cell => cell.cellAddress));
    const dynamicAddresses = [];
    for (let row = 42; row < 42 + Math.max(0, subjectCount - 10); row += 1) {
      dynamicAddresses.push(`B${row}`, ...SF9.periodColumns.map(column => `${column}${row}`),
        `${SF9.finalGradeColumn}${row}`, `${SF9.remarksColumn}${row}`);
    }
    dynamicAddresses.push(`${SF9.finalGradeColumn}${42 + Math.max(0, subjectCount - 10)}`);
    dynamicAddresses.forEach(cellAddress => {
      if (!existing.has(cellAddress)) editableCells.push({
        cellAddress,
        type: getFormEntryType('SF9', cellAddress, null)
      });
    });
  }
  return editableCells;
}

function subjectCountFromCells(cells) {
  return new Set((Array.isArray(cells) ? cells : [])
    .map(cell => /^B(\d+)$/.exec(String(cell.cellAddress || '').toUpperCase()))
    .filter(match => match && Number(match[1]) >= 32)
    .map(match => Number(match[1]))).size;
}

function getCombinedTemplatePath(formCodes) {
  const order = { SF1: 1, SF2: 2, SF3: 3, SF5: 4, SF8: 5 };
  const codes = Array.isArray(formCodes) ? [...formCodes].sort((left, right) => order[left] - order[right]) : [];
  if (codes.length < 2 || codes.length > 5 || new Set(codes).size !== codes.length
    || codes.some(code => !order[code])) {
    throw createError('Select two to five different SF forms to create a combined workbook.');
  }
  const resolvedPath = path.resolve(templateDirectory, `${codes.map(code => code.toLowerCase()).join('-')}.xlsx`);
  if (!resolvedPath.startsWith(`${templateDirectory}${path.sep}`) || !fs.existsSync(resolvedPath)) {
    throw createError('The selected combined SF workbook template is unavailable.', 500);
  }
  return resolvedPath;
}

function applyCells(worksheetXml, cells) {
  if (!Array.isArray(cells) || cells.length > 10000) throw createError('Invalid school form cells.');
  cells.forEach(cell => { worksheetXml = replaceCell(worksheetXml, cell.cellAddress, cell.value, cell.type); });
  return worksheetXml;
}

async function addSf5AverageStyles(zip, worksheetXml) {
  const xml = await zip.file('xl/styles.xml').async('string');
  const cellXfs = /<cellXfs\b[^>]*count="(\d+)"[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!cellXfs) throw createError('The SF5 template is missing cell styles.', 500);
  const styles = [...cellXfs[2].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(match => match[0]);
  if (styles.length !== Number(cellXfs[1])) throw createError('The SF5 template styles are invalid.', 500);
  const styleByAddress = new Map();
  const variantBySource = new Map();
  const addedStyles = [];
  for (const row of [...Array.from({ length: 20 }, (_, index) => index + 13),
    ...Array.from({ length: 26 }, (_, index) => index + 34)]) {
    const address = `F${row}`;
    const tag = new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*>`, 'i').exec(worksheetXml)?.[0];
    if (!tag) throw createError(`SF5 average cell ${address} is missing.`, 500);
    const sourceIndex = Number(/\bs="(\d+)"/.exec(tag)?.[1] || 0);
    if (!styles[sourceIndex]) throw createError('The SF5 template styles are invalid.', 500);
    if (!variantBySource.has(sourceIndex)) {
      const variant = styles[sourceIndex].replace(/<xf\b[^>]*>/, opening => opening
        .replace(/\snumFmtId="[^"]*"/, '')
        .replace(/\sapplyNumberFormat="[^"]*"/, '')
        .replace(/\/?>(?=$)/, ending => ` numFmtId="2" applyNumberFormat="1"${ending}`));
      variantBySource.set(sourceIndex, styles.length + addedStyles.length);
      addedStyles.push(variant);
    }
    styleByAddress.set(address, variantBySource.get(sourceIndex));
  }
  const nextBlock = cellXfs[0].replace(`count="${cellXfs[1]}"`, `count="${styles.length + addedStyles.length}"`)
    .replace('</cellXfs>', `${addedStyles.join('')}</cellXfs>`);
  zip.file('xl/styles.xml', xml.replace(cellXfs[0], nextBlock));
  return styleByAddress;
}

function styleSf5Averages(xml, cells, styleByAddress) {
  for (const cell of cells.filter(item => item.type === 'number' && /^F(?:1[3-9]|2\d|3[0-2]|3[4-9]|[4-5]\d)$/.test(item.cellAddress))) {
    const pattern = new RegExp(`<c\\b(?=[^>]*\\br="${cell.cellAddress}")[^>]*>`, 'i');
    if (!pattern.test(xml)) throw createError(`SF5 average cell ${cell.cellAddress} is missing.`, 500);
    xml = xml.replace(pattern, tag => tag.replace(/\s+s="\d+"/, '')
      .replace('>', ` s="${styleByAddress.get(cell.cellAddress)}">`));
  }
  return xml;
}

function xmlAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}="([^"]*)"`).exec(tag)?.[1] || '';
}

function relationshipTags(xml) {
  return [...xml.matchAll(/<Relationship\b[^>]*\/>/g)].map(match => match[0]);
}

function nextPartNumber(zip, expression) {
  expression.lastIndex = 0;
  return Math.max(0, ...Object.keys(zip.files).map(name => Number(expression.exec(name)?.[1] || 0))) + 1;
}

async function addWorkbookPages(zip, template, baseWorksheetPath, sourceWorksheetXml, pages, averageStyles = null) {
  if (pages.length <= 1) return;

  const workbookPath = 'xl/workbook.xml';
  const workbookRelationshipsPath = 'xl/_rels/workbook.xml.rels';
  let workbookXml = await zip.file(workbookPath).async('string');
  let workbookRelationships = await zip.file(workbookRelationshipsPath).async('string');
  const sheetTags = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)].map(match => match[0]);
  const baseIndex = sheetTags.findIndex(tag => xmlAttribute(tag, 'name') === template.sheetName);
  if (baseIndex < 0) throw createError('The generated workbook is missing its source worksheet.', 500);

  const worksheetRelationshipsPath = path.posix.join(
    path.posix.dirname(baseWorksheetPath), '_rels', `${path.posix.basename(baseWorksheetPath)}.rels`
  );
  const sourceWorksheetRelationships = await zip.file(worksheetRelationshipsPath)?.async('string');
  if (!sourceWorksheetRelationships) throw createError('The generated workbook is missing worksheet relationships.', 500);

  let nextWorksheet = nextPartNumber(zip, /^xl\/worksheets\/sheet(\d+)\.xml$/);
  let nextDrawing = nextPartNumber(zip, /^xl\/drawings\/drawing(\d+)\.xml$/);
  let nextPrinterSettings = nextPartNumber(zip, /^xl\/printerSettings\/printerSettings(\d+)\.bin$/);
  const sheetIds = sheetTags.map(tag => Number(xmlAttribute(tag, 'sheetId')) || 0);
  const relationshipIds = relationshipTags(workbookRelationships)
    .map(tag => Number(/^rId(\d+)$/.exec(xmlAttribute(tag, 'Id'))?.[1] || 0));
  let nextSheetId = Math.max(0, ...sheetIds) + 1;
  let nextRelationshipId = Math.max(0, ...relationshipIds) + 1;
  const newSheets = [];
  const newRelationships = [];
  const newContentTypes = [];
  const newDefinedNames = [];
  const sourceSheetName = template.sheetName.replace(/'/g, "''");
  const insertionIndex = baseIndex + 1;

  for (let pageIndex = 1; pageIndex < pages.length; pageIndex += 1) {
    const sheetNumber = nextWorksheet++;
    const sheetPath = `xl/worksheets/sheet${sheetNumber}.xml`;
    const newSheetName = `${template.formCode} Page ${pageIndex + 1}`;
    const sheetRelationshipId = `rId${nextRelationshipId++}`;
    let relationshipXml = sourceWorksheetRelationships;

    for (const tag of relationshipTags(sourceWorksheetRelationships)) {
      const type = xmlAttribute(tag, 'Type').split('/').pop();
      if (type === 'drawing') {
        const drawingNumber = nextDrawing++;
        const target = `../drawings/drawing${drawingNumber}.xml`;
        relationshipXml = relationshipXml.replace(tag, tag.replace(`Target="${xmlAttribute(tag, 'Target')}"`, `Target="${target}"`));
        const sourceDrawingPath = resolvePartPath(baseWorksheetPath, xmlAttribute(tag, 'Target'));
        const sourceDrawing = zip.file(sourceDrawingPath);
        if (!sourceDrawing) throw createError('The generated workbook drawing is unavailable.', 500);
        zip.file(`xl/drawings/drawing${drawingNumber}.xml`, await sourceDrawing.async('nodebuffer'));
        const sourceDrawingRelPath = path.posix.join(
          path.posix.dirname(sourceDrawingPath), '_rels', `${path.posix.basename(sourceDrawingPath)}.rels`
        );
        const sourceDrawingRelationships = zip.file(sourceDrawingRelPath);
        if (sourceDrawingRelationships) {
          const drawingRelationshipsXml = await sourceDrawingRelationships.async('string');
          for (const imageTag of relationshipTags(drawingRelationshipsXml)) {
            const imagePath = resolvePartPath(sourceDrawingPath, xmlAttribute(imageTag, 'Target'));
            if (!zip.file(imagePath)) throw createError('The generated workbook image is unavailable.', 500);
          }
          zip.file(`xl/drawings/_rels/drawing${drawingNumber}.xml.rels`, drawingRelationshipsXml);
        }
        newContentTypes.push(`<Override PartName="/xl/drawings/drawing${drawingNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      } else if (type === 'printerSettings') {
        const printerNumber = nextPrinterSettings++;
        const target = `../printerSettings/printerSettings${printerNumber}.bin`;
        relationshipXml = relationshipXml.replace(tag, tag.replace(`Target="${xmlAttribute(tag, 'Target')}"`, `Target="${target}"`));
        const sourcePrinterPath = resolvePartPath(baseWorksheetPath, xmlAttribute(tag, 'Target'));
        const sourcePrinter = zip.file(sourcePrinterPath);
        if (!sourcePrinter) throw createError('The generated workbook print settings are unavailable.', 500);
        zip.file(`xl/printerSettings/printerSettings${printerNumber}.bin`, await sourcePrinter.async('nodebuffer'));
      }
    }

    const pageXml = applyCells(sourceWorksheetXml, pages[pageIndex]);
    zip.file(sheetPath, averageStyles === null ? pageXml : styleSf5Averages(pageXml, pages[pageIndex], averageStyles));
    zip.file(`xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`, relationshipXml);
    newSheets.push(`<sheet name="${escapeXml(newSheetName)}" sheetId="${nextSheetId++}" r:id="${sheetRelationshipId}"/>`);
    newRelationships.push(`<Relationship Id="${sheetRelationshipId}" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet" Target="worksheets/sheet${sheetNumber}.xml"/>`);
    newContentTypes.push(`<Override PartName="/${sheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);

    const definedNames = /<definedNames>([\s\S]*?)<\/definedNames>/.exec(workbookXml)?.[1] || '';
    [...definedNames.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)]
      .filter(match => Number(xmlAttribute(`<definedName${match[1]}>`, 'localSheetId')) === baseIndex)
      .forEach(match => {
        const attributes = match[1].replace(/localSheetId="\d+"/, `localSheetId="${baseIndex + pageIndex}"`);
        const content = match[2].replaceAll(`'${sourceSheetName}'`, `'${escapeXml(newSheetName)}'`);
        newDefinedNames.push(`<definedName${attributes}>${content}</definedName>`);
      });
  }

  const orderedSheetTags = [...sheetTags];
  orderedSheetTags.splice(insertionIndex, 0, ...newSheets);
  workbookXml = workbookXml.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${orderedSheetTags.join('')}</sheets>`);
  const shiftedDefinedNames = block => block.replace(/<definedName\b([^>]*)>/g, tag => {
    const localSheetValue = xmlAttribute(tag, 'localSheetId');
    const localSheetId = Number(localSheetValue);
    if (!localSheetValue || !Number.isInteger(localSheetId) || localSheetId < insertionIndex) return tag;
    return tag.replace(/localSheetId="\d+"/, `localSheetId="${localSheetId + newSheets.length}"`);
  });
  if (newDefinedNames.length) {
    if (workbookXml.includes('</definedNames>')) {
      workbookXml = workbookXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, block => {
        const shifted = shiftedDefinedNames(block);
        return shifted.replace('</definedNames>', `${newDefinedNames.join('')}</definedNames>`);
      });
    } else {
      workbookXml = workbookXml.replace('</sheets>', `</sheets><definedNames>${newDefinedNames.join('')}</definedNames>`);
    }
  } else if (workbookXml.includes('<definedNames>')) {
    workbookXml = workbookXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, shiftedDefinedNames);
  }
  workbookRelationships = workbookRelationships.replace('</Relationships>', `${newRelationships.join('')}</Relationships>`);
  const contentTypes = await zip.file('[Content_Types].xml').async('string');
  zip.file(workbookPath, workbookXml);
  zip.file(workbookRelationshipsPath, workbookRelationships);
  zip.file('[Content_Types].xml', contentTypes.replace('</Types>', `${newContentTypes.join('')}</Types>`));
}

async function createExportWorkbook(template, cells) {
  const templatePath = getOfficialTemplatePath(template.filePath, template.formCode || 'SF1');
  const source = await fs.promises.readFile(templatePath);
  const zip = await JSZip.loadAsync(source);
  const stylesFile = zip.file('xl/styles.xml');
  if (!stylesFile) throw createError('The official SF template is missing its styles.', 500);

  const originalStyles = await stylesFile.async('nodebuffer');
  const worksheetPath = await getWorksheetPath(zip, template.sheetName);
  let sourceWorksheet = await zip.file(worksheetPath).async('string');
  const pages = Array.isArray(cells?.[0]) ? cells : ['SF2', 'SF3', 'SF5', 'SF8'].includes(template.formCode) ? cells : [cells];
  if (!Array.isArray(pages) || !pages.length || pages.length > 100) throw createError('Invalid school form pages.', 500);
  if (template.formCode === 'SF1' && pages.length !== 1) throw createError('SF1 supports one worksheet page per export.', 500);
  if (template.formCode === 'SF9' && pages.length !== 1) throw createError('SF9 supports one learner per workbook.', 500);
  if (template.formCode === 'SF9') {
    await extendSf9SubjectRows(zip, worksheetPath, subjectCountFromCells(pages[0]));
    sourceWorksheet = await zip.file(worksheetPath).async('string');
  }
  const averageStyles = template.formCode === 'SF5' ? await addSf5AverageStyles(zip, sourceWorksheet) : null;
  zip.file(worksheetPath, averageStyles === null ? applyCells(sourceWorksheet, pages[0])
    : styleSf5Averages(applyCells(sourceWorksheet, pages[0]), pages[0], averageStyles));
  if (pages.length > 1) {
    await addWorkbookPages(zip, template, worksheetPath, sourceWorksheet, pages, averageStyles);
  }
  const afterStyles = await zip.file('xl/styles.xml').async('nodebuffer');
  if (template.formCode !== 'SF5' && !originalStyles.equals(afterStyles)) throw createError('The SF workbook styles changed unexpectedly.', 500);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function createCombinedExportWorkbook(forms) {
  if (!Array.isArray(forms) || forms.length < 2 || forms.length > 5
    || new Set(forms.map(form => form?.formCode)).size !== forms.length
    || forms.some(form => !['SF1', 'SF2', 'SF3', 'SF5', 'SF8'].includes(form?.formCode))) {
    throw createError('A combined workbook must contain two to five different SF forms.');
  }

  const order = { SF1: 1, SF2: 2, SF3: 3, SF5: 4, SF8: 5 };
  const orderedForms = [...forms].sort((left, right) => order[left.formCode] - order[right.formCode]);
  if (orderedForms.some(form => !Array.isArray(form.pages) || !form.pages.length || form.pages.length > 100
    || (form.formCode === 'SF1' && form.pages.length !== 1))) {
    throw createError('The combined workbook contains invalid form pages.');
  }

  const source = await fs.promises.readFile(getCombinedTemplatePath(orderedForms.map(form => form.formCode)));
  const zip = await JSZip.loadAsync(source);
  const stylesFile = zip.file('xl/styles.xml');
  if (!stylesFile) throw createError('The combined workbook is missing its styles.', 500);
  const originalStyles = await stylesFile.async('nodebuffer');
  for (const form of orderedForms) {
    const template = {
      formCode: form.formCode,
      sheetName: {
        SF1: 'School Form 1 (SF1)', SF2: 'School Form 2 (SF2)',
        SF3: 'School Form 3 (SF3)', SF5: 'School Form 5 (SF5)', SF8: 'School Form 8 (SF8)'
      }[form.formCode]
    };
    const worksheetPath = await getWorksheetPath(zip, template.sheetName);
    const sourceWorksheet = await zip.file(worksheetPath).async('string');
    const averageStyles = form.formCode === 'SF5' ? await addSf5AverageStyles(zip, sourceWorksheet) : null;
    const populatedWorksheet = applyCells(sourceWorksheet, form.pages[0]);
    zip.file(worksheetPath, averageStyles === null
      ? populatedWorksheet : styleSf5Averages(populatedWorksheet, form.pages[0], averageStyles));
    if (form.pages.length > 1) {
      await addWorkbookPages(zip, template, worksheetPath, sourceWorksheet, form.pages, averageStyles);
    }
  }

  const afterStyles = await zip.file('xl/styles.xml').async('nodebuffer');
  if (!orderedForms.some(form => form.formCode === 'SF5') && !originalStyles.equals(afterStyles)) {
    throw createError('The combined workbook styles changed unexpectedly.', 500);
  }
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
  if (!/^sf(?:1|2|3|5|8|9)-[a-f0-9-]{36}\.xlsx$/.test(fileName)) throw createError('The requested export file is invalid.', 400);
  const legacy = String(publicPath).replace(/^\/+/, '').startsWith('uploads/sf-exports/');
  const directory = legacy ? path.resolve(__dirname, '..', 'uploads', 'sf-exports') : exportDirectory;
  const filePath = path.resolve(directory, fileName);
  if (!filePath.startsWith(`${directory}${path.sep}`)) throw createError('The requested export file is invalid.', 400);
  return filePath;
}

module.exports = {
  createCombinedExportWorkbook,
  createExportWorkbook,
  getEditableCells,
  getExportFilePath,
  saveExport
};
