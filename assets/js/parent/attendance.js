lucide.createIcons();

    let attendanceHistory;
    let parentChildren = [];
    let attendanceRecords = [];
    let currentChild = null;
    let schoolDate = '';

    function renderChildSwitcher() {
      const switcher = document.getElementById('child-switcher');
      switcher.innerHTML = parentChildren.length
        ? parentChildren.map(child => '<button class="child-card ' + (child.studentId === currentChild ? 'active' : '') +
          '" data-child="' + window.EDUGNAY_CONFIG.escapeHtml(child.studentId) + '" type="button">' +
          window.EDUGNAY_AVATAR.html(child, { className: 'child-avatar', role: 'student' }) +
          '<span class="child-info"><span class="child-name">' + window.EDUGNAY_CONFIG.escapeHtml(child.displayName || 'Student') +
          '</span><span class="child-section">' + window.EDUGNAY_CONFIG.escapeHtml(child.gradeLevel || 'Unassigned') +
          ' – ' + window.EDUGNAY_CONFIG.escapeHtml(child.sectionName || 'Unassigned') + '</span></span></button>').join('')
        : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'users', title: 'No linked children', text: 'Children linked to this parent account will appear here.' });
      lucide.createIcons();
    }

    function switchChild(studentId) {
      if (!parentChildren.some(child => child.studentId === studentId)) return;
      currentChild = studentId;
      renderChildSwitcher();
      attendanceHistory.setRecords(attendanceRecords.filter(record => record.studentId === studentId), schoolDate);
    }

    async function loadAttendance() {
      attendanceHistory.setLoading();
      document.getElementById('child-switcher').innerHTML = '';
      try {
        if (!window.EDUGNAY_API?.isBackendAvailable) throw new Error('The attendance API is not configured.');
        const children = await window.EDUGNAY_API.getParentChildren();
        const data = await window.EDUGNAY_API.getParentAttendance();
        const date = data?.currentDate;
        const parsed = new Date(date + 'T00:00:00Z');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime())
          || parsed.toISOString().slice(0, 10) !== date || !Array.isArray(data.records)) {
          throw new Error('The attendance response is incomplete. Please try again.');
        }
        parentChildren = children.map(child => ({ ...child, studentId: String(child.studentId) }));
        attendanceRecords = data.records.map(record => ({ ...record, studentId: String(record.studentId) }));
        schoolDate = date;
        currentChild = parentChildren[0]?.studentId || null;
        renderChildSwitcher();
        attendanceHistory.setRecords(attendanceRecords.filter(record => record.studentId === currentChild), schoolDate, Boolean(currentChild));
      } catch (error) {
        parentChildren = [];
        attendanceRecords = [];
        currentChild = null;
        schoolDate = '';
        document.getElementById('child-switcher').replaceChildren();
        attendanceHistory.setError(error.message || 'Attendance could not be loaded.');
      }
    }

    document.addEventListener('DOMContentLoaded', async () => {
      attendanceHistory = window.createAttendanceHistory({ hasSelection: false });
      const switcher = document.getElementById('child-switcher');
      switcher.addEventListener('click', event => {
        const card = event.target.closest('.child-card');
        if (card && switcher.contains(card)) switchChild(card.dataset.child);
      });
      await loadAttendance();
      window.EDUGNAY_PAGE_LOADING.ready();
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    p880dd8881704: function(event) { loadAttendance() },
  },
});
