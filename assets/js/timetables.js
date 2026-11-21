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
  const fullDate = value => dateAtUtc(value).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  const isIsoDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const parsed = dateAtUtc(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  function dateRangeLabel(startDate, endDate) {
    const startYear = startDate.slice(0, 4);
    const endYear = endDate.slice(0, 4);
    return startYear === endYear
      ? `${shortDate(startDate)}–${fullDate(endDate)}`
      : `${fullDate(startDate)}–${fullDate(endDate)}`;
  }
  function assignedTermsLabel(item) {
    return item.startTermName === item.endTermName
      ? item.startTermName
      : `${item.startTermName}–${item.endTermName}`;
  }
  const timeLabel = value => { const [hour, minute] = String(value || '').split(':').map(Number); return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`; };
  const activeOn = (meeting, date) => meeting.weekday === weekday(date) && date >= meeting.startDate && date <= meeting.endDate;
  const displaySubjectName = item => item.communicationComponentName || item.subjectName;
  const byTime = (a, b) => a.startTime.localeCompare(b.startTime) || displaySubjectName(a).localeCompare(displaySubjectName(b));
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
    for (const item of state.data.electiveClasses || []) teachers.set(item.teacherId, item.teacherName);
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
    for (const item of assignments) names.set(displaySubjectName(item), (names.get(displaySubjectName(item)) || 0) + 1);
    assignmentSelect.replaceChildren(new Option('Choose a subject', ''), ...assignments.map(item =>
      new Option(names.get(displaySubjectName(item)) > 1 ? `${displaySubjectName(item)} (${item.teacherName})` : displaySubjectName(item), String(item.assignmentId))));
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
    const content = `<strong class="timetable-event-subject">${escape(displaySubjectName(item))}</strong>
      <span class="timetable-event-time">${escape(time)}</span>
      ${classDetails}
      ${details.map(detail => `<span class="timetable-event-meta">${escape(detail)}</span>`).join('')}`;
    const label = [displaySubjectName(item), time, ...(state.role === 'student' ? [] : [item.gradeName, item.sectionName]), ...details].join(', ');
    return state.role === 'admin' && state.data.year?.status !== 'archived'
      ? `<button class="timetable-event" type="button" data-meeting-id="${item.id}" aria-label="Edit ${escape(label)}" aria-describedby="timetable-drag-help">${content}</button>`
      : `<div class="timetable-event">${content}</div>`;
  }

  function renderWeek(state) {
    state.cancelDrag?.();
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
      return `<section class="timetable-day${isToday ? ' today' : ''}" data-weekday="${index + 1}" aria-label="${day}, ${shortDate(date)}${isToday ? ', today' : ''}">
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
            subject: displaySubjectName(item),
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
    const used = new Set(state.data.meetings.map(item => item.assignmentId).filter(Boolean));
    const items = state.data.assignments.filter(item => !used.has(item.assignmentId)
      && (!sectionId || String(item.sectionId) === sectionId)
      && (!teacherId || String(item.teacherId) === teacherId));
    const scheduledElectives = new Set(state.data.meetings.map(item => item.electiveClassId).filter(Boolean));
    const electives = (state.data.electiveClasses || []).filter(item => !scheduledElectives.has(item.electiveClassId)
      && !sectionId && (!teacherId || String(item.teacherId) === teacherId));
    document.getElementById('timetable-unscheduled-count').textContent = `${items.length + electives.length} unscheduled`;
    document.getElementById('timetable-unscheduled').innerHTML = items.length + electives.length ? items.map(item =>
      `<div class="timetable-unscheduled-item"><div><strong>${escape(displaySubjectName(item))}</strong>
       <span>${escape(item.gradeName)} · ${escape(item.sectionName)} · ${escape(item.teacherName)}</span></div>
       ${state.data.year?.status !== 'archived' && item.sectionStatus === 'active'
        ? `<button class="timetable-button secondary" type="button" data-assignment-id="${item.assignmentId}">Schedule</button>` : ''}</div>`
    ).join('') + electives.map(item => `<div class="timetable-unscheduled-item"><div><strong>${escape(item.subjectName)}</strong>
      <span>${escape(item.gradeName)} · ${escape(item.className)} · ${escape(item.teacherName)}</span></div>
      ${state.data.year?.status !== 'archived' && item.classActive && item.offeringActive
        ? `<button class="timetable-button secondary" type="button" data-elective-class-id="${item.electiveClassId}">Schedule</button>` : ''}</div>`).join('')
      : window.EDUGNAY_CONFIG.renderPanelEmptyState({
      icon: 'calendar-check',
      title: 'All subjects are scheduled',
      text: 'Every subject assignment matching these filters already has a meeting.'
    });
  }

  function selectOwnerType(state, type, classId = '') {
    const elective = type === 'elective';
    document.getElementById('timetable-owner-type').value = type;
    document.getElementById('timetable-section-fields').hidden = elective;
    document.getElementById('timetable-teacher-field').hidden = elective;
    document.getElementById('timetable-elective-field').hidden = !elective;
    document.getElementById('timetable-dialog-section').required = !elective;
    const subject = document.getElementById('timetable-assignment');
    subject.required = !elective;
    subject.disabled = elective || !document.getElementById('timetable-dialog-section').value || Boolean(state.editingId);
    const select = document.getElementById('timetable-elective-class');
    select.replaceChildren(new Option('Choose an elective class', ''), ...(state.data.electiveClasses || [])
      .filter(item => item.classActive && item.offeringActive || String(item.electiveClassId) === String(classId))
      .map(item => new Option(`${item.gradeName} · ${item.subjectName} · ${item.className} (${item.teacherName})`, String(item.electiveClassId))));
    select.value = String(classId || '');
    select.required = elective;
    select.disabled = !elective || Boolean(state.editingId);
    updateElectiveTermSummary(state);
  }

  function updateElectiveTermSummary(state) {
    const dateRow = document.getElementById('timetable-date-fields');
    const summary = document.getElementById('timetable-elective-term-summary');
    const summaryRange = document.getElementById('timetable-elective-term-range');
    const summaryNote = document.getElementById('timetable-elective-term-note');
    const startDate = document.getElementById('timetable-start-date');
    const endDate = document.getElementById('timetable-end-date');
    const save = document.getElementById('timetable-save');
    const isElective = document.getElementById('timetable-owner-type').value === 'elective';
    if (!isElective) {
      dateRow.hidden = false;
      summary.hidden = true;
      startDate.disabled = endDate.disabled = false;
      startDate.required = endDate.required = true;
      save.disabled = false;
      return;
    }

    dateRow.hidden = true;
    summary.hidden = false;
    startDate.disabled = endDate.disabled = true;
    startDate.required = endDate.required = false;
    const classId = document.getElementById('timetable-elective-class').value;
    const elective = (state.data.electiveClasses || []).find(item => String(item.electiveClassId) === String(classId));
    const startSequence = Number(elective?.startTermSequence);
    const endSequence = Number(elective?.endTermSequence);
    const validRange = elective && Number(elective.startTermId) > 0 && Number(elective.endTermId) > 0
      && Number.isInteger(startSequence) && startSequence > 0
      && Number.isInteger(endSequence) && endSequence >= startSequence
      && elective.startTermName && elective.endTermName
      && isIsoDate(elective.firstTermStartDate) && isIsoDate(elective.lastTermEndDate)
      && isIsoDate(state.data.year?.startDate) && isIsoDate(state.data.year?.endDate)
      && state.data.year.startDate <= state.data.year.endDate
      && elective.firstTermStartDate >= state.data.year.startDate
      && elective.lastTermEndDate <= state.data.year.endDate
      && elective.firstTermStartDate <= elective.lastTermEndDate;
    if (!validRange) {
      summaryRange.textContent = '';
      summaryNote.textContent = elective
        ? 'This class has no valid assigned term dates. Review its term assignment before scheduling.'
        : 'Choose an SHS class to view its assigned term dates.';
      save.disabled = true;
      return;
    }

    const assignedRangeText = `${assignedTermsLabel(elective)} · ${dateRangeLabel(elective.firstTermStartDate, elective.lastTermEndDate)}`;
    summaryRange.textContent = assignedRangeText;
    const savedMeeting = state.editingMeeting;
    if (savedMeeting) {
      const savedDatesValid = isIsoDate(savedMeeting.startDate)
        && isIsoDate(savedMeeting.endDate)
        && savedMeeting.startDate <= savedMeeting.endDate
        && savedMeeting.startDate >= elective.firstTermStartDate
        && savedMeeting.endDate <= elective.lastTermEndDate;
      summaryNote.textContent = savedDatesValid
        ? `This meeting will keep its saved dates: ${dateRangeLabel(savedMeeting.startDate, savedMeeting.endDate)}.`
        : 'The saved meeting dates are outside this class term. Review the class term before saving.';
      save.disabled = !savedDatesValid;
      return;
    }
    summaryNote.textContent = 'New meetings will cover the full term.';
    save.disabled = false;
  }

  function openDialog(state, assignmentId = '', meeting = null, electiveClassId = '') {
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
    for (const option of form.querySelectorAll('input[name="weekdays"]')) {
      option.checked = Boolean(meeting && Number(option.value) === Number(meeting.weekday));
      option.disabled = option.checked && Boolean(meeting);
    }
    document.getElementById('timetable-weekdays-note').hidden = !meeting;
    form.elements.startTime.value = meeting?.startTime || '';
    form.elements.endTime.value = meeting?.endTime || '';
    form.elements.startDate.value = meeting?.startDate || state.data.year.startDate;
    form.elements.endDate.value = meeting?.endDate || state.data.year.endDate;
    form.elements.room.value = meeting?.room || '';
    form.elements.startDate.min = form.elements.endDate.min = state.data.year.startDate;
    form.elements.startDate.max = form.elements.endDate.max = state.data.year.endDate;
    state.editingId = meeting?.id || null;
    state.editingMeeting = meeting;
    state.editingAssignmentId = meeting?.assignmentId || null;
    state.editingElectiveClassId = meeting?.electiveClassId || null;
    selectOwnerType(state, meeting?.electiveClassId || electiveClassId ? 'elective' : 'section', meeting?.electiveClassId || electiveClassId);
    document.getElementById('timetable-owner-type').disabled = Boolean(meeting);
    document.getElementById('timetable-dialog-title').textContent = meeting ? 'Edit class meeting' : 'Add class meeting';
    document.getElementById('timetable-delete').hidden = !meeting;
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
    const selectedDays = [...form.querySelectorAll('input[name="weekdays"]:checked')].map(option => Number(option.value));
    if (!selectedDays.length) {
      showAppToast('Choose at least one day.', 'error');
      form.querySelector('input[name="weekdays"]')?.focus();
      return;
    }
    const submit = document.getElementById('timetable-save');
    submit.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      const elective = document.getElementById('timetable-owner-type').value === 'elective';
      const assignmentId = state.editingAssignmentId || values.assignmentId;
      const electiveClassId = state.editingElectiveClassId || document.getElementById('timetable-elective-class').value;
      const editing = Boolean(state.editingId);
      delete values.assignmentId;
      delete values.weekdays;
      if (editing) {
        values.weekday = Number(state.editingMeeting.weekday);
        values.copyToWeekdays = selectedDays.filter(day => day !== Number(state.editingMeeting.weekday));
      } else values.weekdays = selectedDays;
      if (elective) await api().saveElectiveTimetableMeeting(electiveClassId, state.editingId, values);
      else await api().saveTimetableMeeting(assignmentId, state.editingId, values);
      closeDialog(state);
      await load(state);
      const added = editing ? values.copyToWeekdays.length : selectedDays.length;
      showAppToast(editing
        ? added ? `Class meeting updated and ${added} ${added === 1 ? 'day' : 'days'} added.` : 'Class meeting updated.'
        : `${added} class ${added === 1 ? 'meeting' : 'meetings'} added.`);
    } catch (error) {
      const message = error.message || 'The meeting could not be saved.';
      showAppToast(message, 'error');
    } finally {
      submit.disabled = false;
      updateElectiveTermSummary(state);
    }
  }

  async function moveMeeting(state, meeting, destinationDay) {
    if (state.movePending || !meeting || Number(meeting.weekday) === destinationDay || state.data.year?.status === 'archived') return;
    state.movePending = true;
    const values = {
      weekday: destinationDay, startTime: meeting.startTime, endTime: meeting.endTime,
      startDate: meeting.startDate, endDate: meeting.endDate, room: meeting.room || ''
    };
    try {
      if (meeting.electiveClassId) await api().saveElectiveTimetableMeeting(meeting.electiveClassId, meeting.id, values);
      else await api().saveTimetableMeeting(meeting.assignmentId, meeting.id, values);
      await load(state);
      document.querySelector(`#timetable-grid [data-meeting-id="${meeting.id}"]`)?.focus();
      showAppToast(`Class meeting moved to ${days[destinationDay - 1]}.`);
    } catch (error) {
      showAppToast(error.message || 'The meeting could not be moved.', 'error');
    } finally {
      state.movePending = false;
    }
  }

  function initMeetingDrag(state) {
    const grid = document.getElementById('timetable-grid');
    const status = document.getElementById('timetable-drag-status');
    let active = null;
    let pointerCandidate = null;
    let touchCandidate = null;
    let keyboardDrag = false;
    let suppressClick = false;
    const announce = message => { status.textContent = message; };
    const cardAt = target => target.closest?.('[data-meeting-id]');
    const touchById = (touches, id) => [...touches].find(touch => touch.identifier === id);

    function clearDrag() {
      if (touchCandidate?.timer) clearTimeout(touchCandidate.timer);
      touchCandidate = null;
      pointerCandidate = null;
      grid.querySelector('.is-drop-target')?.classList.remove('is-drop-target');
      active?.preview?.remove();
      active?.button.classList.remove('is-dragging');
      grid.classList.remove('is-dragging');
      active = null;
      keyboardDrag = false;
      status.textContent = '';
    }

    function positionPreview(x, y) {
      if (!active?.preview) return;
      const left = Math.max(8, Math.min(x - active.offsetX, window.innerWidth - active.width - 8));
      const top = Math.max(8, Math.min(y - active.offsetY, window.innerHeight - active.height - 8));
      active.preview.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    }

    function beginDrag(button, x, y, isTouch = false) {
      if (active || state.movePending || state.data.year?.status === 'archived' || !grid.contains(button)) return false;
      const meeting = state.data.meetings.find(item => String(item.id) === button.dataset.meetingId);
      if (!meeting) return false;
      active = { button, meeting, targetDay: null };
      if (x !== undefined && y !== undefined) {
        const rect = button.getBoundingClientRect();
        const preview = button.cloneNode(true);
        preview.classList.add('timetable-drag-preview');
        preview.removeAttribute('data-meeting-id');
        preview.removeAttribute('aria-describedby');
        preview.setAttribute('aria-hidden', 'true');
        preview.tabIndex = -1;
        preview.inert = true;
        preview.style.width = `${rect.width}px`;
        preview.style.height = `${rect.height}px`;
        document.body.appendChild(preview);
        Object.assign(active, {
          preview, width: rect.width, height: rect.height,
          offsetX: x - rect.left, offsetY: isTouch ? rect.height + 24 : y - rect.top
        });
        positionPreview(x, y);
      }
      button.classList.add('is-dragging');
      grid.classList.add('is-dragging');
      announce(`Moving ${displaySubjectName(meeting)}. Choose another day.`);
      return true;
    }

    function setTarget(day) {
      if (!active) return;
      grid.querySelector('.is-drop-target')?.classList.remove('is-drop-target');
      active.targetDay = day && day !== Number(active.meeting.weekday) ? day : null;
      if (active.targetDay) {
        grid.querySelector(`.timetable-day[data-weekday="${active.targetDay}"]`)?.classList.add('is-drop-target');
        announce(`Move ${displaySubjectName(active.meeting)} to ${days[active.targetDay - 1]}.`);
      } else announce('Original day selected. Choose another day or press Escape.');
    }

    function targetAt(x, y) {
      const day = document.elementFromPoint(x, y)?.closest?.('.timetable-day[data-weekday]');
      return day && grid.contains(day) ? Number(day.dataset.weekday) : null;
    }

    function suppressEditClick() {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }

    function finishDrag() {
      const meeting = active?.meeting;
      const destinationDay = active?.targetDay;
      clearDrag();
      if (destinationDay) moveMeeting(state, meeting, destinationDay);
      else announce('Move canceled.');
    }

    state.cancelDrag = clearDrag;
    grid.addEventListener('click', event => {
      if (suppressClick || state.movePending || keyboardDrag) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    grid.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch' || event.button !== 0 || active || state.movePending) return;
      const button = cardAt(event.target);
      if (button && grid.contains(button)) pointerCandidate = { id: event.pointerId, button, x: event.clientX, y: event.clientY };
    });
    document.addEventListener('pointermove', event => {
      if (!pointerCandidate || event.pointerId !== pointerCandidate.id) return;
      if (!active && Math.hypot(event.clientX - pointerCandidate.x, event.clientY - pointerCandidate.y) >= 6) beginDrag(pointerCandidate.button, pointerCandidate.x, pointerCandidate.y);
      if (active) { event.preventDefault(); positionPreview(event.clientX, event.clientY); setTarget(targetAt(event.clientX, event.clientY)); }
    });
    document.addEventListener('pointerup', event => {
      if (!pointerCandidate || event.pointerId !== pointerCandidate.id) return;
      pointerCandidate = null;
      if (active) { suppressEditClick(); finishDrag(); }
    });
    document.addEventListener('pointercancel', event => {
      if (pointerCandidate?.id === event.pointerId) { clearDrag(); announce('Move canceled.'); }
    });
    grid.addEventListener('touchstart', event => {
      if (event.touches.length !== 1 || active || state.movePending) return;
      const button = cardAt(event.target);
      if (!button || !grid.contains(button)) return;
      const touch = event.touches[0];
      touchCandidate = { id: touch.identifier, button, x: touch.clientX, y: touch.clientY };
      touchCandidate.timer = setTimeout(() => {
        if (touchCandidate) beginDrag(touchCandidate.button, touchCandidate.x, touchCandidate.y, true);
      }, 350);
    }, { passive: true });
    grid.addEventListener('touchmove', event => {
      if (!touchCandidate) return;
      const touch = touchById(event.touches, touchCandidate.id);
      if (!touch) return;
      if (!active && Math.hypot(touch.clientX - touchCandidate.x, touch.clientY - touchCandidate.y) >= 10) {
        clearTimeout(touchCandidate.timer);
        touchCandidate = null;
      } else if (active) {
        event.preventDefault();
        positionPreview(touch.clientX, touch.clientY);
        setTarget(targetAt(touch.clientX, touch.clientY));
      }
    }, { passive: false });
    grid.addEventListener('touchend', event => {
      if (!touchCandidate || !touchById(event.changedTouches, touchCandidate.id)) return;
      if (active) { event.preventDefault(); suppressEditClick(); finishDrag(); }
      else { clearTimeout(touchCandidate.timer); touchCandidate = null; }
    });
    grid.addEventListener('touchcancel', () => { clearDrag(); announce('Move canceled.'); });
    grid.addEventListener('keydown', event => {
      const button = cardAt(event.target);
      if (!keyboardDrag) {
        if (button && (event.key === ' ' || event.key === 'Spacebar') && beginDrag(button)) {
          event.preventDefault();
          keyboardDrag = true;
          active.targetDay = Number(active.meeting.weekday);
          announce(`Moving ${displaySubjectName(active.meeting)}. Use Left or Right, then Enter. Escape cancels.`);
        }
        return;
      }
      if (event.key === 'Escape') { event.preventDefault(); clearDrag(); announce('Move canceled.'); return; }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const current = active.targetDay || Number(active.meeting.weekday);
        const next = (current - 1 + (event.key === 'ArrowRight' ? 1 : 6)) % 7 + 1;
        active.targetDay = next;
        setTarget(next);
      } else if (event.key === 'Enter') { event.preventDefault(); suppressEditClick(); finishDrag(); }
    });
    grid.addEventListener('focusout', event => {
      if (keyboardDrag && event.target === active?.button) { clearDrag(); announce('Move canceled.'); }
    });
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
      if (add) add.disabled = state.data.year.status === 'archived' || !(state.data.assignments.some(item => item.sectionStatus === 'active')
        || (state.data.electiveClasses || []).some(item => item.classActive && item.offeringActive));
      renderWeek(state);
      const requestedClass = new URLSearchParams(window.location?.search || '').get('electiveClassId');
      if (state.role === 'admin' && requestedClass && !state.handledClassLink
        && state.data.electiveClasses?.some(item => String(item.electiveClassId) === requestedClass)) {
        state.handledClassLink = true;
        openDialog(state, '', null, requestedClass);
      }
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
      const requestedYear = role === 'admin' ? new URLSearchParams(window.location?.search || '').get('academicYearId') : null;
      if (requestedYear && years.some(item => String(item.id) === requestedYear)) year.value = requestedYear;
      else if (active) year.value = String(active.id);
    } catch (error) {
      const banner = document.getElementById('timetable-error-banner');
      banner.textContent = error.message || 'School years could not be loaded.';
      banner.hidden = false;
      window.EDUGNAY_PAGE_LOADING.ready();
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
      initMeetingDrag(state);
      document.getElementById('timetable-owner-type').addEventListener('change', event => selectOwnerType(state, event.target.value));
      document.getElementById('timetable-elective-class').addEventListener('change', () => updateElectiveTermSummary(state));
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
        const electiveButton = event.target.closest('[data-elective-class-id]');
        if (electiveButton) openDialog(state, '', null, electiveButton.dataset.electiveClassId);
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
    window.EDUGNAY_PAGE_LOADING.ready();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const page = document.getElementById('timetable-page');
    if (page) await initPage(page);
  });
})();
