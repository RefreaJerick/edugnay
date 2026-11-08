const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const management = fs.readFileSync(path.join(__dirname, '../../assets/js/admin/management.js'), 'utf8').replace(/\r\n/g, '\n');

function sourceBetween(startMarker, endMarker) {
  const start = management.indexOf(startMarker);
  const end = management.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return management.slice(start, end).trim();
}

const sectionPathSource = sourceBetween('function managementSectionPath(section) {', '\nfunction managementStrandRequired(');
const moveContextSource = sourceBetween('function updateManagementMoveContext() {', '\nfunction updateManagementAssignmentFields(');
const moveFieldsSource = sourceBetween('function updateManagementMoveFields(changed = \'\') {', '\nfunction handleManagementStudentChange(');

function createHarness({ sections, studentSectionId, selectedTargetId = '', level = 'jhs', grade = 'Grade 7', track = '', trackOptions = [] }) {
  const contextValue = { textContent: '' };
  const sectionSelect = { value: selectedTargetId };
  const nodes = { moveCtxVal: contextValue, moveSectionSelect: sectionSelect };
  const renderedMoveFields = {};
  const state = {
    student: { id: '15', sectionId: studentSectionId },
    level,
    grade,
    track,
    strand: '',
    section: '',
    excludedSection: String(studentSectionId)
  };
  const context = vm.createContext({
    document: { getElementById: id => nodes[id] || null },
    managementMoveState: state,
    managementSectionRecords: () => sections,
    managementTrackOptions: () => trackOptions,
    managementStrandOptions: () => [],
    managementLevelLabel: value => ({ jhs: 'Junior High School', shs: 'Senior High School', elementary: 'Elementary' })[value] || value,
    managementRenderFields(_state, _ids, excludedSection, locked) {
      renderedMoveFields.excludedSection = excludedSection;
      renderedMoveFields.locked = locked;
    }
  });
  vm.runInContext(`${sectionPathSource}\n${moveContextSource}\n${moveFieldsSource}`, context);

  return { context, contextValue, sectionSelect, renderedMoveFields, state };
}

test('Move modal shows the current grade and section name without school level or ID', () => {
  const harness = createHarness({
    sections: [{ id: 108, level: 'jhs', grade: 'Grade 7', name: 'Section C', trackName: '' }],
    studentSectionId: 108
  });

  harness.context.updateManagementMoveContext();

  assert.equal(harness.contextValue.textContent, 'Currently in Grade 7 · Section C');
  assert.doesNotMatch(harness.contextValue.textContent, /Junior High School|108/);
});

test('Move modal includes the current SHS track when displaying the source section', () => {
  const harness = createHarness({
    sections: [{ id: '22', level: 'shs', grade: 'Grade 11', name: 'St. Luke', trackName: 'Academic' }],
    studentSectionId: 22,
    level: 'shs',
    grade: 'Grade 11'
  });

  harness.context.updateManagementMoveContext();

  assert.equal(harness.contextValue.textContent, 'Currently in Grade 11 · Academic · St. Luke');
  assert.doesNotMatch(harness.contextValue.textContent, /Senior High School|22/);
});

test('selected destination keeps its existing placement display', () => {
  const harness = createHarness({
    sections: [
      { id: '22', level: 'jhs', grade: 'Grade 7', name: 'Section A', trackName: '' },
      { id: '31', level: 'shs', grade: 'Grade 11', name: 'Section B', trackName: 'TechPro' }
    ],
    studentSectionId: '22',
    selectedTargetId: '31',
    level: 'shs',
    grade: 'Grade 11',
    track: '3',
    trackOptions: [{ id: '3', displayName: 'TechPro' }]
  });

  harness.context.updateManagementMoveContext();

  assert.equal(harness.contextValue.textContent, 'Senior High School · Grade 11 · TechPro · Section B');
});

test('missing source section details use a fallback without exposing the ID', () => {
  const harness = createHarness({
    sections: [{ id: '22', level: 'jhs', grade: 'Grade 7', name: 'Section A', trackName: '' }],
    studentSectionId: '108'
  });

  harness.context.updateManagementMoveContext();

  assert.equal(harness.contextValue.textContent, 'Current section details unavailable');
  assert.doesNotMatch(harness.contextValue.textContent, /108/);
});

test('current section ID remains excluded from the move destination fields', () => {
  const harness = createHarness({
    sections: [{ id: '108', level: 'jhs', grade: 'Grade 7', name: 'Section A', trackName: '' }],
    studentSectionId: '108'
  });

  harness.context.updateManagementMoveFields();

  assert.equal(harness.renderedMoveFields.excludedSection, '108');
  assert.equal(harness.renderedMoveFields.locked, true);
});
