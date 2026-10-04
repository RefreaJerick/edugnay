const sfState = {
  templates: [],
  sections: [],
  selectedTemplateIds: [],
  selectedTemplate: null,
  generated: null,
  combined: null,
  editing: false,
  generationInProgress: false,
  blankDownloadInProgress: false,
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
  templatePicker: document.getElementById('sfTemplatePicker'),
  templateTrigger: document.getElementById('sfTemplateTrigger'),
  templateSummary: document.getElementById('sfTemplateSummary'),
  templateDropdown: document.getElementById('sfTemplateDropdown'),
  templateSearch: document.getElementById('sfTemplateSearch'),
  templateNoResults: document.getElementById('sfTemplateNoResults'),
  templateClear: document.getElementById('sfTemplateClear'),
  templateDone: document.getElementById('sfTemplateDone'),
  templateList: document.getElementById('sfGenerateTemplates'),
  sectionSelect: document.getElementById('sfGenerateSection'),
  schoolYear: document.getElementById('sfGenerateSchoolYear'),
  monthField: document.getElementById('sfGenerateMonthField'),
  month: document.getElementById('sfGenerateMonth'),
  generateButton: document.getElementById('sfGenerateButton'),
  blankCombinedDownloadButton: document.getElementById('sfBlankCombinedDownload'),
  previewTitle: document.getElementById('sfPreviewTitle'),
  previewSubtitle: document.getElementById('sfPreviewSubtitle'),
  previewContent: document.getElementById('sfPreviewContent'),
  editButton: document.getElementById('sfEditGenerated'),
  downloadButton: document.getElementById('sfDownloadWorkbook')
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
      <div class="sf-template-actions">
        <button class="sf-template-preview" type="button" data-template-preview="${escapeHtml(template.id)}">Preview</button>
        <button class="sf-template-download" type="button" data-template-download="${escapeHtml(template.id)}"
          aria-label="Download blank ${escapeHtml(template.formCode)} template"
          title="Download blank ${escapeHtml(template.formCode)} template">
          <i data-lucide="download" aria-hidden="true"></i>
        </button>
      </div>
    </article>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

function renderGenerationOptions() {
  const activeTemplates = sfState.templates.filter(template => template.status === 'active' && template.mappingStatus === 'ready');
  sfState.selectedTemplateIds = sfState.selectedTemplateIds.filter(id => activeTemplates.some(template => template.id === id));
  sfElements.templateList.innerHTML = activeTemplates.length
    ? activeTemplates.map(template => `
      <label class="sf-template-choice">
        <input type="checkbox" value="${escapeHtml(template.id)}" ${sfState.selectedTemplateIds.includes(template.id) ? 'checked' : ''}>
        <span>${escapeHtml(template.formCode)} · ${escapeHtml(template.formName)}</span>
      </label>
    `).join('')
    : '<div class="sf-template-select-empty">No active templates are available.</div>';
  sfElements.templateTrigger.disabled = !activeTemplates.length;
  sfElements.templateSearch.disabled = !activeTemplates.length;
  updateTemplatePicker();

  sfElements.sectionSelect.innerHTML = sfState.sections.length
    ? `<option value="">Select an advisory class</option>${sfState.sections.map(section => `<option value="${escapeHtml(section.id)}">${escapeHtml(`${section.grade} - ${section.name}`)}</option>`).join('')}`
    : '<option value="">No advisory classes</option>';

  sfElements.sectionSelect.disabled = !activeTemplates.length || !sfState.sections.length;
  sfElements.schoolYear.value = sfState.sections[0]?.academicYear
    || window.EDUGNAY_CONFIG.getActiveSchool()?.schoolYear
    || '';
  updateMonthField();
  updateGenerateButton();
}

function selectedTemplates() {
  const selectedIds = Array.from(sfElements.templateList.querySelectorAll('input[type="checkbox"]:checked'))
    .map(input => input.value);
  return sfState.templates.filter(template => selectedIds.includes(template.id));
}

function hasBlankCombinedSelection() {
  return selectedTemplates().map(template => template.formCode).sort().join(',') === 'SF1,SF2';
}

function updateTemplatePicker() {
  const templates = selectedTemplates();
  sfElements.templateSummary.textContent = !templates.length ? 'Select templates'
    : templates.length <= 2 ? `${templates.map(template => template.formCode).join(', ')} selected`
      : `${templates.length} templates selected`;
  sfElements.templateClear.disabled = !templates.length;
}

function closeTemplatePicker() {
  sfElements.templateDropdown.hidden = true;
  sfElements.templateTrigger.setAttribute('aria-expanded', 'false');
}

function filterTemplateChoices() {
  const query = sfElements.templateSearch.value.trim().toLowerCase();
  let visible = 0;
  sfElements.templateList.querySelectorAll('.sf-template-choice').forEach(choice => {
    choice.hidden = !choice.textContent.toLowerCase().includes(query);
    if (!choice.hidden) visible += 1;
  });
  sfElements.templateNoResults.hidden = visible > 0;
}

function updateMonthField() {
  const isSf2 = selectedTemplates().some(template => template.formCode === 'SF2');
  sfElements.monthField.hidden = !isSf2;
  sfElements.month.disabled = !isSf2;
  if (!isSf2) return;
  const section = sfState.sections.find(record => record.id === sfElements.sectionSelect.value);
  const year = String(section?.academicYear || sfElements.schoolYear.value).match(/^(\d{4})-(\d{4})$/);
  sfElements.month.min = section?.academicYearStartDate?.slice(0, 7) || (year ? `${year[1]}-01` : '');
  sfElements.month.max = section?.academicYearEndDate?.slice(0, 7) || (year ? `${year[2]}-12` : '');
  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  if (!sfElements.month.value || (sfElements.month.min && sfElements.month.value < sfElements.month.min)
    || (sfElements.month.max && sfElements.month.value > sfElements.month.max)) {
    sfElements.month.value = currentMonth >= sfElements.month.min && currentMonth <= sfElements.month.max
      ? currentMonth : sfElements.month.min;
  }
}

function setGenerationInputsBusy(isBusy) {
  sfState.generationInProgress = isBusy;
  if (isBusy) closeTemplatePicker();
  const templateInputs = sfElements.templateList.querySelectorAll('input[type="checkbox"]');
  templateInputs.forEach(input => { input.disabled = isBusy; });
  sfElements.templateTrigger.disabled = isBusy || !templateInputs.length;
  sfElements.templateSearch.disabled = isBusy || !templateInputs.length;
  sfElements.templateClear.disabled = isBusy || !selectedTemplates().length;
  sfElements.templateDone.disabled = isBusy;
  sfElements.blankCombinedDownloadButton.disabled = isBusy || sfState.blankDownloadInProgress;
  sfElements.sectionSelect.disabled = isBusy || !templateInputs.length || !sfState.sections.length;
  sfElements.month.disabled = isBusy || sfElements.monthField.hidden;
}

function updateGenerateButton() {
  const templates = selectedTemplates();
  const validSelection = templates.length === 1 || (
    templates.length === 2 && templates.map(template => template.formCode).sort().join(',') === 'SF1,SF2'
  );
  sfElements.generateButton.disabled = !(
    validSelection &&
    (window.EDUGNAY_API?.isBackendAvailable || (templates.length === 1 && templates[0].formCode === 'SF1')) &&
    sfElements.sectionSelect.value &&
    sfElements.schoolYear.value &&
    (sfElements.monthField.hidden || sfElements.month.value)
  );
  sfElements.blankCombinedDownloadButton.hidden = !hasBlankCombinedSelection();
  sfElements.blankCombinedDownloadButton.disabled = sfState.generationInProgress || sfState.blankDownloadInProgress;
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
  const edits = Array.from(values, ([cellAddress, value]) => ({ cellAddress, value }))
    .filter(edit => sfState.generated?.baseCellTexts?.[edit.cellAddress] !== edit.value);
  if (sfState.generated) {
    if (JSON.stringify(edits) !== JSON.stringify(sfState.generated.edits || [])) sfState.generated.exportId = null;
    sfState.generated.edits = edits;
  }
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
  sfState.combined = null;
  sfState.editing = false;
  sfState.zoomMode = 'fit';
  sfElements.previewTitle.textContent = `${template.formCode} template preview`;
  sfElements.previewSubtitle.textContent = template.mappingStatus === 'ready'
    ? 'This template passed its workbook and mapping checks.'
    : 'Preview available. Generation requires a verified mapping for this form, level, and version.';
  sfElements.previewContent.innerHTML = '<div class="sf-preview-loading">Opening workbook...</div>';
  sfElements.editButton.disabled = true;
  sfElements.downloadButton.disabled = true;
  sfElements.downloadButton.innerHTML = '<i data-lucide="download"></i> Download XLSX';

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

function setGeneratedForm(form) {
  form.selectedPage = 0;
  form.baseCellTexts = Object.fromEntries(
    form.preview.rows.flatMap(row => row.cells
      .filter(cell => cell.editable)
      .map(cell => [cell.address, cell.text]))
  );
}

function invalidateGeneratedPreview() {
  const hadGeneratedPreview = Boolean(sfState.generated || sfState.combined);
  sfState.generated = null;
  sfState.combined = null;
  sfState.editing = false;
  sfElements.editButton.disabled = true;
  sfElements.downloadButton.disabled = true;
  sfElements.downloadButton.innerHTML = '<i data-lucide="download"></i> Download XLSX';
  if (!hadGeneratedPreview) return;
  sfState.preview = null;
  sfState.selectedTemplate = null;
  sfElements.previewTitle.textContent = 'Workbook preview';
  sfElements.previewSubtitle.textContent = 'Generate a preview for the current templates and advisory class.';
  sfElements.previewContent.innerHTML = `
    <div class="sf-preview-empty">
      <div class="sf-preview-empty-icon"><i data-lucide="sheet"></i></div>
      <strong>No current preview</strong>
      <span>Generate a new preview after changing the selected forms or class.</span>
    </div>`;
  if (window.lucide) lucide.createIcons();
}

function renderGeneratedPreview() {
  const form = sfState.generated;
  if (!form) return;
  const forms = sfState.combined?.forms || [];
  const formTabs = forms.length > 1
    ? `<div class="sf-generated-form-tabs" role="tablist" aria-label="Generated forms">${forms.map((item, index) => `
      <button class="sf-sheet-tab ${item === form ? 'active' : ''}" type="button" role="tab"
        aria-selected="${item === form}" data-combined-form-index="${index}">${escapeHtml(item.formCode)}</button>
    `).join('')}</div>` : '';
  const pageTabs = form.formCode === 'SF2' && form.pages.length > 1
    ? `<div class="sf-main-sheet-tabs" role="tablist" aria-label="SF2 pages">${form.pages.map((_, index) => `
      <button class="sf-sheet-tab ${index === form.selectedPage ? 'active' : ''}" type="button" role="tab"
        aria-selected="${index === form.selectedPage}" data-sf2-page="${index}">Page ${index + 1}</button>
    `).join('')}</div>` : '';
  const issues = forms.length > 1
    ? forms.flatMap(item => item.issues.map(issue => ({ ...issue, message: `${item.formCode}: ${issue.message}` })))
    : form.issues;
  sfState.preview = form.preview;
  sfElements.previewContent.innerHTML = `${renderIssueSummary(issues)}${formTabs}${pageTabs}<div class="sf-workbook-frame" id="sfMainWorkbook"></div>`;
  renderWorkbook(document.getElementById('sfMainWorkbook'), form.preview);
  sfElements.editButton.textContent = 'Edit generated form';
  sfElements.editButton.disabled = form.formCode === 'SF2' || form.hasBlockingIssues || !form.editableCells?.length;
  sfElements.downloadButton.innerHTML = `<i data-lucide="download"></i> ${forms.length > 1 ? 'Download combined XLSX' : 'Download XLSX'}`;
  sfElements.downloadButton.disabled = sfState.combined
    ? sfState.combined.hasBlockingIssues
    : Boolean(form.hasBlockingIssues);
  if (window.lucide) lucide.createIcons();
}

async function generateForm(event) {
  event.preventDefault();
  const templates = selectedTemplates();
  invalidateGeneratedPreview();
  sfState.generationInProgress = true;
  sfElements.generateButton.disabled = true;
  sfElements.generateButton.textContent = 'Preparing preview...';
  setGenerationInputsBusy(true);
  try {
    const values = {
      sectionId: sfElements.sectionSelect.value,
      schoolYear: sfElements.schoolYear.value,
      month: sfElements.month.value
    };
    if (templates.length > 1) {
      sfState.combined = await window.EDUGNAY_CONFIG.generateCombinedSfForms({
        ...values,
        templateIds: templates.map(template => template.id)
      });
      sfState.combined.forms.forEach(setGeneratedForm);
      sfState.combined.hasBlockingIssues = sfState.combined.forms.some(form => form.hasBlockingIssues);
      sfState.combined.selectedFormIndex = 0;
      sfState.generated = sfState.combined.forms[0];
    } else {
      sfState.generated = await window.EDUGNAY_CONFIG.generateSfForm({
        ...values,
        templateId: templates[0].id
      });
      sfState.generated.formCode = templates[0].formCode;
      setGeneratedForm(sfState.generated);
    }
    sfState.selectedTemplate = sfState.templates.find(template => template.id === sfState.generated.templateId) || null;
    sfState.editing = false;
    sfState.zoomMode = 'fit';
    sfElements.previewTitle.textContent = 'Generated form preview';
    sfElements.previewSubtitle.textContent = window.EDUGNAY_API?.isBackendAvailable
      ? 'Review the selected form previews before downloading the XLSX file.'
      : 'Demo preview uses sample records stored in this browser.';
    renderGeneratedPreview();
  } catch (error) {
    sfState.generated = null;
    sfState.combined = null;
    showAppToast(error.message, 'error');
  } finally {
    sfElements.generateButton.textContent = 'Preview with school data';
    setGenerationInputsBusy(false);
    updateGenerateButton();
  }
}

async function downloadBlankCombinedWorkbook() {
  if (!hasBlankCombinedSelection() || sfState.blankDownloadInProgress || sfState.generationInProgress) return;

  sfState.blankDownloadInProgress = true;
  sfElements.blankCombinedDownloadButton.disabled = true;
  sfElements.blankCombinedDownloadButton.setAttribute('aria-busy', 'true');
  sfElements.blankCombinedDownloadButton.innerHTML = 'Preparing blank workbook...';
  try {
    const result = await window.EDUGNAY_CONFIG.downloadBlankCombinedSfTemplates(
      selectedTemplates().map(template => template.id)
    );
    startXlsxDownload(result.buffer, result.fileName);
    showAppToast('Blank SF1 and SF2 workbook download started.');
  } catch (error) {
    showAppToast(error.message || 'The blank combined workbook could not be downloaded.', 'error');
  } finally {
    sfState.blankDownloadInProgress = false;
    sfElements.blankCombinedDownloadButton.innerHTML = '<i data-lucide="download" aria-hidden="true"></i> Download blank combined XLSX';
    sfElements.blankCombinedDownloadButton.removeAttribute('aria-busy');
    updateGenerateButton();
    if (window.lucide) lucide.createIcons();
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
  showAppToast('Generated form edits saved in this browser.', 'info');
}

async function downloadGeneratedWorkbook() {
  if (!sfState.generated || (sfState.combined ? sfState.combined.hasBlockingIssues : sfState.generated.hasBlockingIssues)) return;
  if (sfState.editing) {
    preservePreviewEdits();
    sfState.editing = false;
    sfElements.editButton.textContent = 'Edit generated form';
    renderWorkbook(document.getElementById('sfMainWorkbook'), sfState.generated.preview);
  }

  sfElements.downloadButton.disabled = true;
  sfElements.downloadButton.textContent = 'Preparing XLSX...';
  try {
    const result = sfState.combined
      ? await window.EDUGNAY_CONFIG.exportCombinedSfForms({
        templateIds: sfState.combined.templateIds,
        sectionId: sfState.combined.sectionId,
        month: sfState.combined.month,
        fileName: sfState.combined.fileName,
        previewFingerprint: sfState.combined.previewFingerprint,
        forms: sfState.combined.forms
      })
      : await window.EDUGNAY_CONFIG.exportSfForm({
        templateId: sfState.generated.templateId,
        sectionId: sfState.generated.sectionId,
        month: sfState.generated.month,
        fileName: sfState.generated.fileName,
        mappedCells: sfState.generated.mappedCells,
        edits: sfState.generated.edits,
        previewFingerprint: sfState.generated.previewFingerprint,
        exportId: sfState.generated.exportId
      });
    if (sfState.generated) sfState.generated.exportId = result.exportId || null;
    startXlsxDownload(result.buffer, result.fileName);
    showAppToast(sfState.combined ? 'Combined SF1 and SF2 workbook download started.' : 'Workbook download started.');
  } catch (error) {
    if (sfState.generated && error.exportId) sfState.generated.exportId = error.exportId;
    if (error.status === 409) {
      sfState.generated = null;
      sfState.combined = null;
      sfState.preview = null;
      sfState.editing = false;
      sfElements.editButton.disabled = true;
      sfElements.previewSubtitle.textContent = 'The system records changed. Generate a new preview before downloading.';
      sfElements.previewContent.innerHTML = '<div class="sf-preview-error">The records changed since this preview. Generate a new preview to continue.</div>';
    }
    showAppToast(error.message, 'error');
  } finally {
    sfElements.downloadButton.innerHTML = `<i data-lucide="download"></i> ${sfState.combined ? 'Download combined XLSX' : 'Download XLSX'}`;
    sfElements.downloadButton.disabled = !sfState.generated || (sfState.combined
      ? sfState.combined.hasBlockingIssues
      : Boolean(sfState.generated.hasBlockingIssues));
    if (window.lucide) lucide.createIcons();
  }
}

function startXlsxDownload(buffer, fileName) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

async function downloadBlankTemplate(templateId, button) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    const result = await window.EDUGNAY_CONFIG.downloadSfTemplate(templateId);
    startXlsxDownload(result.buffer, result.fileName);
    const template = sfState.templates.find(record => record.id === String(templateId));
    showAppToast(`${template?.formCode || 'SF'} blank template download started.`);
  } catch (error) {
    showAppToast(error.message || 'The blank template could not be downloaded.', 'error');
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

async function initializeSfTemplatesPage() {
  if (!window.EDUGNAY_API?.isBackendAvailable) {
    document.querySelector('.sf-info-banner-title').textContent = 'Demo preview';
    document.querySelector('.sf-info-banner-text').textContent = 'This static-host preview uses sample records in your browser, not live MySQL data.';
  }
  sfElements.count.textContent = 'Loading templates...';
  sfElements.list.innerHTML = '<div class="sf-preview-loading" role="status">Loading official templates...</div>';

  try {
    [sfState.templates, sfState.sections] = await Promise.all([
      window.EDUGNAY_CONFIG.getSfTemplates(),
      window.EDUGNAY_CONFIG.getMyAdvisorySections()
    ]);
    renderTemplateLibrary();
    renderGenerationOptions();
  } catch (error) {
    sfState.templates = [];
    sfState.sections = [];
    sfElements.count.textContent = 'Templates unavailable';
    sfElements.list.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
      icon: error.status === 403 ? 'shield-off' : 'cloud-off',
      title: error.status === 403 ? 'SF Templates unavailable' : 'Templates could not be loaded',
      text: error.message || 'Sign in again or try again later.'
    });
    renderGenerationOptions();
  } finally {
    if (window.lucide) lucide.createIcons();
  }
}

sfElements.generatorForm.addEventListener('submit', generateForm);
sfElements.templateList.addEventListener('change', event => {
  if (!event.target.matches('input[type="checkbox"]')) return;
  sfState.selectedTemplateIds = selectedTemplates().map(template => template.id);
  updateTemplatePicker();
  invalidateGeneratedPreview();
  updateMonthField();
  updateGenerateButton();
});
sfElements.templateTrigger.addEventListener('click', () => {
  if (!sfElements.templateDropdown.hidden) {
    closeTemplatePicker();
    return;
  }
  sfElements.templateSearch.value = '';
  filterTemplateChoices();
  sfElements.templateDropdown.hidden = false;
  sfElements.templateTrigger.setAttribute('aria-expanded', 'true');
  sfElements.templateSearch.focus();
});
sfElements.templateSearch.addEventListener('input', filterTemplateChoices);
sfElements.templateSearch.addEventListener('keydown', event => {
  if (event.key === 'Enter') event.preventDefault();
});
sfElements.templateClear.addEventListener('click', () => {
  sfElements.templateList.querySelectorAll('input[type="checkbox"]:checked').forEach(input => { input.checked = false; });
  sfState.selectedTemplateIds = [];
  updateTemplatePicker();
  invalidateGeneratedPreview();
  updateMonthField();
  updateGenerateButton();
});
sfElements.templateDone.addEventListener('click', () => {
  closeTemplatePicker();
  sfElements.templateTrigger.focus();
});
document.addEventListener('click', event => {
  if (!sfElements.templatePicker.contains(event.target)) closeTemplatePicker();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !sfElements.templateDropdown.hidden) {
    closeTemplatePicker();
    sfElements.templateTrigger.focus();
  }
});
[sfElements.sectionSelect, sfElements.schoolYear, sfElements.month].forEach(select => select.addEventListener('change', () => {
  if (select === sfElements.sectionSelect) {
    const section = sfState.sections.find(record => record.id === sfElements.sectionSelect.value);
    sfElements.schoolYear.value = section?.academicYear || '';
  }
  updateMonthField();
  invalidateGeneratedPreview();
  updateGenerateButton();
}));
[sfElements.codeFilter, sfElements.levelFilter]
  .forEach(select => select.addEventListener('change', renderTemplateLibrary));
