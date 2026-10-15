const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { createTemplate } = require('./buildSfWorkbookTemplates');

const templateDirectory = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms');
const sf8SheetName = 'School Form 8 (SF8)';

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}="([^"]*)"`).exec(tag)?.[1] || '';
}

function relationshipTags(xml) {
  return [...xml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)].map(match => match[0]);
}

function resolvePart(basePart, target) {
  if (target.startsWith('/')) return target.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(basePart), target));
}

function relationshipType(tag) {
  return attribute(tag, 'Type').split('/').pop();
}

function nextPartNumber(zip, expression) {
  return Math.max(0, ...Object.keys(zip.files).map(name => Number(expression.exec(name)?.[1] || 0))) + 1;
}

function getCollection(xml, name) {
  const match = new RegExp(`<${name}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${name}>)`).exec(xml);
  if (!match) throw new Error(`The workbook is missing its ${name} style collection.`);
  return { full: match[0], attributes: match[1], body: match[2] || '', selfClosing: /\/>$/.test(match[0]) };
}

function collectionItems(body, name) {
  return [...body.matchAll(new RegExp(`<${name}\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/${name}>)`, 'g'))]
    .map(match => match[0]);
}

function updateCollection(xml, name, added) {
  const collection = getCollection(xml, name);
  const count = Number(/\bcount="(\d+)"/.exec(collection.attributes)?.[1] || 0);
  const updatedAttributes = collection.attributes.replace(/\bcount="\d+"/, `count="${count + added.length}"`);
  const next = collection.selfClosing
    ? `<${name}${updatedAttributes}>${added.join('')}</${name}>`
    : collection.full.replace(/count="\d+"/, `count="${count + added.length}"`)
      .replace(`</${name}>`, `${added.join('')}</${name}>`);
  return xml.replace(collection.full, next);
}

function shiftAttribute(tag, name, offset) {
  return tag.replace(new RegExp(`(\\b${name}=")(\\d+)(")`), (match, prefix, value, suffix) => (
    `${prefix}${Number(value) + offset}${suffix}`
  ));
}

function mergeStyles(baseXml, sourceXml) {
  let result = baseXml;
  const baseNumFmts = getCollection(result, 'numFmts');
  const sourceNumFmts = getCollection(sourceXml, 'numFmts');
  const baseNumFmtIds = collectionItems(baseNumFmts.body, 'numFmt')
    .map(item => Number(/\bnumFmtId="(\d+)"/.exec(item)?.[1] || 0));
  let nextNumFmtId = Math.max(163, ...baseNumFmtIds) + 1;
  const numberFormatMap = new Map();
  const addedNumFmts = collectionItems(sourceNumFmts.body, 'numFmt').map(item => {
    const sourceId = Number(/\bnumFmtId="(\d+)"/.exec(item)?.[1] || 0);
    const next = nextNumFmtId++;
    numberFormatMap.set(sourceId, next);
    return item.replace(/(\bnumFmtId=")\d+("?)/, `$1${next}$2`);
  });
  result = updateCollection(result, 'numFmts', collectionItems(sourceNumFmts.body, 'numFmt').length ? addedNumFmts : []);

  const offsets = {};
  for (const [collection, itemName] of [['fonts', 'font'], ['fills', 'fill'], ['borders', 'border'],
    ['cellStyleXfs', 'xf'], ['cellXfs', 'xf'], ['cellStyles', 'cellStyle'], ['dxfs', 'dxf']]) {
    const baseItems = collectionItems(getCollection(result, collection).body, itemName);
    const sourceItems = collectionItems(getCollection(sourceXml, collection).body, itemName);
    offsets[collection] = baseItems.length;
    const added = sourceItems.map(item => {
      let next = item;
      if (['cellStyleXfs', 'cellXfs'].includes(collection)) {
        next = shiftAttribute(next, 'fontId', offsets.fonts);
        next = shiftAttribute(next, 'fillId', offsets.fills);
        next = shiftAttribute(next, 'borderId', offsets.borders);
        next = shiftAttribute(next, 'xfId', offsets.cellStyleXfs);
        const formatId = Number(/\bnumFmtId="(\d+)"/.exec(next)?.[1] || 0);
        if (numberFormatMap.has(formatId)) next = next.replace(/(\bnumFmtId=")\d+("?)/, `$1${numberFormatMap.get(formatId)}$2`);
      } else if (collection === 'cellStyles') {
        next = shiftAttribute(next, 'xfId', offsets.cellStyleXfs);
      }
      return next;
    });
    result = updateCollection(result, collection, added);
  }
  return { stylesXml: result, cellXfOffset: offsets.cellXfs, dxfOffset: offsets.dxfs };
}

