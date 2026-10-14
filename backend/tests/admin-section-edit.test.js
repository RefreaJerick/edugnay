const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-management.html'), 'utf8').replace(/\r\n/g, '\n');
const openEdit = html.split('function openSectionEditModal(card) {')[1]
  .split('\n}\n\nfunction openSectionDeleteConfirmation')[0];
const payloadSource = html.split("function managementApiSectionPayload(sectionData, sectionId = '') {")[1]
  .split('async function saveSectionForm(')[0];

function createContext(sections) {
  const ids = ['editAcademicYear', 'editSchoolLevel', 'editGradeLevel', 'editStrand', 'editStrandGroup',
    'sectionEditModalSub', 'editSectionName', 'editCapacity', 'editAdviser', 'editSectionId', 'sectionEditModalBackdrop'];
  const elements = new Map(ids.map(id => [id, {
    value: '', textContent: '', hidden: false, classList: { add() {} }
  }]));
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id) },
    managementSectionById: id => Object.values(sections).find(section => String(section.id) === String(id)) || null,
    managementLevelLabel: level => ({ elementary: 'Elementary', jhs: 'Junior High School', shs: 'Senior High School' }[level]),
    renderTeacherOptions() {}
  });
  vm.runInContext(`function openSectionEditModal(card) {${openEdit}\n}`, context);
  return { context, elements };
}

test('edit modal shows saved placement for each level without editable placement controls', () => {
  const sections = {
    elementary: { id: '1', name: 'St. John', academicYear: '2026–2027', level: 'elementary', grade: 'Grade 4', strand: '', capacity: 40 },
    jhs: { id: '2', name: 'St. Mark', academicYear: '2026–2027', level: 'jhs', grade: 'Grade 7', strand: '', capacity: 40 },
    shs: { id: '3', name: 'St. Luke', academicYear: '2026–2027', level: 'shs', grade: 'Grade 11', strand: 'STEM', capacity: 40 }
  };
  const page = createContext(sections);
  for (const section of Object.values(sections)) {
    page.context.openSectionEditModal({ dataset: { id: section.id } });
    assert.equal(page.elements.get('editAcademicYear').textContent, section.academicYear);
    assert.equal(page.elements.get('editGradeLevel').textContent, section.grade);
    assert.equal(page.elements.get('editStrand').textContent, section.strand || 'Not set');
    assert.equal(page.elements.get('editStrandGroup').hidden, !section.strand);
    assert.match(page.elements.get('sectionEditModalSub').textContent, /Academic placement cannot be changed/);
  }
  assert.match(html, /id="editSchoolLevel"\s*><\/div>/);
  assert.doesNotMatch(html, /<select[^>]*id="editSchoolLevel"/);
  assert.doesNotMatch(html, /<select[^>]*id="editGradeLevel"/);
});

test('edit modal does not substitute a configured grade for a disabled saved grade', () => {
  const page = createContext({ '2': { id: '2', name: 'St. Mark', level: 'jhs', grade: 'Grade 9', strand: '', capacity: 40 } });
  page.context.openSectionEditModal({ dataset: { id: '2' } });
  assert.equal(page.elements.get('editGradeLevel').textContent, 'Grade 9');
  assert.equal(page.elements.get('editSchoolLevel').textContent, 'Junior High School');
});

test('edit payload contains mutable fields only; create payload retains configured placement', () => {
  const structure = [{ id: 2, levelCode: 'jhs', gradeLevels: [{ id: 7, displayName: 'Grade 7' }] }];
  const context = vm.createContext({
    MANAGEMENT_API_CONTEXT: { structure, activeAcademicYear: { id: 9 } },
    managementGradeKey: value => String(value || '').trim().toLowerCase().replace(/^grade\s*/, ''),
    managementStrandKey: value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  });
  vm.runInContext(`function managementApiSectionPayload(sectionData, sectionId = '') {${payloadSource}`, context);
  const section = { level: 'jhs', grade: 'Grade 7', name: 'St. Mark', capacity: 40, adviserId: '12' };
  const edit = context.managementApiSectionPayload(section, '22');
  assert.deepEqual(JSON.parse(JSON.stringify(edit)), { name: 'St. Mark', capacity: 40, adviserUserId: 12 });
  const create = context.managementApiSectionPayload(section);
  assert.equal(create.academicYearId, 9);
  assert.equal(create.schoolLevelId, 2);
  assert.equal(create.gradeLevelId, 7);
});
