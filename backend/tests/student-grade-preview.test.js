const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../views/student/edugnay-student-grades.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../../assets/js/student/grades.js'), 'utf8');
const start = source.indexOf('    function clearGradePreview()');
const end = source.indexOf('    async function loadStudentGradesFromApi()', start);
assert.ok(start >= 0 && end > start);

function previewHarness(requestFile) {
  const nodes = Object.fromEntries([
    'gradePreviewModal', 'gradePreviewFrame', 'gradePreviewMessage', 'gradePreviewDownload',
    'gradePreviewYear', 'gradePreviewClose', 'gradeDownloadButton'
  ].map(id => [id, { hidden: id === 'gradePreviewModal', disabled: id === 'gradePreviewDownload',
    textContent: '', focus() { this.focused = true; }, removeAttribute(name) { delete this[name]; } }]));
  const revoked = [];
  const links = [];
  const blobs = [];
  const timers = [];
  const shell = { inert: false };
  const bodyClasses = new Set();
  let selectedYear = { id: '4', label: '2026-2027' };
  let nextUrl = 0;
  const context = {
    Blob,
    URL: {
      createObjectURL(blob) { blobs.push(blob); return `blob:grade-${++nextUrl}`; },
      revokeObjectURL(url) { revoked.push(url); }
    },
    window: { EDUGNAY_API: { requestFile } },
    document: {
      activeElement: nodes.gradeDownloadButton,
      getElementById(id) { return nodes[id]; },
      querySelector(selector) { return selector === '.shell' ? shell : null; },
      createElement() { const link = { click() { this.clicked = true; }, remove() {} }; links.push(link); return link; },
      body: { classList: {
        add(name) { bodyClasses.add(name); }, remove(name) { bodyClasses.delete(name); }
      }, appendChild() {} }
    },
    getSelectedAcademicYear() { return selectedYear; },
    updateGradeDownloadButton() {},
    setTimeout(callback) { timers.push(callback); }
  };
  const actions = vm.runInNewContext(`
    let gradePreviewLoading = false;
    let gradePreviewRequest = 0;
    let gradePreviewObjectUrl = null;
    let gradePreviewBuffer = null;
    let gradePreviewFileName = '';
    let gradePreviewReturnFocus = null;
    ${source.slice(start, end)}
    ({ openGradePreview, closeGradePreview, downloadPreviewedGrades, handleGradePreviewKeydown })
  `, context);
  return { ...actions, nodes, shell, links, blobs, timers, revoked, bodyClasses, selectYear(year) { selectedYear = year; } };
}

