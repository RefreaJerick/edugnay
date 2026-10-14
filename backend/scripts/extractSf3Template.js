const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const sourcePath = process.argv[2];
const formCode = String(process.argv[3] || 'SF3').toUpperCase();
if (!['SF3', 'SF5'].includes(formCode)) throw new Error('This extractor supports SF3 and SF5 only.');
const outputPath = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms', `${formCode.toLowerCase()}.xlsx`);
const sheetName = `School Form ${formCode.slice(2)} (${formCode})`;

if (!sourcePath) throw new Error('Pass the path to the official School Forms (1-7).xlsx workbook.');

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

function replaceRelationship(xml, id, update) {
  let found = false;
  const next = xml.replace(/<Relationship\b[^>]*\/>/g, tag => {
    if (attribute(tag, 'Id') !== id) return tag;
    found = true;
    return update(tag);
  });
  if (!found) throw new Error(`Required workbook relationship ${id} is missing.`);
  return next;
}

async function copyPart(source, output, sourceName, outputName = sourceName) {
  const file = source.file(sourceName);
  if (!file) throw new Error(`The supplied ${formCode} workbook is missing ${sourceName}.`);
  output.file(outputName, await file.async('nodebuffer'));
}

async function main() {
  const source = await JSZip.loadAsync(await fs.promises.readFile(sourcePath));
  const output = new JSZip();
  let workbookXml = await source.file('xl/workbook.xml').async('string');
  const workbookRelationships = await source.file('xl/_rels/workbook.xml.rels').async('string');
  const sheets = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)].map(match => match[0]);
  const selectedSheet = sheets.find(tag => attribute(tag, 'name') === sheetName);
  if (!selectedSheet) throw new Error(`The official workbook does not contain ${sheetName}.`);
  const selectedIndex = sheets.indexOf(selectedSheet);
  const originalSheetRelationshipId = attribute(selectedSheet, 'r:id');
  const originalSheetRelationship = relationshipTags(workbookRelationships)
    .find(tag => attribute(tag, 'Id') === originalSheetRelationshipId);
  if (!originalSheetRelationship) throw new Error(`${sheetName} has no worksheet relationship.`);

  const sourceSheetPath = resolvePart('xl/workbook.xml', attribute(originalSheetRelationship, 'Target'));
  const sourceSheetRelPath = path.posix.join(path.posix.dirname(sourceSheetPath), '_rels', `${path.posix.basename(sourceSheetPath)}.rels`);
  const outputSheetPath = 'xl/worksheets/sheet1.xml';
  const outputSheetRelPath = 'xl/worksheets/_rels/sheet1.xml.rels';
  const sourceSheetXml = await source.file(sourceSheetPath).async('string');
  const sourceSheetRelXml = await source.file(sourceSheetRelPath).async('string');

  let drawingSourcePath = '';
  let printerSourcePath = '';
  for (const tag of relationshipTags(sourceSheetRelXml)) {
    const type = relationshipType(tag);
    const target = resolvePart(sourceSheetPath, attribute(tag, 'Target'));
    if (type === 'drawing') drawingSourcePath = target;
    else if (type === 'printerSettings') printerSourcePath = target;
    else await copyPart(source, output, target);
  }
  if (!drawingSourcePath || !printerSourcePath) {
    throw new Error(`${sheetName} is missing its drawing or print settings.`);
  }

  let outputSheetRelXml = sourceSheetRelXml.replace(/<Relationship\b[^>]*\/>/g, tag => {
    const type = relationshipType(tag);
    if (type === 'drawing') return tag.replace(attribute(tag, 'Target'), '../drawings/drawing1.xml');
    if (type === 'printerSettings') return tag.replace(attribute(tag, 'Target'), '../printerSettings/printerSettings1.bin');
    return tag;
  });
  output.file(outputSheetPath, sourceSheetXml);
  output.file(outputSheetRelPath, outputSheetRelXml);
  await copyPart(source, output, drawingSourcePath, 'xl/drawings/drawing1.xml');
  await copyPart(source, output, printerSourcePath, 'xl/printerSettings/printerSettings1.bin');

  const sourceDrawingRelPath = path.posix.join(path.posix.dirname(drawingSourcePath), '_rels', `${path.posix.basename(drawingSourcePath)}.rels`);
  const outputDrawingRelPath = 'xl/drawings/_rels/drawing1.xml.rels';
  const drawingRelXml = await source.file(sourceDrawingRelPath).async('string');
  for (const tag of relationshipTags(drawingRelXml)) {
    const target = resolvePart(drawingSourcePath, attribute(tag, 'Target'));
    await copyPart(source, output, target);
  }
  output.file(outputDrawingRelPath, drawingRelXml);

  const requiredWorkbookRelationships = [];
  const outputSheetRelationshipId = 'rId1';
  for (const tag of relationshipTags(workbookRelationships)) {
    const type = relationshipType(tag);
    if (attribute(tag, 'Id') === originalSheetRelationshipId) {
      requiredWorkbookRelationships.push(tag
        .replace(`Id="${originalSheetRelationshipId}"`, `Id="${outputSheetRelationshipId}"`)
        .replace(attribute(tag, 'Target'), 'worksheets/sheet1.xml'));
    } else if (['theme', 'styles', 'sharedStrings'].includes(type)) {
      requiredWorkbookRelationships.push(tag);
      await copyPart(source, output, resolvePart('xl/workbook.xml', attribute(tag, 'Target')));
    }
  }
  if (requiredWorkbookRelationships.length < 4) throw new Error(`The supplied ${formCode} workbook is missing a required workbook relationship.`);
  const workbookRelXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${requiredWorkbookRelationships.join('')}</Relationships>`;
  output.file('xl/_rels/workbook.xml.rels', workbookRelXml);

  workbookXml = workbookXml.replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/, '');
  workbookXml = workbookXml.replace(/activeTab="\d+"/, 'activeTab="0"');
  workbookXml = workbookXml.replace(/<sheets>[\s\S]*?<\/sheets>/,
    `<sheets><sheet name="${sheetName}" sheetId="1" r:id="${outputSheetRelationshipId}"/></sheets>`);
  workbookXml = workbookXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, (block) => {
    const names = [...block.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)]
      .filter(match => Number(attribute(`<definedName${match[1]}>`, 'localSheetId')) === selectedIndex)
      .map(match => `<definedName${match[1].replace(/localSheetId="\d+"/, 'localSheetId="0"')}>${match[2]}</definedName>`);
    return names.length ? `<definedNames>${names.join('')}</definedNames>` : '';
  });
  output.file('xl/workbook.xml', workbookXml);

  const rootRelationships = await source.file('_rels/.rels').async('string');
  const retainedRootRelationships = relationshipTags(rootRelationships)
    .filter(tag => ['officeDocument', 'core-properties'].includes(relationshipType(tag)));
  output.file('_rels/.rels', rootRelationships.replace(/<Relationship\b[^>]*\/>/g, tag => (
    retainedRootRelationships.includes(tag) ? tag : ''
  )));
  await copyPart(source, output, 'docProps/core.xml');

  const contentTypes = await source.file('[Content_Types].xml').async('string');
  const retainedOverrides = new Set([
    '/xl/workbook.xml', '/xl/worksheets/sheet1.xml', '/xl/theme/theme1.xml',
    '/xl/styles.xml', '/xl/sharedStrings.xml', '/xl/drawings/drawing1.xml', '/docProps/core.xml'
  ]);
  output.file('[Content_Types].xml', contentTypes.replace(/<Override\b[^>]*\/>/g, tag => (
    retainedOverrides.has(attribute(tag, 'PartName')) ? tag : ''
  )));

  await fs.promises.writeFile(outputPath, await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  process.stdout.write(`Extracted ${outputPath}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