function mergeSharedStrings(baseXml, sourceXml) {
  const base = getCollection(baseXml, 'sst');
  const source = getCollection(sourceXml, 'sst');
  const baseItems = collectionItems(base.body, 'si');
  const sourceItems = collectionItems(source.body, 'si');
  const offset = baseItems.length;
  let result = baseXml.replace(base.full, base.full
    .replace(/count="\d+"/, `count="${Number(/\bcount="(\d+)"/.exec(base.attributes)?.[1] || 0)
      + Number(/\bcount="(\d+)"/.exec(source.attributes)?.[1] || sourceItems.length)}"`)
    .replace(/uniqueCount="\d+"/, `uniqueCount="${baseItems.length + sourceItems.length}"`)
    .replace(`</sst>`, `${sourceItems.join('')}</sst>`));
  return { sharedStringsXml: result, offset };
}

function shiftSharedStringIndexes(xml, offset) {
  return xml.replace(/<c\b(?=[^>]*\bt="s")[^>]*>[\s\S]*?<\/c>/g, cell => cell.replace(/<v>(\d+)<\/v>/,
    (match, index) => `<v>${Number(index) + offset}</v>`));
}

function shiftWorksheetStyles(xml, offset, dxfOffset) {
  return xml.replace(/<(c|row)\b[^>]*>/g, tag => {
    if (tag.startsWith('<c')) return shiftAttribute(tag, 's', offset);
    return shiftAttribute(tag, 's', offset);
  }).replace(/<col\b[^>]*>/g, tag => shiftAttribute(tag, 'style', offset))
    .replace(/<cfRule\b[^>]*>/g, tag => shiftAttribute(tag, 'dxfId', dxfOffset));
}

function addContentType(xml, type) {
  if (type.kind === 'default') {
    if (new RegExp(`<Default\\b[^>]*\\bExtension="${type.extension}"`, 'i').test(xml)) return xml;
    return xml.replace('</Types>', `<Default Extension="${type.extension}" ContentType="${type.contentType}"/></Types>`);
  }
  return xml.replace('</Types>', `<Override PartName="/${type.part}" ContentType="${type.contentType}"/></Types>`);
}

