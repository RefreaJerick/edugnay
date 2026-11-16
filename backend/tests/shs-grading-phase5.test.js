const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pageFs = require('./helpers/page-fs');
const path = require('node:path');
const vm = require('node:vm');
const { policyFor } = require('../config/shsGrading');
const { requireShsTeachingEnabled } = require('../utils/shsTeachingAccess');
const { loadPublishedElectiveGrades, publishedSectionGradeFilter } = require('../controllers/gradesController');

const root = path.resolve(__dirname, '../..');
const read = name => pageFs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');

test('SHS grading periods work without a scheduled meeting while writes still require an active period', async () => {
  const controller = read('backend/controllers/shsGradesController.js');
  const source = controller.match(/async function assertTerm\([\s\S]*?\n\}\n\nasync function roster/)?.[0]
    .replace(/\n\nasync function roster$/, '');
  assert.ok(source);
  const queries = [];
  const db = { execute: async (sql, values) => {
    queries.push({ sql, values });
    return [[{ status: 'active' }]];
  } };
  const term = { id: 12, status: 'active', startDate: '2026-10-01', endDate: '2027-01-31' };
  const context = vm.createContext({
    loadTerms: async () => [term],
    fail: (message, status) => { const error = new Error(message); error.status = status; throw error; }
  });
  vm.runInContext(`${source}; globalThis.checkTerm = assertTerm;`, context);
  for (const kind of ['core', 'elective']) {
    const scope = { kind, schoolId: 4, yearId: 7 };
    const queryCount = queries.length;
    assert.equal((await context.checkTerm(db, scope, 12)).id, 12);
    assert.equal(queries.length, queryCount, 'reading grades must not query the timetable');
    assert.equal((await context.checkTerm(db, scope, 12, true)).id, 12);
    assert.equal(queries.length, queryCount + 1);
    assert.match(queries.at(-1).sql, /academic_terms/);
  }
  assert.equal(queries.length, 2, 'writing grades should lock only the selected period');
  await assert.rejects(context.checkTerm(db, { schoolId: 4, yearId: 7 }, 99), /does not belong to this class/);
  const lockedDb = { execute: async () => [[{ status: 'closed' }]] };
    await assert.rejects(context.checkTerm(lockedDb, { schoolId: 4, yearId: 7 }, 12, true), /Grades can only be changed during an active grading period/);
});

test('verified SHS policies are available while the release gate remains closed', () => {
  assert.equal(policyFor('academic_general', '2026-2027', 'grade-11').method, 'adjusted_2026');
  assert.equal(policyFor('core', '2026-2027', 'grade-12').method, 'adjusted_2026');
  assert.equal(policyFor('techpro', '2027-2028', 'grade-12').method, 'zero_based');
  const original = process.env.SHS_SELECTION_ENABLED;
  delete process.env.SHS_SELECTION_ENABLED;
  let response;
  requireShsTeachingEnabled({}, { status(code) { response = { code }; return this; }, json(data) { response.data = data; } }, () => {
    throw new Error('The gate must stay closed.');
  });
  assert.equal(response.code, 404);
  if (original === undefined) delete process.env.SHS_SELECTION_ENABLED;
  else process.env.SHS_SELECTION_ENABLED = original;
  assert.match(read('backend/routes/shsGrades.js'), /requireShsTeachingEnabled, requireTeacher/);
});

test('teacher grade preview identifies the class year and conversion method', () => {
  const gradebook = read('assets/js/teacher/shs-gradebook.js');
  assert.match(gradebook, /data\.scope\.yearLabel/);
  assert.match(gradebook, /2026–2027 adjusted conversion/);
  assert.match(gradebook, /Grades use the verified weighted calculation for this class/);
  assert.match(gradebook, /publishPreviewStudentList/);
});

