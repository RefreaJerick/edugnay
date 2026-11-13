const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/sections.js'), 'utf8');
const start = source.indexOf('function transmuteDepedK10InitialGrade(');
const end = source.indexOf('\n    async function saveBackendStudentScore(', start);
const calculation = source.slice(start, end);

test('GMRC and Values table uses domain weights, exam split, and the selected grade method', () => {
  assert.ok(start >= 0 && end > start);
  assert.match(source, /data-domain-code="\$\{window\.EDUGNAY_CONFIG\.escapeHtml\(item\.domainCode \|\| ''\)\}"/);
  const categories = [
    { code: 'WW', componentType: 'written', weight: 20, examParts: [] },
    { code: 'PT', componentType: 'performance', weight: 50, examParts: [] },
    { code: 'EX', componentType: 'examination', weight: 30, examParts: [
      { id: 1, weight: 30 }, { id: 2, weight: 30 }, { id: 3, weight: 40 }
    ] }
  ];
  const scores = [
    ['WW', 'cognitive', '', 5, 10], ['WW', 'cognitive', '', 20, 20],
    ['WW', 'affective', '', 0, 10],
    ['PT', 'cognitive', '', 10, 10], ['PT', 'affective', '', 10, 10],
    ['PT', 'behavioral', '', 0, 10],
    ['EX', '', '1', 10, 10], ['EX', '', '2', 10, 10], ['EX', '', '3', 10, 10]
  ];

  function calculate({ valuesDomains = true, setupMatches = true, scale = 'deped_zero_based', edits = {} } = {}) {
    const items = scores.map(([cat, domainCode, examPartId, score, max], index) => {
      const cell = { dataset: { cat, domainCode: edits[index]?.domainCode ?? domainCode, examPartId } };
      return { value: String(edits[index]?.score ?? score), max: String(max), dataset: {},
        classList: { toggle() {} }, closest: selector => selector === 'td' ? cell : row };
    });
    const metrics = Array.from({ length: 4 }, () => ({ textContent: '', className: '',
      classList: { add() {} }, removeAttribute() {}, setAttribute() {} }));
    const row = { dataset: { studentId: '1' }, querySelectorAll: selector =>
      selector === '.computed-cell' ? metrics : items };
    const context = vm.createContext({
      BACKEND_SUBJECT_GRADING_CONFIG: { applicable: true, valuesDomains, valuesDomainSetupMatches: setupMatches },
      BACKEND_CATEGORIES: categories,
      CURRENT_GRADING_RULES: categories.map(category => ({ id: category.code })),
      WEIGHTS: { WW: 0.2, PT: 0.5, EX: 0.3 }, CURRENT_GRADE_SCALE: scale,
      GRADE_ROUNDING: 'round', getGradeStatusTone: () => 'grade-pass'
    });
    vm.runInContext(calculation, context);
    context.computeRow(items[0]);
    return metrics.map(metric => metric.textContent);
  }

  assert.deepEqual(calculate(), ['41.7', '40.0', '100.0', '58']);
  assert.deepEqual(calculate({ scale: 'deped_2026_transmutation' }), ['41.7', '40.0', '100.0', '72']);
  assert.equal(calculate({ edits: { 5: { score: '' } } })[3], '—');
  assert.deepEqual(calculate({ edits: { 5: { domainCode: '' } } }).slice(1, 4), ['—', '100.0', '—']);
  assert.equal(calculate({ edits: { 0: { score: 11 } } })[0], '—');
  assert.equal(calculate({ edits: { 6: { score: '' } } })[2], '—');
  assert.equal(calculate({ setupMatches: false })[3], '—');
  assert.equal(calculate({ valuesDomains: false })[3], '76');
});
