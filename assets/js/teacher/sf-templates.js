const sfState = {
  templates: [],
  sections: [],
  selectedTemplate: null,
  generated: null,
  editing: false,
  preview: null,
  zoomMode: 'fit',
  zoom: 1
};

let previewResizeTimer;

const sfElements = {
  list: document.getElementById('sfTemplateList'),
  count: document.getElementById('sfTemplateCount'),
  codeFilter: document.getElementById('sfCodeFilter'),
  levelFilter: document.getElementById('sfLevelFilter'),
  generatorForm: document.getElementById('sfGeneratorForm'),
  templateSelect: document.getElementById('sfGenerateTemplate'),
  sectionSelect: document.getElementById('sfGenerateSection'),
  schoolYear: document.getElementById('sfGenerateSchoolYear'),
  generateButton: document.getElementById('sfGenerateButton'),
  previewTitle: document.getElementById('sfPreviewTitle'),
  previewSubtitle: document.getElementById('sfPreviewSubtitle'),
  previewContent: document.getElementById('sfPreviewContent'),
  editButton: document.getElementById('sfEditGenerated'),
  downloadButton: document.getElementById('sfDownloadWorkbook'),
  toast: document.getElementById('sfToast')
};

function schoolLevelLabel(level) {
  return {
    elementary: 'Elementary',
    jhs: 'Junior High School',
    shs: 'Senior High School'
  }[level] || level;
}

function schoolLevelsLabel(levels) {
  return (Array.isArray(levels) ? levels : []).map(schoolLevelLabel).join(', ');
}

function formatTemplateDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(value) {
  return window.EDUGNAY_CONFIG.escapeHtml(String(value ?? ''));
}

function filteredTemplates() {
  return sfState.templates.filter(template => (
    (sfElements.codeFilter.value === 'all' || template.formCode === sfElements.codeFilter.value) &&
    (sfElements.levelFilter.value === 'all' || (template.schoolLevels || []).includes(sfElements.levelFilter.value))
  ));
}

