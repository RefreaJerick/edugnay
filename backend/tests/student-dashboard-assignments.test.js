const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../assets/js/student/dashboard.js'), 'utf8').replace(/\r\n/g, '\n');
const start = script.indexOf('async function loadDashboardAssignments() {');
const end = script.indexOf('\n    function renderStudentDashboardLists()', start);
assert.ok(start >= 0 && end > start, 'student dashboard assignment loader should be available');
const loader = script.slice(start, end);

async function loadDashboardAssignments(assignments) {
  const context = vm.createContext({ window: {
    EDUGNAY_API: { getAssignments: async () => assignments }
  } });
  vm.runInContext(`
    let ASSIGNMENTS_LOADING = false;
    let UPCOMING_ASSIGNMENTS = [];
    let ASSIGNMENTS_ERROR = '';
    ${loader}
    globalThis.load = loadDashboardAssignments;
    globalThis.result = () => UPCOMING_ASSIGNMENTS.map(item => ({ title: item.title, status: item.status }));
  `, context);
  await context.load();
  return JSON.parse(JSON.stringify(context.result()));
}

test('student dashboard shows recent Late statuses before upcoming work', async () => {
  const result = await loadDashboardAssignments([
    { id: 'manual-late', title: 'Manual Late', status: 'published', submissionStatus: 'late', statusUpdatedAt: '2026-11-08T11:00:00', dueDate: null, schoolCurrentDate: '2026-11-08' },
    { id: 'upload-late', title: 'Late upload', status: 'published', submissionStatus: 'late', statusUpdatedAt: '2026-11-07T11:00:00', dueDate: '2026-11-07', schoolCurrentDate: '2026-11-08' },
    { id: 'old-late', title: 'Old Late', status: 'published', submissionStatus: 'late', statusUpdatedAt: '2026-11-01T11:00:00', dueDate: '2026-10-31', schoolCurrentDate: '2026-11-08' },
    { id: 'overdue', title: 'Not submitted', status: 'published', submissionStatus: 'not_submitted', dueDate: '2026-11-07', schoolCurrentDate: '2026-11-08' },
    { id: 'today', title: 'Due today', status: 'published', submissionStatus: 'pending', dueDate: '2026-11-08', schoolCurrentDate: '2026-11-08' },
    { id: 'tomorrow', title: 'Due tomorrow', status: 'published', submissionStatus: 'submitted', dueDate: '2026-11-09', schoolCurrentDate: '2026-11-08' }
  ]);

  assert.deepEqual(result, [
    { title: 'Manual Late', status: 'late' },
    { title: 'Late upload', status: 'late' },
    { title: 'Due today', status: 'pending' }
  ]);
});
