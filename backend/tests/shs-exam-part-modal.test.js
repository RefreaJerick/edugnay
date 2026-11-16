const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const gradebook = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shs-gradebook.js'), 'utf8');
const sections = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/sections.js'), 'utf8');

test('the shared component click handler leaves SHS choices to the SHS gradebook', () => {
  const listener = sections.match(/document\.getElementById\('compTypeOpts'\)\.addEventListener\('click', event => \{[\s\S]*?\n    \}\);/)?.[0];
  assert.ok(listener);
  let onClick;
  let regularSelections = 0;
  const context = vm.createContext({
    document: { getElementById: () => ({ addEventListener: (_name, handler) => { onClick = handler; } }) },
    USE_SHS_CORE_GRADEBOOK: false,
    isElectiveClassPage: () => false,
    selectCompType: () => { regularSelections++; }
  });
  vm.runInContext(listener, context);
  const choice = { dataset: { cat: 'QA' }, querySelector: () => ({ textContent: 'Examinations' }) };
  const event = { target: { closest: () => choice } };
  context.USE_SHS_CORE_GRADEBOOK = true;
  onClick(event);
  context.USE_SHS_CORE_GRADEBOOK = false;
  context.isElectiveClassPage = () => true;
  onClick(event);
  assert.equal(regularSelections, 0);
  context.isElectiveClassPage = () => false;
  onClick(event);
  assert.equal(regularSelections, 1);
});

test('SHS core and elective modals show exam parts and save the selected part', async () => {
  const configure = gradebook.match(/function configureAddAssessmentModal\([\s\S]*?(?=\n  function renderCategoryTabs\()/)?.[0];
  assert.ok(configure);
  for (const kind of ['core', 'elective']) {
    const components = [
      { code: 'written', name: 'Written/Oral Works', weight: 20, examParts: {} },
      { code: 'examination', name: 'Examinations', weight: 30,
        examParts: { summative_test_1: { name: 'Summative Test 1', weight: 30 },
          term_exam: { name: 'Term Exam', weight: 70 } } }
    ];
    const buttons = components.map((component, index) => ({
      dataset: { componentCode: component.code }, selected: index === 0,
      classList: { toggle(_name, value) { buttons[index].selected = value; } },
      setAttribute() {}
    }));
    const choices = {
      contains: button => buttons.includes(button), querySelectorAll: () => buttons,
      querySelector: () => buttons.find(button => button.selected)
    };
    const title = { value: 'Exam 1', reportValidity: () => true };
    const maximum = { value: '25', reportValidity: () => true };
    const examGroup = { hidden: true };
    const examSelect = { value: '', required: false, focus() {} };
    Object.defineProperty(examSelect, 'innerHTML', {
      get() { return this.markup || ''; },
      set(html) {
        this.markup = html;
        this.options = [...html.matchAll(/value="([^"]+)"/g)].map(match => match[1]);
        this.value = this.options[0] || '';
      }
    });
    const save = { disabled: false };
    const label = { textContent: '' };
    const fields = { '#compTypeOpts': choices, '#compNameInput': title, '#compMaxInput': maximum,
      '#scoreExamPartGroup': examGroup, '#scoreExamPartInput': examSelect };
    const modal = { querySelector: selector => selector === '.modal-body'
      ? { querySelector: key => fields[key] }
      : selector === '#addScoreComponentSubmit' ? save : label };
    const saved = [];
    const notices = [];
    const context = vm.createContext({
      document: { getElementById: () => modal },
      window: { TeacherClassViews: { renderComponentChoices() {} }, lucide: { createIcons() {} }, closeModal() {} },
      categoryCode: component => component.code === 'examination' ? 'QA' : 'WW',
      escapeHtml: value => value, api: () => ({ createShsGradingItem: async values => saved.push(values) }),
      flushPendingScores: async () => true,
      toast: (message, type) => notices.push({ message, type })
    });
    vm.runInContext(configure, context);
    context.configureAddAssessmentModal({ scope: { policy: { components } }, term: { id: 3 } },
      { kind }, true, async () => true);
    assert.equal(examGroup.hidden, true);
    choices.onclick({ target: { closest: () => buttons[1] } });
    assert.equal(examGroup.hidden, false);
    assert.deepEqual(examSelect.options, ['summative_test_1', 'term_exam']);
    assert.match(examSelect.innerHTML, /Summative Test 1/);
    examGroup.hidden = true;
    await save.onclick({ preventDefault() {} });
    assert.equal(saved.length, 0);
    assert.equal(examGroup.hidden, false);
    assert.match(notices.at(-1).message, /Choose an examination part/);
    examSelect.value = 'term_exam';
    await save.onclick({ preventDefault() {} });
    assert.equal(saved[0].examPartCode, 'term_exam');
    choices.onclick({ target: { closest: () => buttons[0] } });
    assert.equal(examGroup.hidden, true);
    await save.onclick({ preventDefault() {} });
    assert.equal(saved[1].examPartCode, null);
  }
});
