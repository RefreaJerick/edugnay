const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const shell = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-users.html'), 'utf8');
const generator = shell.slice(shell.indexOf('  function schoolEmailDomain('), shell.indexOf('  function formatDateTime(', shell.indexOf('  function schoolEmailDomain(')));

test('read-only preview uses the stored school domain and the backend parent suffix', () => {
  const context = {
    ROLE_ALIASES: {},
    RECORD_VALUES: { roles: { SCHOOL_ADMIN: 'school_admin', TEACHER: 'teacher', STUDENT: 'student', PARENT: 'parent' } },
    USERS: [],
    getActiveSchool: () => ({ schoolEmailDomain: 'stcolumban.edu.ph' })
  };
  const generate = vm.runInNewContext(`${generator}\ngenerateSchoolEmail`, context);
  const values = { firstName: 'José', lastName: 'Dela Cruz', role: 'parent' };
  assert.equal(generate(values), 'j.delacruz.par@stcolumban.edu.ph');
  assert.equal(generate({ ...values, existingUsers: [{ schoolEmail: 'j.delacruz.par@stcolumban.edu.ph' }] }),
    'j.delacruz.par2@stcolumban.edu.ph');
  assert.equal(generate({ ...values, existingUsers: [
    { schoolEmail: 'j.delacruz.par@stcolumban.edu.ph' },
    { schoolEmail: 'j.delacruz.par2@stcolumban.edu.ph' }
  ] }), 'j.delacruz.par3@stcolumban.edu.ph');
  assert.equal(generate({ ...values, schoolEmailDomain: 'mnhs.academix.test' }), 'j.delacruz.par@mnhs.academix.test');
  context.getActiveSchool = () => ({ email: 'office@unrelated.example', website: 'unrelated.example' });
  assert.equal(generate(values), '');
});

test('account form previews but never submits a client-chosen login address', () => {
  assert.match(page, /id="accountSchoolEmail"[^>]*readonly/);
  assert.doesNotMatch(page, /schoolEmail:\s*data\.schoolEmail/);
  assert.doesNotMatch(page, /schoolEmail:\s*accountFieldValue\('accountSchoolEmail'\)/);
  assert.match(page, /openBackendCredentialDeliveryModal\(result\.user, result\.emailDelivery\)/);
});

test('editing an account does not submit its immutable role', () => {
  assert.match(page, /if \(!data\.userId\) payload\.role = data\.role/);
  assert.doesNotMatch(page, /role:\s*data\.role/);
});
