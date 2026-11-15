const assert = require('node:assert/strict');
const fs = require('node:fs');
const pageFs = require('./helpers/page-fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const page = pageFs.readFileSync(path.join(__dirname, '../../views/student/edugnay-student-materials.html'), 'utf8');
const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes('let MATERIAL_RECORDS'));

function createPage(records, getMaterialFile = async () => ({ buffer: new ArrayBuffer(1), contentType: 'application/pdf' }), subjects = []) {
  const elements = new Map();
  const downloads = [];
  const messages = [];
  const requests = [];
  const revoked = [];
  const documentEvents = {};
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, value: id === 'type-filter' ? 'all' : '', hidden: false,
      innerHTML: '', textContent: '', listeners: {}, children: [],
      addEventListener(name, callback) { this.listeners[name] = callback; },
      replaceChildren(...children) { this.children = children; },
      append(child) { this.children.push(child); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      focus() {}
    });
    return elements.get(id);
  }
  const document = {
    activeElement: { focus() {} },
    body: { classList: { add() {}, remove() {} }, append() {} },
    getElementById: element,
    querySelectorAll() { return []; },
    addEventListener(name, callback) { documentEvents[name] = callback; },
    createElement(tagName) {
      return tagName === 'a' ? {
        click() { downloads.push(this.download); }, remove() {}
      } : {
        tagName: tagName.toUpperCase(), listeners: {},
        addEventListener(name, callback) { this.listeners[name] = callback; }
      };
    }
  };
  const context = vm.createContext({
    document, Blob, setTimeout: callback => callback(),
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: url => revoked.push(url) },
    lucide: { createIcons() {} },
    showAppToast: message => messages.push(message),
    window: {
      EDUGNAY_PAGE_LOADING: { ready() {} },
      EDUGNAY_API: {
        isBackendAvailable: true,
        getStudentMaterialSubjects: async () => subjects,
        getMaterialFile: (id, download) => {
          requests.push({ id, download });
          return getMaterialFile(id, download);
        },
        materialFileUrl: id => `/api/materials/${id}/file`
      },
      EDUGNAY_CONFIG: {
        escapeHtml: value => String(value),
        renderPanelEmptyState: ({ title, text }) => `${title}: ${text}`,

      }
    },
    records, subjects
  });
  vm.runInContext(script, context);
  vm.runInContext('MATERIAL_SUBJECTS = subjects; MATERIAL_RECORDS = records; groupMaterials(); renderSubjectTabs(); renderMaterials();', context);
  return { context, element, downloads, messages, requests, revoked, documentEvents };
}

function material(type, id) {
  return { id: String(id), subjectId: '1', subjectName: 'Science', title: `${type} lesson`,
    type, originalFileName: `lesson.${type}`, academicTermName: 'Quarter 1', postedAt: '2026-10-05' };
}

test('student material previews open supported files in a new tab and keep every download', () => {
  const page = createPage(['pdf', 'jpg', 'png', 'mp4', 'docx'].map((type, index) => material(type, index + 1)));
  const html = page.element('materials-container').innerHTML;
  assert.equal((html.match(/target="_blank" rel="noopener"/g) || []).length, 4);
  assert.equal((html.match(/data-material-action="download"/g) || []).length, 5);
  for (const [type, id] of [['pdf', 1], ['jpg', 2], ['png', 3], ['mp4', 4]]) {
    assert.match(html, new RegExp(`<a class="material-action" href="/api/materials/${id}/file" target="_blank" rel="noopener" aria-label="Preview ${type} lesson"`));
  }
  assert.doesNotMatch(html, /aria-label="Preview docx lesson"/);
  assert.match(html, /<div class="material-meta">\s*<span>PDF<\/span>\s*<span class="material-meta-dot"><\/span>\s*<span>Posted/);
  assert.doesNotMatch(html, /class="badge badge-blue"/);
  assert.match(html, /aria-label="Download pdf lesson"[^>]*><i data-lucide="download"><\/i><span class="material-action-label">Download<\/span>/);
  assert.doesNotMatch(html, /class="material-row" data-material-id=/);
});

test('elective materials get separate class tabs and a clear group label', () => {
  const page = createPage([
    { id: '20', subjectId: null, electiveClassId: '51', scopeType: 'elective', subjectName: 'Contemporary Literature',
      className: 'Academic 11-A', teacherName: 'Maya Santos', title: 'Research guide', type: 'pdf', postedAt: '2026-10-05' },
    { id: '21', subjectId: null, electiveClassId: '52', scopeType: 'elective', subjectName: 'Contemporary Literature',
      className: 'Academic 11-B', teacherName: 'Carlo Reyes', title: 'Reading guide', type: 'pdf', postedAt: '2026-10-05' }
  ]);
  assert.equal(vm.runInContext('Object.keys(MATERIALS_BY_SUBJECT).length', page.context), 2);
  assert.match(page.element('subject-tabs').innerHTML, /Contemporary Literature · Academic 11-A/);
  assert.match(page.element('subject-tabs').innerHTML, /Contemporary Literature · Academic 11-B/);
  assert.match(page.element('materials-container').innerHTML, /Elective class materials/);
  assert.match(page.element('materials-container').innerHTML, /Research guide/);
});

