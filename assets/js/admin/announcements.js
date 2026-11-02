let ACTIVE_ANNOUNCEMENT_ID = null;
  let announcementSaving = false;

  function setAnnouncementFeedback(message = '') {
    const feedback = document.getElementById('announcementFormFeedback');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.hidden = !message;
    feedback.classList.toggle('is-error', Boolean(message));
  }

  function openModal(announcementId = null) {
    ACTIVE_ANNOUNCEMENT_ID = announcementId ? String(announcementId) : null;
    document.getElementById('editAnnouncementFeedback').hidden = true;
    const announcement = ANNOUNCEMENTS.find(item => String(item.id) === ACTIVE_ANNOUNCEMENT_ID);
    const form = document.getElementById('editAnnouncementForm');
    if (announcement && form) {
      form.reset();
      form.dataset.existingImage = announcement.imageUrl ? 'true' : 'false';
      form.dataset.removeImage = 'false';
      form.elements.title.value = announcement.title || '';
      form.elements.content.value = announcement.body || '';
      form.elements.priority.value = announcement.priority === 'low' ? 'normal' : (announcement.priority || 'normal');
      form.elements.audience.value = announcement.audienceKeys?.[0] || 'all';
      form.elements.status.querySelector('option[value="draft"]').disabled = announcement.status === 'published';
      form.elements.status.querySelector('option[value="scheduled"]').disabled = announcement.status === 'published';
      form.elements.status.value = announcement.status || 'draft';
      form.elements.schedule.disabled = announcement.status !== 'scheduled';
      form.elements.schedule.value = announcement.scheduledAt
        ? new Date(announcement.scheduledAt).toLocaleString('sv-SE', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', 'T') : '';
      const preview = document.getElementById('editPreview');
      preview.style.display = announcement.imageUrl ? 'block' : 'none';
      document.getElementById('editPlaceholder').style.display = announcement.imageUrl ? 'none' : 'flex';
      if (announcement.imageUrl) preview.querySelector('img').src = announcement.imageUrl;
    }
    document.getElementById('editModal').classList.add('open');
    lucide.createIcons();
  }
  function closeModal() { document.getElementById('editModal').classList.remove('open'); }
  document.getElementById('editModal').addEventListener('click', function(e) { if (e.target === this) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  function selectPriority(el, value) {
    document.querySelectorAll('.priority-opt').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById('priorityValue').value = value;
  }

  function getAudienceValues(form) {
    const values = Array.from(form.querySelectorAll('input[name="audience"]:checked')).map(input => input.value);
    if (values.length) return values;
    const selectedAudience = form.elements.audience?.value;
    return selectedAudience ? selectedAudience.split('-') : ['all'];
  }

  function getAnnouncementValues(form, status) {
    const formData = new FormData(form);
    const priority = String(formData.get('priority') || 'normal');
    const schedule = String(formData.get('schedule') || '');
    const effectiveStatus = form.id === 'composeAnnouncementForm' && status === 'published' && schedule ? 'scheduled' : status;
    const date = schedule ? new Date(`${schedule}:00+08:00`) : null;
    return {
      title: String(formData.get('title') || '').trim(),
      body: String(formData.get('content') || '').trim(),
      priority: priority === 'low' ? 'normal' : priority,
      audiences: getAudienceValues(form),
      status: effectiveStatus,
      scheduledAt: effectiveStatus === 'scheduled' && date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
      image: form.elements.image?.files?.[0] || null,
      removeImage: form.dataset.removeImage === 'true'
    };
  }

  function updateAnnouncementPostLabel() {
    document.querySelector('#announcementPostButton span').textContent =
      document.querySelector('#composeAnnouncementForm [name="schedule"]').value ? 'Schedule' : 'Post';
  }

  async function saveAnnouncement(form, status) {
    if (announcementSaving) return;

    const values = getAnnouncementValues(form, status);
    setAnnouncementFeedback();
    if (!values.title || !values.body) {
      setAnnouncementFeedback('Enter an announcement title and content.');
      return;
    }
    if (values.status === 'scheduled' && (!values.scheduledAt || new Date(values.scheduledAt).getTime() <= Date.now())) {
      setAnnouncementFeedback('Choose a future date and time to schedule this announcement.');
      return;
    }

    const postButton = document.getElementById('announcementPostButton');
    const draftButton = document.getElementById('announcementDraftButton');
    const buttons = [postButton, draftButton].filter(Boolean);
    const activeButton = status === 'draft' ? draftButton : postButton;
    const activeLabel = activeButton?.querySelector('span');
    const originalLabel = activeLabel?.textContent || (status === 'draft' ? 'Save Draft' : 'Post');
    announcementSaving = true;
    buttons.forEach(button => { button.disabled = true; });
    if (activeLabel) activeLabel.textContent = status === 'draft' ? 'Saving…' : values.status === 'scheduled' ? 'Scheduling…' : 'Posting…';

    try {
      await window.EDUGNAY_SCHOOL_READY;
      const announcement = await window.EDUGNAY_API.createAnnouncement(values);
      if (!announcement) throw new Error('The server did not confirm the announcement save.');
      announcementLoadError = '';
      ANNOUNCEMENTS = [announcement, ...ANNOUNCEMENTS.filter(item => String(item.id) !== String(announcement.id))];
      if (window.EDUGNAY_COMMUNICATION) window.EDUGNAY_COMMUNICATION.announcements = ANNOUNCEMENTS;

      form.reset();
      document.getElementById('composePreview').style.display = 'none';
      document.getElementById('composePlaceholder').style.display = 'flex';
      updateAnnouncementPostLabel();
      document.getElementById('priorityValue').value = 'normal';
      document.querySelectorAll('#composeAnnouncementForm .priority-opt').forEach(option => {
        option.classList.toggle('selected', option.classList.contains('p-normal'));
      });
      audienceCheckboxes.forEach(input => input.closest('.aud-opt')?.classList.toggle('checked', input.checked));
      renderAdminAnnouncements();

      const message = values.status === 'draft' ? 'Announcement saved as a draft.'
        : values.status === 'scheduled' ? 'Announcement scheduled.' : 'Announcement posted.';
      showAppToast(message, 'success');
    } catch (error) {
      showAppToast(error.message || 'The announcement could not be saved.', 'error');
    } finally {
      announcementSaving = false;
      buttons.forEach(button => { button.disabled = false; });
      if (activeLabel) activeLabel.textContent = originalLabel;
      updateAnnouncementPostLabel();
    }
  }

  function saveDraft() {
    const form = document.getElementById('composeAnnouncementForm');
    saveAnnouncement(form, 'draft').catch(error => showAppToast(error.message || 'The announcement could not be saved.', 'error'));
  }

  const audienceCheckboxes = Array.from(document.querySelectorAll('.aud-opt input[type="checkbox"]'));
  audienceCheckboxes.forEach(cb => {
    cb.addEventListener('change', function() {
      if (this.checked && this.value === 'all') {
        audienceCheckboxes
          .filter(other => other !== this)
          .forEach(other => { other.checked = false; });
      } else if (this.checked) {
        const allUsers = audienceCheckboxes.find(other => other.value === 'all');
        if (allUsers) allUsers.checked = false;
      }

      audienceCheckboxes.forEach(input => {
        input.closest('.aud-opt')?.classList.toggle('checked', input.checked);
      });
    });
  });

  let ANNOUNCEMENTS = [];
  let announcementLoadError = '';

  function renderAdminAnnouncements() {
    const list = document.getElementById('annList');
    if (!list) return;
    list.innerHTML = [...ANNOUNCEMENTS].sort((a, b) => Number(b.pinned) - Number(a.pinned)
      || new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt)).map(ann => `
      <div class="ann-card priority-${ann.priority}" data-id="${ann.id}" data-priority="${ann.priority}" data-audience="${ann.audienceKeys.join(',')}">
        ${ann.pinned ? '<div class="pinned-strip"><i data-lucide="pin" style="width:12px;height:12px;"></i> Pinned Announcement</div>' : ''}
        <div class="ann-body"><div class="ann-head"><div class="ann-head-left"><div class="ann-type-icon ${ann.iconClass}"><i data-lucide="${ann.icon}" style="width:16px;height:16px;"></i></div><div class="ann-title-wrap"><div class="ann-title">${window.EDUGNAY_CONFIG.escapeHtml(ann.title)}</div><div class="ann-meta"><span class="ann-meta-item"><i data-lucide="clock" style="width:11px;height:11px;"></i> ${ann.status === 'scheduled' ? window.EDUGNAY_CONFIG.escapeHtml(new Date(ann.scheduledAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' PHT') : window.EDUGNAY_CONFIG.escapeHtml(ann.time)}</span><span class="ann-meta-item"><i data-lucide="user" style="width:11px;height:11px;"></i> ${window.EDUGNAY_CONFIG.escapeHtml(ann.author)}</span></div></div></div><div class="ann-badges">${ann.status === 'scheduled' ? '<span class="badge badge-gold">Scheduled</span>' : ann.draft ? '<span class="badge badge-gray">Draft</span>' : '<span class="badge badge-green">Active</span>'}</div></div><div class="ann-content"${ann.draft ? ' style="color:var(--gray-400);font-style:italic;"' : ''}>${window.EDUGNAY_CONFIG.escapeHtml(ann.body)}</div>${ann.imageUrl ? `<div class="ann-image-wrap"><img class="ann-image" crossorigin="use-credentials" src="${window.EDUGNAY_CONFIG.escapeHtml(ann.imageUrl)}" alt="${window.EDUGNAY_CONFIG.escapeHtml(ann.title)}" loading="lazy" data-page-error="g7ea297b8513b"/></div>` : ''}<div class="ann-audience"><span class="aud-label">To:</span><span class="aud-tag ${ann.audienceClass}"><i data-lucide="${ann.audienceIcon}" style="width:10px;height:10px;"></i> ${window.EDUGNAY_CONFIG.escapeHtml(ann.audience)}</span></div></div>
        <div class="ann-footer"><div class="ann-footer-left"${ann.draft ? ' style="color:var(--orange);"' : ''}><i data-lucide="${ann.draft ? 'eye-off' : 'eye'}" style="width:12px;height:12px;"></i> ${ann.status === 'scheduled' ? 'Awaiting publication' : ann.seen}</div><div class="ann-footer-right">${ann.status === 'published' ? `<button class="footer-btn pin" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { setAnnouncementPin(this, (!ann.pinned)) })}"><i data-lucide="${ann.pinned ? 'pin-off' : 'pin'}" style="width:11px;height:11px;"></i> ${ann.pinned ? 'Unpin' : 'Pin'}</button>` : ''}<button class="footer-btn edit" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openModal(String(ann.id)) })}"><i data-lucide="pencil" style="width:11px;height:11px;"></i> ${ann.status === 'published' ? 'Edit' : 'Edit & Publish'}</button><button class="footer-btn delete" data-page-click="gc6e7dcfbd7b8"><i data-lucide="trash-2" style="width:11px;height:11px;"></i> Delete</button></div></div>
      </div>`).join('');
    lucide.createIcons();
    filterAnnouncements();
  }

  function filterAnnouncements() {
    const search   = document.getElementById('searchInput').value.toLowerCase();
    const audience = document.getElementById('audienceFilter').value;
    const priority = document.getElementById('priorityFilter').value;

    let visibleCount = 0;
    document.querySelectorAll('.ann-card').forEach(card => {
      const title    = card.querySelector('.ann-title').textContent.toLowerCase();
      const content  = card.querySelector('.ann-content').textContent.toLowerCase();
      const aud      = card.dataset.audience.split(',');
      const pri      = card.dataset.priority;

      const matchSearch   = title.includes(search) || content.includes(search);
      const audienceKey = audience === 'all-users' ? 'all' : audience;
      const matchAudience = audience === 'all' || aud.includes(audienceKey);
      const matchPriority = priority === 'all' || pri === priority;

      const visible = matchSearch && matchAudience && matchPriority;
      card.style.display = visible ? '' : 'none';
      if (visible) visibleCount += 1;
    });

    const empty = document.getElementById('adminAnnEmpty');
    if (empty) {
      empty.hidden = visibleCount > 0 && !announcementLoadError;
      if (!empty.hidden) empty.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState(announcementLoadError ? {
        icon: 'alert-circle',
        title: 'Announcements unavailable',
        text: announcementLoadError
      } : {
        icon: 'megaphone',
        title: 'No announcements found',
        text: ANNOUNCEMENTS.length ? 'Try adjusting your filters or search query.' : 'No announcements have been posted yet.'
      });
    }
    lucide.createIcons();
  }

  async function setAnnouncementPin(button, pinned) {
    button.disabled = true;
    try {
      await window.EDUGNAY_SCHOOL_READY;
      const id = button.closest('.ann-card').dataset.id;
      const updated = await window.EDUGNAY_API.setAnnouncementPinned(id, pinned);
      const announcement = ANNOUNCEMENTS.find(item => String(item.id) === String(id));
      if (announcement) announcement.pinned = updated.pinned;
      renderAdminAnnouncements();
      showAppToast(pinned ? 'Announcement pinned.' : 'Announcement unpinned.');
    } catch (error) {
      button.disabled = false;
      showAppToast(error.message || 'The announcement could not be updated.', 'error');
    }
  }

  function deleteCard(btn) {
    const card = btn.closest('.ann-card');
    const title = card.querySelector('.ann-title')?.textContent.trim() || 'this announcement';

    document.getElementById('deleteModalTitleVal').textContent = title;
    document.getElementById('deleteModalTitleInline').textContent = title;
    document.getElementById('deleteAnnouncementId').value = card.dataset.id || '';
    document.getElementById('deleteModalBackdrop').classList.add('open');
    lucide.createIcons();
  }

  function closeDeleteModal() {
    document.getElementById('deleteModalBackdrop').classList.remove('open');
  }

  async function confirmDeleteAnnouncement() {
    const announcementId = document.getElementById('deleteAnnouncementId').value;
    const deleteButton = document.querySelector('#deleteModalBackdrop .btn-save');
    if (!announcementId || !deleteButton) return;

    const originalLabel = deleteButton.textContent;
    deleteButton.disabled = true;
    deleteButton.textContent = 'Deleting...';
    try {
      await window.EDUGNAY_SCHOOL_READY;
      await window.EDUGNAY_API.deleteAnnouncement(announcementId);

      ANNOUNCEMENTS = ANNOUNCEMENTS.filter(item => String(item.id) !== String(announcementId));
      closeDeleteModal();
      renderAdminAnnouncements();
      showAppToast('Announcement deleted.');
    } catch (error) {
      showAppToast(error.message || 'The announcement could not be deleted.', 'error');
    } finally {
      deleteButton.disabled = false;
      deleteButton.textContent = originalLabel;
    }
  }

  document.getElementById('deleteModalBackdrop').addEventListener('click', function(e) {
    if (e.target === this) closeDeleteModal();
  });

  function handleImagePreview(input, previewWrapId, placeholderId) {
    const file = input.files[0];
    if (!file) return;
    input.form.dataset.removeImage = 'false';

    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById(previewWrapId).querySelector('.image-preview').src = e.target.result;
      document.getElementById(previewWrapId).style.display = 'block';
      document.getElementById(placeholderId).style.display = 'none';
    };
    reader.readAsDataURL(file);
  }

  function removeImage(event, inputId, previewWrapId, placeholderId) {
    event.stopPropagation();
    const input = document.getElementById(inputId);
    input.value = '';
    if (input.form.dataset.existingImage === 'true') input.form.dataset.removeImage = 'true';
    document.getElementById(previewWrapId).style.display = 'none';
    document.getElementById(placeholderId).style.display = 'flex';
  }

  function setupDropzone(areaId, inputId, previewWrapId, placeholderId) {
    const area = document.getElementById(areaId);
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
    area.addEventListener('dragleave', () => area.classList.remove('dragover'));
    area.addEventListener('drop', e => {
      e.preventDefault();
      area.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) {
        document.getElementById(inputId).files = e.dataTransfer.files;
        handleImagePreview(document.getElementById(inputId), previewWrapId, placeholderId);
      }
    });
  }

  async function saveEditedAnnouncement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!ACTIVE_ANNOUNCEMENT_ID) return;
    const values = getAnnouncementValues(form, form.elements.status.value);
    const feedback = document.getElementById('editAnnouncementFeedback');
    feedback.hidden = true;
    if (!values.title || !values.body) {
      feedback.textContent = 'Enter an announcement title and content.';
      feedback.hidden = false;
      return;
    }
    if (values.status === 'scheduled' && (!values.scheduledAt || new Date(values.scheduledAt).getTime() <= Date.now())) {
      feedback.textContent = 'Choose a future date and time to schedule this announcement.';
      feedback.hidden = false;
      return;
    }
    const saveButton = document.querySelector('#editModal .btn-save');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    try {
      await window.EDUGNAY_SCHOOL_READY;
      const updated = await window.EDUGNAY_API.updateAnnouncement(ACTIVE_ANNOUNCEMENT_ID, values);
      const index = ANNOUNCEMENTS.findIndex(item => String(item.id) === ACTIVE_ANNOUNCEMENT_ID);
      if (index >= 0) ANNOUNCEMENTS[index] = updated || ANNOUNCEMENTS[index];
      closeModal();
      renderAdminAnnouncements();
      showAppToast(values.status === 'scheduled' ? 'Announcement scheduled.' : 'Announcement updated.');
    } catch (error) {
      feedback.textContent = error.message || 'The announcement could not be updated.';
      feedback.hidden = false;
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Save Changes';
    }
  }

  document.getElementById('composeAnnouncementForm')?.addEventListener('submit', event => {
    event.preventDefault();
    saveAnnouncement(event.currentTarget, 'published').catch(error => showAppToast(error.message || 'The announcement could not be posted.', 'error'));
  });
  document.getElementById('editAnnouncementForm')?.addEventListener('submit', saveEditedAnnouncement);
  document.addEventListener('DOMContentLoaded', async () => {
    const api = window.EDUGNAY_API;
    if (api?.isBackendAvailable) {
      try {
        const announcements = window.EDUGNAY_COMMUNICATION_RESOURCES?.announcements;
        if (!announcements) throw new Error('Announcements could not be loaded.');
        ANNOUNCEMENTS = await announcements;
        announcementLoadError = '';
      } catch (error) {
        ANNOUNCEMENTS = [];
        announcementLoadError = error.message || 'Announcements could not be loaded.';
      }
    } else {
      ANNOUNCEMENTS = [];
      announcementLoadError = 'Connect to the backend and reload to view announcements.';
    }
    if (!window.EDUGNAY_COMMUNICATION) {
      window.EDUGNAY_COMMUNICATION = { backend: Boolean(api?.isBackendAvailable), notifications: [], announcements: [], tasks: [], error: announcementLoadError };
    }
    window.EDUGNAY_COMMUNICATION.backend = Boolean(api?.isBackendAvailable);
    window.EDUGNAY_COMMUNICATION.announcements = ANNOUNCEMENTS;
    document.getElementById('announcementDraftButton').disabled = false;
    document.getElementById('announcementPostButton').disabled = false;
    renderAdminAnnouncements();
    setupDropzone('composeUploadArea', 'composeImageInput', 'composePreview', 'composePlaceholder');
    setupDropzone('editUploadArea', 'editImageInput', 'editPreview', 'editPlaceholder');
    lucide.createIcons();
    window.EDUGNAY_PAGE_LOADING.ready();
  });

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    p13b9c9908645: function(event) { this.form.elements.schedule.disabled = this.value !== 'scheduled' },
    p7c0a49226afc: function(event) { handleImagePreview(this, 'composePreview', 'composePlaceholder') },
    pa376b45b28a0: function(event) { handleImagePreview(this, 'editPreview', 'editPlaceholder') },
    pa402d5caadf0: function(event) { filterAnnouncements() },
  },
  click: {
    p0601f23609d1: function(event) { document.getElementById('editImageInput').click() },
    p06eea46e6fe7: function(event) { saveDraft() },
    p089ea8a8218e: function(event) { closeModal() },
    p2c4afe7396a7: function(event) { removeImage(event, 'composeImageInput', 'composePreview', 'composePlaceholder') },
    p60303f28552d: function(event) { selectPriority(this, 'high') },
    p70ecc971b957: function(event) { selectPriority(this, 'low') },
    p71cb9ef85af9: function(event) { removeImage(event, 'editImageInput', 'editPreview', 'editPlaceholder') },
    p74fb28b55d8d: function(event) { selectPriority(this, 'normal') },
    p7c1c81cda33a: function(event) { selectPriority(this, 'event') },
    p981b20cdb664: function(event) { confirmDeleteAnnouncement() },
    pb8db97c425be: function(event) { closeDeleteModal() },
    pc4d411e4dda3: function(event) { document.getElementById('composeImageInput').click() },
  },
  input: {
    p02fcfc2a7d58: function(event) { filterAnnouncements() },
    pe2d65cb9e6d8: function(event) { updateAnnouncementPostLabel() },
  },
});

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    gc6e7dcfbd7b8: function(event) { deleteCard(this) },
  },
  error: {
    g7ea297b8513b: function(event) { this.closest('.ann-image-wrap').style.display='none' },
  },
});
