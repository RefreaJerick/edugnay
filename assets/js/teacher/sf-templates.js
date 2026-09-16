const sfState = {
  templates: [],
  sections: [],
  selectedFile: null,
  inspection: null,
  selectedTemplate: null,
  generated: null,
  editing: false
};

const sfElements = {
  list: document.getElementById('sfTemplateList'),
  count: document.getElementById('sfTemplateCount'),
  codeFilter: document.getElementById('sfCodeFilter'),
  levelFilter: document.getElementById('sfLevelFilter'),
  statusFilter: document.getElementById('sfStatusFilter'),
  modal: document.getElementById('sfImportModal'),
  form: document.getElementById('sfImportForm'),
  file: document.getElementById('sfTemplateFile'),
  fileName: document.getElementById('sfTemplateFileName'),
  validation: document.getElementById('sfValidation'),
  importReview: document.getElementById('sfImportReview'),
  inspectionSummary: document.getElementById('sfInspectionSummary'),
  importSheetTabs: document.getElementById('sfImportSheetTabs'),
  importPreview: document.getElementById('sfImportPreview'),
  error: document.getElementById('sfImportError'),
  submit: document.getElementById('sfImportSubmit'),
  generatorForm: document.getElementById('sfGeneratorForm'),
  templateSelect: document.getElementById('sfGenerateTemplate'),
  sectionSelect: document.getElementById('sfGenerateSection'),
  schoolYear: document.getElementById('sfGenerateSchoolYear'),
  periodSelect: document.getElementById('sfGeneratePeriod'),
  generateButton: document.getElementById('sfGenerateButton'),
  previewTitle: document.getElementById('sfPreviewTitle'),
  previewSubtitle: document.getElementById('sfPreviewSubtitle'),
  previewContent: document.getElementById('sfPreviewContent'),
  editButton: document.getElementById('sfEditDraft'),
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
    (sfElements.levelFilter.value === 'all' || template.schoolLevel === sfElements.levelFilter.value) &&
    (sfElements.statusFilter.value === 'all' || template.status === sfElements.statusFilter.value)
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
      text: hasFilters ? 'Change a filter to see other templates.' : 'Import an official XLSX template to begin.'
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
        <div class="sf-template-file" title="${escapeHtml(template.originalFileName)}">${escapeHtml(template.originalFileName)}</div>
        <div class="sf-template-meta">${escapeHtml(schoolLevelLabel(template.schoolLevel))}</div>
      </div>
      <div class="sf-template-version">
        <div class="sf-template-code">v${escapeHtml(template.version)}</div>
        <div class="sf-template-meta">${escapeHtml(formatTemplateDate(template.uploadedAt))}</div>
      </div>
      <span class="sf-status ${escapeHtml(template.status)}">${escapeHtml(template.status)}</span>
      <div class="sf-template-menu">
        <button class="sf-menu-trigger" type="button" aria-label="Template actions" aria-haspopup="menu" aria-expanded="false" data-template-menu-trigger>
          <i data-lucide="more-vertical" style="width:16px;height:16px;"></i>
        </button>
        <div class="sf-action-menu" role="menu">
          <button class="sf-menu-item" type="button" role="menuitem" data-template-preview="${escapeHtml(template.id)}"><i data-lucide="eye" style="width:14px;height:14px;"></i> Preview template</button>
          <button class="sf-menu-item" type="button" role="menuitem" data-template-setup="${escapeHtml(template.id)}"><i data-lucide="settings-2" style="width:14px;height:14px;"></i> Continue setup</button>
          <button class="sf-menu-item delete" type="button" role="menuitem"><i data-lucide="trash-2" style="width:14px;height:14px;"></i> Delete template</button>
        </div>
      </div>
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
    ? `<option value="">Select an assigned class</option>${sfState.sections.map(section => `<option value="${escapeHtml(section.id)}">${escapeHtml(`${section.grade} - ${section.name}`)}</option>`).join('')}`
    : '<option value="">No assigned classes</option>';

  sfElements.templateSelect.disabled = !activeTemplates.length;
  sfElements.sectionSelect.disabled = !activeTemplates.length || !sfState.sections.length;
  sfElements.schoolYear.value = window.EDUGNAY_CONFIG.getActiveSchool()?.schoolYear || '';
  renderPeriodOptions();
}

