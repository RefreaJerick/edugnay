lucide.createIcons();

    /* ── MODALS ── */
    let pendingTeacherDelete = null;
    let teacherDeletePending = false;
    let teacherStudentDetailsTrigger = null;
    let teacherStudentDetailsRequestId = 0;
    let teacherStudentDetailsStudentId = '';
    let teacherStudentDetailsClassId = '';

    function openModal(id) {
      const modal = document.getElementById(id);
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    }
    function closeModal(id) {
      const modal = document.getElementById(id);
      if (id === 'teacherDeleteConfirmModal' && teacherDeletePending) return;
      if (id === 'uploadModal' && materialUploadInProgress) return;
      if (id === 'assignmentSubmissionPreviewModal') {
        if (assignmentPreviewState?.saving) return;
        if (assignmentPreviewHasUnsavedScore() && !window.confirm('Discard the unsaved score?')) return;
        assignmentPreviewRequestId += 1;
        if (assignmentPreviewObjectUrl) URL.revokeObjectURL(assignmentPreviewObjectUrl);
        assignmentPreviewObjectUrl = null;
        assignmentPreviewState = null;
        const previewFrame = document.getElementById('assignmentSubmissionPreviewFrame');
        previewFrame.removeAttribute('src');
        previewFrame.hidden = true;
      }
      if (id === 'qrAttendanceModal') {
        if (qrAttendanceSaving) return;
        stopQrScanner();
      }
      if (id === 'uploadModal') resetMaterialUploadForm();
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      if (id === 'teacherDeleteConfirmModal') pendingTeacherDelete = null;
      if (id === 'qrAttendanceModal') {
        window.setTimeout(() => qrAttendanceReturnFocus?.focus(), 0);
      }
    }
    document.querySelectorAll('.modal-backdrop').forEach(m => {
      m.addEventListener('click', e => {
        if (e.target !== m) return;
        if (m.id === 'teacherStudentDetailsModal') closeTeacherStudentDetailsModal();
        else closeModal(m.id);
      });
    });

    function closeTeacherStudentDetailsModal() {
      teacherStudentDetailsRequestId += 1;
      closeModal('teacherStudentDetailsModal');
      if (teacherStudentDetailsTrigger?.isConnected) teacherStudentDetailsTrigger.focus();
      teacherStudentDetailsTrigger = null;
      teacherStudentDetailsStudentId = '';
      teacherStudentDetailsClassId = '';
    }

    function renderTeacherStudentDetails(details) {
      const escapeHtml = window.EDUGNAY_CONFIG.escapeHtml;
      const student = details.student || {};
      const studentDetails = [
        ['Student number (LRN)', student.studentNumber],
        ['School email', student.schoolEmail],
        ['Grade level', student.gradeLevel],
        ['Section', student.sectionName],
        ['School year', student.schoolYear],
        ['Enrollment status', student.enrollmentStatus]
      ];
      const parents = details.parents || [];
      const parentCards = parents.length ? parents.map(parent => {
        const email = String(parent.email || '').trim();
        const phone = String(parent.contactNumber || '').trim();
        const emailMarkup = email
          ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`
          : 'Not available';
        const phoneHref = phone.replace(/[^\d+]/g, '');
        const phoneMarkup = phone
          ? `<a href="tel:${escapeHtml(phoneHref)}">${escapeHtml(phone)}</a>`
          : 'Not available';
        const relationship = String(parent.relationship || 'Guardian');
        return `<article class="teacher-student-guardian">
        <div class="teacher-student-guardian-head">
          <h4>${escapeHtml(parent.displayName || 'Parent or guardian')}</h4>
          <span class="teacher-student-guardian-tag">${escapeHtml(relationship.charAt(0).toUpperCase() + relationship.slice(1))}</span>
        </div>
        <dl class="teacher-student-contact-grid">
          <div><dt>Phone</dt><dd>${phoneMarkup}</dd></div>
          <div><dt>Email</dt><dd>${emailMarkup}</dd></div>
        </dl>
      </article>`;
      }).join('') : '<p class="teacher-student-details-empty">No parent or guardian is linked to this student.</p>';

      document.getElementById('teacherStudentDetailsTitle').textContent = student.displayName || 'Student details';
      document.getElementById('teacherStudentDetailsSub').textContent = [student.gradeLevel, student.sectionName, student.schoolYear]
        .filter(Boolean).join(' · ') || 'Student and parent or guardian contact information.';
      document.getElementById('teacherStudentDetailsBody').innerHTML = `
      <section class="teacher-student-details-section" aria-labelledby="teacherStudentIdentityHeading">
        <h3 id="teacherStudentIdentityHeading">Student information</h3>
        <dl class="teacher-student-details-grid">${studentDetails.map(([label, value]) => `
          <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || 'Not available')}</dd></div>`).join('')}
        </dl>
      </section>
      <section class="teacher-student-details-section" aria-labelledby="teacherStudentGuardiansHeading">
        <h3 id="teacherStudentGuardiansHeading">Parents and guardians</h3>
        <div class="teacher-student-guardian-list">${parentCards}</div>
      </section>`;
      if (window.lucide) window.lucide.createIcons();
    }

    async function loadTeacherStudentDetails() {
      const studentId = teacherStudentDetailsStudentId;
      const requestId = ++teacherStudentDetailsRequestId;
      const body = document.getElementById('teacherStudentDetailsBody');
      body.innerHTML = '';

      try {
        const details = teacherStudentDetailsClassId
          ? await window.EDUGNAY_API.getShsElectiveStudentDetails(teacherStudentDetailsClassId, studentId)
          : await window.EDUGNAY_API.getSectionStudentDetails(CURRENT_SECTION_ID, studentId);
        if (requestId !== teacherStudentDetailsRequestId || !document.getElementById('teacherStudentDetailsModal').classList.contains('open')) return;
        renderTeacherStudentDetails(details);
      } catch (error) {
        if (requestId !== teacherStudentDetailsRequestId || !document.getElementById('teacherStudentDetailsModal').classList.contains('open')) return;
        body.innerHTML = `<div class="teacher-student-details-message is-error" role="alert">
        <p>${window.EDUGNAY_CONFIG.escapeHtml(error?.message || 'Student details could not be loaded.')}</p>
        <button class="top-btn secondary" type="button" data-page-click="g79881ecce0c1">Try again</button>
      </div>`;
      }
    }

    function openTeacherStudentDetails(studentId, trigger) {
      const requestedClassId = new URLSearchParams(window.location.search).get('classId') || '';
      const electiveClass = requestedClassId ? window.AcademixElectiveClass : null;
      const student = requestedClassId
        ? electiveClass?.getStudent?.(studentId)
        : STUDENTS.find(item => String(item.id) === String(studentId));
      if (requestedClassId) {
        if (!electiveClass || !window.EDUGNAY_API?.getShsElectiveStudentDetails) return;
      } else if (!BACKEND_SECTION_MODE || !CURRENT_SECTION_ID || !window.EDUGNAY_API?.getSectionStudentDetails) return;
      if (!student) return;

      teacherStudentDetailsTrigger = trigger || document.activeElement;
      teacherStudentDetailsStudentId = String(student.id);
      teacherStudentDetailsClassId = requestedClassId;
      document.getElementById('teacherStudentDetailsTitle').textContent = student.displayName || 'Student details';
      const classInfo = electiveClass?.getClass?.();
      document.getElementById('teacherStudentDetailsSub').textContent = requestedClassId
        ? [classInfo?.gradeName, classInfo?.className, classInfo?.schoolYear].filter(Boolean).join(' · ')
        : CURRENT_SECTION;
      openModal('teacherStudentDetailsModal');
      document.getElementById('teacherStudentDetailsClose').focus();
      loadTeacherStudentDetails();
    }

    async function openTeacherDeleteModal(kind, id, name) {
      const journalItem = kind === 'scoreComponent' ? BACKEND_GRADING_ITEMS.find(item => String(item.id) === String(id) && item.journalPromptId) : null;
      const linkedAssignment = kind === 'scoreComponent'
        ? BACKEND_ASSIGNMENTS.find(assignment => String(assignment.gradingItemId) === String(id))
        : kind === 'assignment' ? BACKEND_ASSIGNMENTS.find(assignment => String(assignment.id) === String(id)) : null;
      const linkedItem = linkedAssignment?.gradingItemId
        ? BACKEND_GRADING_ITEMS.find(item => String(item.id) === String(linkedAssignment.gradingItemId)) : null;
      const isPair = Boolean(linkedAssignment?.gradingItemId);
      const deleteKind = isPair ? 'assignment' : kind;
      const request = { kind: journalItem ? 'journalPrompt' : deleteKind, id: String(journalItem ? journalItem.journalPromptId : isPair ? linkedAssignment.id : id), gradingItemId: journalItem ? journalItem.id : isPair ? linkedAssignment.gradingItemId : null };
      const electiveClassId = new URLSearchParams(window.location.search).get('classId');
      if (kind === 'assignment' && electiveClassId) request.electiveClassId = electiveClassId;
      pendingTeacherDelete = request;
      const isMaterial = kind === 'material';
      const isComponent = deleteKind === 'scoreComponent';
      document.getElementById('teacherDeleteConfirmTitle').textContent = `Delete ${journalItem ? 'journal prompt and component' : isPair ? 'assignment and component' : isComponent ? 'score component' : isMaterial ? 'learning material' : 'assignment'}?`;
      document.getElementById('teacherDeleteConfirmSub').textContent = 'This action cannot be undone.';
      document.getElementById('teacherDeleteConfirmName').textContent = isPair
        ? kind === 'scoreComponent' ? linkedItem?.name || name || 'Score component' : linkedAssignment.title
        : name || (isComponent ? 'Score component' : isMaterial ? 'Learning material' : 'Assignment');
      const scoreCount = isComponent || isPair || journalItem ? BACKEND_STUDENT_SCORES.filter(score =>
        String(score.gradingItemId) === String(isPair ? linkedAssignment.gradingItemId : id)
        && (score.score !== null && score.score !== undefined || String(score.remarks || '').trim())).length : 0;
      const item = isComponent ? BACKEND_GRADING_ITEMS.find(record => String(record.id) === String(id)) : null;
      const published = Boolean((linkedItem || item)?.usedInPublishedGrades);
      const isAssignmentDelete = deleteKind === 'assignment' && !journalItem;
      const blocked = Boolean(published || ((isPair || journalItem) && scoreCount));
      document.getElementById('teacherDeleteConfirmDescription').textContent = journalItem
        ? published ? 'This component was used in published grades and must remain.'
          : scoreCount ? 'This component has saved scores and cannot be deleted.'
            : 'Its linked journal prompt will also be deleted. Prompts with student entries cannot be deleted.'
        : isPair
          ? published ? 'The score component was used in published grades and cannot be deleted.'
            : scoreCount ? 'The score component has saved student scores and cannot be deleted.'
              : 'Checking current submissions…'
          : isComponent
            ? published ? 'This component was used in published grades and cannot be deleted.'
              : `This will permanently remove the component and ${scoreCount} saved student score ${scoreCount === 1 ? 'record' : 'records'}.`
            : isMaterial ? 'The material and its uploaded file will be permanently removed.'
              : 'Checking current submissions…';
      const button = document.getElementById('teacherDeleteConfirmButton');
      button.textContent = `Delete ${journalItem || isPair ? 'Both' : isComponent ? 'Component' : isMaterial ? 'Material' : 'Assignment'}`;
      button.disabled = blocked || isAssignmentDelete;
      openModal('teacherDeleteConfirmModal');
      window.lucide?.createIcons?.();
      if (!isAssignmentDelete || blocked) return;
      try {
        const submissions = await window.EDUGNAY_API.getAssignmentSubmissions(request.id);
        if (pendingTeacherDelete !== request) return;
        BACKEND_SUBMISSIONS.set(request.id, submissions);
        BACKEND_SUBMISSION_ERRORS.delete(String(request.id));
        request.expectedSubmissionCount = submissions.length;
        document.getElementById('teacherDeleteConfirmDescription').textContent = submissions.length
          ? `This assignment has ${submissions.length} student submission ${submissions.length === 1 ? 'record' : 'records'}. Deleting it permanently removes the assignment, these records, and any uploaded files${isPair ? ' and its linked score component' : ''}. Students will need to submit again to the correct or recreated assignment.`
          : `This will permanently remove the assignment${isPair ? ' and its linked score component' : ''}.`;
        button.disabled = false;
      } catch (error) {
        if (pendingTeacherDelete !== request) return;
        document.getElementById('teacherDeleteConfirmDescription').textContent = 'Could not check current submissions. Close this dialog and try again.';
        showAppToast(error.message || 'Submissions could not be checked.', 'error');
      }
    }

    async function confirmTeacherDelete() {
      const request = pendingTeacherDelete;
      const button = document.getElementById('teacherDeleteConfirmButton');
      if (!request || !button || teacherDeletePending) return;
      const originalLabel = button.textContent;
      let refreshConfirmation = false;
      teacherDeletePending = true;
      button.disabled = true;
      button.textContent = 'Deleting…';
      try {
        if (request.kind === 'assignment') {
          if (request.electiveClassId) {
            const deletion = await window.EDUGNAY_API.deleteAssignment(request.id, request.expectedSubmissionCount);
            closeAssignmentMenus();
            teacherDeletePending = false;
            closeModal('teacherDeleteConfirmModal');
            await window.AcademixElectiveClass?.refresh('assignments');
            showAppToast(deletion?.fileCleanupPending ? 'Assignment deleted, but a stored submission file still needs cleanup.' : 'Assignment deleted.', deletion?.fileCleanupPending ? 'info' : 'success');
            return;
          }
          if (request.gradingItemId) await flushPendingBackendScoreSaves();
          const deletion = await window.EDUGNAY_API.deleteAssignment(request.id, request.expectedSubmissionCount);
          BACKEND_ASSIGNMENTS = BACKEND_ASSIGNMENTS.filter(item => String(item.id) !== request.id);
          if (request.gradingItemId) {
            BACKEND_GRADING_ITEMS = BACKEND_GRADING_ITEMS.filter(item => String(item.id) !== String(request.gradingItemId));
            BACKEND_STUDENT_SCORES = BACKEND_STUDENT_SCORES.filter(score => String(score.gradingItemId) !== String(request.gradingItemId));
          }
          BACKEND_SUBMISSIONS.delete(request.id);
          let refreshFailed = false;
          try {
            const [assignments, items, scores] = await Promise.all([
              window.EDUGNAY_API.getAssignments({ sectionId: BACKEND_GRADE_CONTEXT.sectionId, subjectId: BACKEND_GRADE_CONTEXT.subjectId, communicationComponentCode: BACKEND_GRADE_CONTEXT.communicationComponentCode }),
              window.EDUGNAY_API.getGradingItems({ sectionId: BACKEND_GRADE_CONTEXT.sectionId,
                subjectId: BACKEND_GRADE_CONTEXT.subjectId,
                communicationComponentCode: BACKEND_GRADE_CONTEXT.communicationComponentCode }),
              window.EDUGNAY_API.getStudentScores({})
            ]);
            BACKEND_ASSIGNMENTS = assignments;
            BACKEND_GRADING_ITEMS = items.filter(item => item.subjectId === String(BACKEND_GRADE_CONTEXT.subjectId)
              && (item.communicationComponentCode || null) === (BACKEND_GRADE_CONTEXT.communicationComponentCode || null));
            BACKEND_STUDENT_SCORES = scores;
          } catch { refreshFailed = true; }
          closeAssignmentMenus();
          teacherDeletePending = false;
          closeModal('teacherDeleteConfirmModal');
          renderAssignments();
          renderScoreTable(document.getElementById('academicPeriodSelect').value);
          showAppToast(deletion?.fileCleanupPending ? 'Assignment deleted, but a stored submission file still needs cleanup.'
            : refreshFailed ? 'Deletion succeeded, but the lists could not refresh.'
              : request.gradingItemId ? 'Assignment and score component deleted.' : 'Assignment deleted.',
            deletion?.fileCleanupPending || refreshFailed ? 'info' : 'success');
        } else if (request.kind === 'journalPrompt') {
          await flushPendingBackendScoreSaves();
          await window.EDUGNAY_API.deleteJournalPrompt(request.id);
          BACKEND_GRADING_ITEMS = BACKEND_GRADING_ITEMS.filter(item => String(item.id) !== String(request.gradingItemId));
          BACKEND_STUDENT_SCORES = BACKEND_STUDENT_SCORES.filter(score => String(score.gradingItemId) !== String(request.gradingItemId));
          teacherDeletePending = false;
          closeModal('teacherDeleteConfirmModal');
          renderScoreTable(document.getElementById('academicPeriodSelect').value);
          showAppToast('Journal prompt and score component deleted.');
        } else if (request.kind === 'scoreComponent') {
          await flushPendingBackendScoreSaves();
          await window.EDUGNAY_API.deleteGradingItem(request.id);
          BACKEND_GRADING_ITEMS = BACKEND_GRADING_ITEMS.filter(item => String(item.id) !== request.id);
          BACKEND_STUDENT_SCORES = BACKEND_STUDENT_SCORES.filter(score => String(score.gradingItemId) !== request.id);
          let refreshFailed = false;
          try {
            const [items, scores] = await Promise.all([
              window.EDUGNAY_API.getGradingItems({ sectionId: BACKEND_GRADE_CONTEXT.sectionId,
                subjectId: BACKEND_GRADE_CONTEXT.subjectId,
                communicationComponentCode: BACKEND_GRADE_CONTEXT.communicationComponentCode }),
              window.EDUGNAY_API.getStudentScores({})
            ]);
            BACKEND_GRADING_ITEMS = items.filter(item => item.subjectId === String(BACKEND_GRADE_CONTEXT.subjectId)
              && (item.communicationComponentCode || null) === (BACKEND_GRADE_CONTEXT.communicationComponentCode || null));
            BACKEND_STUDENT_SCORES = scores;
          } catch { refreshFailed = true; }
          teacherDeletePending = false;
          closeModal('teacherDeleteConfirmModal');
          renderScoreTable(document.getElementById('academicPeriodSelect').value);
          showAppToast(refreshFailed ? 'Component deleted, but the gradebook could not refresh.' : 'Score component deleted.', refreshFailed ? 'info' : 'success');
        } else {
          const result = await window.EDUGNAY_API.deleteMaterial(request.id);
          teacherDeletePending = false;
          closeModal('teacherDeleteConfirmModal');
          const electiveClassId = new URLSearchParams(window.location.search).get('classId');
          if (electiveClassId) {
            window.dispatchEvent(new CustomEvent('edugnay:teacher-materials-changed', { detail: { classId: electiveClassId } }));
          } else {
            await loadBackendMaterials();
          }
          const needsInfo = result?.fileCleanupPending || (!electiveClassId && backendMaterialsError);
          showAppToast(result?.fileCleanupPending
            ? 'Material deleted, but its stored file still needs cleanup.'
            : !electiveClassId && backendMaterialsError ? 'Material deleted, but the list could not refresh.' : 'Material deleted.',
            needsInfo ? 'info' : 'success');
        }
      } catch (error) {
        refreshConfirmation = request.kind === 'assignment' && error.status === 409
          && /Submissions changed\./.test(error.message);
        showAppToast(refreshConfirmation ? 'Submissions changed. Review the updated warning before deleting.'
          : error.message || 'The item could not be deleted.', 'error');
      } finally {
        teacherDeletePending = false;
        button.textContent = originalLabel;
        if (refreshConfirmation) openTeacherDeleteModal('assignment', request.id, document.getElementById('teacherDeleteConfirmName').textContent);
        else button.disabled = false;
      }
    }

    document.getElementById('teacherDeleteConfirmButton').addEventListener('click', confirmTeacherDelete);

    let scoreComponentMenuItemId = null;
    function closeScoreComponentMenu() {
      document.getElementById('scoreComponentMenu').hidden = true;
      document.querySelectorAll('.score-comp-menu-trigger[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
      scoreComponentMenuItemId = null;
    }
    document.getElementById('scoreTheadRow').addEventListener('click', event => {
      const button = event.target.closest('.score-comp-menu-trigger');
      if (!button) return;
      event.stopPropagation();
      const wasOpen = !document.getElementById('scoreComponentMenu').hidden && scoreComponentMenuItemId === button.dataset.componentId;
      closeScoreComponentMenu();
      if (wasOpen) return;
      if (!hasScoreEditingAccess(document.getElementById('academicPeriodSelect').value)) {
        showAppToast('This grading period is not active. Ask your school administrator to review access before deleting a component.', 'error');
        return;
      }
      const menu = document.getElementById('scoreComponentMenu');
      const rect = button.getBoundingClientRect();
      scoreComponentMenuItemId = button.dataset.componentId;
      const journalItem = BACKEND_GRADING_ITEMS.find(item => String(item.id) === scoreComponentMenuItemId && item.journalPromptId);
      const selectedItem = BACKEND_GRADING_ITEMS.find(item => String(item.id) === scoreComponentMenuItemId);
      const selectedCategory = BACKEND_CATEGORIES.find(category => String(category.subjectGradingComponentId) === String(selectedItem?.subjectGradingComponentId));
      updateValuesDomainSelect(selectedCategory?.code, 'scoreComponentDomainGroup', 'scoreComponentDomainInput', selectedItem?.domainCode, true);
      document.getElementById('scoreComponentDeleteLabel').textContent = journalItem ? 'Delete journal & component' : BACKEND_ASSIGNMENTS.some(assignment =>
        String(assignment.gradingItemId) === scoreComponentMenuItemId)
        ? 'Delete assignment & component' : 'Delete component';
      button.setAttribute('aria-expanded', 'true');
      menu.hidden = false;
      menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
      document.getElementById('scoreComponentDeleteAction').focus();
    });
    document.getElementById('scoreComponentDomainInput').addEventListener('change', async event => {
      const item = BACKEND_GRADING_ITEMS.find(record => String(record.id) === scoreComponentMenuItemId);
      if (!item) return;
      event.target.disabled = true;
      try {
        const saved = await window.EDUGNAY_API.updateGradingItem(item.id, { domainCode: event.target.value });
        Object.assign(item, saved);
        closeScoreComponentMenu();
        renderScoreTable(document.getElementById('academicPeriodSelect').value);
        showAppToast('Assessment domain saved. Review scores before republishing.');
      } catch (error) {
        showAppToast(error.message || 'The domain could not be saved.', 'error');
        event.target.value = item.domainCode || '';
      } finally { event.target.disabled = false; }
    });
    document.getElementById('scoreComponentDeleteAction').addEventListener('click', () => {
      const item = BACKEND_GRADING_ITEMS.find(record => String(record.id) === scoreComponentMenuItemId);
      closeScoreComponentMenu();
      if (item) openTeacherDeleteModal('scoreComponent', item.id, item.name);
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('#scoreComponentMenu, .score-comp-menu-trigger')) closeScoreComponentMenu();
    });
    document.addEventListener('scroll', closeScoreComponentMenu, true);
    window.addEventListener('resize', closeScoreComponentMenu);
    document.getElementById('scoreComponentMenu').addEventListener('focusout', event => {
      if (!event.currentTarget.contains(event.relatedTarget)) closeScoreComponentMenu();
    });

    /* ── TABS ── */
    function switchTab(name) {
      if (name !== 'scores') window.AcademixShsGradebook?.close?.(document.querySelector('#content-scores .panel'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('content-' + name).classList.add('active');
      document.getElementById('tab-' + name).classList.add('active');
      const target = new URL(window.location.href);
      target.searchParams.set('tab', name);
      window.history.replaceState(null, '', target.href);
      if (target.searchParams.has('classId')) {
        return window.AcademixElectiveClass?.loadTab(name);
      }
      if (name === 'scores' && USE_SHS_CORE_GRADEBOOK) {
        return window.AcademixShsGradebook?.mount(document.querySelector('#content-scores .panel'), {
          sectionId: CURRENT_SECTION_ID,
          subjectId: CURRENT_SUBJECT_ID,
          communicationComponentCode: CURRENT_SUBJECT_ASSIGNMENT?.communicationComponentCode || ''
        });
      }
    }

    /* ── SCORE CATEGORY FILTER ── */
    function switchCatTab(el, cat) {
      document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      window.TeacherClassViews?.filterScores(document.querySelector('#content-scores .panel'), cat);
    }

    function renderScoreCategoryTabs() {
      const tabs = document.querySelector('.cat-tabs');
      const categories = BACKEND_SUBJECT_GRADING_CONFIG?.applicable
        ? BACKEND_CATEGORIES.map(category => ({ code: category.code, name: category.name, weight: category.weight }))
        : CURRENT_GRADING_RULES.map(rule => ({ code: String(rule.id || '').toUpperCase(), name: rule.label || rule.name || String(rule.id || 'Component'), weight: rule.weight }));
      window.TeacherClassViews.renderScoreCategories(tabs, categories, category => {
        window.TeacherClassViews.filterScores(document.querySelector('#content-scores .panel'), category);
        updateScoreFooter();
      });
    }

    /* ── SECTION AND TEACHER CONTEXT ── */
    // Resolve the selected section from the signed-in teacher's assignments.
    let CURRENT_TEACHER_ID = window.EDUGNAY_TEACHER_ACCESS?.teacherId || null;
    let CURRENT_SECTION_ID = '';
    let CURRENT_SECTION_RECORD = null;
    let CURRENT_BACKEND_SECTION = null;
    let CURRENT_TEACHER_SUBJECT_ASSIGNMENTS = [];
    let CURRENT_SUBJECT_ASSIGNMENT = null;
    let BACKEND_SECTION_MODE = Boolean(window.EDUGNAY_API?.isBackendAvailable);
    let BACKEND_SECTION_ERROR = '';
    let USE_SHS_CORE_GRADEBOOK = false;

    let CURRENT_TEACHER_ASSIGNMENT = {
      schoolId: window.EDUGNAY_CONFIG.getActiveSchoolId(),
      teacherId: CURRENT_TEACHER_ID,
      sectionId: CURRENT_SECTION_ID,
      subjectId: '',
      adviserId: CURRENT_SECTION_RECORD?.adviserId || null,
      isAdviser: CURRENT_SECTION_RECORD?.adviserId === CURRENT_TEACHER_ID
    };
    let CURRENT_SUBJECT_RECORD = null;
    let CURRENT_SECTION = CURRENT_SECTION_RECORD ? `${CURRENT_SECTION_RECORD.grade} – ${CURRENT_SECTION_RECORD.name}` : 'Section';
    let CURRENT_SUBJECT_ID = CURRENT_TEACHER_ASSIGNMENT.subjectId;
    let CURRENT_COMMUNICATION_COMPONENT_CODE = '';
    let CURRENT_SUBJECT = CURRENT_SUBJECT_RECORD?.name || 'Subject';
    let CURRENT_LEVEL = CURRENT_SECTION_RECORD?.level || 'jhs';
    let CURRENT_DIVISION = window.EDUGNAY_CONFIG.getActiveSchool()?.divisions?.[CURRENT_LEVEL] || {};
    let ACADEMIC_PERIODS = [];
    let ACTIVE_ACADEMIC_PERIOD_ID = CURRENT_DIVISION.activeAcademicPeriodId || ACADEMIC_PERIODS.find(period => period.status === 'active')?.id || ACADEMIC_PERIODS[0]?.id || '';
    let CURRENT_GRADING_RULES = CURRENT_DIVISION.gradingRules || [];
    let CURRENT_GRADE_SCALE = 'standard';
    let GRADE_ROUNDING = ['round', 'roundup', 'truncate'].includes(CURRENT_DIVISION.gradeRounding)
      ? CURRENT_DIVISION.gradeRounding
      : 'round';
    let PASSING_GRADE_THRESHOLD = Number.isFinite(Number(CURRENT_DIVISION.passingGradeThreshold))
      ? Math.max(0, Math.min(100, Number(CURRENT_DIVISION.passingGradeThreshold)))
      : 75;
    let WARNING_GRADE_THRESHOLD = Math.max(0, PASSING_GRADE_THRESHOLD - 5);
    let GRADING_RULES_BY_ID = Object.fromEntries(
      CURRENT_GRADING_RULES.map(rule => [String(rule.id || '').toLowerCase(), rule])
    );

    function refreshSectionSettings() {
      CURRENT_DIVISION = window.EDUGNAY_CONFIG.getActiveSchool()?.divisions?.[CURRENT_LEVEL] || {};
      ACADEMIC_PERIODS = [];
      CURRENT_GRADING_RULES = [];
      CURRENT_GRADE_SCALE = 'standard';
      ACTIVE_ACADEMIC_PERIOD_ID = '';
      GRADE_ROUNDING = ['round', 'roundup', 'truncate'].includes(CURRENT_DIVISION.gradeRounding)
        ? CURRENT_DIVISION.gradeRounding
        : 'round';
      PASSING_GRADE_THRESHOLD = Number.isFinite(Number(CURRENT_DIVISION.passingGradeThreshold))
        ? Math.max(0, Math.min(100, Number(CURRENT_DIVISION.passingGradeThreshold)))
        : 75;
      WARNING_GRADE_THRESHOLD = Math.max(0, PASSING_GRADE_THRESHOLD - 5);
      GRADING_RULES_BY_ID = Object.fromEntries(
        CURRENT_GRADING_RULES.map(rule => [String(rule.id || '').toLowerCase(), rule])
      );
      WEIGHTS = Object.fromEntries(
        CURRENT_GRADING_RULES.map(rule => [String(rule.id).toUpperCase(), Number(rule.weight) / 100 || 0])
      );
    }

    function keepSectionInUrl() {
      if (!CURRENT_SECTION_ID) return;
      const target = new URL(window.location.href);
      target.searchParams.set('sectionId', CURRENT_SECTION_ID);
      window.history.replaceState(null, '', target.href);
    }

    async function initializeTeacherSectionContext() {
      if (!window.EDUGNAY_API?.isBackendAvailable) {
        BACKEND_SECTION_ERROR = 'Your assigned sections could not be loaded. Refresh and try again.';
        return false;
      }

      BACKEND_SECTION_MODE = true;
      BACKEND_GRADE_CONTEXT = { sectionId: '', subjectId: '', students: [] };
      STUDENTS = [];

      try {
        await window.EDUGNAY_SCHOOL_READY;
        const session = await window.EDUGNAY_API.getCurrentUser();
        if (session?.role !== 'teacher' || !session.apiUserId) {
          throw new Error('Sign in with a teacher account to view assigned sections.');
        }

        CURRENT_TEACHER_ID = String(session.apiUserId);
        let sections = (await window.EDUGNAY_CONFIG.getMyTeachingSections()).filter(section =>
          (!section.status || section.status === 'active')
          && (!section.academicYearStatus || section.academicYearStatus === 'active')
        );
        const requestedSectionId = new URLSearchParams(window.location.search).get('sectionId');
        let selectedSection = requestedSectionId
          ? sections.find(section => String(section.id) === requestedSectionId)
          : sections[0];

        if (!selectedSection) {
          const advisorySections = await window.EDUGNAY_CONFIG.getMyAdvisorySections();
          const advisorySection = requestedSectionId
            ? advisorySections.find(section => String(section.id) === requestedSectionId)
            : advisorySections[0];
          if (advisorySection) {
            selectedSection = advisorySection;
            sections = [...sections, advisorySection];
          }
        }

        if (!selectedSection) {
          if (!requestedSectionId) {
            try {
              const assignedClasses = (await window.EDUGNAY_API.getShsTeachingClasses()).classes || [];
              if (assignedClasses.length) {
                const target = new URL(window.location.href);
                target.searchParams.set('classId', String(assignedClasses[0].electiveClassId));
                window.location.replace(target.href);
                return null;
              }
            } catch (error) {
              if (error.status !== 403 && error.status !== 404) console.warn('SHS classes could not be loaded.', error);
            }
          }
          throw new Error(requestedSectionId
            ? 'This section has no subject assigned to your account.'
            : 'No classes are assigned to your account.');
        }

        CURRENT_BACKEND_SECTION = selectedSection;
        CURRENT_SECTION_RECORD = selectedSection;
        CURRENT_SECTION_ID = String(selectedSection.id);
        keepSectionInUrl();
        CURRENT_TEACHER_SUBJECT_ASSIGNMENTS = (selectedSection.subjectAssignments || []).map(item => ({
          ...item,
          teacherId: CURRENT_TEACHER_ID,
          subjectId: String(item.subjectId),
          communicationComponentCode: item.communicationComponentCode || null
        }));

        const requestedSubjectId = new URLSearchParams(window.location.search).get('subjectId');
        const requestedComponentCode = new URLSearchParams(window.location.search).get('communicationComponentCode');
        CURRENT_SUBJECT_ASSIGNMENT = requestedSubjectId
          ? CURRENT_TEACHER_SUBJECT_ASSIGNMENTS.find(item => String(item.subjectId) === requestedSubjectId
            && (requestedComponentCode ? item.communicationComponentCode === requestedComponentCode
              : !item.communicationComponentCode))
            || (!requestedComponentCode
              ? CURRENT_TEACHER_SUBJECT_ASSIGNMENTS.find(item => String(item.subjectId) === requestedSubjectId)
              : null)
          : CURRENT_TEACHER_SUBJECT_ASSIGNMENTS[0] || null;
        if (requestedSubjectId && !CURRENT_SUBJECT_ASSIGNMENT) {
          throw new Error('That subject is not assigned to you in this section.');
        }

        const gradeNumber = String(selectedSection.grade || '').match(/\d+/)?.[0];
        document.getElementById('sectionHeaderName').textContent = selectedSection.name || 'Section';
        document.getElementById('sectionGradeLabel').textContent = gradeNumber ? `Grade ${gradeNumber}` : 'Class section';
        document.querySelector('[data-school-year]').textContent = selectedSection.academicYear || 'Academic year unavailable';
        document.getElementById('sectionAdviserMeta').hidden = String(selectedSection.adviserId || '') !== CURRENT_TEACHER_ID;

        const studentResponse = await window.EDUGNAY_API.getSectionStudents(selectedSection.id);

        STUDENTS = studentResponse.students;
        CURRENT_LEVEL = selectedSection.level || 'jhs';
        CURRENT_SECTION = [selectedSection.grade, selectedSection.name].filter(Boolean).join(' – ') || 'Section';
        CURRENT_TEACHER_ASSIGNMENT = {
          schoolId: selectedSection.schoolId,
          teacherId: CURRENT_TEACHER_ID,
          sectionId: CURRENT_SECTION_ID,
          subjectId: CURRENT_SUBJECT_ASSIGNMENT?.subjectId || '',
          communicationComponentCode: CURRENT_SUBJECT_ASSIGNMENT?.communicationComponentCode || null,
          adviserId: selectedSection.adviserId || null,
          isAdviser: String(selectedSection.adviserId || '') === CURRENT_TEACHER_ID
        };
        CURRENT_SUBJECT_ID = CURRENT_TEACHER_ASSIGNMENT.subjectId;
        CURRENT_COMMUNICATION_COMPONENT_CODE = CURRENT_SUBJECT_ASSIGNMENT?.communicationComponentCode || '';
        CURRENT_SUBJECT = CURRENT_SUBJECT_ASSIGNMENT?.subjectName
          || (CURRENT_TEACHER_ASSIGNMENT.isAdviser ? 'Advisory section' : 'No subject assigned');
        if (CURRENT_COMMUNICATION_COMPONENT_CODE) {
          const componentLabel = CURRENT_SUBJECT_ASSIGNMENT?.communicationComponentName
            || (CURRENT_COMMUNICATION_COMPONENT_CODE === 'english' ? 'Effective Communication' : 'Mabisang Komunikasyon');
          const hoursLabel = CURRENT_SUBJECT_ASSIGNMENT?.communicationComponentHours
            ? ` (${CURRENT_SUBJECT_ASSIGNMENT.communicationComponentHours} instructional hours)` : '';
          CURRENT_SUBJECT = `${componentLabel}${hoursLabel}`;
        }
        CURRENT_SUBJECT_RECORD = CURRENT_SUBJECT_ASSIGNMENT
          ? { id: CURRENT_SUBJECT_ID, name: CURRENT_SUBJECT }
          : null;
        TEACHER_SECTION_SCHOOL_ID = selectedSection.schoolId || window.EDUGNAY_CONFIG.getActiveSchoolId();
        refreshSectionSettings();

        BACKEND_GRADE_CONTEXT = {
          sectionId: CURRENT_SECTION_ID,
          subjectId: CURRENT_SUBJECT_ID,
          communicationComponentCode: CURRENT_COMMUNICATION_COMPONENT_CODE || null,
          teacherId: CURRENT_TEACHER_ID,
          students: STUDENTS
        };
        BACKEND_SECTION_ERROR = '';
        updateSectionSubjectControl();
        return true;
      } catch (error) {
        CURRENT_BACKEND_SECTION = null;
        CURRENT_SECTION_RECORD = null;
        CURRENT_SECTION_ID = '';
        CURRENT_SUBJECT_ASSIGNMENT = null;
        CURRENT_COMMUNICATION_COMPONENT_CODE = '';
        CURRENT_TEACHER_SUBJECT_ASSIGNMENTS = [];
        CURRENT_SUBJECT_ID = '';
        CURRENT_SUBJECT = 'Subject unavailable';
        STUDENTS = [];
        BACKEND_GRADE_CONTEXT = { sectionId: '', subjectId: '', students: [] };
        BACKEND_SECTION_ERROR = 'Your assigned sections could not be loaded. Refresh and try again.';
        return false;
      }
    }

    function gradingWeight(category) {
      return Number(GRADING_RULES_BY_ID[String(category).toLowerCase()]?.weight) || 0;
    }

    function hasValidBackendSubjectAssignment() {
      const subjectId = Number(CURRENT_SUBJECT_ID);
      return Number.isSafeInteger(subjectId) && subjectId > 0
        && CURRENT_TEACHER_SUBJECT_ASSIGNMENTS.some(assignment =>
          String(assignment.subjectId) === String(CURRENT_SUBJECT_ID)
          && (assignment.communicationComponentCode || '') === CURRENT_COMMUNICATION_COMPONENT_CODE
        );
    }

    // Attendance rows keep the existing UI field names for API records.
    const ATTENDANCE_STATUS_BY_CODE = { P: 'present', A: 'absent', L: 'late', E: 'excused' };
    const ATTENDANCE_CODE_BY_STATUS = { present: 'P', absent: 'A', late: 'L', excused: 'E' };
    function isBackendAttendanceMode() {
      return Boolean(BACKEND_SECTION_MODE);
    }

    function getAttendanceStudents() {
      return BACKEND_ATTENDANCE_CONTEXT?.students || [];
    }

    function getTeacherAttendanceRecords(date = '') {
      const dataSets = date
        ? [BACKEND_ATTENDANCE_BY_DATE.get(date)].filter(Boolean)
        : Array.from(BACKEND_ATTENDANCE_BY_DATE.values());
      return dataSets.flatMap(data => (data.students || [])
        .filter(student => student.attendanceStatus)
        .map(student => ({
          studentId: String(student.id),
          date: data.attendanceDate,
          status: student.attendanceStatus,
          remark: student.remark || null
        })));
    }

    let TEACHER_MATERIALS = [];
    let BACKEND_MATERIAL_CONTEXT = null;
    let backendMaterialsError = '';
    let materialsFeedbackTimeout = null;
    let selectedMaterialFile = null;
    let materialUploadInProgress = false;
    let materialTitleValidationPending = false;

    const MATERIAL_FILE_HELP = 'PDF, Word, PowerPoint, Excel, JPG, PNG, or MP4. Up to 20 MB; MP4 up to 50 MB.';
    const MATERIAL_FILE_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'jpg', 'png', 'mp4']);
    const MATERIAL_MAX_FILE_SIZE = 50 * 1024 * 1024;
    const MATERIAL_MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;

    function setMaterialUploadHelp(message = MATERIAL_FILE_HELP, state = '') {
      const help = document.getElementById('materialFileHelp');
      if (!help) return;
      help.textContent = message;
      help.className = `file-drop-help${state ? ` is-${state}` : ''}`;
    }

    function showTeacherMaterialsFeedback(message, state = '') {
      const feedback = document.getElementById('teacherMaterialsFeedback');
      if (!feedback) return;
      clearTimeout(materialsFeedbackTimeout);
      materialsFeedbackTimeout = null;
      feedback.textContent = message;
      feedback.className = `materials-panel-feedback${state ? ` is-${state}` : ''}`;
      feedback.hidden = !message;
      if (message && state !== 'error') {
        materialsFeedbackTimeout = window.setTimeout(() => {
          feedback.hidden = true;
          feedback.textContent = '';
          materialsFeedbackTimeout = null;
        }, 5000);
      }
    }

    function formatMaterialFileSize(bytes) {
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }

    function validateMaterialFile(file) {
      const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
      if (!MATERIAL_FILE_EXTENSIONS.has(extension)) return 'Choose a PDF, Office, JPG, PNG, or MP4 file.';
      if (!file.size) return 'This file is empty. Choose a different file.';
      const maxSize = extension === 'mp4' ? MATERIAL_MAX_FILE_SIZE : MATERIAL_MAX_DOCUMENT_SIZE;
      if (file.size > maxSize) {
        return extension === 'mp4' ? 'MP4 files must be 50 MB or smaller.' : 'This file must be 20 MB or smaller.';
      }
      return '';
    }

    function clearSelectedMaterialFile(message = MATERIAL_FILE_HELP, state = '') {
      selectedMaterialFile = null;
      materialTitleValidationPending = false;
      const fileInput = document.getElementById('fileInput');
      if (fileInput) fileInput.value = '';
      document.getElementById('materialSelectedFile').hidden = true;
      document.getElementById('materialSelectedName').textContent = '';
      document.getElementById('materialSelectedSize').textContent = '';
      document.getElementById('materialUploadSubmit').disabled = true;
      document.getElementById('materialDropPrompt').textContent = 'Choose a file or drag it here';
      setMaterialUploadHelp(message, state);
    }

    function selectMaterialFile(file) {
      if (materialUploadInProgress) return;
      if (!file) {
        clearSelectedMaterialFile();
        return;
      }

      const error = validateMaterialFile(file);
      if (error) {
        clearSelectedMaterialFile(error, 'error');
        return;
      }

      selectedMaterialFile = file;
      materialTitleValidationPending = false;
      document.getElementById('materialSelectedName').textContent = file.name;
      document.getElementById('materialSelectedSize').textContent = formatMaterialFileSize(file.size);
      document.getElementById('materialSelectedFile').hidden = false;
      document.getElementById('materialUploadSubmit').disabled = false;
      document.getElementById('materialDropPrompt').textContent = 'Choose another file or drag to replace';
      setMaterialUploadHelp();
      lucide.createIcons();
    }

    function resetMaterialUploadForm() {
      clearSelectedMaterialFile();
      document.getElementById('materialTitleInput').value = '';
      materialTitleValidationPending = false;
      document.getElementById('materialVisibilityInput').value = 'published';
      document.getElementById('materialUploadSubmit').innerHTML = '<i data-lucide="upload" style="width:13px;height:13px;"></i> Upload';
      document.getElementById('fileInput').disabled = false;
      document.getElementById('materialFileRemove').disabled = false;
      lucide.createIcons();
    }

    function openMaterialUploadModal() {
      showTeacherMaterialsFeedback('');
      openModal('uploadModal');
    }

    function setupMaterialFileInput() {
      const fileInput = document.getElementById('fileInput');
      const dropZone = document.getElementById('fileDropZone');
      const removeButton = document.getElementById('materialFileRemove');
      const titleInput = document.getElementById('materialTitleInput');
      const dropPrompt = document.getElementById('materialDropPrompt');
      const getDefaultDropPrompt = () => selectedMaterialFile ? 'Choose another file or drag to replace' : 'Choose a file or drag it here';

      fileInput.addEventListener('change', () => selectMaterialFile(fileInput.files?.[0] || null));
      removeButton.addEventListener('click', () => clearSelectedMaterialFile());
      titleInput.addEventListener('input', () => {
        if (!materialTitleValidationPending || !titleInput.value.trim()) return;
        materialTitleValidationPending = false;
        setMaterialUploadHelp();
      });

      dropZone.addEventListener('dragover', event => {
        event.preventDefault();
        if (!materialUploadInProgress) {
          dropZone.classList.add('is-dragover');
          dropPrompt.textContent = 'Drop your file to select it';
        }
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      });
      dropZone.addEventListener('dragleave', event => {
        if (!dropZone.contains(event.relatedTarget)) {
          dropZone.classList.remove('is-dragover');
          dropPrompt.textContent = getDefaultDropPrompt();
        }
      });
      dropZone.addEventListener('drop', event => {
        event.preventDefault();
        dropZone.classList.remove('is-dragover');
        dropPrompt.textContent = getDefaultDropPrompt();
        if (materialUploadInProgress) return;
        const files = event.dataTransfer?.files;
        if (!files?.length) return;
        if (files.length > 1) {
          clearSelectedMaterialFile('Choose one file at a time.', 'error');
          return;
        }
        fileInput.value = '';
        selectMaterialFile(files[0]);
      });
    }

    setupMaterialFileInput();

    async function loadBackendMaterials() {
      if (!window.EDUGNAY_API?.isBackendAvailable) {
        TEACHER_MATERIALS = [];
        backendMaterialsError = 'Learning materials are not available right now. Refresh and try again.';
        renderTeacherMaterials();
        return;
      }
      try {
        backendMaterialsError = '';
        if (!CURRENT_BACKEND_SECTION || !CURRENT_SUBJECT_ASSIGNMENT || !hasValidBackendSubjectAssignment()) {
          throw new Error('No subject is assigned to you in this section.');
        }
        BACKEND_MATERIAL_CONTEXT = { sectionId: CURRENT_SECTION_ID, subjectId: CURRENT_SUBJECT_ID,
          communicationComponentCode: CURRENT_COMMUNICATION_COMPONENT_CODE || null };
        TEACHER_MATERIALS = (await window.EDUGNAY_API.getMaterials({
          sectionId: BACKEND_MATERIAL_CONTEXT.sectionId,
          subjectId: BACKEND_MATERIAL_CONTEXT.subjectId,
          communicationComponentCode: BACKEND_MATERIAL_CONTEXT.communicationComponentCode
        })).map(material => ({
          ...material,
          fileSize: `${(material.fileSizeBytes / 1024 / 1024).toFixed(1)} MB`
        }));
      } catch (error) {
        TEACHER_MATERIALS = [];
        backendMaterialsError = 'Learning materials could not be loaded. Refresh and try again.';
      }
      renderTeacherMaterials();
    }

    let STUDENTS = [];

    let BACKEND_ATTENDANCE_CONTEXT = null;
    const BACKEND_ATTENDANCE_BY_DATE = new Map();
    let BACKEND_ATTENDANCE_ERROR = '';
    let BACKEND_ATTENDANCE_HISTORY_ERROR = '';

    let BACKEND_GRADE_CONTEXT = null;
    let BACKEND_ASSIGNMENTS = [];
    let BACKEND_GRADING_ITEMS = [];
    let BACKEND_STUDENT_SCORES = [];
    let BACKEND_PUBLISHED_GRADES = [];
    let BACKEND_CATEGORIES = [];
    let BACKEND_SUBJECT_GRADING_CONFIG = null;
    let CURRENT_GRADE_METHOD_LABEL = '';
    let BACKEND_TERMS = [];
    let BACKEND_GRADE_ERROR = '';
    let STUDENT_LIST_GRADE_ERROR = '';
    const TRANSFER_REVIEW_CACHE = new Map();
    let publishPreview = null;
    let publishPreviewScope = null;
    let publishInProgress = false;
    const BACKEND_SUBMISSIONS = new Map();
    const BACKEND_SUBMISSION_ERRORS = new Set();
    let BACKEND_SUBMISSIONS_LOADING = false;

    function isBackendGradeMode() {
      return Boolean(BACKEND_GRADE_CONTEXT);
    }

    function getGradeStudents() {
      return BACKEND_GRADE_CONTEXT?.students || [];
    }

    function getBackendTermId(academicPeriodId) {
      if (!isBackendGradeMode()) return null;
      const term = BACKEND_TERMS.find(item => String(item.id) === String(academicPeriodId));
      return term ? String(term.id) : null;
    }

    function getPublishedGradesForPeriod(academicPeriodId) {
      if (!isBackendGradeMode()) return [];
      const termId = getBackendTermId(academicPeriodId);
      return BACKEND_PUBLISHED_GRADES.filter(grade =>
        grade.sectionId === String(BACKEND_GRADE_CONTEXT.sectionId)
        && grade.subjectId === String(BACKEND_GRADE_CONTEXT.subjectId)
        && grade.academicTermId === String(termId)
      );
    }

    function updatePublishedGradesBanner(academicPeriodId) {
      const banner = document.getElementById('publishedGradesBanner');
      const publicationStatus = document.querySelector('[data-publication-status="published"]');
      if (!isBackendGradeMode()) {
        banner.style.display = 'none';
        if (publicationStatus) publicationStatus.hidden = true;
        return;
      }
      const status = document.getElementById('publishedPeriodStatus');
      const button = document.getElementById('republishGradesButton');
      const grades = getPublishedGradesForPeriod(academicPeriodId);
      const term = BACKEND_TERMS.find(item => String(item.id) === String(getBackendTermId(academicPeriodId)));

      if (publicationStatus) publicationStatus.hidden = grades.length === 0;
      banner.style.display = grades.length ? 'flex' : 'none';
      button.style.display = grades.length && term?.status === 'active' ? 'inline-flex' : 'none';
      if (!grades.length) return;

      const publishedAt = grades.reduce((latest, grade) => {
        if (!latest) return grade.publishedAt;
        return new Date(grade.publishedAt).getTime() > new Date(latest).getTime() ? grade.publishedAt : latest;
      }, null);
      const publishedDate = publishedAt && Number.isFinite(new Date(publishedAt).getTime())
        ? new Date(publishedAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
        : 'date unavailable';
      status.textContent = `Published on ${publishedDate} · ${grades.length} ${grades.length === 1 ? 'student' : 'students'} saved for this subject and term.`;
    }

    function getBackendCategory(categoryCode) {
      return BACKEND_CATEGORIES.find(category => String(category.code).toLowerCase() === String(categoryCode || '').toLowerCase()) || null;
    }

    function getGradeStatusTone(grade, passingThreshold = PASSING_GRADE_THRESHOLD, warningThreshold = WARNING_GRADE_THRESHOLD) {
      const numericGrade = Number(grade);
      if (!Number.isFinite(numericGrade)) return 'grade-unavailable';
      if (numericGrade >= passingThreshold) return 'grade-pass';
      return numericGrade >= warningThreshold ? 'grade-warn' : 'grade-fail';
    }

    function getBackendGradingItemForAssignment(assignment) {
      if (assignment.gradingItemId) {
        return BACKEND_GRADING_ITEMS.find(item => item.id === String(assignment.gradingItemId)) || null;
      }
      const matches = BACKEND_GRADING_ITEMS.filter(item =>
        item.sectionId === String(BACKEND_GRADE_CONTEXT?.sectionId) &&
        item.subjectId === String(BACKEND_GRADE_CONTEXT?.subjectId) &&
        item.academicTermId === String(assignment.academicPeriodId) &&
        Number(item.gradingCategoryId) === Number(assignment.gradingCategoryId) &&
        item.title === assignment.title &&
        Number(item.maxScore) === Number(assignment.maxScore)
      );
      return matches.length === 1 ? matches[0] : null;
    }

    function getBackendScore(gradingItemId, studentId) {
      return BACKEND_STUDENT_SCORES.find(record =>
        String(record.gradingItemId) === String(gradingItemId) && String(record.studentId) === String(studentId)
      ) || null;
    }

    function getAssignmentScoreRecords(assignmentId) {
      const assignment = getTeacherAssignments().find(item => item.id === String(assignmentId));
      if (isBackendGradeMode()) {
        const item = assignment && getBackendGradingItemForAssignment(assignment);
        return item
          ? BACKEND_STUDENT_SCORES
            .filter(record => String(record.gradingItemId) === String(item.id))
            .map(record => ({ ...record, assignmentId: String(assignmentId) }))
          : [];
      }
      return [];
    }

    async function loadBackendGradeData(termsPromise) {
      if (!window.EDUGNAY_API?.isBackendAvailable) {
        BACKEND_GRADE_ERROR = 'Scores are not available right now. Refresh and try again.';
        return false;
      }
      if (!CURRENT_BACKEND_SECTION || !CURRENT_SUBJECT_ASSIGNMENT || !hasValidBackendSubjectAssignment()) {
        BACKEND_GRADE_ERROR = 'The assigned section and subject are unavailable for grade recording.';
        return false;
      }

      try {
        const session = await window.EDUGNAY_API.getCurrentUser();
        if (session?.role !== 'teacher') throw new Error('Sign in with a teacher account to manage grades.');
        const section = CURRENT_BACKEND_SECTION;
        const subjectAssignment = CURRENT_SUBJECT_ASSIGNMENT;
        const teacherId = String(session.apiUserId || session.userId);
        if (teacherId !== CURRENT_TEACHER_ID) throw new Error('Your session changed. Reload this page to continue.');
        if (!section.academicYearId || !section.schoolLevelId) {
          throw new Error('The section academic year or school level is unavailable.');
        }

        const [terms, gradingSettings, subjectGradingConfig] = await Promise.all([
          termsPromise,
          window.EDUGNAY_API.getGradingSettings({
            schoolLevelId: section.schoolLevelId,
            sectionId: section.id,
            subjectId: subjectAssignment.subjectId
          }),
          window.EDUGNAY_API.getSubjectGradingConfig({ sectionId: section.id, subjectId: subjectAssignment.subjectId })
        ]);
        const categories = subjectGradingConfig.applicable
          ? subjectGradingConfig.configured
            ? subjectGradingConfig.components.map(component => ({
              id: null,
              code: component.code,
              name: component.name,
              weight: Number(component.weight),
              subjectGradingComponentId: Number(component.id),
              componentType: component.componentType,
              examParts: component.examParts || []
            }))
            : []
          : gradingSettings.gradingCategories;
        if (!terms.length) throw new Error('No grading periods are set up for this school year. Ask your school administrator to add them.');

        const [gradingItems, scores, publishedGrades] = await Promise.all([
          window.EDUGNAY_API.getGradingItems({ sectionId: section.id,
            subjectId: subjectAssignment.subjectId,
            communicationComponentCode: subjectAssignment.communicationComponentCode }),
          window.EDUGNAY_API.getStudentScores({}),
          window.EDUGNAY_API.getFinalGrades({ sectionId: section.id, subjectId: subjectAssignment.subjectId })
        ]);

        BACKEND_GRADE_CONTEXT = {
          sectionId: String(section.id),
          subjectId: String(subjectAssignment.subjectId),
          communicationComponentCode: subjectAssignment.communicationComponentCode || null,
          teacherId,
          students: STUDENTS
        };
        BACKEND_GRADING_ITEMS = gradingItems.filter(item => item.subjectId === String(subjectAssignment.subjectId)
          && (item.communicationComponentCode || null) === (subjectAssignment.communicationComponentCode || null));
        BACKEND_STUDENT_SCORES = scores;
        BACKEND_PUBLISHED_GRADES = publishedGrades;
        BACKEND_CATEGORIES = categories;
        BACKEND_SUBJECT_GRADING_CONFIG = subjectGradingConfig;
        CURRENT_GRADE_SCALE = subjectGradingConfig.applicable
          ? subjectGradingConfig.gradingMethod
          : gradingSettings.gradingScale || 'standard';
        CURRENT_GRADE_METHOD_LABEL = subjectGradingConfig.gradingMethodLabel || '';
        if (subjectGradingConfig.applicable) {
          GRADE_ROUNDING = ['round', 'roundup', 'truncate'].includes(subjectGradingConfig.gradeRounding)
            ? subjectGradingConfig.gradeRounding : 'round';
          PASSING_GRADE_THRESHOLD = Number.isFinite(Number(subjectGradingConfig.passingGradeThreshold))
            ? Number(subjectGradingConfig.passingGradeThreshold) : 75;
          WARNING_GRADE_THRESHOLD = Math.max(0, PASSING_GRADE_THRESHOLD - 5);
        } else {
          GRADE_ROUNDING = ['round', 'roundup', 'truncate'].includes(gradingSettings.gradeRounding)
            ? gradingSettings.gradeRounding : GRADE_ROUNDING;
          PASSING_GRADE_THRESHOLD = Number.isFinite(Number(gradingSettings.passingGradeThreshold))
            ? Number(gradingSettings.passingGradeThreshold) : PASSING_GRADE_THRESHOLD;
          WARNING_GRADE_THRESHOLD = Math.max(0, PASSING_GRADE_THRESHOLD - 5);
        }
        BACKEND_TERMS = terms;
        BACKEND_GRADE_ERROR = '';
        if (terms.length) {
          ACADEMIC_PERIODS = terms.map(term => ({
            id: String(term.id),
            name: term.name,
            status: term.status,
            sequenceNumber: term.sequenceNumber
          }));
          ACTIVE_ACADEMIC_PERIOD_ID = String(terms.find(term => term.status === 'active')?.id || ACADEMIC_PERIODS[0].id);
        }
        CURRENT_GRADING_RULES = categories.map(category => ({
          id: category.code,
          label: category.name,
          weight: Number(category.weight) || 0
        }));
        GRADING_RULES_BY_ID = Object.fromEntries(
          CURRENT_GRADING_RULES.map(rule => [String(rule.id || '').toLowerCase(), rule])
        );
        WEIGHTS = Object.fromEntries(
          CURRENT_GRADING_RULES.map(rule => [String(rule.id).toUpperCase(), Number(rule.weight) / 100 || 0])
        );
        renderScoreCategoryTabs();
        renderScoreComponentChoices();
        renderGradingRules();
        refreshAssignmentCategoryOptions();
        const addScoreButton = document.getElementById('addScoreComponentButton');
        addScoreButton.disabled = Boolean(subjectGradingConfig.applicable && !subjectGradingConfig.configured);
        addScoreButton.title = addScoreButton.disabled ? 'This subject’s grading rules are not set up yet. Ask your school administrator for help.' : '';
        return true;
      } catch (error) {
        console.warn('Assignments and scores API could not be loaded.', error.message);
        BACKEND_GRADE_ERROR = error?.message?.startsWith('No grading periods are set up for this school year.')
          ? error.message
          : 'Grade data could not be loaded. Refresh and try again.';
        BACKEND_GRADE_CONTEXT = null;
        BACKEND_CATEGORIES = [];
        BACKEND_SUBJECT_GRADING_CONFIG = null;
        CURRENT_GRADING_RULES = [];
        GRADING_RULES_BY_ID = {};
        WEIGHTS = {};
        CURRENT_GRADE_SCALE = 'standard';
        CURRENT_GRADE_METHOD_LABEL = '';
        BACKEND_SUBJECT_GRADING_CONFIG = null;
        BACKEND_TERMS = [];
        ACADEMIC_PERIODS = [];
        ACTIVE_ACADEMIC_PERIOD_ID = '';
        renderScoreCategoryTabs();
        renderScoreComponentChoices();
        renderGradingRules();
        refreshAssignmentCategoryOptions();
        document.getElementById('addScoreComponentButton').disabled = true;
        document.getElementById('addScoreComponentButton').title = 'Score Recording could not be loaded.';
        return false;
      }
    }

    async function loadBackendAttendanceData() {
      if (!window.EDUGNAY_API?.isBackendAvailable) {
        BACKEND_ATTENDANCE_ERROR = 'Attendance is not available right now. Refresh and try again.';
        return false;
      }

      try {
        const session = await window.EDUGNAY_API.getCurrentUser();
        if (session?.role !== 'teacher') throw new Error('Attendance is available to teachers only.');
        const section = CURRENT_BACKEND_SECTION;
        if (!section) throw new Error('This section is not available to your account.');
        const teacherId = String(session.apiUserId || session.userId);
        if (teacherId !== CURRENT_TEACHER_ID) throw new Error('Your session changed. Reload this page to continue.');
        if (!hasValidBackendSubjectAssignment()) {
          throw new Error('This section has no subject assigned to your account.');
        }
        BACKEND_ATTENDANCE_CONTEXT = {
          sectionId: String(section.id),
          schoolId: section.schoolId,
          teacherId,
          isAdviser: String(section.adviserId || '') === teacherId,
          students: STUDENTS
        };
        BACKEND_ATTENDANCE_BY_DATE.clear();
        BACKEND_ATTENDANCE_ERROR = '';
        BACKEND_ATTENDANCE_HISTORY_ERROR = '';
        if (CURRENT_SUBJECT_ASSIGNMENT) {
          try {
            const history = await window.EDUGNAY_API.getSectionAttendanceHistory(section.id, CURRENT_SUBJECT_ID, CURRENT_COMMUNICATION_COMPONENT_CODE);
            (history.sessions || []).forEach(data => BACKEND_ATTENDANCE_BY_DATE.set(data.attendanceDate, data));
          } catch (error) {
            BACKEND_ATTENDANCE_HISTORY_ERROR = error?.message || 'Attendance history could not be loaded.';
          }
        }
        return true;
      } catch (error) {
        BACKEND_ATTENDANCE_CONTEXT = null;
        BACKEND_ATTENDANCE_ERROR = 'Attendance could not be loaded. Refresh and try again.';
        BACKEND_ATTENDANCE_HISTORY_ERROR = BACKEND_ATTENDANCE_ERROR;
        console.warn('Attendance API could not be initialized.', BACKEND_ATTENDANCE_ERROR);
        return false;
      }
    }

    function renderSharedStudentTable({ students = [], columns = [], meta = '', empty = {}, details = false, loading = false } = {}) {
      const table = document.getElementById('studentTable');
      const tbody = document.getElementById('studentTbody');
      const head = table?.querySelector('thead tr');
      if (!tbody || !head) return;
      tbody.onclick = details ? event => {
        const row = event.target.closest('tr[data-student-id]');
        if (!row || !tbody.contains(row)) return;
        const detailButton = event.target.closest('[data-student-details]');
        const otherControl = event.target.closest('a, button, input, select, textarea');
        if (otherControl && otherControl !== detailButton) return;
        openTeacherStudentDetails(row.dataset.studentId, detailButton || row.querySelector('[data-student-details]'));
      } : null;
      head.innerHTML = columns.map(column => {
        if (column.key !== 'grade') return `<th>${window.EDUGNAY_CONFIG.escapeHtml(column.label || '')}</th>`;
        const periodName = column.periodName || (String(column.label || '').endsWith(' Final Grade')
          ? String(column.label).slice(0, -' Final Grade'.length) : 'Current period');
        return `<th><span id="studentGradePeriodName">${window.EDUGNAY_CONFIG.escapeHtml(periodName)}</span> Final Grade</th>`;
      }).join('');
      const metaNode = document.getElementById('studentListMeta');
      if (loading) {
        tbody.innerHTML = '';
        if (metaNode) metaNode.innerHTML = '';
        const loadingFooter = document.getElementById('studentListFooter');
        if (loadingFooter) loadingFooter.innerHTML = '';
        return;
      }
      tbody.innerHTML = students.length ? students.map((student, index) => {
        const cells = columns.map(column => {
          const columnKey = window.EDUGNAY_CONFIG.escapeHtml(column.key || '');
          if (column.key === 'number') return `<td data-column="${columnKey}" style="color:var(--gray-400);font-size:12px;">${index + 1}</td>`;
          if (column.key === 'student') {
            const name = window.EDUGNAY_CONFIG.escapeHtml(student.displayName || 'Student');
            const nameContent = details && student.id
              ? `<button class="student-name-button" type="button" data-student-details="${window.EDUGNAY_CONFIG.escapeHtml(student.id)}" aria-haspopup="dialog" aria-label="View details for ${name}">${name}</button>`
              : name;
            const mobileDetailsArrow = details && student.id
              ? `<button class="student-roster-arrow" type="button" data-student-details="${window.EDUGNAY_CONFIG.escapeHtml(student.id)}" aria-haspopup="dialog" aria-label="View details for ${name}"><i data-lucide="chevron-right" aria-hidden="true" style="width:16px;height:16px;"></i></button>`
              : '';
            const mobileEmail = window.EDUGNAY_CONFIG.escapeHtml(student.schoolEmail || '');
            return `<td data-column="${columnKey}"><div class="student-cell">${window.EDUGNAY_AVATAR.html(student, { className: 'student-av', role: 'student', size: 'sm' })}<div class="student-roster-info"><div class="student-name">${nameContent}</div><div class="student-roster-mobile-email" aria-hidden="true">${mobileEmail}</div></div>${mobileDetailsArrow}</div></td>`;
          }
          const rendered = typeof column.render === 'function' ? column.render(student) : student[column.key];
          return `<td data-column="${columnKey}">${rendered == null ? '' : typeof column.render === 'function' ? rendered : window.EDUGNAY_CONFIG.escapeHtml(rendered)}</td>`;
        }).join('');
        return `<tr data-student-id="${window.EDUGNAY_CONFIG.escapeHtml(student.id || '')}" data-student-name="${window.EDUGNAY_CONFIG.escapeHtml(String(student.displayName || '').toLocaleLowerCase())}">${cells}</tr>`;
      }).join('') : `<tr class="panel-empty-row"><td colspan="${Math.max(1, columns.length)}">${window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: empty.icon || 'users', title: empty.title || 'No students enrolled', text: empty.text || 'Students assigned to this class will appear here.'
      })}</td></tr>`;
      const count = String(students.length);
      if (metaNode && meta) metaNode.textContent = meta;
      const footer = document.getElementById('studentListFooter');
      if (footer) footer.textContent = `Showing ${count} students`;
      const countNode = document.getElementById('sectionStudentCount');
      if (countNode) countNode.textContent = count;
      const tabCount = document.querySelector('#tab-students .tab-count');
      if (tabCount) tabCount.textContent = count;
      window.lucide?.createIcons?.();
    }

    function renderSharedAttendanceRows({ students = [], recordsByStudent = {}, editable = true, empty = {}, loading = false } = {}) {
      const tbody = document.getElementById('attTbody');
      if (!tbody) return;
      if (loading) {
        tbody.innerHTML = '';
        const footer = document.getElementById('attendanceListFooter');
        if (footer) footer.innerHTML = '';
        return;
      }
      const labels = { P: 'Present', A: 'Absent', L: 'Late', E: 'Excused' };
      tbody.innerHTML = students.length ? students.map((student, index) => {
        const record = recordsByStudent[String(student.id)] || student;
        const selected = ATTENDANCE_CODE_BY_STATUS[record.status || record.attendanceStatus] || '';
        const name = window.EDUGNAY_CONFIG.escapeHtml(student.displayName || 'Student');
        const buttons = ['P', 'A', 'L', 'E'].map(code => `<button type="button" class="att-btn ${code} ${selected === code ? 'selected' : ''}" title="${labels[code]}" aria-label="Mark ${name} ${labels[code].toLowerCase()}" aria-pressed="${selected === code}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { setAtt(this,String(code)) })}" ${editable ? '' : 'disabled'}>${code}</button>`).join('');
        return `<tr class="attendance-entry-row" data-student-id="${window.EDUGNAY_CONFIG.escapeHtml(student.id)}"><td class="attendance-number-cell">${index + 1}</td><td class="attendance-student-cell"><div class="student-cell">${window.EDUGNAY_AVATAR.html(student, { className: 'student-av', role: 'student', size: 'sm' })}<div class="student-name">${name}</div></div></td><td class="center attendance-status-cell"><div class="att-btn-group">${buttons}</div></td><td class="attendance-remarks-cell"><input class="attendance-remarks-input" type="text" value="${window.EDUGNAY_CONFIG.escapeHtml(record.remarks ?? record.remark ?? '')}" placeholder="Optional remark" aria-label="Optional attendance remark for ${name}" data-attendance-remark ${editable ? '' : 'disabled'}></td></tr>`;
      }).join('') : `<tr class="panel-empty-row"><td colspan="4">${window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: empty.icon || 'calendar-check', title: empty.title || 'No attendance roster', text: empty.text || 'Students assigned to this class will appear here for attendance.'
      })}</td></tr>`;
      const footer = document.getElementById('attendanceListFooter');
      if (footer) footer.textContent = `Showing ${students.length} students`;
      updateAttCount();
      window.lucide?.createIcons?.();
    }

    function renderSharedAttendanceHistory({ students = [], dates = [], records = [], error = '', loading = false, emptyText = 'Saved attendance records for this class will appear here.' } = {}) {
      const head = document.getElementById('attendanceHistoryHeadRow');
      const body = document.getElementById('attendanceHistoryTbody');
      if (!head || !body) return;
      const uniqueDates = [...new Set(dates.filter(Boolean))];
      head.innerHTML = `<th class="sticky-col">Student</th>${uniqueDates.map(date => `<th class="center">${window.EDUGNAY_CONFIG.escapeHtml(new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</th>`).join('')}<th class="center" style="background:var(--blue-xpale);color:var(--blue-mid);">Total Absences</th>`;
      const colspan = uniqueDates.length + 2;
      if (loading) {
        body.innerHTML = '';
        window.lucide?.createIcons?.();
        return;
      }
      if (error || !students.length || !uniqueDates.length) {
        body.innerHTML = `<tr class="panel-empty-row"><td colspan="${colspan}">${window.EDUGNAY_CONFIG.renderPanelEmptyState({
          icon: error ? 'triangle-alert' : 'calendar', title: error ? 'Attendance history unavailable' : 'No attendance history',
          text: error || emptyText
        })}</td></tr>`;
        window.lucide?.createIcons?.();
        return;
      }
      const statusByKey = new Map(records.map(record => [`${record.studentId}|${record.date}`, ATTENDANCE_CODE_BY_STATUS[record.status] || '']));
      body.innerHTML = students.map(student => {
        const statuses = uniqueDates.map(date => statusByKey.get(`${student.id}|${date}`) || '');
        const absences = statuses.filter(status => status === 'A').length;
        const tone = absences > 2 ? 'badge-red' : absences > 0 ? 'badge-orange' : 'badge-green';
        return `<tr><td class="sticky-col"><div class="student-name">${window.EDUGNAY_CONFIG.escapeHtml(student.displayName || 'Student')}</div></td>${statuses.map(status => `<td class="center"><span class="att-record-cell ${status ? `att-${status}` : 'att-empty'}">${status || '-'}</span></td>`).join('')}<td class="center"><span class="badge ${tone}">${absences}</span></td></tr>`;
      }).join('');
      window.lucide?.createIcons?.();
    }

    function renderSharedQrAttendanceScans({ students = [], scannedIds = [] } = {}) {
      const scannedSet = new Set(scannedIds.map(String));
      const scanned = students.filter(student => scannedSet.has(String(student.id)));
      const unscanned = students.filter(student => !scannedSet.has(String(student.id)));
      document.getElementById('qrAttendanceProgress').textContent = `${scanned.length} of ${students.length} scanned`;
      document.getElementById('qrScannedCount').textContent = String(scanned.length);
      document.getElementById('qrUnscannedCount').textContent = String(unscanned.length);
      const renderGroup = (rows, isScanned) => rows.length ? rows.map(student => {
        const name = window.EDUGNAY_CONFIG.escapeHtml(student.displayName || 'Student');
        return `<div class="qr-attendance-student">${window.EDUGNAY_AVATAR.html(student, { className: 'qr-attendance-avatar', role: 'student', size: 'sm' })}<span class="qr-attendance-student-name">${name}</span><span class="qr-attendance-state ${isScanned ? 'present' : 'waiting'}"><i data-lucide="${isScanned ? 'check' : 'clock-3'}" aria-hidden="true"></i>${isScanned ? 'Present' : 'Not scanned'}</span></div>`;
      }).join('') : `<div class="qr-attendance-empty">${isScanned ? 'No students scanned yet.' : 'All students have been scanned.'}</div>`;
      document.getElementById('qrScannedStudents').innerHTML = renderGroup(scanned, true);
      document.getElementById('qrUnscannedStudents').innerHTML = renderGroup(unscanned, false);
      window.lucide?.createIcons?.();
    }

    function renderSharedQrAttendanceFinalReview({ students = [], statusByStudent = new Map(), onChange = () => { }, progressLabel } = {}) {
      const list = document.getElementById('qrAttendanceFinalList');
      if (!list) return;
      const statuses = [
        { code: 'P', value: 'present', label: 'Present' },
        { code: 'A', value: 'absent', label: 'Absent' },
        { code: 'L', value: 'late', label: 'Late' },
        { code: 'E', value: 'excused', label: 'Excused' }
      ];
      const getStatus = studentId => statusByStudent instanceof Map
        ? statusByStudent.get(String(studentId)) : statusByStudent[String(studentId)];
      const setStatus = (studentId, status) => {
        if (statusByStudent instanceof Map) statusByStudent.set(String(studentId), status);
        else statusByStudent[String(studentId)] = status;
      };
      list.innerHTML = students.length ? students.map(student => {
        const studentId = String(student.id);
        const name = window.EDUGNAY_CONFIG.escapeHtml(student.displayName || 'Student');
        const selectedStatus = getStatus(studentId);
        const buttons = statuses.map(status => `<button type="button" class="att-btn ${status.code}${selectedStatus === status.value ? ' selected' : ''}" data-qr-student-status="${window.EDUGNAY_CONFIG.escapeHtml(status.value)}" title="${status.label}" aria-label="Mark ${name} ${status.label.toLowerCase()}" aria-pressed="${selectedStatus === status.value}">${status.code}</button>`).join('');
        return `<div class="qr-attendance-final-row" data-qr-student-id="${window.EDUGNAY_CONFIG.escapeHtml(studentId)}">${window.EDUGNAY_AVATAR.html(student, { className: 'qr-attendance-avatar', role: 'student', size: 'sm' })}<span class="qr-attendance-student-name">${name}</span><div class="att-btn-group" role="group" aria-label="Attendance status for ${name}">${buttons}</div></div>`;
      }).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'users', title: 'No students enrolled', text: 'There are no students to review.' });
      const updateProgress = () => {
        const missing = students.filter(student => !getStatus(student.id)).length;
        document.getElementById('qrAttendanceProgress').textContent = progressLabel
          ? progressLabel(missing, students.length) : `${missing} students need a status`;
      };
      list.querySelectorAll('.qr-attendance-final-row').forEach(row => {
        row.querySelectorAll('[data-qr-student-status]').forEach(button => button.addEventListener('click', () => {
          row.querySelectorAll('.att-btn').forEach(option => {
            const selected = option === button;
            option.classList.toggle('selected', selected);
            option.setAttribute('aria-pressed', String(selected));
          });
          setStatus(row.dataset.qrStudentId, button.dataset.qrStudentStatus);
          onChange(row.dataset.qrStudentId, button.dataset.qrStudentStatus);
          updateProgress();
        }));
      });
      updateProgress();
      window.lucide?.createIcons?.();
    }

    function renderSharedGradePreviewRows(container, rows = []) {
      if (!container) return;
      const allowedTones = new Set(['grade-pass', 'grade-warn', 'grade-fail']);
      container.innerHTML = rows.map(row => {
        const tone = allowedTones.has(row.tone) ? row.tone : '';
        const label = row.ariaLabel ? ` aria-label="${window.EDUGNAY_CONFIG.escapeHtml(row.ariaLabel)}"` : '';
        const details = (row.details || []).map(detail => `<small class="publish-preview-detail">${window.EDUGNAY_CONFIG.escapeHtml(detail)}</small>`).join('');
        return `<div class="publish-preview-row"><span>${window.EDUGNAY_CONFIG.escapeHtml(row.name || 'Student')}</span><div class="publish-preview-grade"><strong class="${tone}"${label}>${window.EDUGNAY_CONFIG.escapeHtml(row.value ?? 'Incomplete')}</strong>${details}</div></div>`;
      }).join('');
    }

    function renderSharedAssignmentCards(items = [], empty = {}) {
      const list = document.getElementById('assignmentList');
      if (!list) return;
      if (empty.loading) {
        list.innerHTML = '';
        return;
      }
      const callbacks = new Map();
      let actionNumber = 0;
      const renderAction = action => {
        const key = String(actionNumber++);
        callbacks.set(key, action.onClick);
        const label = window.EDUGNAY_CONFIG.escapeHtml(action.label || 'Open');
        const icon = window.EDUGNAY_CONFIG.escapeHtml(action.icon || 'arrow-right');
        const iconSize = action.menu ? 14 : 13;
        const button = `<button class="${action.menu ? `assignment-menu-item${action.danger ? ' delete' : ''}` : 'top-btn secondary'}" type="button" ${action.menu ? 'role="menuitem"' : ''} data-class-assignment-action="${key}"><i data-lucide="${icon}" aria-hidden="true" style="width:${iconSize}px;height:${iconSize}px;"></i>${label}</button>`;
        return button;
      };
      list.innerHTML = items.length ? items.map(item => {
        const due = window.EDUGNAY_CONFIG.escapeHtml(item.dueLabel || 'No due date');
        const subject = window.EDUGNAY_CONFIG.escapeHtml(item.communicationComponentName || item.subjectName || 'Class assignment');
        const grading = item.gradingLabel ? ` · ${window.EDUGNAY_CONFIG.escapeHtml(item.gradingLabel)}` : '';
        const submission = Number.isFinite(Number(item.submittedCount)) && Number.isFinite(Number(item.totalCount))
          ? ` · ${Number(item.submittedCount)}/${Number(item.totalCount)} submitted` : '';
        const statusValue = String(item.statusLabel || '').trim();
        const statusName = statusValue.toLowerCase() === 'published' ? ''
          : statusValue.toLowerCase() === 'draft' ? 'Draft · Hidden from students' : statusValue;
        const status = statusName ? ` · ${window.EDUGNAY_CONFIG.escapeHtml(statusName)}` : '';
        const pct = Number(item.totalCount) > 0 ? Math.min(100, Math.round(Number(item.submittedCount || 0) / Number(item.totalCount) * 100)) : 0;
        const direct = (item.actions || []).filter(action => !action.menu).map(renderAction).join('');
        const menuActions = (item.actions || []).filter(action => action.menu).map(renderAction).join('');
        const menu = menuActions ? `<div class="assignment-card-menu"><button class="assignment-menu-trigger" type="button" aria-label="Assignment actions" aria-haspopup="menu" aria-expanded="false"><i data-lucide="more-vertical" aria-hidden="true" style="width:16px;height:16px;"></i></button><div class="assignment-action-menu" role="menu">${menuActions}</div></div>` : '';
        const progress = item.totalCount != null ? `<div class="assignment-progress-track"><div class="assignment-progress-fill" style="width:${pct}%;"></div></div>` : '';
        return `<article class="assignment-card"><div class="assignment-card-icon"><i data-lucide="list-checks" aria-hidden="true" style="width:17px;height:17px;"></i></div><div class="assignment-card-body"><div class="assignment-card-title">${window.EDUGNAY_CONFIG.escapeHtml(item.title || 'Assignment')}</div><div class="assignment-card-meta">${subject} · Due ${due}${submission}${grading}${status}</div>${progress}</div><div class="assignment-card-actions">${direct}${menu}</div></article>`;
      }).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: empty.icon || 'clipboard-check', title: empty.title || 'No assignments yet', text: empty.text || 'Assignments created for this class will appear here.'
      });
      list.querySelectorAll('[data-class-assignment-action]').forEach(button => button.addEventListener('click', event => {
        event.preventDefault();
        const callback = callbacks.get(button.dataset.classAssignmentAction);
        if (button.getAttribute('role') === 'menuitem') closeAssignmentMenus();
        callback?.(button);
      }));
      list.querySelectorAll('.assignment-card-menu').forEach(container => {
        const button = container.querySelector('.assignment-menu-trigger');
        const menu = container.querySelector('.assignment-action-menu');
        button.addEventListener('click', event => {
          event.stopPropagation();
          const open = !menu.classList.contains('open');
          closeAssignmentMenus();
          if (!open) return;
          menu.classList.add('open');
          button.setAttribute('aria-expanded', 'true');
        });
      });
      window.lucide?.createIcons?.();
    }

    function renderSharedMaterials(items = [], empty = {}) {
      const list = document.getElementById('teacherMaterialsList');
      if (!list) return;
      if (empty.loading) {
        list.innerHTML = '';
        return;
      }
      const metaByType = TEACHER_MATERIAL_TYPE_META;
      list.innerHTML = items.length ? items.map(item => {
        const extension = String(item.type || 'pdf').toLowerCase().replace(/^.*\./, '');
        const meta = metaByType[extension] || metaByType.pdf;
        const draft = item.status === 'draft';
        const status = draft ? 'Draft · Hidden from students' : 'Visible to students';
        const size = item.fileSize || (Number.isFinite(Number(item.fileSizeBytes)) ? formatMaterialFileSize(Number(item.fileSizeBytes)) : 'Size unavailable');
        const date = item.postedAt || item.createdAt;
        const dateLabel = formatTeacherMaterialDate(date);
        const preview = !draft && item.id ? `<a class="row-btn edit" href="${window.EDUGNAY_CONFIG.escapeHtml(window.EDUGNAY_API.materialFileUrl(item.id))}" target="_blank" rel="noopener" data-material-action="preview" data-material-id="${window.EDUGNAY_CONFIG.escapeHtml(item.id)}"><i data-lucide="eye" aria-hidden="true" style="width:11px;height:11px;"></i> Preview</a>` : '';
        const publish = draft && item.id && !item.legacyCommunication && item.canEdit !== false ? `<button class="row-btn edit" type="button" data-material-action="publish" data-material-id="${window.EDUGNAY_CONFIG.escapeHtml(item.id)}"><i data-lucide="send" aria-hidden="true" style="width:11px;height:11px;"></i> Publish</button>` : '';
        const remove = item.id && !item.legacyCommunication && item.canDelete !== false ? `<button class="row-btn danger" type="button" data-material-action="remove" data-material-id="${window.EDUGNAY_CONFIG.escapeHtml(item.id)}" data-material-title="${window.EDUGNAY_CONFIG.escapeHtml(item.title || 'Learning material')}" aria-label="Permanently delete ${window.EDUGNAY_CONFIG.escapeHtml(item.title || 'learning material')}"><i data-lucide="trash-2" aria-hidden="true" style="width:11px;height:11px;"></i></button>` : '';
        const statusColor = draft ? 'var(--orange-dark)' : 'var(--green)';
        return `<article class="material-item"><div class="material-icon" style="background:${meta.bg};"><i data-lucide="${meta.icon}" aria-hidden="true" style="width:18px;height:18px;color:${meta.color};"></i></div><div class="material-info"><div class="material-name">${window.EDUGNAY_CONFIG.escapeHtml(item.title || 'Learning material')}</div><div class="material-meta">${window.EDUGNAY_CONFIG.escapeHtml(meta.label)} · ${window.EDUGNAY_CONFIG.escapeHtml(size)} · Uploaded ${window.EDUGNAY_CONFIG.escapeHtml(dateLabel)} · <span style="color:${statusColor};font-weight:600;">${status}</span></div></div><div class="material-actions">${publish}${preview}${remove}</div></article>`;
      }).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: empty.icon || 'folder-open', title: empty.title || 'No learning materials', text: empty.text || 'Files shared with this class will appear here.'
      });
      const count = document.querySelector('#tab-materials .tab-count');
      if (count) count.textContent = String(items.length);
      window.lucide?.createIcons?.();
    }

    function renderSharedAssignmentSubmissions({ subtitle = '', columns = [], rows = [], empty = {}, error = '', loading = false } = {}) {
      const modal = document.getElementById('assignmentSubmissionsModal');
      const head = modal?.querySelector('thead tr');
      const body = document.getElementById('assignmentSubmissionsTbody');
      if (!head || !body) return;
      if (subtitle) document.getElementById('assignmentSubmissionsModalSub').textContent = subtitle;
      head.innerHTML = columns.map(column => `<th>${window.EDUGNAY_CONFIG.escapeHtml(column.label || '')}</th>`).join('');
      if (loading) {
        body.innerHTML = '';
        window.lucide?.createIcons?.();
        return;
      }
      if (error || !rows.length) {
        const state = error
          ? { icon: 'triangle-alert', title: 'Submissions unavailable', text: error }
          : { icon: 'inbox', title: 'No submissions yet', text: 'Student submissions will appear here.', ...empty };
        body.innerHTML = `<tr class="panel-empty-row"><td colspan="${Math.max(1, columns.length)}">${window.EDUGNAY_CONFIG.renderPanelEmptyState(state)}</td></tr>`;
        window.lucide?.createIcons?.();
        return;
      }
      body.innerHTML = rows.map(row => `<tr>${columns.map(column => {
        const value = typeof column.render === 'function' ? column.render(row) : row[column.key];
        return `<td>${value == null ? '' : typeof column.render === 'function' ? value : window.EDUGNAY_CONFIG.escapeHtml(value)}</td>`;
      }).join('')}</tr>`).join('');
      window.lucide?.createIcons?.();
    }

    function renderSharedScoreCategories(tabs, categories = [], onChange = () => { }) {
      if (!tabs) return;
      const unique = categories.filter((category, index) => category.code
        && categories.findIndex(other => String(other.code).toUpperCase() === String(category.code).toUpperCase()) === index);
      tabs.innerHTML = [{ code: 'all', name: 'All Components' }, ...unique].map((category, index) => {
        const code = index === 0 ? 'all' : String(category.code).toUpperCase();
        const type = String(category.componentType || code).toLowerCase();
        const icon = type.includes('written') || type === 'ww' ? 'pencil'
          : type.includes('performance') || type === 'pt' ? 'target'
            : type.includes('exam') || type === 'qa' ? 'clipboard-list' : '';
        return `<button class="cat-tab ${index === 0 ? 'active' : ''}" type="button" data-cat="${window.EDUGNAY_CONFIG.escapeHtml(code)}">${icon ? `<i data-lucide="${icon}" aria-hidden="true" style="width:12px;height:12px;"></i>` : ''}${window.EDUGNAY_CONFIG.escapeHtml(category.name)}${category.weight == null ? '' : ` <span class="cat-weight">${Number(category.weight) || 0}%</span>`}</button>`;
      }).join('');
      tabs.querySelectorAll('.cat-tab').forEach(button => button.addEventListener('click', () => {
        tabs.querySelectorAll('.cat-tab').forEach(tab => tab.classList.toggle('active', tab === button));
        onChange(button.dataset.cat);
      }));
      window.lucide?.createIcons?.();
    }

    function renderSharedComponentChoices(host, components = []) {
      host.innerHTML = components.map((component, index) => `<button class="comp-type-opt ${window.EDUGNAY_CONFIG.escapeHtml(component.css || '')}${index === 0 ? ' selected' : ''}" type="button" data-cat="${window.EDUGNAY_CONFIG.escapeHtml(component.categoryCode || '')}" data-component-code="${window.EDUGNAY_CONFIG.escapeHtml(component.code || '')}" aria-pressed="${index === 0}">
      <span class="comp-type-icon"><i data-lucide="${window.EDUGNAY_CONFIG.escapeHtml(component.icon || 'clipboard-list')}" aria-hidden="true"></i></span>
      <span class="comp-type-name">${window.EDUGNAY_CONFIG.escapeHtml(component.name || '')}</span>
      <span class="comp-type-cat">${Number(component.weight) || 0}% of final grade</span>
    </button>`).join('');
      window.lucide?.createIcons?.();
    }

    function filterSharedScoreTable(host, category = 'all') {
      if (!host) return;
      const query = host.querySelector('#scoreStudentSearch')?.value.trim().toLocaleLowerCase() || '';
      const rows = [...host.querySelectorAll('#scoreTbody tr[data-student-name]')];
      let visible = 0;
      rows.forEach(row => {
        row.hidden = !row.dataset.studentName.includes(query);
        if (!row.hidden) visible++;
      });
      host.querySelectorAll('#scoreTheadRow [data-cat], #scoreTbody [data-cat]').forEach(cell => {
        cell.hidden = category !== 'all' && cell.dataset.cat !== category;
      });
      const footer = host.querySelector('#scoreListFooter');
      if (footer) footer.textContent = rows.length ? `Showing ${visible} of ${rows.length} students` : 'No students enrolled';
    }

    function renderSharedScoreTable({ host, items = [], students = [], metricHeaders = [], getScore = () => null,
      getMetrics = () => [], writable = true, onScoreInput = () => { }, scoreEvent = 'change', empty = {}, loading = false } = {}) {
      const thead = host?.querySelector('#scoreTheadRow');
      const tbody = host?.querySelector('#scoreTbody');
      if (!thead || !tbody) return;
      if (loading) {
        tbody.innerHTML = '';
        const footer = host.querySelector('#scoreListFooter');
      if (footer) footer.innerHTML = '';
        return;
      }
      thead.innerHTML = '<th class="sticky-col" style="min-width:180px;"># Student</th>' + items.map(item => {
        const code = String(item.categoryCode || '').toUpperCase();
        const tone = code === 'PT' ? 'type-pt' : code === 'QA' ? 'type-qa' : 'type-ww';
        const categoryName = item.categoryName || code || 'Assessment';
        const actions = item.canDelete ? `<button class="score-comp-menu-trigger" type="button" data-component-id="${window.EDUGNAY_CONFIG.escapeHtml(item.id)}" aria-label="Actions for ${window.EDUGNAY_CONFIG.escapeHtml(item.title)}" aria-haspopup="menu" aria-expanded="false"><i data-lucide="more-vertical" aria-hidden="true"></i></button>` : '';
        return `<th class="comp-head-cell center" data-cat="${window.EDUGNAY_CONFIG.escapeHtml(code)}"><div class="comp-head-inner"><div class="comp-head-title"><div class="comp-head-name" title="${window.EDUGNAY_CONFIG.escapeHtml(item.title)}">${window.EDUGNAY_CONFIG.escapeHtml(item.title)}</div>${actions}</div><div class="comp-head-max">/ ${Number(item.maxScore) || 0}</div><div class="comp-head-type ${tone}" data-category-name="${window.EDUGNAY_CONFIG.escapeHtml(categoryName)}" title="${window.EDUGNAY_CONFIG.escapeHtml(categoryName)}">${window.EDUGNAY_CONFIG.escapeHtml(item.categoryHeader || categoryName)}</div>${item.examPartName ? `<div class="comp-head-journal">${window.EDUGNAY_CONFIG.escapeHtml(item.examPartName)}</div>` : ''}</div></th>`;
      }).join('') + metricHeaders.map(metric => `<th class="center ${window.EDUGNAY_CONFIG.escapeHtml(metric.className || '')}" style="${window.EDUGNAY_CONFIG.escapeHtml(metric.style || '')}" title="${window.EDUGNAY_CONFIG.escapeHtml(metric.title || metric.label)}">${window.EDUGNAY_CONFIG.escapeHtml(metric.label)}</th>`).join('');
      const colspan = 1 + items.length + metricHeaders.length;
      if (!items.length || !students.length) {
        const state = !items.length ? empty.noItems || { icon: 'clipboard-list', title: 'No score components yet', text: 'Add score components for this grading period to begin recording grades.' }
          : empty.noStudents || { icon: 'users', title: 'No students enrolled', text: 'Students enrolled in this class will appear here.' };
        tbody.innerHTML = `<tr class="panel-empty-row"><td colspan="${colspan}">${window.EDUGNAY_CONFIG.renderPanelEmptyState(state)}</td></tr>`;
        const footer = host.querySelector('#scoreListFooter');
        if (footer) footer.textContent = students.length ? `${students.length} students enrolled` : 'No students enrolled';
        window.lucide?.createIcons?.();
        return;
      }
      tbody.innerHTML = students.map((student, index) => {
        const studentId = String(student.studentId || student.id);
        const name = student.studentName || student.displayName || 'Student';
        const cells = items.map(item => {
          const score = getScore(student, item) || {};
          const value = score.score == null ? '' : score.score;
          const correction = score.correctionRequired
            ? `<input class="form-input" type="text" data-correction-reason="${window.EDUGNAY_CONFIG.escapeHtml(item.id)}" minlength="10" maxlength="500" placeholder="Reason for correction (required)" aria-label="Correction reason for ${window.EDUGNAY_CONFIG.escapeHtml(name)} ${window.EDUGNAY_CONFIG.escapeHtml(item.title)}" ${writable ? '' : 'disabled'}>` : '';
          return `<td class="center" data-cat="${window.EDUGNAY_CONFIG.escapeHtml(String(item.categoryCode || '').toUpperCase())}" data-exam-part-id="${window.EDUGNAY_CONFIG.escapeHtml(item.examPartId || '')}" data-domain-code="${window.EDUGNAY_CONFIG.escapeHtml(item.domainCode || '')}"><input class="score-input" type="number" min="0" max="${Number(item.maxScore) || 0}" step="0.01" value="${window.EDUGNAY_CONFIG.escapeHtml(value)}" data-score-item="${window.EDUGNAY_CONFIG.escapeHtml(item.id)}" data-score-id="${window.EDUGNAY_CONFIG.escapeHtml(`${studentId}:${item.id}`)}" data-grading-item-id="${window.EDUGNAY_CONFIG.escapeHtml(item.gradingItemId || item.id)}" data-academic-period-id="${window.EDUGNAY_CONFIG.escapeHtml(item.academicPeriodId || '')}" data-student-id="${window.EDUGNAY_CONFIG.escapeHtml(studentId)}" aria-label="${window.EDUGNAY_CONFIG.escapeHtml(item.title)} score for ${window.EDUGNAY_CONFIG.escapeHtml(name)}" ${writable ? '' : 'disabled'}>${correction}</td>`;
        }).join('');
        const metricCells = getMetrics(student, index).map(metric => `<td class="center ${window.EDUGNAY_CONFIG.escapeHtml(metric.className || 'computed-cell')}" style="${window.EDUGNAY_CONFIG.escapeHtml(metric.style || '')}">${metric.value == null ? '—' : window.EDUGNAY_CONFIG.escapeHtml(metric.value)}${metric.detail ? `<small>${window.EDUGNAY_CONFIG.escapeHtml(metric.detail)}</small>` : ''}</td>`).join('');
        return `<tr data-student-name="${window.EDUGNAY_CONFIG.escapeHtml(String(name).toLocaleLowerCase())}" data-student-id="${window.EDUGNAY_CONFIG.escapeHtml(studentId)}"><th scope="row" class="sticky-col"><div class="student-cell">${window.EDUGNAY_AVATAR.html(student, { className: 'student-av', role: 'student', size: 'sm' })}<div><div class="student-name">${window.EDUGNAY_CONFIG.escapeHtml(name)}</div><div class="student-num">#${index + 1}</div></div></div></th>${cells}${metricCells}</tr>`;
      }).join('');
      tbody.querySelectorAll('.score-input').forEach(input => input.addEventListener(scoreEvent, () => onScoreInput(input)));
      filterSharedScoreTable(host, host.querySelector('.cat-tab.active')?.dataset.cat || 'all');
      window.lucide?.createIcons?.();
    }

    window.TeacherClassViews = {
      renderStudents: renderSharedStudentTable,
      openStudentDetails: openTeacherStudentDetails,
      updateSectionHeaderFromGradebook: academicPeriodId => {
        if (!academicPeriodId) return;
        ACTIVE_ACADEMIC_PERIOD_ID = String(academicPeriodId);
        updateSectionHeader(ACTIVE_ACADEMIC_PERIOD_ID);
      },
      renderAttendanceRows: renderSharedAttendanceRows,
      renderAttendanceHistory: renderSharedAttendanceHistory,
      renderQrAttendanceScans: renderSharedQrAttendanceScans,
      renderQrAttendanceFinalReview: renderSharedQrAttendanceFinalReview,
      renderGradePreviewRows: renderSharedGradePreviewRows,
      renderAssignments: renderSharedAssignmentCards,
      renderMaterials: renderSharedMaterials,
      renderAssignmentSubmissions: renderSharedAssignmentSubmissions,
      renderScoreCategories: renderSharedScoreCategories,
      renderComponentChoices: renderSharedComponentChoices,
      filterScores: filterSharedScoreTable,
      renderScoreTable: renderSharedScoreTable
    };

    function renderTeacherStudentList() {
      const tbody = document.getElementById('studentTbody');
      if (!tbody) return;
      const students = isBackendGradeMode() ? getGradeStudents()
        : (getAttendanceStudents().length ? getAttendanceStudents() : STUDENTS);
      const attendanceByStudent = new Map();
      if (isBackendAttendanceMode() && !BACKEND_ATTENDANCE_HISTORY_ERROR) {
        getTeacherAttendanceRecords().forEach(record => {
          const records = attendanceByStudent.get(record.studentId) || [];
          records.push(record);
          attendanceByStudent.set(record.studentId, records);
        });
      }
      const selectedPeriod = document.getElementById('academicPeriodSelect')?.value || ACTIVE_ACADEMIC_PERIOD_ID;
      const publishedGrades = isBackendGradeMode() ? getPublishedGradesForPeriod(selectedPeriod) : [];
      const gradesByStudent = new Map(publishedGrades.map(grade => [String(grade.studentId), grade]));
      const progressByStudent = Object.fromEntries(students.map(student => {
        const attendanceRecords = attendanceByStudent.get(String(student.id)) || [];
        const attended = attendanceRecords.filter(record => ['present', 'late', 'excused'].includes(record.status)).length;
        const attendanceRateValue = attendanceRecords.length ? Math.round(attended / attendanceRecords.length * 100) : null;
        const grade = gradesByStudent.get(String(student.id));
        return [String(student.id), {
          attendanceRate: attendanceRecords.length ? `${Math.round(attended / attendanceRecords.length * 100)}%` : '—',
          attendanceTone: attendanceRateValue == null ? 'gray' : attendanceRateValue >= 90 ? 'green' : attendanceRateValue >= 75 ? 'orange' : 'red',
          grade: grade ? Number(grade.finalGrade).toFixed(0) : '—',
          gradeTone: grade ? getGradeStatusTone(grade.finalGrade) : 'grade-unavailable'
        }];
      }));

      const count = String(students.length);
      document.getElementById('studentCount').textContent = count;
      window.TeacherClassViews.renderStudents({
        students,
        columns: [
          { key: 'number', label: '#' },
          { key: 'student', label: 'Student' },
          { key: 'schoolEmail', label: 'School Email', render: student => `<span class="student-num">${window.EDUGNAY_CONFIG.escapeHtml(student.schoolEmail || '')}</span>` },
          { key: 'attendanceRate', label: 'Attendance Rate', render: student => { const progress = progressByStudent[String(student.id)]; return `<span class="badge badge-${progress.attendanceTone}">${progress.attendanceRate}</span>`; } },
          { key: 'grade', label: `${document.getElementById('studentGradePeriodName')?.textContent || 'Current period'} Final Grade`, render: student => { const progress = progressByStudent[String(student.id)]; return `<span class="published-grade-value ${progress.gradeTone}">${progress.grade}</span>`; } }
        ],
        meta: `${CURRENT_SECTION} · ${count} enrolled ${students.length === 1 ? 'student' : 'students'}`,
        empty: { icon: 'users', title: 'No students enrolled', text: 'Students assigned to this section will appear here.' },
        details: BACKEND_SECTION_MODE
      });
      const metaNode = document.getElementById('studentListMeta');
      const progressNotes = [];
      if (STUDENT_LIST_GRADE_ERROR) progressNotes.push('Final grades unavailable');
      if (isBackendAttendanceMode() && BACKEND_ATTENDANCE_HISTORY_ERROR) progressNotes.push('Attendance rates unavailable');
      if (metaNode) {
        metaNode.textContent = CURRENT_SECTION + ' · ' + count + ' enrolled '
          + (students.length === 1 ? 'student' : 'students')
          + (progressNotes.length ? ' · ' + progressNotes.join(' · ') : '');
      }
    }

    function renderTeacherAttendanceRows() {
      const tbody = document.getElementById('attTbody');
      if (!tbody) return;
      const attendanceStudents = getAttendanceStudents();
      const recordsByStudent = Object.fromEntries(getTeacherAttendanceRecords(APP_TODAY).map(record => [record.studentId, record]));

      window.TeacherClassViews.renderAttendanceRows({
        students: attendanceStudents, recordsByStudent,
        editable: true,
        empty: BACKEND_ATTENDANCE_ERROR
          ? { icon: 'triangle-alert', title: 'Attendance unavailable', text: BACKEND_ATTENDANCE_ERROR }
          : { icon: 'calendar-check', title: 'No students enrolled', text: 'Confirmed class placements will appear here.' }
      });
    }

    function renderAttendanceHistory() {
      const tbody = document.getElementById('attendanceHistoryTbody');
      if (!tbody) return;
      const attendanceStudents = getAttendanceStudents();
      const attendanceRecords = getTeacherAttendanceRecords();
      const dates = Array.from(BACKEND_ATTENDANCE_BY_DATE.entries())
        .filter(([, data]) => data.session?.status === 'confirmed')
        .map(([date]) => date);
      if (isBackendAttendanceMode() && BACKEND_ATTENDANCE_HISTORY_ERROR) {
        window.TeacherClassViews.renderAttendanceHistory({ students: attendanceStudents, dates, records: attendanceRecords, error: BACKEND_ATTENDANCE_HISTORY_ERROR });
        return;
      }
      window.TeacherClassViews.renderAttendanceHistory({
        students: attendanceStudents, dates, records: attendanceRecords,
        emptyText: 'Saved attendance records for this class will appear here.'
      });
    }

    let TEACHER_SECTION_SCHOOL_ID = window.EDUGNAY_CONFIG.getActiveSchoolId();
    let pendingReopenAcademicPeriodId = null;
    let reopenExpirationTimer = null;
    let gradeAccessRequestNumber = 0;
    const gradeEditAccessByTerm = new Map();

    function academicPeriodName(periodId) {
      return ACADEMIC_PERIODS.find(period => period.id === periodId)?.name || 'Grading period';
    }

    function setSectionPeriodHeader(terms) {
      const termList = Array.isArray(terms) ? terms : [];
      const resolvedTerm = termList.find(term => term.status === 'active') || termList[0] || null;
      ACTIVE_ACADEMIC_PERIOD_ID = String(resolvedTerm?.id || '');
      const periodName = ACTIVE_ACADEMIC_PERIOD_ID ? String(resolvedTerm?.name || '').trim() : '';
      const header = document.getElementById('sectionPeriodName');
      if (header) header.textContent = periodName || 'Grading period unavailable';
      document.getElementById('sectionPeriodMeta')?.removeAttribute('hidden');
    }

    function isReopenBackendMode() {
      return Boolean(window.EDUGNAY_API?.isBackendAvailable);
    }

    function findReopenRequest(academicPeriodId) {
      const termId = getBackendTermId(academicPeriodId);
      return termId ? gradeEditAccessByTerm.get(String(termId))?.request || null : null;
    }

    function openReopenModal() {
      document.getElementById('reopenModalSub').textContent =
        'Ask the admin to unlock ' + academicPeriodName(pendingReopenAcademicPeriodId) + ' for ' + CURRENT_SECTION + ' · ' + CURRENT_SUBJECT + '.';
      document.getElementById('reopenReasonInput').value = '';
      document.getElementById('reopenRequestFeedback').hidden = true;
      openModal('reopenRequestModal');
    }

    async function submitReopenRequest() {
      const reason = document.getElementById('reopenReasonInput').value.trim();
      const feedback = document.getElementById('reopenRequestFeedback');
      feedback.hidden = true;
      if (!reason) {
        feedback.textContent = 'Please describe why you need this grading period reopened.';
        feedback.hidden = false;
        return;
      }
      const academicTermId = getBackendTermId(pendingReopenAcademicPeriodId);
      if (!isBackendGradeMode() || !academicTermId) {
        feedback.textContent = 'That grading period is not available. Refresh and try again.';
        feedback.hidden = false;
        return;
      }

      const button = document.getElementById('submitReopenRequestButton');
      if (button.disabled) return;
      const originalButton = button.innerHTML;
      button.disabled = true;
      button.textContent = 'Sending...';
      let submitted = false;
      try {
        await window.EDUGNAY_API.createGradingPeriodReopenRequest({
          sectionId: CURRENT_SECTION_ID,
          subjectId: CURRENT_SUBJECT_ID,
          academicTermId,
          reason
        });
        submitted = true;
        closeModal('reopenRequestModal');
        await switchAcademicPeriod(pendingReopenAcademicPeriodId);
        showAppToast('Reopen request submitted.');
      } catch (error) {
        if (submitted) showAppToast('Reopen request submitted, but the status could not refresh. Reload the page to verify it.', 'info');
        else {
          feedback.textContent = error.message || 'The reopen request could not be sent.';
          feedback.hidden = false;
        }
      } finally {
        button.disabled = false;
        button.innerHTML = originalButton;
        lucide.createIcons();
      }
    }

    function renderLockBannerState(academicPeriodId, access, reopened) {
      pendingReopenAcademicPeriodId = academicPeriodId;
      const req = findReopenRequest(academicPeriodId);
      const periodName = academicPeriodName(academicPeriodId);
      const titleEl = document.getElementById('quarterLockTitle');
      const descEl = document.getElementById('quarterLockDesc');
      const actionEl = document.getElementById('quarterLockAction');
      const banner = document.getElementById('quarterLockBanner');
      banner.classList.remove('is-reopened');
      const adminMessage = req?.extensionReason || req?.adminNote;
      const requestState = req?.status;

      const period = ACADEMIC_PERIODS.find(item => item.id === academicPeriodId);
      const termStatus = access?.termStatus || period?.status;

      if (access?.error) {
        banner.style.background = 'var(--gray-100)';
        titleEl.style.color = 'var(--gray-700)';
        titleEl.textContent = 'Editing access could not be verified';
        descEl.textContent = access.error;
        actionEl.innerHTML = '';
      } else if (access?.academicYearStatus && access.academicYearStatus !== 'active') {
        banner.style.background = 'var(--gray-100)';
        titleEl.style.color = 'var(--gray-700)';
        titleEl.textContent = access.academicYearStatus === 'archived' ? 'School year archived' : 'School year is closed';
        descEl.textContent = 'Records outside the active school year are read-only.';
        actionEl.innerHTML = '';
      } else if (termStatus === 'upcoming') {
        banner.style.background = 'var(--gray-100)';
        titleEl.style.color = 'var(--gray-700)';
        titleEl.textContent = periodName + ' has not started';
        descEl.textContent = 'Scores become editable after the school administrator starts this grading period.';
        actionEl.innerHTML = '';
      } else if (reopened) {
        banner.classList.add('is-reopened');
        banner.style.background = '#f0fdf4';
        titleEl.style.color = 'var(--green-dark)';
        titleEl.textContent = periodName + ' temporarily reopened';
        descEl.textContent = 'Scores are editable until ' + window.EDUGNAY_CONFIG.formatDateTime(req.expiresAt) + (adminMessage ? '. Admin note: "' + adminMessage + '"' : '.');
        actionEl.innerHTML = '<span class="badge badge-green"><i data-lucide="unlock" style="width:10px;height:10px;"></i> Reopened</span>';
      } else if (req && requestState === 'pending') {
        banner.style.background = 'var(--gray-100)';
        titleEl.style.color = 'var(--gray-700)';
        titleEl.textContent = 'Reopen Requested: Awaiting Admin Response';
        descEl.textContent = 'You asked to reopen ' + periodName + ' on ' +
          new Date(req.requestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '. You\'ll be notified once the admin responds.';
        actionEl.innerHTML = '<span class="badge badge-gray"><i data-lucide="clock" style="width:10px;height:10px;"></i> Pending</span>';
      } else if (req && requestState === 'rejected') {
        banner.style.background = 'var(--gray-100)';
        titleEl.style.color = 'var(--gray-700)';
        titleEl.textContent = 'Reopen Request Rejected';
        descEl.textContent = req.adminNote ? 'Administrator’s note: "' + req.adminNote + '"' : 'Your request was not approved. This grading period is read-only.';
        actionEl.innerHTML = '<button class="top-btn secondary" data-page-click="gc9daf67aebf2"><i data-lucide="unlock" style="width:13px;height:13px;"></i> Request Again</button>';
      } else if (req && requestState === 'revoked') {
        banner.style.background = 'var(--gray-100)';
        titleEl.style.color = 'var(--gray-700)';
        titleEl.textContent = 'Grade-editing access ended';
        descEl.textContent = req.revokeReason ? 'School administrator’s note: "' + req.revokeReason + '"' : 'You can no longer change grades for this period.';
        actionEl.innerHTML = '<button class="top-btn secondary" data-page-click="gc9daf67aebf2"><i data-lucide="unlock" style="width:13px;height:13px;"></i> Request Again</button>';
      } else if (req && requestState === 'expired') {
        banner.style.background = 'var(--gray-100)';
        titleEl.style.color = 'var(--gray-700)';
        titleEl.textContent = 'Grade-editing access ended';
        descEl.textContent = req.expiresAt
          ? 'Your approved editing period ended on ' + window.EDUGNAY_CONFIG.formatDateTime(req.expiresAt) + '.'
          : 'This approval is no longer active. Ask your school administrator if you still need to change grades.';
        actionEl.innerHTML = '<button class="top-btn secondary" data-page-click="gc9daf67aebf2"><i data-lucide="unlock" style="width:13px;height:13px;"></i> Request Again</button>';
      } else {
        banner.style.background = 'var(--gray-100)';
        titleEl.style.color = 'var(--gray-700)';
        titleEl.textContent = periodName + ' is closed';
        descEl.textContent = 'Grades for this period cannot be changed right now. You can ask your school administrator to reopen it.';
        actionEl.innerHTML = '<button class="top-btn secondary" data-page-click="gc9daf67aebf2"><i data-lucide="unlock" style="width:13px;height:13px;"></i> Request Reopen</button>';
      }
      lucide.createIcons();
    }

    async function switchAcademicPeriod(academicPeriodId) {
      const period = ACADEMIC_PERIODS.find(item => item.id === academicPeriodId);
      const requestNumber = ++gradeAccessRequestNumber;
      pendingReopenAcademicPeriodId = academicPeriodId;
      let access = null;

      if (isReopenBackendMode()) {
        document.querySelectorAll('#scoreTable .score-input:not(.readonly-score)').forEach(input => { input.disabled = true; });
        const headActions = document.querySelector('#content-scores .panel-head-actions');
        if (headActions) headActions.style.display = 'none';
        const academicTermId = getBackendTermId(academicPeriodId);
        try {
          if (!academicTermId || !BACKEND_GRADE_CONTEXT?.sectionId || !BACKEND_GRADE_CONTEXT?.subjectId) {
            throw new Error('The section, subject, or grading period is unavailable.');
          }
          access = await window.EDUGNAY_API.getGradeEditAccess({
            sectionId: BACKEND_GRADE_CONTEXT.sectionId,
            subjectId: BACKEND_GRADE_CONTEXT.subjectId,
            academicTermId
          });
        } catch (error) {
          access = { canEdit: false, termStatus: period?.status, error: 'We could not confirm that you can edit this item. Refresh and try again.' };
        }
        if (requestNumber !== gradeAccessRequestNumber) return;
        if (academicTermId) gradeEditAccessByTerm.set(String(academicTermId), access);
      }

      const req = findReopenRequest(academicPeriodId);
      const reopened = isReopenBackendMode() && access?.termStatus === 'closed' && access?.canEdit === true;
      const locked = isReopenBackendMode()
        ? access?.canEdit !== true
        : period?.status !== 'active' && !reopened;

      clearTimeout(reopenExpirationTimer);
      reopenExpirationTimer = null;
      if (reopened) {
        const remaining = new Date(req.expiresAt).getTime() - Date.now();
        if (remaining > 0) reopenExpirationTimer = setTimeout(() => switchAcademicPeriod(academicPeriodId), Math.min(remaining + 50, 2147483647));
      }

      renderScoreTable(academicPeriodId);
      renderTeacherStudentList();
      document.getElementById('scorePanelPeriodName').textContent = period?.name || 'Grading period';
      document.getElementById('publishedPeriodName').textContent = period?.name || 'Grading period';
      updatePublishedGradesBanner(academicPeriodId);

      const showLockBanner = locked || reopened;
      document.getElementById('quarterLockBanner').style.display = showLockBanner ? 'flex' : 'none';
      document.getElementById('quarterLockBadge').style.display = locked ? 'inline-flex' : 'none';
      if (showLockBanner) renderLockBannerState(academicPeriodId, access, reopened);

      document.querySelectorAll('#scoreTable .score-input:not(.readonly-score)').forEach(inp => {
        inp.disabled = locked;
      });

      const headActions = document.querySelector('#content-scores .panel-head-actions');
      if (headActions) headActions.style.display = locked ? 'none' : 'flex';
      const publishButton = document.getElementById('publishGradesButton');
      if (publishButton) publishButton.style.display = canPublishGradePeriod(academicPeriodId) ? 'inline-flex' : 'none';
      const republishButton = document.getElementById('republishGradesButton');
      if (republishButton && !canPublishGradePeriod(academicPeriodId)) republishButton.style.display = 'none';
      updateScoreFooter();
    }

    function hasScoreEditingAccess(academicPeriodId) {
      if (isReopenBackendMode()) {
        const termId = getBackendTermId(academicPeriodId);
        return Boolean(termId && gradeEditAccessByTerm.get(String(termId))?.canEdit === true);
      }
      const period = ACADEMIC_PERIODS.find(item => item.id === academicPeriodId);
      return period?.status === 'active';
    }

    function canPublishGradePeriod(academicPeriodId) {
      const period = ACADEMIC_PERIODS.find(item => item.id === academicPeriodId);
      if (!isReopenBackendMode()) return period?.status === 'active';
      if (!isBackendGradeMode()) return false;
      const termId = getBackendTermId(academicPeriodId);
      const access = termId ? gradeEditAccessByTerm.get(String(termId)) : null;
      return access?.canEdit === true && access?.academicYearStatus === 'active'
        && ['active', 'closed'].includes(period?.status);
    }

    function requireScoreEditingAccess(academicPeriodId, showAlert = true) {
      if (hasScoreEditingAccess(academicPeriodId)) return true;
      const message = academicPeriodName(academicPeriodId) + ' is not active. Your score changes were not saved.';
      Object.entries(scoreSaveTimers).forEach(([scoreId, timer]) => {
        const record = pendingBackendScoreValues.get(scoreId);
        if (record?.academicPeriodId !== academicPeriodId) return;
        clearTimeout(timer);
        delete scoreSaveTimers[scoreId];
        record.failed = true;
        record.error = message;
      });
      updateScoreFooter();
      void switchAcademicPeriod(document.getElementById('academicPeriodSelect').value);
      if (showAlert) alert(academicPeriodName(academicPeriodId) + ' is not active. Ask your school administrator to review access before changing grades.');
      return false;
    }

    /* ── COMPONENT TYPE MODAL ── */
    const LEGACY_SCORE_COMPONENT_CHOICES = document.getElementById('compTypeOpts').innerHTML;
    let selectedCompType = 'Quiz';
    let selectedCompCat = 'WW';
    function renderGradingRules() {
      const weights = BACKEND_SUBJECT_GRADING_CONFIG?.applicable
        ? BACKEND_CATEGORIES.map(category => `${category.name} ${Number(category.weight) || 0}%`).join(' · ')
        : ['WW', 'PT', 'QA'].map(category => `${category} ${gradingWeight(category)}%`).join(' · ');
      const summary = document.getElementById('scorePanelWeights');
      if (summary) summary.textContent = weights;

      document.querySelectorAll('[data-grading-weight]').forEach(element => {
        element.textContent = `${gradingWeight(element.dataset.gradingWeight)}%`;
      });
      document.querySelectorAll('[data-grading-label]').forEach(element => {
        const rule = GRADING_RULES_BY_ID[String(element.dataset.gradingLabel).toLowerCase()];
        if (rule?.label) element.textContent = rule.label;
      });

      if (window.lucide) lucide.createIcons();
    }

    renderGradingRules();
    let ASSIGNMENT_CATEGORY_OPTIONS = CURRENT_GRADING_RULES.map(rule =>
      `<option value="${window.EDUGNAY_CONFIG.escapeHtml(rule.id)}">${window.EDUGNAY_CONFIG.escapeHtml(rule.label)} (${Number(rule.weight) || 0}%)</option>`
    ).join('');
    document.getElementById('assignCategoryInput').innerHTML = ASSIGNMENT_CATEGORY_OPTIONS;
    document.getElementById('editAssignmentCategoryInput').innerHTML = ASSIGNMENT_CATEGORY_OPTIONS;

    function refreshAssignmentCategoryOptions() {
      ASSIGNMENT_CATEGORY_OPTIONS = CURRENT_GRADING_RULES.map(rule =>
        `<option value="${window.EDUGNAY_CONFIG.escapeHtml(rule.id)}">${window.EDUGNAY_CONFIG.escapeHtml(rule.label)} (${Number(rule.weight) || 0}%)</option>`
      ).join('');
      document.getElementById('assignCategoryInput').innerHTML = ASSIGNMENT_CATEGORY_OPTIONS;
      document.getElementById('editAssignmentCategoryInput').innerHTML = ASSIGNMENT_CATEGORY_OPTIONS;
      updateAssignmentExamParts('assignCategoryInput', 'assignExamPartGroup', 'assignExamPartInput');
      updateAssignmentExamParts('editAssignmentCategoryInput', 'editAssignmentExamPartGroup', 'editAssignmentExamPartInput');
      updateValuesDomainSelect(document.getElementById('assignCategoryInput').value, 'assignDomainGroup', 'assignDomainInput');
      updateValuesDomainSelect(document.getElementById('editAssignmentCategoryInput').value, 'editAssignmentDomainGroup', 'editAssignmentDomainInput');
    }

    function getComponentPresentation(code) {
      const category = getBackendCategory(code);
      if (!category) return null;
      const componentType = String(category.componentType || '').toLowerCase();
      return {
        cls: componentType === 'examination' ? 'cat-qa' : componentType === 'performance' ? 'cat-pt' : 'cat-ww',
        icon: componentType === 'examination' ? 'clipboard-list' : componentType === 'performance' ? 'target' : 'pencil',
        label: `${category.name} (${Number(category.weight) || 0}%)`
      };
    }

    function updateExamPartSelect(componentCode, groupId, selectId, selectedPartId = '') {
      const category = getBackendCategory(componentCode);
      const group = document.getElementById(groupId);
      const select = document.getElementById(selectId);
      const parts = category?.examParts || [];
      group.hidden = !parts.length;
      select.innerHTML = parts.map(part => `<option value="${Number(part.id)}">${window.EDUGNAY_CONFIG.escapeHtml(part.name)} (${Number(part.weight) || 0}%)</option>`).join('');
      if (selectedPartId && parts.some(part => String(part.id) === String(selectedPartId))) select.value = String(selectedPartId);
      else if (parts.length) select.selectedIndex = 0;
    }

    function updateAssignmentExamParts(categorySelectId, groupId, partSelectId, selectedPartId = '') {
      updateExamPartSelect(document.getElementById(categorySelectId).value, groupId, partSelectId, selectedPartId);
    }

    function updateValuesDomainSelect(categoryCode, groupId, selectId, selectedCode = '', allowBlank = false) {
      const category = getBackendCategory(categoryCode);
      const type = String(category?.componentType || '').toLowerCase();
      const domains = BACKEND_SUBJECT_GRADING_CONFIG?.valuesDomains
        ? type === 'written' ? ['cognitive', 'affective']
          : type === 'performance' ? ['cognitive', 'affective', 'behavioral'] : [] : [];
      const group = document.getElementById(groupId);
      const select = document.getElementById(selectId);
      group.hidden = !domains.length;
      select.innerHTML = `${allowBlank ? '<option value="">Choose a domain</option>' : ''}${domains.map(code => `<option value="${code}">${code[0].toUpperCase()}${code.slice(1)}</option>`).join('')}`;
      if (selectedCode && domains.includes(selectedCode)) select.value = selectedCode;
      else if (allowBlank) select.value = '';
    }

    function renderScoreComponentChoices() {
      const choices = document.getElementById('compTypeOpts');
      if (!BACKEND_SUBJECT_GRADING_CONFIG?.applicable) {
        choices.innerHTML = LEGACY_SCORE_COMPONENT_CHOICES;
        selectedCompCat = 'WW';
        selectedCompType = 'Quiz';
        updateExamPartSelect('', 'scoreExamPartGroup', 'scoreExamPartInput');
        updateValuesDomainSelect('', 'scoreDomainGroup', 'scoreDomainInput');
        renderGradingRules();
        return;
      }
      window.TeacherClassViews.renderComponentChoices(choices, BACKEND_CATEGORIES.map(category => {
        const presentation = getComponentPresentation(category.code);
        return {
          code: category.code, categoryCode: String(category.code).toUpperCase(), name: category.name,
          weight: category.weight, css: presentation.cls, icon: presentation.icon
        };
      }));
      selectedCompCat = BACKEND_CATEGORIES[0]?.code || '';
      selectedCompType = BACKEND_CATEGORIES[0]?.name || '';
      updateExamPartSelect(selectedCompCat, 'scoreExamPartGroup', 'scoreExamPartInput');
      updateValuesDomainSelect(selectedCompCat, 'scoreDomainGroup', 'scoreDomainInput');
      window.lucide?.createIcons?.();
      renderGradingRules();
    }

    let addingScoreComponent = false;

    function openScoreComponentModal() {
      if (new URLSearchParams(window.location.search).has('classId') || USE_SHS_CORE_GRADEBOOK) return;
      if (BACKEND_SUBJECT_GRADING_CONFIG?.applicable && !BACKEND_SUBJECT_GRADING_CONFIG.configured) {
        showAppToast('This subject’s grading rules are not set up yet. Ask your school administrator for help.', 'error');
        return;
      }
      renderScoreComponentChoices();
      // The shared modal is also configured for SHS classes. Restore the regular
      // class submit handler and fields whenever this entry point opens it.
      const submitButton = document.getElementById('addScoreComponentSubmit');
      if (submitButton) {
        submitButton.onclick = addComponent;
        submitButton.disabled = addingScoreComponent;
        document.getElementById('addScoreComponentSubmitLabel').textContent = addingScoreComponent ? 'Adding...' : 'Add Component';
      }
      document.getElementById('compNameInput').readOnly = false;
      openModal('addCompModal');
    }

    document.getElementById('compTypeOpts').addEventListener('click', event => {
      const choice = event.target.closest('.comp-type-opt[data-cat]');
      if (choice) selectCompType(choice, choice.querySelector('.comp-type-name')?.textContent || '', choice.dataset.cat);
    });

    document.getElementById('assignCategoryInput').addEventListener('change', () => {
      if (!new URLSearchParams(window.location.search).has('classId'))
        updateAssignmentExamParts('assignCategoryInput', 'assignExamPartGroup', 'assignExamPartInput');
      updateValuesDomainSelect(document.getElementById('assignCategoryInput').value, 'assignDomainGroup', 'assignDomainInput');
    });
    document.getElementById('editAssignmentCategoryInput').addEventListener('change', () => {
      if (!new URLSearchParams(window.location.search).has('classId'))
        updateAssignmentExamParts('editAssignmentCategoryInput', 'editAssignmentExamPartGroup', 'editAssignmentExamPartInput');
      updateValuesDomainSelect(document.getElementById('editAssignmentCategoryInput').value, 'editAssignmentDomainGroup', 'editAssignmentDomainInput');
    });

    function selectCompType(el, type, cat) {
      document.querySelectorAll('.comp-type-opt').forEach(o => {
        o.classList.remove('selected');
        o.setAttribute('aria-pressed', 'false');
      });
      el.classList.add('selected');
      el.setAttribute('aria-pressed', 'true');
      selectedCompType = type;
      selectedCompCat = cat;
      document.getElementById('compNameInput').placeholder = 'e.g. ' + type + ' 1';
      updateExamPartSelect(cat, 'scoreExamPartGroup', 'scoreExamPartInput');
      updateValuesDomainSelect(cat, 'scoreDomainGroup', 'scoreDomainInput');
      lucide.createIcons();
    }

    function addComponent() {
      if (addingScoreComponent) return;
      const periodId = document.getElementById('academicPeriodSelect').value;
      if (!requireScoreEditingAccess(periodId)) return;
      const name = document.getElementById('compNameInput').value.trim();
      const max = document.getElementById('compMaxInput').value.trim();
      if (!name || !max) { alert('Please fill in component name and highest score.'); return; }
      if (BACKEND_SUBJECT_GRADING_CONFIG?.applicable && !BACKEND_SUBJECT_GRADING_CONFIG.configured) {
        showAppToast('This subject’s grading rules are not set up yet. Ask your school administrator for help.', 'error');
        return;
      }
      if (isBackendGradeMode()) {
        const academicTermId = getBackendTermId(periodId);
        const category = getBackendCategory(selectedCompCat);
        const examPartId = category?.examParts?.length ? Number(document.getElementById('scoreExamPartInput').value) : null;
        if (!academicTermId || !category) {
          alert('That grading period or score category is not available yet. Refresh and try again.');
          return;
        }
        if (category.examParts?.length && !examPartId) {
          alert('Select an examination part before adding this score component.');
          return;
        }
        const submitButton = document.getElementById('addScoreComponentSubmit');
        addingScoreComponent = true;
        submitButton.disabled = true;
        document.getElementById('addScoreComponentSubmitLabel').textContent = 'Adding...';
        window.EDUGNAY_API.createGradingItem({
          sectionId: BACKEND_GRADE_CONTEXT.sectionId,
          subjectId: BACKEND_GRADE_CONTEXT.subjectId,
          academicTermId,
          gradingCategoryId: BACKEND_SUBJECT_GRADING_CONFIG?.applicable ? null : category.id,
          subjectGradingComponentId: category.subjectGradingComponentId || null,
          subjectGradingExamPartId: examPartId,
          domainCode: document.getElementById('scoreDomainGroup').hidden ? null : document.getElementById('scoreDomainInput').value,
          title: name,
          maxScore: Number(max)
        }).then(item => {
          if (!item) throw new Error('The grading component could not be created.');
          BACKEND_GRADING_ITEMS.push(item);
          closeModal('addCompModal');
          renderScoreTable(periodId);
          showAppToast('Gradebook item added.');
        }).catch(error => showAppToast(error.message || 'The gradebook item could not be added.', 'error'))
          .finally(() => {
            addingScoreComponent = false;
            submitButton.disabled = false;
            document.getElementById('addScoreComponentSubmitLabel').textContent = 'Add Component';
          });
        return;
      }

      showAppToast(BACKEND_GRADE_ERROR || 'Scores cannot be recorded right now. Refresh and try again.', 'error');
    }

    /* ── GRADE COMPUTATION ── */
    let WEIGHTS = Object.fromEntries(
      CURRENT_GRADING_RULES.map(rule => [String(rule.id).toUpperCase(), Number(rule.weight) / 100 || 0])
    );

    function updateSectionHeader(academicPeriodId) {
      const studentCount = getGradeStudents().length;
      const gradeNumber = String(CURRENT_SECTION_RECORD?.grade || '').match(/\d+/)?.[0];
      const scoreRows = [...document.querySelectorAll('#scoreTbody tr[data-student-id]')];
      const encodedCount = scoreRows.filter(row => {
        const scoreInputs = [...row.querySelectorAll('.score-input')];
        return scoreInputs.length && scoreInputs.every(input => input.value !== '');
      }).length;

      document.getElementById('sectionHeaderName').textContent = CURRENT_SECTION_RECORD?.name || 'Section';
      document.getElementById('sectionGradeLabel').textContent = gradeNumber ? `Grade ${gradeNumber}` : 'Class section';
      updateSectionSubjectControl();
      document.getElementById('sectionStudentCount').textContent = studentCount;
      const selectedPeriod = ACADEMIC_PERIODS.find(period => period.id === academicPeriodId);
      if (selectedPeriod) document.getElementById('sectionPeriodName').textContent = selectedPeriod.name;
      document.querySelector('[data-school-year]').textContent = CURRENT_SECTION_RECORD?.academicYear || 'Academic year unavailable';
      if (selectedPeriod) document.getElementById('sectionPeriodMeta').removeAttribute('hidden');
      document.getElementById('scoreSectionName').textContent = CURRENT_SECTION;
      document.getElementById('sectionAdviserMeta')?.toggleAttribute('hidden', !CURRENT_TEACHER_ASSIGNMENT.isAdviser);
      document.getElementById('sectionEncodingStatus').textContent = !encodedCount
        ? 'Encoding not started'
        : encodedCount === studentCount ? 'Encoding complete' : 'Encoding in progress';
      const encodedCountNode = document.getElementById('sectionEncodedCount');
      encodedCountNode.textContent = `${encodedCount} of ${studentCount} students encoded`;
      encodedCountNode.hidden = false;
    }

    function updateSectionSubjectControl() {
      const subjectName = document.getElementById('sectionSubjectName');
      const subjectSelect = document.getElementById('sectionSubjectSelect');
      if (!subjectName || !subjectSelect) return;

      subjectName.textContent = CURRENT_SUBJECT;
      document.getElementById('assignSubjectInput').value = CURRENT_SUBJECT_ASSIGNMENT ? CURRENT_SUBJECT : '';
      subjectSelect.replaceChildren(...CURRENT_TEACHER_SUBJECT_ASSIGNMENTS.map(assignment => {
        const option = document.createElement('option');
        option.value = `${assignment.subjectId}|${assignment.communicationComponentCode || ''}`;
        option.dataset.subjectId = String(assignment.subjectId);
        option.dataset.communicationComponentCode = assignment.communicationComponentCode || '';
        const componentLabel = assignment.communicationComponentName
          || (assignment.communicationComponentCode === 'english' ? 'Effective Communication'
            : assignment.communicationComponentCode === 'filipino' ? 'Mabisang Komunikasyon' : '');
        const hoursLabel = assignment.communicationComponentHours
          ? ` (${assignment.communicationComponentHours} instructional hours)` : '';
        option.textContent = componentLabel && assignment.communicationComponentCode
          ? `${componentLabel}${hoursLabel}`
          : assignment.subjectName;
        return option;
      }));
      subjectSelect.value = `${CURRENT_SUBJECT_ID}|${CURRENT_COMMUNICATION_COMPONENT_CODE}`;
      subjectSelect.hidden = CURRENT_TEACHER_SUBJECT_ASSIGNMENTS.length < 2;
      subjectName.hidden = CURRENT_TEACHER_SUBJECT_ASSIGNMENTS.length > 1;
      document.querySelectorAll('[data-requires-subject]').forEach(button => {
        button.disabled = !CURRENT_SUBJECT_ASSIGNMENT;
      });

      if (!subjectSelect.dataset.bound) {
        subjectSelect.addEventListener('change', () => {
          const target = new URL(window.location.href);
          const option = subjectSelect.selectedOptions[0];
          target.searchParams.set('subjectId', option?.dataset.subjectId || '');
          if (option?.dataset.communicationComponentCode) {
            target.searchParams.set('communicationComponentCode', option.dataset.communicationComponentCode);
          } else {
            target.searchParams.delete('communicationComponentCode');
          }
          window.location.assign(target.href);
        });
        subjectSelect.dataset.bound = 'true';
      }

      const assignmentTitle = document.getElementById('assignmentPanelTitle');
      const assignmentSub = document.getElementById('assignmentPanelSub');
      const scoreTitle = document.getElementById('scorePanelTitle');
      const attendanceSub = document.getElementById('attendancePanelSub');
      if (assignmentTitle) assignmentTitle.textContent = `Assignments: ${CURRENT_SUBJECT}`;
      if (assignmentSub) assignmentSub.textContent = CURRENT_SECTION;
      if (scoreTitle) scoreTitle.textContent = `Score Recording: ${CURRENT_SUBJECT}`;
      if (attendanceSub) attendanceSub.textContent = `${CURRENT_SECTION} · ${CURRENT_SUBJECT}`;
    }

    function transferReviewScope(academicPeriodId) {
      const termId = getBackendTermId(academicPeriodId);
      if (!BACKEND_GRADE_CONTEXT?.sectionId || !BACKEND_GRADE_CONTEXT?.subjectId || !termId) return null;
      return { sectionId: BACKEND_GRADE_CONTEXT.sectionId, subjectId: BACKEND_GRADE_CONTEXT.subjectId,
        communicationComponentCode: BACKEND_GRADE_CONTEXT.communicationComponentCode || null,
        academicTermId: termId };
    }

    function transferReviewKey(scope) {
      return `${scope.sectionId}:${scope.subjectId}:${scope.academicTermId}`;
    }

    function renderTransferReviewNotice(scope) {
      const notice = document.getElementById('transferReviewNotice');
      const state = scope && TRANSFER_REVIEW_CACHE.get(transferReviewKey(scope));
      notice.replaceChildren();
      notice.hidden = !state || (!state.error && !state.loading && !state.data?.scores?.length && !state.data?.publishedGrades?.length);
      if (notice.hidden) return;
      notice.classList.toggle('is-error', Boolean(state.error));
      const icon = document.createElement('span');
      icon.className = 'transfer-review-notice-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = `<i data-lucide="${state.error ? 'triangle-alert' : state.loading ? 'loader-circle' : 'info'}"></i>`;
      const message = document.createElement('p');
      message.className = 'transfer-review-notice-text';
      const actions = document.createElement('div');
      actions.className = 'transfer-review-notice-actions';
      if (state.loading) {
        message.textContent = 'Checking previous section work…';
        notice.append(icon, message);
        window.lucide?.createIcons();
        return;
      }
      if (state.error) {
        message.textContent = 'Previous section work could not be loaded.';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'top-btn secondary';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => { TRANSFER_REVIEW_CACHE.delete(transferReviewKey(scope)); ensureTransferReviewLoaded(scope); });
        actions.appendChild(retry);
        notice.append(icon, message, actions);
        window.lucide?.createIcons();
        return;
      }
      const count = new Set([...state.data.scores, ...state.data.publishedGrades].map(row => String(row.studentId))).size;
      message.textContent = `${count} transferred student${count === 1 ? '' : 's'} ${count === 1 ? 'has' : 'have'} previous work or a published grade in this period.`;
      const review = document.createElement('button');
      review.type = 'button';
      review.className = 'top-btn secondary';
      review.textContent = 'Review';
      review.addEventListener('click', () => openTransferReviewModal());
      actions.appendChild(review);
      notice.append(icon, message, actions);
      window.lucide?.createIcons();
    }

    async function ensureTransferReviewLoaded(scope) {
      const key = transferReviewKey(scope);
      if (TRANSFER_REVIEW_CACHE.has(key)) return;
      TRANSFER_REVIEW_CACHE.set(key, { loading: true });
      renderTransferReviewNotice(scope);
      try {
        const data = await window.EDUGNAY_API.getTransferReview(scope);
        TRANSFER_REVIEW_CACHE.set(key, { data });
      } catch (error) {
        TRANSFER_REVIEW_CACHE.set(key, { error: error.message || 'Unable to load previous work.' });
      }
      const selected = transferReviewScope(document.getElementById('academicPeriodSelect').value);
      if (selected && transferReviewKey(selected) === key) renderScoreTable(document.getElementById('academicPeriodSelect').value);
    }

    function openTransferReviewModal() {
      const scope = transferReviewScope(document.getElementById('academicPeriodSelect').value);
      const data = scope && TRANSFER_REVIEW_CACHE.get(transferReviewKey(scope))?.data;
      if (!data) return;
      const names = new Map(getGradeStudents().map(student => [String(student.id), student.displayName]));
      const rows = [...data.publishedGrades.map(row => ({ ...row, kind: 'published' })), ...data.scores.map(row => ({ ...row, kind: 'score' }))];
      const content = document.getElementById('transferReviewContent');
      content.innerHTML = rows.length ? rows.map(row => `<article class="transfer-review-row">
      <div class="transfer-review-row-heading">
        <strong>${window.EDUGNAY_CONFIG.escapeHtml(names.get(String(row.studentId)) || 'Student')}</strong>
        <span class="transfer-review-source">${window.EDUGNAY_CONFIG.escapeHtml(row.sourceSectionName || 'Previous section')}</span>
      </div>
      <div class="transfer-review-detail">
        <span class="transfer-review-kind">${row.kind === 'published' ? 'Published grade' : 'Grading item'}</span>
        <span class="transfer-review-value">${row.kind === 'published' ? `Final grade: ${Number(row.finalGrade)}` : `${window.EDUGNAY_CONFIG.escapeHtml(row.itemTitle || 'Grading item')}: ${row.score == null ? 'No score' : Number(row.score)} / ${Number(row.maxScore)}${row.categoryName ? ` · ${window.EDUGNAY_CONFIG.escapeHtml(row.categoryName)}` : ''}`}</span>
      </div>
    </article>`).join('') : '<p class="transfer-review-empty">No previous work was found for this subject and period.</p>';
      openModal('transferReviewModal');
    }

    function gradingAverageHeaderLabel(label) {
      const abbreviations = {
        'written/oral works': 'WW',
        'performance tasks': 'PT',
        examinations: 'Exams'
      };
      const fullName = String(label || '').trim();
      return abbreviations[fullName.toLowerCase()] || fullName;
    }

    function getDistinctExamPartName(componentName, examPartName) {
      const partName = String(examPartName || '').trim();
      const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
      return partName && normalize(partName) !== normalize(componentName) ? partName : '';
    }

    function renderScoreTable(academicPeriodId) {
      closeScoreComponentMenu();
      const theadRow = document.getElementById('scoreTheadRow');
      const tbody = document.getElementById('scoreTbody');
      if (!isBackendGradeMode()) {
        window.TeacherClassViews.renderScoreTable({
          host: document.querySelector('#content-scores .panel'),
          empty: { noItems: { icon: 'circle-alert', title: 'Grade data unavailable', text: BACKEND_GRADE_ERROR || 'Grade data could not be loaded. Refresh and try again.' } }
        });
        updateSectionHeader(academicPeriodId);
        updateScoreFooter();
        return;
      }

      const gradeStudents = getGradeStudents();
      const backendTermId = getBackendTermId(academicPeriodId);
      const reviewScope = transferReviewScope(academicPeriodId);
      if (reviewScope) {
        ensureTransferReviewLoaded(reviewScope);
        renderTransferReviewNotice(reviewScope);
      }
      const components = BACKEND_GRADING_ITEMS
        .filter(item => item.subjectId === String(BACKEND_GRADE_CONTEXT.subjectId)
          && (item.communicationComponentCode || null) === (BACKEND_GRADE_CONTEXT.communicationComponentCode || null)
          && item.academicTermId === String(backendTermId))
        .map(item => {
          const category = BACKEND_SUBJECT_GRADING_CONFIG?.applicable
            ? BACKEND_CATEGORIES.find(record => String(record.subjectGradingComponentId) === String(item.subjectGradingComponentId))
            : BACKEND_CATEGORIES.find(record => String(record.id) === String(item.gradingCategoryId));
          const examPart = category?.examParts?.find(record => String(record.id) === String(item.subjectGradingExamPartId));
          return {
            id: item.id,
            name: item.name,
            subjectId: item.subjectId,
            journalPromptId: item.journalPromptId,
            currentJournalSubjectId: item.currentJournalSubjectId,
            max: item.max,
            cat: String(category?.code || item.cat || '').trim().toUpperCase(),
            categoryName: category?.name || '',
            domainCode: item.domainCode || '',
            domainName: BACKEND_SUBJECT_GRADING_CONFIG?.valuesDomains && ['written', 'performance'].includes(category?.componentType)
              ? item.domainCode ? `${item.domainCode[0].toUpperCase()}${item.domainCode.slice(1)}` : 'Choose domain'
              : '',
            examPartId: item.subjectGradingExamPartId || null,
            examPartName: examPart?.name || '',
            gradingItemId: item.id
          };
        });

      const scoreItems = components.map(component => {
        const categoryName = String(component.categoryName || component.cat || '').trim();
        return {
          id: component.id || component.name,
          gradingItemId: component.gradingItemId,
          title: component.domainName ? `${component.name} · ${component.domainName}` : component.name,
          maxScore: component.max,
          categoryCode: component.cat,
          categoryName,
          domainCode: component.domainCode,
          categoryHeader: gradingAverageHeaderLabel(categoryName),
          examPartId: component.examPartId,
          examPartName: getDistinctExamPartName(component.name, component.examPartName),
          academicPeriodId,
          canDelete: true
        };
      });
      const metricHeaders = CURRENT_GRADING_RULES.map(rule => {
        const label = gradingAverageHeaderLabel(rule.label || String(rule.id).toUpperCase());
        return { label: `${label} Avg`, title: `${label}: ${Number(rule.weight) || 0}% of the final grade`, className: 'score-average-header' };
      });
      const weightedScoreOnly = CURRENT_GRADE_SCALE === 'legacy_shs_transmutation';
      metricHeaders.push({
        label: weightedScoreOnly ? 'Weighted Grade' : 'Final Grade',
        title: weightedScoreOnly ? 'Weighted grade calculated from current scores.' : 'Calculated final grade based on current scores.',
        style: 'min-width:148px;background:var(--navy);color:var(--gold);'
      });
      const gradingRulesNeedConfiguration = BACKEND_SUBJECT_GRADING_CONFIG?.applicable
        && !BACKEND_SUBJECT_GRADING_CONFIG.configured;
      window.TeacherClassViews.renderScoreTable({
        host: document.querySelector('#content-scores .panel'),
        items: scoreItems,
        students: gradeStudents,
        metricHeaders,
        getScore: (student, item) => {
          const backendScore = getBackendScore(item.gradingItemId, student.id);
          const pendingScore = pendingBackendScoreValues.get(`${student.id}:${item.id}`);
          return { score: pendingScore ? pendingScore.value : (backendScore?.score ?? null) };
        },
        getMetrics: () => [
          ...CURRENT_GRADING_RULES.map(() => ({ value: '0.0', className: 'computed-cell computed-avg' })),
          { value: '0', className: 'computed-cell computed-final', style: 'background:var(--blue-xpale);' }
        ],
        onScoreInput: input => computeRow(input, true),
        scoreEvent: 'input',
        empty: {
          noItems: gradingRulesNeedConfiguration ? {
            icon: 'triangle-alert',
            title: 'Grading rules need to be set up',
            text: 'Ask your school administrator to apply DepEd defaults or set up this subject before recording scores.'
          } : undefined
        }
      });
      tbody.querySelectorAll('.score-input').forEach(inp => computeRow(inp));
      updateSectionHeader(academicPeriodId);
      filterScoreStudents();
    }

    const scoreSaveTimers = {};
    const pendingBackendScoreValues = new Map();
    const pendingBackendScoreSaves = new Map();
    let scoreHasSavedChanges = false;

    function filterScoreStudents() {
      const host = document.querySelector('#content-scores .panel');
      const tbody = document.getElementById('scoreTbody');
      const category = document.querySelector('.cat-tab.active')?.dataset.cat || 'all';
      window.TeacherClassViews.filterScores(host, category);
      const rows = [...tbody.querySelectorAll('tr[data-student-id]')];
      const visible = rows.filter(row => !row.hidden && row.style.display !== 'none').length;
      tbody.querySelector('#scoreSearchEmpty')?.remove();
      if (rows.length && !visible && document.getElementById('scoreStudentSearch').value.trim()) {
        const empty = document.createElement('tr');
        empty.id = 'scoreSearchEmpty';
        empty.className = 'panel-empty-row';
        const cell = document.createElement('td');
        cell.colSpan = document.getElementById('scoreTheadRow').children.length;
        cell.textContent = 'No students match your search.';
        empty.appendChild(cell);
        tbody.appendChild(empty);
      }
      updateScoreFooter();
    }

    function updateScoreFooter() {
      const rows = [...document.querySelectorAll('#scoreTbody tr[data-student-id]')];
      const visible = rows.filter(row => !row.hidden && row.style.display !== 'none').length;
      const count = document.getElementById('scoreListFooter');
      const status = document.getElementById('scoreSaveStatus');
      const feedback = document.getElementById('scoreSaveFeedback');
      const retry = document.getElementById('scoreSaveRetry');
      const pending = [...pendingBackendScoreValues.values()];
      const failed = pending.filter(record => record.failed);
      const exportButton = document.getElementById('exportScoresButton');
      const canExport = !BACKEND_GRADE_ERROR && isBackendGradeMode()
        && Boolean(BACKEND_GRADE_CONTEXT?.sectionId && BACKEND_GRADE_CONTEXT?.subjectId)
        && visible > 0 && pending.length === 0;
      exportButton.disabled = !canExport;
      exportButton.title = pending.length ? 'Wait until all score changes are saved before exporting.'
        : !visible ? 'No student scores to export.'
          : canExport ? 'Download visible score records as CSV.' : 'Score records are unavailable.';

      if (BACKEND_GRADE_ERROR || !isBackendGradeMode()) {
        count.textContent = 'Score records unavailable';
      } else if (rows.length) {
        count.textContent = visible === rows.length
          ? `Showing ${rows.length} ${rows.length === 1 ? 'student' : 'students'}`
          : `Showing ${visible} of ${rows.length} students`;
      } else {
        const enrolled = getGradeStudents().length;
        count.textContent = enrolled ? `${enrolled} students enrolled` : 'No students enrolled';
      }

      feedback.classList.toggle('is-error', failed.length > 0);
      retry.hidden = !failed.some(record => hasScoreEditingAccess(record.academicPeriodId));
      if (failed.length) {
        status.textContent = failed.length === 1
          ? `Score not saved: ${failed[0].error || 'Try again.'}`
          : `${failed.length} scores not saved. ${failed[0].error || 'Try again.'}`;
      } else if (pending.some(record => record.saving)) {
        status.textContent = 'Saving changes…';
      } else if (pending.length) {
        status.textContent = 'Unsaved changes';
      } else if (BACKEND_GRADE_ERROR || !isBackendGradeMode()) {
        status.textContent = 'Save status unavailable';
      } else if (!rows.length) {
        status.textContent = 'No scores to save';
      } else if (!hasScoreEditingAccess(document.getElementById('academicPeriodSelect').value)) {
        status.textContent = 'Read-only grading period';
      } else {
        status.textContent = scoreHasSavedChanges ? 'All changes saved' : 'Scores save automatically';
      }
    }

    function exportScoresCsv() {
      const button = document.getElementById('exportScoresButton');
      updateScoreFooter();
      if (button.disabled) {
        showAppToast(button.title || 'Score records are unavailable for export.', 'info');
        return;
      }

      const periodId = document.getElementById('academicPeriodSelect').value;
      const period = ACADEMIC_PERIODS.find(item => item.id === periodId);
      const rows = [...document.querySelectorAll('#scoreTbody tr[data-student-id]')]
        .filter(row => row.style.display !== 'none');
      const itemHeaders = [...document.querySelectorAll('#scoreTheadRow .comp-head-cell')].map(cell => {
        const categoryLabel = cell.querySelector('.comp-head-type');
        return `${categoryLabel.dataset.categoryName || categoryLabel.textContent.trim()}: ${cell.querySelector('.comp-head-name').textContent} / ${cell.querySelector('.comp-head-max').textContent.replace('/', '').trim()}`;
      });
      const finalGradeLabel = CURRENT_GRADE_SCALE === 'legacy_shs_transmutation' ? 'Weighted Grade' : 'Final Grade';
      const csvRows = [
        ['Student', ...itemHeaders, ...CURRENT_GRADING_RULES.map(rule => `${String(rule.id).toUpperCase()} Avg`), finalGradeLabel],
        ...rows.map(row => [
          row.querySelector('.student-name').textContent,
          ...[...row.querySelectorAll('td[data-cat] .score-input')].map(input => input.value),
          ...[...row.querySelectorAll('.computed-cell')].map(cell => cell.textContent.trim() === '—' ? '' : cell.textContent.trim())
        ])
      ];
      const csvCell = value => {
        let text = String(value ?? '');
        if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
      };
      const csv = '\uFEFF' + csvRows.map(row => row.map(csvCell).join(',')).join('\r\n');
      const filename = [CURRENT_SECTION_RECORD?.academicYear, CURRENT_SECTION, CURRENT_SUBJECT, period?.name]
        .filter(Boolean).join('-').replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 140) + '-scores.csv';
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showAppToast('Score CSV download started.');
    }

    function savePendingBackendScore(record) {
      const previous = pendingBackendScoreSaves.get(record.scoreId) || Promise.resolve();
      const pending = previous.catch(() => { }).then(async () => {
        if (pendingBackendScoreValues.get(record.scoreId) !== record) return;
        record.saving = true;
        record.failed = false;
        updateScoreFooter();
        try {
          await saveBackendStudentScore(record.gradingItemId, record.studentId, record.value);
          if (pendingBackendScoreValues.get(record.scoreId) === record) {
            pendingBackendScoreValues.delete(record.scoreId);
            scoreHasSavedChanges = true;
          }
        } catch (error) {
          if (pendingBackendScoreValues.get(record.scoreId) === record) {
            record.failed = true;
            record.error = error.message || 'Try again.';
          }
          throw error;
        } finally {
          record.saving = false;
          updateScoreFooter();
        }
      });
      pendingBackendScoreSaves.set(record.scoreId, pending);
      pending.then(
        () => { if (pendingBackendScoreSaves.get(record.scoreId) === pending) pendingBackendScoreSaves.delete(record.scoreId); },
        () => { if (pendingBackendScoreSaves.get(record.scoreId) === pending) pendingBackendScoreSaves.delete(record.scoreId); }
      );
      return pending;
    }

    function scheduleBackendScoreSave(input, scoreId, studentId) {
      const record = {
        scoreId,
        gradingItemId: input.dataset.gradingItemId,
        studentId,
        value: input.value,
        academicPeriodId: input.dataset.academicPeriodId
      };
      pendingBackendScoreValues.set(scoreId, record);
      updateScoreFooter();
      clearTimeout(scoreSaveTimers[scoreId]);
      scoreSaveTimers[scoreId] = setTimeout(async () => {
        delete scoreSaveTimers[scoreId];
        if (!requireScoreEditingAccess(record.academicPeriodId, false)) {
          record.failed = true;
          record.error = 'This grading period is not active. The score was not saved.';
          updateScoreFooter();
          return;
        }
        try {
          await savePendingBackendScore(record);
        } catch { } // The footer keeps the failed score visible for retry.
      }, 600);
    }

    async function retryFailedScoreSaves() {
      const button = document.getElementById('scoreSaveRetry');
      const failed = [...pendingBackendScoreValues.values()]
        .filter(record => record.failed && hasScoreEditingAccess(record.academicPeriodId));
      button.disabled = true;
      try {
        await Promise.allSettled(failed.map(savePendingBackendScore));
      } finally {
        button.disabled = false;
        updateScoreFooter();
      }
    }

    function transmuteDepedK10InitialGrade(initialGrade) {
      const value = Math.min(100, Math.max(0, Math.round(Number(initialGrade) * 100) / 100));
      if (!Number.isFinite(value)) return null;
      if (value >= 99.5) return 100;
      if (value >= 70) return Math.min(99, 75 + Math.floor((value - 70 + 1e-9) / 1.18));
      const lowerBounds = [0, 4.68, 9.34, 14.01, 18.68, 23.35, 28.01, 32.68, 37.34, 42.01, 46.67, 51.34, 56.01, 60.67, 65.34];
      let result = 60;
      lowerBounds.forEach((lowerBound, index) => {
        if (value >= lowerBound) result = 60 + index;
      });
      return result;
    }

    function computeRow(input, shouldSave = false) {
      const row = input.closest('tr');
      if (!row) return;

      const max = parseFloat(input.max);
      const val = parseFloat(input.value);
      input.classList.toggle('over-max', !isNaN(val) && val > max);

      // debounced save — fires 600ms after typing stops
      const scoreId = input.dataset.scoreId;
      if (shouldSave && scoreId) {
        const studentId = row.dataset.studentId;
        if (input.dataset.gradingItemId && isBackendGradeMode()) {
          scheduleBackendScoreSave(input, scoreId, studentId);
        }
      }

      const usesSubjectGradingConfig = Boolean(BACKEND_SUBJECT_GRADING_CONFIG?.applicable);
      const domainWeights = BACKEND_SUBJECT_GRADING_CONFIG?.valuesDomains
        ? { written: { cognitive: 10, affective: 10 }, performance: { cognitive: 10, affective: 10, behavioral: 30 } }
        : null;
      const groups = Object.fromEntries(CURRENT_GRADING_RULES.map(rule => [
        String(rule.id).trim().toUpperCase(),
        { sum: 0, maxSum: 0, parts: {}, domains: {} }
      ]));
      const scoreInputs = [...row.querySelectorAll('td[data-cat] .score-input')];
      let allScoresComplete = scoreInputs.length > 0;

      scoreInputs.forEach(inp => {
        const category = String(inp.closest('td')?.dataset.cat || '').trim().toUpperCase();
        const group = groups[category];
        const cell = inp.closest('td');
        const partId = cell?.dataset.examPartId || '';
        const domainCode = cell?.dataset.domainCode || '';
        const componentType = BACKEND_CATEGORIES.find(record => String(record.code).toUpperCase() === category)?.componentType;
        const rawScore = inp.value.trim();
        const score = rawScore === '' ? NaN : Number(rawScore);
        const maxScore = Number(inp.max);

        if (!group || !Number.isFinite(score) || !Number.isFinite(maxScore)
          || maxScore <= 0 || score < 0 || score > maxScore) {
          if (group) group.invalid = true;
          allScoresComplete = false;
          return;
        }

        if (domainWeights && ((domainWeights[componentType] && !Object.hasOwn(domainWeights[componentType], domainCode))
          || (!domainWeights[componentType] && domainCode))) {
          group.invalid = true;
          allScoresComplete = false;
          return;
        }

        if (usesSubjectGradingConfig && partId) {
          const part = group.parts[partId] || (group.parts[partId] = { sum: 0, maxSum: 0 });
          part.sum += score;
          part.maxSum += maxScore;
        } else if (domainWeights?.[componentType]) {
          const domain = group.domains[domainCode] || (group.domains[domainCode] = { sum: 0, maxSum: 0 });
          domain.sum += score;
          domain.maxSum += maxScore;
        } else {
          group.sum += score;
          group.maxSum += maxScore;
        }
      });

      const averages = Object.fromEntries(
        Object.entries(groups).map(([code, values]) => {
          const category = BACKEND_CATEGORIES.find(record => String(record.code).toUpperCase() === code);
          if (values.invalid) return [code, null];
          if (usesSubjectGradingConfig && category?.examParts?.length) {
            const partAverages = category.examParts.map(part => {
              const totals = values.parts[String(part.id)];
              return totals?.maxSum > 0 ? (totals.sum / totals.maxSum) * 100 : null;
            });
            const complete = partAverages.every(average => average !== null);
            return [code, complete
              ? category.examParts.reduce((sum, part, index) => sum + partAverages[index] * Number(part.weight) / 100, 0)
              : null];
          }
          const requiredDomains = domainWeights?.[category?.componentType];
          if (requiredDomains) {
            const complete = Object.keys(requiredDomains).every(domain => values.domains[domain]?.maxSum > 0);
            return [code, complete ? Object.entries(requiredDomains).reduce((sum, [domain, weight]) => {
              const totals = values.domains[domain];
              return sum + totals.sum / totals.maxSum * weight;
            }, 0) * 100 / Number(category.weight) : null];
          }
          return [code, values.maxSum > 0 ? (values.sum / values.maxSum) * 100 : null];
        })
      );
      const computed = row.querySelectorAll('.computed-cell');
      if (computed.length >= CURRENT_GRADING_RULES.length + 1) {
        CURRENT_GRADING_RULES.forEach((rule, index) => {
          const average = averages[String(rule.id).trim().toUpperCase()];
          computed[index].textContent = average === null ? '—' : average.toFixed(1);
        });

        const finalCell = computed[CURRENT_GRADING_RULES.length];
        const allCategoriesScored = Object.values(averages).every(average => average !== null);
        const totalWeight = Object.values(WEIGHTS).reduce((total, weight) => total + weight, 0);
        const canEstimate = allScoresComplete && allCategoriesScored
          && (!domainWeights || BACKEND_SUBJECT_GRADING_CONFIG.valuesDomainSetupMatches)
          && Math.abs(totalWeight - 1) < 0.0001;

        finalCell.className = 'center computed-cell computed-final';
        finalCell.removeAttribute('aria-label');
        finalCell.removeAttribute('title');
        finalCell.removeAttribute('tabindex');
        if (!canEstimate) {
          finalCell.textContent = '—';
          finalCell.title = 'Enter valid scores for all grading items to see the calculated final grade preview.';
        } else {
          const final = Object.entries(averages).reduce(
            (total, [category, average]) => total + (average * (WEIGHTS[category] || 0)),
            0
          );
          if (CURRENT_GRADE_SCALE === 'legacy_shs_transmutation') {
            const initial = Math.round((final + Number.EPSILON) * 100) / 100;
            finalCell.textContent = `Weighted grade ${initial.toFixed(2)}`;
            finalCell.title = 'Weighted grade calculated from current scores.';
          } else if (CURRENT_GRADE_SCALE === 'deped_2026_transmutation') {
            const initial = Math.round((final + Number.EPSILON) * 100) / 100;
            const termGrade = transmuteDepedK10InitialGrade(initial);
            finalCell.textContent = String(termGrade);
            finalCell.title = `Weighted grade: ${initial.toFixed(2)}; converted to final grade ${termGrade} using the DepEd method.`;
            finalCell.setAttribute('aria-label', `Final grade ${termGrade}. Weighted grade ${initial.toFixed(2)}, converted using the DepEd method.`);
            finalCell.tabIndex = 0;
            finalCell.classList.add(getGradeStatusTone(termGrade));
          } else {
            const isDepedZeroBased = CURRENT_GRADE_SCALE === 'deped_zero_based';
            const gradeToRound = usesSubjectGradingConfig
              ? Math.round((final + Number.EPSILON) * 100) / 100
              : final;
            const rounded = GRADE_ROUNDING === 'roundup'
              ? Math.ceil(gradeToRound)
              : GRADE_ROUNDING === 'truncate'
                ? Math.trunc(gradeToRound)
                : Math.round(gradeToRound);

            finalCell.textContent = String(rounded);
            finalCell.title = isDepedZeroBased
              ? `Weighted grade: ${gradeToRound.toFixed(2)}; rounded to final grade ${rounded} using the DepEd method for this school year.`
              : usesSubjectGradingConfig
                ? `Weighted grade: ${final.toFixed(2)}; rounded to final grade ${rounded} using the school rule.`
                : `Calculated final grade ${rounded}, using the school grading weights and rounding rule.`;
            finalCell.setAttribute('aria-label', isDepedZeroBased
              ? `Final grade ${rounded}. Weighted grade ${gradeToRound.toFixed(2)}, rounded using the DepEd method for this school year.`
              : usesSubjectGradingConfig
                ? `Final grade ${rounded}. Weighted grade ${final.toFixed(2)}, rounded using the school rule.`
                : `Calculated final grade ${rounded}, using the school grading weights and rounding rule.`);
            finalCell.tabIndex = 0;
            finalCell.classList.add(getGradeStatusTone(rounded));
          }
        }
      }

      if (shouldSave) {
        updateSectionHeader(input.dataset.academicPeriodId || document.getElementById('academicPeriodSelect').value);
      }
    }

    async function saveBackendStudentScore(gradingItemId, studentId, value) {
      let saved;
      try {
        saved = await window.EDUGNAY_API.saveStudentScore({
          gradingItemId,
          studentId,
          score: value === '' ? null : Number(value)
        });
      } catch (error) {
        const item = BACKEND_GRADING_ITEMS.find(record => String(record.id) === String(gradingItemId));
        if (isReopenBackendMode() && item && [403, 409].includes(error.status)) {
          await switchAcademicPeriod(item.academicPeriodId);
        }
        throw error;
      }
      if (!saved) throw new Error('The score could not be saved.');
      const index = BACKEND_STUDENT_SCORES.findIndex(record =>
        String(record.gradingItemId) === String(gradingItemId) && String(record.studentId) === String(studentId)
      );
      if (index >= 0) BACKEND_STUDENT_SCORES[index] = saved;
      else BACKEND_STUDENT_SCORES.push(saved);
      updateSectionHeader(document.getElementById('academicPeriodSelect').value);
      return saved;
    }

    /* ── ATTENDANCE ── */

    // Mirrors System Config → Attendance settings. Wire to real config values later.
    function getCurrentAttendanceDate() {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date());
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    }

    let APP_TODAY = getCurrentAttendanceDate();
    let qrAttendanceContext = null;
    let qrScannerStream = null;
    let qrScannerDetector = null;
    let qrScannerFallbackReader = null;
    let qrScannerFallbackControls = null;
    let qrScannerFrameId = null;
    let qrScannerActive = false;
    let qrScannerSessionId = 0;
    let lastDetectedQrValue = '';
    let qrAttendanceScans = [];
    let qrAttendanceDraft = [];
    let BACKEND_QR_ATTENDANCE_DATA = null;
    let qrAttendanceSaving = false;
    let qrAttendanceReturnFocus = null;
    let qrScannerSoundEnabled = true;
    let qrScannerAudioContext = null;
    let lastQrScannerToneValue = '';
    let lastQrScannerToneAt = 0;

    function formatAttDate(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    async function loadBackendAttendanceForDate(dateStr) {
      if (!BACKEND_ATTENDANCE_CONTEXT) return null;
      const isToday = dateStr === APP_TODAY;
      if (!isToday) BACKEND_ATTENDANCE_BY_DATE.delete(dateStr);
      const data = await window.EDUGNAY_API.getSectionAttendance(
        BACKEND_ATTENDANCE_CONTEXT.sectionId,
        CURRENT_SUBJECT_ID,
        isToday ? null : dateStr,
        CURRENT_COMMUNICATION_COMPONENT_CODE
      );
      const resolvedDate = isToday ? (data.currentDate || data.attendanceDate || dateStr) : (data.attendanceDate || dateStr);
      data.attendanceDate = resolvedDate;
      if (isToday) {
        APP_TODAY = data.currentDate || resolvedDate;
        const dateInput = document.getElementById('attDate');
        dateInput.value = APP_TODAY;
        dateInput.max = APP_TODAY;
      }
      BACKEND_ATTENDANCE_BY_DATE.delete(resolvedDate);
      BACKEND_ATTENDANCE_BY_DATE.set(resolvedDate, data);
      BACKEND_ATTENDANCE_ERROR = '';
      return data;
    }

    function getBackendQrScans(data = BACKEND_QR_ATTENDANCE_DATA) {
      return (data?.students || [])
        .filter(student => student.isScanned)
        .map(student => ({
          studentId: String(student.id),
          scannedAt: student.scannedAt || null,
          status: 'present'
        }));
    }

    function syncBackendQrAttendance(data) {
      BACKEND_QR_ATTENDANCE_DATA = data || null;
      qrAttendanceScans = getBackendQrScans(data);
      if (qrAttendanceContext && data) {
        qrAttendanceContext.sessionId = data.session?.id ? String(data.session.id) : null;
        qrAttendanceContext.date = data.attendanceDate || qrAttendanceContext.date;
      }
    }

    async function prepareBackendQrAttendance() {
      const existing = await window.EDUGNAY_API.getQrAttendance(BACKEND_ATTENDANCE_CONTEXT.sectionId, CURRENT_SUBJECT_ID, CURRENT_COMMUNICATION_COMPONENT_CODE);
      if (existing?.session?.status === 'confirmed') {
        throw new Error('Today\'s attendance has already been confirmed.');
      }
      syncBackendQrAttendance(existing);
      return existing;
    }

    async function loadAttendanceForDate(dateStr) {
      const requestedToday = dateStr === APP_TODAY;
      if (dateStr > APP_TODAY) {
        alert('You cannot select a future date.');
        dateStr = APP_TODAY;
        document.getElementById('attDate').value = APP_TODAY;
      }

      if (isBackendAttendanceMode()) {
        document.getElementById('attendanceListFooter').innerHTML = '';
        try {
          const data = await loadBackendAttendanceForDate(dateStr);
          if (requestedToday && data?.attendanceDate) dateStr = data.attendanceDate;
        } catch (error) {
          BACKEND_ATTENDANCE_ERROR = error?.message || 'Attendance could not be loaded.';
          console.warn('Attendance could not be loaded from the API.', BACKEND_ATTENDANCE_ERROR);
        }
        renderTeacherAttendanceRows();
        renderAttendanceHistory();
      }

      const title = document.getElementById('attPanelTitle');
      title.textContent = dateStr === APP_TODAY ? 'Attendance: Today' : 'Attendance: ' + formatAttDate(dateStr);
      const isPast = dateStr < APP_TODAY;
      const dateData = BACKEND_ATTENDANCE_BY_DATE.get(dateStr);
      const locked = isPast && dateData?.canEdit !== true;
      const attendanceUnavailable = isBackendAttendanceMode() && (!CURRENT_SUBJECT_ASSIGNMENT || Boolean(BACKEND_ATTENDANCE_ERROR));
      const lockBanner = document.getElementById('attLockBanner');
      const lockTitle = lockBanner.querySelector('.publish-info-title');
      const lockDescription = lockBanner.querySelector('.publish-info-sub');
      if (attendanceUnavailable) {
        lockBanner.style.display = 'flex';
        lockBanner.style.background = 'var(--red-pale)';
        lockTitle.style.color = 'var(--red)';
        lockTitle.textContent = 'Attendance unavailable';
        lockDescription.textContent = BACKEND_ATTENDANCE_ERROR || 'Select a subject assigned to you to manage attendance.';
      } else {
        lockBanner.style.display = locked ? 'flex' : 'none';
        lockBanner.style.background = 'var(--red-pale)';
        lockTitle.style.color = 'var(--red)';
        lockTitle.textContent = 'Past attendance is read-only';
        lockDescription.textContent = 'To allow changes for this date, ask your school administrator to enable “Allow Teachers to Edit Past Attendance” in System Config.';
      }

      const recordByStudent = Object.fromEntries(getTeacherAttendanceRecords(dateStr).map(record => [record.studentId, record]));

      document.querySelectorAll('#attTbody tr[data-student-id]').forEach(row => {
        const studentId = row.dataset.studentId;
        const group = row.querySelector('.att-btn-group');
        const remarksInput = row.querySelector('td:last-child input');
        const status = ATTENDANCE_CODE_BY_STATUS[recordByStudent[studentId]?.status] || '';

        group.querySelectorAll('.att-btn').forEach(b => {
          b.classList.remove('selected');
          b.setAttribute('aria-pressed', 'false');
          b.disabled = locked || attendanceUnavailable;
        });
        const match = status ? group.querySelector('.att-btn.' + status) : null;
        if (match) {
          match.classList.add('selected');
          match.setAttribute('aria-pressed', 'true');
        }

        remarksInput.value = recordByStudent[studentId]?.remark || '';
        remarksInput.disabled = locked || attendanceUnavailable;
      });

      document.querySelector('#content-attendance .top-btn.secondary:not(#qrAttendanceButton)').disabled = locked || attendanceUnavailable;
      document.querySelector('#content-attendance .top-btn.primary').disabled = locked || attendanceUnavailable;
      document.getElementById('qrAttendanceButton').disabled = dateStr !== APP_TODAY || attendanceUnavailable ||
        !CURRENT_SUBJECT_ASSIGNMENT || dateData?.session?.status === 'confirmed';

      updateAttCount();
    }

    async function openQrAttendance() {
      const hasSubject = Boolean(CURRENT_SUBJECT_ASSIGNMENT);
      if (isBackendAttendanceMode() && !BACKEND_ATTENDANCE_CONTEXT) {
        alert(BACKEND_ATTENDANCE_ERROR || 'Attendance is unavailable for this account.');
        return;
      }
      const attendanceStudents = getAttendanceStudents();
      if (!hasSubject) {
        alert('Select a subject assigned to you before starting QR attendance.');
        return;
      }
      if (!attendanceStudents.length) {
        alert('This section has no students available for attendance.');
        return;
      }

      const dateInput = document.getElementById('attDate');
      dateInput.max = APP_TODAY;
      if (dateInput.value !== APP_TODAY) {
        dateInput.value = APP_TODAY;
        await loadAttendanceForDate(APP_TODAY);
      }

      qrAttendanceContext = {
        schoolId: BACKEND_ATTENDANCE_CONTEXT.schoolId,
        sectionId: BACKEND_ATTENDANCE_CONTEXT.sectionId,
        subjectId: CURRENT_SUBJECT_ID,
        teacherId: BACKEND_ATTENDANCE_CONTEXT.teacherId,
        date: APP_TODAY,
        sessionId: null
      };

      try {
        await prepareBackendQrAttendance();
        APP_TODAY = qrAttendanceContext.date;
        dateInput.value = APP_TODAY;
        dateInput.max = APP_TODAY;
        qrAttendanceScans.forEach(scan => {
          const row = document.querySelector(`#attTbody tr[data-student-id="${scan.studentId}"]`);
          if (!row || row.dataset.manualChoice) return;
          const button = row.querySelector('.att-btn.P');
          row.querySelectorAll('.att-btn').forEach(item => {
            item.classList.toggle('selected', item === button);
            item.setAttribute('aria-pressed', String(item === button));
          });
        });
        updateAttCount();
      } catch (error) {
        alert(error?.message || 'QR attendance could not be started.');
        qrAttendanceContext = null;
        document.getElementById('qrAttendanceButton').disabled = dateInput.value !== APP_TODAY
          || !CURRENT_SUBJECT_ASSIGNMENT || !attendanceStudents.length;
        return;
      }

      document.getElementById('qrAttendanceSection').textContent = `${CURRENT_SECTION} · ${CURRENT_SUBJECT}`;
      document.getElementById('qrAttendanceDate').textContent = formatAttDate(qrAttendanceContext.date);
      const soundToggle = document.getElementById('qrScannerSoundToggle');
      soundToggle.checked = qrScannerSoundEnabled;
      soundToggle.disabled = !Boolean(window.AudioContext || window.webkitAudioContext);
      qrAttendanceReturnFocus = document.activeElement;
      resetQrScanner();
      openModal('qrAttendanceModal');
      lucide.createIcons();
      document.querySelector('#qrAttendanceModal .modal-close')?.focus();
    }

    function setQrScannerStatus(message, tone = '') {
      const status = document.getElementById('qrScannerStatus');
      status.textContent = message;
      status.className = `qr-scanner-status${tone ? ` ${tone}` : ''}`;
    }

    function setQrScannerSoundEnabled(enabled) {
      qrScannerSoundEnabled = Boolean(enabled);
      if (qrScannerSoundEnabled) prepareQrScannerAudio();
    }

    function prepareQrScannerAudio() {
      if (!qrScannerSoundEnabled) return null;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;

      try {
        if (!qrScannerAudioContext) qrScannerAudioContext = new AudioContext();
        if (qrScannerAudioContext.state === 'suspended') {
          qrScannerAudioContext.resume().catch(() => { });
        }
        return qrScannerAudioContext;
      } catch {
        return null;
      }
    }

    function playQrScannerTone(type, scannedValue = '') {
      if (!['success', 'error'].includes(type)) return;
      const now = Date.now();
      if (scannedValue && scannedValue === lastQrScannerToneValue && now - lastQrScannerToneAt < 3000) return;
      const context = prepareQrScannerAudio();
      if (!context || context.state !== 'running') return;
      lastQrScannerToneValue = scannedValue;
      lastQrScannerToneAt = now;

      const tones = type === 'success'
        ? [{ frequency: 660, delay: 0, duration: .08 }, { frequency: 880, delay: .09, duration: .1 }]
        : [{ frequency: 220, delay: 0, duration: .16 }];

      try {
        tones.forEach(tone => {
          const start = context.currentTime + tone.delay;
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = type === 'success' ? 'sine' : 'triangle';
          oscillator.frequency.setValueAtTime(tone.frequency, start);
          gain.gain.setValueAtTime(.035, start);
          gain.gain.linearRampToValueAtTime(0, start + tone.duration);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.addEventListener('ended', () => {
            oscillator.disconnect();
            gain.disconnect();
          }, { once: true });
          oscillator.start(start);
          oscillator.stop(start + tone.duration);
        });
      } catch {
        // Visual scanner feedback remains available when audio playback fails.
      }
    }

    function resetQrScanner() {
      stopQrScanner();
      lastDetectedQrValue = '';
      lastQrScannerToneValue = '';
      lastQrScannerToneAt = 0;
      qrAttendanceScans = getBackendQrScans();
      qrAttendanceDraft = [];
      qrAttendanceSaving = false;
      document.getElementById('qrScannerEmpty').hidden = false;
      document.getElementById('qrAttendanceApplyButton').disabled = false;
      setQrScannerStatus('Camera access has not started.');
      showQrAttendanceReviewMode(false);
      renderQrAttendanceReview();
    }

    function renderQrAttendanceReview() {
      const attendanceStudents = getAttendanceStudents();
      window.TeacherClassViews.renderQrAttendanceScans({
        students: attendanceStudents,
        scannedIds: qrAttendanceScans.map(scan => scan.studentId)
      });
    }

    function showQrAttendanceReviewMode(reviewing) {
      document.querySelector('.qr-attendance-workspace').classList.toggle('reviewing', reviewing);
      document.getElementById('qrAttendanceScanGroups').hidden = reviewing;
      document.getElementById('qrAttendanceFinalReview').hidden = !reviewing;
      const startButton = document.getElementById('qrScannerStartButton');
      const reviewButton = document.getElementById('qrAttendanceReviewButton');
      startButton.hidden = reviewing || qrScannerActive;
      document.getElementById('qrScannerStopButton').hidden = reviewing || !qrScannerActive;
      reviewButton.hidden = reviewing;
      document.getElementById('qrAttendanceBackButton').hidden = !reviewing;
      document.getElementById('qrAttendanceApplyButton').hidden = !reviewing;
      startButton.classList.toggle('btn-save', !qrScannerActive);
      startButton.classList.toggle('btn-cancel', qrScannerActive);
      reviewButton.classList.toggle('btn-save', qrScannerActive);
      reviewButton.classList.toggle('btn-cancel', !qrScannerActive);
    }

    function openQrAttendanceFinalReview() {
      if (!qrAttendanceContext?.sessionId) {
        setQrScannerStatus('Scan at least one student before reviewing attendance.', 'error');
        return;
      }
      stopQrScanner();
      const scansByStudent = Object.fromEntries(qrAttendanceScans.map(scan => [scan.studentId, scan]));
      const attendanceStudents = getAttendanceStudents();

      qrAttendanceDraft = attendanceStudents.map(student => ({
        schoolId: qrAttendanceContext.schoolId,
        sectionId: qrAttendanceContext.sectionId,
        subjectId: qrAttendanceContext.subjectId,
        teacherId: qrAttendanceContext.teacherId,
        studentId: student.id,
        date: qrAttendanceContext.date,
        status: (() => {
          const row = document.querySelector(`#attTbody tr[data-student-id="${student.id}"]`);
          const manual = row?.dataset.manualChoice;
          return ATTENDANCE_STATUS_BY_CODE[manual] || (scansByStudent[student.id] ? 'present' : 'pending');
        })(),
        scannedAt: scansByStudent[student.id]?.scannedAt || null,
        source: 'qr'
      }));

      showQrAttendanceReviewMode(true);
      renderQrAttendanceDraft();
    }

    function renderQrAttendanceDraft() {
      const students = getAttendanceStudents();
      const statusByStudent = new Map(qrAttendanceDraft.map(record => [String(record.studentId), record.status]));
      window.TeacherClassViews.renderQrAttendanceFinalReview({
        students,
        statusByStudent,
        onChange: (studentId, status) => {
          const record = qrAttendanceDraft.find(item => String(item.studentId) === String(studentId));
          if (record) record.status = status;
          const row = document.querySelector(`#attTbody tr[data-student-id="${studentId}"]`);
          const code = ATTENDANCE_CODE_BY_STATUS[status];
          const button = code && row?.querySelector(`.att-btn.${code}`);
          if (button) setAtt(button, code);
        }
      });
    }

    function returnToQrScanning() {
      qrAttendanceDraft = [];
      showQrAttendanceReviewMode(false);
      renderQrAttendanceReview();
    }

    async function confirmQrAttendance() {
      if (qrAttendanceSaving) return;
      const validStatuses = ['present', 'absent', 'late', 'excused'];
      const attendanceStudents = getAttendanceStudents();
      const studentIds = new Set(qrAttendanceDraft.map(record => record.studentId));
      const currentQrDate = BACKEND_QR_ATTENDANCE_DATA?.attendanceDate;
      const validDraft = qrAttendanceContext?.date === currentQrDate &&
        Boolean(CURRENT_SUBJECT_ASSIGNMENT) &&
        Boolean(qrAttendanceContext.sessionId) &&
        qrAttendanceDraft.length === attendanceStudents.length &&
        studentIds.size === attendanceStudents.length &&
        attendanceStudents.every(student => studentIds.has(String(student.id))) &&
        qrAttendanceDraft.every(record => validStatuses.includes(record.status));
      if (!validDraft) {
        alert('Set a status for every student before confirming attendance. Unscanned students are not automatically absent.');
        return;
      }

      const button = document.getElementById('qrAttendanceApplyButton');
      qrAttendanceSaving = true;
      button.disabled = true;
      const recordedAt = new Date().toISOString();
      const rowsByStudent = Object.fromEntries(
        Array.from(document.querySelectorAll('#attTbody tr')).map(row => [row.dataset.studentId, row])
      );
      const records = qrAttendanceDraft.map(record => ({
        schoolId: qrAttendanceContext.schoolId,
        sectionId: qrAttendanceContext.sectionId,
        subjectId: qrAttendanceContext.subjectId,
        teacherId: qrAttendanceContext.teacherId,
        studentId: record.studentId,
        date: qrAttendanceContext.date,
        status: record.status,
        remark: rowsByStudent[record.studentId]?.querySelector('[data-attendance-remark]')?.value.trim() || null,
        source: 'qr',
        scannedAt: record.scannedAt || null,
        recordedAt
      }));

      let confirmed = false;
      try {
        const savedData = await window.EDUGNAY_API.confirmQrAttendance(qrAttendanceContext.sessionId, records);
        syncBackendQrAttendance(savedData);
        BACKEND_ATTENDANCE_BY_DATE.set(savedData.attendanceDate, savedData);
        confirmed = true;
        qrAttendanceSaving = false;
        await loadAttendanceForDate(APP_TODAY);
        renderAttendanceHistory();
        closeModal('qrAttendanceModal');
        showAppToast('QR attendance confirmed.');
      } catch (error) {
        qrAttendanceSaving = false;
        button.disabled = false;
        showAppToast(confirmed ? `QR attendance was confirmed, but the view could not refresh: ${error?.message || 'Reload the page.'}` : error?.message || 'Attendance could not be saved. Please try again.', confirmed ? 'info' : 'error');
      }
    }

    async function supportsNativeQrScanner() {
      const NativeBarcodeDetector = window.BarcodeDetector;
      if (!NativeBarcodeDetector) return false;
      if (typeof NativeBarcodeDetector.getSupportedFormats !== 'function') return true;

      try {
        const formats = await NativeBarcodeDetector.getSupportedFormats();
        return formats.includes('qr_code');
      } catch {
        return false;
      }
    }

    function handleDetectedQrValue(rawValue) {
      const value = String(rawValue || '').trim();
      if (!value || value === lastDetectedQrValue) return;
      lastDetectedQrValue = value;
      void handleQrAttendanceScan(value);
    }

    async function startQrScanner() {
      if (qrScannerActive) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        setQrScannerStatus('Camera access is not supported in this browser or connection.', 'error');
        return;
      }

      prepareQrScannerAudio();
      const startButton = document.getElementById('qrScannerStartButton');
      const nativeSupported = await supportsNativeQrScanner();
      const fallbackSupported = Boolean(window.ZXingBrowser?.BrowserQRCodeReader);
      if (!nativeSupported && !fallbackSupported) {
        setQrScannerStatus('QR scanning is not available in this browser.', 'error');
        return;
      }

      const sessionId = ++qrScannerSessionId;
      startButton.disabled = true;
      setQrScannerStatus('Requesting camera access...');

      try {
        qrScannerStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });

        if (sessionId !== qrScannerSessionId) {
          qrScannerStream.getTracks().forEach(track => track.stop());
          qrScannerStream = null;
          return;
        }

        const video = document.getElementById('qrScannerVideo');
        video.srcObject = qrScannerStream;
        await video.play();
        qrScannerActive = true;
        document.getElementById('qrScannerEmpty').hidden = true;
        startButton.disabled = false;
        showQrAttendanceReviewMode(false);
        setQrScannerStatus('Camera active. Hold a student QR inside the frame.', 'active');

        if (nativeSupported) {
          qrScannerDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
          scanQrCameraFrame();
          return;
        }

        qrScannerFallbackReader = new window.ZXingBrowser.BrowserQRCodeReader();
        qrScannerFallbackControls = await qrScannerFallbackReader.decodeFromStream(
          qrScannerStream,
          video,
          result => handleDetectedQrValue(result?.getText())
        );

        if (sessionId !== qrScannerSessionId) {
          qrScannerFallbackControls?.stop();
        }
      } catch (error) {
        const staleSession = sessionId !== qrScannerSessionId;
        stopQrScanner();
        if (staleSession) return;
        setQrScannerStatus(error?.name === 'NotAllowedError'
          ? 'Camera permission was not granted.'
          : 'The camera could not be started.', 'error');
      }
    }

    async function scanQrCameraFrame() {
      if (!qrScannerActive || !qrScannerDetector) return;

      const video = document.getElementById('qrScannerVideo');
      try {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const codes = await qrScannerDetector.detect(video);
          handleDetectedQrValue(codes[0]?.rawValue);
        }
      } catch {
        setQrScannerStatus('The camera could not read that QR code. Try again.', 'error');
      }

      if (qrScannerActive) qrScannerFrameId = requestAnimationFrame(scanQrCameraFrame);
    }

    async function handleQrAttendanceScan(rawValue) {
      try {
        let result;
        if (qrAttendanceContext?.sessionId) {
          result = await window.EDUGNAY_API.scanQrAttendance(qrAttendanceContext.sessionId, rawValue);
        } else {
          const data = await window.EDUGNAY_API.startQrAttendance(
            BACKEND_ATTENDANCE_CONTEXT.sectionId, CURRENT_SUBJECT_ID,
            CURRENT_COMMUNICATION_COMPONENT_CODE, rawValue);
          syncBackendQrAttendance(data);
          result = data.scanResult;
        }
        if (result?.duplicate) {
          const duplicateName = result.student?.displayName || 'This student';
          setQrScannerStatus(`${duplicateName} has already been scanned.`, 'active');
          playQrScannerTone('error', rawValue);
        } else if (result?.scanned && result.student) {
          const student = result.student;
          if (!qrAttendanceScans.some(scan => String(scan.studentId) === String(student.id))) {
            qrAttendanceScans.push({
              studentId: String(student.id), status: 'present', scannedAt: new Date().toISOString()
            });
          }
          const row = document.querySelector(`#attTbody tr[data-student-id="${student.id}"]`);
          if (row && !row.dataset.manualChoice) {
            const button = row.querySelector('.att-btn.P');
            row.querySelectorAll('.att-btn').forEach(item => {
              item.classList.toggle('selected', item === button);
              item.setAttribute('aria-pressed', String(item === button));
            });
            updateAttCount();
          }
          if (BACKEND_QR_ATTENDANCE_DATA?.students) {
            const scannedStudent = BACKEND_QR_ATTENDANCE_DATA.students.find(item => String(item.id) === String(student.id));
            if (scannedStudent) scannedStudent.isScanned = true;
          }
          renderQrAttendanceReview();
          setQrScannerStatus(`${student.displayName} scanned successfully. ${qrAttendanceScans.length} student${qrAttendanceScans.length === 1 ? '' : 's'} scanned.`, 'success');
          playQrScannerTone('success', rawValue);
        }
      } catch (error) {
        setQrScannerStatus(error?.message || 'This attendance QR could not be accepted.', 'error');
        playQrScannerTone('error', rawValue);
      }
      window.setTimeout(() => {
        if (lastDetectedQrValue === rawValue) lastDetectedQrValue = '';
      }, 1200);
    }

    function stopQrScanner() {
      const wasActive = qrScannerActive || Boolean(qrScannerStream) || Boolean(qrScannerFallbackControls);
      qrScannerSessionId += 1;
      qrScannerActive = false;
      if (qrScannerFrameId) cancelAnimationFrame(qrScannerFrameId);
      qrScannerFrameId = null;
      qrScannerFallbackControls?.stop();
      qrScannerFallbackControls = null;
      qrScannerFallbackReader = null;
      qrScannerStream?.getTracks().forEach(track => track.stop());
      qrScannerStream = null;
      qrScannerDetector = null;

      const video = document.getElementById('qrScannerVideo');
      if (video) video.srcObject = null;
      const startButton = document.getElementById('qrScannerStartButton');
      const stopButton = document.getElementById('qrScannerStopButton');
      const reviewButton = document.getElementById('qrAttendanceReviewButton');
      const emptyState = document.getElementById('qrScannerEmpty');
      if (startButton) {
        startButton.hidden = false;
        startButton.disabled = false;
        startButton.classList.add('btn-save');
        startButton.classList.remove('btn-cancel');
      }
      if (stopButton) stopButton.hidden = true;
      if (reviewButton) {
        reviewButton.classList.add('btn-cancel');
        reviewButton.classList.remove('btn-save');
      }
      if (emptyState) emptyState.hidden = false;
      if (wasActive) setQrScannerStatus('Camera stopped. Start it again to continue scanning.');
    }

    function setAtt(btn, status) {
      const group = btn.closest('.att-btn-group');
      group.closest('tr[data-student-id]').dataset.manualChoice = status;
      group.querySelectorAll('.att-btn').forEach(b => {
        b.classList.remove('selected');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('selected');
      btn.setAttribute('aria-pressed', 'true');
      updateAttCount();
    }

    function updateAttCount() {
      const counts = { P: 0, A: 0, L: 0, E: 0 };
      document.querySelectorAll('#attTbody .att-btn.selected').forEach(btn => {
        const status = ['P', 'A', 'L', 'E'].find(s => btn.classList.contains(s));
        if (status) counts[status]++;
      });
      document.getElementById('countP').textContent = counts.P;
      document.getElementById('countA').textContent = counts.A;
      document.getElementById('countL').textContent = counts.L;
      document.getElementById('countE').textContent = counts.E;
    }

    function markAll(status) {
      document.querySelectorAll('#attTbody .att-btn-group').forEach(group => {
        group.closest('tr[data-student-id]').dataset.manualChoice = status;
        group.querySelectorAll('.att-btn').forEach(b => {
          b.classList.remove('selected');
          b.setAttribute('aria-pressed', 'false');
        });
        const button = group.querySelector('.att-btn.' + status);
        button.classList.add('selected');
        button.setAttribute('aria-pressed', 'true');
      });
      updateAttCount();
    }

    async function saveAttendance() {
      if (isBackendAttendanceMode() && !BACKEND_ATTENDANCE_CONTEXT) {
        alert(BACKEND_ATTENDANCE_ERROR || 'Attendance is unavailable for this account.');
        return;
      }
      const date = document.getElementById('attDate').value;
      const recordedAt = new Date().toISOString();
      const rows = Array.from(document.querySelectorAll('#attTbody tr[data-student-id]'));
      const records = rows.map(row => {
        const studentId = row.dataset.studentId;
        const selectedBtn = row.querySelector('.att-btn.selected');
        const code = selectedBtn ? ['P', 'A', 'L', 'E'].find(status => selectedBtn.classList.contains(status)) : null;
        return {
          schoolId: TEACHER_SECTION_SCHOOL_ID,
          studentId,
          sectionId: CURRENT_SECTION_ID,
          subjectId: CURRENT_SUBJECT_ID,
          date,
          status: ATTENDANCE_STATUS_BY_CODE[code] || 'pending',
          remark: row.querySelector('[data-attendance-remark]')?.value.trim() || null,
          teacherId: CURRENT_TEACHER_ID,
          source: 'manual',
          scannedAt: null,
          recordedAt
        };
      });

      if (records.some(record => record.status === 'pending')) {
        alert('Set an attendance status for every student before saving.');
        return;
      }

      let saved = false;
      try {
        const savedData = await window.EDUGNAY_API.saveSectionAttendance(BACKEND_ATTENDANCE_CONTEXT.sectionId, CURRENT_SUBJECT_ID, {
          attendanceDate: date,
          communicationComponentCode: CURRENT_COMMUNICATION_COMPONENT_CODE || null,
          records
        });
        saved = true;
        BACKEND_ATTENDANCE_BY_DATE.set(savedData.attendanceDate, savedData);
        await loadAttendanceForDate(date);
        rows.forEach(row => { delete row.dataset.manualChoice; });
        showAppToast('Attendance saved.');
      } catch (error) {
        showAppToast(saved ? `Attendance was saved, but the view could not refresh: ${error?.message || 'Reload the page.'}` : error?.message || 'Attendance could not be saved. Please try again.', saved ? 'info' : 'error');
      }
    }

    /* ── STUDENT FILTER ── */
    function filterStudents(query) {
      const q = query.toLowerCase();
      document.querySelectorAll('#studentTbody tr').forEach(row => {
        const name = row.querySelector('.student-name').textContent.toLowerCase();
        row.style.display = name.includes(q) ? '' : 'none';
      });
    }

    /* ── PUBLISH ── */
    function getCurrentFinalGradeScope() {
      const academicPeriodId = document.getElementById('academicPeriodSelect').value;
      const academicTermId = getBackendTermId(academicPeriodId);
      if (!BACKEND_GRADE_CONTEXT?.sectionId || !BACKEND_GRADE_CONTEXT?.subjectId || !academicTermId) {
        throw new Error('The selected section, subject, or grading period is unavailable.');
      }
      return {
        sectionId: String(BACKEND_GRADE_CONTEXT.sectionId),
        subjectId: String(BACKEND_GRADE_CONTEXT.subjectId),
        academicTermId: String(academicTermId)
      };
    }

    function setPublishGradeFeedback(message, isError = false) {
      const feedback = document.getElementById('publishGradeFeedback');
      feedback.textContent = message || '';
      feedback.hidden = !message;
      feedback.classList.toggle('error', Boolean(isError));
    }

    function teacherFriendlyPreviewIssue(issue) {
      const guidance = {
        incompatible_period_structure: 'Ask your school administrator to set up three grading periods for this school year.',
        unconfigured_subject_grading: 'Ask your school administrator to finish this subject\'s grading setup.',
        values_domain_setup_mismatch: 'Ask your school administrator to check the GMRC/Values Education weights (20%, 50%, 30%) and exam split (30%, 30%, 40%).',
        early_grade_exam_setup_required: 'Ask your school administrator to add exam parts for Grades 2 and 3.',
        early_grade_exam_setup_review_required: 'Ask your school administrator to review and save the exam split for Grades 2 and 3.',
        invalid_category_weights: 'Ask your school administrator to make the grading weights total 100%.',
        invalid_rounding_rule: 'Ask your school administrator to check the grade rounding setting.',
        invalid_passing_threshold: 'Ask your school administrator to check the passing grade setting.',
        no_grading_categories: 'Ask your school administrator to set up this subject\'s grading components.',
        no_students: 'Ask your school administrator to check the class list. No active students are enrolled.',
        duplicate_published_grade: 'Ask your school administrator to check duplicate published grades for this subject and period.',
        no_grading_items: 'Add a score item for this grading period.',
        unclassified_shs_section: 'Ask your school administrator to confirm this section\'s strand.',
        unclassified_shs_subject: 'Ask your school administrator to choose this subject\'s grading type.',
        invalid_shs_grading_categories: 'Ask your school administrator to check the SHS grading setup.'
      };
      return (guidance[issue.code] || issue.message || '').replace(/[—–]/g, '-');
    }

    function updateTransferPublishButton() {
      const required = Boolean(publishPreview?.transferReviewStudentIds?.length);
      document.getElementById('publishGradesConfirmButton').disabled = !publishPreview?.readyToPublish || publishInProgress
        || (required && !document.getElementById('transferPublishAcknowledged').checked);
    }

    function renderPublishGradePreview(preview, scope) {
      publishPreview = preview;
      publishPreviewScope = scope;
      const studentList = document.getElementById('publishPreviewStudentList');
      const methodNote = document.getElementById('publishGradeMethodNote');
      const methodText = document.getElementById('publishGradeMethodText');
      const students = Array.isArray(preview.students) ? preview.students : [];
      const usesDepedTransmutation = ['deped_2026_transmutation', 'legacy_shs_transmutation'].includes(preview.gradingMethod)
        || preview.gradingScale === 'legacy_shs_transmutation';
      const usesDepedZeroBased = preview.gradingMethod === 'deped_zero_based';
      const isSchoolSpecificMethod = preview.gradingMethod === 'school_direct';
      const roundingDescriptions = {
        round: 'to the nearest whole number',
        roundup: 'up to the next whole number',
        truncate: 'down to a whole number'
      };
      const roundingDescription = roundingDescriptions[preview.gradeRounding || GRADE_ROUNDING] || 'to a whole number';
      const methodDescription = usesDepedTransmutation
        ? 'Weighted grades are converted to final grades using the DepEd grading method.'
        : usesDepedZeroBased
          ? 'Weighted grades are rounded to a whole number using the DepEd method for this school year.'
          : isSchoolSpecificMethod
            ? `Weighted grades are rounded ${roundingDescription} using the school’s grading rule.`
            : '';
      methodNote.hidden = !methodDescription;
      methodText.textContent = methodDescription;

      const publishableCount = preview.publishableCount ?? students.length;
      const periodName = document.getElementById('academicPeriodSelect')?.selectedOptions?.[0]?.textContent
        || document.getElementById('scorePanelPeriodName')?.textContent
        || 'this grading period';
      const retainedGradeNote = preview.retainedPublishedCount
        ? ` ${preview.retainedPublishedCount} previously published ${preview.retainedPublishedCount === 1 ? 'grade will' : 'grades will'} be kept.`
        : '';
      document.getElementById('publishGradeSummary').textContent = preview.readyToPublish
        ? `Final grades for ${publishableCount} ${publishableCount === 1 ? 'student' : 'students'} are ready to publish for ${periodName}.${retainedGradeNote}`
        : `Review the items below before publishing grades for ${students.length} ${students.length === 1 ? 'student' : 'students'}.`;
      studentList.hidden = !students.length;
      const rows = students.map(student => {
        const finalGrade = Number(student.finalGrade);
        const hasFinalGrade = student.finalGrade !== null && student.finalGrade !== undefined && Number.isFinite(finalGrade);
        const row = { name: student.studentName || 'Student', value: hasFinalGrade ? String(finalGrade) : 'Incomplete', details: [] };
        if (hasFinalGrade) {
          const sourceSectionName = student.sourceSectionName || 'previous section';
          row.ariaLabel = student.retainedPublishedGrade
            ? `Final grade ${finalGrade}, kept from ${sourceSectionName}.`
            : `Final grade ${finalGrade}.`;
          const configuredPassingThreshold = Number(preview.passingGradeThreshold);
          const passingThreshold = Number.isFinite(configuredPassingThreshold) ? configuredPassingThreshold : PASSING_GRADE_THRESHOLD;
          row.tone = getGradeStatusTone(finalGrade, passingThreshold, Math.max(0, passingThreshold - 5));
          if (student.retainedPublishedGrade) {
            row.details.push(`Kept from ${sourceSectionName}.`);
          }
          if (student.isPassing === false) {
            row.details.push(`Below passing grade (${passingThreshold}).`);
          }
          if (!student.retainedPublishedGrade && student.initialGrade !== null && student.initialGrade !== undefined
            && Number.isFinite(Number(student.initialGrade))) {
            row.details.push(`Weighted grade ${Number(student.initialGrade).toFixed(2)}.`);
          }
        }
        return row;
      });
      window.TeacherClassViews.renderGradePreviewRows(studentList, rows);

      const issues = preview.issues || [];
      const missingDomainCount = issues.filter(issue => issue.code === 'missing_values_domain').length;
      const domainsWithoutItems = issues.filter(issue => issue.code === 'values_domain_without_items');
      const messages = [];
      if (missingDomainCount) {
        messages.push(`Choose a domain for ${missingDomainCount} Written/Oral Works or Performance Tasks score item${missingDomainCount === 1 ? '' : 's'}.`);
      }
      const domainsByComponent = new Map();
      for (const issue of domainsWithoutItems) {
        const names = domainsByComponent.get(issue.componentName) || new Set();
        names.add(issue.domainName);
        domainsByComponent.set(issue.componentName, names);
      }
      for (const [componentName, domainNames] of domainsByComponent) {
        const names = [...domainNames];
        const domainList = names.length > 2 ? `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}` : names.join(' and ');
        messages.push(`Add ${names.length === 1 ? 'a ' : ''}${componentName} item${names.length === 1 ? '' : 's'} for ${domainList}.`);
      }
      const specificMissingItems = missingDomainCount || domainsWithoutItems.length || issues.some(issue =>
        ['component_without_items', 'category_without_items', 'exam_part_without_items'].includes(issue.code));
      for (const issue of issues) {
        if (issue.code === 'missing_values_domain' || issue.code === 'values_domain_without_items'
          || (specificMissingItems && issue.code === 'no_grading_items')
          || (issues.some(other => other.code === 'unconfigured_subject_grading') && issue.code === 'no_grading_categories')
          || (issues.some(other => other.code === 'values_domain_setup_mismatch') && issue.code === 'invalid_category_weights')) continue;
        messages.push(teacherFriendlyPreviewIssue(issue));
      }
      if (preview.missingScoreCount) {
        messages.push(`Enter ${preview.missingScoreCount} missing score${preview.missingScoreCount === 1 ? '' : 's'}. A score of 0 is valid.`);
      }
      if (preview.invalidScoreCount) {
        messages.push(`Correct ${preview.invalidScoreCount} score${preview.invalidScoreCount === 1 ? '' : 's'}. Use a number from 0 to the item\'s maximum score.`);
      }
      if (preview.retainedPublishedCount && !publishableCount) messages.push('All students already have published grades for this subject and period.');
      if (!preview.readyToPublish && !messages.length) messages.push('Check the score items and grading setup. The grades are not ready to publish.');
      const warning = document.getElementById('publishGradeWarning');
      warning.hidden = Boolean(preview.readyToPublish);
      const warningList = document.getElementById('publishGradeWarningText');
      warningList.replaceChildren(...[...new Set(messages.filter(Boolean))].map(message => {
        const item = document.createElement('li');
        item.textContent = message;
        return item;
      }));
      document.getElementById('transferPublishReview').hidden = !preview.transferReviewStudentIds?.length;
      document.getElementById('transferPublishAcknowledged').checked = false;
      setPublishGradeFeedback('', false);
      updateTransferPublishButton();
    }

    async function flushPendingBackendScoreSaves() {
      const queued = [...pendingBackendScoreValues.values()];
      for (const record of queued) {
        if (!hasScoreEditingAccess(record.academicPeriodId)) {
          record.failed = true;
          record.error = 'This grading period is not active. The score was not saved.';
          updateScoreFooter();
          throw new Error('This grading period is not active. The score changes could not be saved.');
        }
      }

      for (const scoreId of Object.keys(scoreSaveTimers)) {
        clearTimeout(scoreSaveTimers[scoreId]);
        delete scoreSaveTimers[scoreId];
      }

      await Promise.all(queued.map(savePendingBackendScore));
    }

    async function loadPublishGradePreview() {
      const confirmButton = document.getElementById('publishGradesConfirmButton');
      confirmButton.disabled = true;
      publishPreview = null;
      publishPreviewScope = null;
      document.getElementById('transferPublishReview').hidden = true;
      document.getElementById('transferPublishAcknowledged').checked = false;
      document.getElementById('publishGradeWarning').hidden = true;
      setPublishGradeFeedback('Saving pending score changes and checking the grades…');
      document.getElementById('publishPreviewStudentList').replaceChildren();
      document.getElementById('publishPreviewStudentList').hidden = true;
      document.getElementById('publishGradeMethodNote').hidden = true;

      if (BACKEND_GRADE_ERROR) throw new Error(BACKEND_GRADE_ERROR);
      const academicPeriodId = document.getElementById('academicPeriodSelect').value;
      if (!canPublishGradePeriod(academicPeriodId)) {
        throw new Error('Only the active grading period can be published.');
      }

      await flushPendingBackendScoreSaves();
      const scope = getCurrentFinalGradeScope();
      const preview = await window.EDUGNAY_API.getFinalGradePreview(scope);
      renderPublishGradePreview(preview, scope);
    }

    async function openPublishGradesModal() {
      openModal('publishModal');
      publishPreview = null;
      publishPreviewScope = null;
      const confirmButton = document.getElementById('publishGradesConfirmButton');
      confirmButton.disabled = false;
      document.getElementById('publishPreviewStudentList').replaceChildren();
      document.getElementById('publishPreviewStudentList').hidden = true;
      document.getElementById('publishGradeMethodNote').hidden = true;
      document.getElementById('publishGradeWarning').hidden = true;

      if (!isBackendGradeMode()) {
        confirmButton.disabled = true;
        setPublishGradeFeedback(BACKEND_GRADE_ERROR || 'Grades cannot be published right now. Refresh and try again.', true);
        return;
      }

      confirmButton.disabled = true;
      try {
        await loadPublishGradePreview();
      } catch (error) {
        setPublishGradeFeedback(error.message || 'The grade preview could not be loaded.', true);
      }
    }

    async function publishGrades() {
      if (!isBackendGradeMode()) {
        setPublishGradeFeedback(BACKEND_GRADE_ERROR || 'Grades cannot be published right now. Refresh and try again.', true);
        return;
      }
      if (publishInProgress) return;

      const confirmButton = document.getElementById('publishGradesConfirmButton');
      publishInProgress = true;
      confirmButton.disabled = true;
      setPublishGradeFeedback('Publishing final grades…');

      try {
        await flushPendingBackendScoreSaves();
        const scope = getCurrentFinalGradeScope();
        if (!publishPreview?.readyToPublish
          || !publishPreviewScope
          || Object.keys(scope).some(key => scope[key] !== publishPreviewScope[key])) {
          await loadPublishGradePreview();
          return;
        }

        if (!canPublishGradePeriod(document.getElementById('academicPeriodSelect').value)) {
          throw new Error('Only the active grading period can be published.');
        }

        const result = await window.EDUGNAY_API.publishFinalGrades({ ...scope, transferReviewAcknowledged: document.getElementById('transferPublishAcknowledged').checked });
        const publishedItemIds = new Set((result.gradingItemIds || []).map(String));
        BACKEND_GRADING_ITEMS = BACKEND_GRADING_ITEMS.map(item => publishedItemIds.has(String(item.id))
          ? { ...item, usedInPublishedGrades: true } : item);
        closeModal('publishModal');
        try {
          const [publishedGrades, gradingItems] = await Promise.all([
            window.EDUGNAY_API.getFinalGrades({ sectionId: scope.sectionId, subjectId: scope.subjectId }),
            window.EDUGNAY_API.getGradingItems({ sectionId: scope.sectionId,
              subjectId: scope.subjectId, communicationComponentCode: scope.communicationComponentCode })
          ]);
          BACKEND_PUBLISHED_GRADES = publishedGrades;
          BACKEND_GRADING_ITEMS = gradingItems.filter(item => item.subjectId === String(scope.subjectId)
            && (item.communicationComponentCode || null) === (scope.communicationComponentCode || null));
          updatePublishedGradesBanner(document.getElementById('academicPeriodSelect').value);
          showAppToast(`Grades published for ${result.publishedCount} students.`);
        } catch (refreshError) {
          showAppToast(`Grades were published for ${result.publishedCount} students, but the status could not refresh. Reload the page to verify it.`, 'info');
        }
      } catch (error) {
        setPublishGradeFeedback(error.message || 'Grades could not be published.', true);
        if (error.status === 409) {
          try {
            await loadPublishGradePreview();
          } catch (previewError) {
            setPublishGradeFeedback(previewError.message || 'Refresh the preview before trying again.', true);
          }
        }
      } finally {
        publishInProgress = false;
        if (document.getElementById('publishModal').classList.contains('open')) {
          confirmButton.disabled = !publishPreview?.readyToPublish;
        }
      }
    }

    /* ── ASSIGNMENTS ── */
    function getTeacherAssignments() {
      return BACKEND_ASSIGNMENTS;
    }

    function getTeacherAssignmentStatuses(assignmentId) {
      if (BACKEND_SUBMISSION_ERRORS.has(String(assignmentId))) return [];
      const submissions = BACKEND_SUBMISSIONS.get(String(assignmentId)) || [];
      return (getGradeStudents().length ? getGradeStudents() : STUDENTS).map(student => {
        const submission = submissions.find(record => String(record.studentId) === String(student.id));
        return {
          studentId: String(student.id),
          status: submission?.status || 'pending'
        };
      });
    }

    function closeAssignmentMenus() {
      document.querySelectorAll('.assignment-action-menu.open').forEach(menu => menu.classList.remove('open'));
      document.querySelectorAll('.assignment-menu-trigger[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    }

    document.addEventListener('click', event => {
      if (!event.target.closest('.assignment-card-menu')) closeAssignmentMenus();
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      closeAssignmentMenus();
      const scoreMenuTrigger = document.querySelector('.score-comp-menu-trigger[aria-expanded="true"]');
      closeScoreComponentMenu();
      scoreMenuTrigger?.focus();
      const openModalBackdrop = document.querySelector('#assignmentSubmissionPreviewModal.open')
        || document.querySelector('.modal-backdrop.open');
      if (openModalBackdrop?.id === 'teacherStudentDetailsModal') closeTeacherStudentDetailsModal();
      else if (openModalBackdrop) closeModal(openModalBackdrop.id);
    });

    function renderAssignments() {
      const assignments = getTeacherAssignments();
      document.getElementById('assignmentCount').textContent = assignments.length;
      const gradeStudents = getGradeStudents();
      const items = assignments.map(a => {
        const submissionUnavailable = BACKEND_SUBMISSIONS_LOADING || BACKEND_SUBMISSION_ERRORS.has(String(a.id));
        const submitted = getTeacherAssignmentStatuses(a.id)
          .filter(record => record.status === 'submitted').length;
        const dueLabel = a.dueDate
          ? new Date(a.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'No due date';
        const gradingRule = (() => {
          const rule = GRADING_RULES_BY_ID[String(a.categoryId || '').toLowerCase()]
            || BACKEND_CATEGORIES.find(category => String(category.code).toLowerCase() === String(a.categoryId || '').toLowerCase());
          return rule && !rule.label ? { ...rule, label: rule.name } : rule;
        })();
        const gradingLabel = gradingRule && Number(a.maxScore) > 0
          ? ` · ${window.EDUGNAY_CONFIG.escapeHtml(gradingRule.label)} · ${a.maxScore} points`
          : ' · Not included in Score Recording';
        const actions = [{ label: a.onlineSubmissionEnabled === true ? 'View Status' : 'Update Status', icon: a.onlineSubmissionEnabled === true ? 'eye' : 'check-square', onClick: () => openStatusModal(a.id) }];
        if (a.onlineSubmissionEnabled === true) actions.push({ label: 'View Submissions', icon: 'inbox', onClick: () => openAssignmentSubmissionsModal(a.id) });
        if (!a.legacyCommunication) actions.push(
          { label: 'Edit Assignment', icon: 'pencil', menu: true, onClick: () => { closeAssignmentMenus(); openEditAssignmentModal(a.id); } },
          { label: a.gradingItemId ? 'Delete Assignment & Component' : 'Delete Assignment', icon: 'trash-2', menu: true, danger: true, onClick: () => { closeAssignmentMenus(); openTeacherDeleteModal('assignment', a.id, a.title); } }
        );
        return {
          id: a.id, title: a.title,
          subjectName: a.communicationComponentName || a.subjectName,
          dueLabel,
          submittedCount: submissionUnavailable ? null : submitted,
          totalCount: submissionUnavailable ? null : gradeStudents.length,
          statusLabel: a.publicationStatus === 'draft' ? 'Draft' : a.publicationStatus === 'published' ? 'Published' : '',
          gradingLabel: gradingLabel.replace(/^\s*·\s*/, ''), actions
        };
      });
      window.TeacherClassViews.renderAssignments(items, {
        icon: 'clipboard-check', title: 'No assignments yet', text: 'Assignments created for this class will appear here.'
      });
    }

    async function loadBackendAssignments() {
      document.getElementById('assignmentList').innerHTML = '';
      if (!window.EDUGNAY_API?.isBackendAvailable || !CURRENT_BACKEND_SECTION
        || !CURRENT_SUBJECT_ASSIGNMENT || !hasValidBackendSubjectAssignment()) {
        BACKEND_ASSIGNMENTS = [];
        window.TeacherClassViews.renderAssignments([], {
          icon: 'triangle-alert', title: 'Assignments unavailable',
          text: BACKEND_GRADE_ERROR || 'An assigned subject is needed to show this class’s assignments.'
        });
        return;
      }
      try {
        const assignments = await window.EDUGNAY_API.getAssignments({
          sectionId: CURRENT_SECTION_ID, subjectId: CURRENT_SUBJECT_ID,
          communicationComponentCode: CURRENT_COMMUNICATION_COMPONENT_CODE || null
        });
        BACKEND_ASSIGNMENTS = assignments;
        BACKEND_SUBMISSION_ERRORS.clear();
        BACKEND_SUBMISSIONS_LOADING = true;
        const subtitle = document.getElementById('assignmentPanelSub');
        if (subtitle) subtitle.innerHTML = '';
        renderAssignments();
        const results = await Promise.allSettled(assignments.map(assignment =>
          window.EDUGNAY_API.getAssignmentSubmissions(assignment.id)));
        results.forEach((result, index) => {
          const assignmentId = String(assignments[index].id);
          BACKEND_SUBMISSIONS.delete(assignmentId);
          if (result.status === 'fulfilled') BACKEND_SUBMISSIONS.set(assignmentId, result.value);
          else BACKEND_SUBMISSION_ERRORS.add(assignmentId);
        });
        BACKEND_SUBMISSIONS_LOADING = false;
        const unavailableCount = BACKEND_SUBMISSION_ERRORS.size;
        if (subtitle) subtitle.textContent = unavailableCount
          ? 'Some submission counts could not be loaded for ' + unavailableCount + ' assignment' + (unavailableCount === 1 ? '' : 's') + '.'
          : 'Assignments can be linked to an assessment in Score Recording.';
        refreshAssignmentCategoryOptions();
        renderAssignments();
      } catch (error) {
        BACKEND_ASSIGNMENTS = [];
        BACKEND_SUBMISSION_ERRORS.clear();
        BACKEND_SUBMISSIONS_LOADING = false;
        window.TeacherClassViews.renderAssignments([], {
          icon: 'triangle-alert', title: 'Assignments unavailable',
          text: error?.message || 'Assignments could not be loaded. Reload the page to try again.'
        });
      }
    }

    const TEACHER_MATERIAL_TYPE_META = {
      pdf: { label: 'PDF', icon: 'file-text', bg: 'var(--red-pale)', color: 'var(--red)' },
      pptx: { label: 'PowerPoint', icon: 'presentation', bg: 'var(--blue-xpale)', color: 'var(--blue-mid)' },
      xlsx: { label: 'Excel', icon: 'table', bg: 'var(--green-pale)', color: 'var(--green)' },
      png: { label: 'Image', icon: 'image', bg: 'var(--gold-pale)', color: 'var(--gold-dark)' },
      docx: { label: 'Word', icon: 'file-text', bg: 'var(--purple-pale)', color: 'var(--purple)' },
      doc: { label: 'Word', icon: 'file-text', bg: 'var(--purple-pale)', color: 'var(--purple)' },
      ppt: { label: 'PowerPoint', icon: 'presentation', bg: 'var(--blue-xpale)', color: 'var(--blue-mid)' },
      xls: { label: 'Excel', icon: 'table', bg: 'var(--green-pale)', color: 'var(--green)' },
      jpg: { label: 'Image', icon: 'image', bg: 'var(--gold-pale)', color: 'var(--gold-dark)' },
      mp4: { label: 'Video', icon: 'video', bg: 'var(--green-pale)', color: 'var(--green)' },
      video: { label: 'Video', icon: 'video', bg: 'var(--green-pale)', color: 'var(--green)' }
    };

    function formatTeacherMaterialDate(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? 'Date unavailable'
        : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function renderTeacherMaterials() {
      const panelSub = document.querySelector('#content-materials .panel-sub');
      if (panelSub) panelSub.textContent = `${CURRENT_SECTION} · ${CURRENT_SUBJECT} · ${TEACHER_MATERIALS.length} files uploaded`;
      window.TeacherClassViews.renderMaterials(TEACHER_MATERIALS, backendMaterialsError
        ? { icon: 'cloud-off', title: 'Materials unavailable', text: backendMaterialsError }
        : { icon: 'folder-open', title: 'No learning materials', text: 'Files shared with this class will appear here.' });
    }

    async function submitSectionMaterialUpload() {
      const uploadButton = document.getElementById('materialUploadSubmit');
      if (uploadButton.disabled || materialUploadInProgress) return false;
      const file = selectedMaterialFile;
      const title = document.getElementById('materialTitleInput')?.value.trim();
      const status = document.getElementById('materialVisibilityInput')?.value || 'published';

      if (!file) {
        setMaterialUploadHelp('Choose a file before uploading.', 'error');
        return false;
      }
      if (!title) {
        materialTitleValidationPending = true;
        setMaterialUploadHelp('Enter a title before uploading.', 'error');
        document.getElementById('materialTitleInput').focus();
        return false;
      }

      if (!BACKEND_MATERIAL_CONTEXT) {
        setMaterialUploadHelp('Your section and subject assignment is unavailable. Try refreshing the page.', 'error');
        return false;
      }

      materialUploadInProgress = true;
      uploadButton.disabled = true;
      uploadButton.innerHTML = '<i data-lucide="loader-circle" style="width:13px;height:13px;"></i> Uploading...';
      document.getElementById('fileInput').disabled = true;
      document.getElementById('materialFileRemove').disabled = true;
      setMaterialUploadHelp('Uploading your file...', 'uploading');
      lucide.createIcons();

      try {
        await window.EDUGNAY_API.uploadMaterial(BACKEND_MATERIAL_CONTEXT.sectionId, BACKEND_MATERIAL_CONTEXT.subjectId,
          { file, title, status, communicationComponentCode: BACKEND_MATERIAL_CONTEXT.communicationComponentCode });
        materialUploadInProgress = false;
        closeModal('uploadModal');
        await loadBackendMaterials();
        showAppToast(backendMaterialsError
          ? `The file was uploaded, but the materials list could not refresh: ${backendMaterialsError}`
          : `"${title}" was ${status === 'published' ? 'published' : 'saved as a draft'} for ${CURRENT_SECTION}.`,
          backendMaterialsError ? 'info' : 'success');
      } catch (error) {
        setMaterialUploadHelp(error.message || 'Upload failed. Your file is still selected; try again.', 'error');
      } finally {
        materialUploadInProgress = false;
        uploadButton.innerHTML = '<i data-lucide="upload" style="width:13px;height:13px;"></i> Upload';
        uploadButton.disabled = !selectedMaterialFile;
        document.getElementById('fileInput').disabled = false;
        document.getElementById('materialFileRemove').disabled = false;
        lucide.createIcons();
      }
      return false;
    }

    document.getElementById('teacherMaterialsList')?.addEventListener('click', async event => {
      const button = event.target.closest('[data-material-action]');
      if (!button || !window.EDUGNAY_API?.isBackendAvailable) return;
      const materialId = button.dataset.materialId;
      const action = button.dataset.materialAction;
      if (action === 'preview') return;
      if (action === 'remove') {
        openTeacherDeleteModal('material', materialId, button.dataset.materialTitle);
        return;
      }
      button.disabled = true;
      try {
        if (action === 'publish') await window.EDUGNAY_API.updateMaterial(materialId, 'published');
        const electiveClassId = new URLSearchParams(window.location.search).get('classId');
        if (electiveClassId) {
          window.dispatchEvent(new CustomEvent('edugnay:teacher-materials-changed', { detail: { classId: electiveClassId } }));
          showAppToast('Material published.');
        } else {
          await loadBackendMaterials();
          showAppToast(backendMaterialsError ? 'Material updated, but the list could not refresh. Reload the page to verify it.' : 'Material published.', backendMaterialsError ? 'info' : 'success');
        }
      } catch (error) { showAppToast(error.message || 'The material could not be updated.', 'error'); button.disabled = false; }
    });

    async function addAssignment() {
      const title = document.getElementById('assignTitleInput').value.trim();
      const instructions = document.getElementById('assignInstructionsInput').value.trim();
      const due = document.getElementById('assignDueInput').value;
      const onlineSubmissionEnabled = document.getElementById('assignOnlineSubmissionInput').checked;
      const includeInScoreRecording = document.getElementById('assignGradingInput').checked;
      const academicPeriodId = document.getElementById('academicPeriodSelect').value;
      const categoryId = includeInScoreRecording ? document.getElementById('assignCategoryInput').value : null;
      const category = includeInScoreRecording ? getBackendCategory(categoryId) : null;
      const isSubjectConfig = Boolean(BACKEND_SUBJECT_GRADING_CONFIG?.applicable);
      const subjectGradingComponentId = isSubjectConfig ? category?.subjectGradingComponentId || null : null;
      const subjectGradingExamPartId = isSubjectConfig && category?.examParts?.length
        ? Number(document.getElementById('assignExamPartInput').value) || null : null;
      const domainCode = includeInScoreRecording && !document.getElementById('assignDomainGroup').hidden
        ? document.getElementById('assignDomainInput').value : null;
      const maxScore = includeInScoreRecording ? Number(document.getElementById('assignMaxScoreInput').value) : null;
      if (!CURRENT_SUBJECT_ASSIGNMENT || !CURRENT_SUBJECT_ID) {
        showAppToast('Select an assigned subject before adding an assignment.', 'error');
        return;
      }
      if (!academicPeriodId) {
        showAppToast('Select a grading period before adding an assignment.', 'error');
        return;
      }
      if (!title || !due) { alert('Please fill in task title and due date.'); return; }
      if (includeInScoreRecording && (!categoryId || (isSubjectConfig && !subjectGradingComponentId)
        || (isSubjectConfig && category?.examParts?.length && !subjectGradingExamPartId) || !(maxScore > 0))) {
        alert('Please select a grading category and enter the highest possible score.');
        return;
      }
      if (includeInScoreRecording && !requireScoreEditingAccess(academicPeriodId)) return;

      if (isBackendGradeMode()) {
        const academicTermId = getBackendTermId(academicPeriodId);
        if (!academicTermId || (includeInScoreRecording && !category)) {
          alert('That grading period or score category is not available yet. Refresh and try again.');
          return;
        }
        try {
          const assignment = await window.EDUGNAY_API.createAssignment({
            sectionId: BACKEND_GRADE_CONTEXT.sectionId,
            subjectId: BACKEND_GRADE_CONTEXT.subjectId,
            communicationComponentCode: BACKEND_GRADE_CONTEXT.communicationComponentCode,
            academicTermId,
            gradingCategoryId: isSubjectConfig ? null : category?.id || null,
            subjectGradingComponentId,
            subjectGradingExamPartId,
            domainCode,
            title,
            description: instructions || null,
            dueDate: due,
            onlineSubmissionEnabled,
            maxScore: includeInScoreRecording ? maxScore : null
          });
          if (!assignment) throw new Error('The assignment could not be created.');
          BACKEND_ASSIGNMENTS.push(assignment);
          let gradeRefreshFailed = false;
          if (includeInScoreRecording) {
            try {
              const items = await window.EDUGNAY_API.getGradingItems({ sectionId: BACKEND_GRADE_CONTEXT.sectionId,
                subjectId: BACKEND_GRADE_CONTEXT.subjectId,
                communicationComponentCode: BACKEND_GRADE_CONTEXT.communicationComponentCode });
              BACKEND_GRADING_ITEMS = items.filter(item => item.subjectId === String(BACKEND_GRADE_CONTEXT.subjectId)
                && (item.communicationComponentCode || null) === (BACKEND_GRADE_CONTEXT.communicationComponentCode || null));
            } catch { gradeRefreshFailed = true; }
          }
          resetAssignmentForm();
          closeModal('addAssignmentModal');
          renderAssignments();
          renderScoreTable(academicPeriodId);
          showAppToast(gradeRefreshFailed ? 'Assignment added, but the score table could not refresh.' : 'Assignment added.', gradeRefreshFailed ? 'info' : 'success');
        } catch (error) {
          showAppToast(error.message || 'The assignment could not be added.', 'error');
        }
        return;
      }

      showAppToast(BACKEND_GRADE_ERROR || 'Assignments are not available right now. Refresh and try again.', 'error');
    }

    function resetAssignmentForm() {
      document.getElementById('assignTitleInput').value = '';
      document.getElementById('assignInstructionsInput').value = '';
      document.getElementById('assignDueInput').value = '';
      document.getElementById('assignOnlineSubmissionInput').checked = false;
      document.getElementById('assignGradingInput').checked = false;
      document.getElementById('assignGradingFields').hidden = true;
      document.getElementById('assignMaxScoreInput').value = '';
    }

    let activeAssignmentId = null;
    let assignmentPreviewObjectUrl = null;
    let assignmentPreviewRequestId = 0;
    let assignmentPreviewState = null;

    function openEditAssignmentModal(assignmentId) {
      const electiveClassId = new URLSearchParams(window.location.search).get('classId');
      if (electiveClassId) {
        const assignment = window.AcademixElectiveClass?.getAssignment(assignmentId);
        if (!assignment) return;
        if (!window.AcademixElectiveClass?.canEdit()) return showAppToast('This class is read-only.', 'error');
        activeAssignmentId = String(assignment.id);
        document.getElementById('editAssignmentTitleInput').value = assignment.title || '';
        document.getElementById('editAssignmentTitleInput').readOnly = Boolean(assignment.gradingItemId);
        document.getElementById('editAssignmentInstructionsInput').value = assignment.instructions || assignment.description || '';
        document.getElementById('editAssignmentSubjectInput').value = assignment.communicationComponentName || assignment.subjectName || 'Class assignment';
        document.getElementById('editAssignmentDueInput').value = assignment.dueDate || String(assignment.dueAt || '').slice(0, 10);
        document.getElementById('editAssignmentOnlineInput').checked = assignment.onlineSubmissionEnabled === true;
        openModal('editAssignmentModal');
        void window.AcademixElectiveClass.prepareAssignmentGrading(true, assignment);
        lucide.createIcons();
        return;
      }
      const assignment = getTeacherAssignments().find(item => item.id === String(assignmentId));
      if (!assignment) return;

      activeAssignmentId = assignment.id;
      document.getElementById('editAssignmentTitleInput').value = assignment.title || '';
      document.getElementById('editAssignmentTitleInput').readOnly = false;
      document.getElementById('editAssignmentInstructionsInput').value = assignment.instructions || '';
      document.getElementById('editAssignmentSubjectInput').value = assignment.communicationComponentName || assignment.subjectName || CURRENT_SUBJECT;
      document.getElementById('editAssignmentDueInput').value = assignment.dueDate || '';
      document.getElementById('editAssignmentOnlineInput').checked = assignment.onlineSubmissionEnabled === true;
      const includeInScoreRecording = Boolean((assignment.categoryId || assignment.subjectGradingComponentId) && Number(assignment.maxScore) > 0);
      document.getElementById('editAssignmentGradingInput').checked = includeInScoreRecording;
      document.getElementById('editAssignmentGradingFields').hidden = !includeInScoreRecording;
      const selectedCategory = assignment.subjectGradingComponentId
        ? BACKEND_CATEGORIES.find(category => String(category.subjectGradingComponentId) === String(assignment.subjectGradingComponentId))
        : null;
      document.getElementById('editAssignmentCategoryInput').value = selectedCategory?.code || assignment.categoryId || '';
      updateAssignmentExamParts('editAssignmentCategoryInput', 'editAssignmentExamPartGroup', 'editAssignmentExamPartInput', assignment.subjectGradingExamPartId);
      updateValuesDomainSelect(document.getElementById('editAssignmentCategoryInput').value,
        'editAssignmentDomainGroup', 'editAssignmentDomainInput', assignment.domainCode, true);
      document.getElementById('editAssignmentMaxScoreInput').value = assignment.maxScore || '';
      openModal('editAssignmentModal');
      lucide.createIcons();
    }

    async function saveAssignmentChanges() {
      if (!activeAssignmentId) return;

      const title = document.getElementById('editAssignmentTitleInput').value.trim();
      const instructions = document.getElementById('editAssignmentInstructionsInput').value.trim();
      const dueDate = document.getElementById('editAssignmentDueInput').value;
      const onlineSubmissionEnabled = document.getElementById('editAssignmentOnlineInput').checked;
      const electiveClassId = new URLSearchParams(window.location.search).get('classId');
      if (electiveClassId) {
        if (!title || !dueDate) return showAppToast('Enter an assignment title and due date.', 'error');
        if (!window.AcademixElectiveClass?.canEdit()) return showAppToast('This class is read-only.', 'error');
        const assignment = window.AcademixElectiveClass.getAssignment(activeAssignmentId);
        let grade;
        try { grade = window.AcademixElectiveClass.assignmentGradePayload(true, assignment); }
        catch (error) { return showAppToast(error.message, 'error'); }
        const originalDueDate = assignment?.dueDate || String(assignment?.dueAt || '').slice(0, 10);
        const dueAt = dueDate === originalDueDate ? undefined : dueDate + 'T23:59:00';
        const saveButton = document.querySelector('#editAssignmentModal .modal-foot .btn-save');
        saveButton.disabled = true;
        try {
          await window.EDUGNAY_API.updateAssignment(activeAssignmentId, {
            title, description: instructions || null, dueAt, onlineSubmissionEnabled, grade
          });
          closeModal('editAssignmentModal');
          activeAssignmentId = null;
          await window.AcademixElectiveClass.refresh('assignments');
          showAppToast('Assignment updated.');
        } catch (error) {
          showAppToast(error.message || 'The assignment could not be updated.', 'error');
        } finally {
          saveButton.disabled = false;
        }
        return;
      }
      const includeInScoreRecording = document.getElementById('editAssignmentGradingInput').checked;
      const categoryId = includeInScoreRecording ? document.getElementById('editAssignmentCategoryInput').value : null;
      const category = includeInScoreRecording ? getBackendCategory(categoryId) : null;
      const isSubjectConfig = Boolean(BACKEND_SUBJECT_GRADING_CONFIG?.applicable);
      const subjectGradingComponentId = isSubjectConfig ? category?.subjectGradingComponentId || null : null;
      const subjectGradingExamPartId = isSubjectConfig && category?.examParts?.length
        ? Number(document.getElementById('editAssignmentExamPartInput').value) || null : null;
      const domainCode = includeInScoreRecording && !document.getElementById('editAssignmentDomainGroup').hidden
        ? document.getElementById('editAssignmentDomainInput').value : null;
      const maxScore = includeInScoreRecording ? Number(document.getElementById('editAssignmentMaxScoreInput').value) : null;
      if (!title || !dueDate) {
        alert('Please fill in task title and due date.');
        return;
      }
      if (includeInScoreRecording && (!categoryId || (isSubjectConfig && !subjectGradingComponentId)
        || (isSubjectConfig && category?.examParts?.length && !subjectGradingExamPartId) || !(maxScore > 0))) {
        alert('Please select a grading category and enter the highest possible score.');
        return;
      }

      if (includeInScoreRecording) {
        const highestScore = getAssignmentScoreRecords(activeAssignmentId)
          .reduce((highest, record) => Math.max(highest, Number(record.score) || 0), 0);
        if (maxScore < highestScore) {
          alert(`The highest possible score cannot be lower than the existing score of ${highestScore}.`);
          return;
        }
      }

      if (isBackendGradeMode()) {
        const assignment = getTeacherAssignments().find(item => item.id === String(activeAssignmentId));
        const academicTermId = getBackendTermId(assignment?.academicPeriodId || document.getElementById('academicPeriodSelect').value);
        if (!assignment || !academicTermId || (includeInScoreRecording && !category)) {
          alert('That grading period or score category is not available yet. Refresh and try again.');
          return;
        }
        try {
          const currentGradingItem = getBackendGradingItemForAssignment(assignment);
          if (currentGradingItem && (!includeInScoreRecording || (isSubjectConfig
            ? String(currentGradingItem.subjectGradingComponentId || '') !== String(subjectGradingComponentId || '')
            || String(currentGradingItem.subjectGradingExamPartId || '') !== String(subjectGradingExamPartId || '')
            : Number(currentGradingItem.gradingCategoryId) !== Number(category.id)))) {
            alert('An assignment already linked to a score component cannot change or remove its grading category.');
            return;
          }
          const updated = await window.EDUGNAY_API.updateAssignment(activeAssignmentId, {
            academicTermId,
            gradingCategoryId: isSubjectConfig ? null : category?.id || null,
            subjectGradingComponentId,
            subjectGradingExamPartId,
            domainCode,
            title,
            description: instructions || null,
            dueDate,
            onlineSubmissionEnabled,
            maxScore: includeInScoreRecording ? maxScore : null
          });
          const index = BACKEND_ASSIGNMENTS.findIndex(item => item.id === String(activeAssignmentId));
          if (index >= 0 && updated) BACKEND_ASSIGNMENTS[index] = updated;
          const gradingItem = currentGradingItem || getBackendGradingItemForAssignment(updated || assignment);
          if (gradingItem && includeInScoreRecording) {
            const savedItem = String(updated?.gradingItemId) === String(gradingItem.id)
              ? { ...gradingItem, title, name: title, max: maxScore, maxScore, domainCode }
              : await window.EDUGNAY_API.updateGradingItem(gradingItem.id, { title, maxScore, domainCode });
            const itemIndex = BACKEND_GRADING_ITEMS.findIndex(item => item.id === gradingItem.id);
            if (itemIndex >= 0) BACKEND_GRADING_ITEMS[itemIndex] = savedItem;
          } else if (!gradingItem && includeInScoreRecording) {
            const savedItem = await window.EDUGNAY_API.createGradingItem({
              sectionId: BACKEND_GRADE_CONTEXT.sectionId,
              subjectId: BACKEND_GRADE_CONTEXT.subjectId,
              academicTermId,
              gradingCategoryId: isSubjectConfig ? null : category.id,
              subjectGradingComponentId,
              subjectGradingExamPartId,
              domainCode,
              assignmentId: activeAssignmentId,
              title,
              maxScore
            });
            if (savedItem) {
              if (index >= 0) BACKEND_ASSIGNMENTS[index].gradingItemId = savedItem.id;
              BACKEND_GRADING_ITEMS.push(savedItem);
            }
          }
          closeModal('editAssignmentModal');
          activeAssignmentId = null;
          renderAssignments();
          renderScoreTable(document.getElementById('academicPeriodSelect').value);
          showAppToast('Assignment updated.');
        } catch (error) {
          showAppToast(error.message || 'The assignment could not be updated.', 'error');
        }
        return;
      }

      showAppToast(BACKEND_GRADE_ERROR || 'Assignments are not available right now. Refresh and try again.', 'error');
    }

    function openAssignmentSubmissionsModal(assignmentId) {
      const assignment = getTeacherAssignments().find(item => item.id === String(assignmentId));
      if (!assignment) return;

      activeAssignmentId = assignment.id;
      const submissions = (BACKEND_SUBMISSIONS.get(String(assignment.id)) || [])
        .filter(submission => submission.fileName);
      const scores = getAssignmentScoreRecords(assignment.id);
      window.TeacherClassViews.renderAssignmentSubmissions({
        subtitle: assignment.title,
        columns: [
          {
            key: 'student', label: 'Student', render: submission => {
              const student = getGradeStudents().find(item => String(item.id) === String(submission.studentId));
              return window.EDUGNAY_CONFIG.escapeHtml(student?.displayName || 'Unknown student');
            }
          },
          { key: 'file', label: 'File', render: submission => window.EDUGNAY_CONFIG.escapeHtml(submission.fileName) },
          { key: 'submitted', label: 'Submitted at', render: submission => window.EDUGNAY_CONFIG.formatDateTime(submission.submittedAt) },
          {
            key: 'score', label: 'Score', render: submission => {
              const score = scores.find(record => String(record.studentId) === String(submission.studentId))?.score ?? '';
              return (assignment.categoryId || assignment.subjectGradingComponentId) && Number(assignment.maxScore) > 0
                ? `<div class="assignment-submission-score"><input class="score-input" type="number" min="0" max="${Number(assignment.maxScore)}" value="${window.EDUGNAY_CONFIG.escapeHtml(score)}" data-submission-student-id="${Number(submission.studentId)}" ${hasScoreEditingAccess(assignment.academicPeriodId) ? '' : 'disabled'} data-page-change="${window.EDUGNAY_PAGE_EVENTS.register('change', function(event) { saveAssignmentSubmissionScore(String(Number(assignment.id)), String(Number(submission.studentId)), this) })}"><span>/ ${Number(assignment.maxScore)}</span></div>`
                : '<span class="assignment-file-unavailable">Not graded</span>';
            }
          },
          {
            key: 'actions', label: 'Actions', render: submission => {
              const fileUrl = submission.fileUrl && window.EDUGNAY_API.getAssignmentSubmissionDownloadUrl(assignment.id, submission.id);
              if (!fileUrl) return '<span class="assignment-file-unavailable">File unavailable</span>';
              return `<div class="assignment-submission-actions"><button class="row-btn view" type="button" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openAssignmentSubmissionPreview((Number(assignment.id)), (Number(submission.id))) })}"><i data-lucide="eye" aria-hidden="true"></i> View</button><a class="row-btn view" href="${window.EDUGNAY_CONFIG.escapeHtml(fileUrl)}"><i data-lucide="download" aria-hidden="true"></i> Download</a></div>`;
            }
          }
        ],
        rows: submissions,
        empty: { title: 'No submissions yet', text: 'Student files will appear here after they submit this assignment online.' }
      });
      openModal('assignmentSubmissionsModal');
      lucide.createIcons();
    }

    function assignmentPreviewHasUnsavedScore() {
      const input = document.getElementById('assignmentSubmissionPreviewScoreInput');
      return Boolean(assignmentPreviewState?.scoreAvailable && input
        && (input.validity?.badInput || input.value !== assignmentPreviewState.savedScore));
    }

    function setAssignmentPreviewFeedback(message, isError = false) {
      const feedback = document.getElementById('assignmentSubmissionPreviewScoreFeedback');
      feedback.textContent = message;
      feedback.hidden = !message;
      feedback.classList.toggle('is-error', isError);
      feedback.setAttribute('role', isError ? 'alert' : 'status');
    }

    function updateAssignmentPreviewControls() {
      const state = assignmentPreviewState;
      if (!state) return;
      const input = document.getElementById('assignmentSubmissionPreviewScoreInput');
      const saveButton = document.getElementById('assignmentSubmissionPreviewSave');
      const previousButton = document.getElementById('assignmentSubmissionPreviewPrevious');
      const nextButton = document.getElementById('assignmentSubmissionPreviewNext');
      input.disabled = !state.canEditScore || state.saving;
      saveButton.hidden = !state.canEditScore;
      saveButton.disabled = state.saving || state.loading || state.advancing || !assignmentPreviewHasUnsavedScore();
      previousButton.disabled = state.index === 0 || state.saving || state.loading || state.advancing;
      nextButton.disabled = state.saving || state.loading || state.advancing;
      nextButton.textContent = state.index === state.submissions.length - 1
        ? (state.canEditScore ? 'Save & finish' : 'Finish') : 'Next submission';
      document.getElementById('assignmentSubmissionPreviewCloseTop').disabled = state.saving;
    }

    async function showAssignmentSubmissionPreview() {
      const state = assignmentPreviewState;
      const submission = state.submissions[state.index];
      const assignmentId = Number(state.assignment.id);
      const student = getGradeStudents().find(item => String(item.id) === String(submission.studentId));
      const studentName = student?.displayName || submission.studentName || 'Student';
      const scoreRecord = getAssignmentScoreRecords(state.assignment.id)
        .find(record => String(record.studentId) === String(submission.studentId));
      const maxScore = Number(state.assignment.maxScore);
      const gradebookAvailable = isBackendGradeMode();
      state.scoreAvailable = Boolean((state.assignment.categoryId || state.assignment.subjectGradingComponentId) && maxScore > 0);
      state.canEditScore = state.scoreAvailable && gradebookAvailable && hasScoreEditingAccess(state.assignment.academicPeriodId);
      state.savedScore = scoreRecord?.score == null ? '' : String(scoreRecord.score);

      document.getElementById('assignmentSubmissionPreviewStudent').textContent = studentName;
      document.getElementById('assignmentSubmissionPreviewFileName').textContent = submission.fileName || 'Submitted file';
      document.getElementById('assignmentSubmissionPreviewPosition').textContent = `${state.index + 1} of ${state.submissions.length}`;
      const scoreInput = document.getElementById('assignmentSubmissionPreviewScoreInput');
      scoreInput.value = state.savedScore;
      scoreInput.max = String(maxScore);
      document.getElementById('assignmentSubmissionPreviewMaxScore').textContent = `/ ${maxScore}`;
      document.getElementById('assignmentSubmissionPreviewScoreRow').hidden = !state.scoreAvailable;
      document.getElementById('assignmentSubmissionPreviewScoreUnavailable').hidden = state.scoreAvailable;
      setAssignmentPreviewFeedback(state.scoreAvailable && !state.canEditScore
        ? (gradebookAvailable ? 'Scoring is read-only for this grading period.'
          : BACKEND_GRADE_ERROR || 'Scoring is unavailable right now.') : '');

      const requestId = ++assignmentPreviewRequestId;
      if (assignmentPreviewObjectUrl) URL.revokeObjectURL(assignmentPreviewObjectUrl);
      assignmentPreviewObjectUrl = null;
      const previewFrame = document.getElementById('assignmentSubmissionPreviewFrame');
      const previewMessage = document.getElementById('assignmentSubmissionPreviewMessage');
      const previewDownload = document.getElementById('assignmentSubmissionPreviewDownload');
      previewFrame.removeAttribute('src');
      previewFrame.title = `${studentName} assignment submission preview`;
      previewFrame.hidden = true;
      previewMessage.hidden = false;
      document.getElementById('assignmentSubmissionPreviewMessageText').textContent = 'Preparing preview…';
      previewDownload.href = window.EDUGNAY_API.getAssignmentSubmissionDownloadUrl(assignmentId, submission.id);
      previewDownload.hidden = true;
      state.loading = true;
      updateAssignmentPreviewControls();

      try {
        const result = await window.EDUGNAY_API.getAssignmentSubmissionPreview(assignmentId, submission.id);
        if (requestId !== assignmentPreviewRequestId) return;
        if (!String(result.contentType || '').toLowerCase().startsWith('application/pdf')) {
          throw new Error('A preview is not available for this file. Download it to open the original.');
        }
        assignmentPreviewObjectUrl = URL.createObjectURL(new Blob([result.buffer], { type: 'application/pdf' }));
        previewFrame.src = assignmentPreviewObjectUrl;
        previewFrame.hidden = false;
        previewMessage.hidden = true;
      } catch (error) {
        if (requestId !== assignmentPreviewRequestId) return;
        document.getElementById('assignmentSubmissionPreviewMessageText').textContent = error.message
          || 'The file preview could not be loaded. Download the original file.';
        previewDownload.hidden = false;
      } finally {
        if (requestId === assignmentPreviewRequestId && assignmentPreviewState === state) {
          state.loading = false;
          updateAssignmentPreviewControls();
        }
      }
    }

    async function openAssignmentSubmissionPreview(assignmentId, submissionId) {
      const assignment = getTeacherAssignments().find(item => Number(item.id) === Number(assignmentId));
      const submissions = (BACKEND_SUBMISSIONS.get(String(assignmentId)) || [])
        .filter(item => item.fileName && item.fileUrl);
      const index = submissions.findIndex(item => Number(item.id) === Number(submissionId));
      if (!assignment || index < 0) return;
      assignmentPreviewState = { assignment, submissions, index, savedScore: '', scoreAvailable: false,
        canEditScore: false, saving: false, loading: false, advancing: false };
      const scoreInput = document.getElementById('assignmentSubmissionPreviewScoreInput');
      scoreInput.oninput = () => { setAssignmentPreviewFeedback(''); updateAssignmentPreviewControls(); };
      openModal('assignmentSubmissionPreviewModal');
      await showAssignmentSubmissionPreview();
    }

    async function persistAssignmentSubmissionScore(assignment, studentId, score) {
      const item = getBackendGradingItemForAssignment(assignment);
      if (!item) throw new Error('This assignment is not linked to a score component yet.');
      const saved = await window.EDUGNAY_API.saveStudentScore({ gradingItemId: item.id, studentId, score });
      const index = BACKEND_STUDENT_SCORES.findIndex(record =>
        String(record.gradingItemId) === String(item.id) && String(record.studentId) === String(studentId)
      );
      if (index >= 0) BACKEND_STUDENT_SCORES[index] = saved;
      else BACKEND_STUDENT_SCORES.push(saved);
      const listInput = document.querySelector(`#assignmentSubmissionsTbody .score-input[data-submission-student-id="${Number(studentId)}"]`);
      if (listInput) listInput.value = saved.score == null ? '' : String(saved.score);
      renderScoreTable(document.getElementById('academicPeriodSelect').value);
      return saved;
    }

    async function saveAssignmentPreviewScore() {
      const state = assignmentPreviewState;
      if (!state || state.saving || state.loading) return false;
      if (!assignmentPreviewHasUnsavedScore()) return true;
      if (!state.canEditScore) {
        setAssignmentPreviewFeedback('Scoring is no longer available for this grading period.', true);
        return false;
      }
      const input = document.getElementById('assignmentSubmissionPreviewScoreInput');
      const score = input.value === '' ? null : Number(input.value);
      const maxScore = Number(state.assignment.maxScore);
      if (input.validity?.badInput || (score !== null && (!Number.isFinite(score) || score < 0 || score > maxScore))) {
        setAssignmentPreviewFeedback(`Enter a score from 0 to ${maxScore}.`, true);
        return false;
      }
      state.saving = true;
      setAssignmentPreviewFeedback('Saving score…');
      updateAssignmentPreviewControls();
      try {
        const submission = state.submissions[state.index];
        const saved = await persistAssignmentSubmissionScore(state.assignment, submission.studentId, score);
        state.savedScore = saved.score == null ? '' : String(saved.score);
        input.value = state.savedScore;
        setAssignmentPreviewFeedback('Score saved.');
        return true;
      } catch (error) {
        if ([403, 409].includes(error.status)) {
          try { await switchAcademicPeriod(state.assignment.academicPeriodId); } catch (_) { /* Show the save error below. */ }
          state.canEditScore = hasScoreEditingAccess(state.assignment.academicPeriodId);
        }
        setAssignmentPreviewFeedback(error.message || 'The score could not be saved.', true);
        return false;
      } finally {
        state.saving = false;
        updateAssignmentPreviewControls();
      }
    }

    async function navigateAssignmentSubmissionPreview(direction) {
      const state = assignmentPreviewState;
      if (!state || state.saving || state.loading || state.advancing || (direction < 0 && state.index === 0)) return;
      state.advancing = true;
      updateAssignmentPreviewControls();
      try {
        if (!await saveAssignmentPreviewScore() || assignmentPreviewState !== state) return;
        if (direction > 0 && state.index === state.submissions.length - 1) {
          closeModal('assignmentSubmissionPreviewModal');
          return;
        }
        state.index += direction;
        await showAssignmentSubmissionPreview();
      } finally {
        if (assignmentPreviewState === state) {
          state.advancing = false;
          updateAssignmentPreviewControls();
        }
      }
    }

    function advanceAssignmentSubmissionPreview() {
      return navigateAssignmentSubmissionPreview(1);
    }

    function previousAssignmentSubmissionPreview() {
      return navigateAssignmentSubmissionPreview(-1);
    }

    function closeAssignmentSubmissionPreview() {
      closeModal('assignmentSubmissionPreviewModal');
    }

    async function saveAssignmentSubmissionScore(assignmentId, studentId, input) {
      if (!isBackendGradeMode()) {
        alert(BACKEND_GRADE_ERROR || 'Scores cannot be recorded right now. Refresh and try again.');
        return;
      }
      const assignment = getTeacherAssignments().find(item => item.id === String(assignmentId));
      if (!assignment || !requireScoreEditingAccess(assignment.academicPeriodId)) {
        openAssignmentSubmissionsModal(assignmentId);
        return;
      }
      const score = input.value === '' ? null : Number(input.value);
      const maxScore = Number(input.max);
      if (input.validity?.badInput || (score !== null && (!Number.isFinite(score) || score < 0 || score > maxScore))) {
        alert(`Enter a score from 0 to ${maxScore}.`);
        openAssignmentSubmissionsModal(assignmentId);
        return;
      }
      try {
        await persistAssignmentSubmissionScore(assignment, studentId, score);
      } catch (error) {
        if ([403, 409].includes(error.status)) await switchAcademicPeriod(assignment.academicPeriodId);
        alert(error.message);
      }
    }

    function openStatusModal(id) {
      activeAssignmentId = String(id);
      const a = getTeacherAssignments().find(x => x.id === String(id));
      if (!a) return;

      const onlineSubmissionEnabled = a.onlineSubmissionEnabled === true;
      document.getElementById('assignmentStatusModalTitle').textContent = (onlineSubmissionEnabled ? 'Submission Status — ' : 'Update Status — ') + a.title;
      document.getElementById('assignmentStatusModalSub').textContent = onlineSubmissionEnabled
        ? 'Status updates automatically when a student uploads a file.'
        : "Online submissions are disabled. Set each student's status manually.";

      const tbody = document.getElementById('assignmentStatusTbody');
      const statuses = getTeacherAssignmentStatuses(a.id);
      const gradeStudents = getGradeStudents();
      tbody.innerHTML = gradeStudents.length ? gradeStudents.map((s, index) => {
        const currentStatus = statuses.find(item => String(item.studentId) === String(s.id))?.status || 'pending';
        const statusReadOnly = onlineSubmissionEnabled;
        const statusLabel = currentStatus === 'submitted' ? 'Submitted' : currentStatus === 'not_submitted' ? 'Not submitted' : 'Pending';
        const statusClass = currentStatus === 'submitted' ? 'badge-green' : currentStatus === 'not_submitted' ? 'badge-red' : 'badge-orange';
        return `
        <tr>
          <td><div class="student-cell">${window.EDUGNAY_AVATAR.html(s, { className: 'student-av', role: 'student', size: 'sm' })}<div class="student-name">${s.displayName}</div></div></td>
          <td class="center" style="width:150px;">
            ${statusReadOnly ? `<span class="badge ${statusClass}">${statusLabel}</span>` : `<div class="status-btn-group">
              <button class="status-btn submitted ${currentStatus === 'submitted' ? 'selected' : ''}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { setStudentStatus(String(s.id), 'submitted', this) })}" title="Submitted" aria-label="Submitted">
                <i data-lucide="check" style="width:14px;height:14px;"></i>
              </button>
              <button class="status-btn pending ${currentStatus === 'pending' ? 'selected' : ''}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { setStudentStatus(String(s.id), 'pending', this) })}" title="Pending" aria-label="Pending">
                <i data-lucide="clock" style="width:14px;height:14px;"></i>
              </button>
              <button class="status-btn not-submitted ${currentStatus === 'not_submitted' ? 'selected' : ''}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { setStudentStatus(String(s.id), 'not_submitted', this) })}" title="Not submitted" aria-label="Not submitted">
                <i data-lucide="x" style="width:14px;height:14px;"></i>
              </button>
            </div>`}
          </td>
        </tr>`;
      }).join('') : `<tr class="panel-empty-row"><td colspan="2">${window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'users', title: 'No students to update', text: 'Students assigned to this section will appear here.' })}</td></tr>`;

      openModal('assignmentStatusModal');
      lucide.createIcons();
    }

    async function setStudentStatus(studentId, status, btn) {
      const assignment = getTeacherAssignments().find(item => String(item.id) === String(activeAssignmentId));
      if (!assignment || assignment.onlineSubmissionEnabled === true) return;

      const group = btn.closest('.status-btn-group');
      const buttons = Array.from(group.querySelectorAll('.status-btn'));
      buttons.forEach(button => { button.disabled = true; });

      try {
        if (!isBackendGradeMode()) throw new Error(BACKEND_GRADE_ERROR || 'Assignments are not available right now. Refresh and try again.');
        const saved = await window.EDUGNAY_API.updateAssignmentStudentStatus(activeAssignmentId, studentId, status);
        const records = BACKEND_SUBMISSIONS.get(String(activeAssignmentId)) || [];
        const existing = records.find(record => String(record.studentId) === String(studentId));
        if (existing) {
          existing.status = saved.status;
          existing.submissionStatus = saved.status;
        } else {
          records.push({
            assignmentId: String(activeAssignmentId),
            studentId: String(studentId),
            fileName: null,
            fileUrl: null,
            status: saved.status,
            submissionStatus: saved.status
          });
        }
        BACKEND_SUBMISSIONS.set(String(activeAssignmentId), records);
        BACKEND_SUBMISSION_ERRORS.delete(String(activeAssignmentId));

        buttons.forEach(button => button.classList.remove('selected'));
        btn.classList.add('selected');
        renderAssignments();
      } catch (error) {
        window.alert(error.message || 'The student status could not be saved.');
      } finally {
        buttons.forEach(button => { button.disabled = false; });
      }
    }

    function renderUnavailableSectionPage() {
      const main = document.querySelector('main.main');
      if (!main) return;

      const panel = document.createElement('section');
      panel.className = 'section-context-unavailable';
      panel.setAttribute('role', 'alert');
      panel.innerHTML = `
      <div class="panel-empty-state-icon" aria-hidden="true"><i data-lucide="book-x"></i></div>
      <h2>Subject section unavailable</h2>
      <p>${window.EDUGNAY_CONFIG.escapeHtml(BACKEND_SECTION_ERROR)}</p>
      <a class="top-btn secondary" href="./edugnay-teacher-dashboard.html">Return to dashboard</a>
    `;
      main.replaceChildren(panel);
      if (window.lucide) lucide.createIcons();
    }

    document.addEventListener('DOMContentLoaded', async () => {
      if (new URLSearchParams(window.location.search).has('classId')) return;
      const sectionReady = await initializeTeacherSectionContext();
      if (sectionReady === null) return;
      if (!sectionReady) {
        renderUnavailableSectionPage();
        window.EDUGNAY_PAGE_LOADING.ready();
        return;
      }

      if (window.EDUGNAY_API?.isBackendAvailable) {
        document.getElementById('teacherMaterialsList').innerHTML = '';
      }
      const attendanceDateInput = document.getElementById('attDate');
      attendanceDateInput.value = APP_TODAY;
      attendanceDateInput.max = APP_TODAY;
      document.getElementById('attendanceListFooter').innerHTML = '';

      USE_SHS_CORE_GRADEBOOK = CURRENT_LEVEL === 'shs'
        && CURRENT_SUBJECT_ASSIGNMENT?.shsSubjectType === 'core'
        && !CURRENT_BACKEND_SECTION?.needsCurriculumSetup;
      renderTeacherStudentList();
      const pageParams = new URLSearchParams(window.location.search);
      const requestedTab = pageParams.get('tab');
      const initialTabLoad = ['students', 'scores', 'attendance', 'assignments', 'materials'].includes(requestedTab)
        ? switchTab(requestedTab) : null;

      const sectionTermsPromise = window.EDUGNAY_API.getAcademicTerms({
        academicYearId: CURRENT_BACKEND_SECTION.academicYearId,
        schoolLevelId: CURRENT_BACKEND_SECTION.schoolLevelId
      });
      const periodLoad = sectionTermsPromise.then(terms => {
        setSectionPeriodHeader(terms);
      }).catch(() => {
        setSectionPeriodHeader([]);
      });
      const gradeLoad = (async () => {
        if (!CURRENT_SUBJECT_ASSIGNMENT) {
          try {
            const terms = await sectionTermsPromise;
            ACADEMIC_PERIODS = terms.map(term => ({
              id: String(term.id), name: term.name, status: term.status, sequenceNumber: term.sequenceNumber
            }));
            ACTIVE_ACADEMIC_PERIOD_ID = String(terms.find(term => term.status === 'active')?.id || ACADEMIC_PERIODS[0]?.id || '');
          } catch (error) {
            ACADEMIC_PERIODS = [];
            ACTIVE_ACADEMIC_PERIOD_ID = '';
            console.warn('Advisory grading periods could not be loaded.', error.message);
          }
        } else if (USE_SHS_CORE_GRADEBOOK) {
          const host = document.querySelector('#content-scores .panel');
          try {
            const terms = await sectionTermsPromise;
            BACKEND_TERMS = terms;
            ACADEMIC_PERIODS = terms.map(term => ({
              id: String(term.id), name: term.name,
              status: term.status, sequenceNumber: term.sequenceNumber
            }));
            setSectionPeriodHeader(terms);
          } catch (error) {
            ACADEMIC_PERIODS = [];
            setSectionPeriodHeader([]);
            console.warn('SHS grading periods could not be loaded for the section workspace.', error.message);
          }
          if (ACTIVE_ACADEMIC_PERIOD_ID) {
            try {
              const workspace = await window.EDUGNAY_API.getShsGradeWorkspace({
                sectionId: CURRENT_SECTION_ID,
                subjectId: CURRENT_SUBJECT_ID,
                communicationComponentCode: CURRENT_COMMUNICATION_COMPONENT_CODE || '',
                academicTermId: ACTIVE_ACADEMIC_PERIOD_ID
              });
              BACKEND_PUBLISHED_GRADES = (workspace.published || []).map(grade => ({
                ...grade,
                sectionId: String(CURRENT_SECTION_ID),
                subjectId: String(CURRENT_SUBJECT_ID),
                academicTermId: String(ACTIVE_ACADEMIC_PERIOD_ID)
              }));
              STUDENT_LIST_GRADE_ERROR = '';
              const studentGradePeriodName = document.getElementById('studentGradePeriodName');
              if (workspace.term?.name) {
                const sectionPeriodName = document.getElementById('sectionPeriodName');
                if (sectionPeriodName) sectionPeriodName.textContent = workspace.term.name;
                if (studentGradePeriodName) studentGradePeriodName.textContent = workspace.term.name;
              }
            } catch (error) {
              STUDENT_LIST_GRADE_ERROR = error?.message || 'SHS grades could not be loaded.';
            }
          } else {
            STUDENT_LIST_GRADE_ERROR = 'No grading period is available for this class.';
          }
        } else {
          const loaded = await loadBackendGradeData(sectionTermsPromise);
          STUDENT_LIST_GRADE_ERROR = loaded ? '' : BACKEND_GRADE_ERROR;
        }
        if (!USE_SHS_CORE_GRADEBOOK) renderGradingRules();
        refreshAssignmentCategoryOptions();
        updateSectionSubjectControl();
        if (!USE_SHS_CORE_GRADEBOOK) {
          const periodSelect = document.getElementById('academicPeriodSelect');
          periodSelect.innerHTML = ACADEMIC_PERIODS.length
            ? ACADEMIC_PERIODS.map(period => `<option value="${window.EDUGNAY_CONFIG.escapeHtml(period.id)}" ${period.id === ACTIVE_ACADEMIC_PERIOD_ID ? 'selected' : ''}>${window.EDUGNAY_CONFIG.escapeHtml(period.name)}${period.status === 'active' ? ' (Active)' : ''}</option>`).join('')
            : '<option value="">No grading periods available</option>';
          periodSelect.disabled = !ACADEMIC_PERIODS.length;
          document.getElementById('publishedPeriodName').textContent = academicPeriodName(ACTIVE_ACADEMIC_PERIOD_ID);
          const studentGradePeriodName = document.getElementById('studentGradePeriodName');
          if (studentGradePeriodName) {
            studentGradePeriodName.textContent = academicPeriodName(ACTIVE_ACADEMIC_PERIOD_ID);
          }
          await switchAcademicPeriod(ACTIVE_ACADEMIC_PERIOD_ID);
        }
        renderTeacherStudentList();
      })().catch(error => {
        BACKEND_GRADE_ERROR = error?.message || 'Grade data could not be loaded.';
        STUDENT_LIST_GRADE_ERROR = BACKEND_GRADE_ERROR;
        if (USE_SHS_CORE_GRADEBOOK) {
          window.TeacherClassViews.renderScoreTable({
            host: document.querySelector('#content-scores .panel'),
            empty: { noItems: { icon: 'triangle-alert', title: 'Grade data unavailable', text: BACKEND_GRADE_ERROR } }
          });
        } else {
          renderScoreTable(ACTIVE_ACADEMIC_PERIOD_ID);
        }
        renderTeacherStudentList();
      });
      const attendanceLoad = (async () => {
        await loadBackendAttendanceData();
        renderTeacherStudentList();
        renderTeacherAttendanceRows();
        renderAttendanceHistory();
        await loadAttendanceForDate(APP_TODAY);
        if (requestedTab === 'attendance' && pageParams.get('action') === 'qr') openQrAttendance();
      })().catch(error => {
        BACKEND_ATTENDANCE_ERROR = error?.message || 'Attendance could not be loaded.';
        BACKEND_ATTENDANCE_HISTORY_ERROR = BACKEND_ATTENDANCE_ERROR;
        renderTeacherAttendanceRows();
        renderAttendanceHistory();
        document.getElementById('attendanceListFooter').textContent = 'Attendance unavailable';
      });
      const materialsLoad = loadBackendMaterials();
      const assignmentsLoad = loadBackendAssignments();
      const visibleLoads = [periodLoad, gradeLoad];
      if (requestedTab === 'scores' && USE_SHS_CORE_GRADEBOOK && initialTabLoad) {
        visibleLoads.push(initialTabLoad);
      } else if (requestedTab === 'assignments') {
        visibleLoads.push(assignmentsLoad);
      } else if (requestedTab === 'materials') {
        visibleLoads.push(materialsLoad);
      } else if (requestedTab !== 'scores') {
        visibleLoads.push(attendanceLoad);
      }
      const allLoads = Promise.allSettled([periodLoad, gradeLoad, attendanceLoad, assignmentsLoad, materialsLoad]);
      await Promise.allSettled(visibleLoads);
      window.EDUGNAY_PAGE_LOADING.ready();
      await allLoads;
    });

    document.addEventListener('visibilitychange', () => {
      if (new URLSearchParams(window.location.search).has('classId')) return;
      if (document.hidden) {
        stopQrScanner();
        return;
      }

      const currentDate = getCurrentAttendanceDate();
      if (currentDate !== APP_TODAY) {
        APP_TODAY = currentDate;
        document.getElementById('attDate').max = APP_TODAY;
        if (document.getElementById('qrAttendanceModal').classList.contains('open')) {
          closeModal('qrAttendanceModal');
        }
      }

      if (isReopenBackendMode()) {
        void switchAcademicPeriod(document.getElementById('academicPeriodSelect').value);
      }
    });

    window.addEventListener('pagehide', stopQrScanner);

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    p085a0ac90abb: function(event) { setQrScannerSoundEnabled(this.checked) },
    p0fee472ec9e3: function(event) { switchAcademicPeriod(this.value) },
    p2093cbf80f07: function(event) { updateTransferPublishButton() },
    p4cf0ed79916c: function(event) { document.getElementById('assignGradingFields').hidden = !this.checked },
    p69bfc45b5a39: function(event) { document.getElementById('editAssignmentGradingFields').hidden = !this.checked },
    pb48ac12764d2: function(event) { loadAttendanceForDate(this.value) },
  },
  click: {
    p06c9cdd78b61: function(event) { confirmQrAttendance() },
    p073cca9643bf: function(event) { returnToQrScanning() },
    p09c3c8eee7bd: function(event) { closeModal('qrAttendanceModal') },
    p19f1fb5aef99: function(event) { closeModal('reopenRequestModal') },
    p1bb23ea957b9: function(event) { closeModal('assignmentSubmissionsModal') },
    p1e59e8793512: function(event) { closeModal('publishModal') },
    p1f227c72ada4: function(event) { submitSectionMaterialUpload() },
    p2465bd5943ac: function(event) { closeModal('transferReviewModal') },
    p295e62919760: function(event) { saveAssignmentChanges() },
    p30dd389c6db4: function(event) { switchTab('scores') },
    p3ea63981e1cd: function(event) { switchTab('materials') },
    p44928eae6966: function(event) { closeModal('editAssignmentModal') },
    p461bf01c621c: function(event) { switchCatTab(this,'all') },
    p495242f87541: function(event) { stopQrScanner() },
    p49e266a62e30: function(event) { closeAssignmentSubmissionPreview() },
    p6ee5ce9e437d: function(event) { void previousAssignmentSubmissionPreview() },
    p7aa907733a81: function(event) { void saveAssignmentPreviewScore() },
    p9ca9e80540bc: function(event) { void advanceAssignmentSubmissionPreview() },
    p5026ce80c219: function(event) { markAll('P') },
    p5adc771cd24c: function(event) { openPublishGradesModal() },
    p6875bf9d15fb: function(event) { publishGrades() },
    p6cd4f4a9a6f6: function(event) { closeModal('addCompModal') },
    p796d301f2a60: function(event) { switchTab('attendance') },
    p7ce03f3255f5: function(event) { closeModal('assignmentStatusModal') },
    p85a0391f1830: function(event) { startQrScanner() },
    p8b9f1417269b: function(event) { closeModal('addAssignmentModal') },
    p92bd2d4c80dd: function(event) { submitReopenRequest() },
    p9d3378202da9: function(event) { saveAttendance() },
    p9f94f32c28cc: function(event) { closeModal('teacherDeleteConfirmModal') },
    pa3ddd2d70e8f: function(event) { switchCatTab(this,'PT') },
    pa79a6c1342a2: function(event) { switchCatTab(this,'QA') },
    pafb199fa3d64: function(event) { exportScoresCsv() },
    pb31f0f2616b0: function(event) { openQrAttendanceFinalReview() },
    pb92dfb705e9e: function(event) { openModal('addAssignmentModal') },
    pc9e3d77f572c: function(event) { switchTab('students') },
    pd2022aa8b27b: function(event) { switchTab('assignments') },
    pd7ad483cb107: function(event) { openScoreComponentModal() },
    peb9ac386031c: function(event) { closeTeacherStudentDetailsModal() },
    ped57566d7f19: function(event) { openMaterialUploadModal() },
    pf1a8e21cf312: function(event) { retryFailedScoreSaves() },
    pf2302f2e3184: function(event) { switchCatTab(this,'WW') },
    pf3c97efc71fa: function(event) { closeModal('uploadModal') },
    pf40f6cb8cd12: function(event) { addAssignment() },
    pfc89cdf73fc4: function(event) { openQrAttendance() },
  },
  input: {
    p1ad23dd139fd: function(event) { filterScoreStudents() },
    p9213cb8fcc50: function(event) { filterStudents(this.value) },
  },
});

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    g79881ecce0c1: function(event) { loadTeacherStudentDetails() },
    gc9daf67aebf2: function(event) { openReopenModal() },
  },
});
