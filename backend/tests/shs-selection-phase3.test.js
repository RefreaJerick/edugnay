const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { normalizeClassIds, validateRecordedChoices, meetingsConflict } = require('../config/shsSelection');
const controller = require('../controllers/shsSelectionController');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const elective = (id, code = `E${id}`, extra = {}) => ({ id, catalogCode: code, subjectName: code,
  classActive: 1, offeringActive: 1, teacherStatus: 'active', teacherRole: 'teacher', capacity: 20,
  enrolledCount: 0, instructionalHours: 80, meetings: [], ...extra });

test('release gate is off by default and conceals selection endpoints', () => {
  const previous = process.env.SHS_SELECTION_ENABLED;
  try {
    delete process.env.SHS_SELECTION_ENABLED;
    let nextCalled = false; let status; let body;
    controller.enabled({}, { status(code) { status = code; return this; }, json(value) { body = value; } }, () => { nextCalled = true; });
    assert.equal(status, 404); assert.equal(nextCalled, false); assert.match(body.message, /not available/i);
    process.env.SHS_SELECTION_ENABLED = 'true';
    controller.enabled({}, {}, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  } finally {
    if (previous === undefined) delete process.env.SHS_SELECTION_ENABLED;
    else process.env.SHS_SELECTION_ENABLED = previous;
  }
});

test('recorded choices do not require a pathway or hour total and may be unscheduled', () => {
  const classes = [elective(1, 'SCI-1', { instructionalHours: 35 }), elective(2, 'ART-2', { instructionalHours: 999, meetings: [] })];
  assert.deepEqual(normalizeClassIds(['1', 2]), [1, 2]);
  assert.deepEqual(validateRecordedChoices([1, 2], classes).selected, classes);
  assert.throws(() => normalizeClassIds([1, 1]), /only once/);
  assert.match(validateRecordedChoices([1, 3], classes).error, /not offered/);
});

test('choice checks reject duplicate subjects, inactive classes, full classes, and conflicts', () => {
  assert.match(validateRecordedChoices([1, 2], [elective(1, 'SAME'), elective(2, 'SAME')]).error, /one class for each subject/);
  assert.match(validateRecordedChoices([1], [elective(1, 'E1', { teacherStatus: 'inactive' })]).error, /inactive teacher/);
  assert.match(validateRecordedChoices([1], [elective(1, 'E1', { capacity: 1, enrolledCount: 1 })]).error, /no seats left/);
  const meeting = { weekday: 1, startTime: '09:00', endTime: '10:00', startDate: '2026-10-01', endDate: '2027-06-30' };
  assert.match(validateRecordedChoices([1], [elective(1, 'E1', { meetings: [meeting] })], [meeting]).error, /another class on the learner/);
  assert.match(validateRecordedChoices([1, 2], [elective(1, 'E1', { meetings: [meeting] }),
    elective(2, 'E2', { meetings: [{ ...meeting, startTime: '09:30', endTime: '10:30' }] })]).error, /overlapping meeting/);
});

test('adjacent meetings and disjoint effective dates are allowed; overlapping ones are not', () => {
  const a = [{ weekday: 1, startTime: '09:00', endTime: '10:00', startDate: '2026-10-01', endDate: '2026-12-31' }];
  const adjacent = [{ ...a[0], startTime: '10:00', endTime: '11:00' }];
  const overlap = [{ ...a[0], startTime: '09:30', endTime: '10:30' }];
  const nextYear = [{ ...overlap[0], startDate: '2027-01-01', endDate: '2027-06-30' }];
  assert.equal(meetingsConflict(a, adjacent), false);
  assert.equal(meetingsConflict(a, overlap), true);
  assert.equal(meetingsConflict(a, nextYear), false);
});

test('My Electives spaces its panels and uses shared empty, count, and checkbox treatments', () => {
  const student = read('views/student/edugnay-student-electives.html');
  const client = read('assets/js/student/shs-selection.js');
  const styles = read('assets/css/shs-program.css');
  const sharedStyles = read('assets/css/styles.css');
  const timetableStyles = read('assets/css/timetables.css');
  assert.match(student, /assets\/js\/student\/shs-selection\.js\?v=\d+/);
  assert.match(student, /assets\/js\/student\/shs-selection\.js\?v=7/);
  assert.match(student, /class="portal-overview" aria-labelledby="elective-page-title"[\s\S]*?Student workspace[\s\S]*?id="elective-page-title">My Electives[\s\S]*?id="elective-overview-context"/);
  const overview = student.match(/<section class="portal-overview"[\s\S]*?<\/section>/)?.[0] || '';
  assert.equal((overview.match(/class="portal-overview-description"/g) || []).length, 1);
  assert.doesNotMatch(overview, /then save them for staff confirmation|ask school staff to make changes/);
  assert.doesNotMatch(student, /shs-elective-intro/);
  assert.match(student, /class="timetable-card shs-saved-panel"[\s\S]*?class="timetable-heading"><div class="timetable-heading-title">[\s\S]*?<h2>Your saved choices<\/h2><\/div><\/div><div class="shs-selection-state" id="elective-selection-state"/);
  assert.doesNotMatch(student, /shs-saved-heading-line|shs-saved-heading-copy/);
  assert.match(student, /class="timetable-card shs-available-panel"[\s\S]*?id="elective-guidance-note"[\s\S]*?id="elective-classes"/);
  assert.doesNotMatch(student, /elective-status-detail/);
  assert.doesNotMatch(student, /id="elective-context"|shs-available-context/);
  assert.ok(student.indexOf('shs-saved-panel') < student.indexOf('shs-available-panel'));
  assert.doesNotMatch(student, /elective-saved-description/);
  assert.match(client, /\$\('elective-overview-context'\)\.textContent = placementContext/);
  assert.match(client, /Choose electives agreed on with your school\./);
  assert.doesNotMatch(client, /\$\('elective-context'\)/);
  assert.doesNotMatch(styles, /shs-available-context/);
  assert.match(student, /id="elective-saved-panel"/);
  assert.doesNotMatch(student, /id="elective-saved-panel" hidden/);
  assert.match(student, /class="shs-selection-state" id="elective-selection-state"/);
  assert.match(student, /class="shs-catalog-count" id="elective-summary"/);
  assert.match(student, /class="timetable-card shs-available-panel"[\s\S]*?id="elective-classes"[\s\S]*?class="shs-selection-footer"[\s\S]*?id="elective-submit"/);
  assert.doesNotMatch(student, /section class="timetable-card shs-selection-footer"/);
  assert.match(client, /function savedChoicesEmptyState\(/);
  assert.match(client, /renderPanelEmptyState\(/);
  assert.match(client, /title: 'No choices saved yet'/);
  assert.match(client, /hasLinkedClasses \? 'Saved classes unavailable'/);
  assert.match(client, /Choices are read-only/);
  assert.match(client, /const savedChoiceMarkup = hasSavedChoices \? savedChoices\.map/);
  assert.match(client, /\$\('elective-saved-choices'\)\.innerHTML = savedChoiceMarkup/);
  assert.match(client, /statusDetails\(displaySelection, savedChoices\.length\)/);
  assert.match(client, /selection\?\.savedClasses/);
  assert.match(client, /selection\.dataIssue/);
  assert.match(client, /\$\('elective-selection-state'\)\.hidden = !hasSavedChoices/);
  assert.match(client, /\$\('elective-summary'\)\.textContent = `\$\{selected\.length\} selected`/);
  assert.match(client, /label: 'Confirmed by your school'/);
  assert.match(client, /label: 'Waiting for school confirmation'/);
  assert.match(client, /label: 'Not recorded'/);
  assert.match(client, /function choiceGuidance\(/);
  assert.match(client, /guidanceNote\.hidden = !guidanceNote\.textContent/);
  assert.match(student, /id="elective-requirement-note"/);
  assert.match(client, /Grade 12 TechPro students must choose Work Immersion/);
  assert.match(client, /function workImmersionStatus\(/);
  assert.match(client, /!immersion\.satisfied/);
  assert.doesNotMatch(student.match(/class="timetable-card shs-available-panel"[\s\S]*?<\/section>/)?.[0] || '', /elective-selection-state|elective-status-detail/);
  assert.match(timetableStyles, /\.timetable-heading \{ display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap/);
  assert.match(timetableStyles, /@media \(max-width: 560px\) \{ \.timetable-heading \{ align-items: flex-start; flex-direction: column; \}/);
  assert.doesNotMatch(styles, /shs-saved-heading-line/);
  assert.match(styles, /\.shs-selection-state \{ display: inline-flex;[^}]*max-width: 100%;/);
  assert.match(styles, /\.shs-selection-state \.badge \{ max-width: 100%; white-space: normal; \}/);
  assert.match(client, /label: 'Changes requested'/);
  assert.match(styles, /#elective-content:not\(\[hidden\]\) \{ display: grid; gap: 18px;/);
  assert.match(styles, /#elective-content > \.portal-overview \{ margin-bottom: 0; \}/);
  assert.match(styles, /\.shs-saved-choices \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 1180px\) \{[\s\S]*?\.shs-saved-choices \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.shs-saved-choices \{ grid-template-columns: 1fr; \}/);
  assert.match(styles, /\.shs-saved-choices > \.panel-empty-state \{ grid-column: 1 \/ -1; \}/);
  assert.match(sharedStyles, /\.panel-empty-state \{[^}]*background: var\(--panel-bg\)/);
  assert.match(sharedStyles, /\.panel-empty-state-icon \{[^}]*color: var\(--theme-accent-text\)/);
  assert.match(sharedStyles, /\.portal-overview-description \{\s*max-width: 560px;/);
  assert.doesNotMatch(styles, /grid-template-columns: 320px minmax\(0, 1fr\)/);
  assert.match(styles, /\.shs-saved-choice \{[^}]*background: var\(--theme-surface\)/);
  assert.match(styles, /\.shs-saved-choice strong \{ overflow-wrap: anywhere/);
  assert.match(styles, /\.shs-saved-choice-schedule \{[^}]*border-top: 1px solid var\(--panel-divider\)/);
  assert.match(client, /class="sf-template-choice shs-choice/);
  assert.doesNotMatch(styles, /#elective-classes \.shs-choice input \{ width: 18px/);
  assert.match(styles, /\.shs-selection-footer \.timetable-button \{ width: 100%; \}/);
});

test('Grade 12 TechPro students must select an offered Work Immersion class before saving', () => {
  const source = read('assets/js/student/shs-selection.js');
  const nodes = new Map();
  const context = {
    document: { getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', hidden: false, disabled: false });
      return nodes.get(id);
    } },
    window: {
      EDUGNAY_CONFIG: { renderPanelEmptyState: () => '<div class="panel-empty-state"></div>' },
      lucide: { createIcons() {} }
    }
  };
  vm.runInNewContext(source.replace("document.addEventListener('DOMContentLoaded', init);",
    'window.electiveTest = { setData(value) { data = value; }, chosen, render };'), context);
  const immersion = { id: 301, catalogCode: 'WI-320', subjectName: 'Work Immersion',
    catalogGroup: 'techpro_work_immersion', assessmentGroup: 'work_immersion', trackCode: 'techpro',
    catalogValid: true, catalogGradeEligible: true, catalogAvailableForNewUse: true,
    gradeCode: 'grade-12', instructionalHours: 320, hoursUnit: 'per_term',
    className: 'Immersion placement', teacherName: 'Teacher', capacity: 40, enrolledCount: 0, meetings: [] };
  const placement = { gradeCode: 'grade-12', sectionName: 'QA-only', trackCode: 'techpro', yearStatus: 'active' };
  context.window.electiveTest.setData({ placement, classes: [immersion] });
  context.window.electiveTest.render();
  assert.match(nodes.get('elective-overview-context').textContent,
    /QA-only.*Grade 12.*TechPro track.*Choose electives agreed on with your school\.$/);
  assert.equal(nodes.get('elective-submit').disabled, true);
  assert.match(nodes.get('elective-requirement-note').textContent, /Choose exactly one available Work Immersion/);
  assert.match(nodes.get('elective-classes').innerHTML, /TechPro Work Immersion.*Required/);

  context.window.electiveTest.chosen.add(301);
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-submit').disabled, false);
  assert.match(nodes.get('elective-requirement-note').textContent, /included in your selection/);

  context.window.electiveTest.chosen.clear();
  context.window.electiveTest.setData({ placement, classes: [] });
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-submit').disabled, true);
  assert.match(nodes.get('elective-requirement-note').textContent, /not offered an eligible class.*add one before saving/i);

  const longSectionName = 'Grade 12 Technical Vocational Livelihood Industry Immersion Cohort';
  context.window.electiveTest.setData({ placement: { ...placement, sectionName: longSectionName }, classes: [immersion] });
  context.window.electiveTest.render();
  assert.match(nodes.get('elective-overview-context').textContent, new RegExp(longSectionName));
});

test('available elective cards keep selection behavior and give class details a clear hierarchy', () => {
  const source = read('assets/js/student/shs-selection.js');
  const styles = read('assets/css/shs-program.css');
  const nodes = new Map();
  let iconsRendered = 0;
  const context = {
    document: { getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', hidden: false, disabled: false });
      return nodes.get(id);
    } },
    window: {
      EDUGNAY_CONFIG: { renderPanelEmptyState: options =>
        `<div class="panel-empty-state" role="status"><div class="panel-empty-state-icon"><i data-lucide="${options.icon}"></i></div><div class="panel-empty-state-title">${options.title}</div><div class="panel-empty-state-text">${options.text}</div></div>` },
      lucide: { createIcons() { iconsRendered++; } }
    }
  };
  vm.runInNewContext(source.replace("document.addEventListener('DOMContentLoaded', init);",
    'window.electiveTest = { setData(value) { data = value; }, chosen, render, restoreSavedChoices };'), context);
  const item = { id: 1, catalogCode: 'LIT-1', subjectName: 'Contemporary Literature & Writing',
    catalogGroup: 'academic_electives', clusterName: 'Arts, Social Sciences, and Humanities',
    trackCode: 'academic', gradeCode: 'grade-11', instructionalHours: 80, hoursUnit: 'per_term',
    className: 'QA AE011', teacherName: 'Carlo Reyes', capacity: 40, enrolledCount: 0,
    meetings: [
      { weekday: 2, startTime: '09:00', endTime: '10:00', room: 'Room 204' },
      { weekday: 4, startTime: '11:00', endTime: '12:00' }
    ] };
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'active' },
    classes: [item, { ...item, id: 2, catalogCode: 'LIT-2', subjectName: 'Other subject', meetings: [], unavailableReason: 'No seats left.' }]
  });
  context.window.electiveTest.render();
  assert.match(nodes.get('elective-overview-context').textContent,
    /QA-only.*Grade 11.*Academic track.*Choose electives agreed on with your school\.$/);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /class="panel-empty-state"/);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /class="panel-empty-state-icon"/);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /class="panel-empty-state-title">No choices saved yet/);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /class="panel-empty-state-text">Select classes below to send your choices for school confirmation/);
  assert.equal(nodes.get('elective-selection-state').hidden, true);
  assert.equal(nodes.get('elective-guidance-note').hidden, true);
  const markup = nodes.get('elective-classes').innerHTML;
  assert.match(markup, /class="shs-choice-head"><strong>Contemporary Literature &amp; Writing<\/strong>/);
  assert.match(markup, /class="badge badge-gray shs-choice-seats">40 seats left<\/span>/);
  assert.match(markup, /Academic elective &middot; Arts, Social Sciences, and Humanities/);
  assert.match(markup, /class="shs-choice-hours">80 hours per term/);
  assert.match(markup, /QA AE011 &middot; Carlo Reyes/);
  assert.match(markup, /data-lucide="calendar-days" aria-hidden="true"/);
  assert.match(markup, /Tue 09:00–10:00 · Room 204, Thu 11:00–12:00/);
  assert.match(markup, /Schedule not set yet/);
  assert.match(markup, /No seats left\./);
  assert.match(markup, /value="2"[^>]*disabled/);
  assert.equal(nodes.get('elective-summary').textContent, '0 selected');
  assert.equal(nodes.get('elective-submit').disabled, true);
  context.window.electiveTest.chosen.add(1);
  context.window.electiveTest.render();
  assert.match(nodes.get('elective-classes').innerHTML, /value="1" checked/);
  assert.equal(nodes.get('elective-summary').textContent, '1 selected');
  assert.equal(nodes.get('elective-submit').disabled, false);
  assert.equal(iconsRendered, 2);
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'active' },
    selection: { status: 'pending', classIds: [], savedClasses: [], dataIssue: false }, classes: [item]
  });
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-status').textContent, 'Not recorded');
  assert.match(nodes.get('elective-saved-choices').innerHTML, /class="panel-empty-state-title">No choices saved yet/);
  assert.equal(nodes.get('elective-selection-state').hidden, true);
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'active' },
    selection: { status: '', classIds: [], savedClasses: [], dataIssue: false }, classes: [item]
  });
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-status').textContent, 'Not recorded');
  assert.match(nodes.get('elective-saved-choices').innerHTML, /class="panel-empty-state-title">No choices saved yet/);
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'active' },
    selection: { status: 'pending', classIds: [], savedClasses: [], dataIssue: true }, classes: [item]
  });
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-status').textContent, 'Not recorded');
  assert.match(nodes.get('elective-saved-choices').innerHTML, /class="panel-empty-state-title">No choices saved yet/);
  assert.equal(nodes.get('elective-selection-state').hidden, true);
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'active' },
    selection: { status: 'pending', classIds: [1], dataIssue: false }, classes: [item]
  });
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-selection-state').hidden, false);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /class="shs-saved-choice"/);
  assert.equal(nodes.get('elective-status').textContent, 'Waiting for school confirmation');
  assert.equal(nodes.get('elective-guidance-note').hidden, true);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /<strong>Contemporary Literature &amp; Writing<\/strong>/);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /QA AE011 &middot; Carlo Reyes/);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /class="shs-saved-choice-schedule">Tue 09:00-10:00/);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /Thu 11:00-12:00/);
  assert.doesNotMatch(nodes.get('elective-saved-choices').innerHTML, /Academic elective|80 hours per term/);
  const pausedItem = { ...item, id: 3, unavailableReason: 'Class or subject is paused' };
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'active' },
    selection: { status: 'pending', classIds: [3], savedClasses: [pausedItem], dataIssue: false }, classes: []
  });
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-status').textContent, 'Waiting for school confirmation');
  assert.match(nodes.get('elective-saved-choices').innerHTML, /Contemporary Literature/);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /Class or subject is paused/);
  context.window.electiveTest.chosen.clear();
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'active' },
    selection: { status: 'pending', classIds: [1, 99], savedClasses: [item], dataIssue: false }, classes: [item]
  });
  context.window.electiveTest.restoreSavedChoices();
  context.window.electiveTest.render();
  assert.match(nodes.get('elective-saved-choices').innerHTML, /class="shs-saved-choice"/);
  assert.equal(nodes.get('elective-status').textContent, 'Choice record needs school review');
  assert.match(nodes.get('elective-guidance-note').textContent, /could not be matched/);
  assert.equal(nodes.get('elective-selection-state').hidden, false);
  assert.equal(nodes.get('elective-guidance-note').hidden, false);
  assert.doesNotMatch(nodes.get('elective-saved-choices').innerHTML, /class="panel-empty-state"/);
  assert.equal([...context.window.electiveTest.chosen].join(','), '1');
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'active' },
    selection: { status: 'pending', classIds: [99], savedClasses: [], dataIssue: false }, classes: [item]
  });
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-status').textContent, 'Choice record needs school review');
  assert.match(nodes.get('elective-saved-choices').innerHTML, /class="panel-empty-state-title">Saved classes unavailable/);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /Contact school staff to review this record/);
  assert.equal(nodes.get('elective-selection-state').hidden, true);
  assert.equal(nodes.get('elective-guidance-note').hidden, true);
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'active' },
    selection: { status: 'not_recorded', classIds: [], savedClasses: [], dataIssue: false }, classes: [item]
  });
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-status').textContent, 'Not recorded');
  assert.match(nodes.get('elective-saved-choices').innerHTML, /class="panel-empty-state-title">No choices saved yet/);
  assert.equal(nodes.get('elective-selection-state').hidden, true);
  assert.equal(nodes.get('elective-guidance-note').hidden, true);
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'active' },
    selection: { status: 'rejected', decisionReason: 'Choose a class with an open seat.', classIds: [1] }, classes: [item]
  });
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-status').textContent, 'Changes requested');
  assert.match(nodes.get('elective-guidance-note').textContent, /Choose a class with an open seat/);
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'active' },
    selection: { status: 'approved', classIds: [1], savedClasses: [item], dataIssue: false }, classes: [item, { ...item, id: 2, catalogCode: 'LIT-2', subjectName: 'New class' }]
  });
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-status').textContent, 'Confirmed by your school');
  assert.equal(nodes.get('elective-selection-state').hidden, false);
  assert.equal(nodes.get('elective-guidance-note').hidden, false);
  assert.match(nodes.get('elective-classes').innerHTML, /value="2"[^>]*disabled/);
  assert.equal(nodes.get('elective-submit').disabled, true);
  assert.equal(nodes.get('elective-guidance-note').hidden, false);
  assert.match(nodes.get('elective-guidance-note').textContent, /Newly added classes/);
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'active' },
    selection: { status: 'approved', classIds: [], savedClasses: [], dataIssue: true }, classes: [item]
  });
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-status').textContent, 'Choice record needs school review');
  assert.match(nodes.get('elective-saved-choices').innerHTML, /Choice record needs school review/);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /confirmed request has no saved classes linked/);
  assert.equal(nodes.get('elective-selection-state').hidden, true);
  assert.equal(nodes.get('elective-submit').disabled, true);
  context.window.electiveTest.chosen.clear();
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'active' },
    selection: { status: 'not_recorded', classIds: [] }, classes: [item]
  });
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-status').textContent, 'Not recorded');
  assert.equal(nodes.get('elective-guidance-note').hidden, true);
  assert.doesNotMatch(nodes.get('elective-classes').innerHTML, /value="1"[^>]*disabled/);
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'archived' },
    selection: { status: 'pending', classIds: [1] }, classes: [item]
  });
  context.window.electiveTest.render();
  assert.match(nodes.get('elective-guidance-note').textContent, /school year is closed/);
  assert.match(nodes.get('elective-guidance-note').textContent, /Choices are read-only/);
  assert.doesNotMatch(nodes.get('elective-guidance-note').textContent, /You can update/);
  assert.equal(nodes.get('elective-submit').disabled, true);
  context.window.electiveTest.setData({
    placement: { gradeCode: 'grade-11', sectionName: 'QA-only', trackCode: 'academic', yearStatus: 'archived' },
    selection: { status: 'not_recorded', classIds: [] }, classes: [item]
  });
  context.window.electiveTest.render();
  assert.equal(nodes.get('elective-selection-state').hidden, true);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /class="panel-empty-state-title">No saved choices for this school year/);
  assert.match(nodes.get('elective-saved-choices').innerHTML, /This school year is closed\. Choices are read-only\./);
  assert.match(styles, /#elective-classes \.shs-choice-head \{[^}]*justify-content: space-between/);
  assert.match(styles, /#elective-classes \.shs-choice-schedule \{[^}]*border-top: 1px solid var\(--panel-divider\)/);
  assert.match(styles, /#elective-classes \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 1180px\) \{[\s\S]*?#elective-classes \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?#elective-classes \{ grid-template-columns: 1fr/);
  assert.match(styles, /#elective-classes \.shs-choice-head \{[^}]*flex-wrap: wrap/);
  assert.match(styles, /#elective-classes \.shs-choice-seats\.badge \{[^}]*white-space: normal; overflow-wrap: anywhere/);
  assert.match(styles, /#elective-classes > \.panel-empty-state \{ grid-column: 1 \/ -1/);
  assert.match(styles, /@media \(max-width: 520px\) \{\s*#elective-classes \.shs-choice-head \{ flex-direction: column/);
  assert.match(styles, /@media \(max-width: 520px\) \{[\s\S]*?#elective-classes \.shs-choice-head > strong \{ flex: 0 0 auto; width: 100%; \}/);
  assert.match(source, /querySelector\(`input\[type="checkbox"\]\[value="\$\{classId\}"\]`\)\?\.focus\(\)/);
});

test('selection API treats an empty legacy status without class links as not recorded', async () => {
  const source = read('backend/controllers/shsSelectionController.js');
  const choiceDataSource = source.slice(source.indexOf('async function choiceData('), source.indexOf('\nasync function studentView('));
  let requestStatus = '';
  const context = {
    placement: async () => ({ yearId: 20, gradeId: 11, sectionId: 41 }),
    requestFor: async () => ({ id: 7, status: requestStatus, revision: 2, decision_reason: null }),
    execute: async () => [], classRows: async () => [], homeMeetings: async () => []
  };
  const choiceData = vm.runInNewContext(`${choiceDataSource}\nchoiceData`, context);
  const cleared = await choiceData({}, 3, 5);
  assert.equal(cleared.selection.status, 'not_recorded');
  assert.equal(cleared.selection.classIds.length, 0);
  assert.equal(cleared.selection.savedClasses.length, 0);
  assert.equal(cleared.selection.dataIssue, false);
  requestStatus = 'approved';
  const confirmed = await choiceData({}, 3, 5);
  assert.equal(confirmed.selection.status, 'approved');
  assert.equal(confirmed.selection.dataIssue, true);
});

test('student choices remain gated, pathway-free, and separate from confirmed memberships', () => {
  const migration = read('backend/database/migrations/052_shs_elective_selection.sql');
  const route = read('backend/routes/shsSelection.js');
  const server = read('backend/server.js');
  const student = read('views/student/edugnay-student-electives.html');
  const admin = read('views/admin/edugnay-admin-shs-program.html');
  assert.match(migration, /CREATE TABLE shs_selection_requests/);
  assert.match(migration, /CREATE TABLE shs_selection_request_classes/);
  assert.match(migration, /CREATE TABLE shs_selection_history/);
  assert.match(migration, /CREATE TABLE shs_verified_prior_electives/);
  assert.match(route, /router\.use\(requireAuth, requireSchoolUser, controller\.enabled\)/);
  assert.match(route, /requireStudent, controller\.submit/);
  assert.match(route, /requireSchoolAdmin, controller\.decide/);
  assert.match(route, /router\.get\('\/students', requireSchoolAdmin, controller\.adminList\)/);
  assert.match(route, /controller\.staffStudentChoices/);
  assert.match(route, /controller\.recordStudentChoices/);
  assert.doesNotMatch(route, /\/windows\//);
  assert.doesNotMatch(route, /prior-electives|verifyPrior|recordPrior/);
  assert.match(server, /\/api\/shs-selection/);
  assert.match(student, /id="elective-content" hidden/);
  assert.match(student, /My Electives/);
  assert.match(student, /Save my choices/);
  assert.match(student, /Your saved choices/);
  assert.match(admin, /id="shs-panel-subjects"/);
  assert.match(admin, /id="shs-panel-choices"/);
  assert.match(admin, /Subject classes/);
  assert.match(admin, /Student choices/);
  assert.doesNotMatch(admin, /Pathway readiness|Grade 12 program completion|shs-completion-list|shs-readiness/i);
  assert.match(admin, /id="shs-choice-review-actions"/);
  assert.match(admin, /id="shs-choice-confirm"/);
  assert.match(admin, /id="shs-choice-return"/);
  const choiceDialog = admin.split('id="shs-choice-overlay"')[1].split('id="shs-choice-clear-overlay"')[0];
  assert.match(choiceDialog, /class="form-label" for="shs-choice-decision-note"/);
  assert.match(choiceDialog, /class="form-textarea" id="shs-choice-decision-note"/);
  const choiceFooter = choiceDialog.split('class="modal-foot shs-choice-footer"')[1];
  assert.doesNotMatch(choiceDialog.split('class="modal-foot shs-choice-footer"')[0], /id="shs-choice-(confirm|return|save)"/);
  assert.match(choiceFooter, /id="shs-choice-cancel"[\s\S]*id="shs-choice-return"[\s\S]*id="shs-choice-confirm"[\s\S]*id="shs-choice-save"/);
  const shsStyles = read('assets/css/shs-program.css');
  assert.match(shsStyles, /\.shs-choice-footer > \[hidden\]/);
  assert.doesNotMatch(shsStyles, /\.shs-review-actions (?:label|textarea)|\.shs-review-class-choices label|\.shs-review-choice \{[^}]*border:/);
  assert.match(admin, /id="shs-roster-controls" hidden/);
  assert.match(admin, /id="shs-roster-pagination" hidden/);
  assert.doesNotMatch(student, /elective-pathway|elective-window|Target:/i);
  assert.match(admin, /Not recorded/);
  assert.match(admin, /Waiting for school confirmation/);
  assert.match(admin, /Changes requested/);
  assert.match(admin, /id="shs-roster-prev"/);
  assert.match(admin, /Edit confirmed choices|shs-choice-clear/);
  assert.match(route, /\/requests\/:requestId\/clear', requireSchoolAdmin, controller\.clearApproved/);
  const studentPages = fs.readdirSync(path.join(root, 'views/student')).filter(name => name.endsWith('.html'));
  for (const page of studentPages) {
    assert.match(read(`views/student/${page}`), /data-student-access="electives"/, `${page} needs the conditional link`);
  }
  assert.match(read('assets/css/styles.css'), /html\.student-nav-hide-electives \.sidebar a\[data-student-access="electives"\]/);
  for (const page of studentPages) assert.doesNotMatch(read(`views/student/${page}`), />Elective Selection</);
  assert.match(read('assets/js/student/shell.js'), /portalElectivesEligible && identity/);
  assert.doesNotMatch(read('assets/js/student/shell.js'), /getShsSelection\(\)/);
  const controllerSource = read('backend/controllers/shsSelectionController.js');
  const adminClient = read('assets/js/admin/shs-program.js');
  assert.match(adminClient, /class="sf-template-choice shs-choice shs-review-choice/);
  assert.match(adminClient, /<strong>\$\{escape\(item\.subjectName\)\}<\/strong><small class="shs-choice-category">/);
  assert.match(adminClient, /textContent = `\$\{item\.studentName \|\| 'Learner'\} · Grade/);
  assert.match(shsStyles, /\.shs-review-choice \{ align-items: flex-start; gap: 8px; padding: 8px 10px; \}/);
  assert.match(shsStyles, /\.shs-review-choice > span \{ display: grid; gap: 2px;/);
  assert.match(shsStyles, /\.shs-review-choice > span strong \{[^}]*font-size: 13px; font-weight: 700/);
  assert.match(shsStyles, /\.shs-review-choice > span small \{ font-size: 11px; font-weight: 400/);
  const rosterRenderer = adminClient.split('function renderReviews(')[1].split('\n  async function loadReviews(')[0];
  assert.match(adminClient, /pageSize: 25/);
  assert.match(adminClient, /addEventListener\('keydown',[\s\S]*ArrowLeft[\s\S]*Home[\s\S]*End/);
  assert.doesNotMatch(rosterRenderer, /shs-review-actions|data-confirm-choice|data-return-choice/);
  assert.match(adminClient, /async function decideChoice\(/);
  assert.doesNotMatch(controllerSource, /legacyStudentView|legacySubmit|legacyAdminList|legacyDecide|legacyChangeApproved|windowFor/);
  const bodyOf = name => controllerSource.split(`async function ${name}(`)[1].split('\nasync function ')[0];
  assert.match(bodyOf('submit'), /normalizeClassIds\(req\.body\?\.classIds\)/);
  assert.doesNotMatch(bodyOf('submit'), /pathway|windowFor|validateSelection/);
  assert.match(bodyOf('adminList'), /LEFT JOIN shs_selection_requests/);
  assert.match(bodyOf('adminList'), /LIMIT \? OFFSET \?/);
  assert.match(bodyOf('decide'), /SELECT status FROM academic_years[\s\S]*FOR UPDATE/);
  assert.match(bodyOf('decide'), /syncMemberships/);
  assert.match(bodyOf('changeApproved'), /syncMemberships/);
  assert.match(bodyOf('syncMemberships'), /withdrawn_at = NOW\(\)/);
  assert.doesNotMatch(controllerSource, /priorElectives|verifyPrior|recordPrior/);
  const programRoute = read('backend/routes/shsProgram.js');
  assert.doesNotMatch(programRoute, /completion|confirm/);
  assert.doesNotMatch(read('assets/js/admin/shs-program.js'), /getShsCompletion|confirmShsCompletion|verifyShsPrior|recordShsPrior|loadCompletion|renderCompletion/);
  assert.doesNotMatch(read('assets/js/shell-common.js'), /getShsCompletion|confirmShsCompletion|verifyShsPrior|recordShsPrior/);
});

test('Student choices cards share the Subject classes layout and keep one direct action', () => {
  const styles = read('assets/css/shs-program.css');
  const client = read('assets/js/admin/shs-program.js');
  const roster = client.split('function renderReviews(')[1].split('\n  async function loadReviews(')[0];
  assert.match(styles, /\.shs-reviews \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 1180px\) \{[\s\S]*?\.shs-reviews \{ grid-template-columns: repeat\(2/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.shs-reviews \{ grid-template-columns: 1fr/);
  assert.match(styles, /\.shs-reviews > \.panel-empty-state/);
  assert.match(roster, /class="shs-review"[\s\S]*?class="shs-roster-actions"/);
  assert.match(roster, /data-manage-choices/);
  assert.doesNotMatch(roster, /class-menu|more-vertical/);
});

test('staff sees confirmed records with missing choices as read-only review issues', () => {
  const source = read('assets/js/admin/shs-program.js');
  const nodes = new Map();
  const context = {
    document: { getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', hidden: false, disabled: false });
      return nodes.get(id);
    } },
    window: {
      EDUGNAY_CONFIG: { renderPanelEmptyState: () => '<div class="panel-empty-state"></div>' },
      lucide: { createIcons() {} }
    }
  };
  vm.runInNewContext(source.replace(
    "document.addEventListener('DOMContentLoaded', () => { if ($('shs-program-page')) init(); });",
    'window.reviewTest = { renderReviews, renderChoiceClasses, setChoiceData(value) { state.choiceData = value; state.choiceStatus = value.selection?.status || "not_recorded"; } };'
  ), context);
  context.window.reviewTest.renderReviews({ year: { status: 'active' }, page: 1, pageSize: 25, total: 1, pages: 1,
    students: [{ studentId: 41, studentName: 'Confirmed learner', sectionName: 'QA-only', gradeCode: 'grade-11',
      trackCode: 'academic', requestId: 8, status: 'approved', dataIssue: true }] });
  assert.match(nodes.get('shs-reviews').innerHTML, /Choice record needs review/);
  assert.match(nodes.get('shs-reviews').innerHTML, /Review record/);
  assert.match(nodes.get('shs-reviews').innerHTML, /Existing class placements were left unchanged/);

  const selected = { id: 1, subjectName: 'Contemporary Literature', className: 'Class A', teacherName: 'Teacher',
    capacity: 40, enrolledCount: 0, instructionalHours: 80, gradeCode: 'grade-11', catalogGroup: 'academic_electives', meetings: [] };
  context.window.reviewTest.setChoiceData({ canEdit: true, selection: { status: 'approved', classIds: [], dataIssue: true }, classes: [selected] });
  context.window.reviewTest.renderChoiceClasses();
  assert.match(nodes.get('shs-choice-classes').innerHTML, /disabled/);
  assert.equal(nodes.get('shs-choice-save').disabled, true);
  assert.equal(nodes.get('shs-choice-clear').hidden, true);
  assert.equal(nodes.get('shs-choice-empty-help').hidden, false);
});

test('staff treats empty pending requests as not recorded and offers recording choices', () => {
  const controllerSource = read('backend/controllers/shsSelectionController.js');
  const adminList = controllerSource.split('async function adminList(')[1].split('\nasync function ')[0];
  assert.match(adminList, /r\.status IN \('pending', 'rejected'\) OR r\.status = ''\) AND \$\{noSavedLinks\}/);
  assert.match(adminList, /THEN 'not_recorded' ELSE r\.status END AS requestStatus/);
  assert.match(controllerSource, /if \(!classIds\.length\) fail\('This request has no saved classes and cannot be reviewed\.'/);

  const source = read('assets/js/admin/shs-program.js');
  const nodes = new Map();
  const context = {
    document: { getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', hidden: false, disabled: false });
      return nodes.get(id);
    } },
    window: { EDUGNAY_CONFIG: { renderPanelEmptyState: () => '<div class="panel-empty-state"></div>' }, lucide: { createIcons() {} } }
  };
  vm.runInNewContext(source.replace(
    "document.addEventListener('DOMContentLoaded', () => { if ($('shs-program-page')) init(); });",
    'window.reviewTest = { renderReviews };'
  ), context);
  context.window.reviewTest.renderReviews({ year: { status: 'active' }, page: 1, pageSize: 25, total: 1, pages: 1,
    students: [{ studentId: 42, studentName: 'Learner', sectionName: 'QA-only', gradeCode: 'grade-11',
      trackCode: 'academic', requestId: 9, status: 'not_recorded', dataIssue: false }] });
  assert.match(nodes.get('shs-reviews').innerHTML, /Not recorded/);
  assert.match(nodes.get('shs-reviews').innerHTML, /Record choices/);
  assert.doesNotMatch(nodes.get('shs-reviews').innerHTML, /Review choices|Waiting for school confirmation/);
});

test('staff can select a newly added class in the confirmed-choice editor', () => {
  const source = read('assets/js/admin/shs-program.js');
  const nodes = new Map();
  const context = {
    document: { getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', hidden: false, disabled: false, value: '' });
      return nodes.get(id);
    } },
    window: { EDUGNAY_CONFIG: { renderPanelEmptyState: () => '<div class="panel-empty-state"></div>' } }
  };
  vm.runInNewContext(source.replace(
    "document.addEventListener('DOMContentLoaded', () => { if ($('shs-program-page')) init(); });",
    "window.shsChoiceTest = { setData(value) { state.choiceData = value; state.choiceStatus = value.selection?.status || 'not_recorded'; }, renderChoiceClasses };"
  ), context);
  const selected = { id: 1, subjectName: 'Contemporary Literature', className: 'Class A', teacherName: 'Teacher',
    capacity: 40, enrolledCount: 1, instructionalHours: 80, gradeCode: 'grade-11', catalogGroup: 'academic_electives', meetings: [] };
  context.window.shsChoiceTest.setData({ canEdit: true, selection: { status: 'approved', classIds: [1] },
    classes: [selected, { ...selected, id: 2, subjectName: 'Creative Composition', className: 'Class B' }] });
  context.window.shsChoiceTest.renderChoiceClasses();
  assert.match(nodes.get('shs-choice-classes').innerHTML, /value="1" checked/);
  assert.doesNotMatch(nodes.get('shs-choice-classes').innerHTML, /value="2"[^>]*disabled/);
  assert.equal(nodes.get('shs-choice-save').disabled, false);
  assert.equal(nodes.get('shs-choice-clear').hidden, false);
  context.window.shsChoiceTest.setData({ canEdit: false, selection: { status: 'approved', classIds: [1] }, classes: [selected] });
  context.window.shsChoiceTest.renderChoiceClasses();
  assert.equal(nodes.get('shs-choice-clear').hidden, true);
  assert.equal(nodes.get('shs-choice-save').disabled, true);
});

test('Grade 12 TechPro staff choices cannot be saved or confirmed without Work Immersion', () => {
  const source = read('assets/js/admin/shs-program.js');
  const nodes = new Map();
  const context = {
    document: { getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', hidden: false, disabled: false, value: '' });
      return nodes.get(id);
    } },
    window: { EDUGNAY_CONFIG: { renderPanelEmptyState: () => '<div class="panel-empty-state"></div>' } }
  };
  vm.runInNewContext(source.replace(
    "document.addEventListener('DOMContentLoaded', () => { if ($('shs-program-page')) init(); });",
    "window.shsChoiceTest = { setData(value) { state.choiceData = value; state.choiceStatus = value.selection?.status || 'not_recorded'; }, renderChoiceClasses };"
  ), context);
  const placement = { gradeCode: 'grade-12', trackCode: 'techpro' };
  const immersion = { id: 401, subjectName: 'Work Immersion', className: 'Immersion class', teacherName: 'Teacher',
    catalogGroup: 'techpro_work_immersion', assessmentGroup: 'work_immersion', trackCode: 'techpro', gradeCode: 'grade-12',
    catalogValid: true, catalogGradeEligible: true, catalogAvailableForNewUse: true,
    capacity: 40, enrolledCount: 0, instructionalHours: 320, meetings: [] };
  context.window.shsChoiceTest.setData({ canEdit: true, placement,
    selection: { status: 'pending', classIds: [] }, classes: [immersion] });
  context.window.shsChoiceTest.renderChoiceClasses();
  assert.equal(nodes.get('shs-choice-save').disabled, true);
  assert.equal(nodes.get('shs-choice-save').hidden, true);
  assert.equal(nodes.get('shs-choice-confirm').disabled, true);
  assert.equal(nodes.get('shs-choice-confirm').hidden, false);
  assert.equal(nodes.get('shs-choice-return').hidden, false);
  assert.match(nodes.get('shs-choice-empty-help').textContent, /Select one eligible Work Immersion/);
  assert.match(nodes.get('shs-choice-classes').innerHTML, /TechPro Work Immersion.*Required/);

  context.window.shsChoiceTest.setData({ canEdit: true, placement,
    selection: { status: 'pending', classIds: [401] }, classes: [immersion] });
  context.window.shsChoiceTest.renderChoiceClasses();
  assert.equal(nodes.get('shs-choice-save').disabled, true);
  assert.equal(nodes.get('shs-choice-save').hidden, true);
  assert.equal(nodes.get('shs-choice-confirm').disabled, false);

  context.window.shsChoiceTest.setData({ canEdit: true, placement,
    selection: { status: 'not_recorded', classIds: [] }, classes: [] });
  context.window.shsChoiceTest.renderChoiceClasses();
  assert.equal(nodes.get('shs-choice-save').disabled, true);
  assert.equal(nodes.get('shs-choice-save').hidden, false);
  assert.equal(nodes.get('shs-choice-confirm').hidden, true);
  assert.equal(nodes.get('shs-choice-return').hidden, true);
  assert.match(nodes.get('shs-choice-empty-help').textContent, /No eligible class is offered/);
});