function renderPeriodOptions() {
  const section = sfState.sections.find(record => record.id === sfElements.sectionSelect.value);
  const periods = section
    ? window.EDUGNAY_CONFIG.getAcademicPeriods(window.EDUGNAY_CONFIG.getActiveSchoolId(), section.level)
    : [];
  sfElements.periodSelect.innerHTML = periods.length
    ? `<option value="">Select a period</option>${periods.map(period => `<option value="${escapeHtml(period.id)}">${escapeHtml(period.name)}</option>`).join('')}`
    : '<option value="">Select a class first</option>';
  sfElements.periodSelect.disabled = !periods.length;
  updateGenerateButton();
}

function updateGenerateButton() {
  sfElements.generateButton.disabled = !(
    sfElements.templateSelect.value &&
    sfElements.sectionSelect.value &&
    sfElements.schoolYear.value &&
    sfElements.periodSelect.value
  );
}

function closeTemplateMenus() {
  document.querySelectorAll('.sf-action-menu.open').forEach(menu => menu.classList.remove('open'));
  document.querySelectorAll('[data-template-menu-trigger][aria-expanded="true"]')
    .forEach(button => button.setAttribute('aria-expanded', 'false'));
}

function openImportModal() {
  sfElements.form.reset();
  sfState.selectedFile = null;
  sfState.inspection = null;
  sfElements.fileName.textContent = 'No file selected';
  sfElements.fileName.classList.remove('has-file');
  sfElements.validation.hidden = true;
  sfElements.importReview.hidden = true;
  sfElements.error.hidden = true;
  sfElements.submit.disabled = true;
  sfElements.modal.classList.add('open');
  sfElements.modal.setAttribute('aria-hidden', 'false');
  document.getElementById('sfFormCode').focus();
}

function closeImportModal() {
  sfElements.modal.classList.remove('open');
  sfElements.modal.setAttribute('aria-hidden', 'true');
}

function renderValidation() {
  const result = sfState.inspection;
  if (!result) {
    sfElements.validation.hidden = true;
    sfElements.submit.disabled = true;
    return;
  }

  const hasError = result.issues.some(record => record.severity === 'error');
  const hasWarning = result.issues.some(record => record.severity === 'warning');
  sfElements.validation.className = `sf-validation ${hasError ? 'error' : hasWarning ? 'warning' : 'success'}`;
  sfElements.validation.innerHTML = result.issues.length
    ? result.issues.map(record => `<div class="sf-validation-item">${escapeHtml(record.message)}</div>`).join('')
    : '<div class="sf-validation-item">Workbook opened successfully. Review its worksheets before importing.</div>';
  sfElements.validation.hidden = false;
  sfElements.submit.disabled = !result.valid;
}

