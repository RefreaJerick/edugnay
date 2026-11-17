'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  SCHOOL_NAME,
  buildDeleteOrder,
  getReachableTables,
  getStorageDirectories,
  askForConfirmation,
  parseArgs,
  resolveManagedFile,
  restoreFiles,
  stageFiles,
  verifyRdsTarget
} = require('../scripts/deleteSaintColumbansSchool');

test('preview is the default and apply requires a snapshot, instance, and region', () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.throws(() => parseArgs(['--apply']), /snapshot/);
  assert.deepEqual(parseArgs([
    '--apply', '--snapshot-id', 'pre-delete-1',
    '--rds-instance-id', 'academix-db', '--region', 'ap-southeast-1'
  ]), {
    apply: true,
    snapshotId: 'pre-delete-1',
    rdsInstanceId: 'academix-db',
    region: 'ap-southeast-1'
  });
  assert.throws(() => parseArgs(['--snapshot-id', 'pre-delete-1']), /only valid with --apply/);
});

test('apply confirmation must match the displayed school ID and name exactly', async () => {
  assert.equal(await askForConfirmation('DELETE 37 Saint Columban\'s College', async phrase => phrase), true);
  assert.equal(await askForConfirmation('DELETE 37 Saint Columban\'s College', async () => 'yes'), false);
});

test('delete order removes FK children before parents and rejects cycles', () => {
  const order = buildDeleteOrder({ schools: 1, users: 2, user_sessions: 2 }, [
    { parentTable: 'schools', childTable: 'users' },
    { parentTable: 'users', childTable: 'user_sessions' }
  ]);
  assert.deepEqual(order, ['user_sessions', 'users', 'schools']);
  assert.throws(() => buildDeleteOrder({ first: 1, second: 1 }, [
    { parentTable: 'first', childTable: 'second' },
    { parentTable: 'second', childTable: 'first' }
  ]), /foreign-key cycle/);
});

test('scope discovery keeps global school-form templates outside the delete graph', () => {
  const tables = new Map([
    ['schools', { name: 'schools', columns: new Set(['id']) }],
    ['users', { name: 'users', columns: new Set(['school_id']) }],
    ['school_form_templates', { name: 'school_form_templates', columns: new Set(['school_id', 'published_by_user_id']) }],
    ['school_form_template_mappings', { name: 'school_form_template_mappings', columns: new Set(['school_form_template_id']) }],
    ['school_form_exports', { name: 'school_form_exports', columns: new Set(['school_id']) }],
    ['school_form_export_issues', { name: 'school_form_export_issues', columns: new Set(['school_form_export_id']) }]
  ]);
  const reachable = getReachableTables(tables, [
    { parentTable: 'users', childTable: 'school_form_templates' },
    { parentTable: 'school_form_templates', childTable: 'school_form_template_mappings' },
    { parentTable: 'school_form_templates', childTable: 'school_form_exports' },
    { parentTable: 'school_form_exports', childTable: 'school_form_export_issues' }
  ]);
  assert.deepEqual(reachable, ['school_form_export_issues', 'school_form_exports', 'schools', 'users']);
});

test('managed file paths stay inside the configured private storage folders', () => {
  const projectRoot = path.resolve('test-project');
  const directories = getStorageDirectories({ projectRoot, cwd: projectRoot, home: path.resolve('test-home'), env: {} });
  const avatar = resolveManagedFile('users', 'avatar_filename', `${'a'.repeat(36)}.png`, directories);
  assert.equal(avatar.path, path.join(directories.avatar, `${'a'.repeat(36)}.png`));

  const legacySubmission = resolveManagedFile('assignment_submissions', 'file_path',
    '/uploads/assignment-submissions/old-work.pdf', directories);
  assert.equal(legacySubmission.path, path.join(directories.legacyAssignmentSubmission, 'old-work.pdf'));

  const traversal = resolveManagedFile('assignment_submissions', 'file_path',
    'uploads/assignment-submissions/../../outside.pdf', directories);
  assert.match(traversal.error, /Unsupported stored upload path/);
  assert.match(resolveManagedFile('school_form_templates', 'file_path', 'global.xlsx', directories).error, /No managed upload/);
});

test('staged uploads are restored when the database transaction rolls back', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'school-delete-test-'));
  try {
    const sourcePath = path.join(directory, 'student-work.pdf');
    await fs.writeFile(sourcePath, 'file contents');
    const staged = [];
    await stageFiles([{ path: sourcePath, fileName: 'student-work.pdf', status: 'will-remove' }], 'test-run', staged);
    assert.equal(await fs.stat(sourcePath).then(() => true, () => false), false);
    assert.deepEqual(await restoreFiles(staged), []);
    assert.equal(await fs.readFile(sourcePath, 'utf8'), 'file contents');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('RDS apply guard requires an available snapshot and the exact MariaDB endpoint', async () => {
  const awsJson = async args => args[1] === 'describe-db-snapshots'
    ? { DBSnapshots: [{ DBSnapshotIdentifier: 'before-delete', DBInstanceIdentifier: 'academix-db', SnapshotType: 'manual', Status: 'available' }] }
    : { DBInstances: [{ DBInstanceIdentifier: 'academix-db', DBInstanceStatus: 'available', Engine: 'mariadb', Endpoint: { Address: 'db.example' } }] };
  const args = {
    region: 'ap-southeast-1', snapshotId: 'before-delete', instanceId: 'academix-db',
    databaseName: 'academix', databaseHost: 'db.example:3306', awsJson
  };
  assert.deepEqual(await verifyRdsTarget(args), { snapshotId: 'before-delete', instanceId: 'academix-db', endpoint: 'db.example' });
  await assert.rejects(verifyRdsTarget({ ...args, databaseHost: 'localhost' }), /does not match the endpoint/);
  await assert.rejects(verifyRdsTarget({ ...args, awsJson: async () => ({ DBSnapshots: [{ SnapshotType: 'manual', Status: 'creating' }], DBInstances: [] }) }), /status available/);
});
