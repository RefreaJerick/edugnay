const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/journal-history-viewer.js'), 'utf8');

function groupLegacyEntries(entries) {
  const window = { EDUGNAY_CONFIG: { escapeHtml: value => String(value ?? '') } };
  vm.runInNewContext(source, { window });
  return window.EDUGNAY_JOURNAL_HISTORY.groupLegacyEntries(entries);
}

function setup(count) {
  const handlers = {};
  const list = {
    innerHTML: '<p>History cards</p>',
    scrollTop: 42,
    addEventListener(name, handler) { handlers[name] = handler; },
    querySelector() { return { focus() {}, setSelectionRange() {} }; },
    querySelectorAll() { return []; }
  };
  const window = {
    EDUGNAY_CONFIG: { escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') },
    lucide: { createIcons() {} },
    matchMedia: () => ({ matches: false })
  };
  vm.runInNewContext(source, { window });
  const viewer = window.EDUGNAY_JOURNAL_HISTORY.createEntryViewer(list, () => 'Oct 3, 2026');
  const entries = Array.from({ length: count }, (_, index) => ({
    id: String(index + 1), studentName: `Student ${String(index + 1).padStart(2, '0')}`,
    submittedAt: '2026-10-03', status: 'submitted', entryText: `Full response ${index + 1}`,
    score: null
  }));
  viewer.open({ groupKey: 'prompt:1', title: 'Submitted entries', context: 'Week of Sep 28', entries });
  function click(attribute, value) {
    handlers.click({ target: { closest(selector) {
      return selector.split(',').some(part => part.trim() === `[${attribute}]`) ? { dataset: { entryStudent: value } } : null;
    } } });
  }
  return { list, handlers, click, viewer };
}

for (const [count, label] of [[0, '0 entries'], [1, '1–1 of 1'], [10, '1–10 of 10'], [11, '1–10 of 11'], [50, '1–10 of 50']]) {
  test(`entry viewer shows the correct first page for ${count} entries`, () => {
    const { list } = setup(count);
    assert.ok(list.innerHTML.includes(label));
    assert.equal((list.innerHTML.match(/data-entry-student=/g) || []).length, Math.min(count, 10));
  });
}

test('next page shows at most ten students and one full response', () => {
  const { list, click } = setup(50);
  assert.match(list.innerHTML, /Full response 1/);
  assert.doesNotMatch(list.innerHTML, /Full response 2/);
  click('data-entry-next');
  assert.match(list.innerHTML, /11–20 of 50/);
  assert.equal((list.innerHTML.match(/data-entry-student=/g) || []).length, 10);
  assert.match(list.innerHTML, /Full response 11/);
});

test('search filters students and resets the page', () => {
  const { list, handlers, click } = setup(50);
  click('data-entry-next');
  handlers.input({ target: { matches: selector => selector === '[data-entry-search]', value: 'Student 42', selectionStart: 10 } });
  assert.match(list.innerHTML, /1–1 of 1/);
  assert.match(list.innerHTML, /Full response 42/);
  handlers.input({ target: { matches: selector => selector === '[data-entry-search]', value: 'Nobody', selectionStart: 6 } });
  assert.match(list.innerHTML, /No students match your search/);
});

test('back restores the history cards and scroll position', () => {
  const { list, click } = setup(11);
  click('data-entry-back');
  assert.equal(list.innerHTML, '<p>History cards</p>');
  assert.equal(list.scrollTop, 42);
});

test('selecting a student shows only that full response and mobile back keeps the list', () => {
  const { list, click } = setup(11);
  click('data-entry-student', '2');
  assert.match(list.innerHTML, /Full response 2/);
  assert.doesNotMatch(list.innerHTML, /Full response 1</);
  assert.match(list.innerHTML, /is-detail/);
  click('data-entry-list-back');
  assert.doesNotMatch(list.innerHTML, /journal-entry-viewer is-detail/);
  assert.match(list.innerHTML, /1–10 of 11/);
});

test('student-written text is escaped in the detail view', () => {
  const { list, viewer } = setup(1);
  viewer.open({ groupKey: 'prompt:1', title: 'Entries', context: 'Week', entries: [{
    id: '1', studentName: '<Student>', entryText: '<script>alert(1)</script>', submittedAt: '2026-10-03', score: null
  }] });
  assert.match(list.innerHTML, /&lt;script>/);
  assert.doesNotMatch(list.innerHTML, /<script>/);
});

test('legacy feedback is not shown in history', () => {
  const { list, viewer } = setup(1);
  viewer.open({ groupKey: 'prompt:1', title: 'Entries', context: 'Week', entries: [{
    id: '1', studentName: 'Student', entryText: 'Reflection', submittedAt: '2026-10-03',
    feedback: { text: '<script>comment</script>', teacherName: '<Teacher>', createdAt: '2026-10-03' }
  }] });
  assert.doesNotMatch(list.innerHTML, /Teacher feedback|comment|Teacher/);
});

test('legacy entries with the same saved prompt and submission week share a group', () => {
  const groups = groupLegacyEntries([
    { id: '1', promptId: null, journalSubjectId: '1', sectionId: '8', journalSubjectName: 'Values Education', sectionName: 'St. Matthew', promptText: 'Describe a moment this week.', submittedAt: '2025-06-12T05:00:00.000Z' },
    { id: '2', promptId: null, journalSubjectId: '1', sectionId: '8', journalSubjectName: 'Values Education', sectionName: 'St. Matthew', promptText: 'Describe a moment this week.', submittedAt: '2025-06-13T05:00:00.000Z' },
    { id: '3', promptId: null, journalSubjectId: '1', sectionId: '8', journalSubjectName: 'Values Education', sectionName: 'St. Matthew', promptText: 'Describe a moment this week.', submittedAt: '2025-06-16T05:00:00.000Z' }
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(Array.from(groups[0].entries, entry => entry.id), ['1', '2']);
  assert.equal(groups[0].weekStartDate, '2025-06-09');
  assert.equal(groups[1].weekStartDate, '2025-06-16');
});

test('legacy entries stay separate across prompt text, section, or subject', () => {
  const base = { promptId: null, journalSubjectId: '1', sectionId: '8', promptText: 'Reflect.', submittedAt: '2025-06-12T05:00:00.000Z' };
  const groups = groupLegacyEntries([
    { ...base, id: '1' },
    { ...base, id: '2', promptText: 'A different saved question.' },
    { ...base, id: '3', sectionId: '9' },
    { ...base, id: '4', journalSubjectId: '2' },
    { ...base, id: '5', promptId: '10' }
  ]);

  assert.equal(groups.length, 4);
  assert.ok(groups.every(group => group.entries.length === 1));
  assert.ok(groups.every(group => group.key.startsWith('legacy:')));
});

test('missing legacy prompt text remains grouped without inventing a question', () => {
  const groups = groupLegacyEntries([
    { id: '1', promptId: null, journalSubjectId: '1', sectionId: '8', submittedAt: '2025-06-12T05:00:00.000Z' },
    { id: '2', promptId: null, journalSubjectId: '1', sectionId: '8', submittedAt: '2025-06-13T05:00:00.000Z' }
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].promptText, '');
  assert.equal(groups[0].entries.length, 2);
});
