const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const sourcePath = process.argv[2];
const outputPath = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms', 'sf2.xlsx');
if (!sourcePath) throw new Error('Pass the path to the official School Forms (1-7).xlsx workbook.');

async function main() {
  const source = await JSZip.loadAsync(await fs.promises.readFile(sourcePath));
  const output = new JSZip();
  const parts = [
    'xl/worksheets/sheet2.xml',
    'xl/worksheets/_rels/sheet2.xml.rels',
    'xl/drawings/drawing2.xml',
    'xl/drawings/_rels/drawing2.xml.rels',
    'xl/media/image1.png',
    'xl/printerSettings/printerSettings2.bin',
    'xl/styles.xml',
    'xl/sharedStrings.xml',
    'xl/theme/theme1.xml',
    'docProps/core.xml'
  ];
  for (const part of parts) {
    if (!source.file(part)) throw new Error(`Official SF2 workbook is missing ${part}.`);
    output.file(part, await source.file(part).async('nodebuffer'));
  }

  let workbook = await source.file('xl/workbook.xml').async('string');
  workbook = workbook.replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/, '');
  workbook = workbook.replace(/activeTab="\d+"/, 'activeTab="0"');
  workbook = workbook.replace(/<sheets>[\s\S]*?<\/sheets>/,
    '<sheets><sheet name="School Form 2 (SF2)" sheetId="2" r:id="rId2"/></sheets>');
  workbook = workbook.replace(/<definedNames>[\s\S]*?<\/definedNames>/,
    '<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">\'School Form 2 (SF2)\'!$10:$12</definedName></definedNames>');
  output.file('xl/workbook.xml', workbook);

  const relationships = await source.file('xl/_rels/workbook.xml.rels').async('string');
  output.file('xl/_rels/workbook.xml.rels', relationships.replace(
    /<Relationship\b[^>]*\/>/g,
    match => /\bId="(?:rId2|rId8|rId9|rId10)"/.test(match) ? match : ''
  ));
  const rootRelationships = await source.file('_rels/.rels').async('string');
  output.file('_rels/.rels', rootRelationships.replace(
    /<Relationship\b[^>]*\/>/g,
    match => /\bId="(?:rId1|rId2)"/.test(match) ? match : ''
  ));
  const contentTypes = await source.file('[Content_Types].xml').async('string');
  output.file('[Content_Types].xml', contentTypes.replace(
    /<Override\b[^>]*\/>/g,
    match => /PartName="\/(?:xl\/(?:workbook\.xml|worksheets\/sheet2\.xml|drawings\/drawing2\.xml|theme\/theme1\.xml|styles\.xml|sharedStrings\.xml)|docProps\/core\.xml)"/.test(match) ? match : ''
  ));

  await fs.promises.writeFile(outputPath, await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  process.stdout.write(`Extracted ${outputPath}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
