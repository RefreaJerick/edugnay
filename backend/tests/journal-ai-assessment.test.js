const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');
const { validateCriteria } = require('../services/journalAssessmentAi');

let rows;
let calls;
const database = {
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('FROM school_portal_features') && sql.includes('journal_subjects')) return [[{ id: 7, subjectId: 4 }]];
    if (sql.includes('journal_ai_approved_at AS approvedAt')) return [[rows.approved ? { approvedAt: new Date() } : { approvedAt: null }]];
    if (sql.includes('FROM student_journal_entries AS entries')) return [rows.entry ? [{ id: 11, sectionId: 8, promptText: 'Describe your learning.', entryText: 'I tried, asked for help, and learned.', maxScore: rows.maxScore ?? 50 }] : []];
    if (sql.includes('FROM section_teachers\n')) return [rows.assigned ? [{ id: 1 }] : []];
    if (sql.includes('SELECT criteria FROM journal_ai_rubrics')) return [[rows.rubric ? { criteria: JSON.stringify(rows.rubric) } : undefined].filter(Boolean)];
    if (sql.includes('SELECT id FROM section_teachers')) return [rows.assigned ? [{ id: 1 }] : []];
    if (sql.includes('FROM journal_ai_assessments')) return [[rows.latest || undefined].filter(Boolean)];
    if (sql.startsWith('UPDATE journal_ai_daily_usage SET call_count')) return [{ affectedRows: rows.quota ? 1 : 0 }];
    if (sql.startsWith('INSERT INTO journal_ai_assessments')) return [{ insertId: 20 }];
    return [{ affectedRows: 1 }];
  }
};
databaseModule.getDatabase = () => database;
const assessment = require('../controllers/journalAssessmentController');

async function invoke(handler, options = {}) {
  calls = [];
  rows = { approved: true, entry: true, assigned: true, quota: true, ...options };
  const result = {};
  await handler({ user: { id: 5, schoolId: 1, role: 'teacher' }, params: { entryId: '11' }, body: options.body || {} }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  return result;
}

const previous = {
  enabled: process.env.AI_JOURNAL_ASSESSMENT_ENABLED,
  key: process.env.OPENAI_API_KEY,
  limit: process.env.AI_JOURNAL_DAILY_CALL_LIMIT
};
const originalFetch = globalThis.fetch;
test.after(() => {
  for (const [name, value] of [['AI_JOURNAL_ASSESSMENT_ENABLED', previous.enabled], ['OPENAI_API_KEY', previous.key], ['AI_JOURNAL_DAILY_CALL_LIMIT', previous.limit]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  globalThis.fetch = originalFetch;
});
process.env.AI_JOURNAL_ASSESSMENT_ENABLED = 'true';
process.env.OPENAI_API_KEY = 'test-key';
process.env.AI_JOURNAL_DAILY_CALL_LIMIT = '2';

test('validates editable rubric names and points', () => {
  assert.deepEqual(validateCriteria([{ name: ' Reflection ', points: 5 }]), [{ name: 'Reflection', points: 5 }]);
  assert.throws(() => validateCriteria([{ name: 'Reflection', points: 5 }, { name: 'reflection', points: 5 }]));
  assert.throws(() => validateCriteria([{ name: 'Reflection', points: 0 }]));
});

test('teacher can save a reusable rubric only while journal AI is approved', async () => {
  const body = { criteria: [{ name: 'Reflection', points: 10 }] };
  const saved = await invoke(assessment.saveRubric, { body });
  assert.ifError(saved.error);
  assert.deepEqual(saved.body.criteria, body.criteria);
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO journal_ai_rubrics')));
  const denied = await invoke(assessment.saveRubric, { body, approved: false });
  assert.equal(denied.error.status, 403);
  assert.ok(!calls.some(call => call.sql.includes('INSERT INTO journal_ai_rubrics')));
});

test('rubric controls stay unavailable to an unassigned teacher', async () => {
  const result = await invoke(assessment.getRubric, { assigned: false });
  assert.ifError(result.error);
  assert.equal(result.body.enabled, false);
  assert.equal(result.body.criteria.length, 4);
});

test('assessment suggests a scaled score without writing a student grade', async () => {
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.store, false);
    assert.deepEqual(JSON.parse(body.input).criteria.map(item => item.points), [5, 5, 5, 5]);
    return { ok: true, json: async () => ({ status: 'completed', usage: { input_tokens: 10, output_tokens: 7 },
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ scores: [5, 4, 5, 4], feedback: 'Good reflection.' }) }] }] }) };
  };
  const result = await invoke(assessment.assessEntry);
  assert.ifError(result.error);
  assert.equal(result.status, 201);
  assert.equal(result.body.assessment.suggestedScore, 45);
  assert.ok(calls.some(call => call.sql.startsWith('INSERT INTO journal_ai_assessments')));
  assert.ok(!calls.some(call => /student_scores|entry_status/.test(call.sql)));
  const smallerItem = await invoke(assessment.assessEntry, { maxScore: 20 });
  assert.ifError(smallerItem.error);
  assert.equal(smallerItem.body.assessment.suggestedScore, 18);
});

