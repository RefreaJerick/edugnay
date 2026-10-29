const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-management.html'), 'utf8').replace(/\r\n/g, '\n');
const compactPathSource = html.split('function managementShsCompactPath(trackCodeValue, trackName, strandCodeValue, strandName, needsCurriculumSetup = false) {')[1]
  .split('\n}\n\nfunction managementSectionCardPath')[0];
const cardPathSource = html.split('function managementSectionCardPath(section) {')[1]
  .split('\n}\n\nfunction managementSectionCompactBadgeLabel')[0];
const placementOptionsSource = html.split('function managementShsPlacementOptions() {')[1]
  .split('\n}\n\nfunction managementShsPlacementByKey')[0];
const sectionDisplaySource = html.split('function managementSectionBadgeLabel(section) {')[1]
  .split('\nfunction renderManagementGradeFilters')[0];
const cardHeadStart = html.indexOf('<div class="card-head section-card-head">');
const cardHeadEnd = html.indexOf('<div class="card-stats">', cardHeadStart);
const cardHeadTemplate = html.slice(cardHeadStart, cardHeadEnd).trim();

function createCompactPathRenderer() {
  const context = vm.createContext({});
  vm.runInContext(`function managementShsCompactPath(trackCodeValue, trackName, strandCodeValue, strandName, needsCurriculumSetup = false) {${compactPathSource}\n}`, context);
  return (...args) => context.managementShsCompactPath(...args);
}

function createCardPathRenderer() {
  const context = vm.createContext({ managementShsCompactPath: createCompactPathRenderer() });
  vm.runInContext(`function managementSectionCardPath(section) {${cardPathSource}\n}`, context);
  return section => context.managementSectionCardPath(section);
}

function createSectionDisplayContext() {
  const context = vm.createContext({
    managementLevelLabel: level => ({ elementary: 'Elementary', jhs: 'Junior High School', shs: 'Senior High School' }[level] || level),
    managementSectionPath: section => section.needsCurriculumSetup ? 'Needs Strengthened SHS setup' : (section.trackName || '')
  });
  vm.runInContext(`function managementSectionBadgeLabel(section) {${sectionDisplaySource}`, context);
  return context;
}

function createScrollClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    contains: name => values.has(name),
    toggle(name, force) {
      const shouldAdd = force === undefined ? !values.has(name) : Boolean(force);
      if (shouldAdd) values.add(name);
      else values.delete(name);
      return shouldAdd;
    }
  };
}

class MockScrollElement {
  constructor(tagName = 'div', options = {}) {
    this.tagName = tagName;
    this.id = options.id || '';
    this.dataset = options.dataset || {};
    this.classList = createScrollClassList(options.classes || []);
    this.scrollWidth = options.scrollWidth || 0;
    this.scrollLeft = 0;
    this.baseWidth = options.baseWidth || 280;
    this.gutterWidth = options.gutterWidth || this.baseWidth - 44;
    this.hidden = false;
    this.attributes = {};
    this.listeners = {};
    this.children = [];
    this.className = '';
  }

  get clientWidth() {
    return this.classList.contains('subject-scroll-fade-tab-row')
      && this.wrapper?.classList.contains('has-scroll-control')
      ? this.gutterWidth
      : this.baseWidth;
  }

  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  dispatch(name) { (this.listeners[name] || []).forEach(callback => callback()); }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    if (child.classList.contains('subject-scroll-fade-tab-row')) child.wrapper = this;
  }
  scrollBy({ left }) {
    this.scrollLeft = Math.min(this.scrollWidth - this.clientWidth, this.scrollLeft + left);
    this.dispatch('scroll');
  }
  scrollTo({ left }) {
    this.scrollLeft = left;
    this.dispatch('scroll');
  }
}