async function appendSf8Worksheet(baseZip, sf8Zip) {
  const workbookPath = 'xl/workbook.xml';
  let workbookXml = await baseZip.file(workbookPath).async('string');
  let workbookRelationships = await baseZip.file('xl/_rels/workbook.xml.rels').async('string');
  const sourceWorkbookXml = await sf8Zip.file(workbookPath).async('string');
  const sourceWorkbookRelationships = await sf8Zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sourceSheetTag = [...sourceWorkbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/g)].map(match => match[0])
    .find(tag => attribute(tag, 'name') === sf8SheetName);
  if (!sourceSheetTag) throw new Error('The standalone SF8 template is missing its report worksheet.');
  const sourceSheetRelId = attribute(sourceSheetTag, 'r:id');
  const sourceSheetRel = relationshipTags(sourceWorkbookRelationships)
    .find(tag => attribute(tag, 'Id') === sourceSheetRelId);
  if (!sourceSheetRel) throw new Error('The SF8 worksheet relationship is missing.');
  const sourceSheetPath = resolvePart(workbookPath, attribute(sourceSheetRel, 'Target'));
  const sourceSheetXmlOriginal = await sf8Zip.file(sourceSheetPath)?.async('string');
  const sourceSheetRelationshipsPath = path.posix.join(path.posix.dirname(sourceSheetPath), '_rels', `${path.posix.basename(sourceSheetPath)}.rels`);
  const sourceSheetRelationships = await sf8Zip.file(sourceSheetRelationshipsPath)?.async('string');
  if (!sourceSheetXmlOriginal || !sourceSheetRelationships) throw new Error('The SF8 worksheet package is incomplete.');

  const baseSharedStringsPath = 'xl/sharedStrings.xml';
  const sourceSharedStringsPath = 'xl/sharedStrings.xml';
  const baseSharedStrings = await baseZip.file(baseSharedStringsPath)?.async('string');
  const sourceSharedStrings = await sf8Zip.file(sourceSharedStringsPath)?.async('string');
  const baseStyles = await baseZip.file('xl/styles.xml')?.async('string');
  const sourceStyles = await sf8Zip.file('xl/styles.xml')?.async('string');
  if (!baseSharedStrings || !sourceSharedStrings || !baseStyles || !sourceStyles) {
    throw new Error('The combined SF8 workbook is missing shared strings or cell styles.');
  }
  const mergedStrings = mergeSharedStrings(baseSharedStrings, sourceSharedStrings);
  baseZip.file(baseSharedStringsPath, mergedStrings.sharedStringsXml);
  const mergedStyles = mergeStyles(baseStyles, sourceStyles);
  baseZip.file('xl/styles.xml', mergedStyles.stylesXml);

  const worksheetNumber = nextPartNumber(baseZip, /^xl\/worksheets\/sheet(\d+)\.xml$/);
  const worksheetPath = `xl/worksheets/sheet${worksheetNumber}.xml`;
  const worksheetRelationshipsPath = `xl/worksheets/_rels/sheet${worksheetNumber}.xml.rels`;
  const drawingNumber = nextPartNumber(baseZip, /^xl\/drawings\/drawing(\d+)\.xml$/);
  const printerNumber = nextPartNumber(baseZip, /^xl\/printerSettings\/printerSettings(\d+)\.bin$/);
  const mediaNumbers = new Map();
  let nextMedia = nextPartNumber(baseZip, /^xl\/media\/image(\d+)\./);
  let drawingPath = null;
  const rewrittenSheetRelationships = [];
  for (const tag of relationshipTags(sourceSheetRelationships)) {
    const type = relationshipType(tag);
    const target = resolvePart(sourceSheetPath, attribute(tag, 'Target'));
    if (type === 'drawing') {
      drawingPath = target;
      rewrittenSheetRelationships.push(tag.replace(attribute(tag, 'Target'), `../drawings/drawing${drawingNumber}.xml`));
    } else if (type === 'printerSettings') {
      const outputPath = `xl/printerSettings/printerSettings${printerNumber}.bin`;
      baseZip.file(outputPath, await sf8Zip.file(target).async('nodebuffer'));
      rewrittenSheetRelationships.push(tag.replace(attribute(tag, 'Target'), `../printerSettings/printerSettings${printerNumber}.bin`));
    } else {
      throw new Error(`Unsupported SF8 worksheet relationship: ${type}.`);
    }
  }
  if (!drawingPath) throw new Error('The SF8 worksheet image is missing.');

  const sourceDrawingRelationshipsPath = path.posix.join(path.posix.dirname(drawingPath), '_rels', `${path.posix.basename(drawingPath)}.rels`);
  const sourceDrawingRelationships = await sf8Zip.file(sourceDrawingRelationshipsPath)?.async('string');
  if (!sourceDrawingRelationships) throw new Error('The SF8 drawing relationships are missing.');
  const rewrittenDrawingRelationships = [];
  const sourceDrawingPath = drawingPath;
  const drawingRelationships = relationshipTags(sourceDrawingRelationships);
  for (const tag of drawingRelationships) {
    if (relationshipType(tag) !== 'image') throw new Error('The SF8 worksheet contains an unsupported drawing relationship.');
    const sourceImage = resolvePart(sourceDrawingPath, attribute(tag, 'Target'));
    const extension = path.posix.extname(sourceImage).toLowerCase();
    const outputMedia = `xl/media/image${nextMedia++}${extension}`;
    mediaNumbers.set(sourceImage, outputMedia);
    baseZip.file(outputMedia, await sf8Zip.file(sourceImage).async('nodebuffer'));
    rewrittenDrawingRelationships.push(tag.replace(attribute(tag, 'Target'), `../media/${path.posix.basename(outputMedia)}`));
    baseZip.file('[Content_Types].xml', await baseZip.file('[Content_Types].xml').async('string').then(xml => addContentType(xml, {
      kind: 'default', extension: extension.slice(1), contentType: extension === '.png' ? 'image/png' : 'image/jpeg'
    })));
  }
  baseZip.file(`xl/drawings/drawing${drawingNumber}.xml`, await sf8Zip.file(sourceDrawingPath).async('nodebuffer'));
  baseZip.file(`xl/drawings/_rels/drawing${drawingNumber}.xml.rels`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rewrittenDrawingRelationships.join('')}</Relationships>`);
  baseZip.file(worksheetRelationshipsPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rewrittenSheetRelationships.join('')}</Relationships>`);

  const worksheetXml = shiftWorksheetStyles(shiftSharedStringIndexes(sourceSheetXmlOriginal, mergedStrings.offset),
    mergedStyles.cellXfOffset, mergedStyles.dxfOffset);
  baseZip.file(worksheetPath, worksheetXml);

  const sheetTags = [...workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/g)].map(match => match[0]);
  const nextSheetId = Math.max(0, ...sheetTags.map(tag => Number(attribute(tag, 'sheetId')) || 0)) + 1;
  const nextRelationshipId = Math.max(0, ...relationshipTags(workbookRelationships)
    .map(tag => Number(/^rId(\d+)$/.exec(attribute(tag, 'Id'))?.[1] || 0))) + 1;
  const worksheetRelationshipId = `rId${nextRelationshipId}`;
  workbookXml = workbookXml.replace(/<sheets>([\s\S]*?)<\/sheets>/,
    `<sheets>$1<sheet name="${sf8SheetName}" sheetId="${nextSheetId}" r:id="${worksheetRelationshipId}"/></sheets>`);
  workbookRelationships = workbookRelationships.replace('</Relationships>',
    `<Relationship Id="${worksheetRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${worksheetNumber}.xml"/></Relationships>`);

  const sourceDefinedNames = /<definedNames>([\s\S]*?)<\/definedNames>/.exec(sourceWorkbookXml)?.[1] || '';
  const newDefinedNames = [...sourceDefinedNames.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)]
    .filter(match => Number(attribute(`<definedName${match[1]}>`, 'localSheetId')) === 0)
    .map(match => `<definedName${match[1].replace(/localSheetId="\d+"/, `localSheetId="${sheetTags.length}"`)}>${match[2].replaceAll('Nutritional Status', sf8SheetName)}</definedName>`);
  if (newDefinedNames.length) {
    if (workbookXml.includes('</definedNames>')) {
      workbookXml = workbookXml.replace('</definedNames>', `${newDefinedNames.join('')}</definedNames>`);
    } else {
      workbookXml = workbookXml.replace('</sheets>', `</sheets><definedNames>${newDefinedNames.join('')}</definedNames>`);
    }
  }

  baseZip.file(workbookPath, workbookXml);
  baseZip.file('xl/_rels/workbook.xml.rels', workbookRelationships);
  let contentTypes = await baseZip.file('[Content_Types].xml').async('string');
  contentTypes = addContentType(contentTypes, {
    kind: 'override', part: worksheetPath,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
  });
  contentTypes = addContentType(contentTypes, {
    kind: 'override', part: `xl/drawings/drawing${drawingNumber}.xml`,
    contentType: 'application/vnd.openxmlformats-officedocument.drawing+xml'
  });
  contentTypes = addContentType(contentTypes, {
    kind: 'override', part: `xl/printerSettings/printerSettings${printerNumber}.bin`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings'
  });
  baseZip.file('[Content_Types].xml', contentTypes);

  const appFile = baseZip.file('docProps/app.xml');
  if (appFile) {
    let appXml = await appFile.async('string');
    appXml = appXml.replace(/(<vt:lpstr>Worksheets<\/vt:lpstr><\/vt:variant><vt:variant><vt:i4>)(\d+)(<\/vt:i4>)/,
      (match, before, count, after) => `${before}${Number(count) + 1}${after}`);
    appXml = appXml.replace(/(<TitlesOfParts><vt:vector size=")(\d+)("[^>]*>)/,
      (match, before, count, after) => `${before}${Number(count) + 1}${after} <vt:lpstr>${sf8SheetName}</vt:lpstr>`);
    baseZip.file('docProps/app.xml', appXml);
  }
  return baseZip;
}