function renderInspectionSummary(summary) {
  sfElements.inspectionSummary.innerHTML = [
    ['Worksheets', summary.sheetCount],
    ['Formulas', summary.formulaCount],
    ['Merged ranges', summary.mergedCellCount],
    ['Images', summary.imageCount]
  ].map(([label, value]) => `<div class="sf-inspection-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
}

function renderSheetTabs(container, sheets, selectedName) {
  container.innerHTML = sheets.map(sheet => `
    <button class="sf-sheet-tab ${sheet.name === selectedName ? 'active' : ''}" type="button" data-sheet-name="${escapeHtml(sheet.name)}">
      ${escapeHtml(sheet.name)}${sheet.hidden ? ' (hidden)' : ''}
    </button>
  `).join('');
}

function cellStyle(cell) {
  const style = cell.style || {};
  const values = [];
  if (style.bold) values.push('font-weight:700');
  if (style.italic) values.push('font-style:italic');
  if (style.fontColor) values.push(`color:${style.fontColor}`);
  if (style.backgroundColor) values.push(`background-color:${style.backgroundColor}`);
  if (style.horizontal) values.push(`text-align:${style.horizontal}`);
  if (style.vertical) values.push(`vertical-align:${style.vertical}`);
  if (style.wrapText) values.push('white-space:normal');
  if (style.fontSize) values.push(`font-size:${style.fontSize}px`);
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

function workbookTable(preview, editing = false) {
  const columns = preview.columnWidths.map((width, index) => `<col style="width:${width}px" data-column="${columnLabel(index + 1)}">`).join('');
  const header = preview.columnWidths.map((width, index) => `<th style="min-width:${width}px">${columnLabel(index + 1)}</th>`).join('');
  const rows = preview.rows.map(row => `
    <tr style="height:${row.height}px">
      <th class="sf-row-number">${row.number}</th>
      ${row.cells.map(cell => `
        <td class="sf-workbook-cell ${cell.editable ? 'editable' : ''}"
          rowspan="${cell.rowSpan}" colspan="${cell.columnSpan}"
          style="${cellStyle(cell)}" title="${escapeHtml(cell.formula ? `=${cell.formula}` : cell.address)}"
          ${editing && cell.editable ? `contenteditable="true" data-cell-address="${escapeHtml(cell.address)}"` : ''}>${escapeHtml(cell.text)}</td>
      `).join('')}
    </tr>
  `).join('');
  return `<table class="sf-workbook-table"><colgroup><col class="sf-row-number-column">${columns}</colgroup><thead><tr><th></th>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderWorkbook(container, preview, editing = false) {
  container.innerHTML = `${workbookTable(preview, editing)}${preview.truncated ? '<div class="sf-preview-limit">Preview limited to the first 60 rows and 24 columns.</div>' : ''}`;
}

function renderImportReview() {
  const result = sfState.inspection;
  if (!result?.valid || !result.preview || !result.workbookSummary) {
    sfElements.importReview.hidden = true;
    return;
  }
  sfElements.importReview.hidden = false;
  renderInspectionSummary(result.workbookSummary);
  renderSheetTabs(sfElements.importSheetTabs, result.sheets, result.preview.name);
  renderWorkbook(sfElements.importPreview, result.preview);
}

async function reviewSelectedFile() {
  sfState.selectedFile = sfElements.file.files?.[0] || null;
  sfElements.fileName.textContent = sfState.selectedFile?.name || 'No file selected';
  sfElements.fileName.classList.toggle('has-file', Boolean(sfState.selectedFile));
  sfElements.validation.className = 'sf-validation';
  sfElements.validation.textContent = 'Opening workbook...';
  sfElements.validation.hidden = false;
  sfElements.importReview.hidden = true;
  sfElements.submit.disabled = true;
  sfState.inspection = await window.EDUGNAY_CONFIG.validateSfTemplate(sfState.selectedFile);
  renderValidation();
  renderImportReview();
}

async function showImportSheet(sheetName) {
  if (!sfState.selectedFile) return;
  sfElements.importPreview.innerHTML = '<div class="sf-preview-loading">Opening worksheet...</div>';
  const preview = await window.EDUGNAY_SF_WORKBOOK.getFilePreview(sfState.selectedFile, sheetName);
  renderSheetTabs(sfElements.importSheetTabs, sfState.inspection.sheets, preview.name);
  renderWorkbook(sfElements.importPreview, preview);
}

async function submitTemplateImport(event) {
  event.preventDefault();
  sfElements.error.hidden = true;
  if (!sfState.selectedFile || !sfState.inspection?.valid) return;

  const values = {
    formCode: document.getElementById('sfFormCode').value,
    formName: document.getElementById('sfFormName').value,
    schoolLevel: document.getElementById('sfSchoolLevel').value,
    version: document.getElementById('sfTemplateVersion').value
  };

  sfElements.submit.disabled = true;
  sfElements.submit.textContent = 'Importing...';
  try {
    const created = await window.EDUGNAY_CONFIG.importSfTemplate(sfState.selectedFile, values);
    sfState.templates = await window.EDUGNAY_CONFIG.getSfTemplates();
    renderTemplateLibrary();
    renderGenerationOptions();
    closeImportModal();
    await openTemplatePreview(created.id);
    showSfToast(created.status === 'active' ? 'Template imported and activated.' : 'Template imported as a draft.');
  } catch (error) {
    sfElements.error.textContent = error.message;
    sfElements.error.hidden = false;
  } finally {
    sfElements.submit.textContent = 'Import template';
    sfElements.submit.disabled = !sfState.inspection?.valid;
  }
}

async function openTemplatePreview(templateId, sheetName = '') {
  const template = sfState.templates.find(record => record.id === String(templateId));
  if (!template) return;
  sfState.selectedTemplate = template;
  sfState.generated = null;
  sfState.editing = false;
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
      schoolYear: sfElements.schoolYear.value,
      academicPeriodId: sfElements.periodSelect.value
    });
    sfState.editing = false;
    sfElements.previewTitle.textContent = 'Generated form preview';
    sfElements.previewSubtitle.textContent = 'Review mapped values before downloading the XLSX file.';
    sfElements.previewContent.innerHTML = '<div class="sf-workbook-frame" id="sfMainWorkbook"></div>';
    renderWorkbook(document.getElementById('sfMainWorkbook'), sfState.generated.preview);
    sfElements.editButton.disabled = !sfState.generated.editableCells.length;
    sfElements.downloadButton.disabled = false;
  } catch (error) {
    showSfToast(error.message);
  } finally {
    sfElements.generateButton.textContent = 'Generate preview';
    updateGenerateButton();
  }
}

