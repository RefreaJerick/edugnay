const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/admin/archive.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-archive.html'), 'utf8');

test('archive card and modal export the intended year as PDF', async () => {
  const elements = new Map();
  const registrations = [];
  const bindings = [];
  const requests = [];
  const downloads = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, innerHTML: '', textContent: '', disabled: false, style: {},
      classList: { add() {}, remove() {} }, setAttribute() {}
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    Blob, Number, String, Intl, setTimeout: () => 0,
    URL: { createObjectURL: () => 'blob:archive', revokeObjectURL() {} },
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener() {},
      body: { appendChild() {} },
      createElement: () => ({ click() { downloads.push(this.download); }, remove() {} })
    },
    window: {
      EDUGNAY_PAGE_EVENTS: {
        register(_event, callback) { registrations.push(callback); return `r${registrations.length}`; },
        bind(mapping) { bindings.push(mapping); }
      },
      EDUGNAY_CONFIG: { renderPanelEmptyState: () => '' },
      EDUGNAY_API: {
        async getArchivedYear(id) { return { archive: { id, label: '2025-2026', students: 9, teachers: 0,
          sections: 2, passRate: 85.2, attendanceRate: 98.6, sectionsTable: [], academicPeriods: [] } }; },
        async requestFile(url) { requests.push(url); return { buffer: new Uint8Array([37, 80, 68, 70]).buffer,
          fileName: 'school-year-archive-2025-2026.pdf' }; }
      },
      lucide: { createIcons() {} }
    },
    showAppToast() {}
  });
  vm.runInContext(source, context);
  assert.match(html, /id="viewArchiveExportButton"[^>]*data-page-click="p_archive_export"/);
  vm.runInContext('renderArchiveYears([{ id: 21, label: "2025-2026", academicPeriods: [] }])', context);
  assert.match(element('archive-year-list').innerHTML, /Export PDF/);
  assert.doesNotMatch(element('archive-year-list').innerHTML, /Export unavailable/);
  const cardButton = { disabled: false };
  await vm.runInContext('exportArchivePdf(21, cardButton)', Object.assign(context, { cardButton }));
  assert.equal(cardButton.disabled, false);
  assert.deepEqual(requests, ['/archive/academic-years/21/export.pdf']);
  assert.deepEqual(downloads, ['school-year-archive-2025-2026.pdf']);
  assert.equal(typeof registrations[0], 'function');

  await vm.runInContext('openViewModal(22)', context);
  const modalButton = element('viewArchiveExportButton');
  assert.equal(modalButton.disabled, false);
  const modalHandler = bindings.flatMap(mapping => Object.values(mapping.click || {}))
    .find(callback => String(callback).includes('currentViewedArchiveId'));
  assert.ok(modalHandler);
  modalHandler.call(modalButton, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, ['/archive/academic-years/21/export.pdf', '/archive/academic-years/22/export.pdf']);
  assert.equal(downloads.length, 2);

  context.window.EDUGNAY_API.requestFile = async () => { throw new Error('Download failed'); };
  await vm.runInContext('exportArchivePdf(22, document.getElementById("viewArchiveExportButton"))', context);
  assert.equal(element('viewArchiveError').textContent, 'Download failed');
  assert.equal(element('viewArchiveError').style.display, 'block');
  assert.equal(modalButton.disabled, false);
});
