const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const page = fs.readFileSync(path.join(__dirname, '../../views/student/edugnay-student-materials.html'), 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];

function createPage(records, getMaterialFile = async () => ({ buffer: new ArrayBuffer(1), contentType: 'application/pdf' })) {
  const elements = new Map();
  const downloads = [];
  const messages = [];
  const requests = [];
  const revoked = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, value: id === 'type-filter' ? 'all' : '', hidden: id === 'materialPreviewModal',
      innerHTML: '', textContent: '', listeners: {}, children: [],
      addEventListener(name, callback) { this.listeners[name] = callback; },
      replaceChildren() { this.children = []; },
      append(child) { this.children.push(child); },
      querySelector() { return null; },
      focus() {}
    });
    return elements.get(id);
  }
  const document = {
    activeElement: { focus() {} },
    body: { classList: { add() {}, remove() {} }, append() {} },
    getElementById: element,
    addEventListener() {},
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
      EDUGNAY_API: {
        isBackendAvailable: true,
        getMaterialFile: (id, download) => {
          requests.push({ id, download });
          return getMaterialFile(id, download);
        },
        materialFileUrl: id => `/api/materials/${id}/file`
      },
      EDUGNAY_CONFIG: {
        escapeHtml: value => String(value),
        renderPanelEmptyState: () => 'No materials'
      }
    },
    records
  });
  vm.runInContext(script, context);
  vm.runInContext('MATERIAL_RECORDS = records; groupMaterials(); renderMaterials();', context);
  return { context, element, downloads, messages, requests, revoked };
}

function material(type, id) {
  return { id: String(id), subjectId: '1', subjectName: 'Science', title: `${type} lesson`,
    type, originalFileName: `lesson.${type}`, academicTermName: 'Quarter 1', postedAt: '2026-10-05' };
}

test('student material rows show preview only for browser-supported types and download for every file', () => {
  const page = createPage(['pdf', 'png', 'mp4', 'docx'].map((type, index) => material(type, index + 1)));
  const html = page.element('materials-container').innerHTML;
  assert.equal((html.match(/data-material-action="preview"/g) || []).length, 3);
  assert.equal((html.match(/data-material-action="download"/g) || []).length, 4);
  assert.match(html, /aria-label="Preview pdf lesson"[^>]*><i data-lucide="eye"><\/i><span class="material-action-label">Preview<\/span>/);
  assert.match(html, /aria-label="Download pdf lesson"[^>]*><i data-lucide="download"><\/i><span class="material-action-label">Download<\/span>/);
  assert.doesNotMatch(html, /class="material-row" data-material-id=/);
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

test('PDF preview fetches the protected file and releases its object URL on close', async () => {
  const page = createPage([material('pdf', 4)]);
  await vm.runInContext('openMaterialPreview(MATERIAL_RECORDS[0])', page.context);
  assert.deepEqual(page.requests, [{ id: '4', download: undefined }]);
  assert.equal(page.element('materialPreviewModal').hidden, false);
  assert.equal(page.element('materialPreviewContent').children[0].tagName, 'IFRAME');
  vm.runInContext('closeMaterialPreview()', page.context);
  assert.equal(page.element('materialPreviewModal').hidden, true);
  assert.deepEqual(page.revoked, ['blob:test']);
});

test('video preview uses the authorized streaming URL with credentials', async () => {
  const page = createPage([material('mp4', 5)]);
  await vm.runInContext('openMaterialPreview(MATERIAL_RECORDS[0])', page.context);
  const video = page.element('materialPreviewContent').children[0];
  assert.equal(video.tagName, 'VIDEO');
  assert.equal(video.crossOrigin, 'use-credentials');
  assert.equal(video.src, '/api/materials/5/file');
  assert.deepEqual(page.requests, []);
});

test('preview failure shows a message instead of an empty viewer', async () => {
  const page = createPage([material('pdf', 4)], async () => { throw new Error('File unavailable.'); });
  await vm.runInContext('openMaterialPreview(MATERIAL_RECORDS[0])', page.context);
  assert.equal(page.element('materialPreviewMessage').textContent, 'File unavailable.');
  assert.deepEqual(page.element('materialPreviewContent').children, []);
});
