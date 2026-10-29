(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const api = () => window.EDUGNAY_API;
  const state = { data: null, mode: '', offeringId: null, classId: null, returnFocus: null, previousOverflow: '',
    deleteClassId: null, deleteClassName: '', deleteReturnFocus: null, deletePreviousOverflow: '',
    reviewPage: 1, reviewData: null, reviewSearchTimer: null, choiceStudentId: null, choiceStatus: '', choiceRequestId: null,
    choiceData: null, choiceReturnFocus: null, choicePreviousOverflow: '', activeTab: 'subjects', catalogCodes: new Set() };

  function catalogGroupLabel(group) {
    return ({
      academic_electives: 'Academic elective',
      field_experience: 'Field Experience (Academic)',
      techpro_electives: 'TechPro elective',
      techpro_work_immersion: 'TechPro Work Immersion'
    })[group] || 'Approved subject';
  }

  function requiresTechProImmersion(placement) {
    return placement?.gradeCode === 'grade-12' && placement?.trackCode === 'techpro';
  }

  function isTechProImmersion(item) {
    return item.assessmentGroup === 'work_immersion' && item.trackCode === 'techpro';
  }

  function eligibleTechProImmersion(item) {
    return isTechProImmersion(item) && item.catalogValid && item.catalogGradeEligible && item.catalogAvailableForNewUse;
  }

  function workImmersionStatus(placement, classes, selectedIds) {
    if (!requiresTechProImmersion(placement)) return { required: false, eligible: [], selected: [], satisfied: true };
    const eligible = classes.filter(eligibleTechProImmersion);
    const selected = classes.filter(item => isTechProImmersion(item) && selectedIds.has(Number(item.id)));
    const selectedEligible = selected.filter(item => eligibleTechProImmersion(item) && !item.unavailableReason);
    return { required: true, eligible, selected, satisfied: selected.length === 1 && selectedEligible.length === 1 };
  }

  function catalogHoursLabel(item, gradeCode) {
    const grade = Number(String(gradeCode || '').replace(/^grade-/, ''));
    const unit = item?.hoursUnitByGrade?.[grade] || item?.hoursUnit || 'unverified';
    const hours = Number(item?.instructionalHours ?? item?.hours ?? 0);
    if (unit === 'per_year') return `${hours} hours per school year`;
    if (unit === 'per_term') return `${hours} hours per term`;
    if (unit === 'two_terms') return `${hours} hours over two terms`;
    return `${hours} hours; period not verified`;
  }

  function setOptions(select, items, label, value, text) {
    const old = select.value;
    select.replaceChildren(new Option(label, ''), ...items.map(item => new Option(text(item), String(value(item)))));
    if ([...select.options].some(item => item.value === old)) select.value = old;
  }

  function visibleOfferings() {
    const gradeId = $('shs-grade').value;
    const track = $('shs-track').value;
    return state.data.offerings.filter(item => (!gradeId || String(item.gradeLevelId) === gradeId)
      && (!track || item.trackCode === track));
  }

  function render() {
    const data = state.data;
    const archived = data.year?.status === 'archived';
    $('shs-activate').disabled = archived || !data.year || !data.grades.length || !data.tracks.length;
    const offerings = visibleOfferings();
    $('shs-offerings').innerHTML = offerings.length ? offerings.map(item => {
      const classes = data.classes.filter(c => Number(c.offeringId) === Number(item.id));
      const active = Boolean(item.isActive);
      const catalogEntry = data.catalog.find(entry => entry.code === item.catalogCode);
      const catalogReview = !item.catalogValid
        ? '<small class="shs-track-review">Subject details do not match the current DepEd list. Existing records were kept; please review before using this subject for new choices.</small>'
        : !item.catalogGradeEligible
          ? '<small class="shs-track-review">This subject is not listed for this grade in the current DepEd catalog. Existing classes and records were kept for review.</small>'
          : !item.catalogAvailableForNewUse
            ? `<small class="shs-track-review">Not available for new classes or choices while its DepEd grade, track, category, or hours are being checked. Existing records are unchanged. ${escape(item.catalogVerificationNote || '')}</small>` : '';
      return `<article class="shs-offering">
        <div class="shs-offering-head"><div><strong>${escape(item.subjectName)}</strong><span>${escape(catalogGroupLabel(catalogEntry?.catalogGroup))} · ${escape(catalogEntry?.clusterName || 'Needs catalog review')} · Grade ${escape(item.gradeCode.replace('grade-', ''))} · ${escape(catalogEntry?.trackLabel || item.trackCode)} · ${escape(catalogHoursLabel(catalogEntry, item.gradeCode))}</span></div>
          <span class="badge ${active ? 'badge-green' : 'badge-gray'}">${active ? 'Active' : 'Paused'}</span></div>${catalogReview}
        <div class="shs-class-list">${classes.length ? classes.map(c => {
          const reason = !c.catalogValid ? 'Subject setup needs review' : !c.catalogGradeEligible ? 'Grade setup needs review'
            : !c.catalogAvailableForNewUse ? 'Waiting for DepEd source review' : !active ? 'Subject paused' : !c.classActive ? 'Class paused'
            : !c.teacherActive ? 'Teacher inactive' : Number(c.capacity) <= Number(c.enrolledCount) ? 'No seats'
            : !Number(c.meetingCount) ? 'No meeting scheduled' : '';
          const reviewCount = Number(c.trackReviewCount) || 0;
          const trackReview = reviewCount ? `<small class="shs-track-review">Review needed: ${reviewCount} active learner${reviewCount === 1 ? '' : 's'} may be enrolled in Work Immersion for the other track. Their enrollment has not been changed.</small>` : '';
          const classActive = Boolean(c.classActive);
          return `<div class="shs-class"><div class="shs-class-copy"><strong>${escape(c.className)}</strong><span>${escape(c.teacherName)} · ${c.enrolledCount}/${c.capacity} seats · ${c.meetingCount} meetings</span>
            <small>${reason ? escape(reason) : 'Scheduled and available'}</small>${trackReview}</div><div class="shs-class-menu">
            <button class="shs-class-menu-trigger" id="shs-class-menu-trigger-${c.id}" type="button" data-class-menu-toggle="${c.id}" aria-label="Actions for ${escape(c.className)}" aria-haspopup="menu" aria-expanded="false" aria-controls="shs-class-menu-${c.id}"><i data-lucide="more-vertical" aria-hidden="true"></i></button>
            <div class="shs-class-action-menu" id="shs-class-menu-${c.id}" role="menu" aria-labelledby="shs-class-menu-trigger-${c.id}">
              <button class="shs-class-menu-item" type="button" role="menuitem" data-edit-class="${c.id}" ${archived ? 'disabled' : ''}><i data-lucide="pencil" aria-hidden="true"></i>Edit class</button>
              <a class="shs-class-menu-item" role="menuitem" data-schedule-class="${c.id}" href="edugnay-admin-timetables.html?academicYearId=${data.year.id}&amp;electiveClassId=${c.id}"><i data-lucide="calendar-days" aria-hidden="true"></i>Schedule</a>
              <button class="shs-class-menu-item" type="button" role="menuitem" data-toggle-class="${c.id}" ${archived ? 'disabled' : ''}><i data-lucide="${classActive ? 'pause' : 'play'}" aria-hidden="true"></i>${classActive ? 'Pause class' : 'Reactivate class'}</button>
              <button class="shs-class-menu-item delete" type="button" role="menuitem" data-delete-class="${c.id}" ${archived ? 'disabled' : ''}><i data-lucide="trash-2" aria-hidden="true"></i>Delete class</button>
            </div></div></div>`;
        }).join('') : '<p class="shs-muted">No classes yet. Add a class, assign a teacher, and schedule its meetings.</p>'}</div>
        <div class="shs-offering-actions"><button class="timetable-button" type="button" data-add-class="${item.id}" ${archived || !active || !item.catalogAvailableForNewUse ? 'disabled' : ''}>Add class</button>
          <button class="timetable-button secondary" type="button" data-toggle="${item.id}" ${archived || (!active && !item.catalogAvailableForNewUse) ? 'disabled' : ''}>${active ? 'Pause subject' : 'Reactivate subject'}</button></div>
      </article>`;
    }).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'book-open', title: 'No subject classes yet', text: 'Add an approved subject to start setting up SHS classes.' });
    window.lucide?.createIcons();
  }

  function closeClassMenus(restoreFocus = false) {
    const openTrigger = $('shs-offerings').querySelector('.shs-class-menu-trigger[aria-expanded="true"]');
    $('shs-offerings').querySelectorAll('.shs-class-action-menu.open').forEach(menu => menu.classList.remove('open'));
    $('shs-offerings').querySelectorAll('.shs-class-menu-trigger[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    if (restoreFocus) openTrigger?.focus();
  }

  function toggleClassMenu(trigger, focusFirst = false) {
    const isOpen = trigger.getAttribute('aria-expanded') === 'true';
    closeClassMenus();
    if (isOpen) return;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.closest('.shs-class-menu')?.querySelector('.shs-class-action-menu')?.classList.add('open');
    if (focusFirst) trigger.closest('.shs-class-menu')?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
  }

  function openDeleteClass(classId, trigger) {
    const item = state.data?.classes.find(row => Number(row.id) === Number(classId));
    if (!item || state.data.year?.status === 'archived') return;
    closeClassMenus();
    state.deleteClassId = Number(classId);
    state.deleteClassName = item.className;
    state.deleteReturnFocus = trigger;
    state.deletePreviousOverflow = document.body.style.overflow;
    $('shs-delete-message').textContent = `Delete “${item.className}”? This permanently removes the class only when it has no linked timetable, learner, or learning records. Classes with records are kept and can be paused instead.`;
    $('shs-delete-error').textContent = '';
    $('shs-delete-confirm').disabled = false;
    $('shs-delete-overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    $('shs-delete-title').focus();
  }

  function closeDeleteClass({ restoreFocus = true } = {}) {
    $('shs-delete-overlay').hidden = true;
    document.body.style.overflow = state.deletePreviousOverflow;
    const returnFocus = state.deleteReturnFocus;
    state.deleteReturnFocus = null;
    if (restoreFocus) returnFocus?.focus?.();
    state.deleteClassId = null;
    state.deleteClassName = '';
  }

  async function confirmDeleteClass() {
    if (!state.deleteClassId) return;
    const button = $('shs-delete-confirm');
    button.disabled = true;
    $('shs-delete-error').textContent = '';
    try {
      await api().deleteShsClass(state.deleteClassId);
      const yearId = state.data.year.id;
      closeDeleteClass({ restoreFocus: false });
      await load(yearId);
      const nextFocus = $('shs-offerings').querySelector('.shs-class-menu-trigger')
        || $('shs-offerings').querySelector('[data-add-class]');
      nextFocus?.focus();
      showAppToast('Class deleted.');
    } catch (error) {
      $('shs-delete-error').textContent = error.message || 'The class could not be deleted. Its records have been kept.';
      button.disabled = false;
    }
  }

  function choiceStatusLabel(status, dataIssue = false) {
    if (dataIssue) return 'Choice record needs review';
    return ({ not_recorded: 'Not recorded', pending: 'Waiting for school confirmation', approved: 'Confirmed by school', rejected: 'Changes requested' })[status] || 'Not recorded';
  }

  function renderReviews(result) {
    const archived = result.year?.status === 'archived';
    $('shs-reviews').innerHTML = result.students.length ? result.students.map(item => {
      const grade = item.gradeCode.replace('grade-', '');
      const dataIssue = Boolean(item.dataIssue);
      const badge = dataIssue ? 'badge-red' : item.status === 'approved' ? 'badge-green' : item.status === 'rejected' ? 'badge-gold'
        : item.status === 'pending' ? 'badge-blue' : 'badge-gray';
      const note = dataIssue ? '<p class="shs-review-problem">This confirmed request has no saved class links. Existing class placements were left unchanged; review the record before editing.</p>'
        : item.status === 'rejected' && item.note ? `<p class="shs-review-problem">Note: ${escape(item.note)}</p>` : '';
      return `<article class="shs-review"><div class="shs-review-head"><div><strong>${escape(item.studentName)}</strong>
        <span>Grade ${grade} · ${escape(item.sectionName)} · ${item.trackCode === 'academic' ? 'Academic' : 'TechPro'}</span></div>
        <span class="badge ${badge}">${choiceStatusLabel(item.status, dataIssue)}</span></div>
        ${note}<div class="shs-roster-actions"><button class="timetable-button secondary" type="button" data-manage-choices="${item.studentId}" ${archived ? 'disabled' : ''}>${dataIssue ? 'Review record' : item.status === 'approved' ? 'Edit confirmed choices' : item.status === 'not_recorded' ? 'Record choices' : item.status === 'rejected' ? 'Correct choices' : 'Review choices'}</button>
          ${archived ? '<span class="shs-muted-inline">Archived school years are read-only.</span>' : ''}</div></article>`;
    }).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({
      icon: 'users-round', title: 'No learners found', text: 'Active Grade 11 and Grade 12 learners for this school year will appear here.'
    });
    const first = result.total ? (result.page - 1) * result.pageSize + 1 : 0;
    const last = Math.min(result.page * result.pageSize, result.total);
    $('shs-roster-page').textContent = `${first}–${last} of ${result.total} learners`;
    $('shs-roster-prev').disabled = result.page <= 1;
    $('shs-roster-next').disabled = result.page >= result.pages;
    window.lucide?.createIcons();
  }

  async function loadReviews(yearId, page = 1) {
    if (!yearId) {
      $('shs-selection-panel').hidden = false;
      $('shs-reviews').innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: 'calendar', title: 'Choose a school year', text: 'Select a school year to view student choices.'
      });
      $('shs-roster-controls').hidden = true;
      $('shs-roster-pagination').hidden = true;
      return;
    }
    try {
      const result = await api().getShsSelectionStudents({
        academicYearId: yearId, page, pageSize: 25, search: $('shs-student-search').value.trim(),
        grade: $('shs-student-grade').value, status: $('shs-student-status').value
      });
      state.reviewData = result;
      state.reviewPage = result.page;
      $('shs-selection-panel').hidden = false;
      $('shs-roster-controls').hidden = false;
      $('shs-roster-pagination').hidden = false;
      renderReviews(result);
    } catch (error) {
      $('shs-selection-panel').hidden = false;
      const unavailable = /not available/i.test(error.message || '');
      $('shs-reviews').innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: unavailable ? 'lock-keyhole' : 'triangle-alert',
        title: unavailable ? 'Student choices are unavailable' : 'Student choices could not be loaded',
        text: unavailable ? 'Elective choices are not available right now.' : (error.message || 'Try again later.')
      });
      $('shs-roster-controls').hidden = true;
      $('shs-roster-pagination').hidden = true;
    }
  }

  function activateTab(name, moveFocus = false) {
    state.activeTab = name;
    const tabs = [...document.querySelectorAll('[data-shs-tab]')];
    tabs.forEach(tab => {
      const selected = tab.dataset.shsTab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.classList.toggle('active', selected);
      tab.tabIndex = selected ? 0 : -1;
      if (selected && moveFocus) tab.focus();
    });
    $('shs-panel-subjects').hidden = name !== 'subjects';
    $('shs-panel-choices').hidden = name !== 'choices';
  }

  function updateChoiceControls(selectedValues = selectedChoiceIds()) {
    const result = state.choiceData;
    if (!result) return;
    const selectedIds = new Set(selectedValues);
    const dataIssue = Boolean(result.selection?.dataIssue);
    const readOnly = !result.canEdit || dataIssue;
    const immersion = workImmersionStatus(result.placement, result.classes || [], selectedIds);
    const hasChoices = selectedIds.size > 0;
    const pending = state.choiceStatus === 'pending';
    $('shs-choice-save').hidden = pending;
    $('shs-choice-save').disabled = pending || readOnly || !hasChoices || !immersion.satisfied;
    $('shs-choice-clear').hidden = readOnly || result.selection?.status !== 'approved';
    const showHelp = dataIssue || (immersion.required && !immersion.satisfied) || (!readOnly && !hasChoices);
    $('shs-choice-empty-help').hidden = !showHelp;
    $('shs-choice-empty-help').textContent = dataIssue
      ? 'This choice record needs staff review. Saving, confirming, and clearing are disabled.'
      : immersion.required && !immersion.eligible.length
        ? 'Grade 12 TechPro requires one Work Immersion class. No eligible class is offered; school staff need to add one before choices can be saved or confirmed.'
        : immersion.required && immersion.selected.length > 1
          ? 'Select exactly one eligible Work Immersion class before saving or confirming choices.'
          : immersion.required && immersion.selected.length === 1 && !immersion.satisfied
            ? 'The selected Work Immersion class is unavailable. Select an available class or ask staff to make one available.'
            : immersion.required && !immersion.satisfied
              ? 'Select one eligible Work Immersion class before saving or confirming choices.'
              : result.selection?.status === 'approved'
                ? 'Select at least one class to save changes, or use Clear all choices below.'
                : pending ? 'Select at least one class to confirm choices.' : 'Select at least one class to save choices.';
    const canReview = pending && result.canEdit && !dataIssue;
    $('shs-choice-review-actions').hidden = !canReview;
    $('shs-choice-confirm').hidden = !canReview;
    $('shs-choice-return').hidden = !canReview;
    $('shs-choice-confirm').disabled = !canReview || !hasChoices || !immersion.satisfied;
    $('shs-choice-return').disabled = !canReview || !$('shs-choice-decision-note').value.trim();
  }

  function renderChoiceClasses() {
    const result = state.choiceData;
    if (!result) return;
    const selectedIds = new Set(result.selection?.classIds.map(Number) || []);
    const dataIssue = Boolean(result.selection?.dataIssue);
    const readOnly = !result.canEdit || dataIssue;
    $('shs-choice-classes').innerHTML = result.classes.map(item => {
      const checked = selectedIds.has(Number(item.id));
      const meetings = (item.meetings || []).map(meeting =>
        `${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][meeting.weekday]} ${meeting.startTime}–${meeting.endTime}${meeting.room ? ` · ${meeting.room}` : ''}`
      ).join(', ');
      const seats = Math.max(0, Number(item.capacity) - Number(item.enrolledCount));
      const required = requiresTechProImmersion(result.placement) && eligibleTechProImmersion(item);
      return `<label class="sf-template-choice shs-choice shs-review-choice ${item.unavailableReason ? 'is-unavailable' : ''}">
        <input type="checkbox" value="${Number(item.id)}" ${checked ? 'checked' : ''} ${readOnly || (!checked && item.unavailableReason) ? 'disabled' : ''}>
        <span><strong>${escape(item.subjectName)}</strong><small class="shs-choice-category">${escape(catalogGroupLabel(item.catalogGroup))}${required ? ' · Required' : ''}</small><small>${escape(item.className)} · ${escape(item.teacherName)} · ${escape(catalogHoursLabel(item, item.gradeCode))} · ${seats} seats left</small>
          <small>${escape(meetings || 'Schedule not set yet')}</small>${item.unavailableReason ? `<small class="shs-choice-reason">${escape(item.unavailableReason)}</small>` : ''}</span>
      </label>`;
    }).join('') || window.EDUGNAY_CONFIG.renderPanelEmptyState({
      icon: 'book-open', title: 'No classes to choose from', text: 'No elective classes are listed for this learner’s grade and school year.'
    });
    updateChoiceControls([...selectedIds]);
  }

  function setChoiceDialogCopy(status, selection) {
    const dataIssue = Boolean(selection?.dataIssue);
    $('shs-choice-title').textContent = dataIssue ? 'Choice record needs review' : status === 'approved' ? 'Edit confirmed choices'
      : status === 'rejected' ? 'Correct learner choices' : status === 'pending' ? 'Review learner choices' : 'Record learner choices';
    const requiresImmersion = requiresTechProImmersion(state.choiceData?.placement);
    const baseInstructions = dataIssue
      ? status === 'approved' && !selection?.classIds?.length
        ? 'This confirmed request has no saved class links. Existing class placements were left unchanged. Saving and clearing are disabled until the record is reviewed.'
        : 'One or more saved classes could not be matched to this school year. Saving and confirmation are disabled until the record is reviewed.'
      : status === 'approved'
      ? 'Update the classes confirmed for this learner. Saving changes updates their class placements immediately.'
      : status === 'pending' ? 'Review the learner’s choices, then confirm them or ask for a correction.'
        : 'Select the classes the learner chose with the school. Saving sends them for school confirmation.';
    $('shs-choice-instructions').textContent = `${baseInstructions}${requiresImmersion
      ? ' Grade 12 TechPro choices must include exactly one eligible Work Immersion class.' : ''}`;
    $('shs-choice-save').textContent = status === 'approved' ? 'Save changes'
      : status === 'rejected' ? 'Save corrected choices' : 'Save choices';
    $('shs-choice-save').hidden = status === 'pending';
  }

  async function openChoiceDialog(studentId) {
    const item = state.reviewData?.students.find(student => Number(student.studentId) === Number(studentId));
    if (!item) return;
    state.choiceStudentId = Number(studentId);
    state.choiceStatus = item.status;
    state.choiceRequestId = item.requestId;
    state.choiceData = null;
    state.choiceReturnFocus = document.activeElement;
    state.choicePreviousOverflow = document.body.style.overflow;
    setChoiceDialogCopy(item.status, item);
    $('shs-choice-subtitle').textContent = `${item.studentName || 'Learner'} · Grade ${item.gradeCode.replace('grade-', '')} · ${item.sectionName} · ${item.trackCode === 'academic' ? 'Academic' : 'TechPro'}`;
    $('shs-choice-classes').textContent = 'Loading classes…';
    $('shs-choice-error').textContent = '';
    $('shs-choice-decision-note').value = '';
    $('shs-choice-save').disabled = true;
    $('shs-choice-review-actions').hidden = true;
    $('shs-choice-confirm').hidden = true;
    $('shs-choice-return').hidden = true;
    $('shs-choice-return').disabled = true;
    $('shs-choice-confirm').disabled = true;
    $('shs-choice-overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    $('shs-choice-title').focus();
    try {
      state.choiceData = await api().getShsStudentChoices(studentId, state.data.year.id);
      state.choiceStatus = state.choiceData.selection?.status || 'not_recorded';
      state.choiceRequestId = state.choiceData.selection?.id || null;
      setChoiceDialogCopy(state.choiceStatus, state.choiceData.selection);
      renderChoiceClasses();
      window.lucide?.createIcons();
    } catch (error) { $('shs-choice-error').textContent = error.message || 'Classes could not be loaded.'; }
  }

  function closeChoiceDialog() {
    $('shs-choice-clear-overlay').hidden = true;
    $('shs-choice-overlay').inert = false;
    $('shs-choice-overlay').hidden = true;
    document.body.style.overflow = state.choicePreviousOverflow;
    state.choiceReturnFocus?.focus?.();
    state.choiceData = null;
    state.choiceStatus = '';
    state.choiceRequestId = null;
  }

  async function saveChoiceDialog() {
    if (!state.choiceData?.canEdit || state.choiceData.selection?.dataIssue) return;
    const classIds = [...$('shs-choice-classes').querySelectorAll('input[type="checkbox"]:checked')].map(input => Number(input.value));
    if (!classIds.length) return;
    const button = $('shs-choice-save');
    button.disabled = true;
    $('shs-choice-error').textContent = '';
    try {
      if (state.choiceData.selection?.status === 'approved') {
        await api().changeApprovedShsSelection(state.choiceData.selection.id, { classIds });
        showAppToast('Confirmed choices updated.');
      } else {
        await api().saveShsStudentChoices(state.choiceStudentId, state.data.year.id, classIds);
        showAppToast('Choices saved for school confirmation.');
      }
      closeChoiceDialog();
      await loadReviews(state.data.year.id, state.reviewPage);
    } catch (error) {
      $('shs-choice-error').textContent = error.message || 'Choices could not be saved.';
      button.disabled = false;
    }
  }

  function openClearChoiceDialog() {
    const selection = state.choiceData?.selection;
    if (!state.choiceData?.canEdit || selection?.status !== 'approved' || selection.dataIssue) return;
    const learner = state.reviewData?.students.find(item => Number(item.studentId) === state.choiceStudentId);
    const count = selection.classIds.length;
    $('shs-choice-clear-message').textContent = `Clear ${learner?.studentName || 'this learner'}’s ${count} confirmed class choice${count === 1 ? '' : 's'}? This withdraws the learner from those classes and marks their choices Not recorded. They can submit new choices for school confirmation. Past grade and activity records are kept.`;
    $('shs-choice-clear-error').textContent = '';
    $('shs-choice-clear-confirm').disabled = false;
    $('shs-choice-clear-overlay').hidden = false;
    $('shs-choice-overlay').inert = true;
    $('shs-choice-clear-title').focus();
    window.lucide?.createIcons();
  }

  function closeClearChoiceDialog(restoreFocus = true) {
    $('shs-choice-clear-overlay').hidden = true;
    $('shs-choice-overlay').inert = false;
    if (restoreFocus) $('shs-choice-clear').focus();
  }

  async function confirmClearChoices() {
    const selection = state.choiceData?.selection;
    if (!state.choiceData?.canEdit || selection?.status !== 'approved' || selection.dataIssue) return;
    const button = $('shs-choice-clear-confirm');
    button.disabled = true;
    $('shs-choice-clear-error').textContent = '';
    const studentId = state.choiceStudentId, yearId = state.data.year.id, page = state.reviewPage;
    try {
      await api().clearApprovedShsSelection(selection.id);
      closeClearChoiceDialog(false);
      closeChoiceDialog();
      await loadReviews(yearId, page);
      $('shs-reviews').querySelector(`[data-manage-choices="${studentId}"]`)?.focus();
      showAppToast('Confirmed choices cleared.');
    } catch (error) {
      $('shs-choice-clear-error').textContent = error.message || 'The choices could not be cleared.';
      button.disabled = false;
    }
  }

  function selectedChoiceIds() {
    return [...$('shs-choice-classes').querySelectorAll('input[type="checkbox"]:checked')]
      .map(input => Number(input.value)).sort((a, b) => a - b);
  }

  function choiceIdsChanged(classIds) {
    const saved = [...(state.choiceData?.selection?.classIds || [])].map(Number).sort((a, b) => a - b);
    return classIds.length !== saved.length || classIds.some((id, index) => id !== saved[index]);
  }

  async function decideChoice(decision) {
    if (!state.choiceData?.canEdit || state.choiceData.selection?.dataIssue
      || state.choiceStatus !== 'pending' || !state.choiceRequestId) return;
    const classIds = selectedChoiceIds();
    const reason = $('shs-choice-decision-note').value.trim();
    if (decision === 'approved' && !classIds.length) {
      $('shs-choice-error').textContent = 'Select at least one class before confirming these choices.';
      return;
    }
    if (decision === 'rejected' && !reason) {
      $('shs-choice-error').textContent = 'Add a note explaining what the learner should correct.';
      $('shs-choice-decision-note').focus();
      return;
    }
    const button = decision === 'approved' ? $('shs-choice-confirm') : $('shs-choice-return');
    button.disabled = true;
    $('shs-choice-error').textContent = '';
    try {
      if (choiceIdsChanged(classIds)) {
        await api().saveShsStudentChoices(state.choiceStudentId, state.data.year.id, classIds);
      }
      await api().decideShsSelection(state.choiceRequestId, { decision, ...(decision === 'rejected' ? { reason } : {}) });
      closeChoiceDialog();
      showAppToast(decision === 'approved' ? 'Choices confirmed.' : 'Choices returned with a note.');
      await loadReviews(state.data.year.id, state.reviewPage);
    } catch (error) {
      $('shs-choice-error').textContent = error.message || 'The choice update could not be saved.';
      try {
        state.choiceData = await api().getShsStudentChoices(state.choiceStudentId, state.data.year.id);
        renderChoiceClasses();
      } catch (_) { /* Keep the current dialog contents if the refresh also fails. */ }
      button.disabled = false;
    }
  }

  async function load(yearId) {
    try {
      state.data = await api().getShsProgram(yearId);
      setOptions($('shs-year'), state.data.years, 'Choose a school year', item => item.id, item => `S.Y. ${item.label}`);
      $('shs-year').value = String(state.data.year?.id || '');
      setOptions($('shs-grade'), state.data.grades, 'All grades', item => item.id, item => item.label);
      setOptions($('shs-track'), state.data.tracks, 'All tracks', item => item.code, item => item.label);
      $('shs-error').hidden = true;
      render();
      await loadReviews(state.data.year?.id);
    } catch (error) {
      $('shs-error').textContent = error.message || 'The SHS program could not be loaded.';
      $('shs-error').hidden = false;
    }
  }

  function open(mode, id = null) {
    state.mode = mode;
    state.offeringId = mode === 'class' ? id : null;
    state.classId = mode === 'edit' ? id : null;
    state.returnFocus = document.activeElement;
    state.previousOverflow = document.body.style.overflow;
    const form = $('shs-form'); form.reset();
    const isOffering = mode === 'offering';
    $('shs-offering-layout').hidden = !isOffering;
    $('shs-dialog').classList.toggle('shs-offering-dialog', isOffering);
    $('shs-class-offering-field').hidden = isOffering;
    document.querySelectorAll('.shs-class-field').forEach(field => { field.hidden = isOffering; });
    state.catalogCodes.clear();
    $('shs-catalog-search').value = '';
    $('shs-dialog-grade').required = isOffering;
    $('shs-class-name').required = !isOffering;
    $('shs-teacher').required = !isOffering;
    $('shs-capacity').required = !isOffering;
    if (isOffering) {
      setOptions($('shs-dialog-grade'), state.data.grades, 'Choose a grade', item => item.id, item => item.label);
      $('shs-dialog-grade').value = $('shs-grade').value;
      renderCatalogChoices();
      $('shs-dialog-title').textContent = 'Add approved subjects';
      $('shs-dialog-subtitle').textContent = 'Choose available subjects for this grade. Items needing source review are shown separately and cannot be added.';
    } else {
      const existing = mode === 'edit' ? state.data.classes.find(item => Number(item.id) === Number(id)) : null;
      const offering = state.data.offerings.find(item => Number(item.id) === Number(existing?.offeringId || id));
      $('shs-class-offering').value = offering?.subjectName || '';
      setOptions($('shs-teacher'), state.data.teachers, 'Choose a teacher', item => item.id, item => item.name);
      if (existing) {
        $('shs-class-name').value = existing.className;
        $('shs-teacher').value = String(existing.teacherId);
        $('shs-capacity').value = String(existing.capacity);
      }
      $('shs-dialog-title').textContent = existing ? 'Edit elective class' : 'Add elective class';
      $('shs-dialog-subtitle').textContent = 'Assign an active teacher and set the available seats.';
    }
    $('shs-dialog-error').textContent = '';
    $('shs-dialog-overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    $('shs-dialog-title').focus();
  }

  function renderCatalogChoices() {
    const grade = state.data.grades.find(item => String(item.id) === $('shs-dialog-grade').value);
    const track = $('shs-track').value;
    const available = state.data.catalog.filter(item => grade && item.grades.includes(Number(grade.code.replace('grade-', '')))
      && (!track || item.trackCode === track)
      && !state.data.offerings.some(o => o.gradeLevelId === Number(grade?.id) && o.catalogCode === item.code));
    const selectable = available.filter(item => item.verificationStatus === 'verified');
    state.catalogCodes = new Set([...state.catalogCodes].filter(code => selectable.some(item => item.code === code)));
    const query = $('shs-catalog-search').value.trim().toLowerCase();
    const filtered = available.filter(item => `${item.name} ${item.clusterName} ${item.trackLabel} ${item.grades.join(' ')} ${item.hours}`.toLowerCase().includes(query));
    const filteredSelectable = filtered.filter(item => item.verificationStatus === 'verified');
    const filteredPending = filtered.filter(item => item.verificationStatus !== 'verified');
    const groups = [
      { key: 'academic_electives', label: 'Academic electives' },
      { key: 'field_experience', label: 'Field Experience (Academic)' },
      { key: 'techpro_electives', label: 'TechPro electives' },
      { key: 'techpro_work_immersion', label: 'TechPro Work Immersion' }
    ];
    const renderChoice = item => `<label class="shs-catalog-choice"><input type="checkbox" value="${escape(item.code)}" ${state.catalogCodes.has(item.code) ? 'checked' : ''}><span><strong>${escape(item.name)} (${escape(catalogHoursLabel(item, grade.code))})</strong><small>${escape(item.trackLabel)} · Grade${item.grades.length === 1 ? '' : 's'} ${escape(item.grades.join(', '))}</small></span></label>`;
    const verifiedMarkup = filteredSelectable.length ? groups.map(group => {
      const items = filteredSelectable.filter(item => item.catalogGroup === group.key);
      if (!items.length) return '';
      const clusters = [...new Map(items.map(item => [item.clusterCode, item])).values()];
      const clusterMarkup = clusters.map(cluster => {
        const clusterItems = items.filter(item => item.clusterCode === cluster.clusterCode);
        return `<section class="shs-catalog-cluster"><h4 class="shs-catalog-cluster-title">${escape(cluster.clusterName)}</h4>${clusterItems.map(renderChoice).join('')}</section>`;
      }).join('');
      return `<section class="shs-catalog-group" aria-labelledby="shs-catalog-group-${group.key}"><h3 class="shs-catalog-group-title" id="shs-catalog-group-${group.key}">${group.label}</h3>${clusterMarkup}</section>`;
    }).join('') : '';
    const pendingMarkup = filteredPending.length ? `<section class="shs-catalog-pending" aria-labelledby="shs-catalog-pending-title">
      <h3 class="shs-catalog-group-title" id="shs-catalog-pending-title">Needs source review</h3>
      <p class="shs-catalog-pending-note">These entries are shown for transparency but cannot be added until their DepEd grade, track, category, and hours are confirmed.</p>
      ${filteredPending.map(item => `<div class="shs-catalog-choice is-unavailable" aria-disabled="true"><span>
        <strong>${escape(item.name)} (${escape(catalogHoursLabel(item, grade.code))})</strong>
        <small>${escape(catalogGroupLabel(item.catalogGroup))} · ${escape(item.trackLabel)} · Grade ${escape(grade.code.replace('grade-', ''))}</small>
        <small>${escape(item.verificationNote || 'Not available for new use until its source details are confirmed.')}</small>
      </span></div>`).join('')}
      </section>` : '';
    $('shs-catalog-choices').innerHTML = `${verifiedMarkup}${pendingMarkup}`
      || `<p class="shs-catalog-empty" role="status">${available.length ? 'No matching subjects.' : 'No available subjects for this grade.'}</p>`;
    $('shs-catalog-summary').textContent = `${state.catalogCodes.size} selected`;
  }

  function close() {
    $('shs-dialog-overlay').hidden = true;
    document.body.style.overflow = state.previousOverflow;
    state.returnFocus?.focus?.();
  }

  async function submit(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    if (state.mode === 'offering' && !state.catalogCodes.size) {
      $('shs-dialog-error').textContent = 'Choose at least one approved subject.';
      $('shs-catalog-search').focus();
      return;
    }
    const button = $('shs-save'); button.disabled = true;
    try {
      let message = 'SHS Program updated.';
      if (state.mode === 'offering') {
        const result = await api().activateShsOffering({ academicYearId: state.data.year.id, gradeLevelId: Number($('shs-dialog-grade').value), catalogCodes: [...state.catalogCodes] });
        message = `${result.added?.length || state.catalogCodes.size} approved subject${(result.added?.length || state.catalogCodes.size) === 1 ? '' : 's'} added.`;
      } else {
        const values = { className: $('shs-class-name').value, teacherId: Number($('shs-teacher').value), capacity: Number($('shs-capacity').value) };
        if (state.mode === 'edit') await api().updateShsClass(state.classId, values);
        else await api().createShsClass({ ...values, offeringId: state.offeringId });
      }
      close(); await load(state.data.year.id); showAppToast(message);
    } catch (error) { $('shs-dialog-error').textContent = error.message || 'The change could not be saved.'; }
    finally { button.disabled = false; }
  }

  async function init() {
    try {
      const user = await api().getCurrentUser();
      if (user?.role !== 'school_admin') throw new Error('Only school administrators can manage the SHS program.');
      await load();
    } catch (error) { $('shs-error').textContent = error.message; $('shs-error').hidden = false; return; }
    $('shs-year').addEventListener('change', event => load(event.target.value));
    document.querySelectorAll('[data-shs-tab]').forEach(tab => {
      tab.addEventListener('click', () => activateTab(tab.dataset.shsTab));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const tabs = [...document.querySelectorAll('[data-shs-tab]')];
        const current = tabs.indexOf(tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        activateTab(tabs[next].dataset.shsTab, true);
      });
    });
    activateTab(state.activeTab);
    $('shs-grade').addEventListener('change', render);
    $('shs-track').addEventListener('change', render);
    $('shs-activate').addEventListener('click', () => open('offering'));
    $('shs-student-search').addEventListener('input', () => {
      clearTimeout(state.reviewSearchTimer);
      state.reviewSearchTimer = setTimeout(() => loadReviews(state.data?.year?.id, 1), 250);
    });
    $('shs-student-grade').addEventListener('change', () => loadReviews(state.data?.year?.id, 1));
    $('shs-student-status').addEventListener('change', () => loadReviews(state.data?.year?.id, 1));
    $('shs-roster-prev').addEventListener('click', () => loadReviews(state.data?.year?.id, state.reviewPage - 1));
    $('shs-roster-next').addEventListener('click', () => loadReviews(state.data?.year?.id, state.reviewPage + 1));
    $('shs-reviews').addEventListener('click', async event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.dataset.manageChoices) { await openChoiceDialog(button.dataset.manageChoices); return; }
    });
    $('shs-choice-save').addEventListener('click', saveChoiceDialog);
    $('shs-choice-classes').addEventListener('change', () => {
      updateChoiceControls();
      $('shs-choice-error').textContent = '';
    });
    $('shs-choice-decision-note').addEventListener('input', () => {
      $('shs-choice-return').disabled = !$('shs-choice-decision-note').value.trim();
      $('shs-choice-error').textContent = '';
    });
    $('shs-choice-confirm').addEventListener('click', () => decideChoice('approved'));
    $('shs-choice-return').addEventListener('click', () => decideChoice('rejected'));
    $('shs-choice-close').addEventListener('click', closeChoiceDialog);
    $('shs-choice-cancel').addEventListener('click', closeChoiceDialog);
    $('shs-choice-clear').addEventListener('click', openClearChoiceDialog);
    $('shs-choice-clear-close').addEventListener('click', () => closeClearChoiceDialog());
    $('shs-choice-clear-cancel').addEventListener('click', () => closeClearChoiceDialog());
    $('shs-choice-clear-confirm').addEventListener('click', confirmClearChoices);
    $('shs-choice-clear-overlay').addEventListener('click', event => {
      if (event.target === event.currentTarget) closeClearChoiceDialog();
    });
    $('shs-choice-overlay').addEventListener('click', event => {
      if (event.target === event.currentTarget) closeChoiceDialog();
    });
    $('shs-offerings').addEventListener('click', async event => {
      const menuTrigger = event.target.closest('[data-class-menu-toggle]');
      if (menuTrigger) { toggleClassMenu(menuTrigger); return; }
      const button = event.target.closest('button'); if (!button) return;
      if (button.dataset.addClass) open('class', Number(button.dataset.addClass));
      else if (button.dataset.editClass) { closeClassMenus(); open('edit', Number(button.dataset.editClass)); }
      else if (button.dataset.toggleClass) {
        const item = state.data.classes.find(row => Number(row.id) === Number(button.dataset.toggleClass));
        if (!item) return;
        const nextActive = !Boolean(item.classActive);
        button.disabled = true;
        try {
          await api().updateShsClass(item.id, { isActive: nextActive });
          closeClassMenus();
          await load(state.data.year.id);
          showAppToast(nextActive ? 'Class reactivated.' : 'Class paused.');
        } catch (error) { showAppToast(error.message || 'The class could not be updated.', 'error'); button.disabled = false; }
      } else if (button.dataset.deleteClass) {
        const trigger = button.closest('.shs-class-menu')?.querySelector('.shs-class-menu-trigger');
        openDeleteClass(button.dataset.deleteClass, trigger);
      } else if (button.dataset.toggle) {
        const item = state.data.offerings.find(o => Number(o.id) === Number(button.dataset.toggle));
        button.disabled = true;
        try { await api().setShsOfferingActive(item.id, !item.isActive); await load(state.data.year.id); showAppToast('Subject updated.'); }
        catch (error) { showAppToast(error.message || 'The subject could not be updated.', 'error'); button.disabled = false; }
      }
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.shs-class-menu')) closeClassMenus();
    });
    $('shs-offerings').addEventListener('keydown', event => {
      const trigger = event.target.closest('[data-class-menu-toggle]');
      if (trigger && event.key === 'ArrowDown') {
        event.preventDefault();
        if (trigger.getAttribute('aria-expanded') !== 'true') toggleClassMenu(trigger, true);
        else trigger.closest('.shs-class-menu')?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
        return;
      }
      const menu = event.target.closest('.shs-class-action-menu.open');
      if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = [...menu.querySelectorAll('[role="menuitem"]:not([disabled])')];
      const current = items.indexOf(document.activeElement);
      if (!items.length) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items[next].focus();
    });
    $('shs-form').addEventListener('submit', submit);
    $('shs-dialog-grade').addEventListener('change', renderCatalogChoices);
    $('shs-catalog-search').addEventListener('input', renderCatalogChoices);
    $('shs-catalog-choices').addEventListener('change', event => {
      if (event.target.type !== 'checkbox') return;
      if (event.target.checked) state.catalogCodes.add(event.target.value);
      else state.catalogCodes.delete(event.target.value);
      $('shs-catalog-summary').textContent = `${state.catalogCodes.size} selected`;
      $('shs-dialog-error').textContent = '';
    });
    $('shs-catalog-clear').addEventListener('click', () => { state.catalogCodes.clear(); renderCatalogChoices(); });
    $('shs-close').addEventListener('click', close);
    $('shs-cancel').addEventListener('click', close);
    $('shs-dialog-overlay').addEventListener('click', event => { if (event.target === event.currentTarget) close(); });
    $('shs-delete-close').addEventListener('click', closeDeleteClass);
    $('shs-delete-cancel').addEventListener('click', closeDeleteClass);
    $('shs-delete-confirm').addEventListener('click', confirmDeleteClass);
    $('shs-delete-overlay').addEventListener('click', event => { if (event.target === event.currentTarget) closeDeleteClass(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (!$('shs-choice-clear-overlay').hidden) closeClearChoiceDialog();
        else if (!$('shs-choice-overlay').hidden) closeChoiceDialog();
        else if (!$('shs-delete-overlay').hidden) closeDeleteClass();
        else if (!$('shs-dialog-overlay').hidden) close();
        else closeClassMenus(true);
      }
    });
    $('shs-dialog-overlay').addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="-1"]')]
        .filter(item => !item.closest('[hidden]'));
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    $('shs-choice-overlay').addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="-1"]')]
        .filter(item => !item.closest('[hidden]'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    $('shs-choice-clear-overlay').addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll('button:not([disabled]), [tabindex="-1"]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    $('shs-delete-overlay').addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled]), a[href], textarea:not([disabled]), [tabindex="-1"]')]
        .filter(item => !item.closest('[hidden]'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    window.lucide?.createIcons();
  }
  document.addEventListener('DOMContentLoaded', () => { if ($('shs-program-page')) init(); });
})();
