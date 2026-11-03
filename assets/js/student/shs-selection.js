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

  function selectionRequirement(placement, selected, prior = []) {
    const grade = Number(String(placement.gradeCode).replace('grade-', ''));
    const count = type => selected.filter(item => item.subjectType === type).length;
    const hours = type => selected.filter(item => item.subjectType === type)
      .reduce((sum, item) => sum + Number(item.instructionalHours), 0);
    const total = selected.reduce((sum, item) => sum + Number(item.instructionalHours), 0);
    const priorAcademic = prior.filter(item => item.subjectType === 'academic_elective');
    const cross = placement.trackCode === 'academic' ? count('techpro_elective') > 0
      : count('academic_elective') > 0 || priorAcademic.length > 0;
    let guidance, valid;
    if (grade === 11 && placement.trackCode === 'academic') {
      guidance = 'Choose 3 Academic electives (240 hours), one in each term.';
      valid = selected.length === 3 && hours('academic_elective') === 240
        && selected.every(item => item.subjectType === 'academic_elective'
          && item.startTermSequence === item.endTermSequence)
        && selected.map(item => Number(item.startTermSequence)).sort().join(',') === '1,2,3';
    } else if (grade === 11) {
      guidance = 'Choose one 320-hour TechPro elective covering all three terms.';
      valid = count('techpro_elective') === 1 && hours('techpro_elective') === 320
        && (cross ? count('academic_elective') <= 4
          && selected.length === 1 + count('academic_elective')
          && selected.filter(item => item.subjectType === 'academic_elective')
            .every(item => Number(item.instructionalHours) === 80) : selected.length === 1);
    } else if (placement.trackCode === 'academic' && cross) {
      guidance = 'Choose 8 Academic electives (640 hours) and one 320-hour TechPro elective.';
      valid = selected.length === 9 && count('academic_elective') === 8
        && hours('academic_elective') === 640 && count('techpro_elective') === 1
        && hours('techpro_elective') === 320;
    } else if (placement.trackCode === 'academic') {
      guidance = 'Choose 9–12 Academic electives totaling 960 hours.';
      valid = selected.length >= 9 && selected.length <= 12 && total === 960
        && selected.length === count('academic_elective');
    } else if (cross) {
      guidance = 'Choose one 320-hour TechPro elective, 320-hour Work Immersion, and 4 Academic electives across Grades 11–12.';
      valid = count('techpro_elective') === 1 && hours('techpro_elective') === 320
        && count('work_immersion') === 1 && hours('work_immersion') === 320
        && count('academic_elective') + priorAcademic.length === 4
        && hours('academic_elective') + priorAcademic.reduce((sum, item) => sum + Number(item.instructionalHours), 0) === 320
        && selected.length === count('academic_elective') + 2;
    } else {
      guidance = 'Choose 1–2 TechPro electives and Work Immersion totaling 960 hours.';
      valid = count('techpro_elective') >= 1 && count('techpro_elective') <= 2
        && count('work_immersion') === 1 && selected.length === count('techpro_elective') + 1
        && total === 960;
    }
    return { guidance, valid, total };
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

  function termReviewRow(label) {
    return `<span class="shs-term-review-row"><i data-lucide="triangle-alert" aria-hidden="true"></i><span>${escape(label)}</span></span>`;
  }

  function classDetails(item) {
    const meetings = (item.meetings || []).map(meeting =>
      `${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][meeting.weekday]} ${meeting.startTime}-${meeting.endTime}${meeting.room ? ` · ${meeting.room}` : ''}`
    ).join(', ');
    const term = item.startTermName
      ? (item.startTermId === item.endTermId ? item.startTermName : `${item.startTermName}–${item.endTermName}`)
      : '';
    const details = `<span class="shs-saved-choice-meta">${escape(item.className)} &middot; ${escape(item.teacherName)}${term ? ` &middot; ${escape(term)}` : ''}</span>`;
    return `<strong>${escape(item.subjectName)}</strong>${details}<small class="shs-saved-choice-schedule">${escape(meetings || 'Schedule not set yet')}</small>`;
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
    const savedChoiceMarkup = hasSavedChoices ? savedChoices.map(item => {
      const termReview = item.startTermName ? '' : termReviewRow('Term review needed');
      const staffReview = item.unavailableReason === 'Class term needs staff review';
      const reason = item.unavailableReason
        ? staffReview ? termReviewRow(item.unavailableReason)
          : `<small class="shs-choice-reason">${escape(item.unavailableReason)}</small>`
        : '';
      return `<article class="shs-saved-choice">${classDetails(item)}${termReview}${reason}</article>`;
    }).join('') : savedChoicesEmptyState(displaySelection, status, archived);
    $('elective-saved-choices').innerHTML = savedChoiceMarkup;
    $('elective-selection-state').hidden = !hasSavedChoices;
    $('elective-status').className = `badge ${status.badge}`;
    $('elective-status').textContent = status.label;
    const guidanceNote = $('elective-guidance-note');
    guidanceNote.textContent = choiceGuidance(displaySelection, status, hasSavedChoices, archived);
    guidanceNote.hidden = !guidanceNote.textContent;
    const requirement = selectionRequirement(data.placement, selected, data.priorElectives || []);
    $('elective-summary').textContent = `${selected.length} selected · ${requirement.total} hours`;
    const immersion = workImmersionStatus(data.placement, data.classes, chosen);
    const requirementNote = $('elective-requirement-note');
    requirementNote.hidden = false;
    requirementNote.textContent = requirement.guidance;
    if (immersion.required && !immersion.satisfied) {
      requirementNote.textContent += ' ' + (!immersion.eligible.length
        ? 'Grade 12 TechPro students must choose Work Immersion. Your school has not offered an eligible class yet; ask school staff to add one before saving.'
        : immersion.selected.length > 1
          ? 'Choose exactly one available Work Immersion class before saving your choices.'
          : immersion.selected.length === 1 && !immersion.satisfied
            ? 'Your selected Work Immersion class is unavailable. Choose an available class or ask school staff to make one available.'
            : 'Choose exactly one available Work Immersion class before saving your choices.');
    }
    $('elective-submit').disabled = readOnly || saving || !requirement.valid || !immersion.satisfied
      || selected.some(item => !item.startTermId || !item.endTermId || item.unavailableReason);
    $('elective-submit').textContent = 'Save my choices';

    $('elective-classes').innerHTML = data.classes.map(item => {
      const checked = chosen.has(Number(item.id));
      const otherChoices = selected.filter(other => Number(other.id) !== Number(item.id));
      const duplicate = otherChoices.some(other => other.catalogCode === item.catalogCode);
      const conflicts = otherChoices.some(other => sameMeeting(item.meetings || [], other.meetings || []));
      const reason = item.unavailableReason || (duplicate ? 'This subject is already selected.'
        : conflicts ? 'This class overlaps another selected class.' : '');
      const termName = item.startTermName
        ? (item.startTermId === item.endTermId ? item.startTermName : `${item.startTermName}–${item.endTermName}`) : '';
      const termReview = termName ? '' : termReviewRow('Term review needed');
      const reasonMarkup = reason === 'Class term needs staff review'
        ? termReviewRow(reason)
        : reason ? `<small class="shs-choice-reason">${escape(reason)}</small>` : '';
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
          <small class="shs-choice-hours">${escape(availableHours(item))}${termName ? ` · ${escape(termName)}` : ''}</small>
          <span class="shs-choice-meta">${escape(item.className)} &middot; ${escape(item.teacherName)}</span>
          <span class="shs-choice-schedule"><i data-lucide="calendar-days" aria-hidden="true"></i><span>${escape(meetings)}</span></span>
          ${termReview}
          ${reasonMarkup}
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
      window.EDUGNAY_PAGE_LOADING.ready();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
