(function () {
  function createStudentMultiSelect(root, onChange) {
    const trigger = root.querySelector('[data-student-trigger]');
    const dropdown = root.querySelector('[data-student-dropdown]');
    const summary = root.querySelector('[data-student-summary]');
    const search = root.querySelector('[data-student-search]');
    const list = root.querySelector('[data-student-list]');
    const clear = root.querySelector('[data-student-clear]');
    const done = root.querySelector('[data-student-done]');
    let students = [];
    const selected = new Set();

    function renderSelection() {
      summary.textContent = selected.size ? `${selected.size} student${selected.size === 1 ? '' : 's'} selected` : 'Select students';
      clear.disabled = !selected.size || trigger.disabled;
    }

    function close(focusTrigger = false) {
      dropdown.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (focusTrigger) trigger.focus();
    }

    function open() {
      if (trigger.disabled) return;
      search.value = '';
      render();
      dropdown.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      search.focus();
    }

    function render() {
      const query = search.value.trim().toLowerCase();
      const visible = students.filter(student => `${student.displayName} ${student.schoolEmail}`.toLowerCase().includes(query));
      list.replaceChildren();
      list.classList.toggle('is-empty', !visible.length);
      for (const student of visible) {
        const label = document.createElement('label');
        label.className = 'student-multi-option';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = String(student.id);
        checkbox.checked = selected.has(String(student.id));
        checkbox.addEventListener('change', () => {
          if (checkbox.checked && selected.size >= 100) {
            checkbox.checked = false;
            summary.textContent = '100 students selected (maximum)';
            return;
          }
          if (checkbox.checked) selected.add(checkbox.value);
          else selected.delete(checkbox.value);
          renderSelection();
          onChange?.(getSelectedIds());
        });
        const copy = document.createElement('span');
        copy.className = 'student-multi-identity';
        const name = document.createElement('strong');
        name.textContent = student.displayName;
        const email = document.createElement('span');
        email.textContent = student.schoolEmail;
        copy.append(name, email);
        const avatar = document.createElement('span');
        avatar.className = 'student-multi-avatar';
        window.EDUGNAY_AVATAR.render(avatar, { ...student, role: 'student' });
        label.append(checkbox, avatar, copy);
        list.append(label);
      }
      if (!visible.length) {
        const empty = document.createElement('p');
        empty.className = 'student-multi-empty';
        empty.textContent = query ? 'No students match your search.' : 'No unassigned students available.';
        list.append(empty);
      }
      renderSelection();
    }

    function getSelectedIds() { return [...selected].map(Number); }
    trigger.addEventListener('click', () => { if (dropdown.hidden) open(); else close(); });
    search.addEventListener('input', render);
    search.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
    clear.addEventListener('click', () => {
      selected.clear();
      render();
      onChange?.(getSelectedIds());
    });
    done.addEventListener('click', () => close(true));
    document.addEventListener('click', event => { if (!dropdown.hidden && !root.contains(event.target)) close(); });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || dropdown.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }, true);
    return {
      getSelectedIds,
      setStudents(records, preselectedId = '') {
        students = records;
        selected.clear();
        if (preselectedId && students.some(item => String(item.id) === String(preselectedId))) selected.add(String(preselectedId));
        search.value = '';
        render();
        close();
        onChange?.(getSelectedIds());
      },
      setDisabled(disabled) {
        trigger.disabled = disabled;
        search.disabled = disabled;
        list.querySelectorAll('input').forEach(input => { input.disabled = disabled; });
        clear.disabled = disabled || !selected.size;
        done.disabled = disabled;
        if (disabled) close();
      }
    };
  }

  window.createStudentMultiSelect = createStudentMultiSelect;
})();
