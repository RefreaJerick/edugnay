const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
const names = [
  'normalizeApiAssignment', 'getApiAssignments', 'createApiAssignment', 'updateApiAssignment',
  'normalizeApiGradingItem', 'getApiGradingItems', 'createApiGradingItem', 'updateApiGradingItem'
];
const functions = names.map(name => {
  const source = script.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))?.[0];
  assert.ok(source, `${name} must exist`);
  return source;
}).join('\n');

function client() {
  const requests = [];
  let savedItem = { id: 21, sectionId: 2, subjectId: 3, academicTermId: 4, title: 'Activity', maxScore: 10 };
  let savedAssignment = { id: 31, sectionId: 2, subjectId: 3, academicTermId: 4,
    title: 'Task', maxScore: 10, status: 'published' };
  const context = vm.createContext({ URLSearchParams, requestApi: async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, method: options.method || 'GET', body });
    if (url.startsWith('/grading-items')) {
      if (options.method === 'POST') savedItem = { ...savedItem, ...body };
      if (options.method === 'PATCH') savedItem = { ...savedItem, ...body };
      return options.method ? { gradingItem: savedItem } : { gradingItems: [savedItem] };
    }
    if (options.method === 'POST') savedAssignment = { ...savedAssignment, ...body };
    if (options.method === 'PATCH') savedAssignment = { ...savedAssignment, ...body };
    return options.method ? { assignment: savedAssignment } : { assignments: [savedAssignment] };
  } });
  vm.runInContext(functions, context);
  return { context, requests };
}

test('score-item create, update, and reload keep the selected domain', async () => {
  const { context, requests } = client();
  const created = await context.createApiGradingItem({ sectionId: 2, subjectId: 3, academicTermId: 4,
    subjectGradingComponentId: 5, domainCode: 'affective', title: 'Activity', maxScore: 10 });
  assert.equal(requests.at(-1).body.domainCode, 'affective');
  assert.equal(created.domainCode, 'affective');
  const updated = await context.updateApiGradingItem(21, { domainCode: 'cognitive' });
  assert.equal(requests.at(-1).body.domainCode, 'cognitive');
  assert.equal(updated.domainCode, 'cognitive');
  await context.updateApiGradingItem(21, { title: 'Renamed' });
  assert.equal(Object.hasOwn(requests.at(-1).body, 'domainCode'), false);
  assert.equal((await context.getApiGradingItems({ sectionId: 2 }))[0].domainCode, 'cognitive');
  await context.updateApiGradingItem(21, { domainCode: null });
  assert.equal(requests.at(-1).body.domainCode, null);
  await context.createApiGradingItem({ sectionId: 2, subjectId: 3, academicTermId: 4,
    gradingCategoryId: 6, title: 'Other subject', maxScore: 10 });
  assert.equal(requests.at(-1).body.domainCode, null);
});

test('graded-assignment create, update, and reload keep the selected domain', async () => {
  const { context, requests } = client();
  const created = await context.createApiAssignment({ sectionId: 2, subjectId: 3, academicTermId: 4,
    subjectGradingComponentId: 5, domainCode: 'behavioral', title: 'Task', maxScore: 10 });
  assert.equal(requests.at(-1).body.domainCode, 'behavioral');
  assert.equal(created.domainCode, 'behavioral');
  const updated = await context.updateApiAssignment(31, { domainCode: 'cognitive' });
  assert.equal(requests.at(-1).body.domainCode, 'cognitive');
  assert.equal(updated.domainCode, 'cognitive');
  await context.updateApiAssignment(31, { title: 'Renamed' });
  assert.equal(Object.hasOwn(requests.at(-1).body, 'domainCode'), false);
  assert.equal((await context.getApiAssignments({ sectionId: 2 }))[0].domainCode, 'cognitive');
  await context.updateApiAssignment(31, { domainCode: null });
  assert.equal(requests.at(-1).body.domainCode, null);
  await context.createApiAssignment({ sectionId: 2, subjectId: 3, title: 'Ungraded' });
  assert.equal(requests.at(-1).body.domainCode, null);
});
