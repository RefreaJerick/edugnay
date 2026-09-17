/* Frontend workbook adapter. The server can replace these functions later. */
(function initializeSfWorkbookService() {
  const SF1_TEMPLATE_ID = 'sf1-school-register-v1';

  const SF_TEMPLATE_DEFINITIONS = Object.freeze({
    [SF1_TEMPLATE_ID]: {
      templateId: SF1_TEMPLATE_ID,
      sheetName: 'School Form 1 (SF1)',
      requiredSheets: ['School Form 1 (SF1)'],
      previewRows: 80,
      previewColumns: 27,
      learnerStartRow: 10,
      learnerEndRow: 58,
      maxLearners: 49,
      mergeCount: 270,
      anchors: {
        A1: 'School Form 1',
        B8: 'LRN',
        C8: 'NAME',
        AA8: 'REMARKS'
      },
      fields: {
        schoolId: { cellAddress: 'F4', source: 'header.schoolId', type: 'text' },
        region: { cellAddress: 'H4', source: 'header.region', type: 'text' },
        division: { cellAddress: 'N4', source: 'header.division', type: 'text' },
        district: { cellAddress: 'U4', source: 'header.district', type: 'text' },
        schoolName: { cellAddress: 'F6', source: 'header.schoolName', type: 'text' },
        schoolYear: { cellAddress: 'P6', source: 'header.schoolYear', type: 'text' },
        gradeLevel: { cellAddress: 'U6', source: 'header.gradeLevel', type: 'text' },
        section: { cellAddress: 'X6', source: 'header.section', type: 'text' }
      },
      rows: [{
        source: 'learners',
        startRow: 10,
        endRow: 58,
        columns: {
          rowNumber: { column: 'A', type: 'number' },
          lrn: { column: 'B', type: 'text' },
          name: { column: 'C', type: 'text' },
          sex: { column: 'G', type: 'text' },
          birthDate: { column: 'H', type: 'date' },
          age: { column: 'I', type: 'number' },
          birthPlaceProvince: { column: 'J', type: 'text' },
          motherTongue: { column: 'L', type: 'text' },
          indigenousGroup: { column: 'M', type: 'text' },
          religion: { column: 'N', type: 'text' },
          houseStreet: { column: 'O', type: 'text' },
          barangay: { column: 'P', type: 'text' },
          cityMunicipality: { column: 'Q', type: 'text' },
          province: { column: 'R', type: 'text' },
          fatherName: { column: 'T', type: 'text' },
          motherMaidenName: { column: 'V', type: 'text' },
          guardianName: { column: 'X', type: 'text' },
          guardianRelationship: { column: 'Y', type: 'text' },
          contactNumber: { column: 'Z', type: 'text' },
          remarks: { column: 'AA', type: 'text' }
        }
      }]
    }
  });

  function issue(code, severity, message, details = {}) {
    return {
      code,
      severity,
      sheetName: details.sheetName || null,
      cellAddress: details.cellAddress || null,
      field: details.field || 'file',
      message
    };
  }

  function getTemplateDefinition(template) {
    return SF_TEMPLATE_DEFINITIONS[String(template?.id || template?.templateId || '')] || null;
  }

  function loadWorkbook(source) {
    if (!window.ExcelJS?.Workbook) {
      throw new Error('The XLSX reader could not be loaded. Reload the page and try again.');
    }
    const workbook = new ExcelJS.Workbook();
    return workbook.xlsx.load(source).then(() => workbook);
  }

  async function fetchTemplate(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('The official SF1 workbook could not be loaded.');
    return response.arrayBuffer();
  }

  function parseXml(source, label) {
    const document = new DOMParser().parseFromString(source, 'application/xml');
    if (document.getElementsByTagName('parsererror').length) throw new Error(`The ${label} XML is invalid.`);
    return document;
  }

  function partPath(basePath, targetPath) {
    if (targetPath.startsWith('/')) return targetPath.slice(1);
    const parts = basePath.split('/');
    parts.pop();
    targetPath.split('/').forEach(part => {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    });
    return parts.join('/');
  }

  async function getWorksheetPackage(zip, sheetName) {
    const workbookPath = 'xl/workbook.xml';
    const relationshipsPath = 'xl/_rels/workbook.xml.rels';
    const workbookFile = zip.file(workbookPath);
    const relationshipsFile = zip.file(relationshipsPath);
    if (!workbookFile || !relationshipsFile) throw new Error('The SF1 workbook package is incomplete.');

    const workbook = parseXml(await workbookFile.async('string'), 'workbook');
    const relationships = parseXml(await relationshipsFile.async('string'), 'workbook relationships');
    const sheet = Array.from(workbook.getElementsByTagNameNS('*', 'sheet'))
      .find(record => record.getAttribute('name') === sheetName);
    const relationshipId = sheet
      ? Array.from(sheet.attributes).find(attribute => attribute.localName === 'id')?.value
      : null;
    const relationship = Array.from(relationships.getElementsByTagNameNS('*', 'Relationship'))
      .find(record => record.getAttribute('Id') === relationshipId);
    if (!relationship) throw new Error(`Worksheet "${sheetName}" is missing from the workbook package.`);

    const path = partPath(workbookPath, relationship.getAttribute('Target'));
    const worksheetFile = zip.file(path);
    if (!worksheetFile) throw new Error(`Worksheet "${sheetName}" could not be opened.`);
    return {
      path,
      document: parseXml(await worksheetFile.async('string'), 'worksheet')
    };
  }

  async function validateTemplatePackage(source, template) {
    if (!window.JSZip) throw new Error('The XLSX package reader could not be loaded. Reload the page and try again.');
    const zip = await JSZip.loadAsync(source);
    const worksheet = await getWorksheetPackage(zip, template.sheetName);
    const stylesFile = zip.file('xl/styles.xml');
    if (!stylesFile) throw new Error('The SF1 template is missing its cell styles.');

    const styles = parseXml(await stylesFile.async('string'), 'styles');
    const borderCount = styles.getElementsByTagNameNS('*', 'border').length;
    const mergeCount = worksheet.document.getElementsByTagNameNS('*', 'mergeCell').length;
    const cellMap = new Map(Array.from(worksheet.document.getElementsByTagNameNS('*', 'c'))
      .map(cell => [cell.getAttribute('r'), cell]));
    const requiredAddresses = [
      ...Object.keys(getTemplateDefinition(template)?.anchors || {}),
      ...Object.values(getTemplateDefinition(template)?.fields || {}).map(field => field.cellAddress),
      ...editableAddresses(template)
    ];
    const invalidCell = requiredAddresses.find(address => !cellMap.get(address)?.hasAttribute('s'));
    const fileNames = Object.keys(zip.files);

    if (borderCount <= 1 || invalidCell) {
      throw new Error('The SF1 template is missing its required cell formatting.');
    }
    if (mergeCount !== getTemplateDefinition(template).mergeCount) {
      throw new Error('The SF1 template has an unexpected merged-cell layout.');
    }
    if (!fileNames.some(name => /^xl\/media\/[^/]+$/i.test(name))) {
      throw new Error('The SF1 template is missing its official image.');
    }
    if (!fileNames.some(name => /^xl\/printerSettings\/[^/]+$/i.test(name))) {
      throw new Error('The SF1 template is missing its printer settings.');
    }
    return { zip, worksheet, styles: await stylesFile.async('string') };
  }

  function safeColor(color) {
    const argb = String(color?.argb || '');
    if (/^[0-9a-f]{8}$/i.test(argb)) return `#${argb.slice(2)}`;
    if (Number(color?.theme) === 1 || Number(color?.indexed) === 8) return '#000000';
    if (Number(color?.theme) === 0 || Number(color?.indexed) === 9) return '#ffffff';
    return null;
  }

  function borderStyle(border) {
    return border?.style
      ? { style: border.style, color: safeColor(border.color) }
      : null;
  }

  function cellStyle(cell) {
    return {
      bold: Boolean(cell.font?.bold),
      italic: Boolean(cell.font?.italic),
      fontColor: safeColor(cell.font?.color),
      backgroundColor: cell.fill?.type === 'pattern' ? safeColor(cell.fill.fgColor) : null,
      horizontal: ['left', 'center', 'right'].includes(cell.alignment?.horizontal) ? cell.alignment.horizontal : null,
      vertical: ['top', 'middle', 'bottom'].includes(cell.alignment?.vertical) ? cell.alignment.vertical : null,
      wrapText: Boolean(cell.alignment?.wrapText),
      fontSize: Number.isFinite(cell.font?.size) ? Math.min(22, Math.max(9, cell.font.size)) : null,
      numberFormat: cell.numFmt || null,
      borders: {
        top: borderStyle(cell.border?.top),
        right: borderStyle(cell.border?.right),
        bottom: borderStyle(cell.border?.bottom),
        left: borderStyle(cell.border?.left)
      }
    };
  }

  function columnNumber(letters) {
    return String(letters).toUpperCase().split('')
      .reduce((total, letter) => (total * 26) + letter.charCodeAt(0) - 64, 0);
  }

  function cellPosition(address) {
    const match = /^([A-Z]+)(\d+)$/i.exec(String(address || ''));
    return match ? { column: columnNumber(match[1]), row: Number(match[2]) } : null;
  }

  function worksheetMerges(worksheet) {
    return Array.isArray(worksheet.model?.merges) ? worksheet.model.merges : [];
  }

  function mergeMap(worksheet) {
    const map = new Map();
    worksheetMerges(worksheet).forEach(range => {
      const [startAddress, endAddress] = range.split(':');
      const start = cellPosition(startAddress);
      const end = cellPosition(endAddress);
      if (!start || !end) return;
      for (let row = start.row; row <= end.row; row += 1) {
        for (let column = start.column; column <= end.column; column += 1) {
          map.set(`${row}:${column}`, {
            hidden: row !== start.row || column !== start.column,
            rowSpan: end.row - start.row + 1,
            columnSpan: end.column - start.column + 1
          });
        }
      }
    });
    return map;
  }

  function editableAddresses(template) {
    const definition = getTemplateDefinition(template);
    if (!definition) return [];
    const addresses = Object.values(definition.fields).map(field => field.cellAddress);
    definition.rows.forEach(mapping => {
      for (let row = mapping.startRow; row <= mapping.endRow; row += 1) {
        Object.entries(mapping.columns).forEach(([field, column]) => {
          if (field !== 'rowNumber') addresses.push(`${column.column}${row}`);
        });
      }
    });
    return [...new Set(addresses)];
  }

  function worksheetPreview(worksheet, template) {
    const definition = getTemplateDefinition(template) || {};
    const actualRows = worksheet.rowCount || worksheet.actualRowCount || 0;
    const actualColumns = worksheet.columnCount || worksheet.actualColumnCount || 0;
    const rowCount = Math.min(Math.max(actualRows, 1), definition.previewRows || actualRows || 1);
    const columnCount = Math.min(Math.max(actualColumns, 1), definition.previewColumns || actualColumns || 1);
    const merges = mergeMap(worksheet);
    const editable = new Set(editableAddresses(template));
    const rows = [];

    for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
      const cells = [];
      for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
        const merge = merges.get(`${rowNumber}:${columnIndex}`);
        if (merge?.hidden) continue;
        const cell = worksheet.getCell(rowNumber, columnIndex);
        const formula = cell.value && typeof cell.value === 'object' ? cell.value.formula || null : null;
        cells.push({
          address: cell.address,
          text: cell.text || '',
          formula,
          rowSpan: merge?.rowSpan || 1,
          columnSpan: merge?.columnSpan || 1,
          editable: editable.has(cell.address),
          style: cellStyle(cell)
        });
      }
      rows.push({
        number: rowNumber,
        height: Math.min(90, Math.max(22, Math.round((worksheet.getRow(rowNumber).height || 17) * 1.33))),
        cells
      });
    }

    return {
      name: worksheet.name,
      rowCount: actualRows,
      columnCount: actualColumns,
      truncated: actualRows > rowCount || actualColumns > columnCount,
      columnWidths: Array.from({ length: columnCount }, (_, index) => {
        const width = worksheet.getColumn(index + 1).width || 10;
        return Math.min(220, Math.max(48, Math.round(width * 7)));
      }),
      rows
    };
  }

  function validateDefinition(workbook, template) {
    const definition = getTemplateDefinition(template);
    if (!definition) {
      return {
        definition: null,
        mappingStatus: 'unmapped',
        issues: [issue('mapping_unavailable', 'error', 'This template does not have a verified system-field mapping.', { field: 'mapping' })]
      };
    }

    const issues = [];
    definition.requiredSheets.forEach(sheetName => {
      if (!workbook.getWorksheet(sheetName)) {
        issues.push(issue('missing_required_sheet', 'error', `Required worksheet "${sheetName}" is missing.`, { sheetName, field: 'mapping' }));
      }
    });

    const worksheet = workbook.getWorksheet(definition.sheetName);
    if (worksheet) {
      Object.entries(definition.anchors).forEach(([cellAddress, expectedText]) => {
        const actualText = String(worksheet.getCell(cellAddress).text || '').toLowerCase();
        if (!actualText.includes(expectedText.toLowerCase())) {
          issues.push(issue('anchor_mismatch', 'error', `SF1 anchor ${cellAddress} no longer contains "${expectedText}".`, {
            sheetName: definition.sheetName,
            cellAddress,
            field: 'mapping'
          }));
        }
      });
    }

    Object.entries(definition.fields).forEach(([field, mapping]) => {
      if (!/^[A-Z]+\d+$/i.test(mapping.cellAddress || '')) {
        issues.push(issue('invalid_mapping_cell', 'error', `The mapping for ${field} has an invalid cell address.`, { sheetName: definition.sheetName, field }));
      }
    });

    return {
      definition,
      mappingStatus: issues.length ? 'invalid' : 'ready',
      issues
    };
  }

  function valueAtPath(source, path) {
    return String(path || '').split('.').reduce((value, key) => value?.[key], source) ?? null;
  }

  function dateValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const text = String(value || '').trim();
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    return match ? new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]))) : null;
  }

  function mappedCellValues(template, context) {
    const definition = getTemplateDefinition(template);
    if (!definition) return [];
    const cells = Object.values(definition.fields).map(mapping => ({
      cellAddress: mapping.cellAddress,
      value: valueAtPath(context, mapping.source),
      type: mapping.type
    }));

    definition.rows.forEach(mapping => {
      const records = valueAtPath(context, mapping.source) || [];
      for (let row = mapping.startRow; row <= mapping.endRow; row += 1) {
        const record = records[row - mapping.startRow] || {};
        Object.entries(mapping.columns).forEach(([field, column]) => {
          cells.push({
            cellAddress: `${column.column}${row}`,
            value: valueAtPath(record, field),
            type: column.type
          });
        });
      }
    });
    return cells;
  }

  function applyDefinition(workbook, template, context) {
    const definition = getTemplateDefinition(template);
    const worksheet = workbook.getWorksheet(definition.sheetName);
    mappedCellValues(template, context).forEach(record => {
      const cell = worksheet.getCell(record.cellAddress);
      if (record.type === 'date') cell.value = dateValue(record.value);
      else if (record.type === 'number') cell.value = record.value === null || record.value === '' ? null : Number(record.value);
      else cell.value = record.value === null ? '' : String(record.value);
    });
  }

  function excelDateSerial(value) {
    const date = dateValue(value);
    return date ? (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000 : null;
  }

  function setXmlCellValue(document, cell, value, type) {
    Array.from(cell.childNodes).filter(child => child.nodeType === 1).forEach(child => {
      if (['f', 'v', 'is'].includes(child.localName)) cell.removeChild(child);
    });
    if (value === null || value === undefined || value === '') {
      cell.removeAttribute('t');
      return;
    }

    const namespace = document.documentElement.namespaceURI;
    if (type === 'number' || type === 'date') {
      const number = type === 'date' ? excelDateSerial(value) : Number(value);
      if (!Number.isFinite(number)) {
        cell.removeAttribute('t');
        return;
      }
      cell.removeAttribute('t');
      const valueNode = document.createElementNS(namespace, 'v');
      valueNode.textContent = String(number);
      cell.appendChild(valueNode);
      return;
    }

    const text = String(value);
    cell.setAttribute('t', 'inlineStr');
    const inlineString = document.createElementNS(namespace, 'is');
    const textNode = document.createElementNS(namespace, 't');
    if (/^\s|\s$/.test(text)) textNode.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    textNode.textContent = text;
    inlineString.appendChild(textNode);
    cell.appendChild(inlineString);
  }

  async function exportWorkbook(template, mappedCells = [], edits = []) {
    const source = await fetchTemplate(template.templateFileUrl);
    const packageData = await validateTemplatePackage(source, template);
    const cellMap = new Map(Array.from(packageData.worksheet.document.getElementsByTagNameNS('*', 'c'))
      .map(cell => [cell.getAttribute('r'), cell]));
    const mappedTypes = new Map(mappedCells.map(record => [String(record.cellAddress || '').toUpperCase(), record.type]));

    mappedCells.forEach(record => {
      const address = String(record.cellAddress || '').toUpperCase();
      const cell = cellMap.get(address);
      if (!cell) throw new Error(`Mapped cell ${address} is missing from the SF1 template.`);
      setXmlCellValue(packageData.worksheet.document, cell, record.value, record.type);
    });

    const allowed = new Set(editableAddresses(template));
    edits.forEach(record => {
      const address = String(record.cellAddress || '').toUpperCase();
      const cell = cellMap.get(address);
      if (allowed.has(address) && cell) {
        setXmlCellValue(packageData.worksheet.document, cell, record.value, mappedTypes.get(address) || 'text');
      }
    });

    const worksheetXml = new XMLSerializer().serializeToString(packageData.worksheet.document);
    packageData.zip.file(packageData.worksheet.path, worksheetXml);
    if (await packageData.zip.file('xl/styles.xml').async('string') !== packageData.styles) {
      throw new Error('The SF1 workbook styles changed unexpectedly during export.');
    }
    return packageData.zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
  }

  async function getFilePreview(templateFileUrl, sheetName, template) {
    const source = await fetchTemplate(templateFileUrl);
    await validateTemplatePackage(source, template);
    const workbook = await loadWorkbook(source);
    const worksheet = workbook.getWorksheet(sheetName) || workbook.getWorksheet(template?.sheetName) || workbook.worksheets[0];
    if (!worksheet) throw new Error('The workbook does not contain a worksheet to preview.');
    const mapping = validateDefinition(workbook, template);
    if (mapping.mappingStatus === 'invalid') throw new Error(mapping.issues[0].message);
    return worksheetPreview(worksheet, template);
  }

  async function generatePreview(template, context) {
    const source = await fetchTemplate(template.templateFileUrl);
    await validateTemplatePackage(source, template);
    const workbook = await loadWorkbook(source);
    const mapping = validateDefinition(workbook, template);
    if (mapping.mappingStatus !== 'ready') throw new Error(mapping.issues[0]?.message || 'The SF1 template mapping is invalid.');
    applyDefinition(workbook, template, context);
    const worksheet = workbook.getWorksheet(template.sheetName);
    return {
      preview: worksheetPreview(worksheet, template),
      editableCells: editableAddresses(template),
      mappedCells: mappedCellValues(template, context),
      edits: []
    };
  }

  window.EDUGNAY_SF_WORKBOOK = {
    getTemplateDefinition,
    getFilePreview,
    generatePreview,
    exportWorkbook
  };
})();
