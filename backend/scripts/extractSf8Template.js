const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');

const sourcePath = process.argv[2];
const sheetName = 'Nutritional Status';
const outputPath = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms', 'sf8.xlsx');

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

function getCollection(xml, name) {
  const match = new RegExp(`<${name}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${name}>)`).exec(xml);
  if (!match) throw new Error(`The supplied SF8 workbook is missing its ${name} collection.`);
  return { full: match[0], attributes: match[1], body: match[2] || '', selfClosing: /\/>$/.test(match[0]) };
}

function collectionItems(body, name) {
  return [...body.matchAll(new RegExp(`<${name}\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/${name}>)`, 'g'))]
    .map(match => match[0]);
}

function updateCollection(xml, name, added) {
  if (!added.length) return xml;
  const collection = getCollection(xml, name);
  const count = Number(/\bcount="(\d+)"/.exec(collection.attributes)?.[1] || 0);
  const attributes = collection.attributes.replace(/\bcount="\d+"/, `count="${count + added.length}"`);
  const replacement = collection.selfClosing
    ? `<${name}${attributes}>${added.join('')}</${name}>`
    : collection.full.replace(/count="\d+"/, `count="${count + added.length}"`)
      .replace(`</${name}>`, `${added.join('')}</${name}>`);
  return xml.replace(collection.full, replacement);
}

function setAttribute(tag, name, value) {
  const attributePattern = new RegExp(`\\b${name}="[^"]*"`);
  if (attributePattern.test(tag)) return tag.replace(attributePattern, `${name}="${value}"`);
  return tag.replace(/^(<[^>]+?)(\s*\/?>)/, (match, opening, ending) => `${opening} ${name}="${value}"${ending}`);
}

