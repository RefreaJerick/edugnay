const sfState = {
  templates: [],
  sections: [],
  selectedTemplate: null,
  generated: null,
  editing: false
};

const sfElements = {
  list: document.getElementById('sfTemplateList'),
  count: document.getElementById('sfTemplateCount'),
  codeFilter: document.getElementById('sfCodeFilter'),
  levelFilter: document.getElementById('sfLevelFilter'),
  generatorForm: document.getElementById('sfGeneratorForm'),
  templateSelect: document.getElementById('sfGenerateTemplate'),
  sectionSelect: document.getElementById('sfGenerateSection'),
  schoolYear: document.getElementById('sfGenerateSchoolYear'),
  periodSelect: document.getElementById('sfGeneratePeriod'),
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
    (sfElements.levelFilter.value === 'all' || template.schoolLevel === sfElements.levelFilter.value)
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
        <div class="sf-template-meta">${escapeHtml(schoolLevelLabel(template.schoolLevel))}</div>
      </div>
      <div class="sf-template-version">
        <div class="sf-template-code">v${escapeHtml(template.version)}</div>
        <div class="sf-template-meta">Updated ${escapeHtml(formatTemplateDate(template.updatedAt))}</div>
      </div>
      <span class="sf-status active">Available</span>
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
  sfElements.editButton.textContent = 'Edit generated form';
  renderWorkbook(workbook, sfState.generated.preview);
  showSfToast('Generated form edits saved in this browser.');
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

sfElements.generatorForm.addEventListener('submit', generateForm);
sfElements.sectionSelect.addEventListener('change', renderPeriodOptions);
[sfElements.templateSelect, sfElements.periodSelect].forEach(select => select.addEventListener('change', updateGenerateButton));
[sfElements.codeFilter, sfElements.levelFilter]
  .forEach(select => select.addEventListener('change', renderTemplateLibrary));
sfElements.editButton.addEventListener('click', toggleGeneratedEditing);
sfElements.downloadButton.addEventListener('click', downloadGeneratedWorkbook);

sfElements.previewContent.addEventListener('click', event => {
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
