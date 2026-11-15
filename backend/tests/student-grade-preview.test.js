const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../views/student/edugnay-student-grades.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../../assets/js/student/grades.js'), 'utf8');
const buttonStart = source.indexOf('    function updateGradeDownloadButton()');
const buttonEnd = source.indexOf('    function renderAcademicYearSelect()', buttonStart);
const downloadStart = source.indexOf('    async function downloadGrades()');
const downloadEnd = source.indexOf('    async function loadStudentGradesFromApi()', downloadStart);
assert.ok(buttonStart >= 0 && buttonEnd > buttonStart && downloadStart >= 0 && downloadEnd > downloadStart);

function downloadHarness(requestFile) {
  const nodes = { gradeDownloadButton: { disabled: false }, gradeYearSelect: { disabled: false } };
  const blobs = [];
  const links = [];
  const revoked = [];
  const timers = [];
  const messages = [];
  let selectedYear = { id: '4', label: '2026-2027' };
  const context = {
    Blob,
    URL: {
      createObjectURL(blob) { blobs.push(blob); return `blob:grade-${blobs.length}`; },
      revokeObjectURL(url) { revoked.push(url); }
    },
    window: { EDUGNAY_API: { requestFile } },
    document: {
      getElementById(id) { return nodes[id]; },
      createElement() {
        const link = { click() { this.clicked = true; }, remove() {} };
        links.push(link);
        return link;
      },
      body: { appendChild() {} }
    },
    getSelectedAcademicYear() { return selectedYear; },
    showAppToast(message, type) { messages.push({ message, type }); },
    setTimeout(callback) { timers.push(callback); }
  };
  const actions = vm.runInNewContext(`
    let gradeLoading = false;
    let gradeDownloading = false;
    let gradeLoadError = '';
    let gradeAccessDenied = false;
    let STUDENT_GRADE_YEARS = [{ id: '4' }, { id: '3' }];
    ${source.slice(buttonStart, buttonEnd)}
    ${source.slice(downloadStart, downloadEnd)}
    ({ downloadGrades })
  `, context);
  return { ...actions, nodes, blobs, links, revoked, timers, messages,
    selectYear(year) { selectedYear = year; } };
}

test('Download grades fetches the selected year once and downloads its PDF', async () => {
  assert.match(html, /id="gradeDownloadButton"/);
  assert.doesNotMatch(html, /id="gradePreviewModal"/);
  assert.match(source, /gradeDownloadButton'\)\.addEventListener\('click', downloadGrades\)/);
  const requests = [];
  let complete;
  const ui = downloadHarness(url => {
    requests.push(url);
    return new Promise(resolve => { complete = resolve; });
  });
  const downloading = ui.downloadGrades();
  await ui.downloadGrades();
  assert.deepEqual(requests, ['/final-grades/student-copy.pdf?academicYearId=4']);
  assert.equal(ui.nodes.gradeDownloadButton.disabled, true);
  assert.equal(ui.nodes.gradeYearSelect.disabled, true);
  complete({ buffer: new Uint8Array([37, 80, 68, 70]), contentType: 'application/pdf', fileName: 'grades-4.pdf' });
  await downloading;
  assert.equal(ui.links[0].href, 'blob:grade-1');
  assert.equal(ui.links[0].download, 'grades-4.pdf');
  assert.equal(ui.links[0].clicked, true);
  assert.deepEqual(new Uint8Array(await ui.blobs[0].arrayBuffer()), new Uint8Array([37, 80, 68, 70]));
  assert.equal(ui.nodes.gradeDownloadButton.disabled, false);
  assert.equal(ui.nodes.gradeYearSelect.disabled, false);
  ui.timers[0]();
  assert.deepEqual(ui.revoked, ['blob:grade-1']);

  ui.selectYear({ id: '3', label: '2025-2026' });
  const next = ui.downloadGrades();
  complete({ buffer: new Uint8Array([37, 80, 68, 70]), contentType: 'application/pdf' });
  await next;
  assert.equal(requests[1], '/final-grades/student-copy.pdf?academicYearId=3');
  assert.equal(ui.links[1].download, 'student-grades-3.pdf');
});

test('a failed grade request reports the error and restores the controls', async () => {
  const ui = downloadHarness(async () => { throw new Error('Grades unavailable'); });
  await ui.downloadGrades();
  assert.deepEqual(ui.messages, [{ message: 'Grades unavailable', type: 'error' }]);
  assert.equal(ui.links.length, 0);
  assert.equal(ui.nodes.gradeDownloadButton.disabled, false);
  assert.equal(ui.nodes.gradeYearSelect.disabled, false);
});

test('a non-PDF response is not downloaded', async () => {
  const ui = downloadHarness(async () => ({ buffer: new Uint8Array([1, 2]), contentType: 'text/html' }));
  await ui.downloadGrades();
  assert.match(ui.messages[0].message, /PDF could not be downloaded/);
  assert.equal(ui.links.length, 0);
  assert.equal(ui.nodes.gradeDownloadButton.disabled, false);
  assert.equal(ui.nodes.gradeYearSelect.disabled, false);
});
