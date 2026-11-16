const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shs-gradebook.js'), 'utf8');
const exporter = source.match(/function exportScoresCsv\([\s\S]*?\r?\n  \}(?=\r?\n\r?\n  function renderTable)/)?.[0];

test('SHS score CSV retains full category names and escapes spreadsheet formulas', async () => {
  assert.ok(exporter);
  const header = {
    querySelector(selector) {
      return ({
        '.comp-head-type': { dataset: { categoryName: 'Written/Oral Works' }, textContent: 'WW' },
        '.comp-head-name': { textContent: 'Quiz 1' },
        '.comp-head-max': { textContent: '/ 25' }
      })[selector];
    }
  };
  const row = {
    hidden: false,
    querySelector: () => ({ textContent: '=HYPERLINK("bad")' }),
    querySelectorAll(selector) {
      return selector.includes('score-input') ? [{ value: '20' }]
        : [{ textContent: '80' }, { textContent: '80' }];
    }
  };
  const host = { querySelectorAll(selector) {
    return ({ '#scoreTheadRow .comp-head-cell': [header],
      '#scoreTheadRow .score-average-header': [{ textContent: 'WW Avg' }],
      '#scoreTbody tr[data-student-id]': [row] })[selector] || [];
  } };
  let blob;
  let download;
  let clicked = false;
  const context = vm.createContext({
    URL: { createObjectURL(value) { blob = value; return 'blob:test'; }, revokeObjectURL() {} },
    Blob,
    document: { createElement() { return { click() { clicked = true; }, set download(value) { download = value; } }; } },
    setTimeout() {}, toast() {}
  });
  vm.runInContext(exporter, context);
  context.exportScoresCsv(host, { scope: { yearLabel: '2026-2027', className: 'Section B', subjectName: 'Mathematics' }, term: { name: 'Term 1' } });
  assert.equal(clicked, true);
  assert.match(download, /Section-B-Mathematics-Term-1-scores\.csv$/);
  const csv = await blob.text();
  assert.match(csv, /Written\/Oral Works: Quiz 1 \/ 25/);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"WW Avg","Final Grade"/);
});