function renderTemplateLibrary() {
  const records = filteredTemplates();
  const total = sfState.templates.length;
  sfElements.count.textContent = `${total} template${total === 1 ? '' : 's'}`;

  if (!records.length) {
    const hasFilters = total > 0;
    sfElements.list.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
      icon: hasFilters ? 'search-x' : 'file-spreadsheet',
      title: hasFilters ? 'No templates match these filters' : 'No SF templates available',
      text: hasFilters ? 'Change a filter to see other templates.' : 'Official templates will appear here when they are configured.'
    });
    return;
  }

  sfElements.list.innerHTML = records.map(template => `
    <article class="sf-template-row">
      <div class="sf-template-icon" aria-hidden="true"><i data-lucide="file-spreadsheet"></i></div>
      <div>
        <div class="sf-template-code">${escapeHtml(template.formCode)}</div>
        <div class="sf-template-name">${escapeHtml(template.formName)}</div>
      </div>
      <div>
        <div class="sf-template-file" title="${escapeHtml(template.fileName || 'Official XLSX template')}">${escapeHtml(template.fileName || 'Official XLSX template')}</div>
        <div class="sf-template-meta">${escapeHtml(schoolLevelsLabel(template.schoolLevels))}</div>
      </div>
      <div class="sf-template-version">
        <div class="sf-template-code">v${escapeHtml(template.version)}</div>
        <div class="sf-template-meta">${escapeHtml(template.updatedAt ? `Updated ${formatTemplateDate(template.updatedAt)}` : 'Official source workbook')}</div>
      </div>
      <button class="sf-template-preview" type="button" data-template-preview="${escapeHtml(template.id)}">Preview</button>
    </article>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

function renderGenerationOptions() {
  const activeTemplates = sfState.templates.filter(template => template.status === 'active' && template.mappingStatus === 'ready');
  sfElements.templateSelect.innerHTML = activeTemplates.length
    ? `<option value="">Select a template</option>${activeTemplates.map(template => `<option value="${escapeHtml(template.id)}">${escapeHtml(`${template.formCode} - ${template.formName}`)}</option>`).join('')}`
    : '<option value="">No active templates</option>';

  sfElements.sectionSelect.innerHTML = sfState.sections.length
    ? `<option value="">Select an advisory class</option>${sfState.sections.map(section => `<option value="${escapeHtml(section.id)}">${escapeHtml(`${section.grade} - ${section.name}`)}</option>`).join('')}`
    : '<option value="">No advisory classes</option>';

  sfElements.templateSelect.disabled = !activeTemplates.length;
  sfElements.sectionSelect.disabled = !activeTemplates.length || !sfState.sections.length;
  sfElements.schoolYear.value = window.EDUGNAY_CONFIG.getActiveSchool()?.schoolYear || '';
  updateGenerateButton();
}

function updateGenerateButton() {
  sfElements.generateButton.disabled = !(
    sfElements.templateSelect.value &&
    sfElements.sectionSelect.value &&
    sfElements.schoolYear.value
  );
}

function renderSheetTabs(container, sheets, selectedName) {
  container.innerHTML = sheets.map(sheet => `
    <button class="sf-sheet-tab ${sheet.name === selectedName ? 'active' : ''}" type="button" data-sheet-name="${escapeHtml(sheet.name)}">
      ${escapeHtml(sheet.name)}${sheet.hidden ? ' (hidden)' : ''}
    </button>
  `).join('');
}

function cellStyle(cell, scale) {
  const style = cell.style || {};
  const values = [];
  if (style.bold) values.push('font-weight:700');
  if (style.italic) values.push('font-style:italic');
  if (style.fontColor) values.push(`color:${style.fontColor}`);
  if (style.backgroundColor) values.push(`background-color:${style.backgroundColor}`);
  if (style.horizontal) values.push(`text-align:${style.horizontal}`);
  if (style.vertical) values.push(`vertical-align:${style.vertical}`);
  if (style.wrapText) values.push('white-space:normal');
  if (style.fontSize) values.push(`font-size:${Math.max(6, style.fontSize * scale)}px`);
  Object.entries(style.borders || {}).forEach(([side, border]) => {
    if (!border?.style) return;
    const lineStyle = ['dashed', 'dotted', 'double'].includes(border.style) ? border.style : 'solid';
    const width = border.style === 'thick' ? 3 : border.style === 'medium' ? 2 : 1;
    const lineWidth = `${Math.max(1, Math.round(width * scale))}px`;
    values.push(`border-${side}:${lineWidth} ${lineStyle} ${border.color || '#cbd5e1'}`);
  });
  return values.join(';');
}

function columnLabel(number) {
  let label = '';
  let value = number;
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function workbookTable(preview, editing, scale) {
  const columnWidth = width => Math.max(18, Math.round(width * scale));
  const columnWidths = preview.columnWidths.map(columnWidth);
  const columns = columnWidths.map((width, index) => `<col style="width:${width}px" data-column="${columnLabel(index + 1)}">`).join('');
  const header = columnWidths.map((width, index) => `<th style="width:${width}px">${columnLabel(index + 1)}</th>`).join('');
  const rows = preview.rows.map(row => `
    <tr style="height:${Math.max(15, Math.round(row.height * scale))}px">
      <th class="sf-row-number">${row.number}</th>
      ${row.cells.map(cell => `
        <td class="sf-workbook-cell ${cell.editable ? 'editable' : ''}"
          rowspan="${cell.rowSpan}" colspan="${cell.columnSpan}"
          style="${cellStyle(cell, scale)}" title="${escapeHtml(cell.formula ? `=${cell.formula}` : cell.address)}"
          ${editing && cell.editable ? `contenteditable="true" data-cell-address="${escapeHtml(cell.address)}"` : ''}>${escapeHtml(cell.text)}</td>
      `).join('')}
    </tr>
  `).join('');
  const rowNumberWidth = Math.max(24, Math.round(34 * scale));
  const sheetWidth = rowNumberWidth + columnWidths.reduce((total, width) => total + width, 0);
  const fontSize = Math.max(7, 11 * scale);
  const paddingY = Math.max(2, 4 * scale);
  const paddingX = Math.max(3, 6 * scale);
  return `<table class="sf-workbook-table" style="--sf-sheet-width:${sheetWidth}px;--sf-row-number-width:${rowNumberWidth}px;--sf-preview-font-size:${fontSize}px;--sf-cell-padding-y:${paddingY}px;--sf-cell-padding-x:${paddingX}px"><colgroup><col class="sf-row-number-column">${columns}</colgroup><thead><tr><th></th>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}