test('grade button opens a preview and downloads the same PDF, then cleans up on close', async () => {
  assert.match(html, /id="gradeDownloadButton"/);
  assert.match(html, /id="gradePreviewFrame"/);
  assert.match(source, /gradeDownloadButton'\)\.addEventListener\('click', openGradePreview\)/);
  const requested = [];
  const ui = previewHarness(async url => {
    requested.push(url);
    return { buffer: new Uint8Array([37, 80, 68, 70]), contentType: 'application/pdf', fileName: 'grades-4.pdf' };
  });
  await ui.openGradePreview();
  assert.deepEqual(requested, ['/final-grades/student-copy.pdf?academicYearId=4']);
  assert.equal(ui.nodes.gradePreviewModal.hidden, false);
  assert.equal(ui.shell.inert, true);
  assert.equal(ui.nodes.gradePreviewFrame.src, 'blob:grade-1');
  assert.equal(ui.nodes.gradePreviewDownload.disabled, true);
  assert.equal(ui.nodes.gradePreviewMessage.textContent, 'Opening PDF preview...');
  ui.nodes.gradePreviewFrame.onload();
  assert.equal(ui.nodes.gradePreviewDownload.disabled, false);
  ui.downloadPreviewedGrades();
  assert.equal(ui.links[0].href, 'blob:grade-2');
  assert.deepEqual(new Uint8Array(await ui.blobs[0].arrayBuffer()), new Uint8Array(await ui.blobs[1].arrayBuffer()));
  assert.equal(ui.links[0].download, 'grades-4.pdf');
  assert.equal(ui.links[0].clicked, true);
  ui.closeGradePreview();
  assert.equal(ui.nodes.gradePreviewModal.hidden, true);
  assert.equal(ui.shell.inert, false);
  assert.equal(ui.nodes.gradePreviewFrame.hidden, true);
  assert.deepEqual(ui.revoked, ['blob:grade-1']);
  ui.timers[0]();
  assert.deepEqual(ui.revoked, ['blob:grade-1', 'blob:grade-2']);
  assert.equal(ui.nodes.gradeDownloadButton.focused, true);

  ui.selectYear({ id: '3', label: '2025-2026' });
  await ui.openGradePreview();
  assert.equal(requested[1], '/final-grades/student-copy.pdf?academicYearId=3');
  assert.equal(ui.nodes.gradePreviewFrame.src, 'blob:grade-3');
  ui.closeGradePreview();
});

test('grade preview keeps download disabled when loading fails', async () => {
  const ui = previewHarness(async () => { throw new Error('Grades unavailable'); });
  await ui.openGradePreview();
  assert.equal(ui.nodes.gradePreviewModal.hidden, false);
  assert.equal(ui.nodes.gradePreviewMessage.textContent, 'Grades unavailable');
  assert.equal(ui.nodes.gradePreviewDownload.disabled, true);
  assert.equal(ui.nodes.gradePreviewFrame.hidden, true);
  ui.closeGradePreview();
});

test('grade preview rejects a non-PDF response', async () => {
  const ui = previewHarness(async () => ({ buffer: new Uint8Array([1, 2]), contentType: 'text/html' }));
  await ui.openGradePreview();
  assert.match(ui.nodes.gradePreviewMessage.textContent, /preview is unavailable/);
  assert.equal(ui.nodes.gradePreviewDownload.disabled, true);
  assert.equal(ui.nodes.gradePreviewFrame.hidden, true);
});

test('PDF viewer failure leaves the modal open with download disabled', async () => {
  const ui = previewHarness(async () => ({
    buffer: new Uint8Array([37, 80, 68, 70]), contentType: 'application/pdf'
  }));
  await ui.openGradePreview();
  ui.nodes.gradePreviewFrame.onerror();
  assert.match(ui.nodes.gradePreviewMessage.textContent, /could not be displayed/);
  assert.equal(ui.nodes.gradePreviewDownload.disabled, true);
  assert.equal(ui.nodes.gradePreviewFrame.hidden, true);
  ui.closeGradePreview();
});

test('closing during a grade fetch ignores its late response', async () => {
  let complete;
  const ui = previewHarness(() => new Promise(resolve => { complete = resolve; }));
  const opening = ui.openGradePreview();
  assert.equal(ui.nodes.gradePreviewMessage.textContent, 'Preparing preview...');
  assert.equal(ui.nodes.gradePreviewDownload.disabled, true);
  ui.closeGradePreview();
  complete({ buffer: new Uint8Array([37, 80, 68, 70]), contentType: 'application/pdf' });
  await opening;
  assert.equal(ui.nodes.gradePreviewModal.hidden, true);
  assert.equal(ui.nodes.gradePreviewFrame.hidden, true);
  assert.deepEqual(ui.revoked, []);
});

test('Escape closes the grade preview and returns focus', async () => {
  const ui = previewHarness(async () => ({
    buffer: new Uint8Array([37, 80, 68, 70]), contentType: 'application/pdf'
  }));
  await ui.openGradePreview();
  let prevented = false;
  ui.handleGradePreviewKeydown({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(ui.nodes.gradePreviewModal.hidden, true);
  assert.equal(ui.nodes.gradeDownloadButton.focused, true);
});
