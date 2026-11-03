lucide.createIcons();

    // Dashboard records come from the backend.
    const TEACHER_DASHBOARD_API_ENABLED = window.EDUGNAY_API?.isBackendAvailable === true;
    let DASHBOARD_TEACHER_ID = '';
    let DASHBOARD_TEACHER_TODOS = [];
    let TEACHER_SECTIONS = [];
    let TEACHER_CLASSES = [];
    const TEACHER_FLAGS_PREVIEW = new URLSearchParams(window.location.search).get('previewFlags') === '1';
    const SAMPLE_FLAGGED_STUDENTS = [
      { studentId: 'preview-1', name: 'Sample Student One', initials: 'S1', sectionId: 'preview-9a', sectionName: 'St. Paul', grade: 'Grade 9', reasons: [
        { type: 'absence', count: 4, threshold: 4 },
        { type: 'grade', subject: 'Math', grade: 72, threshold: 75, term: 'Term 1' }
      ] },
      { studentId: 'preview-2', name: 'Sample Student Two', initials: 'S2', sectionId: 'preview-7', sectionName: 'St. Matthew', grade: 'Grade 7', reasons: [
        { type: 'grade', subject: 'Science', grade: 70, threshold: 75, term: 'Term 1' },
        { type: 'grade', subject: 'Math', grade: 73, threshold: 75, term: 'Term 1' }
      ] },
      { studentId: 'preview-3', name: 'Sample Student Three', initials: 'S3', sectionId: 'preview-10', sectionName: 'St. James', grade: 'Grade 10', reasons: [
        { type: 'absence', count: 6, threshold: 5 },
        { type: 'grade', subject: 'English', grade: 74, threshold: 75, term: 'Term 1' }
      ] },
      { studentId: 'preview-4', name: 'Sample Student Four', initials: 'S4', sectionId: 'preview-9b', sectionName: 'St. Peter', grade: 'Grade 9', reasons: [
        { type: 'absence', count: 3, threshold: 3 },
        { type: 'consecutive', count: 3, threshold: 3, subject: 'Math' }
      ] }
    ];
    let TEACHER_FLAGS = TEACHER_FLAGS_PREVIEW ? SAMPLE_FLAGGED_STUDENTS : [];
    let TEACHER_FLAGS_ERROR = '';
    let TEACHER_ADVISORY_SECTIONS = [];
    let TEACHER_PENDING_REPORTS = 0;
    let TEACHER_PENDING_REPORTS_ERROR = '';
    const dashboardPeriod = document.querySelector('.grading-period-card [data-active-academic-period]');

    function getTeacherAssignmentName(assignment) {
      return assignment.communicationComponentName || assignment.subjectName || 'Assigned subject';
    }

    function getTeacherAssignmentValue(assignment) {
      return `${assignment.subjectId}|${assignment.communicationComponentCode || ''}`;
    }

    function parseTeacherAssignmentValue(value) {
      const [subjectId, communicationComponentCode = ''] = String(value || '').split('|');
      return { subjectId, communicationComponentCode };
    }

    function getTeacherSectionSub(section) {
      const subjectNames = section.subjectAssignments?.map(getTeacherAssignmentName).filter(Boolean) || [];
      return [section.isAdviser ? 'Class Adviser' : '', [...new Set(subjectNames)].join(', ') || section.subjectName || '']
        .filter(Boolean)
        .join(' · ');
    }

    function getTeacherSectionStudentCount(sectionId) {
      return TEACHER_SECTIONS.find(section => section.sectionId === String(sectionId))?.studentCount || 0;
    }

    const TEACHER_SUMMARY_CARDS = [
      {
        tone: 'green',
        icon: 'graduation-cap',
        label: 'Total Students',
        sub: 'Across assigned sections',
        records: [],
      },
      {
        tone: 'purple',
        icon: 'school',
        label: 'Sections Handled',
        sub: 'Assigned for the current term',
        records: TEACHER_SECTIONS,
      }
    ];

    let TEACHER_DASHBOARD_ANNOUNCEMENTS = [];
    let TEACHER_ANNOUNCEMENTS_ERROR = '';
    let TEACHER_ANNOUNCEMENTS_LOADING = true;
    let TEACHER_SECTIONS_ERROR = '';

    function getTeacherTodos() {
      return Array.isArray(DASHBOARD_TEACHER_TODOS) ? DASHBOARD_TEACHER_TODOS : [];
    }

    function setDashboardFeedback(id, message = '', type = 'error') {
      const feedback = document.getElementById(id);
      if (!feedback) return;
      feedback.textContent = message;
      feedback.hidden = !message;
      feedback.classList.toggle('is-error', type === 'error');
      feedback.classList.toggle('is-success', type === 'success');
      feedback.classList.toggle('is-info', type === 'info');
    }

    async function refreshTeacherTasks(fallback = {}) {
      try {
        const tasks = await window.EDUGNAY_API.getTasks();
        if (fallback.task && !tasks.some(item => item.id === fallback.task.id)) throw new Error('The saved task was not returned by the task list.');
        if (fallback.removedId && tasks.some(item => item.id === String(fallback.removedId))) throw new Error('The deleted task is still returned by the task list.');
        DASHBOARD_TEACHER_TODOS = tasks;
        if (window.EDUGNAY_COMMUNICATION?.backend) window.EDUGNAY_COMMUNICATION.tasks = DASHBOARD_TEACHER_TODOS;
        setDashboardFeedback('teacherTodoListFeedback');
      } catch (error) {
        if (fallback.task) {
          const index = getTeacherTodos().findIndex(item => item.id === fallback.task.id);
          if (index >= 0) DASHBOARD_TEACHER_TODOS[index] = fallback.task;
          else DASHBOARD_TEACHER_TODOS = [...getTeacherTodos(), fallback.task];
        }
        if (fallback.removedId) DASHBOARD_TEACHER_TODOS = getTeacherTodos().filter(item => item.id !== String(fallback.removedId));
        const message = fallback.removedId
          ? `The task was deleted, but the list could not refresh: ${error.message || 'Please reload the page.'}`
          : fallback.task
            ? `The task was saved, but the list could not refresh: ${error.message || 'Please reload the page.'}`
            : `Tasks could not be loaded: ${error.message || 'Please reload the page.'}`;
        setDashboardFeedback('teacherTodoListFeedback', message, fallback.task || fallback.removedId ? 'info' : 'error');
      }
      renderTeacherTodos();
    }

    function openTeacherMaterialModal() {
      const modal = document.getElementById('teacherMaterialUploadModal');
      if (!modal) return false;
      document.getElementById('teacherMaterialUploadForm')?.reset();
      updateTeacherMaterialFileName(document.getElementById('teacherMaterialFile'));
      setDashboardFeedback('teacherMaterialFeedback');
      updateTeacherMaterialTargets();
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      return false;
    }

    function closeTeacherMaterialModal() {
      const modal = document.getElementById('teacherMaterialUploadModal');
      if (!modal) return;
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }

    function openTeacherTodoModal(todoId = null) {
      const modal = document.getElementById('teacherTodoModal');
      const form = document.getElementById('teacherTodoForm');
      if (!modal || !form) return;
      form.reset();
      setDashboardFeedback('teacherTodoFeedback');
      const todo = todoId
        ? getTeacherTodos().find(item => item.id === String(todoId))
        : null;
      document.getElementById('teacherTodoId').value = todo?.id || '';
      document.getElementById('teacherTodoTitle').value = todo?.title || '';
      document.getElementById('teacherTodoTitle').setCustomValidity('');
      document.getElementById('teacherTodoDueDate').value = todo?.dueDate || '';
      document.getElementById('teacherTodoModalTitle').textContent = todo ? 'Edit task' : 'Add task';
      document.getElementById('teacherTodoSaveButton').textContent = todo ? 'Save changes' : 'Add task';
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.getElementById('teacherTodoTitle').focus();
    }

    function closeTeacherTodoModal() {
      const modal = document.getElementById('teacherTodoModal');
      if (!modal) return;
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }

    async function saveTeacherTodo(event) {
      event?.preventDefault();
      if (!TEACHER_DASHBOARD_API_ENABLED) {
        setDashboardFeedback('teacherTodoFeedback', 'The backend is required to save tasks.');
        return false;
      }
      const todoId = document.getElementById('teacherTodoId').value;
      const titleInput = document.getElementById('teacherTodoTitle');
      const title = titleInput.value.trim();
      const dueDate = document.getElementById('teacherTodoDueDate').value || null;
      titleInput.setCustomValidity(title ? '' : 'Enter a task title.');
      if (!titleInput.reportValidity()) return false;

      const button = document.getElementById('teacherTodoSaveButton');
      button.disabled = true;
      button.textContent = 'Saving…';
      setDashboardFeedback('teacherTodoFeedback');
      try {
        const task = todoId
          ? await window.EDUGNAY_API.updateTask(todoId, { title, dueDate })
          : await window.EDUGNAY_API.createTask({ title, dueDate });
        closeTeacherTodoModal();
        await refreshTeacherTasks({ task });
        showAppToast(todoId ? 'Task updated.' : 'Task added.');
      } catch (error) {
        showAppToast(error.message || 'The task could not be saved.', 'error');
      } finally {
        button.disabled = false;
        button.textContent = todoId ? 'Save changes' : 'Add task';
      }
      return false;
    }

    function toggleTeacherTodo(todoId, checkbox) {
      if (!TEACHER_DASHBOARD_API_ENABLED) {
        setDashboardFeedback('teacherTodoListFeedback', 'The backend is required to update tasks.');
        renderTeacherTodos();
        return;
      }
      const todo = getTeacherTodos()
        .find(item => item.id === String(todoId));
      if (!todo) return;
      const completed = todo.status !== 'completed';
      if (checkbox) checkbox.disabled = true;
      window.EDUGNAY_API.updateTask(todo.id, { status: completed ? 'completed' : 'pending' })
        .then(async updated => {
          await refreshTeacherTasks({ task: updated });
          showAppToast(completed ? 'Task completed.' : 'Task reopened.');
        })
        .catch(error => {
          showAppToast(error.message || 'The task status could not be updated.', 'error');
          renderTeacherTodos();
        });
    }

    function openTeacherTodoDeleteModal(todoId) {
      const todo = getTeacherTodos()
        .find(item => item.id === String(todoId));
      const modal = document.getElementById('teacherTodoDeleteModal');
      if (!todo || !modal) return;
      setDashboardFeedback('teacherTodoDeleteFeedback');
      document.getElementById('teacherTodoDeleteId').value = todo.id;
      document.getElementById('teacherTodoDeleteName').textContent = `“${todo.title}”`;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      lucide.createIcons();
    }

    function closeTeacherTodoDeleteModal() {
      const modal = document.getElementById('teacherTodoDeleteModal');
      if (!modal) return;
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.getElementById('teacherTodoDeleteId').value = '';
    }

    async function confirmDeleteTeacherTodo() {
      if (!TEACHER_DASHBOARD_API_ENABLED) {
        setDashboardFeedback('teacherTodoDeleteFeedback', 'The backend is required to delete tasks.');
        return;
      }
      const todoId = document.getElementById('teacherTodoDeleteId').value;
      if (!todoId) return;
      const button = document.querySelector('#teacherTodoDeleteModal .btn-danger');
      button.disabled = true;
      button.textContent = 'Deleting…';
      setDashboardFeedback('teacherTodoDeleteFeedback');
      try {
        await window.EDUGNAY_API.deleteTask(todoId);
        closeTeacherTodoDeleteModal();
        await refreshTeacherTasks({ removedId: todoId });
        showAppToast('Task deleted.');
      } catch (error) {
        showAppToast(error.message || 'The task could not be deleted.', 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Yes, Delete';
      }
    }

    function updateTeacherMaterialFileName(input) {
      const label = document.getElementById('teacherMaterialFileName');
      if (!label) return;
      const hasFile = Boolean(input?.files?.length);
      label.textContent = hasFile ? input.files[0].name : 'No file selected';
      label.classList.toggle('has-file', hasFile);
    }

    const TEACHER_QUICK_ACTIONS = [
      { icon: 'file-up', title: 'Upload Learning Material', desc: 'Share a file with a specific grade and section', action(event) { event.preventDefault(); openTeacherMaterialModal(); } },
      { icon: 'scan-line', title: 'Check Attendance via QR', desc: 'Choose a class and scan student QR codes', action(event) { event.preventDefault(); openTeacherQrAttendanceModal(this); } }
    ];

    let TEACHER_MATERIAL_SECTIONS = TEACHER_SECTIONS.filter(section => section.subjectAssignments?.length);
    const TEACHER_MATERIAL_FILE_TYPES = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'jpg', 'png', 'mp4'];
    let teacherQrAttendanceReturnFocus = null;

    function getTeacherQrAttendanceSections() {
      return TEACHER_SECTIONS.filter(section => section.subjectAssignments?.length);
    }

    function openTeacherQrAttendanceModal(trigger) {
      const modal = document.getElementById('teacherQrAttendanceModal');
      const sectionSelect = document.getElementById('teacherQrAttendanceSection');
      const subjectSelect = document.getElementById('teacherQrAttendanceSubject');
      if (!modal || !sectionSelect || !subjectSelect) return false;

      teacherQrAttendanceReturnFocus = trigger || document.activeElement;
      sectionSelect.replaceChildren(new Option('Select a section', ''));
      subjectSelect.replaceChildren(new Option('Select a section first', ''));
      subjectSelect.disabled = true;
      setDashboardFeedback('teacherQrAttendanceFeedback');

      const sections = getTeacherQrAttendanceSections();
      sections.forEach(section => {
        sectionSelect.add(new Option(`${section.gradeLabel} - ${section.name}`, section.sectionId));
      });
      sectionSelect.disabled = sections.length === 0;

      if (TEACHER_SECTIONS_ERROR) {
        setDashboardFeedback('teacherQrAttendanceFeedback', TEACHER_SECTIONS_ERROR);
      } else if (!sections.length) {
        setDashboardFeedback(
          'teacherQrAttendanceFeedback',
          'No section with an assigned subject is available for QR attendance.',
          'info'
        );
      }

      updateTeacherQrAttendanceButton();
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      lucide.createIcons();
      sectionSelect.focus();
      return false;
    }

    function closeTeacherQrAttendanceModal() {
      const modal = document.getElementById('teacherQrAttendanceModal');
      if (!modal || !modal.classList.contains('open')) return;
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      teacherQrAttendanceReturnFocus?.focus?.();
      teacherQrAttendanceReturnFocus = null;
    }

    function updateTeacherQrAttendanceSubjects() {
      const sectionId = document.getElementById('teacherQrAttendanceSection')?.value;
      const subjectSelect = document.getElementById('teacherQrAttendanceSubject');
      const section = getTeacherQrAttendanceSections()
        .find(item => item.sectionId === sectionId);
      const assignments = section?.subjectAssignments || [];
      if (!subjectSelect) return;

      subjectSelect.replaceChildren(new Option(
        assignments.length ? 'Select a subject' : 'No assigned subjects',
        ''
      ));
      assignments.forEach(assignment => {
        subjectSelect.add(new Option(getTeacherAssignmentName(assignment), getTeacherAssignmentValue(assignment)));
      });
      subjectSelect.disabled = assignments.length === 0;
      if (assignments.length === 1) subjectSelect.value = getTeacherAssignmentValue(assignments[0]);
      setDashboardFeedback('teacherQrAttendanceFeedback');
      updateTeacherQrAttendanceButton();
    }

    function updateTeacherQrAttendanceButton() {
      const button = document.getElementById('teacherQrAttendanceSubmit');
      const sectionId = document.getElementById('teacherQrAttendanceSection')?.value;
      const subjectId = document.getElementById('teacherQrAttendanceSubject')?.value;
      if (button) button.disabled = !sectionId || !subjectId;
    }

    function startTeacherQrAttendance(event) {
      event?.preventDefault();
      const sectionId = document.getElementById('teacherQrAttendanceSection')?.value;
      const { subjectId, communicationComponentCode } = parseTeacherAssignmentValue(
        document.getElementById('teacherQrAttendanceSubject')?.value
      );
      const section = getTeacherQrAttendanceSections()
        .find(item => item.sectionId === sectionId);
      const assignment = section?.subjectAssignments
        .find(item => item.subjectId === subjectId
          && (item.communicationComponentCode || '') === communicationComponentCode);

      if (!section || !assignment) {
        setDashboardFeedback(
          'teacherQrAttendanceFeedback',
          'Choose a valid section and subject before opening the scanner.'
        );
        updateTeacherQrAttendanceButton();
        return false;
      }

      const button = document.getElementById('teacherQrAttendanceSubmit');
      if (button) {
        button.disabled = true;
        button.textContent = 'Opening scanner...';
      }
      const target = new URL('./edugnay-teacher-sections.html', window.location.href);
      target.searchParams.set('sectionId', section.sectionId);
      target.searchParams.set('subjectId', assignment.subjectId);
      if (assignment.communicationComponentCode) {
        target.searchParams.set('communicationComponentCode', assignment.communicationComponentCode);
      } else {
        target.searchParams.delete('communicationComponentCode');
      }
      target.searchParams.set('tab', 'attendance');
      target.searchParams.set('action', 'qr');
      window.location.assign(target.href);
      return false;
    }

    function formatTeacherMaterialGrade(grade) {
      const value = String(grade || '').trim();
      return /^(kindergarten|grade\s)/i.test(value) ? value : `Grade ${value}`;
    }

    function getSelectedTeacherMaterialSection() {
      const sectionId = document.getElementById('teacherMaterialSection')?.value;
      return TEACHER_MATERIAL_SECTIONS.find(section => section.sectionId === sectionId) || null;
    }

    function getTeacherMaterialSubjects(section) {
      if (Array.isArray(section?.subjectAssignments)) return section.subjectAssignments;
      return section?.subjectId ? [{ subjectId: section.subjectId, subjectName: section.subjectName || 'Assigned subject' }] : [];
    }

    function updateTeacherMaterialSubjects() {
      const section = getSelectedTeacherMaterialSection();
      const select = document.getElementById('teacherMaterialSubject');
      if (!select) return;
      const subjects = getTeacherMaterialSubjects(section);
      select.replaceChildren(new Option('Select a subject', ''), ...subjects.map(subject =>
        new Option(getTeacherAssignmentName(subject), getTeacherAssignmentValue(subject))
      ));
      select.disabled = subjects.length === 0;
      select.required = TEACHER_DASHBOARD_API_ENABLED;
    }

    function updateTeacherMaterialTargets() {
      const gradeSelect = document.getElementById('teacherMaterialGrade');
      if (!gradeSelect) return;
      const selectedGrade = gradeSelect.value;
      const gradeNumber = grade => /^kindergarten$/i.test(String(grade))
        ? 0 : Number((String(grade).match(/\d+/) || [99])[0]);
      const grades = [...new Set(TEACHER_MATERIAL_SECTIONS.map(section => section.grade))]
        .sort((a, b) => gradeNumber(a) - gradeNumber(b) || String(a).localeCompare(String(b)));
      gradeSelect.replaceChildren(new Option('Select a grade level', ''), ...grades.map(grade =>
        new Option(formatTeacherMaterialGrade(grade), grade)
      ));
      gradeSelect.value = grades.includes(selectedGrade) ? selectedGrade : '';
      updateTeacherMaterialSections();
    }

    function updateTeacherMaterialSections() {
      const gradeSelect = document.getElementById('teacherMaterialGrade');
      const sectionSelect = document.getElementById('teacherMaterialSection');
      if (!gradeSelect || !sectionSelect) return;

      const sections = TEACHER_MATERIAL_SECTIONS.filter(section => section.grade === gradeSelect.value);
      sectionSelect.replaceChildren(new Option(sections.length ? 'Select a section' : 'No assigned sections for this grade', ''), ...sections.map(section =>
        new Option(section.name, section.sectionId)
      ));
      sectionSelect.disabled = sections.length === 0;
      sectionSelect.value = '';
      updateTeacherMaterialSubjects();
    }

    function initTeacherMaterialTargets() {
      const gradeSelect = document.getElementById('teacherMaterialGrade');
      const sectionSelect = document.getElementById('teacherMaterialSection');
      if (!gradeSelect || !sectionSelect) return;
      gradeSelect.addEventListener('change', updateTeacherMaterialSections);
      sectionSelect.addEventListener('change', updateTeacherMaterialSubjects);
      updateTeacherMaterialTargets();
    }

    async function submitTeacherMaterialUpload() {
      const file = document.getElementById('teacherMaterialFile')?.files?.[0];
      const title = document.getElementById('teacherMaterialTitle')?.value.trim();
      const grade = document.getElementById('teacherMaterialGrade')?.value;
      const section = getSelectedTeacherMaterialSection();
      const { subjectId, communicationComponentCode } = parseTeacherAssignmentValue(
        document.getElementById('teacherMaterialSubject')?.value
      );
      const status = document.getElementById('teacherMaterialVisibility')?.value || 'published';
      const button = document.getElementById('teacherMaterialUploadSubmit');
      const fail = message => setDashboardFeedback('teacherMaterialFeedback', message);
      setDashboardFeedback('teacherMaterialFeedback');

      if (!TEACHER_DASHBOARD_API_ENABLED) { fail('The backend is required to upload learning materials.'); return false; }
      if (!file) { fail('Please choose a file.'); return false; }
      if (!title) { fail('Please enter a material title.'); return false; }
      if (!grade) { fail('Please select a grade level.'); return false; }
      if (!section || section.grade !== grade) { fail('Please select one of your assigned sections for the chosen grade.'); return false; }
      if (!subjectId) { fail('Please select a subject assigned to you in this section.'); return false; }

      const type = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'file';
      if (!TEACHER_MATERIAL_FILE_TYPES.includes(type)) {
        fail('Choose a PDF, Word, PowerPoint, Excel, JPG, PNG, or MP4 file.');
        return false;
      }
      button.disabled = true;
      button.textContent = 'Uploading…';
      try {
        const material = await window.EDUGNAY_API.uploadMaterial(section.sectionId, subjectId, {
          file, title, status, communicationComponentCode
        });
        let refreshMessage = '';
        try {
          const materials = await window.EDUGNAY_API.getMaterials({ sectionId: section.sectionId, subjectId, communicationComponentCode });
          if (!materials.some(item => String(item.id) === String(material.id))) throw new Error('The uploaded material was not returned by the materials list.');
        } catch (error) {
          refreshMessage = ` The file was uploaded, but the list could not refresh: ${error.message || 'reload My Classes.'}`;
        }
        document.getElementById('teacherMaterialUploadForm')?.reset();
        updateTeacherMaterialFileName(document.getElementById('teacherMaterialFile'));
        updateTeacherMaterialTargets();
        closeTeacherMaterialModal();
        showAppToast(`“${material.title}” was ${status === 'published' ? 'published' : 'saved as a draft'} for ${section.name}.${refreshMessage}`, refreshMessage ? 'info' : 'success');
      } catch (error) {
        fail(error.message || 'The material could not be uploaded. Your file and form values are still selected.');
      } finally {
        button.disabled = false;
        button.innerHTML = '<i data-lucide="upload" style="width:13px;height:13px;"></i> Upload';
        lucide.createIcons();
      }
      return false;
    }

    function renderTeacherTodos() {
      const list = document.getElementById('teacher-todo-list');
      if (!list) return;

      const todos = getTeacherTodos()
        .sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed'));

      if (!todos.length) {
        list.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
          icon: 'list-checks',
          title: 'No tasks yet',
          text: 'Add a personal task to start your list.'
        });
        return;
      }

      list.innerHTML = todos.map(todo => {
        const completed = todo.status === 'completed';
        const dueDate = todo.dueDate
          ? new Date(`${todo.dueDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : null;
        return `
          <div class="todo-item${completed ? ' is-completed' : ''}" data-todo-id="${window.EDUGNAY_CONFIG.escapeHtml(todo.id)}">
            <input class="todo-check" type="checkbox" aria-label="Mark task as ${completed ? 'pending' : 'completed'}"
              ${completed ? 'checked' : ''} data-page-change="${window.EDUGNAY_PAGE_EVENTS.register('change', function(event) { toggleTeacherTodo(String(todo.id), this) })}">
            <div class="todo-copy">
              <div class="todo-title">${window.EDUGNAY_CONFIG.escapeHtml(todo.title)}</div>
              ${dueDate ? `<div class="todo-due">Due ${dueDate}</div>` : ''}
            </div>
            <div class="todo-actions">
              <button type="button" aria-label="Edit ${window.EDUGNAY_CONFIG.escapeHtml(todo.title)}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openTeacherTodoModal(String(todo.id)) })}">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" aria-label="Delete ${window.EDUGNAY_CONFIG.escapeHtml(todo.title)}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openTeacherTodoDeleteModal(String(todo.id)) })}">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </div>`;
      }).join('');
      lucide.createIcons();
    }

    function renderTeacherDashboardData() {
      const summaryList = document.getElementById('teacher-summary-cards');
      if (summaryList) {
        TEACHER_SUMMARY_CARDS[0].value = TEACHER_SECTIONS_ERROR
          ? '—'
          : TEACHER_SECTIONS.reduce((total, section) => total + section.studentCount, 0);
        TEACHER_SUMMARY_CARDS[0].sub = TEACHER_SECTIONS_ERROR || 'Across assigned sections';
        TEACHER_SUMMARY_CARDS[1].value = TEACHER_SECTIONS_ERROR ? '—' : TEACHER_SECTIONS.length;
        TEACHER_SUMMARY_CARDS[1].sub = TEACHER_SECTIONS_ERROR || 'Assigned for the current term';
        const reportsCard = TEACHER_ADVISORY_SECTIONS.length > 0 &&
          window.EDUGNAY_CONFIG.isNarrativeReportsEnabled();
        const finalCard = reportsCard ? {
          tone: 'gold', icon: 'hourglass', label: 'Reports to Confirm',
          value: TEACHER_PENDING_REPORTS_ERROR ? '—' : TEACHER_PENDING_REPORTS,
          sub: TEACHER_PENDING_REPORTS_ERROR || 'Ready for your review'
        } : {
          tone: 'red', icon: 'alert-triangle', label: 'Needs Attention',
          value: TEACHER_FLAGS_ERROR ? '—' : TEACHER_FLAGS.length,
          sub: TEACHER_FLAGS_ERROR || 'Flagged students.'
        };
        summaryList.innerHTML = [...TEACHER_SUMMARY_CARDS, finalCard].map(card => `
          <div class="stat-card ${card.tone}">
            <div class="stat-card-top">
              <div class="stat-card-icon"><i data-lucide="${card.icon}" style="width:20px;height:20px;"></i></div>
            </div>
            <div class="stat-card-num">${card.value === undefined ? card.records.length : card.value}</div>
            <div class="stat-card-label">${card.label}</div>
            <div class="stat-card-sub">${window.EDUGNAY_CONFIG.escapeHtml(card.sub)}</div>
          </div>`).join('');
      }

      const sectionList = document.getElementById('sectionCardsContainer');
      if (sectionList) {
        sectionList.innerHTML = TEACHER_CLASSES.map(section => `
          <div class="section-card" data-grade="${window.EDUGNAY_CONFIG.escapeHtml(section.grade)}" data-section-id="${section.classType === 'section' ? window.EDUGNAY_CONFIG.escapeHtml(section.id) : ''}" data-class-id="${section.classType === 'shs' ? window.EDUGNAY_CONFIG.escapeHtml(section.id) : ''}" role="button" tabindex="0">
            <div class="section-card-arrow"><i data-lucide="chevron-right" style="width:15px;height:15px;"></i></div>
            <div class="section-card-top"><div class="section-card-main"><div class="section-card-name">${window.EDUGNAY_CONFIG.escapeHtml(section.name)}</div><div class="section-card-sub">${window.EDUGNAY_CONFIG.escapeHtml(section.classType === 'shs' ? `SHS class · ${section.subjectName}` : getTeacherSectionSub(section))}</div></div></div>
            <div class="section-card-divider"></div>
            <div class="section-card-stats"><div class="section-stat"><span class="section-stat-label">Students</span><span class="section-stat-value">${section.classType === 'shs' ? section.studentCount : getTeacherSectionStudentCount(section.sectionId)}</span></div></div>
          </div>`).join('') + `<div id="teacherSectionsEmpty" class="panel-empty-slot" hidden></div>`;
        sectionList.querySelectorAll('.section-card').forEach(card => {
          const openSection = () => card.dataset.classId ? navigate('shsClass', card.dataset.classId) : navigate('section', card.dataset.sectionId);
          card.addEventListener('click', openSection);
          card.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openSection();
            }
          });
        });
        const sectionEmpty = document.getElementById('teacherSectionsEmpty');
        if (sectionEmpty && (!TEACHER_CLASSES.length || TEACHER_SECTIONS_ERROR)) {
          sectionEmpty.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
            icon: TEACHER_SECTIONS_ERROR ? 'cloud-off' : 'door-open',
            title: TEACHER_SECTIONS_ERROR ? 'Classes unavailable' : 'No classes assigned',
            text: TEACHER_SECTIONS_ERROR || 'Classes assigned to you will appear here.'
          });
          sectionEmpty.hidden = false;
        }

        const sectionCount = document.getElementById('teacherSectionCount');
        if (sectionCount) sectionCount.textContent = TEACHER_SECTIONS_ERROR ? 'Unavailable' : `${TEACHER_CLASSES.length} ${TEACHER_CLASSES.length === 1 ? 'class' : 'classes'}`;
        renderTeacherGradeFilters();
      }

      const announcements = document.getElementById('teacher-dashboard-announcements');
      if (announcements) {
        const visibleAnnouncements = TEACHER_DASHBOARD_ANNOUNCEMENTS.filter(item => !item.access || teacherCanAccess(item.access)).slice(0, 3);
        announcements.innerHTML = TEACHER_ANNOUNCEMENTS_LOADING
          ? ''
          : TEACHER_ANNOUNCEMENTS_ERROR
          ? window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Announcements unavailable', text: TEACHER_ANNOUNCEMENTS_ERROR })
          : visibleAnnouncements.map(item => `
          <div class="ann-item"><div class="ann-item-head"><span class="ann-item-title">${window.EDUGNAY_CONFIG.escapeHtml(item.title)}</span><span class="badge ${window.EDUGNAY_CONFIG.escapeHtml(item.tagClass)}">${window.EDUGNAY_CONFIG.escapeHtml(item.tag)}</span></div>${item.imageUrl ? `<img class="ann-item-img" src="${window.EDUGNAY_CONFIG.escapeHtml(item.imageUrl)}" alt="${window.EDUGNAY_CONFIG.escapeHtml(item.title)}" loading="lazy" data-page-error="gbb1bd901180b"/>` : ''}<div class="ann-item-body">${window.EDUGNAY_CONFIG.escapeHtml(item.body)}</div><div class="ann-item-meta"><i data-lucide="clock" style="width:11px;height:11px;"></i> ${window.EDUGNAY_CONFIG.escapeHtml(item.time)} · <i data-lucide="user" style="width:11px;height:11px;"></i> ${window.EDUGNAY_CONFIG.escapeHtml(item.author)}</div></div>`).join('');
        if (!TEACHER_ANNOUNCEMENTS_LOADING && !TEACHER_ANNOUNCEMENTS_ERROR && !visibleAnnouncements.length) announcements.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'megaphone', title: 'No announcements yet', text: 'School updates will appear here when they are published.' });
      }
      renderTeacherQuickActions();

      const flagList = document.getElementById('flagGridSingle');
      if (flagList) {
        const flagFilter = document.getElementById('flagSectionFilter');
        if (flagFilter) {
          const sections = new Map(TEACHER_SECTIONS.map(section => [section.sectionId, section.name]));
          TEACHER_FLAGS.forEach(student => {
            if (!sections.has(student.sectionId)) sections.set(student.sectionId, `${student.grade} – ${student.sectionName}`);
          });
          flagFilter.innerHTML = [
            '<option value="all">All My Sections</option>',
            ...[...sections].map(([id, name]) => `<option value="${window.EDUGNAY_CONFIG.escapeHtml(id)}">${window.EDUGNAY_CONFIG.escapeHtml(name)}</option>`)
          ].join('');
        }
        const escape = window.EDUGNAY_CONFIG.escapeHtml;
        flagList.innerHTML = TEACHER_FLAGS_ERROR
          ? window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Student indicators unavailable', text: TEACHER_FLAGS_ERROR })
          : TEACHER_FLAGS.length ? TEACHER_FLAGS.map(student => `
            <div class="flag-card" data-section="${escape(student.sectionId)}">
              <div class="flag-card-top"><div class="flag-av" style="background:var(--blue-mid)">${escape(student.initials || '?')}</div>
                <div class="flag-info"><div class="flag-name">${escape(student.name)}</div>
                  <div class="flag-detail">${escape(student.grade)} · ${escape(student.sectionName)}</div></div></div>
              <div class="flag-reason-row">${student.reasons.map(reason => `<span class="badge badge-${['grade', 'low_scores'].includes(reason.type) ? 'gold' : 'red'}"><i data-lucide="${['grade', 'low_scores'].includes(reason.type) ? 'trending-down' : 'calendar-days'}" aria-hidden="true"></i> ${escape(reason.type === 'grade'
                ? `${reason.subject}: ${reason.grade}`
                : reason.type === 'low_scores' ? `${reason.subject}: 3 low scores this report week`
                : reason.type === 'consecutive' ? `${reason.count} missed ${reason.subject} meeting dates in a row`
                  : `${reason.count} dates with a recorded ${reason.includesExcused ? 'subject absence (including excused)' : 'unexcused subject absence'}`)}</span>`).join('')}</div>
            </div>`).join('')
            : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'user-round-check', title: 'No flagged students', text: 'No students currently meet the attendance or academic criteria.' });
      }
      lucide.createIcons();
    }

    function renderTeacherQuickActions() {
      const actions = document.getElementById('teacher-quick-actions');
      if (!actions) return;
      actions.innerHTML = TEACHER_QUICK_ACTIONS.length
        ? TEACHER_QUICK_ACTIONS.map(action => `
            <a href="#" class="qa-item" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', action.action)}">
              <div class="qa-icon"><i data-lucide="${action.icon}" style="width:18px;height:18px;"></i></div>
              <div class="qa-text"><div class="qa-title">${action.title}</div><div class="qa-desc">${action.desc}</div></div>
              <div class="qa-arrow"><i data-lucide="chevron-right" style="width:18px;height:18px;"></i></div>
            </a>`).join('')
        : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'zap-off', title: 'No quick actions', text: 'Available shortcuts will appear here.' });
      lucide.createIcons();
    }

    const MAX_SECTION_CARDS = 6;
    let currentSectionFilter = 'all';

    function renderTeacherGradeFilters() {
      const row = document.getElementById('sectionFilterRow');
      if (!row || !TEACHER_DASHBOARD_API_ENABLED) return;
      row.replaceChildren();
      const grades = [...new Map(TEACHER_CLASSES.map(section => [section.grade, section.gradeLabel || `Grade ${section.grade}`])).entries()];
      [['all', 'All'], ...grades].forEach(([value, label], index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `section-filter-btn${index === 0 ? ' active' : ''}`;
        button.textContent = label;
        button.addEventListener('click', () => filterSections(value, button));
        row.appendChild(button);
      });
      currentSectionFilter = 'all';
    }

    function filterSections(grade, btnEl) {
      currentSectionFilter = grade;

      document.querySelectorAll('#sectionFilterRow .section-filter-btn')
        .forEach(btn => btn.classList.remove('active'));
      btnEl.classList.add('active');

      applySectionFilter();
    }

    function applySectionFilter() {
      const cards = document.querySelectorAll('#sectionCardsContainer .section-card');
      let shown = 0;

      cards.forEach(card => {
        const matches = currentSectionFilter === 'all' || card.getAttribute('data-grade') === currentSectionFilter;
        const withinLimit = shown < MAX_SECTION_CARDS;
        const visible = matches && withinLimit;
        card.style.display = visible ? '' : 'none';
        if (matches) shown++;
      });
      const empty = document.getElementById('teacherSectionsEmpty');
      if (empty) {
        empty.hidden = shown > 0;
        if (!empty.hidden && !TEACHER_SECTIONS_ERROR) empty.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'door-open', title: 'No matching classes', text: 'Try another grade filter.' });
      }
      lucide.createIcons();
    }

    async function loadTeacherDashboardData() {
      await window.EDUGNAY_SCHOOL_READY;
      const session = await window.EDUGNAY_API.getCurrentUser();
      if (session?.role !== 'teacher') throw new Error('This dashboard requires a teacher session.');
      DASHBOARD_TEACHER_ID = String(session.apiUserId || session.userId);
      const greeting = document.querySelector('.grading-welcome-name');
      if (greeting) greeting.textContent = `Welcome back, ${session.firstName || 'Teacher'}!`;

      const sections = (await window.EDUGNAY_CONFIG.getMyTeachingSections()).filter(section =>
        section.status === 'active' && section.academicYearStatus === 'active'
      );

      TEACHER_SECTIONS = sections.map(section => {
        const assignments = section.subjectAssignments || [];
        const grade = String(section.gradeCode || section.gradeLevelName || '').replace(/^grade-/, '');
        const gradeLabel = section.gradeLevelName || ('Grade ' + grade);
        return {
          id: String(section.id),
          sectionId: String(section.id),
          schoolId: section.schoolId,
          grade,
          gradeLabel,
          name: gradeLabel + ' – ' + section.name,
          sectionName: section.name,
          studentCount: Number(section.studentCount) || 0,
          capacity: Number(section.capacity) || 0,
          isAdviser: String(section.adviserId || '') === DASHBOARD_TEACHER_ID,
          subjectId: assignments[0]?.subjectId || null,
          subjectName: [...new Set(assignments.map(getTeacherAssignmentName).filter(Boolean))].join(', '),
          subjectAssignments: assignments.map(item => ({
            subjectId: String(item.subjectId),
            subjectName: item.subjectName,
            communicationComponentCode: item.communicationComponentCode || null,
            communicationComponentName: item.communicationComponentName || null
          }))
        };
      });
      let shsClasses = [];
      try {
        shsClasses = (await window.EDUGNAY_API.getShsTeachingClasses()).classes || [];
      } catch (error) {
        if (error.status !== 403 && error.status !== 404) console.warn('SHS class preview could not be loaded.');
      }
      TEACHER_CLASSES = [
        ...TEACHER_SECTIONS.map(section => ({ ...section, classType: 'section' })),
        ...shsClasses.map(item => {
          const grade = String(item.gradeCode || '').replace(/^grade-/, '') || String(item.gradeName || '').match(/\d+/)?.[0] || '';
          return {
            id: String(item.electiveClassId), classType: 'shs', grade, gradeLabel: item.gradeName || `Grade ${grade}`,
            name: [item.gradeName, item.className].filter(Boolean).join(' · '), subjectName: item.subjectName || '',
            studentCount: Number(item.enrolledCount) || 0
          };
        })
      ];
      TEACHER_MATERIAL_SECTIONS = TEACHER_SECTIONS.filter(section => section.subjectAssignments.length > 0);
      TEACHER_SECTIONS_ERROR = '';

      if (dashboardPeriod && sections[0]?.level) {
        dashboardPeriod.dataset.schoolLevel = sections[0].level;
        window.refreshEdUgnayShellContext?.();
      }
    }

    function renderWeekCalendar() {
      const grid = document.getElementById('weekCalendarGrid');
      const rangeLabel = document.getElementById('weekRangeLabel');
      if (!grid) return;

      const today = new Date();
      const dayOfWeek = today.getDay(); // 0 = Sunday
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7)); // back to Monday

      const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      let html = '';

      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const isToday = d.toDateString() === today.toDateString();
        html += `
        <div class="week-day${isToday ? ' is-today' : ''}${i > 4 ? ' is-weekend' : ''}"${isToday ? ' aria-current="date"' : ''}>
          <span class="week-day-label">${dayLabels[i]}</span>
          <span class="week-day-num">${d.getDate()}</span>
        </div>`;
      }

      grid.innerHTML = html;

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (rangeLabel) {
        rangeLabel.textContent = `${fmt(monday)} – ${fmt(sunday)}`;
        rangeLabel.dataset.currentDate = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        rangeLabel.parentElement.dataset.currentDate = rangeLabel.dataset.currentDate;
      }
    }
    document.addEventListener('DOMContentLoaded', async () => {
      renderWeekCalendar();
      renderTeacherQuickActions();
      document.getElementById('teacher-todo-list').innerHTML = '';
      document.getElementById('flagGridSingle').innerHTML = '';
      if (TEACHER_DASHBOARD_API_ENABLED) {
        document.getElementById('teacher-summary-cards').innerHTML = '';
        document.getElementById('sectionCardsContainer').innerHTML = '';
        document.getElementById('teacher-dashboard-announcements').innerHTML = '';
        try {
          await loadTeacherDashboardData();
        } catch (error) {
          TEACHER_SECTIONS = [];
          TEACHER_CLASSES = [];
          TEACHER_MATERIAL_SECTIONS = [];
          TEACHER_SECTIONS_ERROR = error.message || 'Assigned sections could not be loaded.';
        }
      } else {
        TEACHER_SECTIONS_ERROR = 'The backend is required to load your assigned sections.';
      }
      if (TEACHER_DASHBOARD_API_ENABLED) {
        try {
          TEACHER_ADVISORY_SECTIONS = await window.EDUGNAY_CONFIG.getMyAdvisorySections();
        } catch (error) {
          TEACHER_ADVISORY_SECTIONS = TEACHER_SECTIONS.filter(section => section.isAdviser);
          TEACHER_PENDING_REPORTS_ERROR = error.message || 'Reports could not be loaded.';
        }
        if (TEACHER_ADVISORY_SECTIONS.length && window.EDUGNAY_CONFIG.isNarrativeReportsEnabled() &&
          !TEACHER_PENDING_REPORTS_ERROR) {
          try {
            const result = await window.EDUGNAY_API.request('/reports/weekly-drafts/pending-count');
            TEACHER_PENDING_REPORTS = result.pendingCount;
          } catch (error) {
            TEACHER_PENDING_REPORTS_ERROR = error.message || 'Reports could not be loaded.';
          }
        }
      }
      if (TEACHER_FLAGS_PREVIEW) {
        TEACHER_FLAGS = SAMPLE_FLAGGED_STUDENTS;
      } else if (TEACHER_DASHBOARD_API_ENABLED && !TEACHER_SECTIONS_ERROR) {
        try {
          const result = await window.EDUGNAY_API.getTeacherStudentFlags();
          TEACHER_FLAGS = result.flaggedStudents || [];
        } catch (error) {
          TEACHER_FLAGS_ERROR = error.message || 'Student indicators could not be loaded.';
        }
      } else {
        TEACHER_FLAGS_ERROR = TEACHER_SECTIONS_ERROR || 'The backend is required to load student indicators.';
      }
      if (TEACHER_DASHBOARD_API_ENABLED) {
        try {
          const announcements = window.EDUGNAY_COMMUNICATION_RESOURCES?.announcements;
          if (!announcements) throw new Error('Announcements could not be loaded.');
          TEACHER_DASHBOARD_ANNOUNCEMENTS = await announcements;
          TEACHER_ANNOUNCEMENTS_ERROR = '';
        } catch (error) {
          TEACHER_DASHBOARD_ANNOUNCEMENTS = [];
          TEACHER_ANNOUNCEMENTS_ERROR = error.message || 'Announcements could not be loaded.';
        }
      } else {
        TEACHER_ANNOUNCEMENTS_ERROR = 'The backend is required to load announcements.';
      }
      await refreshTeacherTasks();
      TEACHER_ANNOUNCEMENTS_LOADING = false;
      renderTeacherDashboardData();
      renderTeacherTodos();
      initTeacherMaterialTargets();
      applySectionFilter();
      const currentDate = document.getElementById('currentDate');
      if (currentDate) {
        currentDate.textContent = new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      }
      window.EDUGNAY_PAGE_LOADING.ready();
    });

    function filterFlaggedStudents() {
      const selected = document.getElementById('flagSectionFilter').value;
      const flagList = document.getElementById('flagGridSingle');
      const cards = flagList ? flagList.querySelectorAll('.flag-card') : [];
      if (!cards.length) return;
      let visibleCount = 0;

      cards.forEach(card => {
        const section = card.getAttribute('data-section');
        const show = selected === 'all' || section === selected;
        card.classList.toggle('flag-hidden', !show);
        if (show) visibleCount++;
      });

      let emptyMsg = document.getElementById('flagEmptyMsg');
      if (visibleCount === 0) {
        if (!emptyMsg) {
          emptyMsg = document.createElement('div');
          emptyMsg.id = 'flagEmptyMsg';
          emptyMsg.className = 'panel-empty-slot';
          flagList.appendChild(emptyMsg);
        }
        emptyMsg.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'user-round-search', title: 'No flagged students', text: 'No students in this section currently need attention.' });
      } else if (emptyMsg) {
        emptyMsg.remove();
      }
      lucide.createIcons();
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        toggleDrawer(false);
        closeTeacherQrAttendanceModal();
        closeTeacherTodoModal();
        closeTeacherTodoDeleteModal();
      }
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    p3704ce127789: function(event) { updateTeacherQrAttendanceSubjects() },
    pba42adf105d5: function(event) { updateTeacherMaterialFileName(this) },
    pe01c71e41f8a: function(event) { updateTeacherQrAttendanceButton() },
    pe0d2199bc2e2: function(event) { filterFlaggedStudents() },
  },
  click: {
    p00a7bb77c440: function(event) { filterSections('7', this) },
    p01a0b7e1e07b: function(event) { filterSections('all', this) },
    p05ad424bf8de: function(event) { if(event.target === this) closeTeacherTodoModal() },
    p075af09b9873: function(event) { navigate('section') },
    p0818717fc09e: function(event) { if(event.target === this) closeTeacherTodoDeleteModal() },
    p1edafbba3b99: function(event) { closeTeacherTodoModal() },
    p321aa7182ab2: function(event) { filterSections('9', this) },
    p45926506b789: function(event) { confirmDeleteTeacherTodo() },
    p48fbdaa17c3c: function(event) { closeTeacherMaterialModal() },
    p50a76eb2b6f8: function(event) { document.getElementById('teacherMaterialFile').click() },
    p5d876c9d3082: function(event) { closeTeacherTodoDeleteModal() },
    p7444e80b8ada: function(event) { closeTeacherQrAttendanceModal() },
    pa5790f6e79ba: function(event) { submitTeacherMaterialUpload() },
    paab5754e6d1e: function(event) { filterSections('8', this) },
    pc09fdf9e1308: function(event) { openTeacherTodoModal() },
    pd65b3d2ea36a: function(event) { if(event.target === this) closeTeacherQrAttendanceModal() },
  },
  submit: {
    p4b450b8f960b: function(event) { saveTeacherTodo(event); return false; },
    pf4e84bedd9ac: function(event) { startTeacherQrAttendance(event); return false; },
  },
});

window.EDUGNAY_PAGE_EVENTS.bind({
  error: {
    gbb1bd901180b: function(event) { this.style.display='none' },
  },
});