function getWorkbookScale(container, preview) {
  if (sfState.zoomMode !== 'fit') return sfState.zoom;
  const sheetWidth = 34 + preview.columnWidths.reduce((total, width) => total + width, 0);
  const availableWidth = Math.max(280, (container.clientWidth || sfElements.previewContent.clientWidth || 960) - 48);
  sfState.zoom = Math.max(0.3, Math.min(1, Math.floor((availableWidth / sheetWidth) * 100) / 100));
  return sfState.zoom;
}

function renderWorkbook(container, preview, editing = false) {
  sfState.preview = preview;
  const scale = getWorkbookScale(container, preview);
  const percentage = Math.round(scale * 100);
  container.innerHTML = `
    <div class="sf-workbook-toolbar" role="toolbar" aria-label="Workbook preview zoom">
      <span class="sf-zoom-description">${sfState.zoomMode === 'fit' ? 'Fit width' : 'Preview scale'}</span>
      <div class="sf-zoom-controls">
        <button class="sf-zoom-button ${sfState.zoomMode === 'fit' ? 'active' : ''}" type="button" data-preview-zoom="fit">Fit</button>
        <button class="sf-zoom-button ${sfState.zoomMode === 'custom' && scale === 0.75 ? 'active' : ''}" type="button" data-preview-zoom="75">75%</button>
        <button class="sf-zoom-button ${sfState.zoomMode === 'custom' && scale === 1 ? 'active' : ''}" type="button" data-preview-zoom="100">100%</button>
        <button class="sf-zoom-icon" type="button" data-preview-zoom="out" aria-label="Zoom out" ${scale <= 0.3 ? 'disabled' : ''}>−</button>
        <span class="sf-zoom-value" aria-live="polite">${percentage}%</span>
        <button class="sf-zoom-icon" type="button" data-preview-zoom="in" aria-label="Zoom in" ${scale >= 1.5 ? 'disabled' : ''}>+</button>
      </div>
    </div>
    <div class="sf-workbook-viewport">
      <div class="sf-workbook-sheet">${workbookTable(preview, editing, scale)}</div>
      ${preview.truncated ? `<div class="sf-preview-limit">Preview limited to the first ${preview.rows.length} rows and ${preview.columnWidths.length} columns.</div>` : ''}
    </div>`;
}

function preservePreviewEdits() {
  if (!sfState.editing || !sfState.preview) return sfState.generated?.edits || [];
  const workbook = document.getElementById('sfMainWorkbook');
  if (!workbook) return sfState.generated?.edits || [];
  const values = new Map(Array.from(workbook.querySelectorAll('[data-cell-address]')).map(cell => [cell.dataset.cellAddress, cell.textContent]));
  sfState.preview.rows.forEach(row => row.cells.forEach(cell => {
    if (values.has(cell.address)) cell.text = values.get(cell.address);
  }));
  const edits = Array.from(values, ([cellAddress, value]) => ({ cellAddress, value }));
  if (sfState.generated) sfState.generated.edits = edits;
  return edits;
}