function createSubjectScrollHarness(viewportWidth, scrollWidth = 640, id = 'subjectStrandSubTabs', target = 'SHS strand tabs') {
  const row = new MockScrollElement('div', {
    id,
    dataset: { scrollTarget: target },
    classes: ['subject-scroll-fade-tab-row'],
    scrollWidth,
    baseWidth: viewportWidth >= 761 ? 520 : 300,
    gutterWidth: (viewportWidth >= 761 ? 520 : 300) - 44
  });
  const parent = { insertBefore(wrapper) { wrapper.parentNode = this; } };
  row.parentNode = parent;
  const created = [];
  const windowListeners = {};
  const document = {
    querySelectorAll: () => [row],
    createElement(tagName) {
      const element = new MockScrollElement(tagName);
      created.push(element);
      return element;
    }
  };
  let currentViewportWidth = viewportWidth;
  const window = {
    lucide: { createIcons() {} },
    matchMedia: query => ({ matches: query.includes('prefers-reduced-motion') ? false : currentViewportWidth >= 761 }),
    addEventListener(name, callback) { (windowListeners[name] ||= []).push(callback); }
  };
  class MockResizeObserver { observe() {} }
  const context = vm.createContext({ document, window, ResizeObserver: MockResizeObserver });
  const shell = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8').replace(/\r\n/g, '\n');
  const source = shell.split('function initScrollFades() {')[1].split('\n}\n\n/* Use a custom sidebar thumb')[0];
  vm.runInContext(`const scrollFadeRefreshers = new WeakMap(); function initScrollFades() {${source}\n}`, context);
  return {
    context,
    created,
    row,
    windowListeners,
    resize(width) {
      currentViewportWidth = width;
      row.baseWidth = width >= 761 ? 520 : 300;
      row.gutterWidth = row.baseWidth - 44;
      (windowListeners.resize || []).forEach(callback => callback());
    }
  };
}

function renderCardHead(section) {
  return vm.runInNewContext(`\`${cardHeadTemplate}\``, {
    section,
    window: { EDUGNAY_CONFIG: { escapeHtml: value => String(value) } },
    managementSectionTone: () => 'shs',
    managementSectionPlacement: section => [section.grade, section.trackName, section.strandName,
      section.needsStrandReview ? 'Needs strand review' : ''].filter(Boolean).join(' · '),
    managementSectionCardPath: createCardPathRenderer()
  });
}

test('section cards use the two Strengthened SHS track labels', () => {
  const cardPath = createCardPathRenderer();
  assert.equal(cardPath({ trackCode: 'academic', trackName: 'Academic' }), 'Academic');
  assert.equal(cardPath({ trackCode: 'techpro', trackName: 'Technical Professional (TechPro)' }), 'TechPro');
});

test('old SHS records show a setup-required state instead of old choices', () => {
  const cardPath = createCardPathRenderer();
  assert.equal(cardPath({ trackCode: 'tvl', trackName: 'Technical-Vocational-Livelihood', needsCurriculumSetup: true }), 'Needs Strengthened SHS setup');
});

test('section display helpers show the new track or the setup warning', () => {
  const context = createSectionDisplayContext();
  const section = {
    level: 'shs', grade: 'Grade 11', trackCode: 'techpro', trackName: 'Technical Professional (TechPro)'
  };
  assert.equal(context.managementSectionCompactBadgeLabel(section), 'Grade 11 · TechPro');
  assert.equal(context.managementSectionPlacement(section), 'Senior High School · Grade 11 · Technical Professional (TechPro)');
  const pending = { ...section, needsCurriculumSetup: true };
  assert.equal(context.managementSectionCompactPlacement(pending), 'Senior High School · Grade 11 · Needs Strengthened SHS setup');
});

test('Subjects filters show only Academic and TechPro', () => {
  const compactPath = createCompactPathRenderer();
  const context = vm.createContext({
    managementTrackOptions: () => [
      { id: 1, trackCode: 'academic', displayName: 'Academic' },
      { id: 3, trackCode: 'techpro', displayName: 'Technical Professional (TechPro)' }
    ],
    managementShsCompactPath: compactPath
  });
  vm.runInContext(`function managementShsPlacementOptions() {${placementOptionsSource}\n}`, context);
  const options = context.managementShsPlacementOptions();
  assert.deepEqual(JSON.parse(JSON.stringify(options.map(({ label, compactLabel }) => ({ label, compactLabel })))), [
    { label: 'Academic', compactLabel: 'Academic' },
    { label: 'Technical Professional (TechPro)', compactLabel: 'TechPro' }
  ]);
  assert.match(html, /title="\$\{window\.EDUGNAY_CONFIG\.escapeHtml\(strand\.label\)\}"[^>]*>\$\{window\.EDUGNAY_CONFIG\.escapeHtml\(strand\.compactLabel\)\}/);
  assert.match(html, /title\.setAttribute\('title', fullTitle\)/);
});

