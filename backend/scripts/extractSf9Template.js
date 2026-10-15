const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');

const sourcePath = process.argv[2];
const sheetName = 'SF9 - GRADE 4-10';
const outputPath = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms', 'sf9.xlsx');

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}="([^"]*)"`).exec(tag)?.[1] || '';
}

function relationshipTags(xml) {
  return [...xml.matchAll(/<Relationship\b[^>]*\/>/g)].map(match => match[0]);
}

function resolvePart(basePart, target) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(basePart), target));
}

function relationshipType(tag) {
  return attribute(tag, 'Type').split('/').pop();
}

async function copyPart(source, output, sourceName, outputName = sourceName) {
  const part = source.file(sourceName);
  if (!part) throw new Error(`The supplied SF9 workbook is missing ${sourceName}.`);
  output.file(outputName, await part.async('nodebuffer'));
}

function columnNumber(label) {
  return [...label].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
}

function columnLabel(value) {
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function clearCellContents(cellTag) {
  const attributes = cellTag.replace(/\s+t="[^"]*"/i, '');
  return attributes.replace(/>([\s\S]*?)<\/c>$/, '> </c>')
    .replace(/> <\/c>$/, '/>');
}

function setInlineCell(cellTag, value) {
  const clean = clearCellContents(cellTag).replace(/\/>$/, '>');
  const opening = clean.slice(0, clean.indexOf('>')).replace(/\s+t="[^"]*"/i, '') + ' t="inlineStr">';
  return `${opening}<is><t>${value}</t></is></c>`;
}

function rewriteCell(cellTag, rowNumber, newColumn = null, contents = null) {
  const address = /\br="([A-Z]+)(\d+)"/i.exec(cellTag);
  if (!address) return cellTag;
  const column = newColumn || address[1];
  let result = cellTag.replace(address[0], `r="${column}${rowNumber}"`);
  if (contents === 'clear') result = clearCellContents(result);
  else if (typeof contents === 'string') result = setInlineCell(result, contents);
  return result;
}

function insertCellByColumn(rowXml, cellTag) {
  const targetColumn = columnNumber(/\br="([A-Z]+)\d+"/i.exec(cellTag)?.[1] || 'A');
  let inserted = false;
  const nextRow = rowXml.replace(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/gi, existingCell => {
    const existingColumn = columnNumber(/\br="([A-Z]+)\d+"/i.exec(existingCell)?.[1] || 'A');
    if (!inserted && existingColumn > targetColumn) {
      inserted = true;
      return cellTag + existingCell;
    }
    return existingCell;
  });
  return inserted ? nextRow : nextRow.replace('</row>', `${cellTag}</row>`);
}

function clearFormulaCell(cellTag) {
  const opening = /^<c\b[^>]*>/.exec(cellTag)?.[0];
  if (!opening) return cellTag;
  const attributes = opening.replace(/\s+t="[^"]*"/i, '');
  return `${attributes.slice(0, -1)}/>`;
}

function transformSf9Worksheet(xml) {
  const headerRow = /<row\b(?=[^>]*\br="31")[^>]*>[\s\S]*?<\/row>/.exec(xml)?.[0];
  if (!headerRow) throw new Error('The supplied SF9 worksheet is missing its term header row.');

  let nextXml = xml.replace(/<row\b[^>]*>[\s\S]*?<\/row>/g, rowXml => {
    const rowNumber = Number(/\br="(\d+)"/.exec(rowXml)?.[1] || 0);
    const additions = [];
    let transformed = rowXml.replace(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g, cellTag => {
      const address = /\br="([A-Z]+)(\d+)"/i.exec(cellTag);
      if (!address) return cellTag;
      const cellRow = Number(address[2]);
      let cellColumn = address[1].toUpperCase();
      if (rowNumber >= 30 && rowNumber <= 43 && cellRow === rowNumber && cellColumn === 'L') return '';
      const isFormula = /<f\b/i.test(cellTag)
        || /^I(?:3[2-9]|4[0-3])$/.test(`${cellColumn}${cellRow}`);
      if (rowNumber >= 30 && rowNumber <= 43
        && cellRow === rowNumber && columnNumber(cellColumn) >= columnNumber('I')
        && columnNumber(cellColumn) <= columnNumber('K')) {
        cellColumn = columnLabel(columnNumber(cellColumn) + 1);
      }
      return rewriteCell(cellTag, rowNumber, cellColumn, isFormula ? 'clear' : null);
    });

    if (rowNumber === 31) {
      const termFourStyle = /<c\b(?=[^>]*\br="H31")[^>]*\/>|<c\b(?=[^>]*\br="H31")[^>]*>[\s\S]*?<\/c>/i.exec(headerRow)?.[0];
      if (!termFourStyle) throw new Error('The SF9 worksheet is missing the third-term cell style.');
      transformed = insertCellByColumn(transformed, rewriteCell(termFourStyle, 31, 'I', 'T4'));
    }
    if (rowNumber >= 32 && rowNumber <= 41) {
      const sourceStyle = /<c\b(?=[^>]*\br="H\d+")[^>]*\/>|<c\b(?=[^>]*\br="H\d+")[^>]*>[\s\S]*?<\/c>/i;
      const match = sourceStyle.exec(rowXml);
      if (!match) throw new Error(`The SF9 worksheet is missing the fourth-term style source on row ${rowNumber}.`);
      const newTerm = rewriteCell(match[0], rowNumber, 'I', 'clear');
      transformed = insertCellByColumn(transformed, newTerm);
    }
    return transformed;
  });

  nextXml = nextXml.replace(/<mergeCell\b[^>]*\bref="([A-Z]+)(\d+):([A-Z]+)(\d+)"[^>]*\/>/g,
    (tag, firstColumn, firstRow, lastColumn, lastRow) => {
      const startRow = Number(firstRow);
      const endRow = Number(lastRow);
      if (startRow === 30 && endRow === 30 && firstColumn === 'F' && lastColumn === 'H') {
        return tag.replace(/\bref="[^"]+"/, 'ref="F30:I30"');
      }
      if (startRow >= 30 && endRow <= 43
        && columnNumber(firstColumn) >= columnNumber('I')
        && columnNumber(lastColumn) <= columnNumber('K')) {
        return tag.replace(/\bref="[^"]+"/, `ref="${columnLabel(columnNumber(firstColumn) + 1)}${firstRow}:${columnLabel(columnNumber(lastColumn) + 1)}${lastRow}"`);
      }
      return tag;
    });

  nextXml = nextXml.replace(/(<c\b(?=[^>]*\br="(?:B12|B15|B9|B(?:3[2-9]|4[01]))")[^>]*\/>|<c\b(?=[^>]*\br="(?:B12|B15|B9|B(?:3[2-9]|4[01]))")[^>]*>[\s\S]*?<\/c>)/gi,
    cellTag => clearFormulaCell(cellTag));
  nextXml = nextXml.replace(/<extLst\b[^>]*>[\s\S]*?<\/extLst>/gi, extensionList => {
    const cleaned = extensionList
      .replace(/<x14:dataValidations\b[^>]*>[\s\S]*?#REF![\s\S]*?<\/x14:dataValidations>/gi, '')
      .replace(/<ext\b[^>]*>\s*<\/ext>/gi, '');
    return /<ext\b/i.test(cleaned) ? cleaned : '';
  });
  return nextXml;
}

function updateSelectedSheet(workbookXml, sourceSheet, selectedSheet, sourceSheetIndex) {
  let result = workbookXml.replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/, '')
    .replace(/firstSheet="\d+"/, 'firstSheet="0"')
    .replace(/activeTab="\d+"/, 'activeTab="0"')
    .replace(/<sheets>[\s\S]*?<\/sheets>/,
      `<sheets>${selectedSheet.replace(attribute(selectedSheet, 'name'), sheetName)}</sheets>`);
  result = result.replace(/<definedNames>[\s\S]*?<\/definedNames>/, block => {
    const names = [...block.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)]
      .filter(match => Number(attribute(`<definedName${match[1]}>`, 'localSheetId')) === sourceSheetIndex)
      .map(match => `<definedName${match[1].replace(/localSheetId="\d+"/, 'localSheetId="0"')}>${match[2].replaceAll(sourceSheet, sheetName)}</definedName>`);
    return names.length ? `<definedNames>${names.join('')}</definedNames>` : '';
  });
  return result;
}

