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
  if (!cellPattern.test(xml)) throw createError(`Mapped cell ${safeAddress} is missing from the official SF1 template.`, 500);

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
  if (!workbookFile || !relationshipsFile) throw createError('The official SF1 workbook package is incomplete.', 500);

  const workbookXml = await workbookFile.async('string');
  const escapedName = String(sheetName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sheetMatch = new RegExp(`<sheet\\b(?=[^>]*\\bname="${escapedName}")[^>]*\\br:id="([^"]+)"[^>]*/?>`, 'i').exec(workbookXml);
  if (!sheetMatch) throw createError(`Worksheet "${sheetName}" is missing from the official SF1 template.`, 500);

  const relationshipsXml = await relationshipsFile.async('string');
  const relationshipMatch = new RegExp(`<Relationship\\b(?=[^>]*\\bId="${sheetMatch[1]}")[^>]*\\bTarget="([^"]+)"[^>]*/?>`, 'i').exec(relationshipsXml);
  if (!relationshipMatch) throw createError(`Worksheet "${sheetName}" could not be opened.`, 500);

  const worksheetPath = resolvePartPath(workbookPath, relationshipMatch[1]);
  if (!zip.file(worksheetPath)) throw createError(`Worksheet "${sheetName}" could not be opened.`, 500);
  return worksheetPath;
}

function getOfficialTemplatePath(filePath) {
  const fileName = path.basename(String(filePath || ''));
  const resolvedPath = path.resolve(templateDirectory, fileName);
  if (!resolvedPath.startsWith(`${templateDirectory}${path.sep}`) || !fs.existsSync(resolvedPath)) {
    throw createError('The official SF template file is unavailable.', 500);
  }
  return resolvedPath;
}

async function createExportWorkbook(template, cells) {
  const templatePath = getOfficialTemplatePath(template.filePath);
  const source = await fs.promises.readFile(templatePath);
  const zip = await JSZip.loadAsync(source);
  const stylesFile = zip.file('xl/styles.xml');
  if (!stylesFile) throw createError('The official SF1 template is missing its styles.', 500);

  const originalStyles = await stylesFile.async('nodebuffer');
  const worksheetPath = await getWorksheetPath(zip, template.sheetName);
  let worksheetXml = await zip.file(worksheetPath).async('string');

  cells.forEach(cell => {
    worksheetXml = replaceCell(worksheetXml, cell.cellAddress, cell.value, cell.type);
  });

  zip.file(worksheetPath, worksheetXml);
  const afterStyles = await zip.file('xl/styles.xml').async('nodebuffer');
  if (!originalStyles.equals(afterStyles)) throw createError('The SF1 workbook styles changed unexpectedly.', 500);

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
  if (!/^sf1-[a-f0-9-]{36}\.xlsx$/.test(fileName)) throw createError('The requested export file is invalid.', 400);
  const legacy = String(publicPath).replace(/^\/+/, '').startsWith('uploads/sf-exports/');
  const directory = legacy ? path.resolve(__dirname, '..', 'uploads', 'sf-exports') : exportDirectory;
  const filePath = path.resolve(directory, fileName);
  if (!filePath.startsWith(`${directory}${path.sep}`)) throw createError('The requested export file is invalid.', 400);
  return filePath;
}

module.exports = {
  createExportWorkbook,
  getExportFilePath,
  saveExport
};