sfElements.editButton.addEventListener('click', toggleGeneratedEditing);
sfElements.downloadButton.addEventListener('click', downloadGeneratedWorkbook);
sfElements.blankCombinedDownloadButton.addEventListener('click', downloadBlankCombinedWorkbook);

sfElements.previewContent.addEventListener('click', event => {
  const formTab = event.target.closest('[data-combined-form-index]');
  if (formTab && sfState.combined) {
    if (sfState.editing) {
      preservePreviewEdits();
      sfState.editing = false;
    }
    const formIndex = Number(formTab.dataset.combinedFormIndex);
    const form = sfState.combined.forms[formIndex];
    if (!form) return;
    sfState.combined.selectedFormIndex = formIndex;
    sfState.generated = form;
    sfState.selectedTemplate = sfState.templates.find(template => template.id === form.templateId) || null;
    renderGeneratedPreview();
    return;
  }
  const pageButton = event.target.closest('[data-sf2-page]');
  if (pageButton && sfState.generated?.pages) {
    const generated = sfState.generated;
    const pageIndex = Number(pageButton.dataset.sf2Page);
    sfState.generated.selectedPage = pageIndex;
    window.EDUGNAY_SF_WORKBOOK.generatePreviewFromMappedCells(sfState.selectedTemplate, sfState.generated.pages[pageIndex], [])
      .then(result => {
        if (sfState.generated !== generated || generated.selectedPage !== pageIndex) return;
        generated.preview = result.preview;
        sfState.preview = result.preview;
        sfElements.previewContent.querySelectorAll('[data-sf2-page]').forEach(button => button.classList.toggle('active', Number(button.dataset.sf2Page) === pageIndex));
        renderWorkbook(document.getElementById('sfMainWorkbook'), result.preview);
      }).catch(error => showAppToast(error.message, 'error'));
    return;
  }
  const zoomButton = event.target.closest('[data-preview-zoom]');
  if (zoomButton) {
    changePreviewZoom(zoomButton.dataset.previewZoom);
    return;
  }
  const tab = event.target.closest('[data-sheet-name]');
  if (tab && sfState.selectedTemplate) openTemplatePreview(sfState.selectedTemplate.id, tab.dataset.sheetName);
});

sfElements.list.addEventListener('click', event => {
  const downloadButton = event.target.closest('[data-template-download]');
  if (downloadButton) {
    downloadBlankTemplate(downloadButton.dataset.templateDownload, downloadButton);
    return;
  }
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
