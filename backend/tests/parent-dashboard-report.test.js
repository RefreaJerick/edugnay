const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../views/parent/edugnay-parent-dashboard.html'), 'utf8');
const functionStart = html.indexOf('    let reportRequestVersion = 0;');
const functionEnd = html.indexOf('\n    function switchChild(', functionStart);
assert.notEqual(functionStart, -1, 'parent dashboard report handler exists');
assert.notEqual(functionEnd, -1, 'parent dashboard report handler has a clear end');
const reportHandler = html.slice(functionStart, functionEnd);

function createPage(request) {
  const classNames = new Set();
  const attributes = {};
  const description = { textContent: '' };
  const reportError = { hidden: true, textContent: '' };
  const reportContent = {
    hidden: true,
    querySelector(selector) {
      return selector === '.report-hero-description' ? description : null;
    }
  };
  const reportTitle = { textContent: '' };
  const reportLink = {
    hidden: true,
    href: '',
    dataset: { reportAvailable: 'false' },
    removeAttribute(name) { if (name === 'href') this.href = ''; }
  };
  const hero = {
    hidden: true,
    dataset: { currentReportAvailable: 'false', reportsEnabled: 'true' },
    classList: {
      add(name) { classNames.add(name); },
      remove(name) { classNames.delete(name); },
      toggle(name, force) {
        if (force) classNames.add(name);
        else classNames.delete(name);
      },
      contains(name) { return classNames.has(name); }
    },
    setAttribute(name, value) { attributes[name] = value; }
  };
  const elements = new Map([
    ['report-hero-content', reportContent],
    ['report-status-title', reportTitle],
    ['report-hero-description', description],
    ['report-hero-link', reportLink],
    ['report-hero-error', reportError]
  ]);
  const document = {
    querySelector(selector) { return selector === '.report-hero' ? hero : null; },
    getElementById(id) { return elements.get(id) || null; }
  };
  let selectedChild = null;
  const context = vm.createContext({
    document,
    URLSearchParams,
    window: {
      EDUGNAY_API: { isBackendAvailable: true, request },
      EDUGNAY_CONFIG: {},
      lucide: { createIcons() {} },
      refreshEdUgnayShellContext() {}
    }
  });
  new vm.Script(`
    let PARENT_CHILDREN_ERROR = '';
    const getCurrentChild = () => selectedChild;
    let selectedChild = null;
    ${reportHandler}
    this.updateReport = updateChildContext;
    this.setChild = child => { selectedChild = child; };
    this.setChildError = error => { PARENT_CHILDREN_ERROR = error; };
  `).runInContext(context);
  return { context, elements, hero, attributes, classNames };
}

const report = (id, start = '2026-10-26', end = '2026-10-31') => ({
  id,
  weekStartDate: start,
  weekEndDate: end
});
const currentReportWeek = { startDate: '2026-10-26', endDate: '2026-10-31' };

test('dashboard shows only a report covering the current configured week', async () => {
  const previousReport = report('previous-week', '2026-10-19', '2026-10-24');
  const responses = new Map([
    ['empty-child', { reports: [], currentReportWeek }],
    ['report-child', { reports: [previousReport, report('weekly-1')], currentReportWeek }],
    ['second-report-child', { reports: [report('weekly-2', previousReport.weekStartDate, previousReport.weekEndDate)], currentReportWeek }]
  ]);
  const page = createPage(async url => responses.get(decodeURIComponent(url.split('/').at(-1))));
  page.context.setChild({ id: 'empty-child', displayName: 'Jerick Refrea' });
  const emptyRequest = page.context.updateReport();
  assert.equal(page.hero.hidden, true, 'the card stays hidden while report availability is checked');
  assert.equal(page.elements.get('report-hero-error').hidden, true);
  await emptyRequest;
  assert.equal(page.hero.hidden, true);
  assert.equal(page.elements.get('report-hero-content').hidden, true);
  assert.equal(page.elements.get('report-hero-link').hidden, true);

  page.context.setChild({ id: 'report-child', displayName: 'Andrea Reyes' });
  await page.context.updateReport();
  assert.match(page.elements.get('report-status-title').textContent, /^Week of /);
  assert.match(page.elements.get('report-hero-description').textContent, /Andrea Reyes/);
  assert.equal(page.elements.get('report-hero-content').hidden, false);
  assert.equal(page.hero.hidden, false);
  assert.match(page.elements.get('report-hero-link').href, /studentId=report-child/);
  assert.match(page.elements.get('report-hero-link').href, /reportId=weekly-1/);
  assert.equal(page.elements.get('report-hero-link').hidden, false);

  page.context.setChild({ id: 'second-report-child', displayName: 'Miguel Santos' });
  await page.context.updateReport();
  assert.equal(page.hero.hidden, true, 'a report from the previous week is not featured');
  assert.equal(page.elements.get('report-hero-link').hidden, true);
  assert.equal(page.elements.get('report-hero-link').href, '');

  page.context.setChild({ id: 'empty-child', displayName: 'Jerick Refrea' });
  await page.context.updateReport();
  assert.equal(page.hero.hidden, true);
  assert.equal(page.elements.get('report-hero-content').hidden, true);
  assert.equal(page.elements.get('report-hero-link').hidden, true);
  assert.equal(page.elements.get('report-hero-link').href, '');
});

