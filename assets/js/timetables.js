(() => {
  'use strict';

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const dateAtUtc = value => new Date(`${value}T00:00:00Z`);
  const iso = date => date.toISOString().slice(0, 10);
  const addDays = (value, count) => { const date = dateAtUtc(value); date.setUTCDate(date.getUTCDate() + count); return iso(date); };
  const weekday = value => dateAtUtc(value).getUTCDay() || 7;
  const weekMonday = value => addDays(value, 1 - weekday(value));
  const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
  const shortDate = value => dateAtUtc(value).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const timeLabel = value => { const [hour, minute] = String(value || '').split(':').map(Number); return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`; };
  const activeOn = (meeting, date) => meeting.weekday === weekday(date) && date >= meeting.startDate && date <= meeting.endDate;
  const byTime = (a, b) => a.startTime.localeCompare(b.startTime) || a.subjectName.localeCompare(b.subjectName);
  const api = () => window.EDUGNAY_API;

  function selectedMeetings(state) {
    const sectionId = document.getElementById('timetable-section')?.value || '';
    const teacherId = document.getElementById('timetable-teacher')?.value || '';
    return state.data.meetings.filter(item => (!sectionId || String(item.sectionId) === sectionId)
      && (!teacherId || String(item.teacherId) === teacherId));
  }

  function setOptions(select, options, placeholder) {
    if (!select) return;
    const old = select.value;
    select.replaceChildren(new Option(placeholder, ''), ...options.map(item => new Option(item.label, String(item.value))));
    if ([...select.options].some(option => option.value === old)) select.value = old;
  }

  function renderFilters(state) {
    if (state.role !== 'admin') return;
    const sections = new Map();
    const teachers = new Map();
    for (const item of state.data.assignments) {
      sections.set(item.sectionId, `${item.gradeName} · ${item.sectionName}`);
      teachers.set(item.teacherId, item.teacherName);
    }
    setOptions(document.getElementById('timetable-section'), [...sections].map(([value, label]) => ({ value, label })), 'All sections');
    setOptions(document.getElementById('timetable-teacher'), [...teachers].map(([value, label]) => ({ value, label })), 'All teachers');
  }

  function renderDialogSections(state, assignmentId = '') {
    const sections = new Map();
    for (const item of state.data.assignments) {
      if (item.sectionStatus !== 'active' && String(item.assignmentId) !== String(assignmentId)) continue;
      sections.set(item.sectionId, `${item.gradeName} · ${item.sectionName}`);
    }
    setOptions(document.getElementById('timetable-dialog-section'), [...sections].map(([value, label]) => ({ value, label })), 'Choose a section');
  }

  function renderDialogSubjects(state, sectionId, assignmentId = '') {
    const assignmentSelect = document.getElementById('timetable-assignment');
    const assignments = state.data.assignments.filter(item => String(item.sectionId) === String(sectionId)
      && (item.sectionStatus === 'active' || String(item.assignmentId) === String(assignmentId)));
    const names = new Map();
    for (const item of assignments) names.set(item.subjectName, (names.get(item.subjectName) || 0) + 1);
    assignmentSelect.replaceChildren(new Option('Choose a subject', ''), ...assignments.map(item =>
      new Option(names.get(item.subjectName) > 1 ? `${item.subjectName} (${item.teacherName})` : item.subjectName, String(item.assignmentId))));
    assignmentSelect.disabled = !sectionId;
    assignmentSelect.value = String(assignmentId);
    const selected = assignments.find(item => String(item.assignmentId) === assignmentSelect.value);
    document.getElementById('timetable-assigned-teacher').value = selected?.teacherName || '';
  }

  function eventHtml(item, state) {
    const time = `${timeLabel(item.startTime)} - ${timeLabel(item.endTime)}`;
    const details = [];
    if (state.role === 'student' && item.teacherName) details.push(`Teacher: ${item.teacherName}`);
    if (item.room) details.push(`Room: ${item.room}`);
    const classDetails = state.role === 'student' ? ''
      : `<span class="timetable-event-class">${escape(item.gradeName)} · ${escape(item.sectionName)}</span>`;
    const content = `<strong class="timetable-event-subject">${escape(item.subjectName)}</strong>
      <span class="timetable-event-time">${escape(time)}</span>
      ${classDetails}
      ${details.map(detail => `<span class="timetable-event-meta">${escape(detail)}</span>`).join('')}`;
    const label = [item.subjectName, time, ...(state.role === 'student' ? [] : [item.gradeName, item.sectionName]), ...details].join(', ');
    return state.role === 'admin' && state.data.year?.status !== 'archived'
      ? `<button class="timetable-event" type="button" data-meeting-id="${item.id}" aria-label="Edit ${escape(label)}">${content}</button>`
      : `<div class="timetable-event">${content}</div>`;
  }

  function renderWeek(state) {
    const start = state.week;
    const end = addDays(start, 6);
    const nextMonday = addDays(start, 7);
    document.getElementById('timetable-week-label').textContent = `${shortDate(start)} – ${shortDate(end)}`;
    const currentDate = today();
    const currentYear = state.years?.find(year => currentDate >= year.startDate && currentDate <= year.endDate);
    document.getElementById('timetable-today').disabled = !currentYear
      || (String(state.data.year?.id) === String(currentYear.id) && start === weekMonday(currentDate));
    const meetings = selectedMeetings(state);
    document.getElementById('timetable-grid').innerHTML = days.map((day, index) => {
      const date = addDays(start, index);
      const isToday = date === today();
      const items = meetings.filter(item => activeOn(item, date)).sort(byTime);
      return `<section class="timetable-day${isToday ? ' today' : ''}" aria-label="${day}, ${shortDate(date)}${isToday ? ', today' : ''}">
        <div class="timetable-day-head"><span>${day}</span><time datetime="${date}">${shortDate(date)}</time></div>
        ${items.length ? items.map(item => eventHtml(item, state)).join('') : '<p class="timetable-empty-day">No classes</p>'}
      </section>`;
    }).join('') + `<section class="timetable-day timetable-day-preview" aria-label="Next Monday, ${shortDate(nextMonday)} (next week)">
      <div class="timetable-day-head"><span>Monday</span><time datetime="${nextMonday}">${shortDate(nextMonday)}</time></div>
      <p class="timetable-empty-day">Next week</p>
    </section>`;
    if (state.role === 'admin') renderUnscheduled(state);
  }

  function exportWeek(state) {
    if (!state.data.year || !state.week) return null;
    const meetings = selectedMeetings(state);
    return {
      weekStart: state.week,
      yearLabel: state.data.year.label,
      days: days.map((name, index) => {
        const date = addDays(state.week, index);
        return {
          name,
          date,
          meetings: meetings.filter(item => activeOn(item, date)).sort(byTime).map(item => ({
            subject: item.subjectName,
            time: `${timeLabel(item.startTime)} - ${timeLabel(item.endTime)}`,
            details: [
              ...(state.role === 'student' ? [`Teacher: ${item.teacherName}`] : [`${item.gradeName} · ${item.sectionName}`]),
              ...(item.room ? [`Room: ${item.room}`] : [])
            ]
          }))
        };
      })
    };
  }

  function renderUnscheduled(state) {
    const sectionId = document.getElementById('timetable-section').value;
    const teacherId = document.getElementById('timetable-teacher').value;
    const used = new Set(state.data.meetings.map(item => item.assignmentId));
    const items = state.data.assignments.filter(item => !used.has(item.assignmentId)
      && (!sectionId || String(item.sectionId) === sectionId)
      && (!teacherId || String(item.teacherId) === teacherId));
    document.getElementById('timetable-unscheduled-count').textContent = `${items.length} unscheduled`;
    document.getElementById('timetable-unscheduled').innerHTML = items.length ? items.map(item =>
      `<div class="timetable-unscheduled-item"><div><strong>${escape(item.subjectName)}</strong>
       <span>${escape(item.gradeName)} · ${escape(item.sectionName)} · ${escape(item.teacherName)}</span></div>
       ${state.data.year?.status !== 'archived' && item.sectionStatus === 'active'
        ? `<button class="timetable-button secondary" type="button" data-assignment-id="${item.assignmentId}">Schedule</button>` : ''}</div>`
    ).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({
      icon: 'calendar-check',
      title: 'All subjects are scheduled',
      text: 'Every subject assignment matching these filters already has a meeting.'
    });
  }

  function openDialog(state, assignmentId = '', meeting = null) {
    if (state.data.year?.status === 'archived') return;
    const dialog = document.getElementById('timetable-dialog');
    const form = document.getElementById('timetable-form');
    form.reset();
    const selectedId = String(meeting?.assignmentId || assignmentId);
    const assignment = state.data.assignments.find(item => String(item.assignmentId) === selectedId);
    renderDialogSections(state, meeting ? selectedId : '');
    document.getElementById('timetable-dialog-section').value = assignment ? String(assignment.sectionId) : '';
    renderDialogSubjects(state, assignment?.sectionId || '', selectedId);
    document.getElementById('timetable-dialog-section').disabled = Boolean(meeting);
    form.elements.assignmentId.disabled = Boolean(meeting);
    form.elements.weekday.value = String(meeting?.weekday || weekday(today()));
    form.elements.startTime.value = meeting?.startTime || '';
    form.elements.endTime.value = meeting?.endTime || '';
    form.elements.startDate.value = meeting?.startDate || state.data.year.startDate;
    form.elements.endDate.value = meeting?.endDate || state.data.year.endDate;
    form.elements.room.value = meeting?.room || '';
    form.elements.startDate.min = form.elements.endDate.min = state.data.year.startDate;
    form.elements.startDate.max = form.elements.endDate.max = state.data.year.endDate;
    state.editingId = meeting?.id || null;
    state.editingAssignmentId = meeting?.assignmentId || null;
    document.getElementById('timetable-dialog-title').textContent = meeting ? 'Edit class meeting' : 'Add class meeting';
    document.getElementById('timetable-delete').hidden = !meeting;
    document.getElementById('timetable-error').textContent = '';
    state.dialogReturnFocus = document.activeElement;
    state.previousBodyOverflow = document.body.style.overflow;
    document.getElementById('timetable-dialog-overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    dialog.querySelector('h2')?.focus();
  }

  function closeDialog(state) {
    closeDeleteConfirmation(state, false, true);
    document.getElementById('timetable-dialog-overlay').hidden = true;
    document.body.style.overflow = state.previousBodyOverflow || '';
    state.dialogReturnFocus?.focus?.();
  }

  function openDeleteConfirmation(state) {
    if (!state.editingId || state.deletePending) return;
    state.deleteReturnFocus = document.activeElement;
    const meetingDialog = document.getElementById('timetable-dialog');
    meetingDialog.setAttribute('aria-hidden', 'true');
    meetingDialog.inert = true;
    document.getElementById('timetable-confirm-overlay').hidden = false;
    document.getElementById('timetable-confirm-title').focus();
  }

  function closeDeleteConfirmation(state, restoreFocus = true, force = false) {
    if (state.deletePending && !force) return;
    document.getElementById('timetable-confirm-overlay').hidden = true;
    const meetingDialog = document.getElementById('timetable-dialog');
    meetingDialog.removeAttribute('aria-hidden');
    meetingDialog.inert = false;
    if (restoreFocus) state.deleteReturnFocus?.focus?.();
    state.deleteReturnFocus = null;
  }

  function trapDialogTab(event, dialog) {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not([hidden]):not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="-1"]')];
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function saveMeeting(state, event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submit = document.getElementById('timetable-save');
    submit.disabled = true;
    document.getElementById('timetable-error').textContent = '';
    try {
      const values = Object.fromEntries(new FormData(form));
      const assignmentId = state.editingAssignmentId || values.assignmentId;
      const editing = Boolean(state.editingId);
      delete values.assignmentId;
      await api().saveTimetableMeeting(assignmentId, state.editingId, values);
      closeDialog(state);
      await load(state);
      showAppToast(editing ? 'Class meeting updated.' : 'Class meeting added.');
    } catch (error) {
      const message = error.message || 'The meeting could not be saved.';
      document.getElementById('timetable-error').textContent = message;
      showAppToast(message, 'error');
    } finally { submit.disabled = false; }
  }

  async function deleteMeeting(state) {
    if (!state.editingId || state.deletePending) return;
    state.deletePending = true;
    const button = document.getElementById('timetable-delete');
    const confirmButton = document.getElementById('timetable-delete-confirm');
    const cancelButton = document.getElementById('timetable-delete-cancel');
    const closeButton = document.getElementById('timetable-confirm-close');
    [button, confirmButton, cancelButton, closeButton].forEach(control => { control.disabled = true; });
    try {
      await api().deleteTimetableMeeting(state.editingId);
      state.deletePending = false;
      closeDeleteConfirmation(state, false, true);
      closeDialog(state);
      await load(state);
      showAppToast('Class meeting removed.');
    } catch (error) {
      state.deletePending = false;
      closeDeleteConfirmation(state, false, true);
      const message = error.message || 'The meeting could not be removed.';
      document.getElementById('timetable-error').textContent = message;
      showAppToast(message, 'error');
      button.disabled = false;
      button.focus();
    } finally {
      state.deletePending = false;
      [button, confirmButton, cancelButton, closeButton].forEach(control => { control.disabled = false; });
    }
  }

  async function load(state) {
    state.exportControl?.setAvailable(false);
    const yearId = document.getElementById('timetable-year').value;
    try {
      state.data = await api().getTimetable(yearId || undefined);
      if (state.data.year && (!state.week || state.week < weekMonday(state.data.year.startDate)
        || state.week > weekMonday(state.data.year.endDate))) {
        const now = today();
        state.week = weekMonday(now >= state.data.year.startDate && now <= state.data.year.endDate ? now : state.data.year.startDate);
      }
      document.getElementById('timetable-error-banner').hidden = true;
      document.getElementById('timetable-empty-year').hidden = Boolean(state.data.year);
      document.getElementById('timetable-board').hidden = !state.data.year;
      if (!state.data.year) return;
      renderFilters(state);
      if (state.role === 'admin') renderDialogSections(state);
      const add = document.getElementById('timetable-add');
      if (add) add.disabled = state.data.year.status === 'archived' || !state.data.assignments.some(item => item.sectionStatus === 'active');
      renderWeek(state);
      state.exportControl?.setAvailable(true);
    } catch (error) {
      const banner = document.getElementById('timetable-error-banner');
      banner.textContent = error.message || 'The timetable could not be loaded.';
      banner.hidden = false;
      document.getElementById('timetable-board').hidden = true;
    }
  }

  async function goToToday(state) {
    const currentDate = today();
    const currentYear = state.years.find(year => currentDate >= year.startDate && currentDate <= year.endDate);
    if (!currentYear) return;
    state.week = weekMonday(currentDate);
    const year = document.getElementById('timetable-year');
    if (year.value !== String(currentYear.id)) {
      year.value = String(currentYear.id);
      await load(state);
    } else renderWeek(state);
  }

  async function initPage(root) {
    const role = root.dataset.role;
    const state = { role, data: { year: null, assignments: [], meetings: [] }, years: [], week: null, editingId: null, deletePending: false };
    const year = document.getElementById('timetable-year');
    try {
      const currentUser = await api().getCurrentUser();
      if (currentUser?.role !== (role === 'admin' ? 'school_admin' : role)) {
        throw new Error(`This page is available only to ${role === 'admin' ? 'school administrators' : `${role}s`}.`);
      }
      const years = await api().getTimetableYears();
      state.years = years;
      year.replaceChildren(...years.map(item => new Option(`S.Y. ${item.label}`, String(item.id))));
      const active = years.find(item => item.status === 'active') || years[0];
      if (active) year.value = String(active.id);
    } catch (error) {
      const banner = document.getElementById('timetable-error-banner');
      banner.textContent = error.message || 'School years could not be loaded.';
      banner.hidden = false;
      return;
    }
    year.addEventListener('change', () => { state.week = null; load(state); });
    document.getElementById('timetable-prev').addEventListener('click', () => { state.week = addDays(state.week, -7); renderWeek(state); });
    document.getElementById('timetable-next').addEventListener('click', () => { state.week = addDays(state.week, 7); renderWeek(state); });
    document.getElementById('timetable-today').addEventListener('click', () => goToToday(state));
    if (role !== 'admin') {
      state.exportControl = window.AcademixTimetableExport?.init(() => exportWeek(state));
    }
    if (role === 'admin') {
      document.getElementById('timetable-dialog-section').addEventListener('change', event => {
        renderDialogSubjects(state, event.currentTarget.value);
      });
      document.getElementById('timetable-assignment').addEventListener('change', event => {
        const selected = state.data.assignments.find(item => String(item.assignmentId) === event.currentTarget.value);
        document.getElementById('timetable-assigned-teacher').value = selected?.teacherName || '';
      });
      document.getElementById('timetable-section').addEventListener('change', () => renderWeek(state));
      document.getElementById('timetable-teacher').addEventListener('change', () => renderWeek(state));
      document.getElementById('timetable-add').addEventListener('click', () => openDialog(state));
      document.getElementById('timetable-grid').addEventListener('click', event => {
        const button = event.target.closest('[data-meeting-id]');
        if (button) openDialog(state, '', state.data.meetings.find(item => String(item.id) === button.dataset.meetingId));
      });
      document.getElementById('timetable-unscheduled').addEventListener('click', event => {
        const button = event.target.closest('[data-assignment-id]');
        if (button) openDialog(state, button.dataset.assignmentId);
      });
      document.getElementById('timetable-form').addEventListener('submit', event => saveMeeting(state, event));
      document.getElementById('timetable-delete').addEventListener('click', () => openDeleteConfirmation(state));
      document.getElementById('timetable-delete-confirm').addEventListener('click', () => deleteMeeting(state));
      document.getElementById('timetable-delete-cancel').addEventListener('click', () => closeDeleteConfirmation(state));
      document.getElementById('timetable-confirm-close').addEventListener('click', () => closeDeleteConfirmation(state));
      document.getElementById('timetable-cancel').addEventListener('click', () => closeDialog(state));
      document.getElementById('timetable-close').addEventListener('click', () => closeDialog(state));
      document.getElementById('timetable-dialog-overlay').addEventListener('click', event => {
        if (event.target === event.currentTarget) closeDialog(state);
      });
      document.getElementById('timetable-confirm-overlay').addEventListener('click', event => {
        if (event.target === event.currentTarget) closeDeleteConfirmation(state);
      });
      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (!document.getElementById('timetable-confirm-overlay').hidden) closeDeleteConfirmation(state);
        else if (!document.getElementById('timetable-dialog-overlay').hidden) closeDialog(state);
      });
      document.getElementById('timetable-dialog').addEventListener('keydown', event => trapDialogTab(event, event.currentTarget));
      document.getElementById('timetable-confirm-dialog').addEventListener('keydown', event => trapDialogTab(event, event.currentTarget));
    }
    await load(state);
  }

  async function initPreview(preview) {
    const list = preview.querySelector('.timetable-preview-list');
    try {
      const expectedRole = window.location.pathname.includes('/views/teacher/') ? 'teacher' : 'student';
      const currentUser = await api().getCurrentUser();
      if (currentUser?.role !== expectedRole) { preview.hidden = true; return; }
      const data = await api().getTimetable();
      const now = today();
      const currentClock = new Date().toTimeString().slice(0, 5);
      const upcoming = [];
      for (let offset = 0; offset < 14 && upcoming.length < 3; offset += 1) {
        const date = addDays(now, offset);
        for (const meeting of data.meetings.filter(item => activeOn(item, date) && (date !== now || item.endTime > currentClock)).sort(byTime)) {
          upcoming.push({ ...meeting, date });
          if (upcoming.length === 3) break;
        }
      }
      list.innerHTML = upcoming.length ? upcoming.map(item =>
        `<div class="timetable-preview-item"><span><strong>${escape(item.subjectName)}</strong> · ${escape(item.sectionName)}</span>
         <span>${escape(shortDate(item.date))} · ${escape(timeLabel(item.startTime))}</span></div>`
      ).join('') : '<p class="timetable-empty-day">No classes scheduled in the next two weeks.</p>';
    } catch { list.textContent = 'Schedule unavailable right now.'; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('timetable-page');
    if (page) initPage(page);
    const preview = document.querySelector('.timetable-preview');
    if (preview) initPreview(preview);
  });
})();
