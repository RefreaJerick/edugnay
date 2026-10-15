const assert = require('node:assert/strict');
const path = require('node:path');

function xmlAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escapedName}="([^"]*)"`).exec(tag)?.[1] || '';
}

function relationshipSourcePart(relationshipPath) {
  if (relationshipPath === '_rels/.rels') return '';
  const match = /^(?:(.*)\/)?_rels\/([^/]+)\.rels$/.exec(relationshipPath);
  assert.ok(match, `invalid relationship part path: ${relationshipPath}`);
  return match[1] ? `${match[1]}/${match[2]}` : match[2];
}

function resolveTarget(sourcePart, target) {
  const decodedTarget = target.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  return decodedTarget.startsWith('/') ? decodedTarget.slice(1)
    : path.posix.normalize(path.posix.join(path.posix.dirname(sourcePart || '.'), decodedTarget));
}

async function assertXlsxPackageIntegrity(zip) {
  const contentTypesFile = zip.file('[Content_Types].xml');
  assert.ok(contentTypesFile, 'workbook content types are missing');
  const contentTypes = await contentTypesFile.async('string');
  const overrideParts = [...contentTypes.matchAll(/<Override\b[^>]*\/>/g)]
    .map(match => xmlAttribute(match[0], 'PartName'));
  assert.equal(new Set(overrideParts).size, overrideParts.length, 'content type part names must be unique');
  for (const partName of overrideParts) {
    assert.ok(zip.file(partName.replace(/^\//, '')), `content type references missing part ${partName}`);
  }

  for (const relationshipPath of Object.keys(zip.files).filter(name => name.endsWith('.rels') && !zip.files[name].dir)) {
    const relationshipFile = await zip.file(relationshipPath).async('string');
    const relationshipIds = new Set();
    const sourcePart = relationshipSourcePart(relationshipPath);
    for (const match of relationshipFile.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
      const tag = match[0];
      const id = xmlAttribute(tag, 'Id');
      const target = xmlAttribute(tag, 'Target');
      if (id) {
        assert.ok(!relationshipIds.has(id), `${relationshipPath} contains duplicate relationship ID ${id}`);
        relationshipIds.add(id);
      }
      if (xmlAttribute(tag, 'TargetMode') === 'External') continue;
      assert.ok(zip.file(resolveTarget(sourcePart, target)), `${relationshipPath} references missing part ${target}`);
    }
  }
}

module.exports = { assertXlsxPackageIntegrity };
