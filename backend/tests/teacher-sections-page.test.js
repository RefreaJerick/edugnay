const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const commonSource = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-dashboard.html'), 'utf8');
const sectionsSource = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-sections.html'), 'utf8');
const sectionsStyles = fs.readFileSync(path.join(__dirname, '../../assets/css/teacher/sections.css'), 'utf8');
const modalStyles = fs.readFileSync(path.join(__dirname, '../../assets/css/modal-system.css'), 'utf8');
const sharedStyles = fs.readFileSync(path.join(__dirname, '../../assets/css/styles.css'), 'utf8');
const sfSource = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/sf-templates.js'), 'utf8');

function createTransferNoticeContext(state) {
  const makeElement = tagName => ({
    tagName,
    children: [],
    listeners: {},
    className: '',
    hidden: false,
    setAttribute() {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    classList: { toggle(name, enabled) { this[name] = enabled; } },
    textContent: ''
  });
  const notice = makeElement('div');
  const scope = { sectionId: '8', subjectId: '4', academicTermId: '2' };
  const functionSource = sectionsSource.split('  function renderTransferReviewNotice(scope) {')[1]
    .split('\n  async function ensureTransferReviewLoaded')[0];
  let reviewCount = 0;
  let retryCount = 0;
  const transferReviewCache = new Map([['8:4:2', state]]);
  const context = vm.createContext({
    document: { getElementById: () => notice, createElement: makeElement },
    window: { lucide: { createIcons() {} } },
    TRANSFER_REVIEW_CACHE: transferReviewCache,
    transferReviewKey: () => '8:4:2',
    ensureTransferReviewLoaded: () => { retryCount += 1; },
    openTransferReviewModal: () => { reviewCount += 1; }
  });
  vm.runInContext(`function renderTransferReviewNotice(scope) {${functionSource}`, context);
  context.renderTransferReviewNotice(scope);
  return { notice, transferReviewCache, reviewCount: () => reviewCount, retryCount: () => retryCount };
}

test('teacher section callers use the subject-assignment scope', () => {
  assert.match(commonSource, /getApiSections\(\{ scope: 'teaching' \}\)/);
  assert.match(dashboardSource, /EDUGNAY_CONFIG\.getMyTeachingSections\(\)/);
  assert.doesNotMatch(dashboardSource, /EDUGNAY_API\.getSectionTeachers\(section\.id\)/);
});

test('score component cards keep icons neutral until selected and space exam-part controls', () => {
  assert.doesNotMatch(sectionsSource, /selectedCatBadge|cat-badge/);
  for (const tone of ['ww', 'pt', 'qa']) {
    assert.match(sectionsSource, new RegExp(`class="comp-type-opt cat-${tone}[^\"]*"[\\s\\S]*?class="comp-type-icon"`));
  }
  assert.match(sectionsSource, /data-lucide="\$\{presentation\.icon\}"/);
  assert.match(sectionsSource, /aria-pressed="\$\{index === 0\}"/);
  assert.match(sectionsStyles, /\.comp-type-opt\s*\{[^}]*background:\s*var\(--theme-surface\)/);
  assert.match(sectionsStyles, /\.comp-type-opt:hover\s*\{[^}]*background:\s*var\(--gray-50\)/);
  assert.match(sectionsStyles, /\.comp-type-opt\.selected\s*\{[^}]*background:\s*var\(--pill-background/);
  assert.match(sectionsStyles, /\.comp-type-icon\s*\{[^}]*color:\s*inherit/);
  assert.match(sectionsStyles, /\.comp-type-opts \+ #scoreExamPartGroup\s*\{[^}]*margin-top:\s*16px/);
});

test('grading average headers abbreviate standard categories but retain accessible full names', () => {
  const functionSource = sectionsSource.match(/function gradingAverageHeaderLabel\(label\) \{[\s\S]*?\n  \}/)[0];
  const context = vm.createContext({});
  vm.runInContext(functionSource, context);
  assert.equal(context.gradingAverageHeaderLabel('Written/Oral Works'), 'WW');
  assert.equal(context.gradingAverageHeaderLabel('Performance Tasks'), 'PT');
  assert.equal(context.gradingAverageHeaderLabel('Examinations'), 'Exams');
  assert.equal(context.gradingAverageHeaderLabel('Custom Lab Activities'), 'Custom Lab Activities');

  assert.match(sectionsSource, /th\.textContent = `\$\{gradingAverageHeaderLabel\(categoryName\)\} Avg`/);
  assert.match(sectionsSource, /th\.setAttribute\('aria-label', `\$\{categoryName\} average`\)/);
  assert.match(sectionsSource, /th\.title = `\$\{categoryName\}: \$\{Number\(rule\.weight\) \|\| 0\}% of the final grade`/);
});

test('score component headers abbreviate standard categories while retaining full export labels', () => {
  assert.match(sectionsSource, /const categoryName = String\(c\.categoryName \|\| c\.cat \|\| ''\)\.trim\(\)/);
  assert.match(sectionsSource, /escapeHtml\(gradingAverageHeaderLabel\(categoryName\)\)/);
  assert.match(sectionsSource, /escapeHtml\(categoryName\) \+ '" data-category-name="' \+ window\.EDUGNAY_CONFIG\.escapeHtml\(categoryName\)/);
  assert.match(sectionsSource, /categoryLabel\.dataset\.categoryName \|\| categoryLabel\.textContent\.trim\(\)/);
});

test('score component headers suppress duplicate exam-part labels and retain distinct labels', () => {
  const helperSource = sectionsSource.match(/function getDistinctExamPartName\(componentName, examPartName\) \{[\s\S]*?\n  \}/)[0];
  const context = vm.createContext({});
  vm.runInContext(helperSource, context);
  assert.equal(context.getDistinctExamPartName('Term Exam', 'TERM EXAM'), '');
  assert.equal(context.getDistinctExamPartName('Summative Test', 'Summative Test 1'), 'Summative Test 1');
  assert.match(sectionsSource, /c\.subjectId === c\.currentJournalSubjectId \? 'Journal' : 'Past journal'/);
  assert.match(sectionsSource, /comp-head-name" title="' \+ window\.EDUGNAY_CONFIG\.escapeHtml\(c\.name\)/);
});

test('score component headers wrap full names and leave room for the actions button', () => {
  assert.match(sectionsStyles, /\.comp-head-cell\s*\{[^}]*min-width:\s*148px/);
  assert.match(sectionsStyles, /\.comp-head-title\s*\{[^}]*padding:\s*0 28px 0 0/);
  assert.match(sectionsStyles, /\.comp-head-name\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/);
  assert.match(sectionsStyles, /\.comp-head-name\s*\{[^}]*text-transform:\s*none/);
  assert.match(sectionsStyles, /\.comp-head-cell \.comp-head-type\s*\{[^}]*text-transform:\s*none/);
  assert.match(sectionsStyles, /\.comp-head-journal\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;[^}]*text-transform:\s*none/);
  assert.doesNotMatch(sectionsStyles, /\.comp-head-name\s*\{[^}]*text-overflow:\s*ellipsis/);
});

test('score component category labels keep their colors without pill styling', () => {
  assert.match(sectionsSource, /comp-head-type ' \+ \(typeClass\[c\.cat\] \|\| 'type-ww'\)/);
  assert.match(sectionsStyles, /\.comp-head-cell \.comp-head-type\s*\{[^}]*display:\s*block;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/);
  assert.match(sectionsStyles, /\.comp-head-cell \.comp-head-type\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  for (const [tone, color] of [['type-ww', '--theme-purple-text'], ['type-pt', '--theme-accent-text'], ['type-qa', '--theme-success-deep']]) {
    assert.match(sharedStyles, new RegExp(`\\.comp-head-type\\.${tone}\\s*\\{[^}]*--pill-color:\\s*var\\(${color}\\)`));
  }
});

test('Publish Grades modal uses the wider shared desktop modal width', () => {
  assert.match(sectionsStyles, /\.modal\s*\{[^}]*max-width:\s*480px/);
  assert.match(sectionsStyles, /#publishModal \.modal\s*\{[^}]*max-width:\s*700px/);
  assert.match(sectionsStyles, /\.modal-backdrop\s*\{[^}]*padding:\s*20px/);
  assert.match(sectionsStyles, /\.publish-preview-list\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(sectionsStyles, /\.publish-preview-list\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(sectionsStyles, /@media \(max-width:\s*700px\)\s*\{\s*\.publish-preview-list\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test('Publish Grades method note uses an accessible info banner with separate method text', () => {
  assert.match(sectionsSource, /id="publishGradeMethodNote" class="publish-preview-feedback publish-grade-method-note" role="note" hidden/);
  assert.match(sectionsSource, /class="publish-method-icon" aria-hidden="true"><i data-lucide="info"><\/i><\/span>/);
  assert.match(sectionsSource, /id="publishGradeMethodText"/);
  assert.match(sectionsSource, /methodText\.textContent = methodDescription/);
  assert.match(sectionsStyles, /\.publish-grade-method-note\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center/);
  assert.match(sectionsStyles, /\.publish-method-icon\s*\{[^}]*background:\s*var\(--theme-surface\);[^}]*color:\s*var\(--theme-accent-text\)/);
});

test('published teacher grades use the configured passing threshold for their status color', () => {
  const functionSource = sectionsSource.match(/function getGradeStatusTone\([\s\S]*?\n  \}/)[0];
  const context = vm.createContext({});
  vm.runInContext(functionSource, context);
  assert.equal(context.getGradeStatusTone(86, 75, 70), 'grade-pass');
  assert.equal(context.getGradeStatusTone(75, 75, 70), 'grade-pass');
  assert.equal(context.getGradeStatusTone(72, 75, 70), 'grade-warn');
  assert.equal(context.getGradeStatusTone(80, 83, 78), 'grade-warn');
  assert.equal(context.getGradeStatusTone(83, 83, 78), 'grade-pass');
  assert.match(sectionsSource, /gradeTone: grade \? getGradeStatusTone\(grade\.finalGrade\) : 'grade-unavailable'/);
  assert.match(sectionsSource, /class="published-grade-value \$\{progress\.gradeTone\}"/);
});

test('score table labels calculated grades and keeps calculation details accessible', () => {
  assert.match(sectionsSource, /gradeHeaderLabel\.textContent = weightedScoreOnly \? 'Weighted Grade' : 'Final Grade'/);
  assert.doesNotMatch(sectionsSource, /final-grade-preview-note|Preview until published/);
  assert.match(sectionsSource, /finalTh\.setAttribute\('aria-label', gradeHeaderLabel\.textContent\)/);
  assert.match(sectionsSource, /finalCell\.textContent = String\(termGrade\)/);
  assert.match(sectionsSource, /finalCell\.textContent = String\(rounded\)/);
  assert.match(sectionsSource, /Weighted grade: \$\{initial\.toFixed\(2\)\}; converted to final grade/);
  assert.match(sectionsSource, /finalCell\.setAttribute\('aria-label', `Final grade \$\{termGrade\}\. Weighted grade/);
  assert.match(sectionsSource, /finalCell\.tabIndex = 0/);
  const previewSource = sectionsSource.match(/function renderPublishGradePreview\([\s\S]*?\n  \}\n\n  async function flushPendingBackendScoreSaves/)[0];
  assert.match(previewSource, /grade\.textContent = hasFinalGrade \? String\(finalGrade\) : 'Incomplete'/);
  assert.match(previewSource, /grade\.setAttribute\('aria-label', student\.retainedPublishedGrade/);
  assert.match(previewSource, /Below passing grade \(\$\{passingThreshold\}\)/);
  assert.match(previewSource, /Weighted grade \$\{Number\(student\.initialGrade\)\.toFixed\(2\)\}/);
  assert.doesNotMatch(previewSource, /Initial \$\{Number\(student\.initialGrade\)/);
});

test('Publish Grades preview presents final results and teacher-facing blocker guidance', () => {
  const toneSource = sectionsSource.match(/function getGradeStatusTone\([\s\S]*?\n  \}/)[0];
  const issueSource = sectionsSource.match(/function teacherFriendlyPreviewIssue\(issue\) \{[\s\S]*?\n  \}/)[0];
  const renderSource = sectionsSource.match(/function renderPublishGradePreview\([\s\S]*?\n  \}\n\n  async function flushPendingBackendScoreSaves/)[0]
    .replace(/\n\n  async function flushPendingBackendScoreSaves$/, '');
  const makeElement = () => ({
    children: [], attributes: {}, className: '', textContent: '', hidden: false, checked: false, disabled: false,
    classList: { values: [], add(value) { this.values.push(value); }, toggle() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; }
  });
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  element('academicPeriodSelect').selectedOptions = [{ textContent: 'Term 1' }];
  const context = vm.createContext({
    document: { getElementById: element, createElement: makeElement },
    PASSING_GRADE_THRESHOLD: 75,
    WARNING_GRADE_THRESHOLD: 70,
    GRADE_ROUNDING: 'round',
    CURRENT_GRADE_METHOD_LABEL: '',
    publishPreview: null,
    publishPreviewScope: null,
    publishInProgress: false,
    setPublishGradeFeedback() {},
    updateTransferPublishButton() {}
  });
  vm.runInContext(`${toneSource}\n${issueSource}\n${renderSource}`, context);

  const preview = {
    readyToPublish: true,
    gradingScale: 'deped_2026_transmutation',
    gradingMethod: 'deped_2026_transmutation',
    passingGradeThreshold: 75,
    publishableCount: 5,
    retainedPublishedCount: 0,
    transferReviewStudentIds: [],
    students: [
      { studentName: 'Alyssa Mendoza', initialGrade: 83.1, finalGrade: 86, isPassing: true },
      { studentName: 'Rafael Torres', initialGrade: 60, finalGrade: 72, isPassing: false },
      { studentName: 'Alexandra Camille Bautista-Mendoza', initialGrade: 83.1, finalGrade: 86, isPassing: true },
      { studentName: 'Bianca Ramos', initialGrade: 70, finalGrade: 75, isPassing: true },
      { studentName: 'Andrea Reyes', initialGrade: 70, finalGrade: 75, isPassing: true }
    ],
    issues: [],
    missingScoreCount: 0,
    invalidScoreCount: 0
  };
  context.renderPublishGradePreview(preview, {});
  assert.equal(element('publishGradeWarning').hidden, true);
  assert.match(element('publishGradeSummary').textContent, /Final grades for 5 students are ready to publish for Term 1/);
  assert.equal(element('publishGradeMethodNote').hidden, false);
  assert.match(element('publishGradeMethodText').textContent, /Weighted grades are converted/);
  const rows = element('publishPreviewStudentList').children;
  assert.equal(rows.length, 5);
  assert.equal(rows[2].children[0].textContent, 'Alexandra Camille Bautista-Mendoza');
  assert.equal(rows[0].children[1].children[0].textContent, '86');
  assert.equal(rows[0].children[1].children[0].attributes['aria-label'], 'Final grade 86.');
  assert.match(rows[0].children[1].children.map(child => child.textContent).join(' '), /86 Weighted grade 83\.10/);
  assert.equal(rows[1].children[1].children[0].textContent, '72');
  assert.match(rows[1].children[1].children.map(child => child.textContent).join(' '), /72 Below passing grade \(75\)\. Weighted grade 60\.00/);
  assert.equal(rows[1].children[1].children[0].classList.values.includes('grade-warn'), true);

  context.renderPublishGradePreview({
    ...preview,
    gradingMethod: 'school_direct',
    gradingScale: 'school_direct',
    gradeRounding: 'roundup'
  }, {});
  assert.equal(element('publishGradeMethodNote').hidden, false);
  assert.match(element('publishGradeMethodText').textContent, /Weighted grades are rounded up to the next whole number using the school’s grading rule/);

  context.renderPublishGradePreview({
    ...preview,
    gradingMethod: 'unrecognized_method',
    gradingScale: null
  }, {});
  assert.equal(element('publishGradeMethodNote').hidden, true);
  assert.equal(element('publishGradeMethodText').textContent, '');

  context.renderPublishGradePreview({ ...preview, readyToPublish: false, missingScoreCount: 1 }, {});
  assert.equal(element('publishGradeWarning').hidden, false);
  assert.match(element('publishGradeWarningText').textContent, /1 blank score field\. A score of 0 is valid/);

  context.renderPublishGradePreview({
    ...preview,
    readyToPublish: true,
    publishableCount: 0,
    retainedPublishedCount: 1,
    students: [
      { studentName: 'Rafael Torres', finalGrade: 72, isPassing: false, retainedPublishedGrade: true, sourceSectionName: 'St. Mark', initialGrade: 60 },
      { studentName: 'New student', finalGrade: null, initialGrade: null, isPassing: false }
    ]
  }, {});
  const retainedRows = element('publishPreviewStudentList').children;
  assert.equal(retainedRows[0].children[1].children[0].textContent, '72');
  assert.match(retainedRows[0].children[1].children.map(child => child.textContent).join(' '), /72 Kept from St\. Mark\. Below passing grade \(75\)\./);
  assert.doesNotMatch(retainedRows[0].children[1].children.map(child => child.textContent).join(' '), /Weighted grade/);
  assert.equal(retainedRows[1].children[1].children[0].textContent, 'Incomplete');
});

test('Publish Grades shows actionable blockers and hides the warning when ready', () => {
  assert.match(sectionsSource, /id="publishGradeWarning" role="alert" hidden/);
  assert.match(sectionsSource, /A score of 0 is valid\./);
  assert.match(sectionsSource, /warning\.hidden = Boolean\(preview\.readyToPublish\)/);
  assert.match(sectionsSource, /Final grades for \$\{publishableCount\} .* are ready to publish/);
  assert.match(sectionsSource, /function teacherFriendlyPreviewIssue\(issue\)/);
  assert.match(sectionsSource, /incompatible_period_structure: 'The DepEd grading method needs three grading periods/);
  assert.match(sectionsStyles, /\.publish-warn\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(sectionsStyles, /\.publish-preview-list\s*\{[^}]*max-height:\s*min\(48vh, 440px\)/);
  assert.match(sectionsStyles, /\.publish-preview-list\s*\{[^}]*display:\s*grid/);
  assert.match(sectionsStyles, /\.publish-preview-row\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1\.8fr\)/);
  assert.match(sectionsStyles, /\.publish-preview-row > span\s*\{[^}]*font-weight:\s*600/);
  assert.doesNotMatch(sectionsStyles, /\.final-grade-preview-note/);
  assert.match(sectionsStyles, /@media \(max-width: 560px\)[\s\S]*?\.publish-preview-row \{ grid-template-columns: minmax\(0, 1fr\);/);
});

test('published section status starts hidden and follows actual period records', () => {
  assert.match(sectionsSource, /data-publication-status="published" hidden/);
  assert.match(sectionsSource, /publicationStatus\.hidden = grades\.length === 0/);
  assert.match(sectionsStyles, /\.section-status-item\[hidden\][\s\S]*?display:\s*none;/);
});

test('published section status follows saved grades for the selected period', () => {
  const functionSource = sectionsSource.match(/function updatePublishedGradesBanner\(academicPeriodId\) \{[\s\S]*?\n  \}/)[0];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, style: {}, textContent: '' });
    return elements.get(id);
  };
  const publicationStatus = { hidden: true };
  let grades = [];
  const context = vm.createContext({
    document: {
      getElementById: element,
      querySelector: () => publicationStatus
    },
    isBackendGradeMode: () => true,
    getPublishedGradesForPeriod: () => grades,
    getBackendTermId: () => 'term-1',
    BACKEND_TERMS: [{ id: 'term-1', status: 'active' }]
  });
  vm.runInContext(functionSource, context);
  context.updatePublishedGradesBanner('period-1');
  assert.equal(publicationStatus.hidden, true);
  assert.equal(element('publishedGradesBanner').style.display, 'none');

  grades = [{ publishedAt: '2026-10-18T00:00:00.000Z' }];
  context.updatePublishedGradesBanner('period-1');
  assert.equal(publicationStatus.hidden, false);
  assert.equal(element('publishedGradesBanner').style.display, 'flex');
  assert.equal(element('republishGradesButton').style.display, 'inline-flex');
});

test('direct section access stops before subject APIs when no assignment exists', () => {
  assert.match(sectionsSource, /This section has no subject assigned to your account\./);
  const guard = sectionsSource.indexOf("if (!hasValidBackendSubjectAssignment())");
  const attendanceRequest = sectionsSource.indexOf('getSectionAttendanceHistory(section.id, CURRENT_SUBJECT_ID)');
  assert.ok(guard >= 0 && attendanceRequest > guard);
});

test('notification links can open an active advisory section without a subject assignment', () => {
  assert.match(sectionsSource, /if \(!selectedSection\) \{[\s\S]*?getMyAdvisorySections\(\)/);
  assert.match(sectionsSource, /selectedSection = advisorySection/);
});

test('student names open a section-scoped details modal with guardian contact details', () => {
  assert.match(sectionsSource, /data-student-details=/);
  assert.match(sectionsSource, /const row = event\.target\.closest\('tr\[data-student-id\]'\)/);
  assert.match(sectionsSource, /openTeacherStudentDetails\(row\.dataset\.studentId, row\.querySelector\('\[data-student-details\]'\)\)/);
  assert.match(sectionsSource, /EDUGNAY_API\.getSectionStudentDetails\(CURRENT_SECTION_ID, studentId\)/);
  assert.match(sectionsSource, /teacherStudentDetailsModal/);
  assert.match(sectionsSource, /Parents and guardians/);
  assert.match(sectionsSource, /Student number \(LRN\)/);
  assert.match(sectionsSource, /\['Enrollment status', student\.enrollmentStatus\]/);
});

test('SF templates keep the separate adviser-only section source, including closed-year SF5', () => {
  assert.match(sfSource, /getMyAdvisorySections\(true\)/);
});

test('score rows have no individual transfer link and the review modal uses scoped responsive styling', () => {
  assert.doesNotMatch(sectionsSource, /transfer-review-link|Prior grade final/);
  assert.match(sectionsSource, /transferReviewNotice[\s\S]*?textContent = 'Review'[\s\S]*?openTransferReviewModal\(\)/);
  assert.match(sectionsSource, /class="modal transfer-review-modal"/);
  assert.match(sectionsSource, /class="modal-body transfer-review-content" id="transferReviewContent"/);
  assert.doesNotMatch(sectionsSource, /id="transferReviewContent"[^>]*style=/);
  assert.match(sectionsSource, /class="transfer-review-row-heading"/);
  assert.match(sectionsSource, /class="transfer-review-detail"/);
});

test('transfer review notice has a gap above it and keeps responsive side margins', () => {
  assert.match(sectionsStyles, /\.transfer-review-notice\s*\{[^}]*margin:\s*12px 20px 12px;/);
  assert.match(sectionsStyles, /@media \(max-width: 760px\)\s*\{\s*\.transfer-review-notice\s*\{\s*margin-right:\s*15px;\s*margin-left:\s*15px;/);
});

test('transfer review notice handles loading, retry, empty, and full review states', () => {
  const loading = createTransferNoticeContext({ loading: true });
  assert.equal(loading.notice.hidden, false);
  assert.match(loading.notice.children[1].textContent, /Checking previous section work/);

  const failed = createTransferNoticeContext({ error: 'Network error' });
  assert.equal(failed.notice.classList['is-error'], true);
  const retry = failed.notice.children[2].children[0];
  assert.equal(retry.textContent, 'Retry');
  retry.listeners.click();
  assert.equal(failed.retryCount(), 1);
  assert.equal(failed.transferReviewCache.has('8:4:2'), false);

  const empty = createTransferNoticeContext({ data: { scores: [], publishedGrades: [] } });
  assert.equal(empty.notice.hidden, true);

  const ready = createTransferNoticeContext({ data: {
    scores: [{ studentId: 7 }], publishedGrades: [{ studentId: 7 }, { studentId: 9 }]
  } });
  assert.equal(ready.notice.hidden, false);
  assert.match(ready.notice.children[1].textContent, /2 transferred students have previous work/);
  ready.notice.children[2].children[0].listeners.click();
  assert.equal(ready.reviewCount(), 1);
});

test('transfer review modal renders score and published-grade cards with a safe empty state', () => {
  const functionSource = sectionsSource.split('  function openTransferReviewModal() {')[1]
    .split('\n  function renderScoreTable(')[0];
  const content = { innerHTML: '' };
  let openedModal = '';
  let reviewData = {
    scores: [{ studentId: 7, sourceSectionName: 'St. Mark', itemTitle: 'Quiz & test', score: 25, maxScore: 25, categoryName: 'Written Work' }],
    publishedGrades: [{ studentId: 7, sourceSectionName: 'St. John', finalGrade: 91 }]
  };
  const context = vm.createContext({
    BACKEND_GRADE_CONTEXT: { sectionId: '8', subjectId: '4' },
    document: {
      getElementById(id) { return id === 'academicPeriodSelect' ? { value: 'period-2' } : content; }
    },
    window: { EDUGNAY_CONFIG: { escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') } },
    TRANSFER_REVIEW_CACHE: new Map([['8:4:2', { data: reviewData }]]),
    transferReviewScope: () => ({ sectionId: '8', subjectId: '4', academicTermId: '2' }),
    transferReviewKey: () => '8:4:2',
    getGradeStudents: () => [{ id: 7, displayName: 'Test & Demo' }],
    openModal: id => { openedModal = id; }
  });
  vm.runInNewContext(`function openTransferReviewModal() {${functionSource}`, context);
  context.openTransferReviewModal();
  assert.equal(openedModal, 'transferReviewModal');
  assert.match(content.innerHTML, /Test &amp; Demo/);
  assert.match(content.innerHTML, /Quiz &amp; test: 25 \/ 25/);
  assert.match(content.innerHTML, /Final grade: 91/);
  assert.match(content.innerHTML, /St\. Mark/);
  assert.match(content.innerHTML, /St\. John/);

  reviewData = { scores: [], publishedGrades: [] };
  context.TRANSFER_REVIEW_CACHE.set('8:4:2', { data: reviewData });
  context.openTransferReviewModal();
  assert.match(content.innerHTML, /No previous work was found for this subject and period/);
});

test('QR attendance quick action requires a teacher section and subject choice', () => {
  assert.match(dashboardSource, /openTeacherQrAttendanceModal\(this\)/);
  assert.doesNotMatch(dashboardSource, /edugnay-teacher-sections\.html\?tab=attendance&action=qr/);
  assert.match(dashboardSource, /target\.searchParams\.set\('sectionId', section\.sectionId\)/);
  assert.match(dashboardSource, /target\.searchParams\.set\('subjectId', assignment\.subjectId\)/);
  assert.match(dashboardSource, /target\.searchParams\.set\('tab', 'attendance'\)/);
  assert.match(dashboardSource, /target\.searchParams\.set\('action', 'qr'\)/);
});

test('assignment modal follows the selected subject and saves its ID', () => {
  assert.doesNotMatch(sectionsSource, /id="assignSubjectInput"[^>]*value="Values Education"/);
  assert.match(sectionsSource, /subjectId: CURRENT_SUBJECT_ID,/);
  assert.doesNotMatch(sectionsSource, /getElementById\('assignSubjectInput'\)\.value\.trim\(\)/);

  const updateSource = sectionsSource.match(/function updateSectionSubjectControl\(\) \{[\s\S]*?\n  \}\n\n  function renderScoreTable/)[0]
    .replace(/\n\n  function renderScoreTable$/, '');
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      dataset: {}, children: [], listeners: {},
      replaceChildren(...children) { this.children = children; },
      addEventListener(type, callback) { this.listeners[type] = callback; },
      value: '', textContent: '', hidden: false
    });
    return elements.get(id);
  };
  const window = { location: {
    href: 'http://127.0.0.1:5500/views/teacher/edugnay-teacher-sections.html?sectionId=4',
    assign(href) { this.href = href; }
  } };
  const context = {
    document: {
      getElementById: element,
      createElement: () => ({ value: '', textContent: '' }),
      querySelectorAll: () => []
    },
    URL,
    window,
    CURRENT_SUBJECT: 'English',
    CURRENT_SUBJECT_ID: '17',
    CURRENT_SUBJECT_ASSIGNMENT: { subjectId: '17', subjectName: 'English' },
    CURRENT_TEACHER_SUBJECT_ASSIGNMENTS: [{ subjectId: '17', subjectName: 'English' }],
    CURRENT_SECTION: 'Grade 7 - St. Matthew'
  };
  vm.runInNewContext(`${updateSource}; updateSectionSubjectControl();`, context);
  assert.equal(element('assignSubjectInput').value, 'English');
  assert.equal(element('sectionSubjectSelect').value, '17');
  assert.equal(element('sectionSubjectSelect').hidden, true);

  context.CURRENT_TEACHER_SUBJECT_ASSIGNMENTS = [
    { subjectId: '17', subjectName: 'English' },
    { subjectId: '18', subjectName: 'Araling Panlipunan' }
  ];
  context.CURRENT_SUBJECT_ID = '18';
  context.CURRENT_SUBJECT = 'Araling Panlipunan';
  vm.runInNewContext('updateSectionSubjectControl();', context);
  assert.equal(element('sectionSubjectSelect').hidden, false);
  assert.deepEqual(element('sectionSubjectSelect').children.map(option => option.textContent), ['English', 'Araling Panlipunan']);
  element('sectionSubjectSelect').listeners.change();
  assert.equal(new URL(window.location.href).searchParams.get('subjectId'), '18');

  context.CURRENT_SUBJECT_ASSIGNMENT = null;
  context.CURRENT_SUBJECT_ID = '';
  context.CURRENT_SUBJECT = 'Subject unavailable';
  vm.runInNewContext('updateSectionSubjectControl();', context);
  assert.equal(element('assignSubjectInput').value, '');
});

test('section subject dropdown follows its navy and gold header style on desktop and phones', () => {
  assert.match(sectionsSource, /id="sectionSubjectSelect" class="section-subject-select"[^>]*hidden/);
  assert.match(sectionsStyles, /\.section-header \.section-subject \.searchable-select-input\s*\{[^}]*background:\s*rgba\(255, 255, 255, 0\.1\) !important;[^}]*color:\s*var\(--white\) !important;/s);
  assert.match(sectionsStyles, /\.section-header \.section-subject \.searchable-select-control::after\s*\{[^}]*border-top-color:\s*#f7d980;/s);
  assert.match(sectionsStyles, /@media \(max-width: 420px\)[\s\S]*?\.section-header \.section-subject \.searchable-select:not\(\[hidden\]\)\s*\{[^}]*flex:\s*1 1 200px;/);
  assert.match(modalStyles, /\.searchable-select-menu\s*\{[^}]*background:\s*var\(--theme-surface\);/s);
});

test('custom selects use the filled down triangle shown in the dropdown reference', () => {
  assert.match(modalStyles, /\.searchable-select-control::after\s*\{[^}]*border-top:\s*6px solid var\(--gray-400\);[^}]*border-right:\s*5px solid transparent;[^}]*border-left:\s*5px solid transparent;/s);
  assert.doesNotMatch(modalStyles.match(/\.searchable-select-control::after\s*\{([^}]*)\}/s)[1], /rotate\(/);
  assert.match(modalStyles, /\.searchable-select\.is-open \.searchable-select-control::after\s*\{[^}]*border-top-color:\s*var\(--theme-accent-text\);[^}]*transform:\s*rotate\(180deg\);/s);
});

test('custom select click toggles the menu without focus closing the first click', () => {
  const triggerSource = commonSource.match(/function bindSelectTriggerEvents\(input, state\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(triggerSource, 'custom select trigger handlers should be available');

  const inputHandlers = {};
  const documentHandlers = {};
  const context = vm.createContext({
    document: { addEventListener(type, callback) { documentHandlers[type] = callback; } },
    openSelect(state) { state.open = true; },
    closeSelect(state) { state.open = false; }
  });
  vm.runInContext(`${triggerSource}; globalThis.bindSelectTriggerEvents = bindSelectTriggerEvents;`, context);

  const input = { addEventListener(type, callback) { inputHandlers[type] = callback; } };
  const state = { open: false, pointerDown: false };
  context.bindSelectTriggerEvents(input, state);

  inputHandlers.pointerdown();
  inputHandlers.focus();
  assert.equal(state.open, false, 'pointer focus should wait for the click to open the menu');
  documentHandlers.pointerup();
  inputHandlers.click();
  assert.equal(state.open, true, 'the first click should open the menu');

  inputHandlers.pointerdown();
  documentHandlers.pointerup();
  inputHandlers.click();
  assert.equal(state.open, false, 'the next click should close the menu');

  inputHandlers.focus();
  assert.equal(state.open, true, 'keyboard focus should keep opening the menu');
  inputHandlers.click();
  assert.equal(state.open, false, 'clicking an already open menu should close it');
});

test('assignment creation uses the selected subject ID even if a label is stale', async () => {
  const addSource = sectionsSource.match(/async function addAssignment\(\) \{[\s\S]*?\n  \}\n\n  function resetAssignmentForm/)[0]
    .replace(/\n\n  function resetAssignmentForm$/, '');
  let saved;
  const fields = {
    assignTitleInput: { value: 'Reading response' },
    assignSubjectInput: { value: 'Values Education' },
    assignInstructionsInput: { value: '' },
    assignDueInput: { value: '2026-10-09' },
    assignOnlineSubmissionInput: { checked: false },
    assignGradingInput: { checked: false },
    academicPeriodSelect: { value: 'q1' }
  };
  const context = {
    document: { getElementById: id => fields[id] },
    window: { EDUGNAY_API: { createAssignment: async values => { saved = values; return { id: '42', ...values }; } } },
    CURRENT_SUBJECT_ASSIGNMENT: { subjectId: 'english' },
    CURRENT_SUBJECT_ID: 'english',
    CURRENT_SECTION_ID: 'grade-7',
    CURRENT_TEACHER_ID: 'teacher-1',
    TEACHER_SECTION_SCHOOL_ID: 'school-1',
    BACKEND_GRADE_CONTEXT: { sectionId: 'grade-7', subjectId: 'english' },
    BACKEND_SUBJECT_GRADING_CONFIG: null,
    BACKEND_ASSIGNMENTS: [],
    getBackendTermId: () => 'q1',
    isBackendGradeMode: () => true,
    showAppToast() {},
    resetAssignmentForm() {}, closeModal() {}, renderAssignments() {}, renderScoreTable() {}
  };
  await vm.runInNewContext(`${addSource}; addAssignment();`, context);
  assert.equal(saved.subjectId, 'english');
});

test('delete modal allows a new component even when its subject has published grades', () => {
  const openSource = sectionsSource.match(/async function openTeacherDeleteModal\(kind, id, name\) \{[\s\S]*?\n  \}\n\n  async function confirmTeacherDelete/)[0]
    .replace(/\n\n  async function confirmTeacherDelete$/, '');
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false });
    return elements.get(id);
  };
  const component = { id: '12', sectionId: '8', subjectId: '4', academicTermId: '6', usedInPublishedGrades: false };
  const context = {
    document: { getElementById: element },
    window: { lucide: { createIcons() {} } },
    BACKEND_GRADING_ITEMS: [component],
    BACKEND_STUDENT_SCORES: [{ gradingItemId: '12', score: 5 }],
    BACKEND_ASSIGNMENTS: [],
    BACKEND_PUBLISHED_GRADES: [{ sectionId: '8', subjectId: '4', academicTermId: '6' }],
    openModal() {}
  };
  vm.runInNewContext(`${openSource}; openTeacherDeleteModal('scoreComponent', '12', 'New quiz');`, context);
  assert.equal(element('teacherDeleteConfirmButton').disabled, false);
  assert.match(element('teacherDeleteConfirmDescription').textContent, /1 saved student score record/);

  component.usedInPublishedGrades = true;
  vm.runInNewContext("openTeacherDeleteModal('scoreComponent', '12', 'New quiz');", context);
  assert.equal(element('teacherDeleteConfirmButton').disabled, true);
  assert.match(element('teacherDeleteConfirmDescription').textContent, /used in published grades/);
});

test('linked score component opens the combined assignment deletion confirmation', async () => {
  const openSource = sectionsSource.match(/async function openTeacherDeleteModal\(kind, id, name\) \{[\s\S]*?\n  \}\n\n  async function confirmTeacherDelete/)[0]
    .replace(/\n\n  async function confirmTeacherDelete$/, '');
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false });
    return elements.get(id);
  };
  const context = {
    document: { getElementById: element },
    window: { lucide: { createIcons() {} }, EDUGNAY_API: { getAssignmentSubmissions: async () => [] } },
    BACKEND_GRADING_ITEMS: [{ id: '12', name: 'Quiz', usedInPublishedGrades: false }],
    BACKEND_ASSIGNMENTS: [{ id: '4', title: 'test', gradingItemId: '12' }],
    BACKEND_STUDENT_SCORES: [{ gradingItemId: '12', score: null, remarks: null }], BACKEND_SUBMISSIONS: new Map(),
    openModal() {}
  };
  await vm.runInNewContext(`${openSource}; openTeacherDeleteModal('scoreComponent', '12', 'Quiz');`, context);
  assert.equal(element('teacherDeleteConfirmTitle').textContent, 'Delete assignment and component?');
  assert.equal(element('teacherDeleteConfirmName').textContent, 'Quiz');
  assert.equal(element('teacherDeleteConfirmButton').disabled, false);
  assert.equal(element('teacherDeleteConfirmButton').textContent, 'Delete Both');
  assert.equal(element('teacherDeleteConfirmDescription').textContent, 'This will permanently remove the assignment and its linked score component.');
  await vm.runInNewContext("openTeacherDeleteModal('assignment', '4', 'test');", context);
  assert.equal(element('teacherDeleteConfirmName').textContent, 'test');
  assert.equal(element('teacherDeleteConfirmDescription').textContent, 'This will permanently remove the assignment and its linked score component.');
  assert.match(sectionsSource, /data-delete-assignment=.*?Delete Assignment & Component/s);
  assert.match(sectionsSource, /if \(request\.kind === 'assignment'\) \{[\s\S]*?EDUGNAY_API\.deleteAssignment\(request\.id, request\.expectedSubmissionCount\)/);

  context.window.EDUGNAY_API.getAssignmentSubmissions = async () => [{ id: 1 }, { id: 2 }];
  await vm.runInNewContext("openTeacherDeleteModal('assignment', '4', 'test');", context);
  assert.match(element('teacherDeleteConfirmDescription').textContent, /2 student submission records/);
  assert.match(element('teacherDeleteConfirmDescription').textContent, /uploaded files/);
  assert.equal(element('teacherDeleteConfirmButton').disabled, false);
  assert.equal(context.pendingTeacherDelete.expectedSubmissionCount, 2);

  context.BACKEND_ASSIGNMENTS = [{ id: '5', title: 'Ungraded task' }];
  await vm.runInNewContext("openTeacherDeleteModal('assignment', '5', 'Ungraded task');", context);
  assert.match(element('teacherDeleteConfirmDescription').textContent, /2 student submission records/);
  assert.equal(element('teacherDeleteConfirmButton').disabled, false);

  context.window.EDUGNAY_API.getAssignmentSubmissions = async () => { throw new Error('Offline'); };
  context.showAppToast = () => {};
  await vm.runInNewContext("openTeacherDeleteModal('assignment', '5', 'Ungraded task');", context);
  assert.match(element('teacherDeleteConfirmDescription').textContent, /Could not check current submissions/);
  assert.equal(element('teacherDeleteConfirmButton').disabled, true);
});

test('a changed submission count reopens the delete warning', async () => {
  const confirmSource = sectionsSource.match(/async function confirmTeacherDelete\(\) \{[\s\S]*?\n  \}\n\n  document\.getElementById\('teacherDeleteConfirmButton'\)/)[0]
    .replace(/\n\n  document\.getElementById\('teacherDeleteConfirmButton'\)$/, '');
  const button = { disabled: false, textContent: 'Delete Assignment' };
  const refreshed = [];
  const context = {
    pendingTeacherDelete: { kind: 'assignment', id: '4', gradingItemId: null, expectedSubmissionCount: 2 },
    teacherDeletePending: false,
    document: { getElementById: id => id === 'teacherDeleteConfirmButton' ? button : { textContent: 'Wrong task' } },
    window: { EDUGNAY_API: { async deleteAssignment(id, count) {
      assert.equal(id, '4');
      assert.equal(count, 2);
      throw { status: 409, message: 'Submissions changed. Review the updated count and confirm deletion again.' };
    } } },
    showAppToast() {},
    openTeacherDeleteModal: (...args) => refreshed.push(args)
  };
  await vm.runInNewContext(`${confirmSource}; confirmTeacherDelete();`, context);
  assert.deepEqual(refreshed, [['assignment', '4', 'Wrong task']]);
  assert.equal(context.teacherDeletePending, false);
});

test('modified teacher page scripts still parse', () => {
  for (const html of [dashboardSource, sectionsSource]) {
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .map(match => match[1]).filter(Boolean);
    scripts.forEach(source => new vm.Script(source));
  }
});