test('SHS workspace provides the shared score grid with policy-based component averages', () => {
  const controller = read('backend/controllers/shsGradesController.js');
  const gradebook = read('assets/js/teacher/shs-gradebook.js');
  assert.match(controller, /componentAverages/);
  assert.match(controller, /calculateTermGrade\(scope\.policy, items, studentScores\)/);
  assert.match(gradebook, /metricHeaders: \[/);
  assert.match(gradebook, /student\.componentAverages/);
  assert.match(gradebook, /Final Grade/);
});

test('SHS score table passes policy metrics to the shared renderer', () => {
  const gradebook = read('assets/js/teacher/shs-gradebook.js');
  const toneSource = gradebook.match(/function finalGradeTone\(grade, policy\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(toneSource);
  const match = gradebook.match(/function renderTable\(host, data, scope, writable, reload\) \{[\s\S]*?\n  \}\n\n  async function saveScore/);
  assert.ok(match, 'SHS score table renderer should exist');
  const source = match[0].replace(/\n\n  async function saveScore$/, '');
  let rendered;
  const context = {
    window: { TeacherClassViews: { renderScoreTable: options => { rendered = options; } } },
    categoryCode: item => String(item.componentCode || item.code).toUpperCase(),
    shortCategoryName: item => item.code === 'WW' ? 'WW' : item.name,
    scoreFor: () => null,
    saveScore() {}
  };
  const data = {
    scope: { policy: { passingGradeThreshold: 75, components: [{ code: 'WW', name: 'Written Work', weight: 20 }] } },
    items: [{ id: 'assessment-1', componentCode: 'WW', maxScore: 20 }],
    students: [{ studentId: 'student-1', componentAverages: { WW: 85 }, termGrade: 87 }],
    scores: [],
    published: []
  };
  const render = () => vm.runInNewContext(`${toneSource}; ${source}; renderTable({}, data, {}, true, () => {});`, { ...context, data });
  render();
  assert.equal(rendered.scoreEvent, 'input');
  assert.equal(Array.from(rendered.metricHeaders, item => item.label).join('|'), 'WW Avg|Final Grade');
  assert.equal(Array.from(rendered.getMetrics(data.students[0]), item => item.value).join('|'), '85|87');
  assert.match(rendered.getMetrics(data.students[0]).at(-1).className, /grade-pass/);
  for (const [grade, tone] of [[74, 'grade-warn'], [69, 'grade-fail'], [null, 'grade-unavailable']]) {
    data.students[0].termGrade = grade;
    assert.match(rendered.getMetrics(data.students[0]).at(-1).className, new RegExp(tone));
  }
  data.scope.policy.passingGradeThreshold = 80;
  data.students[0].termGrade = 79;
  assert.match(rendered.getMetrics(data.students[0]).at(-1).className, /grade-warn/);
  data.scope.policy.passingGradeThreshold = 0;
  data.students[0].termGrade = 0;
  assert.match(rendered.getMetrics(data.students[0]).at(-1).className, /grade-pass/);
  data.students[0].termGrade = null;
  data.published = [{ studentId: 'student-1', finalGrade: 90, publicationVersion: 1 }];
  assert.equal(rendered.getMetrics(data.students[0]).at(-1).value, null);
  assert.match(rendered.getMetrics(data.students[0]).at(-1).className, /grade-unavailable/);
  assert.equal(rendered.empty.noItems, undefined);
  assert.equal(rendered.empty.noStudents, undefined);

  data.scope.policy = null;
  data.scope.policyBlockReason = 'Ask the school administrator to review the grading setup.';
  render();
  assert.equal(rendered.empty.noItems.title, 'Grading rules unavailable');
  assert.equal(rendered.empty.noItems.text, data.scope.policyBlockReason);
});

test('SHS score refresh updates the final-grade color after saving', async () => {
  const gradebook = read('assets/js/teacher/shs-gradebook.js');
  const toneSource = gradebook.match(/function finalGradeTone\(grade, policy\) \{[\s\S]*?\n  \}/)?.[0];
  const saveSource = gradebook.match(/async function saveScore\([^\n]+\) \{[\s\S]*?\n  \}\n\n  function setPublishPreview/)?.[0]
    .replace(/\n\n  function setPublishPreview$/, '');
  assert.ok(toneSource && saveSource);
  const tones = new Set(['grade-pass']);
  const final = {
    classList: {
      remove: (...names) => names.forEach(name => tones.delete(name)),
      add: name => tones.add(name)
    },
    textContent: ''
  };
  const row = { dataset: { studentId: 'student-1' }, querySelectorAll: () => [final] };
  const host = { querySelectorAll: () => [row] };
  const data = {
    scope: { policy: { passingGradeThreshold: 75, components: [] }, kind: 'core' },
    term: { id: 1 }, items: [{ id: 'item-1' }], students: [], published: []
  };
  let nextGrade = 74;
  const context = vm.createContext({
    activeContext: { host, data }, resultsVersion: 0,
    api: () => ({ saveShsScore: async () => {}, getShsGradeWorkspace: async () => ({
      students: [{ studentId: 'student-1', termGrade: nextGrade }], published: []
    }) }),
    finalGradeTone: vm.runInNewContext(`(${toneSource})`),
    setFeedback() {}, toast() {},
    window: { TeacherClassViews: { updateSectionHeaderFromGradebook() {} } }
  });
  vm.runInContext(saveSource, context);
  const input = { dataset: { scoreItem: 'item-1', studentId: 'student-1' }, parentElement: { querySelector: () => null }, value: '10' };
  await vm.runInContext('saveScore', context)(input, data, {}, true, () => {});
  assert.equal(final.textContent, 74);
  assert.deepEqual([...tones], ['grade-warn']);
  nextGrade = null;
  await vm.runInContext('saveScore', context)(input, data, {}, true, () => {});
  assert.equal(final.textContent, '—');
  assert.deepEqual([...tones], ['grade-unavailable']);
});

test('published SHS score items save normally for core and elective classes', async () => {
  const controller = read('backend/controllers/shsGradesController.js');
  const save = controller.match(/async function saveScore\([\s\S]*?(?=async function correctScore\()/)?.[0];
  assert.ok(save);
  for (const [kind, rawScore] of [['core', 20], ['elective', '']]) {
    const statements = [];
    let committed = false;
    let response;
    let failure;
    const connection = {
      beginTransaction: async () => {},
      execute: async (sql, values) => { statements.push({ sql, values }); return [[]]; },
      commit: async () => { committed = true; }, rollback: async () => {}, release() {}
    };
    const context = vm.createContext({
      getDatabase: () => ({ getConnection: async () => connection }),
      resolveScope: async () => ({ kind, schoolId: 1, policy: {}, subjectName: 'Math', className: 'Class A' }),
      lockYear: async () => {}, id: value => Number(value), assertTerm: async () => {},
      loadItems: async () => [{ id: 2, title: 'Test', maxScore: 25, usedInPublishedGrades: true }],
      roster: async () => [{ studentId: 3, studentName: 'Learner' }],
      writeAuditLog: async () => {}, fail: message => { throw new Error(message); },
      Number, String, Math
    });
    vm.runInContext(save, context);
    await context.saveScore({ user: { id: 4 }, body: {
      academicTermId: 5, gradingItemId: 2, studentId: 3, score: rawScore
    } }, { json: value => { response = value; } }, error => { failure = error; });
    assert.equal(failure, undefined);
    assert.equal(committed, true);
    assert.equal(response.saved, true);
    assert.match(statements[0].sql, /INSERT INTO student_scores/);
    assert.equal(statements[0].values[3], rawScore === '' ? null : rawScore);
    assert.equal(statements.some(entry => /published_final_grades|shs_grade_publication_history/.test(entry.sql)), false);
  }
});

test('SHS score footer explains saving only when score rows exist', () => {
  const gradebook = read('assets/js/teacher/shs-gradebook.js');
  const source = gradebook.match(/function render\(host, data, scope, reload\) \{[\s\S]*?\n  \}\n\n  async function mount/)?.[0]
    .replace(/\n\n  async function mount$/, '');
  assert.ok(source, 'SHS gradebook renderer should exist');

  function renderStatus(items, students, termStatus = 'active', published = []) {
    const nodes = new Map();
    const node = key => {
      if (!nodes.has(key)) nodes.set(key, { textContent: '', innerHTML: '', hidden: false, disabled: false, value: '', title: '', dataset: {} });
      return nodes.get(key);
    };
    const host = { classList: { add() {} }, querySelector: selector => node(selector) };
    const context = vm.createContext({
      window: {
        TeacherClassViews: { updateSectionHeaderFromGradebook() {} },
        lucide: { createIcons() {} },
        openModal() {}
      },
      document: { getElementById: id => node(id) },
      escapeHtml: value => String(value),
      setVisible: (target, visible) => { target.hidden = !visible; },
      renderCategoryTabs() {},
      applyFilters() {},
      renderTable() {},
      setFeedback: (_host, message) => { node('#scoreSaveStatus').textContent = message; },
      updateExportState() {},
      configureAddAssessmentModal() {},
      openPublishPreview() {}
    });
    const data = {
      scope: { kind: 'core', subjectName: 'English', className: 'Section A', yearLabel: '2026–2027', yearStatus: 'active', policy: { components: [] } },
      term: { id: '1', name: 'Term 1', status: termStatus },
      terms: [{ id: '1', name: 'Term 1', status: termStatus }],
      items, students, published
    };
    context.host = host;
    context.data = data;
    vm.runInContext(`${source}; render(host, data, {}, () => {});`, context);
    return { status: node('#scoreSaveStatus').textContent,
      banner: node('publishedGradesBanner'), publishedStatus: node('publishedPeriodStatus').textContent };
  }

  assert.equal(renderStatus([], []).status, 'No scores to save');
  assert.equal(renderStatus([{ id: '1' }], []).status, 'No scores to save');
  assert.equal(renderStatus([{ id: '1' }], [{ studentId: '1' }]).status, 'Scores save automatically');
  assert.equal(renderStatus([{ id: '1' }], [{ studentId: '1' }], 'closed').status, 'Scores are read-only for this class or grading period.');
  const published = renderStatus([{ id: '1' }], [{ studentId: '1' }], 'active',
    [{ studentId: '1', publishedAt: '2026-11-16T08:00:00.000Z' }]);
  assert.equal(published.banner.hidden, false);
  assert.match(published.publishedStatus, /Published on .* · 1 student saved for this subject and term/);
});
test('SHS grading chooses the method from the class academic year, not the device date', () => {
  const controller = read('backend/controllers/shsGradesController.js');
  const rules = read('backend/config/shsGrading.js');
  assert.match(controller, /y\.label AS yearLabel/);
  assert.match(controller, /loadShsPolicy\(db, scope\)/);
  assert.match(read('backend/utils/shsGradingProfiles.js'), /policyFor\(scope\.group, scope\.yearLabel, scope\.gradeCode\)/);
  assert.match(rules, /startYear === 2026 \? 'adjusted_2026' : 'zero_based'/);
  assert.doesNotMatch(rules, /new Date\(|Date\.now\(/);
});

test('migration 054 keeps core and elective ownership exclusive and is not auto-applied', () => {
  const migration = read('backend/database/migrations/054_strengthened_shs_grading.sql');
  const schema = read('backend/database/schema.sql');
  assert.match(migration, /ck_grading_item_owner CHECK/);
  assert.match(migration, /ck_published_grade_owner CHECK/);
  assert.match(migration, /uq_published_elective_grade/);
  assert.match(migration, /DROP CONSTRAINT ck_elective_assignment_ungraded/);
  assert.doesNotMatch(migration, /DROP CHECK\b/);
  assert.match(migration, /CREATE TABLE shs_grade_publication_history/);
  assert.match(migration, /CREATE TABLE shs_grade_score_corrections/);
  assert.match(migration, /uq_shs_grade_history_school_id \(school_id, id\)/);
  assert.match(migration, /FOREIGN KEY \(school_id, latest_history_id\)/);
  assert.match(migration, /s\.shs_curriculum_code = 'strengthened_2026'/);
  assert.match(migration, /published_history_id BIGINT UNSIGNED NOT NULL/);
  assert.match(migration, /publication_version INT UNSIGNED NOT NULL/);
  assert.match(migration, /JSON_OBJECT\('legacySnapshot', TRUE\)/);
  assert.doesNotMatch(migration, /ALTER TABLE student_scores[\s\S]*ADD COLUMN school_id/);
  assert.doesNotMatch(migration, /ADD CONSTRAINT fk_student_scores_tenant_(item|student)/);
  assert.match(read('backend/database/migrations/022_add_child_tenant_constraints.sql'), /ALTER TABLE student_scores ADD COLUMN school_id/);
  assert.doesNotMatch(schema, /idx_student_scores_school_student/);
  assert.doesNotMatch(migration, /strengthened_shs_grade12_pilot/);
  assert.doesNotMatch(schema, /strengthened_shs_grade12_pilot/);
  assert.match(read('backend/routes/shsGrades.js'), /scores\/correction/);
  assert.doesNotMatch(read('backend/routes/shsProgram.js'), /grade12-pilot/);
  assert.doesNotMatch(read('backend/controllers/shsProgramController.js'), /pilot/i);
  assert.doesNotMatch(read('backend/controllers/sectionsController.js'), /pilot/i);
  assert.match(schema, /shs_completion_confirmations/);
  assert.doesNotMatch(read('backend/server.js'), /054_strengthened_shs_grading|runMigration/);
});

test('partial 054 import resumes after the three applied ALTER statements', () => {
  const migration = read('backend/database/migrations/054_strengthened_shs_grading.sql');
  const resume = read('backend/database/054_resume_after_partial_import.sql');
  const nextStatement = 'ALTER TABLE assignments\n';
  assert.ok(migration.includes(nextStatement));
  assert.ok(resume.includes(nextStatement));
  assert.equal(resume.slice(resume.indexOf(nextStatement)), migration.slice(migration.indexOf(nextStatement)));
  assert.match(resume, /DROP CONSTRAINT ck_elective_assignment_ungraded/);
  assert.doesNotMatch(resume, /DROP CHECK\b/);
  assert.doesNotMatch(resume, /ALTER TABLE grading_items|ADD COLUMN publication_version|ALTER TABLE student_scores/);
  assert.match(resume, /^-- For the partially migrated database only\./);
});

test('Grade 12 Strengthened SHS has no school-specific start setting', () => {
  const schema = read('backend/database/schema.sql');
  const migration = read('backend/database/migrations/054_strengthened_shs_grading.sql');
  const program = read('backend/controllers/shsProgramController.js');
  const page = read('views/admin/edugnay-admin-shs-program.html');
  assert.doesNotMatch(schema + migration + program + page, /strengthened_shs_grade12_pilot|grade12PilotEnabled|grade12-pilot|shs-pilot-/i);
  assert.doesNotMatch(read('assets/js/admin/shs-program.js'), /setShsGrade12Pilot|grade12PilotEnabled/i);
  assert.equal(policyFor('core', '2027-2028', 'grade-12').method, 'zero_based');
  assert.match(read('backend/controllers/shsGradesController.js'), /if \(!scope\.policy\) fail\(policyBlockReason/);
  assert.match(read('backend/.env.example'), /SHS_SELECTION_ENABLED=false/);
});

test('grade reads are scoped to learner, linked parent, current teacher, or school', () => {
  const controller = read('backend/controllers/gradesController.js');
  assert.match(controller, /p\.school_id = \?/);
  assert.match(controller, /p\.student_user_id = \?/);
  assert.match(controller, /c\.teacher_user_id = \?/);
  assert.match(controller, /student_parent_links link/);
  assert.match(controller, /process\.env\.SHS_SELECTION_ENABLED !== 'true'/);
  assert.match(controller, /function publishedSectionGradeFilter[\s\S]*strengthened_2026/);
  assert.match(controller, /level_code <> 'shs'/);
  assert.doesNotMatch(controller, /strengthened_shs_grade12_pilot/);
  assert.match(controller, /function publishedSectionGradeFilter/);
});

test('SHS grade views stay hidden by default and only include supported Strengthened cohorts when released', () => {
  const original = process.env.SHS_SELECTION_ENABLED;
  try {
    delete process.env.SHS_SELECTION_ENABLED;
    assert.equal(publishedSectionGradeFilter(), "school_levels.level_code <> 'shs'");
    process.env.SHS_SELECTION_ENABLED = 'true';
    const filter = publishedSectionGradeFilter();
    assert.match(filter, /strengthened_2026/);
    assert.match(filter, /grade-11/);
    assert.match(filter, /grade-12/);
    assert.match(filter, />= 2026/);
    assert.doesNotMatch(filter, /grade-12[^)]*2027/);
  } finally {
    if (original === undefined) delete process.env.SHS_SELECTION_ENABLED;
    else process.env.SHS_SELECTION_ENABLED = original;
  }
});

test('published elective query enforces role and school filters when released', async () => {
  const original = process.env.SHS_SELECTION_ENABLED;
  process.env.SHS_SELECTION_ENABLED = 'true';
  const calls = [];
  const db = { async execute(sql, args) { calls.push({ sql, args }); return [[]]; } };
  try {
    await loadPublishedElectiveGrades(db, { role: 'student', schoolId: 7, id: 10 });
    await loadPublishedElectiveGrades(db, { role: 'parent', schoolId: 7, id: 20 }, { studentId: 10 });
    await loadPublishedElectiveGrades(db, { role: 'teacher', schoolId: 7, id: 30 });
    await loadPublishedElectiveGrades(db, { role: 'school_admin', schoolId: 7, id: 40 });
    assert.equal(calls.length, 4);
    for (const call of calls) {
      assert.match(call.sql, /p\.school_id = \?/);
      assert.equal(call.args[0], 7);
    }
    assert.match(calls[0].sql, /p\.student_user_id = \?/);
    assert.deepEqual(calls[0].args, [7, 10]);
    assert.match(calls[1].sql, /student_parent_links link/);
    assert.deepEqual(calls[1].args, [7, 10, 20]);
    assert.match(calls[2].sql, /c\.teacher_user_id = \?/);
    assert.deepEqual(calls[2].args, [7, 30]);
  } finally {
    if (original === undefined) delete process.env.SHS_SELECTION_ENABLED;
    else process.env.SHS_SELECTION_ENABLED = original;
  }
});

test('teacher gradebook links elective assignments only through scoped grading items', () => {
  const controller = read('backend/controllers/shsGradesController.js');
  const insertion = controller.match(/async function insertItem\([\s\S]*?(?=async function createLinkedAssignmentItem\()/)?.[0];
  assert.ok(insertion);
  assert.match(controller, /assertElectiveTeacher/);
  assert.match(insertion, /scope\.kind === 'elective'[\s\S]*?shs_elective_class_id = \?/);
  assert.match(insertion, /FOR UPDATE/);
  assert.match(insertion, /UPDATE assignments SET academic_term_id = \?, max_score = \?, grading_item_id = \?/);
  assert.match(insertion, /AND grading_item_id IS NULL/);
  assert.match(controller, /Resolve missing scores and assessment items before publishing/);
  assert.match(read('assets/js/teacher/elective-class.js'), /#content-scores \.panel/);
});

test('teacher section and elective pages use the same Strengthened SHS gradebook', () => {
  const sections = read('views/teacher/edugnay-teacher-sections.html');
  const sectionApi = read('backend/controllers/sectionsController.js');
  assert.match(sections, /id="content-scores"/);
  assert.match(sections, /id="scoreTbody"/);
  assert.doesNotMatch(sections, /shs-core-gradebook|elective-class-workspace/);
  assert.match(sections, /AcademixShsGradebook\?\.show/);
  const electivePage = read('views/teacher/edugnay-teacher-sections.html');
  const electiveScript = read('assets/js/teacher/elective-class.js');
  assert.match(electivePage, /teacher\/shs-gradebook\.js/);
  assert.match(electiveScript, /AcademixShsGradebook\.show/);
  assert.match(sectionApi, /subjects\.shs_subject_type AS shsSubjectType/);
  const gradebook = read('assets/js/teacher/shs-gradebook.js');
  assert.match(gradebook, /saveShsScore/);
  assert.doesNotMatch(gradebook, /correctionRequired|Published v|shs-republish-reason/);
  const shsController = read('backend/controllers/shsGradesController.js');
  const normalSave = shsController.match(/async function saveScore\([\s\S]*?(?=async function correctScore\()/)?.[0];
  assert.ok(normalSave);
  assert.doesNotMatch(normalSave, /usedInPublishedGrades/);
  assert.doesNotMatch(shsController, /Republishing changed grades requires a correction reason/);
  assert.match(gradebook, /Grade preview/);
  assert.match(gradebook, /data\.scope\.classActive && data\.scope\.offeringActive/);
  assert.match(gradebook, /host\.querySelector\('#scorePanelTitle'\)/);
  assert.match(gradebook, /TeacherClassViews\.renderScoreTable/);
  assert.match(gradebook, /TeacherClassViews\.renderGradePreviewRows/);
  assert.doesNotMatch(gradebook, /thead\.innerHTML|tbody\.innerHTML/);
  assert.doesNotMatch(gradebook, /publish-preview-row|publish-preview-grade/);
  assert.match(read('backend/controllers/shsGradesController.js'), /source: scope\.policy\?\.source/);
});
