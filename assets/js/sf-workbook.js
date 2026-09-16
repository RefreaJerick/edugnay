/* Frontend workbook adapter. Official form mappings belong in
   SF_TEMPLATE_DEFINITIONS after each source workbook has been verified. */
(function initializeSfWorkbookService() {
  const DB_NAME = 'edugnay_sf_workbooks';
  const STORE_NAME = 'templateFiles';
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const PREVIEW_ROWS = 60;
  const PREVIEW_COLUMNS = 24;

  const SF_TEMPLATE_DEFINITIONS = Object.freeze({});

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

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('The workbook file could not be stored.'));
    });
  }

  async function fileHash(buffer) {
    if (!window.crypto?.subtle) return null;
    const hash = await window.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash))
      .map(value => value.toString(16).padStart(2, '0'))
      .join('');
  }

  function definitionKey(details = {}) {
    return [details.formCode, details.schoolLevel, details.version]
      .map(value => String(value || '').trim().toLowerCase())
      .join(':');
  }

  function getTemplateDefinition(details = {}) {
    return SF_TEMPLATE_DEFINITIONS[definitionKey(details)] || null;
  }

  async function loadWorkbook(source) {
    if (!window.ExcelJS?.Workbook) throw new Error('The XLSX reader could not be loaded. Reload the page and try again.');
    const buffer = source instanceof ArrayBuffer
      ? source
      : ArrayBuffer.isView(source)
        ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
        : await source.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return { workbook, buffer };
  }

  function worksheetMerges(worksheet) {
    return Array.isArray(worksheet.model?.merges) ? worksheet.model.merges : [];
  }

  function workbookDetails(workbook) {
    let formulaCount = 0;
    let mergedCellCount = 0;
    let imageCount = 0;
    let hiddenSheetCount = 0;
    let hasPrintSettings = false;

    const sheets = workbook.worksheets.map(worksheet => {
      let sheetFormulaCount = 0;
      worksheet.eachRow({ includeEmpty: false }, row => {
        row.eachCell({ includeEmpty: false }, cell => {
          if (cell.value && typeof cell.value === 'object' && cell.value.formula) sheetFormulaCount += 1;
        });
      });

      const sheetMerges = worksheetMerges(worksheet).length;
      const sheetImages = typeof worksheet.getImages === 'function' ? worksheet.getImages().length : 0;
      formulaCount += sheetFormulaCount;
      mergedCellCount += sheetMerges;
      imageCount += sheetImages;
      if (worksheet.state && worksheet.state !== 'visible') hiddenSheetCount += 1;
      if (worksheet.pageSetup && Object.keys(worksheet.pageSetup).length) hasPrintSettings = true;

      return {
        name: worksheet.name,
        rowCount: worksheet.actualRowCount || worksheet.rowCount || 0,
        columnCount: worksheet.actualColumnCount || worksheet.columnCount || 0,
        hidden: Boolean(worksheet.state && worksheet.state !== 'visible'),
        formulaCount: sheetFormulaCount,
        mergedCellCount: sheetMerges
      };
    });

    return {
      sheets,
      workbookSummary: {
        sheetCount: sheets.length,
        formulaCount,
        mergedCellCount,
        imageCount,
        hiddenSheetCount,
        hasPrintSettings
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

  function safeColor(color) {
    const argb = String(color?.argb || '');
    return /^[0-9a-f]{8}$/i.test(argb) ? `#${argb.slice(2)}` : null;
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
      fontSize: Number.isFinite(cell.font?.size) ? Math.min(22, Math.max(9, cell.font.size)) : null
    };
  }

  function worksheetPreview(worksheet, editableCells = []) {
    const actualRows = worksheet.actualRowCount || worksheet.rowCount || 0;
    const actualColumns = worksheet.actualColumnCount || worksheet.columnCount || 0;
    const rowCount = Math.min(Math.max(actualRows, 1), PREVIEW_ROWS);
    const columnCount = Math.min(Math.max(actualColumns, 1), PREVIEW_COLUMNS);
    const merges = mergeMap(worksheet);
    const editable = new Set(editableCells.map(address => String(address).toUpperCase()));
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
      truncated: actualRows > PREVIEW_ROWS || actualColumns > PREVIEW_COLUMNS,
      columnWidths: Array.from({ length: columnCount }, (_, index) => {
        const width = worksheet.getColumn(index + 1).width || 10;
        return Math.min(220, Math.max(48, Math.round(width * 7)));
      }),
      rows
    };
  }

  function validateDefinition(workbook, details = {}) {
    const definition = getTemplateDefinition(details);
    if (!definition) {
      return {
        definition: null,
        mappingStatus: 'unmapped',
        issues: [issue(
          'mapping_unavailable',
          'warning',
          'The workbook can be previewed, but generation requires a verified mapping for this form, level, and version.',
          { field: 'mapping' }
        )]
      };
    }

    const issues = [];
    (definition.requiredSheets || []).forEach(sheetName => {
      if (!workbook.getWorksheet(sheetName)) {
        issues.push(issue('missing_required_sheet', 'error', `Required worksheet "${sheetName}" is missing.`, { sheetName, field: 'mapping' }));
      }
    });

    Object.entries(definition.fields || {}).forEach(([field, mapping]) => {
      const sheetName = mapping.sheetName || definition.sheetName;
      if (!workbook.getWorksheet(sheetName)) {
        issues.push(issue('invalid_mapping_sheet', 'error', `The mapping for ${field} refers to a missing worksheet.`, { sheetName, field }));
      } else if (!/^[A-Z]+\d+$/i.test(mapping.cellAddress || '')) {
        issues.push(issue('invalid_mapping_cell', 'error', `The mapping for ${field} has an invalid cell address.`, { sheetName, field }));
      }
    });

    return {
      definition,
      mappingStatus: issues.length ? 'invalid' : 'ready',
      issues
    };
  }

  async function inspectTemplateFile(file, details = {}) {
    const issues = [];
    const emptyResult = { valid: false, fileHash: null, mappingStatus: 'unmapped', sheets: [], workbookSummary: null, preview: null };
    if (!file) return { ...emptyResult, issues: [issue('file_required', 'error', 'Choose an XLSX workbook.')] };
    if (!file.name.toLowerCase().endsWith('.xlsx')) issues.push(issue('unsupported_file_type', 'error', 'Only XLSX workbooks are supported.'));
    if (!file.size) issues.push(issue('empty_file', 'error', 'The selected workbook is empty.'));
    if (file.size > MAX_FILE_SIZE) issues.push(issue('file_too_large', 'error', 'The workbook must be 10 MB or smaller.'));

    const buffer = issues.length ? null : await file.arrayBuffer();
    if (buffer) {
      const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4));
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) issues.push(issue('invalid_xlsx_container', 'error', 'The selected file is not a valid XLSX workbook.'));
    }
    if (issues.length) return { ...emptyResult, fileHash: buffer ? await fileHash(buffer) : null, issues };

    try {
      const { workbook } = await loadWorkbook(buffer);
      const detailsResult = workbookDetails(workbook);
      if (!detailsResult.sheets.length) issues.push(issue('workbook_has_no_sheets', 'error', 'The workbook does not contain any worksheets.'));
      const mapping = validateDefinition(workbook, details);
      if (details.formCode) issues.push(...mapping.issues);
      const firstSheet = workbook.worksheets.find(sheet => !sheet.state || sheet.state === 'visible') || workbook.worksheets[0];
      return {
        valid: !issues.some(record => record.severity === 'error'),
        fileHash: await fileHash(buffer),
        mappingStatus: mapping.mappingStatus,
        sheets: detailsResult.sheets,
        workbookSummary: detailsResult.workbookSummary,
        preview: firstSheet ? worksheetPreview(firstSheet) : null,
        issues
      };
    } catch (error) {
      return {
        ...emptyResult,
        fileHash: await fileHash(buffer),
        mappingStatus: 'invalid',
        issues: [issue('workbook_unreadable', 'error', 'The workbook could not be opened. It may be damaged, encrypted, or unsupported.')]
      };
    }
  }

  async function saveTemplateFile(storageKey, file) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(file, storageKey);
      transaction.oncomplete = () => {
        database.close();
        resolve(storageKey);
      };
      transaction.onerror = () => {
        database.close();
        reject(new Error('The workbook file could not be stored.'));
      };
    });
  }

  async function getTemplateFile(storageKey) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(storageKey);
      request.onsuccess = () => {
        database.close();
        request.result ? resolve(request.result) : reject(new Error('The stored workbook file could not be found.'));
      };
      request.onerror = () => {
        database.close();
        reject(new Error('The stored workbook file could not be opened.'));
      };
    });
  }

  async function getStoredTemplatePreview(storageKey, sheetName = '') {
    const file = await getTemplateFile(storageKey);
    return getFilePreview(file, sheetName);
  }

  async function getFilePreview(file, sheetName = '') {
    const { workbook } = await loadWorkbook(file);
    const worksheet = workbook.getWorksheet(sheetName) || workbook.worksheets[0];
    if (!worksheet) throw new Error('The workbook does not contain a worksheet to preview.');
    return worksheetPreview(worksheet);
  }

  function valueAtPath(source, path) {
    return String(path || '').split('.').reduce((value, key) => value?.[key], source) ?? null;
  }

  function applyDefinition(workbook, definition, context) {
    Object.entries(definition.fields || {}).forEach(([sourceField, mapping]) => {
      workbook.getWorksheet(mapping.sheetName || definition.sheetName)
        .getCell(mapping.cellAddress).value = valueAtPath(context, mapping.source || sourceField);
    });

    (definition.rows || []).forEach(mapping => {
      const records = valueAtPath(context, mapping.source) || [];
      const worksheet = workbook.getWorksheet(mapping.sheetName || definition.sheetName);
      records.forEach((record, index) => {
        Object.entries(mapping.columns || {}).forEach(([field, column]) => {
          worksheet.getCell(`${column}${mapping.startRow + index}`).value = valueAtPath(record, field);
        });
      });
    });
  }

  function editableAddresses(definition) {
    return Array.isArray(definition?.editableCells) ? definition.editableCells : [];
  }

  async function generateWorkbook(storageKey, details, context) {
    const definition = getTemplateDefinition(details);
    if (!definition) throw new Error('This template does not have a verified system-field mapping yet.');
    const file = await getTemplateFile(storageKey);
    const { workbook } = await loadWorkbook(file);
    const mapping = validateDefinition(workbook, details);
    if (mapping.mappingStatus !== 'ready') throw new Error(mapping.issues[0]?.message || 'The template mapping is invalid.');
    applyDefinition(workbook, definition, context);
    const worksheet = workbook.getWorksheet(definition.sheetName) || workbook.worksheets[0];
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer,
      preview: worksheetPreview(worksheet, editableAddresses(definition)),
      sheetNames: workbook.worksheets.map(sheet => sheet.name),
      editableCells: editableAddresses(definition)
    };
  }

  async function applyGeneratedEdits(buffer, sheetName, edits = [], editableCells = []) {
    const { workbook } = await loadWorkbook(buffer);
    const worksheet = workbook.getWorksheet(sheetName);
    const allowed = new Set(editableCells.map(address => String(address).toUpperCase()));
    edits.forEach(edit => {
      const address = String(edit.address || '').toUpperCase();
      if (allowed.has(address)) worksheet.getCell(address).value = edit.value;
    });
    const updatedBuffer = await workbook.xlsx.writeBuffer();
    return { buffer: updatedBuffer, preview: worksheetPreview(worksheet, editableCells) };
  }

  window.EDUGNAY_SF_WORKBOOK = {
    inspectTemplateFile,
    saveTemplateFile,
    getTemplateFile,
    getFilePreview,
    getStoredTemplatePreview,
    getTemplateDefinition,
    generateWorkbook,
    applyGeneratedEdits
  };
})();