test('Grades 11 and 12 show separately from compact pathways and retain full placement on hover', () => {
  const sectionCardMarkup = html.split('container.innerHTML = groups.map(group => `')[1]
    .split("updateManagementEmptySlot(container, 'sections'")[0];
  const css = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/management.css'), 'utf8');
  assert.match(sectionCardMarkup, /class="section-card-title-row"[\s\S]*?class="section-name">\$\{section\.name\}[\s\S]*?class="section-grade-badge[^>]*>\$\{window\.EDUGNAY_CONFIG\.escapeHtml\(section\.grade\)\}/);
  assert.match(sectionCardMarkup, /section-card-path[\s\S]*?managementSectionPlacement\(section\)/);
  for (const section of [
    { grade: 'Grade 11', trackCode: 'academic', trackName: 'Academic' },
    { grade: 'Grade 11', trackCode: 'techpro', trackName: 'Technical Professional (TechPro)' },
    { grade: 'Grade 12', trackCode: 'academic', trackName: 'Academic' },
    { grade: 'Grade 12', trackCode: 'techpro', trackName: 'Technical Professional (TechPro)' }
  ]) {
    const markup = renderCardHead({ level: 'shs', ...section });
    assert.match(markup, new RegExp(`>${section.grade}<\\/span>`));
    assert.match(markup, /title="[^"]+"/);
  }
  assert.match(css, /\.section-card-title-row\s*\{[^}]*display:\s*flex;/);
  assert.match(css, /\.section-card \.section-name\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(css, /\.section-card-path\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.section-card \.card-head\s*\{\s*padding-inline:\s*15px;/);
});

test('compact labels stay in read-only Class Management displays and full names remain available', () => {
  assert.ok(html.includes('title="${window.EDUGNAY_CONFIG.escapeHtml(managementSectionPlacement(section))}">${window.EDUGNAY_CONFIG.escapeHtml(managementSectionCompactPlacement(section))}'));
  assert.ok(html.includes('title="${window.EDUGNAY_CONFIG.escapeHtml(managementSectionBadgeLabel(section))}">${window.EDUGNAY_CONFIG.escapeHtml(managementSectionCompactBadgeLabel(section))}'));
  assert.ok(html.includes('title="${window.EDUGNAY_CONFIG.escapeHtml(managementSectionContext(section))}">${window.EDUGNAY_CONFIG.escapeHtml(managementSectionCompactContext(section))}'));
  assert.ok(html.includes("document.getElementById('editStrand').textContent = section.trackName"));
  assert.ok(html.includes('function managementSectionLabel(section) {'));
  assert.ok(html.includes('return `${section.grade}${path ? ` · ${path}` : \'\'} · ${section.name} (${section.students}/${section.capacity})`;'));
});

test('Subjects tab rows use the shared fade and rerendering refreshes overflow state', () => {
  const shell = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8').replace(/\r\n/g, '\n');
  const sharedCss = fs.readFileSync(path.join(__dirname, '../../assets/css/styles.css'), 'utf8').replace(/\r\n/g, '\n');
  const adminCss = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/management.css'), 'utf8').replace(/\r\n/g, '\n');
  const scrollFade = shell.split('function initScrollFades() {')[1].split('\n}\n\n/* Use a custom sidebar thumb')[0];
  assert.match(scrollFade, /'\.subject-scroll-fade-tab-row'/);
  assert.match(scrollFade, /scrollFadeRefreshers\.get\(element\)\?\.\(\)/);
  assert.match(scrollFade, /scrollFadeRefreshers\.set\(element, updateFade\)/);
  assert.match(scrollFade, /element\.scrollWidth - element\.clientWidth - element\.scrollLeft > 4/);
  assert.match(scrollFade, /const isSubjectTabs = element\.classList\.contains\('subject-scroll-fade-tab-row'\)/);
  assert.match(scrollFade, /const canShowButton = isSubjectTabs \|\| isDesktop/);
  assert.match(scrollFade, /scrollButtonSpace = isActivityFilters \? 40 : isSubjectTabs \? 44 : 0/);
  assert.match(scrollFade, /buttonSpace = showButton && isActivityFilters \? scrollButtonSpace : 0/);
  assert.match(scrollFade, /scrollButton\.type = 'button'/);
  assert.match(html, /id="subjectDivisionTabs" data-scroll-target="school level tabs"/);
  assert.match(html, /id="subjectStrandSubTabs" data-scroll-target="SHS track tabs"/);
  assert.match(html, /id="subjectGradeSubTabs" data-scroll-target="grade level tabs"/);
  assert.match(html, /tabs\.innerHTML = \[[\s\S]*?\]\.join\(''\);\s*window\.initScrollFades\?\.\(\);/);
  assert.match(html, /class="division-filter-tabs subject-scroll-fade-tab-row"/);
  assert.match(html, /class="grade-filter-tabs subject-scroll-fade-tab-row is-empty"/);
  assert.match(adminCss, /\.division-filter-tabs\s*\{[^}]*overflow-x:\s*auto;/);
  assert.match(adminCss, /\.grade-filter-tabs\s*\{[^}]*overflow-x:\s*auto;/);
  assert.match(sharedCss, /\.scroll-fade-wrap::after\s*\{[^}]*pointer-events:\s*none;/);
  assert.match(sharedCss, /\.scroll-fade-wrap\.has-more-right::after\s*\{[^}]*opacity:\s*1;/);
  assert.match(sharedCss, /\.scroll-fade-button:focus-visible\s*\{/);
  assert.match(adminCss, /#subjectGradeTabs > \.scroll-fade-wrap\.has-scroll-control\s*\{[^}]*padding-right:\s*44px;/);
  assert.match(adminCss, /@media \(max-width: 760px\)[\s\S]*?#subjectGradeTabs \.scroll-fade-wrap > \.scroll-fade-button:not\(\[hidden\]\)\s*\{\s*display:\s*flex;/);
});

test('each Subjects row has a mouse and keyboard accessible arrow at desktop and mobile widths', () => {
  const rows = [
    ['subjectDivisionTabs', 'school level tabs'],
    ['subjectStrandSubTabs', 'SHS strand tabs'],
    ['subjectGradeSubTabs', 'grade level tabs']
  ];

  for (const [id, target] of rows) {
    for (const viewportWidth of [1200, 500]) {
      const harness = createSubjectScrollHarness(viewportWidth, 640, id, target);
      harness.context.initScrollFades();
      const button = harness.created.find(element => element.className === 'scroll-fade-button');

      assert.ok(button);
      assert.equal(button.type, 'button');
      assert.equal(button.hidden, false);
      assert.equal(button.attributes['aria-controls'], harness.row.id);
      assert.equal(button.attributes['aria-label'], `Scroll ${target} right`);
      assert.equal(harness.row.wrapper.classList.contains('has-scroll-control'), true);

      button.dispatch('click');
      assert.ok(harness.row.scrollLeft > 0);
      for (let step = 0; button.dataset.direction !== 'left' && step < 10; step += 1) button.dispatch('click');
      assert.equal(button.dataset.direction, 'left');
      assert.equal(button.attributes['aria-label'], `Return to first ${target}`);
      button.dispatch('click');
      assert.equal(harness.row.scrollLeft, 0);
      assert.equal(button.dataset.direction, 'right');

      harness.row.scrollWidth = harness.row.baseWidth;
      harness.context.initScrollFades();
      assert.equal(button.hidden, true);
      assert.equal(harness.row.wrapper.classList.contains('has-scroll-control'), false);
      assert.equal(harness.row.wrapper.classList.contains('has-more-right'), false);
    }
  }

  const harness = createSubjectScrollHarness(1200, 450, 'subjectDivisionTabs', 'school level tabs');
  harness.context.initScrollFades();
  const button = harness.created.find(element => element.className === 'scroll-fade-button');
  assert.equal(button.hidden, true);
  harness.resize(500);
  assert.equal(button.hidden, false);
  harness.resize(1200);
  assert.equal(button.hidden, true);
});
