const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../assets/js/admin/schools.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/schools.css'), 'utf8');
const summaryStart = script.indexOf('    function renderK10PublishedGroupSummary()');
const summaryEnd = script.indexOf('    function renderK10GroupStandardExamSummary(', summaryStart);
const editorStart = script.indexOf('    function renderSubjectGradingEditor()');
const editorEnd = script.indexOf('    async function saveSubjectGradingEditor(', editorStart);

function subject(gradeCodes, examParts, writtenWeight = 20) {
  return { status: 'published', gradeCodes, components: [
    { code: 'written', name: 'Written/Oral Works', componentType: 'written', weight: writtenWeight },
    { code: 'performance', name: 'Performance Tasks', componentType: 'performance', weight: 50 },
    { code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30, examParts }
  ] };
}

test('published modal shows one compact saved setup and initializes its info icon', () => {
  const parts = [
    { code: 'st1', name: 'Summative Test 1', weight: 30 },
    { code: 'st2', name: 'Summative Test 2', weight: 30 },
    { code: 'term', name: 'Term Exam', weight: 40 }
  ];
  const body = { innerHTML: '' };
  const modalClasses = [];
  let iconRenders = 0;
  const state = { k10EditorComponents: [], k10GroupDiverged: false,
    k10EditorGroup: { subjects: [], allSubjects: [subject(['grade-7', 'grade-8'], parts), subject(['grade-9', 'grade-10'], parts)] } };
  const context = vm.createContext({
    state,
    document: { getElementById(id) {
      return id === 'subjectGradingEditorBody' ? body : { classList: { toggle(_name, enabled) { modalClasses.push(enabled); } } };
    } },
    window: { EDUGNAY_CONFIG: { escapeHtml: value => String(value).replace(/[&<>"']/g, char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]) }, lucide: {} },
    lucide: { createIcons() { iconRenders++; } },
    formatK10GradeNames: codes => codes.map(code => code.replace('grade-', 'G')).join(', '),
    renderK10EarlyExamGroupEditor: () => '', renderK10GroupExceptions: () => '',
    renderK10GroupExamInfoBanner: () => '', renderK10GroupStandardExamSection: () => '',
    isK10EarlyGradeSubject: () => false
  });
  vm.runInContext(script.slice(summaryStart, summaryEnd) + script.slice(editorStart, editorEnd), context);
  vm.runInContext('renderSubjectGradingEditor()', context);

  assert.deepEqual(modalClasses, [true]);
  assert.equal(iconRenders, 1);
  assert.match(body.innerHTML, /data-lucide="info"/);
  assert.match(body.innerHTML, /Published grading setup/);
  assert.equal((body.innerHTML.match(/school-k10-published-card-head/g) || []).length, 1);
  for (const value of ['G7, G8, G9, G10', 'Written\/Oral Works', '20%', 'Performance Tasks', '50%',
    'Examinations', '30%', 'Summative Test 1', 'Summative Test 2', 'Term Exam', '40%']) {
    assert.match(body.innerHTML, new RegExp(value));
  }
  assert.equal((body.innerHTML.match(/Published grades lock these settings/g) || []).length, 1);
  assert.doesNotMatch(body.innerHTML, /JHS exam setup|Grade-specific exceptions/);
});

test('different published setups stay in separate rows and compact layout adapts to mobile', () => {
  const context = vm.createContext({
    state: { k10EditorGroup: { allSubjects: [
      subject(['grade-7'], [{ code: 'st1', name: 'Summative Test 1', weight: 30 }]),
      subject(['grade-8'], [{ code: 'st1', name: 'Summative Test 1', weight: 50 }])
    ] } },
    window: { EDUGNAY_CONFIG: { escapeHtml: value => String(value) } },
    formatK10GradeNames: codes => codes.map(code => code.replace('grade-', 'G')).join(', ')
  });
  vm.runInContext(script.slice(summaryStart, summaryEnd), context);
  const html = vm.runInContext('renderK10PublishedGroupSummary()', context);
  assert.equal((html.match(/school-k10-published-card-head/g) || []).length, 2);
  assert.match(html, /G7/);
  assert.match(html, /G8/);
  assert.match(html, /Summative Test 1 <strong>30%<\/strong>/);
  assert.match(html, /Summative Test 1 <strong>50%<\/strong>/);
  assert.match(styles, /\.school-k10-readonly-modal \.modal\s*\{[^}]*max-width:\s*760px/s);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.school-k10-published-weights\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});
