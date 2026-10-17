const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'database/migrations/042_attendance_always_available.sql'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');

test('attendance migration enables existing schools and defaults future feature rows on', () => {
  assert.match(migration, /ALTER TABLE school_portal_features[\s\S]*?attendance_enabled BOOLEAN NOT NULL DEFAULT TRUE/i);
  assert.match(migration, /UPDATE school_portal_features\s+SET attendance_enabled = TRUE/i);
  assert.match(schema, /attendance_enabled BOOLEAN NOT NULL DEFAULT TRUE/i);
});
