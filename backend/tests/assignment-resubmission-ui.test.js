const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const pageFs = require('./helpers/page-fs');

const teacherHtml = pageFs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-sections.html'), 'utf8');
const teacherScript = pageFs.readFileSync(path.join(__dirname, '../../assets/js/teacher/sections.js'), 'utf8');
const studentHtml = pageFs.readFileSync(path.join(__dirname, '../../views/student/edugnay-student-assignments.html'), 'utf8');
const studentScript = pageFs.readFileSync(path.join(__dirname, '../../assets/js/student/assignments.js'), 'utf8');

test('teacher replacement choices use even gaps and appear only with online submissions', () => {
  for (const id of ['assignResubmissionLimitGroup', 'editAssignmentResubmissionLimitGroup']) {
    assert.match(teacherHtml, new RegExp(`id="${id}" hidden`));
  }
  for (const name of ['assignResubmissionLimit', 'editAssignmentResubmissionLimit']) {
    const values = [...teacherHtml.matchAll(new RegExp(`name="${name}" value="([^"]*)"`, 'g'))].map(match => match[1]);
    assert.deepEqual(values, ['', '1', '2', '3', '4', '5']);
  }
  assert.doesNotMatch(teacherHtml, /id="(?:assign|editAssignment)ResubmissionLimitInput"/);
  const css = pageFs.readFileSync(path.join(__dirname, '../../assets/css/teacher/sections.css'), 'utf8');
  assert.match(css, /\.assignment-resubmission-options\s*\{[^}]*gap:\s*8px;/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.assignment-resubmission-options\s*\{[^}]*repeat\(3,/);

  const helpers = teacherScript.split('    function updateAssignmentResubmissionLimitVisibility(edit = false) {')[1]
    .split("    document.getElementById('assignOnlineSubmissionInput').addEventListener")[0];
  const elements = Object.fromEntries([
    'assignOnlineSubmissionInput', 'editAssignmentOnlineInput',
    'assignResubmissionLimitGroup', 'editAssignmentResubmissionLimitGroup',
    'editAssignmentLegacyResubmissionLimit'
  ].map(id => [id, { checked: false, hidden: true, textContent: '' }]));
  const choices = Object.fromEntries(['assignResubmissionLimit', 'editAssignmentResubmissionLimit']
    .map(name => [name, ['', '1', '2', '3', '4', '5'].map(value => ({ value, checked: false }))]));
  const context = vm.createContext({ document: {
    getElementById: id => elements[id],
    querySelectorAll: selector => choices[selector.match(/name="([^"]+)"/)[1]],
    querySelector: selector => choices[selector.match(/name="([^"]+)"/)[1]].find(choice => choice.checked)
  } });
  vm.runInContext(`function updateAssignmentResubmissionLimitVisibility(edit = false) {${helpers}`, context);
  for (const [toggle, group, edit] of [
    ['assignOnlineSubmissionInput', 'assignResubmissionLimitGroup', false],
    ['editAssignmentOnlineInput', 'editAssignmentResubmissionLimitGroup', true]
  ]) {
    elements[toggle].checked = true;
    context.updateAssignmentResubmissionLimitVisibility(edit);
    assert.equal(elements[group].hidden, false);
    elements[toggle].checked = false;
    context.updateAssignmentResubmissionLimitVisibility(edit);
    assert.equal(elements[group].hidden, true);
  }
  context.setAssignmentResubmissionLimit(false, null);
  assert.equal(context.selectedAssignmentResubmissionLimit(), null);
  context.setAssignmentResubmissionLimit(true, 3);
  assert.equal(context.selectedAssignmentResubmissionLimit(true), 3);
  elements.editAssignmentOnlineInput.checked = false;
  context.updateAssignmentResubmissionLimitVisibility(true);
  elements.editAssignmentOnlineInput.checked = true;
  context.updateAssignmentResubmissionLimitVisibility(true);
  assert.equal(context.selectedAssignmentResubmissionLimit(true), 3);
  context.setAssignmentResubmissionLimit(true, 0);
  assert.equal(context.selectedAssignmentResubmissionLimit(true), undefined);
  assert.match(elements.editAssignmentLegacyResubmissionLimit.textContent, /Current saved limit: 0/);
  context.setAssignmentResubmissionLimit(true, 8);
  assert.equal(context.selectedAssignmentResubmissionLimit(true), undefined);
  assert.match(elements.editAssignmentLegacyResubmissionLimit.textContent, /Current saved limit: 8/);
});

test('student replacement action becomes view-only when the limit is reached', () => {
  assert.match(studentHtml, /id="assignmentReplacementNotice"/);
  const helper = studentScript.match(/    function replacementLimitReached\(assignment, submission\) \{[\s\S]*?\n    \}/)?.[0];
  const row = studentScript.match(/      function renderAssignmentRow\(item\) \{[\s\S]*?\n      \}/)?.[0];
  assert.ok(helper && row);
  const submission = { fileName: 'work.pdf', resubmissionCount: 1 };
  const context = vm.createContext({
    submission,
    STATUS_META: { submitted: { label: 'Submitted', icon: 'check' } },
    ownSubmissionFor: () => submission,
    isElectiveAssignment: () => false,
    escapeHtml: value => String(value),
    formatDate: value => value
  });
  vm.runInContext(`${helper}\n${row}`, context);
  const assignment = {
    id: '4', title: 'Homework', subject: 'Math', teacher: 'Teacher',
    dueDate: '2026-11-15', status: 'submitted', onlineSubmissionEnabled: true,
    maxResubmissions: 1
  };
  const exhausted = context.renderAssignmentRow(assignment);
  assert.match(exhausted, /View submission/);
  assert.doesNotMatch(exhausted, /Replace file/);
  const available = context.renderAssignmentRow({ ...assignment, maxResubmissions: 2 });
  assert.match(available, /Replace file/);
});
