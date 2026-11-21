(function () {
  const baseUrl = String(window.EDUGNAY_APP_CONFIG?.apiBaseUrl || '').replace(/\/+$/, '');
  const form = document.getElementById('fetcherForm');
  const list = document.getElementById('fetcherList');
  const formModal = document.getElementById('fetcherFormModal');
  const registerButton = document.getElementById('fetcherRegisterOpen');
  const photoInput = document.getElementById('fetcherPhoto');
  let data = { children: [], fetchers: [], self: {} };
  let editingId = null;
  let busy = false;
  let formReturnFocus = null;
  let idReference = null;
  let idReturnFocus = null;
  let idImageUrl = null;
  let idPersonName = '';
  let pickupHistoryCursor = null;
  let pickupHistoryBusy = false;
  let pickupHistoryRequestId = 0;
  let pickupHistoryTimeZone = 'Asia/Manila';
  let pickupHistoryRecords = [];

  const escape = value => window.EDUGNAY_CONFIG.escapeHtml(String(value ?? ''));

  function initials(value) {
    return String(value ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map(part => part.charAt(0).toUpperCase()).join('') || '--';
  }

  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}/fetchers${path}`, { credentials: 'include', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'The request could not be completed.');
    return body;
  }

  async function pickupRequest(path, options = {}) {
    const response = await fetch(`${baseUrl}/pickup${path}`, { credentials: 'include', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'The ID could not be loaded.');
    return body;
  }

  function renderSelf() {
    const target = document.getElementById('ownPickupStatus');
    const self = data.self || {};
    const needsPhoto = !self.eligible && !self.hasPhoto;
    const text = self.eligible
      ? `You are eligible to pick up ${self.children.length} linked ${self.children.length === 1 ? 'child' : 'children'}.`
      : needsPhoto
        ? 'Add a profile photo to become eligible for your own pickup ID.'
        : 'No active, enrolled children are currently linked to your account.';
    target.innerHTML = `<div class="fetcher-eligibility-row">
      <div class="panel-sub">${escape(text)}${needsPhoto ? ' <a class="panel-action" href="edugnay-parent-profile.html">My Profile</a>' : ''}</div>
      ${self.eligible ? '<button type="button" class="top-btn primary" data-id-reference="self">View your ID</button>' : ''}
    </div>`;
  }

  function renderChildChoices() {
    const choices = document.getElementById('fetcherChildrenChoices');
    choices.className = 'fetcher-choices';
    choices.innerHTML = data.children.length
      ? data.children.map(child => `<label><input type="checkbox" name="studentId" value="${child.studentId}"><span>${escape(child.studentName)}</span></label>`).join('')
      : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'users', title: 'No linked children', text: 'Active, enrolled children linked to your account will appear here.' });
    document.getElementById('fetcherSubmit').disabled = !data.children.length && !editingId;
  }

  function statusRow(fetcher, child, authorization = null) {
    const currentChild = data.children.find(item => item.studentId === child.studentId);
    const currentlyEligible = Boolean(currentChild);
    const status = authorization?.status || 'not_requested';
    const mayRevoke = Boolean(authorization) && status !== 'revoked';
    const mayResubmit = Boolean(authorization) && ['revoked', 'rejected'].includes(status)
      && currentlyEligible;
    const badgeClass = ({ approved: 'badge-green', pending: 'badge-orange', rejected: 'badge-red', revoked: 'badge-red' })[status] || 'badge-gray';
    const statusLabel = ({ approved: 'Approved', pending: 'Pending', rejected: 'Rejected', revoked: 'Revoked', not_requested: 'Not requested' })[status]
      || `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
    const unavailableNote = authorization && !currentlyEligible && status !== 'revoked'
      ? '<p>Pickup is unavailable while this student is not linked and actively enrolled.</p>' : '';
    const sectionLabel = currentChild?.gradeLevel && currentChild?.sectionName
      ? `<p>${escape(currentChild.gradeLevel)} – ${escape(currentChild.sectionName)}</p>` : '';
    return `<div class="fetcher-authorization">
      <div><div class="fetcher-authorization-title"><strong>${escape(child.studentName)}</strong>
        <span class="badge ${badgeClass}">${escape(statusLabel)}</span></div>
        ${sectionLabel}
        ${unavailableNote}</div>
      <div class="fetcher-authorization-actions">
        ${!authorization ? `<button type="button" class="top-btn secondary" data-action="request" data-fetcher="${fetcher.id}" data-student="${child.studentId}">Request pickup approval</button>` : ''}
        ${mayResubmit ? `<button type="button" class="top-btn secondary" data-action="request" data-fetcher="${fetcher.id}" data-student="${authorization.studentId}">Resubmit</button>` : ''}
        ${mayRevoke ? `<div class="fetcher-row-menu">
          <button type="button" class="fetcher-menu-trigger" data-action="menu-toggle" aria-label="Authorization actions for ${escape(child.studentName)}" aria-haspopup="menu" aria-expanded="false"><i data-lucide="more-vertical" aria-hidden="true" style="width:16px;height:16px;"></i></button>
          <div class="fetcher-action-menu" role="menu">
            <button type="button" class="fetcher-menu-item danger" role="menuitem" data-action="revoke" data-fetcher="${fetcher.id}" data-student="${authorization.studentId}"><i data-lucide="ban" aria-hidden="true" style="width:14px;height:14px;"></i> Revoke</button>
          </div>
        </div>` : ''}
      </div>
    </div>`;
  }

  function renderFetchers() {
    if (!data.fetchers.length) {
      list.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'contact', title: 'No fetchers registered', text: 'Registered fetchers will appear here.' });
      return;
    }
    list.innerHTML = data.fetchers.map(fetcher => {
      const linkedIds = new Set(data.children.map(child => child.studentId));
      const linkedRows = data.children.map(child => {
        const authorization = fetcher.authorizations.find(auth => auth.studentId === child.studentId);
        return statusRow(fetcher, child, authorization);
      }).join('');
      const formerRows = fetcher.authorizations.filter(auth => !linkedIds.has(auth.studentId))
        .map(authorization => statusRow(fetcher, authorization, authorization)).join('');
      const canViewId = fetcher.authorizations.some(auth => auth.status === 'approved' && linkedIds.has(auth.studentId));
      return `<article class="fetcher-person">
        <div class="fetcher-section-head">
          <div class="fetcher-person-top">
          ${fetcher.photoUrl ? `<img src="${escape(fetcher.photoUrl)}" alt="Photo of ${escape(fetcher.fullName)}">` : `<div class="tb-avatar parent" aria-hidden="true">${escape(initials(fetcher.fullName))}</div>`}
          <div><h3>${escape(fetcher.fullName)}</h3><p>${escape(fetcher.relationship)} · ${escape(fetcher.contactNumber)}</p></div>
          </div>
          <div class="fetcher-authorization-actions">
            <button type="button" class="top-btn secondary fetcher-edit-button" data-action="edit" data-fetcher="${fetcher.id}" aria-label="Edit details for ${escape(fetcher.fullName)}" title="Edit details"><i data-lucide="pencil" aria-hidden="true"></i><span>Edit details</span></button>
            ${canViewId ? `<button type="button" class="top-btn primary fetcher-id-button" data-id-reference="${fetcher.id}" aria-label="View ID for ${escape(fetcher.fullName)}" title="View ID"><i data-lucide="contact" aria-hidden="true"></i><span>View ID</span></button>` : ''}
          </div>
        </div>
        ${linkedRows}${formerRows}
      </article>`;
    }).join('');
  }

  async function load() {
    closeId();
    data = await request('/mine');
    renderSelf();
    renderChildChoices();
    renderFetchers();
    await loadPickupHistory();
    window.lucide?.createIcons();
  }

  async function loadPickupHistory(append = false) {
    const target = document.getElementById('parentPickupHistory');
    const more = document.getElementById('parentPickupMore');
    if (append && (pickupHistoryBusy || !pickupHistoryCursor)) return;
    const requestId = append ? pickupHistoryRequestId : ++pickupHistoryRequestId;
    if (!append) {
      pickupHistoryCursor = null;
      more.hidden = true;
    }
    pickupHistoryBusy = true;
    const params = new URLSearchParams({ limit: '50' });
    const from = document.getElementById('parentPickupFrom').value;
    const to = document.getElementById('parentPickupTo').value;
    if (from && to && from > to) {
      target.innerHTML = '';
      pickupHistoryRecords = [];
      document.getElementById('parentPickupCount').textContent = window.EDUGNAY_PICKUP_HISTORY.countLabel(0, false);
      showAppToast('The start date must be on or before the end date.', 'error');
      pickupHistoryBusy = false;
      return;
    }
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (append && pickupHistoryCursor) params.set('cursor', pickupHistoryCursor);
    try {
      const result = await pickupRequest(`/history?${params}`);
      if (requestId !== pickupHistoryRequestId) return;
      pickupHistoryTimeZone = result.timeZone || 'Asia/Manila';
      const records = result.records || [];
      pickupHistoryRecords = append ? pickupHistoryRecords.concat(records) : records;
      pickupHistoryCursor = records.length ? result.nextCursor : null;
      target.innerHTML = pickupHistoryRecords.length ? window.EDUGNAY_PICKUP_HISTORY.render(pickupHistoryRecords, pickupHistoryTimeZone)
          : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'calendar-days', title: 'No pickup records', text: 'Completed handovers will appear here for these dates.' });
      document.getElementById('parentPickupCount').textContent = window.EDUGNAY_PICKUP_HISTORY.countLabel(pickupHistoryRecords.length, Boolean(pickupHistoryCursor));
      more.hidden = !pickupHistoryCursor;
      window.EDUGNAY_AVATAR.hydrate(target);
      window.lucide?.createIcons();
    } catch (error) {
      if (requestId === pickupHistoryRequestId) {
        showAppToast(error.message, 'error');
        more.hidden = append ? !pickupHistoryCursor : true;
      }
    } finally {
      if (requestId === pickupHistoryRequestId) pickupHistoryBusy = false;
    }
  }

  function closeId() {
    idReference = null;
    idPersonName = '';
    const modal = document.getElementById('fetcherIdView');
    modal.classList.remove('open');
    modal.hidden = true;
    document.getElementById('fetcherIdCard').removeAttribute('src');
    if (idImageUrl) URL.revokeObjectURL(idImageUrl);
    idImageUrl = null;
    const returnFocus = idReturnFocus;
    idReturnFocus = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  async function loadIdImage(source, authenticated = false) {
    let imageUrl = source;
    if (authenticated) {
      const response = await fetch(new URL(source, baseUrl || window.location.origin), { credentials: 'include' });
      if (!response.ok) throw new Error('The ID photo could not be loaded.');
      imageUrl = URL.createObjectURL(await response.blob());
    }
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('An ID image could not be loaded.'));
        image.src = imageUrl;
      });
    } finally {
      if (authenticated) URL.revokeObjectURL(imageUrl);
    }
  }

  function fitIdText(context, text, maxWidth, size, weight = 600) {
    while (size > 12) {
      context.font = `${weight} ${size}px 'Plus Jakarta Sans', sans-serif`;
      if (context.measureText(text).width <= maxWidth) break;
      size -= 1;
    }
    return size;
  }

  function drawIdPhoto(context, image, x, y, size) {
    const crop = Math.min(image.naturalWidth, image.naturalHeight);
    context.save();
    context.beginPath();
    context.roundRect(x, y, size, size, 8);
    context.clip();
    context.drawImage(image, (image.naturalWidth - crop) / 2, (image.naturalHeight - crop) / 2,
      crop, crop, x, y, size, size);
    context.restore();
  }

  function drawIdSchoolHeader(context, schoolName, logo) {
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(50, 50, 22, 0, Math.PI * 2);
    context.fill();
    if (logo) {
      const ratio = Math.min(38 / logo.naturalWidth, 38 / logo.naturalHeight);
      const width = logo.naturalWidth * ratio;
      const height = logo.naturalHeight * ratio;
      context.save();
      context.beginPath();
      context.arc(50, 50, 22, 0, Math.PI * 2);
      context.clip();
      context.drawImage(logo, 50 - width / 2, 50 - height / 2, width, height);
      context.restore();
    } else {
      const initials = schoolName.split(/\s+/).filter(Boolean).slice(0, 3)
        .map(word => word.charAt(0).toUpperCase()).join('');
      context.fillStyle = '#1a4080';
      context.font = "700 11px 'Plus Jakarta Sans', sans-serif";
      context.textAlign = 'center';
      context.fillText(initials || 'S', 50, 54, 38);
    }
    context.textAlign = 'left';
    context.fillStyle = '#ffffff';
    context.font = "700 14px 'Plus Jakarta Sans', sans-serif";
    const words = schoolName.split(/\s+/).filter(Boolean);
    const lines = [''];
    for (const word of words) {
      const line = lines[lines.length - 1];
      const next = line ? `${line} ${word}` : word;
      if (line && context.measureText(next).width > 215 && lines.length < 2) lines.push(word);
      else lines[lines.length - 1] = next;
    }
    if (lines.length === 2) {
      context.fillText(lines[0], 84, 45, 215);
      context.fillText(lines[1], 84, 63, 215);
    } else context.fillText(lines[0], 84, 55, 215);
    context.strokeStyle = '#c9a84c';
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(319, 36, 105, 28, 14);
    context.stroke();
    context.fillStyle = '#f0d080';
    context.font = "700 10px 'Plus Jakarta Sans', sans-serif";
    context.textAlign = 'center';
    context.fillText('FETCHER ID', 371.5, 54, 90);
    context.textAlign = 'left';
  }

  async function renderIdPng(credential, qrDataUrl, school) {
    const photo = await loadIdImage(credential.photoUrl, true);
    const qr = await loadIdImage(qrDataUrl);
    const logo = school?.logoUrl ? await loadIdImage(school.logoUrl, true).catch(() => null) : null;
    if (document.fonts?.ready) await document.fonts.ready;
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1320;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image export is unavailable in this browser.');
    context.scale(2, 2);
    context.fillStyle = '#0b1f3a';
    context.fillRect(0, 0, 450, 660);
    drawIdSchoolHeader(context, school?.name || 'School', logo);
    context.fillStyle = '#ffffff';
    drawIdPhoto(context, photo, 28, 105, 82);
    fitIdText(context, credential.fullName, 290, 19, 700);
    context.fillText(credential.fullName, 128, 139, 290);
    context.font = "400 15px 'Plus Jakarta Sans', sans-serif";
    context.fillText(credential.relationship, 128, 166, 290);
    context.beginPath();
    context.roundRect(75, 210, 300, 300, 10);
    context.fill();
    context.drawImage(qr, 90, 225, 270, 270);
    context.textAlign = 'center';
    context.font = "400 13px 'Plus Jakarta Sans', sans-serif";
    context.fillText('Manual code', 225, 542);
    fitIdText(context, credential.manualCode, 394, 21, 700);
    context.fillText(credential.manualCode, 225, 571, 394);
    context.font = "400 11px 'Plus Jakarta Sans', sans-serif";
    context.fillText('Valid only for currently authorized school pickup.', 225, 606);
    context.fillStyle = '#b8cce6';
    context.font = "400 10px 'Plus Jakarta Sans', sans-serif";
    context.fillText('Issued through AcadeMix', 225, 628);
    return new Promise((resolve, reject) => canvas.toBlob(blob =>
      blob ? resolve(blob) : reject(new Error('The ID image could not be created.')), 'image/png'));
  }

  function resetForm() {
    editingId = null;
    form.reset();
    photoInput.value = '';
    document.getElementById('fetcherFormTitle').textContent = 'Register a fetcher';
    document.getElementById('fetcherSubmit').textContent = 'Send for approval';
    photoInput.required = true;
    document.getElementById('photoOptional').hidden = true;
    document.getElementById('fetcherChildrenField').hidden = false;
    renderChildChoices();
  }

  function openForm(trigger = registerButton) {
    if (busy) return;
    resetForm();
    formReturnFocus = trigger;
    formModal.hidden = false;
    formModal.classList.add('open');
    document.getElementById('fetcherName').focus();
  }

  function closeForm({ restoreFocus = true, force = false } = {}) {
    if (busy && !force) return;
    formModal.classList.remove('open');
    formModal.hidden = true;
    resetForm();
    const returnFocus = formReturnFocus;
    formReturnFocus = null;
    if (!restoreFocus) return;
    (returnFocus?.isConnected ? returnFocus : registerButton)?.focus();
  }

  async function showId(reference, reissue = false, trigger = null) {
    if (busy) return;
    const returnFocus = trigger || document.activeElement;
    busy = true;
    let rotated = false;
    try {
      let credential = reissue
        ? await pickupRequest(`/credentials/${reference}/reissue`, { method: 'POST' })
        : await pickupRequest(`/credentials/${reference}`);
      rotated = reissue;
      if (!credential.issued) credential = await pickupRequest(`/credentials/${reference}/issue`, { method: 'POST' });
      if (!credential.issued || !window.QRCode?.toDataURL) throw new Error('QR code generation is unavailable.');
      const image = await window.QRCode.toDataURL(credential.qrPayload, { width: 540, margin: 3,
        errorCorrectionLevel: 'M', color: { dark: '#0b1f3a', light: '#ffffff' } });
      const png = await renderIdPng(credential, image, window.EDUGNAY_CONFIG.getActiveSchool());
      const imageUrl = URL.createObjectURL(png);
      if (!reissue) idReturnFocus = returnFocus;
      if (idImageUrl) URL.revokeObjectURL(idImageUrl);
      idImageUrl = imageUrl;
      idReference = reference;
      idPersonName = credential.fullName;
      document.getElementById('fetcherIdCard').src = imageUrl;
      document.getElementById('fetcherIdCard').alt = `Fetcher ID for ${credential.fullName}, ${credential.relationship}. Manual code: ${credential.manualCode}`;
      const modal = document.getElementById('fetcherIdView');
      modal.hidden = false;
      modal.classList.add('open');
      document.getElementById('fetcherIdClose').focus();
      if (reissue) showAppToast('Fetcher ID reissued. The previous codes no longer work.');
    } catch (error) {
      if (rotated) closeId();
      showAppToast(rotated ? 'ID reissued, but the replacement could not be displayed. Open the ID again.' : error.message, rotated ? 'info' : 'error');
    }
    finally { busy = false; }
  }

  document.getElementById('ownPickupStatus').addEventListener('click', event => {
    const trigger = event.target.closest('[data-id-reference="self"]');
    if (trigger) void showId('self', false, trigger);
  });
  registerButton.addEventListener('click', () => openForm(registerButton));
  document.getElementById('fetcherFormClose').addEventListener('click', () => closeForm());
  document.getElementById('fetcherCancelEdit').addEventListener('click', () => closeForm());
  formModal.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeForm();
  });
  document.getElementById('fetcherIdClose').addEventListener('click', closeId);
  document.getElementById('fetcherIdView').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeId();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !formModal.hidden) {
      event.preventDefault();
      closeForm();
      return;
    }
    const idModal = document.getElementById('fetcherIdView');
    if (event.key === 'Escape' && !idModal.hidden) {
      event.preventDefault();
      closeId();
      return;
    }
    if (event.key !== 'Tab' || formModal.hidden) return;
    const focusable = [...formModal.querySelectorAll('button:not(:disabled), input:not(:disabled):not([type="file"]), select:not(:disabled), textarea:not(:disabled)')]
      .filter(element => !element.hidden && element.getClientRects().length);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !formModal.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !formModal.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });
  document.getElementById('fetcherIdDownload').addEventListener('click', () => {
    if (!idImageUrl || !idReference) return;
    const link = document.createElement('a');
    link.href = idImageUrl;
    link.download = `AcadeMix-Fetcher-ID-${idPersonName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'fetcher'}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
  document.getElementById('fetcherIdReissue').addEventListener('click', () => {
    if (!idReference || busy) return;
    const reference = idReference;
    const trigger = document.getElementById('fetcherIdReissue');
    void window.confirmFetcherAction({
      title: 'Reissue Fetcher ID?',
      subtitle: 'The current QR and manual code will stop working.',
      contextLabel: 'Reissuing ID for',
      contextValue: idPersonName,
      icon: 'refresh-cw',
      message: 'Show the replacement ID at the next pickup.',
      confirmLabel: 'Yes, Reissue ID', destructive: true, trigger,
      onConfirm: () => showId(reference, true, trigger)
    });
  });
  window.initAcademicRangePickers(document.querySelector('.parent-fetcher-history'), {
    rowSelector: '.pickup-history-filters', startSelector: '#parentPickupFrom',
    endSelector: '#parentPickupTo', name: 'Pickup history', allowSameDay: true, allowClear: true
  });
  let pickupHistoryReloadQueued = false;
  ['parentPickupFrom', 'parentPickupTo'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (pickupHistoryReloadQueued) return;
      pickupHistoryReloadQueued = true;
      queueMicrotask(() => { pickupHistoryReloadQueued = false; void loadPickupHistory(); });
    });
  });
  document.getElementById('parentPickupToday').addEventListener('click', () => {
    const date = window.EDUGNAY_PICKUP_HISTORY.today(pickupHistoryTimeZone);
    ['parentPickupFrom', 'parentPickupTo'].forEach(id => {
      const input = document.getElementById(id);
      input.value = date;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    void loadPickupHistory();
  });
  document.getElementById('parentPickupMore').addEventListener('click', () => void loadPickupHistory(true));

  function closeFetcherMenus() {
    list.querySelectorAll('.fetcher-action-menu.open').forEach(menu => menu.classList.remove('open'));
    list.querySelectorAll('.fetcher-menu-trigger[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('.fetcher-row-menu')) closeFetcherMenus();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const trigger = list.querySelector('.fetcher-menu-trigger[aria-expanded="true"]');
    if (!trigger) return;
    closeFetcherMenus();
    trigger.focus();
  });

  function startEditing(fetcher, trigger) {
    if (busy) return;
    resetForm();
    editingId = fetcher.id;
    document.getElementById('fetcherName').value = fetcher.fullName;
    document.getElementById('fetcherRelationship').value = fetcher.relationship;
    document.getElementById('fetcherContact').value = fetcher.contactNumber;
    document.getElementById('fetcherPhoto').value = '';
    photoInput.required = false;
    document.getElementById('photoOptional').hidden = false;
    document.getElementById('fetcherChildrenField').hidden = true;
    document.getElementById('fetcherFormTitle').textContent = `Edit ${fetcher.fullName}`;
    document.getElementById('fetcherSubmit').textContent = 'Save changes';
    document.getElementById('fetcherSubmit').disabled = false;
    formReturnFocus = trigger;
    formModal.hidden = false;
    formModal.classList.add('open');
    document.getElementById('fetcherName').focus();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const selected = [...form.querySelectorAll('input[name="studentId"]:checked')].map(input => Number(input.value));
    if (!editingId && !selected.length) return showAppToast('Choose at least one child.', 'error');
    const payload = new FormData(form);
    const wasEditing = Boolean(editingId);
    payload.delete('studentId');
    if (!editingId) payload.set('studentIds', JSON.stringify(selected));
    if (editingId && !document.getElementById('fetcherPhoto').files.length) payload.delete('photo');
    busy = true;
    document.getElementById('fetcherSubmit').disabled = true;
    try {
      await request(editingId ? `/${editingId}` : '/', { method: editingId ? 'PATCH' : 'POST', body: payload });
      closeForm({ restoreFocus: false, force: true });
      registerButton.focus();
      showAppToast(wasEditing ? 'Fetcher details saved.' : 'Fetcher request saved.');
      try { await load(); }
      catch (error) { showAppToast(`Fetcher ${wasEditing ? 'details were' : 'request was'} saved, but the list could not be refreshed. ${error.message}`, 'info'); }
    } catch (error) { showAppToast(error.message, 'error'); }
    finally { busy = false; document.getElementById('fetcherSubmit').disabled = !data.children.length && !editingId; }
  });

  list.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    const idButton = event.target.closest('button[data-id-reference]');
    if (idButton) return void showId(idButton.dataset.idReference, false, idButton);
    if (!button) return;
    if (button.dataset.action === 'menu-toggle') {
      event.stopPropagation();
      const menu = button.nextElementSibling;
      const shouldOpen = !menu.classList.contains('open');
      closeFetcherMenus();
      if (shouldOpen) {
        menu.classList.add('open');
        button.setAttribute('aria-expanded', 'true');
      }
      return;
    }
    if (busy) return;
    const fetcher = data.fetchers.find(item => item.id === Number(button.dataset.fetcher));
    if (!fetcher) return;
    if (button.dataset.action === 'edit') return startEditing(fetcher, button);
    const studentId = Number(button.dataset.student);
    if (!studentId) return showAppToast('Select a linked child first.', 'error');
    closeFetcherMenus();
    const action = button.dataset.action === 'revoke' ? 'revoke' : 'request';
    const perform = async () => {
      busy = true;
      button.disabled = true;
      let saved = false;
      try {
        await request(`/${fetcher.id}/students/${studentId}/${action}`, { method: 'POST' });
        saved = true;
        await load();
        showAppToast(action === 'revoke' ? 'Pickup authorization revoked.' : 'Request sent for approval.');
      } catch (error) {
        showAppToast(saved ? 'Authorization changed, but the list could not refresh. Reload to verify it.' : error.message, saved ? 'info' : 'error');
      } finally { busy = false; button.disabled = false; }
    };
    if (action === 'revoke') {
      const student = data.children.find(child => child.studentId === studentId)?.studentName || 'this child';
      void window.confirmFetcherAction({ title: 'Revoke pickup authorization?',
        subtitle: 'This fetcher will lose pickup authorization.',
        contextLabel: 'Revoking for', contextValue: student, icon: 'shield-x',
        message: `${fetcher.fullName} will no longer be allowed to pick up ${student}.`,
        confirmLabel: 'Yes, Revoke', destructive: true, trigger: button, onConfirm: perform });
    } else void perform();
  });

  (async () => {
    try {
      await window.EDUGNAY_SCHOOL_READY;
      if (await window.EDUGNAY_API.enforceProfileSetup('edugnay-parent-profile.html', 'parent')) return;
      const user = await window.EDUGNAY_API.getCurrentUser();
      if (user?.role !== 'parent') { window.location.replace('../../index.html'); return; }
      await load();
    } catch (error) { showAppToast(error.message || 'Fetchers could not be loaded. Refresh and try again.', 'error'); }
    finally { window.EDUGNAY_PAGE_LOADING?.ready(); }
  })();
})();
