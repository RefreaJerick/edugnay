lucide.createIcons();

    let MATERIAL_RECORDS = [];
    const MATERIAL_PERIODS = [];
    const MATERIALS_BY_SUBJECT = {};
    let currentSubject = '';
    let previewRequest = 0;
    let previewObjectUrl = null;
    let previewMaterial = null;
    let previewReturnFocus = null;

    function groupMaterials() {
      Object.keys(MATERIALS_BY_SUBJECT).forEach(key => delete MATERIALS_BY_SUBJECT[key]);
      MATERIAL_RECORDS.forEach(material => {
        const isElective = material.scopeType === 'elective' || material.electiveClassId != null;
        const subjectKey = isElective ? `elective:${material.electiveClassId}` : `subject:${material.subjectId}`;
        if (!MATERIALS_BY_SUBJECT[subjectKey]) {
          MATERIALS_BY_SUBJECT[subjectKey] = {
            label: isElective
              ? `${material.subjectName || 'Elective'} · ${material.className || 'Elective class'}`
              : material.subjectName || 'Subject',
            teacher: material.teacherName || 'Subject teacher',
            elective: isElective,
            items: []
          };
        }
        MATERIALS_BY_SUBJECT[subjectKey].items.push(material);
      });
      currentSubject = Object.keys(MATERIALS_BY_SUBJECT)[0] || '';
    }

    const TYPE_META = {
      pdf: { icon: 'file-text', bg: 'var(--red-pale)', color: 'var(--red)', label: 'PDF' },
      pptx: { icon: 'presentation', bg: 'var(--gold-pale)', color: '#92400e', label: 'Slides' },
      video: { icon: 'video', bg: 'var(--green-pale)', color: '#16a34a', label: 'Video' },
      docx: { icon: 'file-text', bg: 'var(--blue-xpale)', color: 'var(--blue-mid)', label: 'Document' },
      doc: { icon: 'file-text', bg: 'var(--blue-xpale)', color: 'var(--blue-mid)', label: 'Document' },
      ppt: { icon: 'presentation', bg: 'var(--gold-pale)', color: '#92400e', label: 'Slides' },
      xls: { icon: 'table', bg: 'var(--green-pale)', color: 'var(--green)', label: 'Spreadsheet' },
      xlsx: { icon: 'table', bg: 'var(--green-pale)', color: 'var(--green)', label: 'Spreadsheet' },
      jpg: { icon: 'image', bg: 'var(--gold-pale)', color: 'var(--gold-dark)', label: 'Image' },
      png: { icon: 'image', bg: 'var(--gold-pale)', color: 'var(--gold-dark)', label: 'Image' },
      mp4: { icon: 'video', bg: 'var(--green-pale)', color: 'var(--green)', label: 'Video' },
    };

    const PERIOD_LABELS = Object.fromEntries(MATERIAL_PERIODS.map(period => [period.id, period.name]));

    function formatMaterialDate(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? 'Date unavailable'
        : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    function renderSubjectTabs() {
      const tabs = document.getElementById('subject-tabs');
      if (!tabs) return;
      tabs.innerHTML = Object.entries(MATERIALS_BY_SUBJECT).map(([subjectId, data]) => `
        <button class="subject-tab${subjectId === currentSubject ? ' active' : ''}" data-subject="${window.EDUGNAY_CONFIG.escapeHtml(subjectId)}">
          ${window.EDUGNAY_CONFIG.escapeHtml(data.label)}
          <span class="tab-count">${data.items.length}</span>
        </button>`).join('');
      tabs.querySelectorAll('.subject-tab').forEach(tab => {
        tab.addEventListener('click', () => switchSubject(tab.dataset.subject, tab));
      });
      const firstTab = tabs.querySelector('.subject-tab');
      if (firstTab) switchSubject(currentSubject, firstTab);
      else renderMaterials();
    }

    function switchSubject(subjectKey, btn) {
      currentSubject = subjectKey;
      document.querySelectorAll('.subject-tab').forEach(t => t.classList.remove('active'));
      btn?.classList.add('active');

      const data = MATERIALS_BY_SUBJECT[subjectKey];
      if (!data) return;
      document.getElementById('panel-title').textContent = `${data.label} Materials`;
      document.getElementById('panel-sub').textContent = `${data.teacher} · ${data.items.length} files`;

      document.getElementById('search-input').value = '';
      document.getElementById('type-filter').value = 'all';
      renderMaterials();
    }

    function renderMaterials() {
      const data = MATERIALS_BY_SUBJECT[currentSubject];
      const container = document.getElementById('materials-container');
      if (!data) {
        container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
          icon: 'folder-open',
          title: 'No learning materials yet',
          text: 'Materials shared by your teachers will appear here.'
        });
        return;
      }
      const query = document.getElementById('search-input').value.toLowerCase();
      const typeFilter = document.getElementById('type-filter').value;

      const filtered = data.items.filter(m => {
        if (query && !m.title.toLowerCase().includes(query)) return false;
        if (typeFilter !== 'all' && m.type !== typeFilter && !(typeFilter === 'video' && m.type === 'mp4')) return false;
        return true;
      });

      if (filtered.length === 0) {
        container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
          icon: 'folder-open',
          title: 'No materials found',
          text: 'Try adjusting your search or filter.'
        });
        if (window.lucide) lucide.createIcons();
        return;
      }

      // Group by academic period for the existing list layout.
      const periodGroups = [];
      const grouped = {};
      filtered.forEach(m => {
        const period = m.academicTermName || PERIOD_LABELS[m.academicPeriodId] ||
          (m.scopeType === 'elective' || m.electiveClassId != null ? 'Elective class materials' : 'Academic Period');
        if (!grouped[period]) { grouped[period] = []; periodGroups.push(period); }
        grouped[period].push(m);
      });

      container.innerHTML = periodGroups.map(period => `
    <div class="week-group-label">${window.EDUGNAY_CONFIG.escapeHtml(period)}</div>
    ${grouped[period].map(m => {
        const meta = TYPE_META[m.type] || TYPE_META.pdf;
        return `
        <div class="material-row">
          <div class="material-icon" style="background:${meta.bg};">
            <i data-lucide="${meta.icon}" style="width:19px;height:19px;color:${meta.color};"></i>
          </div>
          <div class="material-info">
            <div class="material-title">${window.EDUGNAY_CONFIG.escapeHtml(m.title)}</div>
            <div class="material-meta">
              <span class="badge badge-blue">${meta.label}</span>
              <span class="material-meta-dot"></span>
              <span>Posted ${window.EDUGNAY_CONFIG.escapeHtml(formatMaterialDate(m.postedAt))}</span>
            </div>
          </div>
          <div class="material-actions">
            ${['pdf', 'jpg', 'png', 'mp4'].includes(m.type) ? `<button class="material-action" type="button" data-material-action="preview" data-material-id="${window.EDUGNAY_CONFIG.escapeHtml(m.id)}" aria-label="Preview ${window.EDUGNAY_CONFIG.escapeHtml(m.title)}"><i data-lucide="eye"></i><span class="material-action-label">Preview</span></button>` : ''}
            <button class="material-action" type="button" data-material-action="download" data-material-id="${window.EDUGNAY_CONFIG.escapeHtml(m.id)}" aria-label="Download ${window.EDUGNAY_CONFIG.escapeHtml(m.title)}"><i data-lucide="download"></i><span class="material-action-label">Download</span></button>
          </div>
        </div>`;
      }).join('')}
  `).join('');

      lucide.createIcons();
    }

    async function downloadMaterial(material, button) {
      const label = button.innerHTML;
      button.disabled = true;
      button.textContent = 'Preparing...';
      try {
        const file = await window.EDUGNAY_API.getMaterialFile(material.id, true);
        const url = URL.createObjectURL(new Blob([file.buffer], { type: file.contentType || 'application/octet-stream' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = material.originalFileName || `material.${material.type}`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } catch (error) {
        showAppToast(error.message || 'The material could not be downloaded.', 'error');
      } finally {
        button.innerHTML = label;
        button.disabled = false;
      }
    }

    function clearMaterialPreview() {
      const content = document.getElementById('materialPreviewContent');
      const video = content.querySelector('video');
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      content.replaceChildren();
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }

    function closeMaterialPreview() {
      previewRequest += 1;
      document.getElementById('materialPreviewModal').hidden = true;
      document.body.classList.remove('material-preview-open');
      clearMaterialPreview();
      previewMaterial = null;
      previewReturnFocus?.focus();
      previewReturnFocus = null;
    }

    async function openMaterialPreview(material) {
      const request = ++previewRequest;
      previewMaterial = material;
      previewReturnFocus = document.activeElement;
      clearMaterialPreview();
      const modal = document.getElementById('materialPreviewModal');
      const message = document.getElementById('materialPreviewMessage');
      const content = document.getElementById('materialPreviewContent');
      document.getElementById('materialPreviewTitle').textContent = material.title;
      document.getElementById('materialPreviewType').textContent = (TYPE_META[material.type]?.label || 'Material') + ' preview';
      content.innerHTML = '';
      message.textContent = '';
      message.hidden = true;
      modal.hidden = false;
      document.body.classList.add('material-preview-open');
      document.getElementById('materialPreviewClose').focus();

      if (material.type === 'mp4') {
        const video = document.createElement('video');
        video.controls = true;
        video.preload = 'metadata';
        video.crossOrigin = 'use-credentials';
        video.addEventListener('loadedmetadata', () => { if (request === previewRequest) message.hidden = true; });
        video.addEventListener('error', () => { if (request === previewRequest) { message.textContent = 'The video could not be loaded. Try Download.'; message.hidden = false; } });
        video.src = window.EDUGNAY_API.materialFileUrl(material.id);
        content.replaceChildren(video);
        return;
      }

      try {
        const file = await window.EDUGNAY_API.getMaterialFile(material.id);
        if (request !== previewRequest) return;
        previewObjectUrl = URL.createObjectURL(new Blob([file.buffer], { type: file.contentType }));
        const viewer = document.createElement(material.type === 'pdf' ? 'iframe' : 'img');
        if (viewer.tagName === 'IFRAME') viewer.title = `${material.title} preview`;
        else viewer.alt = '';
        viewer.addEventListener('load', () => { if (request === previewRequest) message.hidden = true; });
        viewer.addEventListener('error', () => { if (request === previewRequest) message.textContent = 'The preview could not be displayed. Try Download.'; });
        viewer.src = previewObjectUrl;
        content.replaceChildren(viewer);
      } catch (error) {
        if (request === previewRequest) {
          content.replaceChildren();
          message.textContent = error.message || 'The preview could not be loaded. Try Download.';
          message.hidden = false;
        }
      }
    }

    document.addEventListener('DOMContentLoaded', async () => {
      document.getElementById('materials-container').innerHTML = '';
      try {
        if (!window.EDUGNAY_API?.isBackendAvailable) throw new Error('The school API is unavailable. Try again when the connection is ready.');
        await window.EDUGNAY_SCHOOL_READY;
        MATERIAL_RECORDS = await window.EDUGNAY_API.getMaterials();
      } catch (error) {
        document.getElementById('materials-container').innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
          icon: 'cloud-off', title: 'Materials unavailable', text: error.message || 'Try again when the connection is ready.'
        });
        window.EDUGNAY_PAGE_LOADING.ready();
        return;
      }
      groupMaterials();
      renderSubjectTabs();
      window.EDUGNAY_PAGE_LOADING.ready();
    });

    document.getElementById('materials-container').addEventListener('click', event => {
      const button = event.target.closest('[data-material-action]');
      if (!button) return;
      const material = MATERIAL_RECORDS.find(item => String(item.id) === button.dataset.materialId);
      if (!material) return;
      if (button.dataset.materialAction === 'preview') openMaterialPreview(material);
      else downloadMaterial(material, button);
    });

    document.getElementById('materialPreviewClose').addEventListener('click', closeMaterialPreview);
    document.getElementById('materialPreviewDone').addEventListener('click', closeMaterialPreview);
    document.getElementById('materialPreviewDownload').addEventListener('click', event => {
      if (previewMaterial) downloadMaterial(previewMaterial, event.currentTarget);
    });
    document.getElementById('materialPreviewModal').addEventListener('click', event => {
      if (event.target === event.currentTarget) closeMaterialPreview();
    });
    document.addEventListener('keydown', event => {
      if (document.getElementById('materialPreviewModal').hidden) return;
      if (event.key === 'Escape') closeMaterialPreview();
      if (event.key === 'Tab') {
        const buttons = [...document.querySelectorAll('#materialPreviewModal button:not(:disabled)')];
        if (event.shiftKey && document.activeElement === buttons[0]) {
          event.preventDefault();
          buttons.at(-1).focus();
        } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
          event.preventDefault();
          buttons[0].focus();
        }
      }
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    pab42e7bf23eb: function(event) { renderMaterials() },
  },
  input: {
    pf62517927d57: function(event) { renderMaterials() },
  },
});
