const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const usersHtml = read('views/admin/edugnay-admin-users.html');
const usersCss = read('assets/css/admin/users.css');
const usersJs = read('assets/js/admin/users.js');
const announcementsHtml = read('views/admin/edugnay-admin-announcements.html');
const themeCss = read('assets/css/theme.css');
const modalCss = read('assets/css/modal-system.css');

test('destructive account buttons use danger styling while reactivation stays green', () => {
  assert.match(usersHtml, /class="btn btn-danger" id="deactivateConfirmBtn"/);
  assert.match(usersHtml, /id="deleteUserConfirmButton"[^>]*class="btn btn-danger"/);
  assert.match(usersJs, /btn\.classList\.remove\('btn-save', 'success'\);\s*btn\.classList\.add\('btn-danger'\)/);
  assert.match(usersJs, /btn\.classList\.remove\('btn-danger'\);\s*btn\.classList\.add\('btn-save', 'success'\)/);
  assert.match(usersJs, /btn\.classList\.add\('btn-save', 'success'\);[\s\S]*?btn\.style\.background = '#16a34a';[\s\S]*?btn\.style\.borderColor = '#16a34a';/);
  assert.match(usersCss, /\.modal-heading-icon\.success\s*\{[^}]*background:\s*var\(--green-pale\);[^}]*color:\s*var\(--green-dark\);/s);
  assert.match(modalCss, /body :is\(\.btn-danger, \.btn-confirm, \.btn-archive-full\.enabled\)\s*\{[^}]*background:\s*var\(--red\);/s);
});

test('account status modal switches between red deactivate and green reactivate', () => {
  const start = usersJs.indexOf('function openDeactivateModal(row) {');
  const end = usersJs.indexOf('\n    function closeDeactivateModal()', start);
  assert.ok(start >= 0 && end > start);

  const makeElement = classes => {
    const names = new Set(classes);
    return {
      textContent: '', value: '', action: '', style: {
        removeProperty(name) { delete this[name]; }
      },
      setAttribute() {},
      classList: {
        add(...items) { items.forEach(item => names.add(item)); },
        remove(...items) { items.forEach(item => names.delete(item)); },
        contains(item) { return names.has(item); }
      }
    };
  };
  const elements = new Map([
    ['deactivateUserId', makeElement()], ['deactivateAction', makeElement()],
    ['deactivateModalTitle', makeElement()], ['deactivateModalSub', makeElement()],
    ['deactivateModalName', makeElement()], ['deactivateCtxLabel', makeElement()],
    ['deactivateModalMsg', makeElement()], ['deactivateModalContext', makeElement()],
    ['deactivateHeadingIcon', makeElement(['danger'])], ['deactivateCtxIcon', makeElement()],
    ['deactivateConfirmBtn', makeElement(['btn', 'btn-danger'])],
    ['deactivateForm', makeElement()], ['deactivateModalBackdrop', makeElement()]
  ]);
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id) },
    lucide: { createIcons() {} },
    row: status => ({
      dataset: { status, userId: '7' },
      querySelector: () => ({ textContent: 'Sample User' })
    })
  });
  vm.runInContext(usersJs.slice(start, end), context);
  vm.runInContext("openDeactivateModal(row('active'))", context);
  let button = elements.get('deactivateConfirmBtn');
  assert.equal(button.classList.contains('btn-danger'), true);
  assert.equal(button.classList.contains('btn-save'), false);
  assert.equal(button.textContent, 'Yes, Deactivate');
  const headingIcon = elements.get('deactivateHeadingIcon');
  assert.equal(headingIcon.classList.contains('danger'), true);
  assert.equal(headingIcon.classList.contains('success'), false);

  vm.runInContext("openDeactivateModal(row('inactive'))", context);
  assert.equal(button.classList.contains('btn-danger'), false);
  assert.equal(button.classList.contains('btn-save'), true);
  assert.equal(button.classList.contains('success'), true);
  assert.equal(button.style.background, '#16a34a');
  assert.equal(button.style.borderColor, '#16a34a');
  assert.equal(button.textContent, 'Yes, Reactivate');
  assert.equal(headingIcon.classList.contains('danger'), false);
  assert.equal(headingIcon.classList.contains('success'), true);
});

test('announcement delete stays red under school accent themes', () => {
  assert.match(announcementsHtml, /class="btn-save danger" style="background:#dc2626;box-shadow:none;"[^>]*>Yes, Delete/);
  assert.match(themeCss, /\.btn-save, \.btn-post, \.btn-submit\):not\(\.success\):not\(\.danger\):not\(\.btn-danger\)/);
});
