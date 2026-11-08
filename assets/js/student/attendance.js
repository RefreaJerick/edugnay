lucide.createIcons();
    let attendanceHistory;

    async function loadAttendance() {
      attendanceHistory.setLoading();
      try {
        await window.EDUGNAY_SCHOOL_READY;
        if (window.EDUGNAY_CONFIG?.isAttendanceEnabled?.() === false) {
          window.location.replace('./edugnay-student-dashboard.html');
          return;
        }
        if (!window.EDUGNAY_API?.isBackendAvailable) throw new Error('Attendance isn’t available right now. Refresh and try again.');
        const data = await window.EDUGNAY_API.getStudentAttendance();
        const date = data?.currentDate;
        const parsed = new Date(date + 'T00:00:00Z');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime())
          || parsed.toISOString().slice(0, 10) !== date || !Array.isArray(data.records)) {
          throw new Error('Attendance information could not be loaded. Refresh and try again.');
        }
        attendanceHistory.setRecords(data.records, date);
      } catch (error) {
        attendanceHistory.setError(error.message || 'Attendance could not be loaded.');
      }
    }

    document.addEventListener('DOMContentLoaded', async () => {
      attendanceHistory = window.createAttendanceHistory();
      await loadAttendance();
      window.EDUGNAY_PAGE_LOADING.ready();
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    p880dd8881704: function(event) { loadAttendance() },
  },
});
