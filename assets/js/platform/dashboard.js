const PLATFORM = window.EDUGNAY_PLATFORM;
    let PLATFORM_DASHBOARD_TODOS = [];
    let PLATFORM_DASHBOARD_ACTIVITY = [];
    let PLATFORM_ACTIVITY_ERROR = '';

    function renderPlatformWeek() {
      const grid = document.getElementById('weekCalendarGrid');
      const rangeLabel = document.getElementById('weekRangeLabel');
      if (!grid) return;

      const today = new Date();
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

      grid.innerHTML = labels.map((label, index) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + index);
        const isToday = date.toDateString() === today.toDateString();
        return `<div class="week-day${isToday ? ' is-today' : ''}"><span class="week-day-label">${label}</span><span class="week-day-num">${date.getDate()}</span></div>`;
      }).join('');

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const dateLabel = date => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (rangeLabel) {
        rangeLabel.textContent = `${dateLabel(monday)} to ${dateLabel(sunday)}`;
        rangeLabel.dataset.currentDate = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        rangeLabel.parentElement.dataset.currentDate = rangeLabel.dataset.currentDate;
      }
    }

    function renderPlatformActivity() {
      const activityList = document.getElementById('platform-activity-list');
      if (!activityList) return;
      const activities = PLATFORM_DASHBOARD_ACTIVITY.slice().sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
      let lastGroup = '';
      let activityHtml = '';

      activities.forEach(activity => {
        const group = formatDateGroup(activity.createdAt);
        if (group !== lastGroup) {
          activityHtml += `<div class="activity-group-label">${group}</div>`;
          lastGroup = group;
        }
        const schoolName = String(activity.schoolName || '');
        const schoolContext = schoolName && schoolName.toLocaleLowerCase() !== String(activity.actor || '').toLocaleLowerCase()
          && !String(activity.detail || '').toLocaleLowerCase().includes(schoolName.toLocaleLowerCase()) ? schoolName : '';
        const detail = [activity.detail, schoolContext].filter(Boolean).join(' · ');
        activityHtml += `<div class="activity-item"><div class="act-icon ${escapeHtml(activity.tone)}"><i data-lucide="${escapeHtml(activity.icon)}" style="width:15px;height:15px;"></i></div><div class="act-body"><div class="act-text"><strong>${escapeHtml(activity.actor || 'System')}</strong> ${escapeHtml(activity.title || 'recorded an activity')}${detail ? ` · ${escapeHtml(detail)}` : ''}</div><div class="act-time">${escapeHtml(formatTime(activity.createdAt))}</div></div><span class="act-tag">${escapeHtml(activity.type)}</span></div>`;
      });
      activityList.innerHTML = activities.length
        ? activityHtml
        : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: PLATFORM_ACTIVITY_ERROR ? 'cloud-off' : 'activity', title: PLATFORM_ACTIVITY_ERROR ? 'Activity unavailable' : 'No school account activity yet', text: PLATFORM_ACTIVITY_ERROR || 'School registrations and access changes will appear here.' });
    }

    function getPlatformTodos() {
      return Array.isArray(PLATFORM_DASHBOARD_TODOS) ? PLATFORM_DASHBOARD_TODOS : [];
    }

    async function loadPlatformTodos() {
      try {
        PLATFORM_DASHBOARD_TODOS = await window.EDUGNAY_API.getTasks();
        if (window.EDUGNAY_COMMUNICATION?.backend) window.EDUGNAY_COMMUNICATION.tasks = PLATFORM_DASHBOARD_TODOS;
        setPlatformFeedback('platformTodoListFeedback');
      } catch (error) {
        PLATFORM_DASHBOARD_TODOS = [];
        setPlatformFeedback('platformTodoListFeedback', error.message || 'Platform tasks could not be loaded.');
      }
    }

    function setPlatformFeedback(id, message = '', type = 'error') {
      const feedback = document.getElementById(id);
      if (!feedback) return;
      feedback.textContent = message;
      feedback.hidden = !message;
      feedback.classList.toggle('is-error', type === 'error');
      feedback.classList.toggle('is-success', type === 'success');
      feedback.classList.toggle('is-info', type === 'info');
    }

    async function refreshPlatformTasks(fallback = {}) {
      try {
        const tasks = await window.EDUGNAY_API.getTasks();
        if (fallback.task && !tasks.some(item => item.id === fallback.task.id)) throw new Error('The saved task was not returned by the task list.');
        if (fallback.removedId && tasks.some(item => item.id === String(fallback.removedId))) throw new Error('The deleted task is still returned by the task list.');
        PLATFORM_DASHBOARD_TODOS = tasks;
        if (window.EDUGNAY_COMMUNICATION?.backend) window.EDUGNAY_COMMUNICATION.tasks = PLATFORM_DASHBOARD_TODOS;
        setPlatformFeedback('platformTodoListFeedback');
      } catch (error) {
        if (fallback.task) {
          const index = getPlatformTodos().findIndex(item => item.id === fallback.task.id);
          if (index >= 0) PLATFORM_DASHBOARD_TODOS[index] = fallback.task;
          else PLATFORM_DASHBOARD_TODOS = [...getPlatformTodos(), fallback.task];
        }
        if (fallback.removedId) PLATFORM_DASHBOARD_TODOS = getPlatformTodos().filter(item => item.id !== String(fallback.removedId));
        const message = fallback.removedId
          ? `The task was deleted, but the list could not refresh: ${error.message || 'Please reload the page.'}`
          : fallback.task
            ? `The task was saved, but the list could not refresh: ${error.message || 'Please reload the page.'}`
            : `Tasks could not be loaded: ${error.message || 'Please reload the page.'}`;
        setPlatformFeedback('platformTodoListFeedback', message, fallback.task || fallback.removedId ? 'info' : 'error');
      }
      renderPlatformTodos();
    }

    function openPlatformTodoModal(todoId = null) {
      const modal = document.getElementById('platformTodoModal');
      const form = document.getElementById('platformTodoForm');
      if (!modal || !form) return;
      form.reset();
      setPlatformFeedback('platformTodoFeedback');
      const todo = todoId
        ? getPlatformTodos().find(item => item.id === String(todoId))
        : null;
      document.getElementById('platformTodoId').value = todo?.id || '';
      document.getElementById('platformTodoTitle').value = todo?.title || '';
      document.getElementById('platformTodoDueDate').value = todo?.dueDate || '';
      document.getElementById('platformTodoModalTitle').textContent = todo ? 'Edit task' : 'Add task';
      document.getElementById('platformTodoSaveButton').textContent = todo ? 'Save changes' : 'Add task';
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.getElementById('platformTodoTitle').focus();
    }

    function closePlatformTodoModal() {
      const modal = document.getElementById('platformTodoModal');
      if (!modal) return;
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }

    async function savePlatformTodo(event) {
      event?.preventDefault();
      if (!window.EDUGNAY_API?.isBackendAvailable) {
        setPlatformFeedback('platformTodoFeedback', 'The backend is required to save tasks.');
        return false;
      }
      const todoId = document.getElementById('platformTodoId').value;
      const titleInput = document.getElementById('platformTodoTitle');
      const title = titleInput.value.trim();
      const dueDate = document.getElementById('platformTodoDueDate').value || null;
      titleInput.setCustomValidity(title ? '' : 'Enter a task title.');
      if (!titleInput.reportValidity()) return false;
      const button = document.getElementById('platformTodoSaveButton');
      button.disabled = true;
      button.textContent = 'Saving…';
      setPlatformFeedback('platformTodoFeedback');

      try {
        const task = todoId
          ? await window.EDUGNAY_API.updateTask(todoId, { title, dueDate })
          : await window.EDUGNAY_API.createTask({ title, dueDate });
        closePlatformTodoModal();
        await refreshPlatformTasks({ task });
        showAppToast(todoId ? 'Task updated.' : 'Task added.');
        return false;
      } catch (error) {
        showAppToast(error?.message || 'The task could not be saved.', 'error');
        return false;
      } finally {
        button.disabled = false;
        button.textContent = todoId ? 'Save changes' : 'Add task';
      }

      closePlatformTodoModal();
      renderPlatformTodos();
      return false;
    }

    async function togglePlatformTodo(todoId, checkbox) {
      if (!window.EDUGNAY_API?.isBackendAvailable) {
        setPlatformFeedback('platformTodoListFeedback', 'The backend is required to update tasks.');
        renderPlatformTodos();
        return;
      }
      const todo = getPlatformTodos().find(item => item.id === String(todoId));
      if (!todo) return;
      const completed = todo.status !== 'completed';
      try {
        if (checkbox) checkbox.disabled = true;
        const task = await window.EDUGNAY_API.updateTask(todo.id, {
          status: completed ? 'completed' : 'pending'
        });
        await refreshPlatformTasks({ task });
        showAppToast(completed ? 'Task completed.' : 'Task reopened.');
        return;
      } catch (error) {
        showAppToast(error?.message || 'The task status could not be updated.', 'error');
        renderPlatformTodos();
        return;
      }
      renderPlatformTodos();
    }

    function openPlatformTodoDeleteModal(todoId) {
      const todo = getPlatformTodos().find(item => item.id === String(todoId));
      const modal = document.getElementById('platformTodoDeleteModal');
      if (!todo || !modal) return;
      setPlatformFeedback('platformTodoDeleteFeedback');
      document.getElementById('platformTodoDeleteId').value = todo.id;
      document.getElementById('platformTodoDeleteName').textContent = `“${todo.title}”`;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      lucide.createIcons();
    }

    function closePlatformTodoDeleteModal() {
      const modal = document.getElementById('platformTodoDeleteModal');
      if (!modal) return;
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.getElementById('platformTodoDeleteId').value = '';
    }

    async function confirmDeletePlatformTodo() {
      if (!window.EDUGNAY_API?.isBackendAvailable) {
        setPlatformFeedback('platformTodoDeleteFeedback', 'The backend is required to delete tasks.');
        return;
      }
      const todoId = document.getElementById('platformTodoDeleteId').value;
      if (!todoId) return;
      const button = document.getElementById('platformTodoDeleteConfirmButton');
      button.disabled = true;
      button.textContent = 'Deleting…';
      setPlatformFeedback('platformTodoDeleteFeedback');
      try {
        await window.EDUGNAY_API.deleteTask(todoId);
        closePlatformTodoDeleteModal();
        await refreshPlatformTasks({ removedId: todoId });
        showAppToast('Task deleted.');
        return;
      } catch (error) {
        showAppToast(error?.message || 'The task could not be deleted.', 'error');
        return;
      } finally {
        button.disabled = false;
        button.textContent = 'Yes, Delete';
      }
      closePlatformTodoDeleteModal();
      renderPlatformTodos();
    }

    function renderPlatformTodos() {
      const list = document.getElementById('platform-todo-list');
      if (!list) return;

      const todos = getPlatformTodos()
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
              ${completed ? 'checked' : ''} data-page-change="${window.EDUGNAY_PAGE_EVENTS.register('change', function(event) { togglePlatformTodo(String(todo.id), this) })}">
            <div class="todo-copy">
              <div class="todo-title">${window.EDUGNAY_CONFIG.escapeHtml(todo.title)}</div>
              ${dueDate ? `<div class="todo-due">Due ${dueDate}</div>` : ''}
            </div>
            <div class="todo-actions">
              <button type="button" aria-label="Edit ${window.EDUGNAY_CONFIG.escapeHtml(todo.title)}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openPlatformTodoModal(String(todo.id)) })}">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" aria-label="Delete ${window.EDUGNAY_CONFIG.escapeHtml(todo.title)}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openPlatformTodoDeleteModal(String(todo.id)) })}">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </div>`;
      }).join('');
      lucide.createIcons();
    }

    async function renderPlatformDashboard() {
      const summaryCards = document.getElementById('platform-summary-cards');
      const schoolList = document.getElementById('platform-school-list');
      if (window.EDUGNAY_API?.isBackendAvailable) {
        summaryCards.innerHTML = '';
        schoolList.innerHTML = '';
        document.getElementById('platform-activity-list').innerHTML = '';
      }

      let schools = [];
      try {
        if (window.EDUGNAY_API?.isBackendAvailable) {
          const session = await window.EDUGNAY_API.getCurrentUser();
          if (session?.role !== 'platform_admin') throw new Error('This dashboard requires a platform administrator session.');
          const greeting = document.getElementById('platform-welcome');
          if (greeting) greeting.textContent = `Welcome back, ${session.firstName || 'Platform Admin'}!`;
        }
        schools = await PLATFORM.getSchoolRecords();
        const summary = PLATFORM.getDashboardSummary(schools);
        summaryCards.innerHTML = summary.map(card => `
          <article class="stat-card ${escapeHtml(card.tone)}">
            <div class="stat-card-top"><div class="stat-card-icon"><i data-lucide="${escapeHtml(card.icon)}" style="width:20px;height:20px;"></i></div></div>
            <div class="stat-card-num">${card.value}</div><div class="stat-card-label">${escapeHtml(card.label)}</div><div class="stat-card-sub">${escapeHtml(card.sub)}</div>
          </article>`).join('');

        schoolList.innerHTML = schools.length ? schools.slice(0, 4).map(school => {
          const status = String(school.platformStatus || 'inactive');
          const safeStatus = escapeHtml(status);
          const type = escapeHtml(school.typeLabel || school.schoolType);
          return `<article class="school-directory-row">
            <div class="school-identity"><div class="school-logo${school.logoUrl ? ' has-logo' : ''}" aria-hidden="true">${school.logoUrl ? `<img src="${escapeHtml(school.logoUrl)}" alt="" data-page-error="g9dff60b1ca61">` : ''}<i data-lucide="building-2" style="width:16px;height:16px;"></i></div><div><div class="school-name">${escapeHtml(school.name)}</div><div class="school-meta">${type} · ${escapeHtml(school.schoolYear || 'School year not set')}</div></div></div>
            <div class="school-admin"><strong>${escapeHtml(school.administrator)}</strong><br>${escapeHtml(school.administratorSchoolEmail)}</div>
            <div><span class="school-status ${safeStatus}"><i data-lucide="${status === 'active' ? 'circle-check-big' : status === 'pending' ? 'clock-3' : 'circle-x'}" style="width:13px;height:13px;"></i>${safeStatus}</span></div>
          </article>`;
        }).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'school', title: 'No school accounts yet', text: 'Registered schools will appear here for platform administration.' });
      } catch (error) {
        const state = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'School records unavailable', text: error.message || 'Try again after the connection is restored.' });
        summaryCards.innerHTML = state;
        schoolList.innerHTML = state;
      }

      try {
        PLATFORM_DASHBOARD_ACTIVITY = await PLATFORM.getActivityRecords();
        PLATFORM_ACTIVITY_ERROR = '';
      } catch (error) {
        PLATFORM_DASHBOARD_ACTIVITY = [];
        PLATFORM_ACTIVITY_ERROR = error.message || 'Try again after the connection is restored.';
      }
      renderPlatformActivity();

      const quickActions = Array.isArray(PLATFORM.quickActions) ? PLATFORM.quickActions : [];
      document.getElementById('platform-quick-actions').innerHTML = quickActions.length
        ? quickActions.map(action => `
          <a class="qa-item" href="${action.href}"><div class="qa-icon"><i data-lucide="${action.icon}" style="width:18px;height:18px;"></i></div><div class="qa-text"><div class="qa-title">${action.title}</div><div class="qa-desc">${action.desc}</div></div><div class="qa-arrow"><i data-lucide="chevron-right" style="width:18px;height:18px;"></i></div></a>`).join('')
        : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'zap-off', title: 'No quick actions', text: 'Available shortcuts will appear here when they are configured.' });

      if (window.lucide) window.lucide.createIcons();
    }

    document.addEventListener('DOMContentLoaded', async () => {
      try {
        await renderPlatformDashboard();
        await loadPlatformTodos();
      } catch (error) {
        showAppToast(error?.message || 'The platform dashboard could not be loaded.', 'error');
      }
      renderPlatformTodos();
      renderPlatformWeek();
      document.getElementById('addPlatformTodoButton')?.addEventListener('click', () => openPlatformTodoModal());
      document.getElementById('platformTodoForm')?.addEventListener('submit', savePlatformTodo);
      document.getElementById('platformTodoCloseButton')?.addEventListener('click', closePlatformTodoModal);
      document.getElementById('platformTodoCancelButton')?.addEventListener('click', closePlatformTodoModal);
      document.getElementById('platformTodoDeleteCloseButton')?.addEventListener('click', closePlatformTodoDeleteModal);
      document.getElementById('platformTodoDeleteCancelButton')?.addEventListener('click', closePlatformTodoDeleteModal);
      document.getElementById('platformTodoDeleteConfirmButton')?.addEventListener('click', confirmDeletePlatformTodo);
      document.getElementById('platformTodoModal')?.addEventListener('click', event => {
        if (event.target === event.currentTarget) closePlatformTodoModal();
      });
      document.getElementById('platformTodoDeleteModal')?.addEventListener('click', event => {
        if (event.target === event.currentTarget) closePlatformTodoDeleteModal();
      });
      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        closePlatformTodoModal();
        closePlatformTodoDeleteModal();
      });
      window.EDUGNAY_PAGE_LOADING.ready();
      await window.EDUGNAY_PLATFORM_COMMUNICATION_READY;
      PLATFORM.renderTopbarNotifs();
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  error: {
    g9dff60b1ca61: function(event) { this.parentElement.classList.remove('has-logo'); this.remove(); },
  },
});
