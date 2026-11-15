lucide.createIcons();

    let MATERIAL_RECORDS = [];
    const MATERIAL_PERIODS = [];
    const MATERIALS_BY_SUBJECT = {};
    let currentSubject = '';

    function groupMaterials() {
      Object.keys(MATERIALS_BY_SUBJECT).forEach(key => delete MATERIALS_BY_SUBJECT[key]);
      MATERIAL_RECORDS.forEach(material => {
        const isElective = material.scopeType === 'elective' || material.electiveClassId != null;
        const subjectKey = isElective ? `elective:${material.electiveClassId}`
          : `subject:${material.subjectId}:${material.communicationComponentCode || ''}`;
        if (!MATERIALS_BY_SUBJECT[subjectKey]) {
          MATERIALS_BY_SUBJECT[subjectKey] = {
            label: isElective
              ? `${material.subjectName || 'Elective'} · ${material.className || 'Elective class'}`
              : material.communicationComponentName || material.subjectName || 'Subject',
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
        const communicationLabel = m.communicationComponentName || '';
        return `
        <div class="material-row">
          <div class="material-icon" style="background:${meta.bg};">
            <i data-lucide="${meta.icon}" style="width:19px;height:19px;color:${meta.color};"></i>
          </div>
          <div class="material-info">
            <div class="material-title">${window.EDUGNAY_CONFIG.escapeHtml(m.title)}</div>
            <div class="material-meta">
              <span>${meta.label}</span>
              <span class="material-meta-dot"></span>
              <span>Posted ${window.EDUGNAY_CONFIG.escapeHtml(formatMaterialDate(m.postedAt))}</span>
              ${communicationLabel ? `<span class="material-meta-dot"></span><span>${window.EDUGNAY_CONFIG.escapeHtml(communicationLabel)}</span>` : ''}
            </div>
          </div>
          <div class="material-actions">
            ${['pdf', 'jpg', 'png', 'mp4'].includes(m.type) ? `<a class="material-action" href="${window.EDUGNAY_CONFIG.escapeHtml(window.EDUGNAY_API.materialFileUrl(m.id))}" target="_blank" rel="noopener" aria-label="Preview ${window.EDUGNAY_CONFIG.escapeHtml(m.title)}"><i data-lucide="eye"></i><span class="material-action-label">Preview</span></a>` : ''}
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

    document.addEventListener('DOMContentLoaded', async () => {
      document.getElementById('materials-container').innerHTML = '';
      try {
        if (!window.EDUGNAY_API?.isBackendAvailable) throw new Error('Learning materials aren’t available right now. Refresh and try again.');
        await window.EDUGNAY_SCHOOL_READY;
        MATERIAL_RECORDS = await window.EDUGNAY_API.getMaterials();
      } catch (error) {
        document.getElementById('materials-container').innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
          icon: 'cloud-off', title: 'Materials unavailable', text: error.message || 'Refresh the page and try again.'
        });
        window.EDUGNAY_PAGE_LOADING.ready();
        return;
      }
      groupMaterials();
      renderSubjectTabs();
      window.EDUGNAY_PAGE_LOADING.ready();
    });

    document.getElementById('materials-container').addEventListener('click', event => {
      const button = event.target.closest('[data-material-action="download"]');
      if (!button) return;
      const material = MATERIAL_RECORDS.find(item => String(item.id) === button.dataset.materialId);
      if (!material) return;
      downloadMaterial(material, button);
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    pab42e7bf23eb: function(event) { renderMaterials() },
  },
  input: {
    pf62517927d57: function(event) { renderMaterials() },
  },
});
