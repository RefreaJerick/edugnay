const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/031_school_registration_email_outbox.sql'), 'utf8');
const accessEmailMigration = fs.readFileSync(path.join(__dirname, '../database/migrations/032_school_registration_access_emails.sql'), 'utf8');
const smtpMetadataMigration = fs.readFileSync(path.join(__dirname, '../database/migrations/033_school_registration_email_smtp_metadata.sql'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');

test('registration decision outbox migration preserves existing tables and captures retry state', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS school_registration_email_outbox/);
  assert.match(migration, /recipient_email VARCHAR\(255\) NULL/);
  assert.match(migration, /decision ENUM\('approved', 'rejected'\)/);
  assert.match(migration, /status ENUM\('pending', 'sending', 'sent', 'skipped', 'failed'\)/);
  assert.match(migration, /attempts TINYINT UNSIGNED/);
  assert.match(migration, /manual_retries SMALLINT UNSIGNED/);
  assert.match(migration, /last_error VARCHAR\(255\)/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE FROM)\b/i);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS school_registration_email_outbox/);
});

test('school access email migration extends the event enum without deleting outbox rows', () => {
  assert.match(accessEmailMigration, /ALTER TABLE school_registration_email_outbox/);
  assert.match(accessEmailMigration, /ENUM\('approved', 'rejected', 'suspended', 'reactivated'\)/);
  assert.doesNotMatch(accessEmailMigration, /\b(?:DROP|TRUNCATE|DELETE FROM)\b/i);
  assert.match(schema, /decision ENUM\('approved', 'rejected', 'suspended', 'reactivated'\)/);
});

test('SMTP metadata migration adds message references and sanitized responses without replacing outbox history', () => {
  assert.match(smtpMetadataMigration, /ALTER TABLE school_registration_email_outbox/);
  assert.match(smtpMetadataMigration, /ADD COLUMN smtp_message_id VARCHAR\(255\) NULL/);
  assert.match(smtpMetadataMigration, /ADD COLUMN smtp_response VARCHAR\(255\) NULL/);
  assert.doesNotMatch(smtpMetadataMigration, /\b(?:DROP|TRUNCATE|DELETE FROM)\b/i);
  assert.match(schema, /smtp_message_id VARCHAR\(255\) NULL/);
  assert.match(schema, /smtp_response VARCHAR\(255\) NULL/);
});
