const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const script = fs.readFileSync(path.join(root, 'assets/js/teacher/journals.js'), 'utf8').replace(/\r\n/g, '\n');
const styles = fs.readFileSync(path.join(root, 'assets/css/teacher/journals.css'), 'utf8').replace(/\r\n/g, '\n');
const loadStart = script.indexOf('async function loadJournalAssessment(entryId) {');
const loadEnd = script.indexOf('\n}\n\nasync function assessActiveJournal()', loadStart) + 2;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function assessmentHarness(getJournalAssessment) {
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'expected loadJournalAssessment function in teacher journal script');
  const panelClasses = new Set(['is-empty']);
  const panel = {
    classList: {
      add: name => panelClasses.add(name),
      remove: name => panelClasses.delete(name)
    }
  };
  const button = {
    disabled: false,
    title: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; }
  };
  const useButton = { hidden: false };
  const result = {
    textContent: '',
    children: [],
    replaceChildren(...children) {
      this.children = children;
      this.textContent = children.map(child => child.textContent || '').join('');
    }
  };
  const elements = {
    'journal-ai-assess': button,
    'journal-ai-panel': panel,
    'journal-ai-use': useButton,
    'journal-ai-result': result
  };
  const rendered = [];
  const modes = [];
  const context = vm.createContext({
    assessmentRequestId: 0,
    activeAssessment: null,
    document: {
      getElementById: id => elements[id],
      createElement: () => ({
        className: '', textContent: '', attributes: {}, children: [],
        setAttribute(name, value) { this.attributes[name] = value; },
        append(...children) {
          this.children.push(...children);
          this.textContent = this.children.map(child => child.textContent || '').join('');
        }
      })
    },
    window: { EDUGNAY_API: { getJournalAssessment } },
    setAssessmentActionMode: mode => modes.push(mode),
    renderAssessment: assessment => rendered.push(assessment)
  });
  const load = vm.runInContext(`${script.slice(loadStart, loadEnd)}; loadJournalAssessment`, context);
  return { button, elements, load, modes, panelClasses, rendered };
}

test('teacher journal assessment load shows an inline spinner and hides actions until an empty result arrives', async () => {
  const request = deferred();
  const harness = assessmentHarness(() => request.promise);

  const pending = harness.load('entry-1');
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.panelClasses.has('is-loading'), true);
  assert.equal(harness.elements['journal-ai-result'].children[0].className, 'journal-ai-assessing journal-ai-loading-state');
  assert.equal(harness.elements['journal-ai-result'].children[0].attributes.role, 'status');
  assert.equal(harness.elements['journal-ai-result'].children[0].children[0].className, 'journal-ai-loading-spinner');
  assert.equal(harness.elements['journal-ai-result'].children[0].children[0].attributes['aria-hidden'], 'true');
  assert.equal(harness.elements['journal-ai-result'].children[0].children[1].textContent, 'Loading assessment…');
  assert.equal(harness.elements['journal-ai-result'].textContent, 'Loading assessment…');
  assert.deepEqual(harness.modes, [false]);

  request.resolve({ assessment: null });
  await pending;
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.panelClasses.has('is-loading'), false);
  assert.deepEqual(harness.rendered, [null]);
});

test('teacher journal assessment load re-enables Assess and exposes the fetch error', async () => {
  const harness = assessmentHarness(async () => { throw new Error('Assessment unavailable.'); });

  await harness.load('entry-1');
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.panelClasses.has('is-loading'), false);
  assert.equal(harness.elements['journal-ai-result'].textContent, 'Assessment unavailable.');
  assert.equal(harness.panelClasses.has('is-empty'), true);
});

test('stale assessment loads do not overwrite the current student or enable its button early', async () => {
  const requests = [deferred(), deferred()];
  let requestIndex = 0;
  const harness = assessmentHarness(() => requests[requestIndex++].promise);

  const firstLoad = harness.load('entry-1');
  const secondLoad = harness.load('entry-2');
  requests[0].resolve({ assessment: { id: 'old' } });
  await firstLoad;
  assert.equal(harness.panelClasses.has('is-loading'), true);
  assert.deepEqual(harness.rendered, []);

  requests[1].resolve({ assessment: { id: 'current' } });
  await secondLoad;
  assert.equal(harness.panelClasses.has('is-loading'), false);
  assert.deepEqual(harness.rendered, [{ id: 'current' }]);
});

test('teacher journal fetch spinner and loading action row have the requested styling', () => {
  assert.match(styles, /\.journal-ai-assessing\s*\{[^}]*font-size:\s*12px;[^}]*font-weight:\s*600;/);
  assert.match(styles, /\.journal-ai-loading-state\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/);
  assert.match(styles, /\.journal-ai-loading-spinner\s*\{[^}]*border-radius:\s*50%;[^}]*animation:\s*journal-ai-loading-spin/);
  assert.match(styles, /#journalModal \.journal-ai-panel\.is-loading \.journal-ai-actions\s*\{\s*visibility:\s*hidden;\s*pointer-events:\s*none;/);
  assert.match(styles, /#journalModal \.journal-ai-panel:is\(\.is-empty, \.is-loading\) #journal-ai-result\s*\{\s*margin-top:\s*50px;/);
  assert.match(styles, /#journalModal \.journal-ai-panel:is\(\.is-empty, \.is-loading\) \.journal-ai-actions\s*\{\s*margin-top:\s*4px;/);
});
