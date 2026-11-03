const assert = require('node:assert/strict');
const fs = require('node:fs');
const pageFs = require('./helpers/page-fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');

test('school structure and section queries order by grade code rather than saved display order', () => {
  for (const file of ['backend/controllers/schoolsController.js', 'backend/controllers/sectionsController.js']) {
    const source = pageFs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /ORDER BY CASE school_levels\.level_code[\s\S]*?CAST\(SUBSTRING_INDEX\(school_grade_levels\.grade_code, '-', -1\) AS UNSIGNED\)/);
    assert.doesNotMatch(source, /ORDER BY school_grade_levels\.sort_order/);
  }
});

test('shared school settings offer Grades 2–12 only', () => {
  const source = pageFs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');
  const elementary = source.match(/key: 'elementary',[\s\S]*?grades: \[([^\]]+)\]/)?.[1] || '';
  assert.deepEqual([...elementary.matchAll(/'Grade (\d+)'/g)].map(match => Number(match[1])), [2, 3, 4, 5, 6]);
  assert.doesNotMatch(elementary, /Kindergarten|Grade 1/i);
});

test('teacher material grade choices sort numerically and retain the selected grade', () => {
  const html = pageFs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-dashboard.html'), 'utf8');
  const functionText = html.split('    function updateTeacherMaterialTargets() {')[1]
    .split('    function updateTeacherMaterialSections() {')[0];
  const gradeSelect = {
    value: '7',
    replaceChildren(...options) { this.options = options; }
  };
  const context = {
    TEACHER_MATERIAL_SECTIONS: ['10', '8', '7', '9'].map(grade => ({ grade })),
    document: { getElementById: () => gradeSelect },
    Option: function Option(label, value) { this.label = label; this.value = value; },
    formatTeacherMaterialGrade: grade => `Grade ${grade}`,
    updateTeacherMaterialSections() {}
  };
  vm.runInNewContext(`function updateTeacherMaterialTargets() {${functionText} updateTeacherMaterialTargets();`, context);
  assert.deepEqual(gradeSelect.options.map(option => option.label),
    ['Select a grade level', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10']);
  assert.equal(gradeSelect.value, '7');

  context.TEACHER_MATERIAL_SECTIONS = ['4', '3', '2'].map(grade => ({ grade }));
  vm.runInNewContext('updateTeacherMaterialTargets()', context);
  assert.deepEqual(gradeSelect.options.map(option => option.value), ['', '2', '3', '4']);
  assert.equal(gradeSelect.value, '');

  context.TEACHER_MATERIAL_SECTIONS = [{ grade: '9' }];
  vm.runInNewContext('updateTeacherMaterialTargets()', context);
  assert.deepEqual(gradeSelect.options.map(option => option.value), ['', '9']);
});
