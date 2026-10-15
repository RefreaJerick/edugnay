const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');

const templateDirectory = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms');
const wantedSheets = new Map([
  ['SF1', 'School Form 1 (SF1)'],
  ['SF2', 'School Form 2 (SF2)'],
  ['SF3', 'School Form 3 (SF3)'],
  ['SF5', 'School Form 5 (SF5)'],
  ['SF8', 'School Form 8 (SF8)']
]);

function attributes(xml) {
  return Object.fromEntries([...xml.matchAll(/([\w:.-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
}

function resolveTarget(sourcePart, target) {
  const targetPath = target.startsWith('/')
    ? target.slice(1)
    : path.posix.join(path.posix.dirname(sourcePart), target);
  return path.posix.normalize(targetPath);
}

function relationshipSource(relationshipPath) {
  if (relationshipPath === '_rels/.rels') return '';
  const match = /^(.*)\/_rels\/([^/]+)\.rels$/.exec(relationshipPath);
  return match ? path.posix.join(match[1], match[2]) : null;
}

function relationshipPath(partPath) {
  const directory = path.posix.dirname(partPath);
  const file = path.posix.basename(partPath);
  return path.posix.join(directory, '_rels', `${file}.rels`);
}

function readRelationshipRecords(xml) {
  return [...xml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)].map(match => attributes(match[0]));
}

async function reachableParts(zip) {
  const parts = new Set();
  const relationshipParts = new Set();
  const pending = ['_rels/.rels'];
  while (pending.length) {
    const relPath = pending.pop();
    if (relationshipParts.has(relPath)) continue;
    relationshipParts.add(relPath);
    const relFile = zip.file(relPath);
    if (!relFile) continue;
    const sourcePart = relationshipSource(relPath);
    if (sourcePart) parts.add(sourcePart);
    const xml = await relFile.async('string');
    for (const relation of readRelationshipRecords(xml)) {
      if (!relation.Target || relation.TargetMode === 'External') continue;
      const target = resolveTarget(sourcePart || '', relation.Target);
      parts.add(target);
      const targetRelationships = relationshipPath(target);
      if (zip.file(targetRelationships)) pending.push(targetRelationships);
    }
  }
  return { parts, relationshipParts };
}

function updateApplicationProperties(xml, sheetNames, definedNames) {
  const nameParts = definedNames.map(name => `<vt:lpstr>${name}</vt:lpstr>`).join('');
  const worksheetNames = sheetNames.map(name => `<vt:lpstr>${name}</vt:lpstr>`).join('');
  const titleParts = `${worksheetNames}${nameParts}`;
  return xml
    .replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, `<HeadingPairs><vt:vector size="4" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant><vt:variant><vt:lpstr>Named Ranges</vt:lpstr></vt:variant><vt:variant><vt:i4>${definedNames.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>`)
    .replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, `<TitlesOfParts><vt:vector size="${sheetNames.length + definedNames.length}" baseType="lpstr">${titleParts}</vt:vector></TitlesOfParts>`);
}

async function createTemplate(sourcePath, formCodes) {
  const zip = await JSZip.loadAsync(await fs.readFile(sourcePath));
  const workbookFile = zip.file('xl/workbook.xml');
  const relationsFile = zip.file('xl/_rels/workbook.xml.rels');
  if (!workbookFile || !relationsFile || !zip.file('[Content_Types].xml')) {
    throw new Error('The source workbook is missing required OOXML parts.');
  }

  if (!Array.isArray(formCodes) || formCodes.length < 2 || formCodes.length > 5
    || new Set(formCodes).size !== formCodes.length) {
    throw new Error('Select two to five different SF forms to build a combined template.');
  }
  const names = formCodes.map(code => wantedSheets.get(code));
  if (names.some(name => !name)) throw new Error('Only registered school form templates can be combined.');
  let workbook = await workbookFile.async('string');
  let relationships = await relationsFile.async('string');
  const sourceSheetTags = [...workbook.matchAll(/<sheet\b[^>]*\/?\s*>/g)];
  const sourceSheets = sourceSheetTags.map(match => ({ tag: match[0], ...attributes(match[0]) }));
  const selected = names.map(name => {
    const sourceIndex = sourceSheets.findIndex(sheet => sheet.name === name);
    return sourceIndex < 0 ? null : { ...sourceSheets[sourceIndex], sourceIndex };
  });
  if (selected.some(sheet => !sheet)) throw new Error('The source workbook does not contain every requested SF form.');

  const selectedIds = new Set(selected.map(sheet => sheet['r:id']));
  const relationTags = [...relationships.matchAll(/<Relationship\b[^>]*\/?\s*>/g)];
  const selectedWorksheetIds = new Set(relationTags
    .map(match => ({ tag: match[0], ...attributes(match[0]) }))
    .filter(relation => /\/worksheet$/.test(relation.Type || '') && selectedIds.has(relation.Id))
    .map(relation => relation.Id));
  if (selectedWorksheetIds.size !== selected.length) throw new Error('A requested SF worksheet relationship is missing.');

  workbook = workbook.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${selected.map(sheet => sheet.tag).join('')}</sheets>`);
  const selectedLocalIds = new Map(selected.map((sheet, index) => [sheet.sourceIndex, index]));
  let definedNames = [];
  workbook = workbook.replace(/<definedNames>[\s\S]*?<\/definedNames>/, (block) => {
    const keep = [...block.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)]
      .flatMap(match => {
        const sourceLocalId = Number(attributes(match[1]).localSheetId);
        const targetLocalId = selectedLocalIds.get(sourceLocalId);
        if (targetLocalId === undefined) return [];
        const updatedAttributes = match[1].replace(/\blocalSheetId="\d+"/, `localSheetId="${targetLocalId}"`);
        const name = attributes(match[1]).name || 'Named Range';
        definedNames.push(`'${names[targetLocalId]}'!${name}`);
        return [`<definedName${updatedAttributes}>${match[2]}</definedName>`];
      });
    return keep.length ? `<definedNames>${keep.join('')}</definedNames>` : '';
  });
  workbook = workbook.replace(/activeTab="\d+"/, 'activeTab="0"');
  workbook = workbook.replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/g, '');

  relationships = relationships.replace(/<Relationship\b[^>]*\/?\s*>/g, tag => {
    const relation = attributes(tag);
    if (/\/worksheet$/.test(relation.Type || '') && !selectedWorksheetIds.has(relation.Id)) return '';
    return tag;
  });
  zip.file('xl/workbook.xml', workbook);
  zip.file('xl/_rels/workbook.xml.rels', relationships);

  const appFile = zip.file('docProps/app.xml');
  if (appFile) {
    zip.file('docProps/app.xml', updateApplicationProperties(await appFile.async('string'), names, definedNames));
  }

  const reachable = await reachableParts(zip);
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || name === '[Content_Types].xml') continue;
    if (!reachable.parts.has(name) && !reachable.relationshipParts.has(name)) zip.remove(name);
  }

  const contentTypes = await zip.file('[Content_Types].xml').async('string');
  zip.file('[Content_Types].xml', contentTypes.replace(/<Override\b[^>]*\/?\s*>/g, tag => {
    const partName = attributes(tag).PartName?.replace(/^\//, '');
    return partName && !reachable.parts.has(partName) ? '' : tag;
  }));

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function main() {
  const sourcePath = path.resolve(process.argv[2] || '');
  const outputPath = path.resolve(templateDirectory, 'sf1-sf2.xlsx');
  if (!process.argv[2] || sourcePath === templateDirectory || sourcePath === outputPath
    || !(await fs.stat(sourcePath).catch(() => null))?.isFile()) {
    throw new Error('Usage: node backend/scripts/buildSfWorkbookTemplates.js <original-school-forms.xlsx>');
  }

  const outputs = [
    ['sf1-sf5', ['SF1', 'SF5']],
    ['sf2-sf5', ['SF2', 'SF5']],
    ['sf3-sf5', ['SF3', 'SF5']],
    ['sf1-sf2-sf5', ['SF1', 'SF2', 'SF5']],
    ['sf1-sf3-sf5', ['SF1', 'SF3', 'SF5']],
    ['sf2-sf3-sf5', ['SF2', 'SF3', 'SF5']],
    ['sf1-sf2-sf3-sf5', ['SF1', 'SF2', 'SF3', 'SF5']]
  ];
  for (const [fileName, codes] of outputs) {
    const buffer = await createTemplate(sourcePath, codes);
    await fs.writeFile(path.join(templateDirectory, `${fileName}.xlsx`), buffer);
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { createTemplate };
