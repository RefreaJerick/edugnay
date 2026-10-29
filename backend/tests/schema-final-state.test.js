const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const databaseDir = path.join(__dirname, '../database');
const schema = fs.readFileSync(path.join(databaseDir, 'schema.sql'), 'utf8');
const readMigration = number => {
  const name = fs.readdirSync(path.join(databaseDir, 'migrations'))
    .find(file => file.startsWith(`${number}_`));
  return fs.readFileSync(path.join(databaseDir, 'migrations', name), 'utf8');
};

test('fresh schema includes every table created by the numbered migrations', () => {
  for (const file of fs.readdirSync(path.join(databaseDir, 'migrations')).filter(name => /^\d{3}_.*\.sql$/.test(name))) {
    const sql = fs.readFileSync(path.join(databaseDir, 'migrations', file), 'utf8');
    for (const [, table] of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+`?([a-z0-9_]+)`?/gi)) {
      assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, 'i'), `${file}: ${table}`);
    }
  }
});

test('fresh schema includes final school-scoped constraints and child ownership', () => {
  for (const number of ['021', '022', '025']) {
    const sql = readMigration(number);
    for (const [, name] of sql.matchAll(/ADD CONSTRAINT\s+([a-z0-9_]+)/gi)) {
      assert.match(schema, new RegExp(`\\b${name}\\b`), `${number}: ${name}`);
    }
    for (const [, name] of sql.matchAll(/ADD UNIQUE KEY\s+([a-z0-9_]+)/gi)) {
      assert.match(schema, new RegExp(`\\b${name}\\b`), `${number}: ${name}`);
    }
  }
  for (const table of ['academic_term_actions', 'announcement_audiences', 'announcement_reads',
    'announcement_email_outbox', 'journal_prompts', 'student_journal_entries', 'journal_feedback',
    'report_reopen_requests', 'intervention_progress_entries']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(\\s*id[^\\n]*\\n\\s*school_id BIGINT UNSIGNED NOT NULL`, 'i'), table);
  }
  assert.match(schema, /fk_student_scores_tenant_recorder/);
  assert.match(schema, /idx_journal_entries_owner \(school_id, owner_teacher_user_id\)/);
});

test('fresh schema has the final SHS teaching and grading structures', () => {
  for (const name of ['shs_offerings', 'shs_elective_classes', 'shs_selection_requests',
    'shs_grade_publication_history', 'shs_grade_score_corrections',
    'shs_completion_confirmation_history']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${name}\\s*\\(`));
  }
  for (const name of ['ck_attendance_session_scope', 'ck_elective_assignment_grading_scope',
    'ck_grading_item_owner', 'ck_published_grade_owner', 'fk_published_grade_latest_history']) {
    assert.match(schema, new RegExp(`\\b${name}\\b`));
  }
  assert.doesNotMatch(schema, /ck_elective_assignment_ungraded|strengthened_shs_grade12_pilot/);
  assert.doesNotMatch(schema, /Apply migrations\/021|Run this file, migrations 021/);
});

test('fresh install keeps built-in form metadata separate from demo records', () => {
  const reference = fs.readFileSync(path.join(databaseDir, 'reference-data.sql'), 'utf8');
  for (const form of ['SF1', 'SF2', 'SF3', 'SF5', 'SF8', 'SF9']) {
    assert.match(reference, new RegExp(`'${form}'`));
  }
  assert.match(reference, /'finalGrade', default_sheet_name, 'I32'/);
  assert.doesNotMatch(reference, /INSERT INTO (?:schools|users|sections)\b/i);
  assert.doesNotMatch(schema, /INSERT INTO (?:schools|users|sections)\b/i);
});

test('demo inserts provide school ownership for required tenant tables', () => {
  const demo = fs.readFileSync(path.join(databaseDir, 'demo-data.sql'), 'utf8');
  for (const [, table, columns] of demo.matchAll(/INSERT INTO\s+([a-z0-9_]+)\s*\(([^)]+)\)/gi)) {
    const definition = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\) ENGINE=InnoDB`, 'i'));
    assert.ok(definition, `Missing schema table: ${table}`);
    if (/^\s*school_id BIGINT UNSIGNED NOT NULL\b/im.test(definition[1])) {
      assert.match(columns, /\bschool_id\b/i, `${table} demo rows must include school_id`);
    }
  }
});