async function main() {
  if (!sourcePath) throw new Error('Pass the path to the teacher-supplied SF9 workbook.');
  const source = await JSZip.loadAsync(await fs.readFile(path.resolve(sourcePath)));
  const output = new JSZip();
  const workbookPath = 'xl/workbook.xml';
  const workbookXml = await source.file(workbookPath)?.async('string');
  const workbookRelationships = await source.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!workbookXml || !workbookRelationships) throw new Error('The supplied SF9 workbook is incomplete.');

  const sheets = [...workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/g)].map(match => match[0]);
  const selectedSheet = sheets.find(tag => attribute(tag, 'name') === sheetName);
  if (!selectedSheet) throw new Error(`The supplied workbook does not contain ${sheetName}.`);
  const selectedIndex = sheets.indexOf(selectedSheet);
  const sourceSheetRelationshipId = attribute(selectedSheet, 'r:id');
  const sourceSheetRelationship = relationshipTags(workbookRelationships)
    .find(tag => attribute(tag, 'Id') === sourceSheetRelationshipId);
  if (!sourceSheetRelationship) throw new Error('The SF9 worksheet relationship is missing.');

  const sourceSheetPath = resolvePart(workbookPath, attribute(sourceSheetRelationship, 'Target'));
  const sourceWorksheetXml = await source.file(sourceSheetPath)?.async('string');
  if (!sourceWorksheetXml) throw new Error('The SF9 worksheet is unavailable.');
  const sourceSheetRelationshipsPath = path.posix.join(path.posix.dirname(sourceSheetPath), '_rels', `${path.posix.basename(sourceSheetPath)}.rels`);
  const sourceSheetRelationships = await source.file(sourceSheetRelationshipsPath)?.async('string');
  if (!sourceSheetRelationships) throw new Error('The SF9 worksheet relationships are unavailable.');

  let drawingSourcePath = '';
  let printerSourcePath = '';
  for (const tag of relationshipTags(sourceSheetRelationships)) {
    const type = relationshipType(tag);
    const target = resolvePart(sourceSheetPath, attribute(tag, 'Target'));
    if (type === 'drawing') drawingSourcePath = target;
    else if (type === 'printerSettings') printerSourcePath = target;
    else throw new Error(`Unsupported SF9 worksheet relationship: ${type}.`);
  }
  if (!drawingSourcePath || !printerSourcePath) throw new Error('The SF9 worksheet must preserve its image and print settings.');

  const outputWorksheetPath = sourceSheetPath;
  const outputRelationshipsPath = sourceSheetRelationshipsPath;
  output.file(outputWorksheetPath, transformSf9Worksheet(sourceWorksheetXml));
  output.file(outputRelationshipsPath, sourceSheetRelationships);
  await copyPart(source, output, drawingSourcePath);
  await copyPart(source, output, printerSourcePath);
  const drawingRelationshipsPath = path.posix.join(path.posix.dirname(drawingSourcePath), '_rels', `${path.posix.basename(drawingSourcePath)}.rels`);
  const drawingRelationships = await source.file(drawingRelationshipsPath)?.async('string');
  if (!drawingRelationships) throw new Error('The SF9 image relationship is missing.');
  for (const tag of relationshipTags(drawingRelationships)) {
    if (relationshipType(tag) !== 'image') throw new Error('The SF9 drawing contains an unsupported relationship.');
    await copyPart(source, output, resolvePart(drawingSourcePath, attribute(tag, 'Target')));
  }
  output.file(drawingRelationshipsPath, drawingRelationships);

  const requiredWorkbookRelationships = [];
  for (const tag of relationshipTags(workbookRelationships)) {
    const type = relationshipType(tag);
    if (attribute(tag, 'Id') === sourceSheetRelationshipId) {
      requiredWorkbookRelationships.push(tag);
    } else if (['theme', 'styles', 'sharedStrings'].includes(type)) {
      requiredWorkbookRelationships.push(tag);
      await copyPart(source, output, resolvePart(workbookPath, attribute(tag, 'Target')));
    }
  }
  if (requiredWorkbookRelationships.length < 4) throw new Error('The SF9 workbook is missing styles or shared strings.');
  output.file('xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${requiredWorkbookRelationships.join('')}</Relationships>`);

  output.file(workbookPath, updateSelectedSheet(workbookXml, sheetName, selectedSheet, selectedIndex));
  const rootRelationships = await source.file('_rels/.rels')?.async('string');
  if (!rootRelationships) throw new Error('The SF9 workbook package metadata is missing.');
  output.file('_rels/.rels', rootRelationships.replace(/<Relationship\b[^>]*\/>/g, tag => (
    ['officeDocument', 'core-properties'].includes(relationshipType(tag)) ? tag : ''
  )));
  await copyPart(source, output, 'docProps/core.xml');

  const contentTypes = await source.file('[Content_Types].xml')?.async('string');
  if (!contentTypes) throw new Error('The SF9 workbook content types are missing.');
  const retained = new Set(['/xl/workbook.xml', `/${sourceSheetPath}`, '/xl/theme/theme1.xml',
    '/xl/styles.xml', '/xl/sharedStrings.xml', `/${drawingSourcePath}`, '/docProps/core.xml']);
  const retainedParts = new Set();
  const filtered = contentTypes.replace(/<Override\b[^>]*\/>/g, tag => {
    const partName = attribute(tag, 'PartName');
    if (!retained.has(partName) || retainedParts.has(partName)) return '';
    retainedParts.add(partName);
    return tag;
  });
  const printSettings = filtered.includes('printerSettings') ? filtered
    : filtered.replace('</Types>', '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"/></Types>');
  output.file('[Content_Types].xml', retainedParts.has(`/${drawingSourcePath}`) ? printSettings
    : printSettings.replace('</Types>',
      `<Override PartName="/${drawingSourcePath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`));

  await fs.writeFile(outputPath, await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  process.stdout.write(`Extracted ${outputPath}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
