(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let data;
  let saving = false;
  const chosen = new Set();

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

  function isEligibleTechProImmersion(item) {
    return item.assessmentGroup === 'work_immersion' && item.trackCode === 'techpro'
      && item.catalogValid && item.catalogGradeEligible && item.catalogAvailableForNewUse;
  }

  function workImmersionStatus(placement, classes, selectedIds) {
    if (!requiresTechProImmersion(placement)) return { required: false, eligible: [], selected: [], satisfied: true };
    const eligible = classes.filter(isEligibleTechProImmersion);
    const selected = eligible.filter(item => selectedIds.has(Number(item.id)));
    return { required: true, eligible, selected,
      satisfied: selected.length === 1 && !selected[0].unavailableReason };
  }

  function availableHours(item) {
    const grade = Number(String(item.gradeCode || '').replace(/^grade-/, ''));
    const unit = item.hoursUnitByGrade?.[grade] || item.hoursUnit || 'unverified';
    const period = unit === 'per_year' ? ' per school year' : unit === 'per_term' ? ' per term'
      : unit === 'two_terms' ? ' over two terms' : ' (period not verified)';
    return `${Number(item.instructionalHours)} hours${period}`;
  }

  function sameMeeting(leftMeetings, rightMeetings) {
    return leftMeetings.some(left => rightMeetings.some(right => {
      if (Number(left.weekday) !== Number(right.weekday) || left.startTime >= right.endTime || left.endTime <= right.startTime) return false;
      const start = left.startDate > right.startDate ? left.startDate : right.startDate;
      const end = left.endDate < right.endDate ? left.endDate : right.endDate;
      if (start > end) return false;
      const date = new Date(`${start}T00:00:00Z`);
      const first = date.getTime() + ((Number(left.weekday) - (date.getUTCDay() || 7) + 7) % 7) * 86400000;
      return first <= new Date(`${end}T00:00:00Z`).getTime();
    }));
  }

  function statusDetails(selection, displayedChoiceCount = 0) {
    if (!selection) return {
      label: 'Not recorded', badge: 'badge-gray',
      detail: 'No choices saved yet. Select classes below to send your choices to school staff.'
    };
    const classIds = Array.isArray(selection.classIds) ? selection.classIds : [];
    const hasNoSubmittedChoices = ['pending', 'rejected', 'not_recorded', ''].includes(selection.status)
      && classIds.length === 0;
    if (hasNoSubmittedChoices) return {
      label: 'Not recorded', badge: 'badge-gray',
      detail: 'No choices saved. Select classes below to submit new choices for confirmation.'
    };
    const hasUnshownSavedChoices = classIds.length > 0 && displayedChoiceCount !== classIds.length;
    if (selection.dataIssue || hasUnshownSavedChoices) return {
      label: 'Choice record needs school review', badge: 'badge-red',
      detail: selection.status === 'approved' && !classIds.length
        ? 'This confirmed request has no saved classes linked. Contact school staff to review it.'
        : 'Some saved classes could not be matched to this school year. Contact school staff to review the request.'
    };
    if (selection.status === 'approved') return {
      label: 'Confirmed by your school', badge: 'badge-green',
      detail: ''
    };
    if (selection.status === 'rejected') return {
      label: 'Changes requested', badge: 'badge-red',
      detail: `Update your choices and save them again.${selection.decisionReason ? ` Note from school: ${selection.decisionReason}` : ''}`
    };
    if (selection.status === 'not_recorded') return {
      label: 'Not recorded', badge: 'badge-gray',
      detail: 'No choices saved. Select classes below to submit new choices for confirmation.'
    };
    if (selection.status === 'pending' && displayedChoiceCount > 0) return {
      label: 'Waiting for school confirmation', badge: 'badge-orange',
      detail: ''
    };
    return {
      label: 'Choice record needs school review', badge: 'badge-red',
      detail: 'This choice record could not be matched to saved classes. Contact school staff to review it.'
    };
  }

  function choiceGuidance(selection, status, hasSavedChoices, archived) {
    const parts = [];
    const needsReview = status.label === 'Choice record needs school review';
    if (archived) {
      if (hasSavedChoices && needsReview) parts.push(status.detail);
      if (selection?.status === 'rejected' && selection.decisionReason) parts.push(`Note from school: ${selection.decisionReason}`);
      if (hasSavedChoices) parts.push('This school year is closed. Choices are read-only.');
      return parts.filter(Boolean).join(' ');
    }
    if (needsReview) {
      if (!hasSavedChoices) {
        return selection?.status === 'rejected' && selection.decisionReason
          ? `Note from school: ${selection.decisionReason}` : '';
      }
      return selection?.status === 'rejected' && selection.decisionReason
        ? `${status.detail} Note from school: ${selection.decisionReason}` : status.detail;
    }
    if (selection?.status === 'rejected') return status.detail;
    if (selection?.status === 'approved' && hasSavedChoices) {
      return 'These choices are confirmed. Newly added classes can appear here, but school staff must add or change your confirmed choices.';
    }
    return '';
  }

  function resolveSavedChoiceDisplay(selection, classes) {
    const rawClassIds = Array.isArray(selection?.classIds) ? selection.classIds : [];
    const classIds = [...new Set(rawClassIds.map(Number).filter(classId => Number.isSafeInteger(classId) && classId > 0))];
    const savedClassRows = Array.isArray(selection?.savedClasses) ? selection.savedClasses : [];
    const savedById = new Map(savedClassRows.map(item => [Number(item.id), item]));
    const availableById = new Map(classes.map(item => [Number(item.id), item]));
    const savedChoices = classIds.map(classId => savedById.get(classId) || availableById.get(classId)).filter(Boolean);
    const resolvedIds = new Set(savedChoices.map(item => Number(item.id)));
    const hasUnresolvedLinks = rawClassIds.length !== classIds.length || classIds.some(classId => !resolvedIds.has(classId));
    const emptySubmittedRequest = ['pending', 'rejected', 'not_recorded', ''].includes(selection?.status)
      && rawClassIds.length === 0;

    return {
      selection: selection && {
        ...selection,
        classIds,
        status: emptySubmittedRequest ? 'not_recorded' : selection.status,
        dataIssue: emptySubmittedRequest ? false : Boolean(selection.dataIssue
          || hasUnresolvedLinks || (selection.status === 'approved' && rawClassIds.length === 0))
      },
      savedChoices
    };
  }

  function classDetails(item) {
    const meetings = (item.meetings || []).map(meeting =>
      `${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][meeting.weekday]} ${meeting.startTime}-${meeting.endTime}${meeting.room ? ` · ${meeting.room}` : ''}`
    ).join(', ');
    return `<strong>${escape(item.subjectName)}</strong><span class="shs-saved-choice-meta">${escape(item.className)} &middot; ${escape(item.teacherName)}</span><small class="shs-saved-choice-schedule">${escape(meetings || 'Schedule not set yet')}</small>`;
  }

  function savedChoicesEmptyState(selection, status, archived) {
    const linkedClassCount = Array.isArray(selection?.classIds) ? selection.classIds.length : 0;
    if (status.label === 'Choice record needs school review') {
      const hasLinkedClasses = linkedClassCount > 0;
      const title = hasLinkedClasses ? 'Saved classes unavailable' : 'Choice record needs school review';
      let text = hasLinkedClasses
        ? 'Saved classes could not be displayed. Contact school staff to review this record.'
        : selection?.status === 'approved'
          ? 'This confirmed request has no saved classes linked. Contact school staff to review it.'
          : 'This choice record could not be matched to saved classes. Contact school staff to review it.';
      if (archived) text += ' This school year is closed; choices are read-only.';
      return window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'triangle-alert', title, text });
    }
    if (archived) return window.EDUGNAY_CONFIG.renderPanelEmptyState({
      icon: 'bookmark', title: 'No saved choices for this school year',
      text: 'This school year is closed. Choices are read-only.'
    });
    return window.EDUGNAY_CONFIG.renderPanelEmptyState({
      icon: 'bookmark', title: 'No choices saved yet',
      text: 'Select classes below to send your choices for school confirmation.'
    });
  }

  function restoreSavedChoices() {
    chosen.clear();
    const availableIds = new Set(data.classes.map(item => Number(item.id)));
    (Array.isArray(data.selection?.classIds) ? data.selection.classIds : []).forEach(classId => {
      if (availableIds.has(Number(classId))) chosen.add(Number(classId));
    });
  }

  function render() {
    const savedChoiceDisplay = resolveSavedChoiceDisplay(data.selection, data.classes);
    const displaySelection = savedChoiceDisplay.selection;
    const grade = data.placement.gradeCode.replace('grade-', '');
    const confirmed = data.selection?.status === 'approved';
    const archived = data.placement.yearStatus !== 'active';
    const readOnly = confirmed || archived;
    const selected = data.classes.filter(item => chosen.has(Number(item.id)));
    const placementContext = `${data.placement.sectionName} · Grade ${grade} · ${data.placement.trackCode === 'academic' ? 'Academic' : 'TechPro'} track · Choose electives agreed on with your school.`;
    $('elective-overview-context').textContent = placementContext;
    const savedChoices = savedChoiceDisplay.savedChoices;
    const status = statusDetails(displaySelection, savedChoices.length);
    const hasSavedChoices = savedChoices.length > 0;
    const savedChoiceMarkup = hasSavedChoices ? savedChoices.map(item =>
      `<article class="shs-saved-choice">${classDetails(item)}${item.unavailableReason ? `<small class="shs-choice-reason">${escape(item.unavailableReason)}</small>` : ''}</article>`
    ).join('') : savedChoicesEmptyState(displaySelection, status, archived);
    $('elective-saved-choices').innerHTML = savedChoiceMarkup;
    $('elective-selection-state').hidden = !hasSavedChoices;
    $('elective-status').className = `badge ${status.badge}`;
    $('elective-status').textContent = status.label;
    const guidanceNote = $('elective-guidance-note');
    guidanceNote.textContent = choiceGuidance(displaySelection, status, hasSavedChoices, archived);
    guidanceNote.hidden = !guidanceNote.textContent;
    $('elective-summary').textContent = `${selected.length} selected`;
    const immersion = workImmersionStatus(data.placement, data.classes, chosen);
    const requirementNote = $('elective-requirement-note');
    requirementNote.hidden = !immersion.required;
    if (immersion.required) {
      requirementNote.textContent = !immersion.eligible.length
        ? 'Grade 12 TechPro students must choose Work Immersion. Your school has not offered an eligible class yet; ask school staff to add one before saving.'
        : immersion.selected.length > 1
          ? 'Choose exactly one available Work Immersion class before saving your choices.'
          : immersion.selected.length === 1 && !immersion.satisfied
            ? 'Your selected Work Immersion class is unavailable. Choose an available class or ask school staff to make one available.'
            : immersion.satisfied
              ? 'Work Immersion is required for Grade 12 TechPro and is included in your selection.'
              : 'Choose exactly one available Work Immersion class before saving your choices.';
    }
    $('elective-submit').disabled = readOnly || saving || !selected.length || !immersion.satisfied;
    $('elective-submit').textContent = 'Save my choices';

    $('elective-classes').innerHTML = data.classes.map(item => {
      const checked = chosen.has(Number(item.id));
      const otherChoices = selected.filter(other => Number(other.id) !== Number(item.id));
      const duplicate = otherChoices.some(other => other.catalogCode === item.catalogCode);
      const conflicts = otherChoices.some(other => sameMeeting(item.meetings || [], other.meetings || []));
      const reason = item.unavailableReason || (duplicate ? 'This subject is already selected.'
        : conflicts ? 'This class overlaps another selected class.' : '');
      const seatsLeft = Math.max(0, Number(item.capacity) - Number(item.enrolledCount));
      const meetings = (item.meetings || []).map(meeting =>
        `${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][meeting.weekday]} ${meeting.startTime}\u2013${meeting.endTime}${meeting.room ? ` \u00b7 ${meeting.room}` : ''}`
      ).join(', ') || 'Schedule not set yet';
      return `<label class="sf-template-choice shs-choice ${reason ? 'shs-choice-unavailable' : ''}">
        <input type="checkbox" value="${Number(item.id)}" ${checked ? 'checked' : ''}
          ${readOnly || (!checked && reason) ? 'disabled' : ''}>
        <span class="shs-choice-copy">
          <span class="shs-choice-head"><strong>${escape(item.subjectName)}</strong><span class="badge badge-gray shs-choice-seats">${seatsLeft} seats left</span></span>
          <small class="shs-choice-category">${escape(catalogGroupLabel(item.catalogGroup))}${item.clusterName ? ` &middot; ${escape(item.clusterName)}` : ''}${immersion.required && isEligibleTechProImmersion(item) ? ' &middot; Required' : ''}</small>
          <small class="shs-choice-hours">${escape(availableHours(item))}</small>
          <span class="shs-choice-meta">${escape(item.className)} &middot; ${escape(item.teacherName)}</span>
          <span class="shs-choice-schedule"><i data-lucide="calendar-days" aria-hidden="true"></i><span>${escape(meetings)}</span></span>
          ${reason ? `<small class="shs-choice-reason">${escape(reason)}</small>` : ''}
        </span></label>`;
    }).join('') || window.EDUGNAY_CONFIG.renderPanelEmptyState({
      icon: 'calendar-x', title: 'No elective classes yet', text: 'Your school has not added elective classes for this grade and year.'
    });
    window.lucide?.createIcons();
  }

  async function init() {
    try {
      const user = await window.EDUGNAY_API.getCurrentUser();
      if (user?.role !== 'student') throw new Error('This page is for students.');
      data = await window.EDUGNAY_API.getShsSelection();
      $('elective-unavailable').hidden = true;
      $('elective-content').hidden = false;
      restoreSavedChoices();
      render();
      $('elective-classes').addEventListener('change', event => {
        if (!event.target.matches('input[type="checkbox"]')) return;
        const classId = Number(event.target.value);
        if (event.target.checked) chosen.add(classId); else chosen.delete(classId);
        $('elective-error').textContent = '';
        render();
        $('elective-classes').querySelector(`input[type="checkbox"][value="${classId}"]`)?.focus();
      });
      $('elective-submit').addEventListener('click', async () => {
        if (!chosen.size || saving || !workImmersionStatus(data.placement, data.classes, chosen).satisfied) return;
        saving = true;
        $('elective-error').textContent = '';
        render();
        try {
          const saveResult = await window.EDUGNAY_API.submitShsSelection({ classIds: [...chosen] });
          data = await window.EDUGNAY_API.getShsSelection();
          chosen.clear();
          restoreSavedChoices();
          render();
          showAppToast(saveResult?.unchanged ? 'Your choices are already up to date.' : 'Your choices were sent for school confirmation.');
        } catch (error) {
          $('elective-error').textContent = error.message || 'Your choices could not be saved.';
        } finally {
          saving = false;
          render();
        }
      });
    } catch (error) {
      $('elective-content').hidden = true;
      $('elective-unavailable').textContent = error.message || 'Elective choices are not available.';
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
