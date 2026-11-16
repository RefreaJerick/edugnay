const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sections = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/sections.js'), 'utf8');
const elective = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/elective-class.js'), 'utf8');
const gradebook = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shs-gradebook.js'), 'utf8');
const controller = fs.readFileSync(path.join(__dirname, '../controllers/shsGradesController.js'), 'utf8');
const assignments = fs.readFileSync(path.join(__dirname, '../controllers/assignmentsController.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');

test('SHS core and elective cards show linked grading category and separate submission status', () => {
  const source = sections.match(/function shsAssignmentGradingLabel\([\s\S]*?\r?\n    \}/)?.[0];
  assert.ok(source);
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const linked = { gradingItemId: '7', shsComponentCode: 'examination', maxScore: 25 };
  assert.equal(context.shsAssignmentGradingLabel(linked), 'Examinations · 25 points');
  assert.equal(context.shsAssignmentGradingLabel({ gradingItemId: null }), 'Not included in Score Recording');
  assert.match(sections, /USE_SHS_CORE_GRADEBOOK\s*\? window\.TeacherClassViews\.shsAssignmentGradingLabel\(a\)/);
  assert.match(elective, /TeacherClassViews\.shsAssignmentGradingLabel\(item\).*Online submissions/);
  assert.match(assignments, /linked_item\.shs_component_code AS shsComponentCode/);
  assert.match(client, /shsComponentCode: record\.shsComponentCode/);
});

test('SHS score columns use configured exam names and newest-first order', () => {
  assert.match(controller, /ORDER BY recorded_at DESC, id DESC/);
  const render = gradebook.match(/function renderTable\([\s\S]*?(?=\r?\n  async function saveScore\()/)?.[0];
  const categoryHelpers = gradebook.match(/function categoryCode\([\s\S]*?(?=\r?\n  function scoreFor\()/)?.[0];
  assert.ok(render && categoryHelpers);
  let options;
  const context = vm.createContext({ window: { TeacherClassViews: { renderScoreTable(value) { options = value; } } } });
  vm.runInContext(`${categoryHelpers}\n${render}`, context);
  context.renderTable({}, { scope: { policy: { components: [{ code: 'examination', name: 'Examinations', weight: 30,
    examParts: { term_exam: { name: 'Term Exam', weight: 40 } } }] } },
  items: [{ id: 2, title: 'Quiz', maxScore: 25, componentCode: 'examination', examPartCode: 'term_exam' }] }, {}, true, () => {});
  assert.equal(options.items[0].categoryHeader, 'Exams');
  assert.equal(options.items[0].examPartName, 'Term Exam');
});

test('gradebook loading clears the previous period component actions', () => {
  const render = sections.match(/function renderSharedScoreTable\([\s\S]*?(?=\r?\n    window\.TeacherClassViews =)/)?.[0];
  assert.ok(render);
  const thead = { innerHTML: '<th><button class="score-comp-menu-trigger">Old period</button></th>' };
  const tbody = { innerHTML: '<tr><td>Old score</td></tr>' };
  const footer = { innerHTML: 'Old period' };
  const host = { querySelector(selector) {
    return ({ '#scoreTheadRow': thead, '#scoreTbody': tbody, '#scoreListFooter': footer })[selector];
  } };
  const context = vm.createContext({});
  vm.runInContext(render, context);
  context.renderSharedScoreTable({ host, loading: true });
  assert.doesNotMatch(thead.innerHTML, /score-comp-menu-trigger|Old period/);
  assert.equal(tbody.innerHTML, '');
});