function applyBirthdateNumberFormat(stylesXml, worksheetXml) {
  const numFmts = getCollection(stylesXml, 'numFmts');
  const formats = collectionItems(numFmts.body, 'numFmt');
  const existingFormat = formats.find(item => attribute(item, 'formatCode').toLowerCase() === 'mm/dd/yyyy');
  const formatId = existingFormat
    ? Number(attribute(existingFormat, 'numFmtId'))
    : Math.max(163, ...formats.map(item => Number(attribute(item, 'numFmtId')) || 0)) + 1;
  const updatedStyles = existingFormat ? stylesXml : updateCollection(stylesXml, 'numFmts', [
    `<numFmt numFmtId="${formatId}" formatCode="mm/dd/yyyy"/>`
  ]);

  const cellXfs = getCollection(updatedStyles, 'cellXfs');
  const xfs = collectionItems(cellXfs.body, 'xf');
  const styleBySource = new Map();
  const newStyles = [];
  let updatedWorksheet = worksheetXml;
  for (const row of [...Array.from({ length: 52 }, (_, index) => index + 12),
    ...Array.from({ length: 44 }, (_, index) => index + 65)]) {
    const address = `G${row}`;
    const cellPattern = new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*(?:\\/>|>)`, 'i');
    const cellTag = cellPattern.exec(updatedWorksheet)?.[0];
    if (!cellTag) throw new Error(`The supplied SF8 worksheet is missing birthdate cell ${address}.`);
    const sourceStyleId = Number(attribute(cellTag, 's') || 0);
    if (!xfs[sourceStyleId]) throw new Error(`The supplied SF8 birthdate cell ${address} has an invalid style.`);
    if (!styleBySource.has(sourceStyleId)) {
      let style = setAttribute(xfs[sourceStyleId], 'numFmtId', formatId);
      style = setAttribute(style, 'applyNumberFormat', '1');
      styleBySource.set(sourceStyleId, xfs.length + newStyles.length);
      newStyles.push(style);
    }
    const nextStyleId = styleBySource.get(sourceStyleId);
    const updatedCell = setAttribute(cellTag, 's', nextStyleId);
    updatedWorksheet = updatedWorksheet.replace(cellTag, updatedCell);
  }

  return {
    stylesXml: updateCollection(updatedStyles, 'cellXfs', newStyles),
    worksheetXml: updatedWorksheet
  };
}

async function copyPart(source, output, sourceName, outputName = sourceName) {
  const file = source.file(sourceName);
  if (!file) throw new Error(`The supplied SF8 workbook is missing ${sourceName}.`);
  output.file(outputName, await file.async('nodebuffer'));
}

async function main() {
  if (!sourcePath) throw new Error('Pass the path to the teacher-supplied SF8 workbook.');
  const source = await JSZip.loadAsync(await fs.readFile(path.resolve(sourcePath)));
  const output = new JSZip();
  const workbookPath = 'xl/workbook.xml';
  const workbookXml = await source.file(workbookPath)?.async('string');
  const workbookRelationships = await source.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!workbookXml || !workbookRelationships) throw new Error('The supplied SF8 workbook is incomplete.');

  const sheets = [...workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/g)].map(match => match[0]);
  const selectedSheet = sheets.find(tag => attribute(tag, 'name') === sheetName);
  if (!selectedSheet) throw new Error(`The supplied workbook does not contain ${sheetName}.`);
  const sourceSheetRelationshipId = attribute(selectedSheet, 'r:id');
  const sourceSheetRelationship = relationshipTags(workbookRelationships)
    .find(tag => attribute(tag, 'Id') === sourceSheetRelationshipId);
  if (!sourceSheetRelationship) throw new Error('The SF8 worksheet relationship is missing.');

  const sourceSheetPath = resolvePart(workbookPath, attribute(sourceSheetRelationship, 'Target'));
  const sourceWorksheetXml = await source.file(sourceSheetPath)?.async('string');
  if (!sourceWorksheetXml) throw new Error('The SF8 worksheet is unavailable.');
  const stylesRelationship = relationshipTags(workbookRelationships)
    .find(tag => relationshipType(tag) === 'styles');
  if (!stylesRelationship) throw new Error('The supplied SF8 workbook is missing its styles relationship.');
  const sourceStylesPath = resolvePart(workbookPath, attribute(stylesRelationship, 'Target'));
  const sourceStylesXml = await source.file(sourceStylesPath)?.async('string');
  if (!sourceStylesXml) throw new Error('The supplied SF8 workbook styles are unavailable.');
  const formattedTemplate = applyBirthdateNumberFormat(sourceStylesXml, sourceWorksheetXml);

  const sourceSheetRelationshipsPath = path.posix.join(path.posix.dirname(sourceSheetPath), '_rels', `${path.posix.basename(sourceSheetPath)}.rels`);
  const sourceSheetRelationships = await source.file(sourceSheetRelationshipsPath)?.async('string');
  if (!sourceSheetRelationships) throw new Error('The SF8 worksheet is missing its package relationships.');

  const outputSheetPath = 'xl/worksheets/sheet1.xml';
  const outputSheetRelationshipsPath = 'xl/worksheets/_rels/sheet1.xml.rels';
  let outputDrawingNumber = 0;
  let outputPrinterNumber = 0;
  const drawingPaths = [];
  const outputSheetRelationships = [];
  for (const tag of relationshipTags(sourceSheetRelationships)) {
    const type = relationshipType(tag);
    const target = resolvePart(sourceSheetPath, attribute(tag, 'Target'));
    if (type === 'drawing') {
      outputDrawingNumber += 1;
      drawingPaths.push(target);
      outputSheetRelationships.push(tag.replace(attribute(tag, 'Target'), `../drawings/drawing${outputDrawingNumber}.xml`));
    } else if (type === 'printerSettings') {
      outputPrinterNumber += 1;
      await copyPart(source, output, target, `xl/printerSettings/printerSettings${outputPrinterNumber}.bin`);
      outputSheetRelationships.push(tag.replace(attribute(tag, 'Target'), `../printerSettings/printerSettings${outputPrinterNumber}.bin`));
    } else {
      throw new Error(`Unsupported SF8 worksheet relationship: ${type}.`);
    }
  }
  if (outputDrawingNumber !== 1 || outputPrinterNumber !== 1) {
    throw new Error('The supplied SF8 worksheet must contain its official drawing and print settings.');
  }

  output.file(outputSheetPath, formattedTemplate.worksheetXml);
  output.file(outputSheetRelationshipsPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${outputSheetRelationships.join('')}</Relationships>`);

  let drawingNumber = 0;
  let mediaNumber = 0;
  for (const drawingPath of drawingPaths) {
    drawingNumber += 1;
    const sourceDrawingRelationshipsPath = path.posix.join(path.posix.dirname(drawingPath), '_rels', `${path.posix.basename(drawingPath)}.rels`);
    let drawingRelationships = await source.file(sourceDrawingRelationshipsPath)?.async('string');
    if (!drawingRelationships) throw new Error('The SF8 image drawing is missing its relationships.');
    const rewritten = [];
    for (const tag of relationshipTags(drawingRelationships)) {
      if (relationshipType(tag) !== 'image') throw new Error('The SF8 drawing contains an unsupported relationship.');
      const sourceImagePath = resolvePart(drawingPath, attribute(tag, 'Target'));
      const extension = path.posix.extname(sourceImagePath).toLowerCase();
      mediaNumber += 1;
      const outputImagePath = `xl/media/image${mediaNumber}${extension}`;
      await copyPart(source, output, sourceImagePath, outputImagePath);
      rewritten.push(tag.replace(attribute(tag, 'Target'), `../media/${path.posix.basename(outputImagePath)}`));
    }
    const outputDrawingPath = `xl/drawings/drawing${drawingNumber}.xml`;
    await copyPart(source, output, drawingPath, outputDrawingPath);
    output.file(`xl/drawings/_rels/drawing${drawingNumber}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rewritten.join('')}</Relationships>`);
  }

  const workbookRelationshipsTags = relationshipTags(workbookRelationships);
  const nextId = Math.max(0, ...workbookRelationshipsTags.map(tag => Number(/^rId(\d+)$/.exec(attribute(tag, 'Id'))?.[1] || 0))) + 1;
  const outputSheetRelationshipId = `rId${nextId}`;
  const commonRelationships = [];
  for (const tag of workbookRelationshipsTags) {
    const type = relationshipType(tag);
    if (attribute(tag, 'Id') === sourceSheetRelationshipId) {
      commonRelationships.push(tag.replace(`Id="${sourceSheetRelationshipId}"`, `Id="${outputSheetRelationshipId}"`)
        .replace(attribute(tag, 'Target'), 'worksheets/sheet1.xml'));
    } else if (type === 'styles') {
      output.file(resolvePart(workbookPath, attribute(tag, 'Target')), formattedTemplate.stylesXml);
      commonRelationships.push(tag);
    } else if (['theme', 'sharedStrings'].includes(type)) {
      commonRelationships.push(tag);
      await copyPart(source, output, resolvePart(workbookPath, attribute(tag, 'Target')));
    }
  }
  if (commonRelationships.length < 4) throw new Error('The supplied SF8 workbook is missing styles or shared strings.');
  output.file('xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${commonRelationships.join('')}</Relationships>`);

  let selectedWorkbook = workbookXml.replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/, '')
    .replace(/activeTab="\d+"/, 'activeTab="0"')
    .replace(/<sheets>[\s\S]*?<\/sheets>/,
      `<sheets><sheet name="School Form 8 (SF8)" sheetId="1" r:id="${outputSheetRelationshipId}"/></sheets>`);
  const selectedIndex = sheets.indexOf(selectedSheet);
  selectedWorkbook = selectedWorkbook.replace(/<definedNames>[\s\S]*?<\/definedNames>/, block => {
    const names = [...block.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)]
      .filter(match => Number(attribute(`<definedName${match[1]}>`, 'localSheetId')) === selectedIndex)
      .map(match => `<definedName${match[1].replace(/localSheetId="\d+"/, 'localSheetId="0"')}>${match[2].replaceAll(sheetName, 'School Form 8 (SF8)')}</definedName>`);
    return names.length ? `<definedNames>${names.join('')}</definedNames>` : '';
  });
  output.file(workbookPath, selectedWorkbook);

  const rootRelationships = await source.file('_rels/.rels')?.async('string');
  if (!rootRelationships) throw new Error('The supplied SF8 workbook is missing package metadata.');
  output.file('_rels/.rels', rootRelationships.replace(/<Relationship\b[^>]*\/>/g, tag => (
    ['officeDocument', 'core-properties'].includes(relationshipType(tag)) ? tag : ''
  )));
  await copyPart(source, output, 'docProps/core.xml');

  const contentTypes = await source.file('[Content_Types].xml')?.async('string');
  if (!contentTypes) throw new Error('The supplied SF8 workbook is missing content types.');
  const retainedOverrides = new Set([
    '/xl/workbook.xml', '/xl/worksheets/sheet1.xml', '/xl/theme/theme1.xml', '/xl/styles.xml',
    '/xl/sharedStrings.xml', '/xl/drawings/drawing1.xml', '/docProps/core.xml'
  ]);
  const filteredContentTypes = contentTypes.replace(/<Override\b[^>]*\/>/g, tag => (
    retainedOverrides.has(attribute(tag, 'PartName')) ? tag : ''
  ));
  const withPrinterTypes = filteredContentTypes.includes('printerSettings') ? filteredContentTypes
    : filteredContentTypes.replace('</Types>', '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"/></Types>');
  const withImageTypes = ['jpeg', 'png'].reduce((xml, extension) => {
    if (mediaNumber && !new RegExp(`<Default\\b[^>]*Extension="${extension}"`, 'i').test(xml)) {
      const contentType = extension === 'png' ? 'image/png' : 'image/jpeg';
      return xml.replace('</Types>', `<Default Extension="${extension}" ContentType="${contentType}"/></Types>`);
    }
    return xml;
  }, withPrinterTypes);
  const drawingOverride = '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>';
  output.file('[Content_Types].xml', withImageTypes.replace('</Types>', `${drawingOverride}</Types>`));

  await fs.writeFile(outputPath, await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  process.stdout.write(`Extracted ${outputPath}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