test('a slower previous-child response cannot replace the selected child report', async () => {
  let resolvePrevious;
  const page = createPage(url => {
    const childId = decodeURIComponent(url.split('/').at(-1));
    if (childId === 'previous') return new Promise(resolve => { resolvePrevious = resolve; });
    return Promise.resolve({ reports: [report('current-report')], currentReportWeek });
  });

  page.context.setChild({ id: 'previous', displayName: 'Previous Child' });
  const previousRequest = page.context.updateReport();
  assert.equal(page.hero.hidden, true);
  assert.equal(page.attributes['aria-busy'], 'true');
  assert.equal(page.elements.get('report-hero-content').hidden, true);

  page.context.setChild({ id: 'current', displayName: 'Current Child' });
  await page.context.updateReport();
  resolvePrevious({ reports: [report('stale-report', '2026-10-19', '2026-10-24')], currentReportWeek });
  await previousRequest;

  assert.match(page.elements.get('report-hero-description').textContent, /Current Child/);
  assert.doesNotMatch(page.elements.get('report-hero-description').textContent, /Previous Child/);
  assert.match(page.elements.get('report-hero-link').href, /studentId=current/);
  assert.match(page.elements.get('report-hero-link').href, /reportId=current-report/);
  assert.equal(page.attributes['aria-busy'], 'false');
});

test('report failures stay outside the hidden card and no-child state clears the error', async () => {
  const page = createPage(async () => { throw new Error('Connection lost'); });
  page.context.setChild({ id: 'child', displayName: 'Maya Santos' });
  await page.context.updateReport();
  assert.equal(page.hero.hidden, true);
  assert.equal(page.elements.get('report-hero-error').hidden, false);
  assert.match(page.elements.get('report-hero-error').textContent, /Weekly report could not be loaded/);
  assert.equal(page.elements.get('report-hero-content').hidden, true);
  assert.equal(page.elements.get('report-hero-link').hidden, true);

  page.context.setChild(null);
  await page.context.updateReport();
  assert.equal(page.hero.hidden, true);
  assert.equal(page.elements.get('report-hero-error').hidden, true);
  assert.equal(page.elements.get('report-hero-error').textContent, '');
  assert.equal(page.elements.get('report-status-title').textContent, '');
  assert.equal(page.elements.get('report-hero-content').hidden, true);
});

test('an unavailable reports backend is shown as an error rather than an empty report', async () => {
  const page = createPage(async () => ({ reports: [] }));
  page.context.window.EDUGNAY_API.isBackendAvailable = false;
  page.context.setChild({ id: 'child', displayName: 'Maya Santos' });
  await page.context.updateReport();
  assert.equal(page.hero.hidden, true);
  assert.equal(page.elements.get('report-hero-error').hidden, false);
  assert.equal(page.elements.get('report-hero-link').hidden, true);
  assert.equal(page.attributes['aria-busy'], 'false');
});

test('a linked-children request failure is not reported as a missing weekly report', async () => {
  const page = createPage(async () => ({ reports: [] }));
  page.context.setChildError('Linked children could not be loaded.');
  await page.context.updateReport();
  assert.equal(page.hero.hidden, true);
  assert.equal(page.elements.get('report-hero-error').hidden, true);
});

test('the dashboard report card starts hidden with an external accessible error status', () => {
  assert.match(html, /class="report-hero"[^>]*data-current-report-available="false" hidden/);
  assert.match(html, /id="report-hero-content" hidden/);
  assert.match(html, /id="report-hero-error" role="status" aria-live="polite" hidden/);
  assert.doesNotMatch(html, /id="report-hero-state"/);
  assert.doesNotMatch(reportHandler, /hero\.innerHTML\s*=/);
  assert.doesNotMatch(reportHandler, /renderPanelSkeleton/);
});

test('parent access refresh does not reveal a dashboard card with no current-week report', () => {
  const shell = fs.readFileSync(path.join(__dirname, '../../assets/js/parent/shell.js'), 'utf8');
  const start = shell.indexOf('function applyParentReportAccess(enabled) {');
  const end = shell.indexOf('\nfunction applyParentSidebarAccess', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const elements = {
    hero: { hidden: false, dataset: { currentReportAvailable: 'false' } },
    link: { hidden: false, dataset: { reportAvailable: 'false' } },
    error: { hidden: false, textContent: 'Weekly report could not be loaded.' }
  };
  const document = {
    querySelector(selector) { return selector === '.report-hero' ? elements.hero : elements.link; },
    getElementById(id) { return id === 'report-hero-error' ? elements.error : null; }
  };
  const context = vm.createContext({ document });
  new vm.Script(`${shell.slice(start, end)}\nthis.applyParentReportAccess = applyParentReportAccess;`).runInContext(context);
  context.applyParentReportAccess(true);
  assert.equal(elements.hero.hidden, true);
  assert.equal(elements.link.hidden, true);
  elements.hero.dataset.currentReportAvailable = 'pending';
  context.applyParentReportAccess(true);
  assert.equal(elements.hero.hidden, true, 'pending availability cannot reveal the card');
  elements.hero.dataset.currentReportAvailable = 'true';
  elements.link.dataset.reportAvailable = 'true';
  context.applyParentReportAccess(true);
  assert.equal(elements.hero.hidden, false);
  assert.equal(elements.link.hidden, false);
  context.applyParentReportAccess(false);
  assert.equal(elements.hero.hidden, true);
  assert.equal(elements.link.hidden, true);
  assert.equal(elements.error.hidden, true);
  assert.equal(elements.error.textContent, '');
});