function changePreviewZoom(action) {
  if (!sfState.preview) return;
  preservePreviewEdits();
  if (action === 'fit') {
    sfState.zoomMode = 'fit';
  } else if (action === '75' || action === '100') {
    sfState.zoomMode = 'custom';
    sfState.zoom = Number(action) / 100;
  } else {
    sfState.zoomMode = 'custom';
    sfState.zoom = Math.max(0.3, Math.min(1.5, Math.round((sfState.zoom + (action === 'in' ? 0.1 : -0.1)) * 10) / 10));
  }
  const workbook = document.getElementById('sfMainWorkbook');
  if (workbook) renderWorkbook(workbook, sfState.preview, sfState.editing);
}

function renderIssueSummary(issues = []) {
  if (!issues.length) return '';
  const hasErrors = issues.some(record => record.severity === 'error');
  const title = hasErrors ? 'Generation needs attention' : 'Review before downloading';
  return `
    <div class="sf-validation-summary ${hasErrors ? 'error' : 'warning'}" role="status">
      <strong>${title}</strong>
      <ul>${issues.map(record => `<li>${escapeHtml(record.message)}</li>`).join('')}</ul>
    </div>`;
}

async function openTemplatePreview(templateId, sheetName = '') {
  const template = sfState.templates.find(record => record.id === String(templateId));
  if (!template) return;
  sfState.selectedTemplate = template;
  sfState.generated = null;
  sfState.editing = false;
  sfState.zoomMode = 'fit';
  sfElements.previewTitle.textContent = `${template.formCode} template preview`;
  sfElements.previewSubtitle.textContent = template.mappingStatus === 'ready'
    ? 'This template passed its workbook and mapping checks.'
    : 'Preview available. Generation requires a verified mapping for this form, level, and version.';
  sfElements.previewContent.innerHTML = '<div class="sf-preview-loading">Opening workbook...</div>';
  sfElements.editButton.disabled = true;
  sfElements.downloadButton.disabled = true;

  try {
    const result = await window.EDUGNAY_CONFIG.getSfTemplatePreview(template.id, sheetName);
    sfElements.previewContent.innerHTML = `<div class="sf-main-sheet-tabs" id="sfMainSheetTabs"></div><div class="sf-workbook-frame" id="sfMainWorkbook"></div>`;
    const tabs = document.getElementById('sfMainSheetTabs');
    renderSheetTabs(tabs, template.sheets, result.preview.name);
    renderWorkbook(document.getElementById('sfMainWorkbook'), result.preview);
    sfElements.previewContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    sfElements.previewContent.innerHTML = `<div class="sf-preview-error">${escapeHtml(error.message)}</div>`;
  }
}

async function generateForm(event) {
  event.preventDefault();
  sfElements.generateButton.disabled = true;
  sfElements.generateButton.textContent = 'Generating...';
  try {
    sfState.generated = await window.EDUGNAY_CONFIG.generateSfForm({
      templateId: sfElements.templateSelect.value,
      sectionId: sfElements.sectionSelect.value,
      schoolYear: sfElements.schoolYear.value
    });
    sfState.selectedTemplate = sfState.templates.find(template => template.id === sfState.generated.templateId) || null;
    sfState.editing = false;
    sfState.zoomMode = 'fit';
    sfElements.previewTitle.textContent = 'Generated form preview';
    sfElements.previewSubtitle.textContent = 'Review mapped values before downloading the XLSX file.';
    sfElements.previewContent.innerHTML = `${renderIssueSummary(sfState.generated.issues)}<div class="sf-workbook-frame" id="sfMainWorkbook"></div>`;
    renderWorkbook(document.getElementById('sfMainWorkbook'), sfState.generated.preview);
    sfElements.editButton.disabled = !sfState.generated.editableCells?.length;
    sfElements.downloadButton.disabled = false;
  } catch (error) {
    showSfToast(error.message);
  } finally {
    sfElements.generateButton.textContent = 'Generate preview';
    updateGenerateButton();
  }
}

