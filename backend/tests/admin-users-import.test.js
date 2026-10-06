const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-users.html'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
const submitBody = html.split("document.getElementById('importUsersForm').addEventListener('submit', async function (e) {")[1]
  .split('\n    });')[0];

function importHarness(importUsers, loadManagedUsers = async () => {}) {
  const file = { name: 'students.csv' };
  const elements = {
    importUsersFileInput: { files: [file] },
    importUsersSubmitBtn: { disabled: false, textContent: 'Import Accounts' },
    importUsersStatus: { hidden: true },
    searchInput: { value: 'previous' },
    statusFilter: { value: 'inactive' },
    gradeLevelFilter: { value: 'Grade 7' },
    sectionFilter: { value: 'section-1' },
    sortDateAdded: { textContent: '' }
  };
  const roleButtons = [{ disabled: false }, { disabled: false }, { disabled: false }];
  const calls = [];
  const context = vm.createContext({
    importSubmitting: false,
    usersApiActive: true,
    usersLoading: false,
    usersLoadError: '',
    importState: { role: 'stud', validation: { errors: [], accountRecords: [{}], records: [{ rowNumber: 2, errors: [] }] } },
    ROLE_OPT_TO_TABLE: { stud: 'student' },
    dateSortOrder: 'asc',
    currentPage: 3,
    window: { EDUGNAY_API: { importUsers: (...args) => { calls.push(['import', ...args]); return importUsers(...args); } } },
    document: {
      getElementById: id => elements[id],
      querySelector: selector => selector === '.rs-card.stud' ? {} : null,
      querySelectorAll: selector => selector.startsWith('#importRoleOpts') ? roleButtons : []
    },
    closeImportModal: () => calls.push(['close']),
    loadManagedUsers: async () => { calls.push(['reload']); await loadManagedUsers(context); },
    filterRole: role => calls.push(['filter', role]),
    showAppToast: (...args) => calls.push(['toast', ...args]),
    renderImportPreview: () => calls.push(['preview'])
  });
  vm.runInContext(`async function submit(e) {${submitBody}\n}`, context);
  return { context, elements, roleButtons, calls, file, submit: () => context.submit({ preventDefault() {} }) };
}

test('CSV import sends the original file and role through the multipart API', async () => {
  const source = shell.split('async function importApiUsers(file, role) {')[1]
    .split('async function updateApiUser')[0];
  const sent = [];
  class FormDataStub {
    append(name, value) { sent.push([name, value]); }
  }
  const context = vm.createContext({
    FormData: FormDataStub,
    requestApiMultipart: (url, form) => ({ url, form })
  });
  vm.runInContext(`async function importApiUsers(file, role) {${source}`, context);
  const file = { name: 'students.csv' };
  const result = await context.importApiUsers(file, 'student');
  assert.equal(result.url, '/users/import');
  assert.deepEqual(sent, [['csvFile', file], ['role', 'student']]);
  assert.match(shell, /importUsers:\s*importApiUsers/);
});

test('backend import reloads and reveals the new students without local demo credentials', async () => {
  const harness = importHarness(async () => ({ summary: { accountsCreated: 10, emailDelivery: { not_configured: 10 } } }));
  await harness.submit();
  assert.equal(harness.calls[0][0], 'import');
  assert.equal(harness.calls[0][1], harness.file);
  assert.equal(harness.calls[0][2], 'student');
  assert.deepEqual(harness.calls.map(call => call[0]), ['import', 'close', 'reload', 'filter', 'toast']);
  assert.equal(harness.elements.searchInput.value, '');
  assert.equal(harness.elements.statusFilter.value, 'all');
  assert.match(harness.calls.at(-1)[1], /10 account\(s\) imported/);
  assert.doesNotMatch(submitBody, /EDUGNAY_CONFIG\.importUsers|openCredentialDeliveryModal/);
});

test('server row errors stay in the CSV preview and do not claim success', async () => {
  const error = Object.assign(new Error('Correct the CSV errors and import again. No accounts were created.'), {
    status: 422,
    data: { rows: [{ rowNumber: 2, errors: ['lrn must be unique.'] }] }
  });
  const harness = importHarness(async () => { throw error; });
  await harness.submit();
  assert.deepEqual(harness.calls.map(call => call[0]), ['import', 'preview']);
  assert.equal(harness.context.importState.validation.records[0].errors[0], 'lrn must be unique.');
  assert.match(harness.elements.importUsersStatus.textContent, /No accounts were created/);
  assert.equal(harness.elements.importUsersSubmitBtn.disabled, true);
  assert.equal(harness.elements.importUsersFileInput.files[0], harness.file);
  assert.equal(harness.elements.importUsersFileInput.disabled, false);
});

test('backend failure never falls back to local import', async () => {
  const harness = importHarness(async () => { throw new Error('The server is unavailable.'); });
  await harness.submit();
  assert.deepEqual(harness.calls.map(call => call[0]), ['import', 'preview']);
  assert.match(harness.elements.importUsersStatus.textContent, /server is unavailable/);
  assert.match(harness.elements.importUsersStatus.textContent, /Check the user list before trying again/);
  harness.context.usersApiActive = false;
  await harness.submit();
  assert.equal(harness.calls.filter(call => call[0] === 'import').length, 1);
});

test('a second submit is ignored while the import is running', async () => {
  let resolveImport;
  const harness = importHarness(() => new Promise(resolve => { resolveImport = resolve; }));
  const first = harness.submit();
  await harness.submit();
  assert.equal(harness.calls.filter(call => call[0] === 'import').length, 1);
  assert.equal(harness.elements.importUsersFileInput.disabled, true);
  assert.ok(harness.roleButtons.every(button => button.disabled));
  resolveImport({ summary: { accountsCreated: 1, emailDelivery: { sent: 1 } } });
  await first;
  assert.equal(harness.elements.importUsersFileInput.disabled, false);
});

test('a successful import is not retried when the list refresh fails', async () => {
  const harness = importHarness(async () => ({ summary: { accountsCreated: 1 } }), async context => {
    context.usersLoadError = 'The server is unavailable.';
  });
  await harness.submit();
  assert.deepEqual(harness.calls.map(call => call[0]), ['import', 'close', 'reload', 'toast']);
  assert.match(harness.calls.at(-1)[1], /Do not import the file again/);
});

test('import controls require the backend and disallow administrator CSVs', () => {
  assert.match(html, /id="importUsersButton"[^>]*disabled/);
  assert.match(html, /data-role="adm"[^>]*disabled[^>]*selectImportRole\('adm'\)/);
  assert.match(html, /function openImportModal\(\) \{\s*if \(!usersApiActive \|\| usersLoading \|\| usersLoadError\)/);
});

test('refreshed accounts follow the selected Date Added order', () => {
  const sorting = html.split('function sortUsersByDate() {')[1]
    .split("document.getElementById('sortDateAdded')")[0];
  const context = vm.createContext({
    USERS: [
      { name: 'older', createdAt: '2026-10-01T00:00:00Z' },
      { name: 'newer', createdAt: '2026-10-06T00:00:00Z' }
    ],
    dateSortOrder: 'desc'
  });
  vm.runInContext(`function sortUsersByDate() {${sorting}`, context);
  context.sortUsersByDate();
  assert.equal(context.USERS[0].name, 'newer');
  context.dateSortOrder = 'asc';
  context.sortUsersByDate();
  assert.equal(context.USERS[0].name, 'older');
  assert.match(html, /USERS = users;\s*sortUsersByDate\(\);/);
});
