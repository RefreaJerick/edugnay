// Dashboard records come from the backend; do not show demo data here.
    const ADMIN_DASHBOARD_API_ENABLED = window.EDUGNAY_API?.isBackendAvailable === true;
    let DASHBOARD_ADMIN_TODOS = [];
    let ADMIN_STUDENTS = [];
    let ADMIN_TEACHERS = [];
    let ADMIN_PARENTS = [];
    let ADMIN_DASHBOARD_SECTIONS = [];
    let ADMIN_DASHBOARD_STRUCTURE = [];
    let ADMIN_ASSIGNMENT_ERROR = '';
    let ADMIN_USER_ERRORS = { students: '', teachers: '', parents: '' };
    let DASHBOARD_ACTIVITY_ERROR = '';

    function getAdminTodos() {
      return Array.isArray(DASHBOARD_ADMIN_TODOS) ? DASHBOARD_ADMIN_TODOS : [];
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

    async function refreshAdminTasks(fallback = {}) {
      try {
        const tasks = await window.EDUGNAY_API.getTasks();
        if (fallback.task && !tasks.some(item => item.id === fallback.task.id)) throw new Error('The saved task was not returned by the task list.');
        if (fallback.removedId && tasks.some(item => item.id === String(fallback.removedId))) throw new Error('The deleted task is still returned by the task list.');
        DASHBOARD_ADMIN_TODOS = tasks;
        if (window.EDUGNAY_COMMUNICATION?.backend) window.EDUGNAY_COMMUNICATION.tasks = DASHBOARD_ADMIN_TODOS;
        setDashboardFeedback('adminTodoListFeedback');
      } catch (error) {
        if (fallback.task) {
          const index = getAdminTodos().findIndex(item => item.id === fallback.task.id);
          if (index >= 0) DASHBOARD_ADMIN_TODOS[index] = fallback.task;
          else DASHBOARD_ADMIN_TODOS = [...getAdminTodos(), fallback.task];
        }
        if (fallback.removedId) DASHBOARD_ADMIN_TODOS = getAdminTodos().filter(item => item.id !== String(fallback.removedId));
        const message = fallback.removedId
          ? `The task was deleted, but the list could not refresh: ${error.message || 'Please reload the page.'}`
          : fallback.task
            ? `The task was saved, but the list could not refresh: ${error.message || 'Please reload the page.'}`
            : `Tasks could not be loaded: ${error.message || 'Please reload the page.'}`;
        setDashboardFeedback('adminTodoListFeedback', message, fallback.task || fallback.removedId ? 'info' : 'error');
      }
      renderAdminTodos();
    }

    const ADMIN_SUMMARY_CARDS = [
      {
        id: 'students',
        tone: 'green',
        icon: 'graduation-cap',
        label: 'Students',
        sub: 'Across all grades',
        records: ADMIN_STUDENTS,
      },
      {
        id: 'faculty',
        tone: 'gold',
        icon: 'book-open',
        label: 'Faculty',
        sub: 'Active teachers this grading period',
        records: ADMIN_TEACHERS,
      },
      {
        id: 'parents',
        tone: 'purple',
        icon: 'heart-handshake',
        label: 'Parents',
        sub: 'Linked to student accounts',
        records: ADMIN_PARENTS,
      },
    ];

    let DASHBOARD_ASSIGNMENT_STUDENTS = ADMIN_STUDENTS;
    const dashboardAssignmentState = {
      student: null,
      level: '',
      grade: '',
      strand: '',
      section: ''
    };
    let dashboardStudentPicker;

    function dashboardGradeKey(value) {
      const text = String(value || '').trim().toLowerCase();
      return text.replace(/^grade\s*/, '');
    }

    function dashboardLevelLabel(level) {
      return ADMIN_DASHBOARD_STRUCTURE.find(item => item.levelCode === level)?.displayName || level;
    }

    function dashboardSchoolLevels() {
      return ADMIN_DASHBOARD_STRUCTURE.filter(item => item.isEnabled !== false).map(item => item.levelCode);
    }

    function dashboardDivision(level) {
      return ADMIN_DASHBOARD_STRUCTURE.find(item => item.levelCode === level) || {};
    }

    function dashboardAssignmentSections() {
      return ADMIN_DASHBOARD_SECTIONS;
    }

    function dashboardSetOptions(select, options, placeholder, selectedValue) {
      if (!select) return;
      select.innerHTML = '';
      if (placeholder) select.appendChild(new Option(placeholder, ''));
      options.forEach(optionData => {
        const option = new Option(optionData.label, optionData.value);
        option.disabled = Boolean(optionData.disabled);
        select.appendChild(option);
      });
      const selected = options.some(option => option.value === selectedValue) ? selectedValue : '';
      select.value = selected;
      window.syncSearchableSelect?.(select);
    }

    function dashboardGradeOptions(level) {
      return (dashboardDivision(level).gradeLevels || [])
        .filter(grade => grade.isEnabled !== false)
        .map(grade => grade.displayName);
    }

    function dashboardStrandOptions(level) {
      if (level !== 'shs') return [];
      return (dashboardDivision(level).tracks || [])
        .filter(track => track.isEnabled !== false)
        .map(track => track.displayName);
    }

    function dashboardSectionLabel(section) {
      const strand = section.strand ? ` · ${section.strand}` : '';
      const occupancy = `${section.enrolled}/${section.capacity || '—'}`;
      return `${section.grade}${strand} · ${section.name} (${occupancy})`;
    }

    function renderDashboardStudentOptions(selectedId = '') {
      dashboardStudentPicker.setStudents(DASHBOARD_ASSIGNMENT_STUDENTS, selectedId);
    }

    function renderDashboardAssignmentSections() {
      const level = dashboardAssignmentState.level;
      const grade = dashboardGradeKey(dashboardAssignmentState.grade);
      const strand = dashboardAssignmentState.strand;
      const select = document.getElementById('modalSection');
      if (!select) return;

      const sections = dashboardAssignmentSections().filter(section => {
        if (!level || !grade || (level === 'shs' && !strand)) return false;
        if (section.level !== level || dashboardGradeKey(section.grade) !== grade) return false;
        return level !== 'shs' || dashboardGradeKey(section.strand) === dashboardGradeKey(strand);
      });
      const options = sections.map(section => ({
        value: section.id,
        label: dashboardSectionLabel(section),
        disabled: section.enrolled + (dashboardStudentPicker?.getSelectedIds().length || 1) > section.capacity
      }));
      if (!options.length) options.push({ value: '', label: level && grade && (level !== 'shs' || strand) ? 'No matching active sections' : 'Choose a level and grade first', disabled: true });
      dashboardSetOptions(select, options, 'Select a section', dashboardAssignmentState.section);
      dashboardAssignmentState.section = select.value;
    }

    function updateDashboardAssignmentContext() {
      const selectedSection = dashboardAssignmentSections().find(section => section.id === document.getElementById('modalSection')?.value);
      dashboardAssignmentState.section = selectedSection?.id || '';
      const context = document.getElementById('ctxVal');
      if (!context) return;
      if (!dashboardAssignmentState.student && !selectedSection) {
        context.textContent = 'Select a student and section';
        return;
      }
      const student = dashboardAssignmentState.student;
      const studentLabel = student ? student.displayName : 'Student not selected';
      const placement = [dashboardLevelLabel(dashboardAssignmentState.level), dashboardAssignmentState.grade, dashboardAssignmentState.strand].filter(Boolean).join(' · ');
      context.textContent = selectedSection
        ? `${studentLabel} · ${placement} · ${selectedSection.name}`
        : `${studentLabel} · ${placement}`;
    }

    function updateDashboardAssignmentFields(changed = '') {
      const levelSelect = document.getElementById('modalSchoolLevel');
      const gradeSelect = document.getElementById('modalGradeLevel');
      const strandSelect = document.getElementById('modalStrand');
      if (changed === 'level') {
        dashboardAssignmentState.level = levelSelect.value;
        dashboardAssignmentState.grade = '';
        dashboardAssignmentState.strand = '';
      } else if (changed === 'grade') {
        dashboardAssignmentState.grade = gradeSelect.value;
        dashboardAssignmentState.strand = '';
      } else if (changed === 'strand') {
        dashboardAssignmentState.strand = strandSelect.value;
      }
      if (changed) dashboardAssignmentState.section = '';
      const level = dashboardAssignmentState.level;
      dashboardSetOptions(levelSelect, dashboardSchoolLevels().map(item => ({ value: item, label: dashboardLevelLabel(item) })), 'Select a school level', level);
      if (levelSelect) {
        levelSelect.disabled = !dashboardAssignmentState.student || !ADMIN_DASHBOARD_API_ENABLED;
      }

      const grades = dashboardGradeOptions(level);
      const grade = grades.find(item => dashboardGradeKey(item) === dashboardGradeKey(dashboardAssignmentState.grade)) || '';
      dashboardAssignmentState.grade = grade;
      dashboardSetOptions(gradeSelect, grades.map(item => ({ value: item, label: item })), 'Select a grade level', grade);
      if (gradeSelect) gradeSelect.disabled = !dashboardAssignmentState.student || !level || !ADMIN_DASHBOARD_API_ENABLED;

      const strands = dashboardStrandOptions(level);
      const strandGroup = document.getElementById('modalStrandGroup');
      const strand = strands.find(item => dashboardGradeKey(item) === dashboardGradeKey(dashboardAssignmentState.strand)) || '';
      dashboardAssignmentState.strand = level === 'shs' ? strand : '';
      if (strandGroup) strandGroup.style.display = level === 'shs' ? '' : 'none';
      dashboardSetOptions(strandSelect, strands.map(item => ({ value: item, label: item })), 'Select a track or strand', strand);
      if (strandSelect) {
        strandSelect.disabled = !dashboardAssignmentState.student || !grade || !ADMIN_DASHBOARD_API_ENABLED;
        strandSelect.required = level === 'shs';
      }

      const hiddenValues = {
        modalSchoolLevelValue: dashboardAssignmentState.level,
        modalGradeLevelValue: dashboardAssignmentState.grade,
        modalStrandValue: dashboardAssignmentState.strand
      };
      Object.entries(hiddenValues).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.value = value || '';
        input.disabled = !dashboardAssignmentState.student;
      });

      renderDashboardAssignmentSections();
      updateDashboardAssignmentContext();
    }

    function handleDashboardStudentChange(studentIds) {
      const student = DASHBOARD_ASSIGNMENT_STUDENTS.find(item => String(item.id) === String(studentIds[0])) || null;
      if (!dashboardAssignmentState.student || !student) {
        dashboardAssignmentState.level = student?.schoolLevel || '';
        dashboardAssignmentState.grade = student?.gradeLevel || '';
        dashboardAssignmentState.strand = student?.strand || '';
      }
      dashboardAssignmentState.student = student;
      updateDashboardAssignmentFields();
    }

    const ADMIN_QUICK_ACTIONS = [
      { icon: 'user-plus', title: 'Add New Account', desc: 'Create teacher, student or parent', href: 'edugnay-admin-users.html?action=add' },
      { icon: 'user-plus', title: 'Assign Student to Section', desc: 'Place an existing student in a section', action(event) { event.preventDefault(); openStudentModal(); } },
      { icon: 'calendar-plus', title: 'Add Calendar Notice', desc: 'Add a holiday or no-class notice', href: 'edugnay-admin-schools.html#add-calendar-notice' },
      { icon: 'megaphone', title: 'Post Announcement', desc: 'Broadcast to all user groups', action(event) { event.preventDefault(); openAnnouncementModal(); } }
    ];

    function renderAdminDashboard() {
      DASHBOARD_ASSIGNMENT_STUDENTS = ADMIN_STUDENTS.filter(student => student.status === 'active' && !student.sectionId);
      ADMIN_SUMMARY_CARDS[0].records = ADMIN_STUDENTS;
      ADMIN_SUMMARY_CARDS[1].records = ADMIN_TEACHERS;
      ADMIN_SUMMARY_CARDS[2].records = ADMIN_PARENTS;
      ADMIN_SUMMARY_CARDS[0].value = ADMIN_USER_ERRORS.students ? '—' : ADMIN_STUDENTS.length;
      ADMIN_SUMMARY_CARDS[0].sub = ADMIN_USER_ERRORS.students || 'Across all grades';
      ADMIN_SUMMARY_CARDS[1].value = ADMIN_USER_ERRORS.teachers ? '—' : ADMIN_TEACHERS.length;
      ADMIN_SUMMARY_CARDS[1].sub = ADMIN_USER_ERRORS.teachers || 'Active teachers this grading period';
      ADMIN_SUMMARY_CARDS[2].value = ADMIN_USER_ERRORS.parents ? '—' : ADMIN_PARENTS.length;
      ADMIN_SUMMARY_CARDS[2].sub = ADMIN_USER_ERRORS.parents || 'Linked to student accounts';
      const cards = document.getElementById('admin-summary-cards');
      if (cards) {
        cards.innerHTML = ADMIN_SUMMARY_CARDS.map(card => {
          const value = card.value === undefined ? card.records.length : card.value;
          return `<div class="stat-card ${card.tone}"><div class="stat-card-top"><div class="stat-card-icon"><i data-lucide="${card.icon}" style="width:20px;height:20px;"></i></div></div><div class="stat-card-num">${window.EDUGNAY_CONFIG.escapeHtml(value)}</div><div class="stat-card-label">${window.EDUGNAY_CONFIG.escapeHtml(card.label)}</div><div class="stat-card-sub">${window.EDUGNAY_CONFIG.escapeHtml(card.sub)}</div></div>`;
        }).join('');
      }
      const actions = document.getElementById('admin-quick-actions');
      if (actions) {
        actions.innerHTML = ADMIN_QUICK_ACTIONS.length
          ? ADMIN_QUICK_ACTIONS.map(action => `
            <a href="${action.href || '#'}" class="qa-item" ${action.action ? `data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', action.action)}"` : ''}><div class="qa-icon"><i data-lucide="${action.icon}" style="width:18px;height:18px;"></i></div><div class="qa-text"><div class="qa-title">${action.title}</div><div class="qa-desc">${action.desc}</div></div><div class="qa-arrow"><i data-lucide="chevron-right" style="width:18px;height:18px;"></i></div></a>`).join('')
          : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'zap-off', title: 'No quick actions', text: 'Available shortcuts will appear here when they are ready.' });
      }
      lucide.createIcons();
    }

    async function getAllAdminDashboardUsers(role, status = '') {
      const users = [];
      let page = 1;
      let total = Infinity;
      while (users.length < total) {
        const result = await window.EDUGNAY_API.getUsers({ role, status, page, limit: 100 });
        if (!result.users.length) {
          total = Number(result.pagination?.total) || 0;
          if (users.length < total) throw new Error('The user list could not be fully loaded.');
          break;
        }
        users.push(...result.users);
        total = Number(result.pagination?.total) || 0;
        page += 1;
      }
      return users;
    }

    async function loadAdminDashboardData() {
      await window.EDUGNAY_SCHOOL_READY;
      const session = await window.EDUGNAY_API.getCurrentUser();
      if (session?.role !== 'school_admin') throw new Error('This dashboard requires a school administrator session.');
      const greeting = document.querySelector('.grading-welcome-name');
      if (greeting) greeting.textContent = `Welcome back, ${session.firstName || 'Admin'}!`;

      const [students, teachers, parents, sections, structure] = await Promise.allSettled([
        getAllAdminDashboardUsers('student'),
        getAllAdminDashboardUsers('teacher', 'active'),
        getAllAdminDashboardUsers('parent'),
        window.EDUGNAY_API.getSections(),
        window.EDUGNAY_API.getAcademicStructure()
      ]);
      const applyUsers = (result, key, setter) => {
        if (result.status === 'fulfilled') setter(result.value);
        else ADMIN_USER_ERRORS[key] = result.reason?.message || 'Users could not be loaded';
      };
      applyUsers(students, 'students', value => { ADMIN_STUDENTS = value; });
      applyUsers(teachers, 'teachers', value => { ADMIN_TEACHERS = value; });
      applyUsers(parents, 'parents', value => { ADMIN_PARENTS = value; });

      if (sections.status === 'fulfilled') {
        ADMIN_ASSIGNMENT_ERROR = '';
        ADMIN_DASHBOARD_SECTIONS = sections.value
          .filter(section => section.status === 'active' && section.academicYearStatus === 'active')
          .map(section => ({
            id: String(section.id), schoolId: section.schoolId, academicYearId: String(section.academicYearId), level: section.level,
            grade: section.grade, strand: section.strand, name: section.name,
            enrolled: Number(section.studentCount) || 0, capacity: Number(section.capacity) || 0
          }));
        if (students.status !== 'fulfilled') {
          ADMIN_ASSIGNMENT_ERROR = students.reason?.message || 'Student choices could not be loaded.';
        }
      } else {
        ADMIN_DASHBOARD_SECTIONS = [];
        ADMIN_ASSIGNMENT_ERROR = sections.reason?.message || 'Sections could not be loaded.';
      }
      if (structure.status === 'fulfilled') ADMIN_DASHBOARD_STRUCTURE = structure.value;
      else ADMIN_ASSIGNMENT_ERROR = structure.reason?.message || 'School grade settings could not be loaded.';
    }

    function openAdminTodoModal(todoId = null) {
      const modal = document.getElementById('adminTodoModal');
      const form = document.getElementById('adminTodoForm');
      if (!modal || !form) return;
      form.reset();
      setDashboardFeedback('adminTodoFeedback');
      const todo = todoId
        ? getAdminTodos().find(item => item.id === String(todoId))
        : null;
      document.getElementById('adminTodoId').value = todo?.id || '';
      document.getElementById('adminTodoTitle').value = todo?.title || '';
      document.getElementById('adminTodoDueDate').value = todo?.dueDate || '';
      document.getElementById('adminTodoModalTitle').textContent = todo ? 'Edit task' : 'Add task';
      document.getElementById('adminTodoSaveButton').textContent = todo ? 'Save changes' : 'Add task';
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.getElementById('adminTodoTitle').focus();
    }

    function closeAdminTodoModal() {
      const modal = document.getElementById('adminTodoModal');
      if (!modal) return;
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }

    async function saveAdminTodo(event) {
      event?.preventDefault();
      if (!ADMIN_DASHBOARD_API_ENABLED) {
        setDashboardFeedback('adminTodoFeedback', 'Tasks can’t be saved right now. Refresh and try again.');
        return false;
      }
      const todoId = document.getElementById('adminTodoId').value;
      const titleInput = document.getElementById('adminTodoTitle');
      const title = titleInput.value.trim();
      const dueDate = document.getElementById('adminTodoDueDate').value || null;
      titleInput.setCustomValidity(title ? '' : 'Enter a task title.');
      if (!titleInput.reportValidity()) return false;

      const button = document.getElementById('adminTodoSaveButton');
      button.disabled = true;
      button.textContent = 'Saving…';
      setDashboardFeedback('adminTodoFeedback');
      try {
        const task = todoId
          ? await window.EDUGNAY_API.updateTask(todoId, { title, dueDate })
          : await window.EDUGNAY_API.createTask({ title, dueDate });
        closeAdminTodoModal();
        await refreshAdminTasks({ task });
        showAppToast(todoId ? 'Task updated.' : 'Task added.');
      } catch (error) {
        showAppToast(error.message || 'The task could not be saved.', 'error');
      } finally {
        button.disabled = false;
        button.textContent = todoId ? 'Save changes' : 'Add task';
      }
      return false;
    }

    function toggleAdminTodo(todoId, checkbox) {
      if (!ADMIN_DASHBOARD_API_ENABLED) {
        setDashboardFeedback('adminTodoListFeedback', 'Tasks can’t be updated right now. Refresh and try again.');
        renderAdminTodos();
        return;
      }
      const todo = getAdminTodos()
        .find(item => item.id === String(todoId));
      if (!todo) return;
      const completed = todo.status !== 'completed';
      if (checkbox) checkbox.disabled = true;
      window.EDUGNAY_API.updateTask(todo.id, { status: completed ? 'completed' : 'pending' })
        .then(async updated => {
          await refreshAdminTasks({ task: updated });
          showAppToast(completed ? 'Task completed.' : 'Task reopened.');
        })
        .catch(error => {
          showAppToast(error.message || 'The task status could not be updated.', 'error');
          renderAdminTodos();
        });
    }

    function openAdminTodoDeleteModal(todoId) {
      const todo = getAdminTodos()
        .find(item => item.id === String(todoId));
      const modal = document.getElementById('adminTodoDeleteModal');
      if (!todo || !modal) return;
      setDashboardFeedback('adminTodoDeleteFeedback');
      document.getElementById('adminTodoDeleteId').value = todo.id;
      document.getElementById('adminTodoDeleteName').textContent = `“${todo.title}”`;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      lucide.createIcons();
    }

    function closeAdminTodoDeleteModal() {
      const modal = document.getElementById('adminTodoDeleteModal');
      if (!modal) return;
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.getElementById('adminTodoDeleteId').value = '';
    }

    async function confirmDeleteAdminTodo() {
      if (!ADMIN_DASHBOARD_API_ENABLED) {
        setDashboardFeedback('adminTodoDeleteFeedback', 'Tasks can’t be deleted right now. Refresh and try again.');
        return;
      }
      const todoId = document.getElementById('adminTodoDeleteId').value;
      if (!todoId) return;
      const button = document.getElementById('adminTodoDeleteConfirmButton');
      button.disabled = true;
      button.textContent = 'Deleting…';
      setDashboardFeedback('adminTodoDeleteFeedback');
      try {
        await window.EDUGNAY_API.deleteTask(todoId);
        closeAdminTodoDeleteModal();
        await refreshAdminTasks({ removedId: todoId });
        showAppToast('Task deleted.');
      } catch (error) {
        showAppToast(error.message || 'The task could not be deleted.', 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Yes, Delete';
      }
    }

    function renderAdminTodos() {
      const list = document.getElementById('admin-todo-list');
      if (!list) return;

      const todos = getAdminTodos()
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
              ${completed ? 'checked' : ''} data-page-change="${window.EDUGNAY_PAGE_EVENTS.register('change', function(event) { toggleAdminTodo(String(todo.id), this) })}">
            <div class="todo-copy">
              <div class="todo-title">${window.EDUGNAY_CONFIG.escapeHtml(todo.title)}</div>
              ${dueDate ? `<div class="todo-due">Due ${dueDate}</div>` : ''}
            </div>
            <div class="todo-actions">
              <button type="button" aria-label="Edit ${window.EDUGNAY_CONFIG.escapeHtml(todo.title)}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openAdminTodoModal(String(todo.id)) })}">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" aria-label="Delete ${window.EDUGNAY_CONFIG.escapeHtml(todo.title)}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openAdminTodoDeleteModal(String(todo.id)) })}">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </div>`;
      }).join('');
      lucide.createIcons();
    }

    document.addEventListener('DOMContentLoaded', async () => {
      dashboardStudentPicker = window.createStudentMultiSelect(document.getElementById('dashboardStudentPicker'), handleDashboardStudentChange);
      if (ADMIN_DASHBOARD_API_ENABLED) {
        document.getElementById('admin-summary-cards').innerHTML = '';
        document.getElementById('activityList').innerHTML = '';
      }
      if (ADMIN_DASHBOARD_API_ENABLED) {
        try {
          await loadAdminDashboardData();
        } catch (error) {
          ADMIN_USER_ERRORS = { students: error.message, teachers: error.message, parents: error.message };
          ADMIN_DASHBOARD_SECTIONS = [];
          ADMIN_DASHBOARD_STRUCTURE = [];
        }
        try {
          RECENT_ACTIVITY = await window.EDUGNAY_API.getDashboardActivity('school');
          DASHBOARD_ACTIVITY_ERROR = '';
        } catch (error) {
          RECENT_ACTIVITY = [];
          DASHBOARD_ACTIVITY_ERROR = error.message || 'Recent activity could not be loaded.';
        }
      } else {
        const message = 'Dashboard information couldn’t be loaded. Refresh and try again.';
        ADMIN_USER_ERRORS = { students: message, teachers: message, parents: message };
        ADMIN_ASSIGNMENT_ERROR = message;
        DASHBOARD_ACTIVITY_ERROR = message;
      }
      await refreshAdminTasks();
      renderAdminDashboard();
      renderAdminTodos();
      renderActivityList();
      document.getElementById('addAdminTodoButton')?.addEventListener('click', () => openAdminTodoModal());
      document.getElementById('adminTodoForm')?.addEventListener('submit', saveAdminTodo);
      document.getElementById('adminTodoCloseButton')?.addEventListener('click', closeAdminTodoModal);
      document.getElementById('adminTodoCancelButton')?.addEventListener('click', closeAdminTodoModal);
      document.getElementById('adminTodoDeleteCloseButton')?.addEventListener('click', closeAdminTodoDeleteModal);
      document.getElementById('adminTodoDeleteCancelButton')?.addEventListener('click', closeAdminTodoDeleteModal);
      document.getElementById('adminTodoDeleteConfirmButton')?.addEventListener('click', confirmDeleteAdminTodo);
      document.getElementById('adminTodoModal')?.addEventListener('click', event => {
        if (event.target === event.currentTarget) closeAdminTodoModal();
      });
      document.getElementById('adminTodoDeleteModal')?.addEventListener('click', event => {
        if (event.target === event.currentTarget) closeAdminTodoDeleteModal();
      });
      renderDashboardStudentOptions();
      dashboardAssignmentState.level = '';
      updateDashboardAssignmentFields();
      renderWeekCalendar();
      window.EDUGNAY_PAGE_LOADING.ready();
    });

    function renderWeekCalendar() {
      const grid = document.getElementById('weekCalendarGrid');
      const rangeLabel = document.getElementById('weekRangeLabel');
      if (!grid) return;

      const today = new Date();
      const dayOfWeek = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

      const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      let html = '';

      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const isToday = d.toDateString() === today.toDateString();
        html += `
          <div class="week-day${isToday ? ' is-today' : ''}">
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
    async function openStudentModal() {
      const title = document.getElementById('studentModalTitle');
      title.textContent = 'Assign Students';
      dashboardAssignmentState.student = null;
      dashboardAssignmentState.level = '';
      dashboardAssignmentState.grade = '';
      dashboardAssignmentState.strand = '';
      dashboardAssignmentState.section = '';
      document.getElementById('studentModalBackdrop').classList.add('open');
      setDashboardFeedback('assignStudentFeedback');
      const saveButton = document.getElementById('assignStudentSaveButton');
      if (ADMIN_DASHBOARD_API_ENABLED) {
        saveButton.disabled = true;
        setDashboardFeedback('assignStudentFeedback', 'Loading current students and sections…', 'info');
        try {
          await loadAdminDashboardData();
          if (ADMIN_ASSIGNMENT_ERROR) throw new Error(ADMIN_ASSIGNMENT_ERROR);
          renderAdminDashboard();
          setDashboardFeedback('assignStudentFeedback');
        } catch (error) {
          ADMIN_ASSIGNMENT_ERROR = error.message || 'Student and section choices could not be loaded.';
          setDashboardFeedback('assignStudentFeedback', ADMIN_ASSIGNMENT_ERROR);
        } finally {
          saveButton.disabled = Boolean(ADMIN_ASSIGNMENT_ERROR);
        }
      } else {
        ADMIN_ASSIGNMENT_ERROR = 'Students and sections couldn’t be loaded. Refresh and try again.';
        saveButton.disabled = true;
        setDashboardFeedback('assignStudentFeedback', ADMIN_ASSIGNMENT_ERROR);
      }
      renderDashboardStudentOptions();
      updateDashboardAssignmentFields();
    }

    function closeStudentModal() {
      document.getElementById('studentModalBackdrop').classList.remove('open');
    }

    document.getElementById('studentModalBackdrop').addEventListener('click', function (e) {
      if (e.target === this) closeStudentModal();
    });

    document.getElementById('assignStudentForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      const studentIds = dashboardStudentPicker.getSelectedIds();
      const section = dashboardAssignmentSections().find(item => item.id === dashboardAssignmentState.section);
      if (!studentIds.length || !section || !dashboardAssignmentState.level || !dashboardAssignmentState.grade || (dashboardAssignmentState.level === 'shs' && !dashboardAssignmentState.strand)) {
        setDashboardFeedback('assignStudentFeedback', 'Choose students, school level, grade, and matching section first.');
        return;
      }
      if (section.level !== dashboardAssignmentState.level || dashboardGradeKey(section.grade) !== dashboardGradeKey(dashboardAssignmentState.grade) || (section.level === 'shs' && dashboardGradeKey(section.strand) !== dashboardGradeKey(dashboardAssignmentState.strand))) {
        setDashboardFeedback('assignStudentFeedback', 'The selected section does not match the chosen grade or track.');
        return;
      }

      if (!ADMIN_DASHBOARD_API_ENABLED) {
        setDashboardFeedback('assignStudentFeedback', 'The section assignment couldn’t be saved. Refresh and try again.');
        return;
      }
      const saveButton = document.getElementById('assignStudentSaveButton');
      saveButton.disabled = true;
      dashboardStudentPicker.setDisabled(true);
      setDashboardFeedback('assignStudentFeedback');
      let assignmentSaved = false;
      try {
        if (ADMIN_ASSIGNMENT_ERROR) throw new Error(ADMIN_ASSIGNMENT_ERROR);
        await window.EDUGNAY_API.enrollStudentsBulk(section.id, studentIds);
        assignmentSaved = true;
        closeStudentModal();
        await loadAdminDashboardData();
        renderAdminDashboard();
        renderDashboardStudentOptions();
        showAppToast(ADMIN_ASSIGNMENT_ERROR ? `Student assignments were saved, but section data could not refresh: ${ADMIN_ASSIGNMENT_ERROR}` : `${studentIds.length} student${studentIds.length === 1 ? '' : 's'} assigned to section.`, ADMIN_ASSIGNMENT_ERROR ? 'info' : 'success');
      } catch (error) {
        if (assignmentSaved) showAppToast(`Student assignment was saved, but the dashboard could not refresh: ${error.message || 'reload the page.'}`, 'info');
        else setDashboardFeedback('assignStudentFeedback', error.message || 'The student could not be assigned to this section.');
      } finally {
        saveButton.disabled = false;
        dashboardStudentPicker.setDisabled(false);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      closeStudentModal();
      closeAdminTodoModal();
      closeAdminTodoDeleteModal();
    });

    function openAnnouncementModal() {
      document.getElementById('announcementModalBackdrop').classList.add('open');
    }

    function closeAnnouncementModal() {
      document.getElementById('announcementModalBackdrop').classList.remove('open');
    }

    document.querySelector('.announcement-modal-backdrop').addEventListener('click', function (e) {
      if (e.target === this) closeAnnouncementModal();
    });

    function selectModalPriority(el, value) {
      document.querySelectorAll('.announcement-modal-backdrop .priority-opt').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      document.getElementById('modalPriorityValue').value = value;
    }

    function getDashboardAnnouncementValues(status) {
      const form = document.getElementById('postAnnouncementForm');
      const formData = new FormData(form);
      const audiences = Array.from(form.querySelectorAll('input[name="audience"]:checked')).map(input => input.value);
      const schedule = String(formData.get('schedule') || '');
      const effectiveStatus = status === 'published' && schedule ? 'scheduled' : status;
      const date = schedule ? new Date(`${schedule}:00+08:00`) : null;
      return {
        title: String(formData.get('title') || '').trim(),
        body: String(formData.get('content') || '').trim(),
        priority: String(formData.get('priority') || 'normal') === 'low' ? 'normal' : String(formData.get('priority') || 'normal'),
        audiences: audiences.length ? audiences : ['all'],
        status: effectiveStatus,
        scheduledAt: effectiveStatus === 'scheduled' && date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
        image: form.elements.image?.files?.[0] || null
      };
    }

    function updateDashboardAnnouncementPostLabel() {
      document.querySelector('#announcementModalBackdrop .btn-post span').textContent =
        document.querySelector('#postAnnouncementForm [name="schedule"]').value ? 'Schedule' : 'Post';
    }

    let dashboardAnnouncementSaving = false;

    async function saveDashboardAnnouncement(status) {
      if (dashboardAnnouncementSaving) return false;

      const form = document.getElementById('postAnnouncementForm');
      const values = getDashboardAnnouncementValues(status);
      setDashboardFeedback('announcementFeedback');
      if (!values.title || !values.body) {
        setDashboardFeedback('announcementFeedback', 'Enter an announcement title and content.');
        return false;
      }
      if (values.status === 'scheduled' && (!values.scheduledAt || new Date(values.scheduledAt).getTime() <= Date.now())) {
        setDashboardFeedback('announcementFeedback', 'Choose a future date and time to schedule this announcement.');
        return false;
      }
      if (!ADMIN_DASHBOARD_API_ENABLED) {
        setDashboardFeedback('announcementFeedback', 'The announcement couldn’t be saved. Refresh and try again.');
        return false;
      }

      const modal = form.closest('.modal');
      const postButton = modal.querySelector('button[type="submit"][form="postAnnouncementForm"]');
      const draftButton = modal.querySelector('.btn-draft');
      const buttons = [postButton, draftButton].filter(Boolean);
      const activeButton = status === 'draft' ? draftButton : postButton;
      const activeLabel = activeButton?.querySelector('span');
      const originalLabel = activeLabel?.textContent || (status === 'draft' ? 'Save Draft' : 'Post');
      dashboardAnnouncementSaving = true;
      buttons.forEach(button => { button.disabled = true; });
      if (activeLabel) activeLabel.textContent = status === 'draft' ? 'Saving…' : values.status === 'scheduled' ? 'Scheduling…' : 'Posting…';

      try {
        const savedAnnouncement = await window.EDUGNAY_API.createAnnouncement(values);
        if (!savedAnnouncement) throw new Error('The announcement could not be confirmed as saved. Refresh and check the announcements list.');

        if (window.EDUGNAY_COMMUNICATION?.backend) {
          const announcements = window.EDUGNAY_COMMUNICATION.announcements || [];
          window.EDUGNAY_COMMUNICATION.announcements = [
            savedAnnouncement,
            ...announcements.filter(item => String(item.id) !== String(savedAnnouncement.id))
          ];
        }

        form.reset();
        document.getElementById('composePreview').style.display = 'none';
        document.getElementById('composePlaceholder').style.display = 'flex';
        updateDashboardAnnouncementPostLabel();
        document.getElementById('modalPriorityValue').value = 'normal';
        document.querySelectorAll('#announcementModalBackdrop .priority-opt').forEach(option => {
          option.classList.toggle('selected', option.classList.contains('p-normal'));
        });
        modalAudienceCheckboxes.forEach(input => {
          input.closest('.aud-opt')?.classList.toggle('checked', input.checked);
        });
        const message = values.status === 'draft' ? 'Announcement saved as a draft.'
          : values.status === 'scheduled' ? 'Announcement scheduled.' : 'Announcement posted.';
        showAppToast(message);
        closeAnnouncementModal();
        return true;
      } catch (error) {
        showAppToast(error.message || 'The announcement could not be saved.', 'error');
        return false;
      } finally {
        dashboardAnnouncementSaving = false;
        buttons.forEach(button => { button.disabled = false; });
        if (activeLabel) activeLabel.textContent = originalLabel;
        updateDashboardAnnouncementPostLabel();
      }
    }

    function saveDashboardAnnouncementDraft() {
      saveDashboardAnnouncement('draft').catch(error => {
        showAppToast(error.message || 'The announcement could not be saved.', 'error');
      });
    }

    const modalAudienceCheckboxes = Array.from(
      document.querySelectorAll('#announcementModalBackdrop .aud-opt input[type="checkbox"]')
    );

    modalAudienceCheckboxes.forEach(cb => {
      cb.addEventListener('change', function () {
        if (this.checked && this.value === 'all') {
          modalAudienceCheckboxes
            .filter(other => other !== this)
            .forEach(other => { other.checked = false; });
        } else if (this.checked) {
          const allUsers = modalAudienceCheckboxes.find(other => other.value === 'all');
          if (allUsers) allUsers.checked = false;
        }

        modalAudienceCheckboxes.forEach(input => {
          input.closest('.aud-opt')?.classList.toggle('checked', input.checked);
        });
      });
    });

    document.getElementById('postAnnouncementForm')?.addEventListener('submit', event => {
      event.preventDefault();
      saveDashboardAnnouncement('published').catch(error => {
        showAppToast(error.message || 'The announcement could not be posted.', 'error');
      });
    });

    function handleImagePreview(input, previewWrapId, placeholderId) {
      const file = input.files[0];
      if (!file) return;

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
      document.getElementById(inputId).value = '';
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

    setupDropzone('composeUploadArea', 'composeImageInput', 'composePreview', 'composePlaceholder');

    /* ── RECENT ACTIVITY PREVIEW ──
     The dashboard shows the latest four records from the school activity API. */
    let RECENT_ACTIVITY = [];

    function renderActivityList() {
      const container = document.getElementById('activityList');
      const sorted = [...RECENT_ACTIVITY]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 4);
      const allowedTones = new Set(['blue', 'green', 'red', 'orange', 'purple', 'gold', 'gray']);

      let html = '';
      let lastGroup = null;

      sorted.forEach(item => {
        const group = formatDateGroup(item.createdAt);
        const tone = allowedTones.has(item.tone) ? item.tone : 'blue';
        const icon = /^[a-z0-9-]{1,40}$/.test(item.icon || '') ? item.icon : 'activity';
        if (group !== lastGroup) {
          html += `<div class="activity-group-label">${window.EDUGNAY_CONFIG.escapeHtml(group)}</div>`;
          lastGroup = group;
        }
        html += `
        <div class="activity-item">
        <div class="act-icon ${tone}" aria-hidden="true"><i data-lucide="${icon}" style="width:15px;height:15px;"></i></div>
        <div class="act-body">
          <div class="act-text"><strong>${window.EDUGNAY_CONFIG.escapeHtml(item.actor || 'System')}</strong> ${window.EDUGNAY_CONFIG.escapeHtml(item.title || 'recorded an activity')}${item.detail ? ` · ${window.EDUGNAY_CONFIG.escapeHtml(item.detail)}` : ''}</div>
          <div class="act-time">${window.EDUGNAY_CONFIG.escapeHtml(formatTime(item.createdAt))}</div>
        </div>
        <span class="act-tag">${window.EDUGNAY_CONFIG.escapeHtml(item.type)}</span>
        </div>
      `;
      });

      container.innerHTML = sorted.length
        ? html
        : window.EDUGNAY_CONFIG.renderPanelEmptyState({
          icon: DASHBOARD_ACTIVITY_ERROR ? 'cloud-off' : 'activity',
          title: DASHBOARD_ACTIVITY_ERROR ? 'Activity unavailable' : 'No recent activity',
          text: DASHBOARD_ACTIVITY_ERROR || 'Recorded school and system events will appear here.'
        });
      lucide.createIcons();
    }

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    p031275faef9f: function(event) { updateDashboardAssignmentContext() },
    p086cd0960f21: function(event) { updateDashboardAssignmentFields('strand') },
    p1198e2be8781: function(event) { updateDashboardAssignmentFields('level') },
    p5c1b2129d6b6: function(event) { updateDashboardAssignmentFields('grade') },
    p7c0a49226afc: function(event) { handleImagePreview(this, 'composePreview', 'composePlaceholder') },
  },
  click: {
    p2c4afe7396a7: function(event) { removeImage(event, 'composeImageInput', 'composePreview', 'composePlaceholder') },
    p408a5d5d9181: function(event) { selectModalPriority(this, 'normal') },
    p422deaca1e8a: function(event) { selectModalPriority(this, 'high') },
    p44b0033e7aac: function(event) { closeStudentModal() },
    p47e85e859299: function(event) { openStudentModal(); },
    p53ab2691fe3c: function(event) { closeAnnouncementModal() },
    p959e806bc2cf: function(event) { openAnnouncementModal(); return false; },
    pa0e32145b14f: function(event) { selectModalPriority(this, 'event') },
    pc4d411e4dda3: function(event) { document.getElementById('composeImageInput').click() },
    pd90f0e92cdd3: function(event) { selectModalPriority(this, 'low') },
    pe4d9cd244225: function(event) { saveDashboardAnnouncementDraft() },
  },
  input: {
    pdf3941bcd03d: function(event) { updateDashboardAnnouncementPostLabel() },
  },
});
