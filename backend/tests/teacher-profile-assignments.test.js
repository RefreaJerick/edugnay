const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const profileScript = fs.readFileSync(path.join(root, 'assets/js/teacher/profile.js'), 'utf8');
const profileHtml = fs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-profile.html'), 'utf8');
const profileStyles = fs.readFileSync(path.join(root, 'assets/css/teacher/profile.css'), 'utf8');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function createProfile({ sections, shsClasses } = {}) {
  const elements = new Map();
  const documentListeners = new Map();
  const emptyStates = [];
  let pageReadyCalls = 0;
  const getElement = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        hidden: false, value: '', textContent: '', innerHTML: '', attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; }
      });
    }
    return elements.get(id);
  };
  const apiResult = async result => {
    if (result instanceof Error) throw result;
    return result ?? [];
  };
  const document = {
    getElementById: getElement,
    querySelectorAll: () => [],
    addEventListener(name, handler) { documentListeners.set(name, handler); }
  };
  const context = vm.createContext({
    document,
    window: {
      EDUGNAY_SCHOOL_READY: Promise.resolve(),
      EDUGNAY_API: {
        request: async () => ({ user: { role: 'teacher', displayName: 'Maria Ramirez', profile: {} } }),
        getShsTeachingClasses: () => apiResult(shsClasses)
      },
      EDUGNAY_CONFIG: {
        getMyTeachingSections: () => apiResult(sections),
        escapeHtml,
        renderPanelEmptyState: options => {
          emptyStates.push(options);
          return `<div class="panel-empty-state" role="status"><strong>${escapeHtml(options.title)}</strong><span>${escapeHtml(options.text)}</span></div>`;
        }
      },
      EDUGNAY_PAGE_LOADING: { ready() { pageReadyCalls += 1; } },
      EDUGNAY_PAGE_EVENTS: { bind() {} }
    },
    lucide: { createIcons() {} },
    console
  });
  vm.runInContext(profileScript, context);

  return {
    elements,
    emptyStates,
    initialize: () => documentListeners.get('DOMContentLoaded')(),
    get pageReadyCalls() { return pageReadyCalls; }
  };
}

test('teacher profile displays assigned sections and SHS classes in separate lists', async () => {
  const profile = createProfile({
    sections: [{ grade: 'Grade 7', name: 'St. John' }],
    shsClasses: { classes: [{ gradeName: 'Grade 11', className: 'Calculus Class A' }] }
  });

  await profile.initialize();

  const sections = profile.elements.get('teacher-sections-assignments').innerHTML;
  const shsClasses = profile.elements.get('teacher-shs-classes-assignments').innerHTML;
  assert.match(sections, /Grade 7 - St\. John/);
  assert.match(sections, /aria-label="Sections handled"/);
  assert.doesNotMatch(sections, /Calculus Class A/);
  assert.match(shsClasses, /Grade 11 - Calculus Class A/);
  assert.match(shsClasses, /aria-label="SHS classes assigned"/);
  assert.doesNotMatch(shsClasses, /St\. John/);
  assert.equal(profile.pageReadyCalls, 1);
});

test('teacher profile renders each list as its own request completes', async () => {
  let resolveShsClasses;
  const shsClassesRequest = new Promise(resolve => { resolveShsClasses = resolve; });
  const profile = createProfile({
    sections: [{ grade: 'Grade 7', name: 'St. John' }],
    shsClasses: shsClassesRequest
  });

  const initialization = profile.initialize();
  await new Promise(resolve => setImmediate(resolve));

  assert.match(profile.elements.get('teacher-sections-assignments').innerHTML, /Grade 7 - St\. John/);
  assert.equal(profile.elements.get('teacher-shs-classes-assignments').innerHTML, '');

  resolveShsClasses({ classes: [{ gradeName: 'Grade 11', className: 'Calculus Class A' }] });
  await initialization;

  assert.match(profile.elements.get('teacher-shs-classes-assignments').innerHTML, /Grade 11 - Calculus Class A/);
  assert.match(profile.elements.get('teacher-sections-assignments').innerHTML, /Grade 7 - St\. John/);
});

test('teacher profile escapes SHS class names before rendering', async () => {
  const profile = createProfile({
    sections: [],
    shsClasses: { classes: [{ gradeName: 'Grade 12', className: '<img src=x onerror=alert(1)>' }] }
  });

  await profile.initialize();

  const shsClasses = profile.elements.get('teacher-shs-classes-assignments').innerHTML;
  assert.match(shsClasses, /Grade 12 - &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(shsClasses, /<img/);
});

test('empty or expected unavailable SHS results leave assigned sections visible', async t => {
  const cases = [
    ['empty list', { classes: [] }],
    ['forbidden response', Object.assign(new Error('Forbidden'), { status: 403 })],
    ['not found response', Object.assign(new Error('Not found'), { status: 404 })]
  ];
  for (const [name, shsClasses] of cases) {
    await t.test(name, async () => {
      const profile = createProfile({
        sections: [{ grade: 'Grade 7', name: 'St. John' }],
        shsClasses
      });

      await profile.initialize();

      assert.match(profile.elements.get('teacher-sections-assignments').innerHTML, /Grade 7 - St\. John/);
      assert.match(profile.elements.get('teacher-shs-classes-assignments').innerHTML, /No SHS classes assigned/);
      assert.doesNotMatch(profile.elements.get('teacher-sections-assignments').innerHTML, /unavailable/i);
    });
  }
});

test('SHS request errors stay in the SHS subsection without hiding sections', async () => {
  const profile = createProfile({
    sections: [{ grade: 'Grade 7', name: 'St. John' }],
    shsClasses: Object.assign(new Error('SHS service offline'), { status: 503 })
  });

  await profile.initialize();

  assert.match(profile.elements.get('teacher-sections-assignments').innerHTML, /Grade 7 - St\. John/);
  assert.match(profile.elements.get('teacher-shs-classes-assignments').innerHTML, /SHS classes unavailable/);
  assert.match(profile.elements.get('teacher-shs-classes-assignments').innerHTML, /SHS service offline/);
});

test('section request errors stay in the sections subsection without hiding SHS classes', async () => {
  const profile = createProfile({
    sections: new Error('Sections service offline'),
    shsClasses: { classes: [{ gradeName: 'Grade 11', className: 'Calculus Class A' }] }
  });

  await profile.initialize();

  assert.match(profile.elements.get('teacher-sections-assignments').innerHTML, /Sections unavailable/);
  assert.match(profile.elements.get('teacher-sections-assignments').innerHTML, /Sections service offline/);
  assert.match(profile.elements.get('teacher-shs-classes-assignments').innerHTML, /Grade 11 - Calculus Class A/);
});

test('teacher profile retains the shared card and responsive layout for both assignment groups', () => {
  assert.match(profileHtml, /class="panel" id="pane-sections"/);
  assert.match(profileHtml, /class="panel-title">Sections Handled<\/div>/);
  assert.match(profileHtml, /id="teacher-sections-assignments"/);
  assert.match(profileHtml, /id="teacher-shs-classes-assignments"/);
  assert.match(profileStyles, /\.main #pane-sections \.config-panel-body\s*\{[^}]*display:\s*grid;/);
  assert.match(profileStyles, /@media \(max-width: 900px\)[\s\S]*?\.two-col\s*\{\s*grid-template-columns:\s*1fr;/);
});