function toggleGeneratedEditing() {
  if (!sfState.generated) return;
  const workbook = document.getElementById('sfMainWorkbook');
  if (!sfState.editing) {
    sfState.editing = true;
    sfElements.editButton.textContent = 'Save edits';
    renderWorkbook(workbook, sfState.generated.preview, true);
    return;
  }

  preservePreviewEdits();
  sfState.editing = false;
  sfElements.editButton.textContent = 'Edit generated form';
  renderWorkbook(workbook, sfState.generated.preview);
  showSfToast('Generated form edits saved in this browser.');
}

async function downloadGeneratedWorkbook() {
  if (!sfState.generated) return;
  if (sfState.editing) {
    preservePreviewEdits();
    sfState.editing = false;
    sfElements.editButton.textContent = 'Edit generated form';
    renderWorkbook(document.getElementById('sfMainWorkbook'), sfState.generated.preview);
  }

  sfElements.downloadButton.disabled = true;
  sfElements.downloadButton.textContent = 'Preparing XLSX...';
  try {
    const result = await window.EDUGNAY_CONFIG.exportSfForm({
      templateId: sfState.generated.templateId,
      sectionId: sfState.generated.sectionId,
      fileName: sfState.generated.fileName,
      mappedCells: sfState.generated.mappedCells,
      edits: sfState.generated.edits
    });
    const blob = new Blob([result.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = result.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  } catch (error) {
    showSfToast(error.message);
  } finally {
    sfElements.downloadButton.innerHTML = '<i data-lucide="download"></i> Download XLSX';
    sfElements.downloadButton.disabled = false;
    if (window.lucide) lucide.createIcons();
  }
}

function showSfToast(message) {
  sfElements.toast.textContent = message;
  sfElements.toast.classList.add('show');
  window.setTimeout(() => sfElements.toast.classList.remove('show'), 3200);
}

async function initializeSfTemplatesPage() {
  [sfState.templates, sfState.sections] = await Promise.all([
    window.EDUGNAY_CONFIG.getSfTemplates(),
    window.EDUGNAY_CONFIG.getMyAdvisorySections()
  ]);
  renderTemplateLibrary();
  renderGenerationOptions();
  if (window.lucide) lucide.createIcons();
}

sfElements.generatorForm.addEventListener('submit', generateForm);
[sfElements.templateSelect, sfElements.sectionSelect, sfElements.schoolYear].forEach(select => select.addEventListener('change', updateGenerateButton));
[sfElements.codeFilter, sfElements.levelFilter]
  .forEach(select => select.addEventListener('change', renderTemplateLibrary));
sfElements.editButton.addEventListener('click', toggleGeneratedEditing);
sfElements.downloadButton.addEventListener('click', downloadGeneratedWorkbook);

sfElements.previewContent.addEventListener('click', event => {
  const zoomButton = event.target.closest('[data-preview-zoom]');
  if (zoomButton) {
    changePreviewZoom(zoomButton.dataset.previewZoom);
    return;
  }
  const tab = event.target.closest('[data-sheet-name]');
  if (tab && sfState.selectedTemplate) openTemplatePreview(sfState.selectedTemplate.id, tab.dataset.sheetName);
});

sfElements.list.addEventListener('click', event => {
  const previewButton = event.target.closest('[data-template-preview]');
  if (previewButton) {
    openTemplatePreview(previewButton.dataset.templatePreview);
  }
});

document.addEventListener('DOMContentLoaded', initializeSfTemplatesPage);

window.addEventListener('resize', () => {
  if (sfState.zoomMode !== 'fit' || !sfState.preview) return;
  window.clearTimeout(previewResizeTimer);
  previewResizeTimer = window.setTimeout(() => {
    preservePreviewEdits();
    const workbook = document.getElementById('sfMainWorkbook');
    if (workbook) renderWorkbook(workbook, sfState.preview, sfState.editing);
  }, 120);
});