test('current subjects appear with zero materials and a subject-specific empty state', async () => {
  const subjects = [
    { scopeType: 'section', subjectId: '1', subjectName: 'Science', teacherName: 'Ms. Reyes' },
    { scopeType: 'section', subjectId: '2', subjectName: 'Mathematics', teacherName: 'Mr. Cruz' }
  ];
  const page = createPage([], undefined, subjects);
  page.context.window.EDUGNAY_SCHOOL_READY = Promise.resolve();
  await page.documentEvents.DOMContentLoaded();
  assert.match(page.element('subject-tabs').innerHTML, /Science[\s\S]*tab-count">0/);
  assert.match(page.element('subject-tabs').innerHTML, /Mathematics[\s\S]*tab-count">0/);
  assert.equal(page.element('subject-tabs').hidden, false);
  vm.runInContext("switchSubject('subject:1:', null)", page.context);
  assert.equal(page.element('panel-title').textContent, 'Science Materials');
  assert.match(page.element('materials-container').innerHTML, /No learning materials yet/);
});

test('empty elective classes keep separate tabs and published materials join their matching tab', () => {
  const subjects = [
    { scopeType: 'elective', electiveClassId: '51', subjectName: 'Literature', className: '11-A', teacherName: 'Ms. Reyes' },
    { scopeType: 'elective', electiveClassId: '52', subjectName: 'Literature', className: '11-B', teacherName: 'Mr. Cruz' }
  ];
  const records = [{ id: '8', scopeType: 'elective', electiveClassId: '52', subjectName: 'Literature',
    className: '11-B', title: 'Reading', type: 'pdf', postedAt: '2026-10-05' }];
  const page = createPage(records, undefined, subjects);
  assert.equal(vm.runInContext('Object.keys(MATERIALS_BY_SUBJECT).length', page.context), 2);
  assert.match(page.element('subject-tabs').innerHTML, /Literature · 11-A[\s\S]*tab-count">0/);
  assert.match(page.element('subject-tabs').innerHTML, /Literature · 11-B[\s\S]*tab-count">1/);
  vm.runInContext("switchSubject('elective:52', null)", page.context);
  assert.match(page.element('materials-container').innerHTML, /Reading/);
});

test('materials missing from the current subject list remain visible', () => {
  const page = createPage([material('pdf', 4)], undefined, [
    { scopeType: 'section', subjectId: '2', subjectName: 'Mathematics' }
  ]);
  assert.equal(vm.runInContext('Object.keys(MATERIALS_BY_SUBJECT).length', page.context), 2);
  assert.match(page.element('subject-tabs').innerHTML, /Mathematics[\s\S]*Science/);
});

test('student materials distinguish an empty API result from a failed or missing API', async () => {
  const empty = createPage([]);
  empty.context.window.EDUGNAY_SCHOOL_READY = Promise.resolve();
  empty.context.window.EDUGNAY_API.getMaterials = async () => [];
  await empty.documentEvents.DOMContentLoaded();
  assert.match(empty.element('materials-container').innerHTML, /No learning materials yet/);
  assert.equal(empty.element('subject-tabs').hidden, true);
  assert.equal(empty.element('panel-title').textContent, 'Learning Materials');

  const subjectsFailed = createPage([]);
  subjectsFailed.context.window.EDUGNAY_SCHOOL_READY = Promise.resolve();
  subjectsFailed.context.window.EDUGNAY_API.getStudentMaterialSubjects = async () => { throw new Error('Subjects request failed.'); };
  subjectsFailed.context.window.EDUGNAY_API.getMaterials = async () => [];
  await subjectsFailed.documentEvents.DOMContentLoaded();
  assert.match(subjectsFailed.element('materials-container').innerHTML, /Materials unavailable: Subjects request failed/);

  const failed = createPage([]);
  failed.context.window.EDUGNAY_SCHOOL_READY = Promise.resolve();
  failed.context.window.EDUGNAY_API.getMaterials = async () => { throw new Error('Materials request failed.'); };
  await failed.documentEvents.DOMContentLoaded();
  assert.match(failed.element('materials-container').innerHTML, /Materials unavailable: Materials request failed/);
  const unavailable = createPage([]);
  unavailable.context.window.EDUGNAY_API.isBackendAvailable = false;
  await unavailable.documentEvents.DOMContentLoaded();
  assert.match(unavailable.element('materials-container').innerHTML, /Materials unavailable: Learning materials aren’t available right now/);
});

test('download requests the authorized attachment and uses the original filename', async () => {
  const page = createPage([material('pdf', 4)]);
  const button = { innerHTML: 'Download', disabled: false };
  page.context.button = button;
  await vm.runInContext('downloadMaterial(MATERIAL_RECORDS[0], button)', page.context);
  assert.deepEqual(page.requests, [{ id: '4', download: true }]);
  assert.deepEqual(page.downloads, ['lesson.pdf']);
  assert.equal(button.disabled, false);
  assert.deepEqual(page.revoked, ['blob:test']);
});

test('download failure is visible and restores the button', async () => {
  const page = createPage([material('pdf', 4)], async () => { throw new Error('File unavailable.'); });
  const button = { innerHTML: 'Download', disabled: false };
  page.context.button = button;
  await vm.runInContext('downloadMaterial(MATERIAL_RECORDS[0], button)', page.context);
  assert.deepEqual(page.messages, ['File unavailable.']);
  assert.equal(button.disabled, false);
  assert.deepEqual(page.downloads, []);
});