async function main() {
  const sf8Path = path.join(templateDirectory, 'sf8.xlsx');
  const basePath = path.join(templateDirectory, 'sf1-sf2-sf3-sf5.xlsx');
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'academix-sf8-'));
  const temporaryMasterPath = path.join(temporaryDirectory, 'sf-master.xlsx');
  try {
    const [baseBytes, sf8Bytes] = await Promise.all([fs.readFile(basePath), fs.readFile(sf8Path)]);
    const [baseZip, sf8Zip] = await Promise.all([JSZip.loadAsync(baseBytes), JSZip.loadAsync(sf8Bytes)]);
    const combinedMaster = await appendSf8Worksheet(baseZip, sf8Zip);
    await fs.writeFile(temporaryMasterPath, await combinedMaster.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

    for (let mask = 1; mask < 16; mask += 1) {
      const previousForms = ['SF1', 'SF2', 'SF3', 'SF5'].filter((_, index) => mask & (1 << index));
      const codes = [...previousForms, 'SF8'];
      const fileName = `${codes.map(code => code.toLowerCase()).join('-')}.xlsx`;
      const workbook = await createTemplate(temporaryMasterPath, codes);
      await fs.writeFile(path.join(templateDirectory, fileName), workbook);
      process.stdout.write(`Built ${fileName}\n`);
    }
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
}

module.exports = { appendSf8Worksheet };
