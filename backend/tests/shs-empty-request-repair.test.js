const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/058_repair_empty_shs_requests.sql'), 'utf8');

test('empty pending and returned SHS requests are repaired without deleting history', () => {
  assert.match(migration, /UPDATE shs_selection_requests r/);
  assert.match(migration, /SET r\.status = 'not_recorded'/);
  assert.match(migration, /r\.revision = r\.revision \+ 1/);
  assert.match(migration, /WHERE \(r\.status IN \('pending', 'rejected'\) OR r\.status = ''\)/);
  assert.match(migration, /NOT EXISTS \([\s\S]*?FROM shs_selection_request_classes rc[\s\S]*?rc\.request_id = r\.id/);
  assert.doesNotMatch(migration, /DELETE FROM shs_selection_history|UPDATE shs_selection_history/);
  assert.doesNotMatch(migration, /r\.status = 'approved'/);
});
