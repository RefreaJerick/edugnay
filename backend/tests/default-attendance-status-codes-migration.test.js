const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/039_seed_default_attendance_status_codes.sql'), 'utf8');

test('attendance-code migration seeds the four canonical active codes only for schools with no codes', () => {
  assert.match(migration, /INSERT INTO attendance_status_codes/);
  for (const [code, key] of [['present', 'P'], ['absent', 'A'], ['late', 'L'], ['excused', 'E']]) {
    assert.match(migration, new RegExp(`'${code}'[\\s\\S]*?'${key}'`));
  }
  assert.match(migration, /'Student attended class\.'/);
  assert.match(migration, /'Student did not attend class\.'/);
  assert.match(migration, /'Student arrived after attendance was taken\.'/);
  assert.match(migration, /'Student absence has a recorded excuse\.'/);
  assert.match(migration, /WHERE NOT EXISTS \([\s\S]*?existing_codes\.school_id = schools\.id/);
  assert.match(migration, /display_tone, is_active\)[\s\S]*?TRUE/);
});

test('attendance-code migration is idempotent and preserves every school with existing code rows', () => {
  const guard = migration.match(/WHERE NOT EXISTS \(([\s\S]*?)\);/);
  assert.ok(guard);
  assert.match(guard[1], /FROM attendance_status_codes AS existing_codes/);
  assert.match(guard[1], /existing_codes\.school_id = schools\.id/);
});
