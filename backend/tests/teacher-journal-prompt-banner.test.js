const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const script = fs.readFileSync(path.join(root, 'assets/js/teacher/journals.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-journals.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/css/teacher/journals.css'), 'utf8');

function sourceBetween(start, end) {
  const from = script.indexOf(start);
  const to = script.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Expected ${start} before ${end}`);
  return script.slice(from, to);
}

function bannerHarness() {
  const elements = Object.fromEntries([
    'journal-prompt-banner', 'journal-prompt-context', 'journal-prompt-status',
    'journal-prompt-text', 'journal-prompt-opens', 'journal-prompt-due',
    'journal-prompt-words', 'journal-prompt-late', 'journal-prompt-component'
  ].map(id => [id, { hidden: true, textContent: '' }]));
  const context = vm.createContext({ document: { getElementById: id => elements[id] } });
  vm.runInContext(
    sourceBetween('function formatJournalDate(', 'function dueDateForWeek(') +
    sourceBetween('function renderJournalPromptBanner(', '/* ══════ RENDER TABLE'),
    context
  );
  return { elements, render: section => context.renderJournalPromptBanner(section) };
}

test('journal prompt banner follows the selected section and week, including status and details', () => {
  const { elements, render } = bannerHarness();
  const firstPrompt = {
    weekStartDate: '2026-11-09', promptText: 'Describe <one> challenge.',
    opensAt: '2026-11-09T08:00:00+08:00', dueAt: '2026-11-13T23:59:00+08:00',
    minWords: 50, allowLate: true, componentTitle: 'Weekly Reflection', submissionState: 'open'
  };
  render({ label: 'Grade 7 – St. John', prompt: firstPrompt });
  assert.equal(elements['journal-prompt-banner'].hidden, false);
  assert.match(elements['journal-prompt-context'].textContent, /Grade 7 – St. John · Week of Nov 9, 2026/);
  assert.equal(elements['journal-prompt-text'].textContent, 'Describe <one> challenge.');
  assert.equal(elements['journal-prompt-status'].textContent, 'Open for submissions');
  assert.equal(elements['journal-prompt-words'].textContent, '50 words');
  assert.equal(elements['journal-prompt-late'].textContent, 'Allowed');
  assert.equal(elements['journal-prompt-component'].textContent, 'Weekly Reflection');
  assert.match(elements['journal-prompt-opens'].textContent, /2026/);
  assert.match(elements['journal-prompt-due'].textContent, /2026/);

  render({ label: 'Grade 8 – St. Luke', prompt: {
    ...firstPrompt, weekStartDate: '2026-11-02', promptText: 'Older prompt',
    minWords: 80, allowLate: false, submissionState: 'closed'
  } });
  assert.match(elements['journal-prompt-context'].textContent, /Grade 8 – St. Luke · Week of Nov 2, 2026/);
  assert.equal(elements['journal-prompt-text'].textContent, 'Older prompt');
  assert.equal(elements['journal-prompt-status'].textContent, 'Closed');
  assert.equal(elements['journal-prompt-words'].textContent, '80 words');
  assert.equal(elements['journal-prompt-late'].textContent, 'Not allowed');
});

test('journal prompt banner handles scheduled, late, expired, and missing prompts', () => {
  const { elements, render } = bannerHarness();
  for (const [state, label] of [
    ['not_open', 'Opens soon'], ['late', 'Accepting late entries'],
    ['deadline_passed', 'Deadline passed']
  ]) {
    render({ label: 'Section', prompt: { submissionState: state, weekStartDate: '2026-11-09', minWords: 50 } });
    assert.equal(elements['journal-prompt-status'].textContent, label);
  }
  render({ label: 'Section', prompt: null });
  assert.equal(elements['journal-prompt-banner'].hidden, true);
  render(null);
  assert.equal(elements['journal-prompt-banner'].hidden, true);
});

test('banner sits between section tabs and journal entries and uses navy responsive styling', () => {
  assert.ok(page.indexOf('id="journal-section-tabs"') < page.indexOf('id="journal-prompt-banner"'));
  assert.ok(page.indexOf('id="journal-prompt-banner"') < page.indexOf('<!-- Journal entries panel -->'));
  assert.doesNotMatch(page.slice(page.indexOf('id="journal-prompt-banner"'), page.indexOf('<!-- Journal entries panel -->')), /journal-prompt-icon|data-lucide/);
  assert.doesNotMatch(css, /\.journal-prompt-icon/);
  assert.match(css, /\.journal-prompt-banner\s*\{[^}]*background:\s*var\(--navy\)/s);
  assert.match(css, /\.journal-prompt-banner\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fit, minmax\(150px, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 520px\)\s*\{[\s\S]*?\.journal-prompt-head\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /\.journal-prompt-details\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.journal-prompt-details > div:last-child\s*\{[^}]*grid-column:\s*1 \/ -1/);
});