test('new AI suggestions round to whole numbers without exceeding a fractional maximum', async () => {
  let scores = [5, 4, 5, 5];
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 },
    output: [{ content: [{ type: 'output_text', text: JSON.stringify({ scores, feedback: 'Good reflection.' }) }] }] }) });

  const rounded = await invoke(assessment.assessEntry);
  assert.ifError(rounded.error);
  assert.equal(rounded.body.assessment.suggestedScore, 48);
  assert.equal(calls.find(call => call.sql.startsWith('INSERT INTO journal_ai_assessments')).values[5], 48);

  scores = [5, 5, 5, 5];
  const capped = await invoke(assessment.assessEntry, { maxScore: 47.5 });
  assert.ifError(capped.error);
  assert.equal(capped.body.assessment.suggestedScore, 47);
  assert.equal(calls.find(call => call.sql.startsWith('INSERT INTO journal_ai_assessments')).values[5], 47);
});

test('school approval, assignment, and daily limit stop assessment before the AI call', async () => {
  for (const options of [{ approved: false }, { assigned: false }, { quota: false }]) {
    let providerCalls = 0;
    globalThis.fetch = async () => { providerCalls++; throw new Error('Should not call provider'); };
    const result = await invoke(assessment.assessEntry, options);
    assert.ok(result.error);
    assert.equal(providerCalls, 0);
    assert.ok(!calls.some(call => call.sql.startsWith('INSERT INTO journal_ai_assessments')));
  }
});

test('invalid provider scores do not save an assessment', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'completed',
    output: [{ content: [{ type: 'output_text', text: JSON.stringify({ scores: [6, 4, 5, 4], feedback: 'Too high.' }) }] }] }) });
  const result = await invoke(assessment.assessEntry);
  assert.equal(result.error.status, 502);
  assert.ok(!calls.some(call => call.sql.startsWith('INSERT INTO journal_ai_assessments')));
});

test('only assigned teachers can read saved suggestions', async () => {
  const latest = { id: 20, rubric_snapshot: JSON.stringify([{ name: 'Reflection', points: 5 }]), criterion_scores: '[4]', suggested_score: '40.00', max_score_snapshot: '50.00', feedback: 'Helpful detail.' };
  const allowed = await invoke(assessment.getAssessment, { latest });
  assert.ifError(allowed.error);
  assert.equal(allowed.body.assessment.suggestedScore, 40);
  const historic = await invoke(assessment.getAssessment, { latest: { ...latest, suggested_score: '47.50' } });
  assert.ifError(historic.error);
  assert.equal(historic.body.assessment.suggestedScore, 47.5);
  const denied = await invoke(assessment.getAssessment, { latest, assigned: false });
  assert.equal(denied.error.status, 403);
});
