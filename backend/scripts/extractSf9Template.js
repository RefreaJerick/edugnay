const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');

const sourcePath = process.argv[2];
const variants = {
  'grade4-10': {
    sheetName: 'SF9 - GRADE 4-10',
    outputFile: 'sf9.xlsx',
    sourceSheetName: 'SF9 - GRADE 4-10',
    clearAddresses: ['B9', 'B12', 'B15', ...Array.from({ length: 10 }, (_, index) => `B${32 + index}`)]
  },
  'grade11-academic': {
    sheetName: 'SF9 - GRADE 11 ACADEMIC',
    outputFile: 'sf9-g11-academic.xlsx',
    sourceSheetName: 'SF9 - GRADE 11 ACADEMIC',
    clearAddresses: ['B7', 'B8', 'B9', 'B10', 'B12', 'B15', 'C17', 'I17', 'K17', 'C18', 'I18', 'K18',
      'E19', 'B27', 'H27', ...['R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC']
        .flatMap(column => Array.from({ length: 6 }, (_, index) => `${column}${5 + index}`))],
    labels: {
      B33: 'Effective Communication / Mabisang Komunikasyon',
      B34: 'Effective Communication',
      B35: 'Mabisang Komunikasyon',
      B39: 'Pag-aaral ng Kasaysayan at Lipunang Pilipino'
    }
  }
};
const variantName = process.argv[3] || 'grade4-10';
const variant = variants[variantName];
const outputPath = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms', variant?.outputFile || '');

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

function clearFormulaCell(cellTag) {
  const opening = /^<c\b[^>]*>/.exec(cellTag)?.[0];
  if (!opening) return cellTag;
  const attributes = opening.slice(2, -1).replace(/\/$/, '').replace(/\s+t="[^"]*"/i, '');
  return `<c${attributes}/>`;
}

function transformSf9Worksheet(xml, options) {
  const clearAddresses = new Set(options.clearAddresses);
  let nextXml = xml.replace(/<row\b[^>]*>[\s\S]*?<\/row>/g, rowXml => {
    const rowNumber = Number(/\br="(\d+)"/.exec(rowXml)?.[1] || 0);
    return rowXml.replace(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g, cellTag => {
      const address = /\br="([A-Z]+)(\d+)"/i.exec(cellTag);
      if (!address) return cellTag;
      const cellRow = Number(address[2]);
      const cellColumn = address[1].toUpperCase();
      const cellAddress = `${cellColumn}${cellRow}`;
      if (options.labels?.[cellAddress]) return setInlineCell(cellTag, options.labels[cellAddress]);
      const isFormula = /<f\b/i.test(cellTag)
        || (options.sheetName === 'SF9 - GRADE 4-10' && /^I(?:3[2-9]|4[0-3])$/.test(`${cellColumn}${cellRow}`));
      if (clearAddresses.has(`${cellColumn}${cellRow}`)) return clearFormulaCell(cellTag);
      return rewriteCell(cellTag, rowNumber, null, isFormula ? 'clear' : null);
    });
  });

  if (options.sheetName === 'SF9 - GRADE 4-10') {
    nextXml = nextXml.replace(/(<c\b(?=[^>]*\br="(?:B12|B15|B9|B(?:3[2-9]|4[01]))")[^>]*\/>|<c\b(?=[^>]*\br="(?:B12|B15|B9|B(?:3[2-9]|4[01]))")[^>]*>[\s\S]*?<\/c>)/gi,
      cellTag => clearFormulaCell(cellTag));
  }
  nextXml = nextXml.replace(/<extLst\b[^>]*>[\s\S]*?<\/extLst>/gi, extensionList => {
    const cleaned = extensionList
      .replace(/<x14:dataValidations\b[^>]*>[\s\S]*?#REF![\s\S]*?<\/x14:dataValidations>/gi, '')
      .replace(/<ext\b[^>]*>\s*<\/ext>/gi, '');
    return /<ext\b/i.test(cleaned) ? cleaned : '';
  });
  return nextXml;
}

function updateSelectedSheet(workbookXml, sourceSheet, selectedSheet, sourceSheetIndex, targetSheetName) {
  let result = workbookXml.replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/, '')
    .replace(/firstSheet="\d+"/, 'firstSheet="0"')
    .replace(/activeTab="\d+"/, 'activeTab="0"')
    .replace(/<sheets>[\s\S]*?<\/sheets>/,
      `<sheets>${selectedSheet.replace(attribute(selectedSheet, 'name'), targetSheetName)}</sheets>`);
  result = result.replace(/<definedNames>[\s\S]*?<\/definedNames>/, block => {
    const names = [...block.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)]
      .filter(match => Number(attribute(`<definedName${match[1]}>`, 'localSheetId')) === sourceSheetIndex)
      .map(match => `<definedName${match[1].replace(/localSheetId="\d+"/, 'localSheetId="0"')}>${match[2].replaceAll(sourceSheet, targetSheetName)}</definedName>`);
    return names.length ? `<definedNames>${names.join('')}</definedNames>` : '';
  });
  return result;
}

async function main() {
  if (!sourcePath) throw new Error('Pass the path to the teacher-supplied SF9 workbook.');
  if (!variant) throw new Error(`Unknown SF9 workbook variant "${variantName}". Choose grade4-10 or grade11-academic.`);
  const source = await JSZip.loadAsync(await fs.readFile(path.resolve(sourcePath)));
  const output = new JSZip();
  const workbookPath = 'xl/workbook.xml';
  const workbookXml = await source.file(workbookPath)?.async('string');
  const workbookRelationships = await source.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!workbookXml || !workbookRelationships) throw new Error('The supplied SF9 workbook is incomplete.');

  const sheets = [...workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/g)].map(match => match[0]);
  const selectedSheet = sheets.find(tag => attribute(tag, 'name') === variant.sourceSheetName);
  if (!selectedSheet) throw new Error(`The supplied workbook does not contain ${variant.sourceSheetName}.`);
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
  output.file(outputWorksheetPath, transformSf9Worksheet(sourceWorksheetXml, variant));
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

  output.file(workbookPath, updateSelectedSheet(workbookXml, variant.sourceSheetName, selectedSheet, selectedIndex, variant.sheetName));
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