async function toggleGeneratedEditing() {
  if (!sfState.generated) return;
  const workbook = document.getElementById('sfMainWorkbook');
  if (!sfState.editing) {
    sfState.editing = true;
    sfElements.editButton.textContent = 'Save edits';
    renderWorkbook(workbook, sfState.generated.preview, true);
    return;
  }

  const edits = Array.from(workbook.querySelectorAll('[data-cell-address]')).map(cell => ({
    address: cell.dataset.cellAddress,
    value: cell.textContent
  }));
  const result = await window.EDUGNAY_SF_WORKBOOK.applyGeneratedEdits(
    sfState.generated.buffer,
    sfState.generated.preview.name,
    edits,
    sfState.generated.editableCells
  );
  sfState.generated.buffer = result.buffer;
  sfState.generated.preview = result.preview;
  sfState.editing = false;
  sfElements.editButton.textContent = 'Edit draft';
  renderWorkbook(workbook, sfState.generated.preview);
  showSfToast('Draft edits saved in this browser.');
}

function downloadGeneratedWorkbook() {
  if (!sfState.generated) return;
  const blob = new Blob([sfState.generated.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = sfState.generated.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function showSfToast(message) {
  sfElements.toast.textContent = message;
  sfElements.toast.classList.add('show');
  window.setTimeout(() => sfElements.toast.classList.remove('show'), 3200);
}

async function initializeSfTemplatesPage() {
  [sfState.templates, sfState.sections] = await Promise.all([
    window.EDUGNAY_CONFIG.getSfTemplates(),
    window.EDUGNAY_CONFIG.getMyTeachingSections()
  ]);
  renderTemplateLibrary();
  renderGenerationOptions();
  if (window.lucide) lucide.createIcons();
}

document.getElementById('sfOpenImport').addEventListener('click', openImportModal);
document.getElementById('sfImportClose').addEventListener('click', closeImportModal);
document.getElementById('sfImportCancel').addEventListener('click', closeImportModal);
document.getElementById('sfChooseFile').addEventListener('click', () => sfElements.file.click());
sfElements.file.addEventListener('change', reviewSelectedFile);
sfElements.form.addEventListener('submit', submitTemplateImport);
sfElements.generatorForm.addEventListener('submit', generateForm);
sfElements.sectionSelect.addEventListener('change', renderPeriodOptions);
[sfElements.templateSelect, sfElements.periodSelect].forEach(select => select.addEventListener('change', updateGenerateButton));
[sfElements.codeFilter, sfElements.levelFilter, sfElements.statusFilter]
  .forEach(select => select.addEventListener('change', renderTemplateLibrary));
sfElements.editButton.addEventListener('click', toggleGeneratedEditing);
sfElements.downloadButton.addEventListener('click', downloadGeneratedWorkbook);

sfElements.importSheetTabs.addEventListener('click', event => {
  const tab = event.target.closest('[data-sheet-name]');
  if (tab) showImportSheet(tab.dataset.sheetName);
});

sfElements.previewContent.addEventListener('click', event => {
  const tab = event.target.closest('[data-sheet-name]');
  if (tab && sfState.selectedTemplate) openTemplatePreview(sfState.selectedTemplate.id, tab.dataset.sheetName);
});

sfElements.list.addEventListener('click', event => {
  const previewButton = event.target.closest('[data-template-preview]');
  const setupButton = event.target.closest('[data-template-setup]');
  const trigger = event.target.closest('[data-template-menu-trigger]');
  if (previewButton) {
    closeTemplateMenus();
    openTemplatePreview(previewButton.dataset.templatePreview);
    return;
  }
  if (setupButton) {
    closeTemplateMenus();
    openTemplatePreview(setupButton.dataset.templateSetup);
    showSfToast('A verified mapping will be added when the official form is configured.');
    return;
  }
  if (!trigger) return;
  const menu = trigger.nextElementSibling;
  const willOpen = !menu.classList.contains('open');
  closeTemplateMenus();
  menu.classList.toggle('open', willOpen);
  trigger.setAttribute('aria-expanded', String(willOpen));
});

sfElements.modal.addEventListener('click', event => {
  if (event.target === sfElements.modal) closeImportModal();
});

document.addEventListener('click', event => {
  if (!event.target.closest('.sf-template-menu')) closeTemplateMenus();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeImportModal();
    closeTemplateMenus();
  }
});

document.addEventListener('DOMContentLoaded', initializeSfTemplatesPage);
