const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const pageFs = require('./helpers/page-fs');

const script = pageFs.readFileSync(path.join(__dirname, '../../assets/js/admin/users.js'), 'utf8');
const validation = script.split('    function validateAccountFormData(data) {')[1]
  .split('    function openBackendCredentialDeliveryModal(')[0];
const context = vm.createContext({ USERS: [] });
vm.runInContext(`function validateAccountFormData(data) {${validation}`, context);

function parentData(userId = '', parentLinks = []) {
  return {
    userId, firstName: 'Test', lastName: 'Parent',
    personalEmail: 'parent@example.test', role: 'parent', parentLinks
  };
}

test('parent accounts can be created or edited without linked students', () => {
  assert.equal(context.validateAccountFormData(parentData()), '');
  assert.equal(context.validateAccountFormData(parentData('9')), '');
});

test('linked students still need a relationship and cannot be duplicated', () => {
  assert.equal(
    context.validateAccountFormData(parentData('', [{ studentId: '6', relationship: '' }])),
    'Please choose a relationship for every linked student.'
  );
  assert.equal(
    context.validateAccountFormData(parentData('9', [
      { studentId: '6', relationship: 'mother' },
      { studentId: '6', relationship: 'guardian' }
    ])),
    'A student can only be linked once.'
  );
  assert.equal(
    context.validateAccountFormData(parentData('9', [{ studentId: '6', relationship: 'mother' }])),
    ''
  );
});

test('removing the last linked student sends an empty link list on save', () => {
  const linkPayload = script.split('      if (data.parentLinks !== undefined && (!data.userId ||')[1]
    .split('      try {')[0];
  const save = vm.createContext({
    data: parentData('9'),
    payload: {},
    originalLinkedStudents: [{ studentId: '6', relationship: 'mother' }]
  });
  vm.runInContext(`if (data.parentLinks !== undefined && (!data.userId ||${linkPayload}`, save);
  assert.deepEqual(Array.from(save.payload.parentLinks), []);
});
