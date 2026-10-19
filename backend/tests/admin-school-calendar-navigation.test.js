const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const settingsPage = fs.readFileSync(path.join(root, 'views/admin/edugnay-admin-schools.html'), 'utf8');
const dashboardPage = fs.readFileSync(path.join(root, 'views/admin/edugnay-admin-dashboard.html'), 'utf8');
const settingsStyles = fs.readFileSync(path.join(root, 'assets/css/admin/schools.css'), 'utf8');

function checkInlineScript(page, filename) {
  const scripts = [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length, `${filename} has an inline script`);
  new vm.Script(scripts.at(-1)[1], { filename });
}

test('School Calendar is a full-width settings tab with direct links to the notice form', () => {
  assert.match(settingsPage, /data-school-tab="calendar"[\s\S]*?School Calendar/);
  assert.doesNotMatch(settingsPage, /<section class="school-calendar-panel"/);
  assert.match(settingsPage, /state\.tab === 'calendar'\) renderCalendarPane\(\)/);
  assert.match(settingsPage, /hash === '#school-calendar' \|\| hash === '#add-calendar-notice'/);
  assert.match(settingsPage, /state\.calendarFormOpen = hash === '#add-calendar-notice'/);
  assert.match(settingsPage, /date\.focus\(\)/);
  assert.match(settingsPage, /id="toggleCalendarNoticeForm"/);
  assert.match(settingsPage, /id="calendarNoticeList"/);
  assert.match(settingsStyles, /\.school-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(settingsStyles, /@media \(max-width: 760px\)[\s\S]*?\.school-calendar-form-grid\s*\{[^}]*grid-template-columns/s);
  checkInlineScript(settingsPage, 'edugnay-admin-schools.inline.js');
});

test('Profile & Branding aligns school levels and branding with the responsive form grid', () => {
  const profileStart = settingsPage.indexOf('function renderProfilePane()');
  const profileEnd = settingsPage.indexOf('function renderAcademicPane()', profileStart);
  const profileMarkup = settingsPage.slice(profileStart, profileEnd);
  assert.match(profileMarkup, /school-form-grid school-profile-form-grid/);
  assert.match(profileMarkup, /school-field school-profile-levels-field/);
  assert.match(profileMarkup, /school-field school-profile-third-field school-profile-branding-field/);
  assert.match(profileMarkup, /id="profileName"[\s\S]*?id="schoolIdInput"[\s\S]*?school-profile-levels-field/);
  assert.equal((profileMarkup.match(/name="(?:name|schoolId|regionName|divisionName|districtName|address|phone|email|website)"/g) || []).length, 9);
  assert.match(profileMarkup, /school-profile-address-field/);
  assert.equal((profileMarkup.match(/school-profile-third-field/g) || []).length, 3);
  assert.match(profileMarkup, /school-profile-third-field[\s\S]*?name="email"[\s\S]*?school-profile-third-field[\s\S]*?name="website"[\s\S]*?school-profile-third-field school-profile-branding-field/);
  assert.match(profileMarkup, /school-profile-phone-field/);
  assert.match(profileMarkup, /school-logo-preview-hint/);
  assert.match(profileMarkup, /form\.addEventListener\('submit', saveProfile\)/);
  assert.match(profileMarkup, /getElementById\('profileLogo'\)\.addEventListener\('change', readLogo\)/);
  assert.match(settingsStyles, /\.school-profile-pane form\s*\{\s*max-width:\s*none;/);
  assert.match(settingsStyles, /\.school-profile-form-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6,/s);
  assert.match(settingsStyles, /\.school-profile-form-grid > \.school-profile-third-field\s*\{\s*grid-column:\s*span 2;/);
  assert.match(settingsStyles, /\.school-profile-form-grid > \.school-profile-address-field\s*\{\s*grid-column:\s*span 4;/);
  assert.match(settingsStyles, /@media \(max-width: 1060px\)[\s\S]*?\.school-profile-form-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,/);
  assert.match(settingsStyles, /@media \(max-width: 1060px\)[\s\S]*?\.school-profile-form-grid > \.school-profile-address-field\s*\{\s*grid-column:\s*span 2;/);
  assert.match(settingsStyles, /@media \(max-width: 1060px\)[\s\S]*?\.school-profile-form-grid > \.school-profile-third-field\s*\{\s*grid-column:\s*span 2;/);
  assert.match(settingsStyles, /@media \(max-width: 1060px\)[\s\S]*?\.school-profile-form-grid > \.school-profile-phone-field,\s*\.school-profile-form-grid > \.school-profile-branding-field\s*\{\s*grid-column:\s*1 \/ -1;/);
  assert.match(settingsStyles, /@media \(max-width: 560px\)[\s\S]*?\.school-form-grid,\s*\.grade-grid,\s*\.track-options,\s*\.school-attendance-code-grid\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(settingsStyles, /@media \(max-width: 560px\)[\s\S]*?\.school-profile-pane \.school-logo-preview\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(settingsStyles, /@media \(max-width: 560px\)[\s\S]*?\.school-profile-form-grid > \.school-profile-third-field,\s*\.school-profile-form-grid > \.school-profile-phone-field,\s*\.school-profile-form-grid > \.school-profile-branding-field\s*\{\s*grid-column:\s*1 \/ -1;/);
  assert.match(settingsStyles, /\.school-profile-pane \.school-logo-preview > \.school-logo-upload\s*\{[^}]*grid-row:\s*2;[^}]*width:\s*100%;/s);
  assert.match(settingsStyles, /\.school-profile-pane \.school-logo-preview > \.school-logo-preview-hint\s*\{[^}]*grid-row:\s*3;/s);
  assert.doesNotMatch(settingsStyles, /\.school-branding-field \.school-logo-upload\s*\{[^}]*max-width:\s*620px;/s);
});

test('Academic Structure uses the available width and removes the redundant school-type chip', () => {
  const academicStart = settingsPage.indexOf('    function renderAcademicPane()');
  const academicEnd = settingsPage.indexOf('\n    function ', academicStart + 10);
  assert.ok(academicStart >= 0 && academicEnd > academicStart, 'Academic Structure renderer is present');
  const academicRenderer = settingsPage.slice(academicStart, academicEnd);

  assert.match(academicRenderer, /Enabled grade levels/);
  assert.doesNotMatch(academicRenderer, /school-type-chip/);
  assert.match(settingsStyles, /\.school-academic-pane form\s*\{\s*max-width:\s*none;/);
  assert.match(settingsStyles, /\.school-terms-pane form\s*\{\s*max-width:\s*none;/);
  assert.match(settingsStyles, /\.school-grading-pane form\s*\{\s*max-width:\s*980px;/);
  assert.match(settingsStyles, /\.school-portal-pane form\s*\{\s*max-width:\s*none;/);
  assert.match(settingsStyles, /\.school-academic-pane \.grade-grid\s*\{\s*grid-template-columns:\s*repeat\(4,/);
  assert.match(settingsStyles, /\.school-academic-pane \.school-deped-subject-card\s*\{\s*max-width:\s*980px;/);
  assert.match(settingsStyles, /@media \(max-width: 1060px\)[\s\S]*?\.school-academic-pane \.grade-grid\s*\{\s*grid-template-columns:\s*repeat\(2,/);
  assert.match(settingsStyles, /@media \(max-width: 560px\)[\s\S]*?\.school-academic-pane \.grade-grid,[\s\S]*?grid-template-columns:\s*1fr;/);
  checkInlineScript(settingsPage, 'edugnay-admin-schools.inline.js');
});

test('Portal Features keeps Journal subject visible and disabled while Journals is off', () => {
  const portalStart = settingsPage.indexOf('    function renderPortalFeaturesPane()');
  const portalEnd = settingsPage.indexOf('\n    function renderAttendancePane()', portalStart);
  assert.ok(portalStart >= 0 && portalEnd > portalStart, 'Portal Features renderer is present');
  const portalRenderer = settingsPage.slice(portalStart, portalEnd);
  const layoutStart = portalRenderer.indexOf('<div class="school-portal-layout');
  const footerStart = portalRenderer.indexOf('<div class="school-form-footer"', layoutStart);
  assert.ok(layoutStart >= 0 && footerStart > layoutStart, 'portal content layout and footer are present');
  const layoutMarkup = portalRenderer.slice(layoutStart, footerStart);

  assert.match(layoutMarkup, /class="school-portal-layout" id="schoolPortalLayout"/);
  assert.ok(layoutMarkup.indexOf('school-portal-access-block') < layoutMarkup.indexOf('school-portal-journal-column'));
  assert.match(layoutMarkup, /id="journalSettingsColumn"/);
  assert.doesNotMatch(layoutMarkup, /id="journalSettingsColumn"[^>]*hidden/);
  assert.match(layoutMarkup, /school-journal-settings-block \$\{journalsEnabled \? '' : 'is-disabled'\}[^>]*aria-disabled="\$\{journalsEnabled \? 'false' : 'true'\}"/);
  assert.doesNotMatch(layoutMarkup, /id="journalSubjectBlock"[^>]*hidden/);
  assert.match(layoutMarkup, /id="journalHistoryBlock" \$\{journalsEnabled \? '' : 'hidden'\}/);
  assert.match(portalRenderer, /journalSubjectBlock\.classList\.toggle\('is-disabled', !isJournalEnabled\)/);
  assert.match(portalRenderer, /journalSubjectBlock\.setAttribute\('aria-disabled', String\(!isJournalEnabled\)\)/);
  assert.match(portalRenderer, /journalHistoryBlock\.hidden = !isJournalEnabled/);
  assert.match(portalRenderer, /journalSubjectSelect\.disabled = !isJournalEnabled \|\| \(!eligibleJournalSubjects\.length && !savedJournalSubjectId\)/);
  assert.doesNotMatch(portalRenderer, /journalSettingsColumn\.hidden|journalSubjectBlock\.hidden/);
  assert.match(settingsPage, /form\.elements\.journalSubjectId\?\.value \?\? state\.apiJournalSubjectId/);
  assert.match(portalRenderer, /<\/div>\s*<div class="school-form-footer"[\s\S]*?Save portal features/);

  assert.match(settingsStyles, /\.school-portal-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 3fr\) minmax\(0, 2fr\)/s);
  assert.doesNotMatch(settingsStyles, /\.school-portal-layout:not\(\.has-journals\)/);
  assert.match(settingsStyles, /\.school-portal-journal-column > \.school-journal-settings-block\s*\{[^}]*padding:\s*16px;[^}]*border:\s*1px solid var\(--gray-200\);[^}]*border-radius:\s*var\(--radius-md\);[^}]*background:\s*var\(--gray-50\);/s);
  assert.doesNotMatch(settingsStyles, /\.school-journal-settings-block\.is-disabled\s*\{/);
  assert.match(settingsStyles, /\.school-portal-journal-column \.school-form-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(settingsStyles, /@media \(max-width: 1060px\)[\s\S]*?\.school-portal-layout\s*\{\s*grid-template-columns:\s*1fr;/);
  checkInlineScript(settingsPage, 'edugnay-admin-schools.inline.js');
});

test('Dashboard Quick Actions links straight to the open School Calendar notice form', () => {
  assert.match(dashboardPage, /title: 'Add Calendar Notice'[\s\S]*?href: 'edugnay-admin-schools\.html#add-calendar-notice'/);
  assert.match(dashboardPage, /href="\$\{action\.href \|\| '#'}" class="qa-item"/);
  assert.match(dashboardPage, /title: 'Post Announcement'[\s\S]*?openAnnouncementModal/);
  checkInlineScript(dashboardPage, 'edugnay-admin-dashboard.inline.js');
});

test('Academic Terms uses a responsive full-width setup, tracker card, and three-term schedule cards', () => {
  const termsStart = settingsPage.indexOf('    function renderAcademicTermsPane()');
  const termsEnd = settingsPage.indexOf('\n    function activeK10GradingYear()', termsStart);
  assert.ok(termsStart >= 0 && termsEnd > termsStart, 'Academic Terms renderer is present');
  const termsRenderer = settingsPage.slice(termsStart, termsEnd);

  assert.match(termsRenderer, /school-terms-pane/);
  assert.match(termsRenderer, /term-config-grid/);
  assert.match(termsRenderer, /id="termSchoolYear"[\s\S]*?id="termSchoolYearStart"[\s\S]*?id="termSchoolYearEnd"[\s\S]*?id="termPeriodType"/);
  assert.match(termsRenderer, /const threeTermSchedule = type\.id === 'three_term';/);
  assert.match(termsRenderer, /term-schedule-list \$\{threeTermSchedule \? 'three-term-schedule' : ''\}/);
  assert.match(termsRenderer, /periods\.map\(period => threeTermSchedule \? `[\s\S]*?term-schedule-card-header[\s\S]*?term-status \$\{period\.status\}[\s\S]*?term-schedule-dates[\s\S]*?data-term-period-start[\s\S]*?data-term-period-end[\s\S]*?` : `<div class="term-schedule-row" data-term-period>/);
  assert.match(termsRenderer, /data-term-period-name[\s\S]*?readonly/);
  assert.match(termsRenderer, /data-term-period-start[\s\S]*?period\.status === 'upcoming' \? '' : 'disabled'/);
  assert.match(termsRenderer, /data-term-period-end[\s\S]*?period\.status === 'upcoming' \? '' : 'disabled'/);
  assert.match(termsRenderer, /termsForm\.addEventListener\('submit', saveAcademicTerms\)/);

  assert.match(settingsStyles, /\.school-terms-pane form\s*\{\s*max-width:\s*none;/);
  assert.match(settingsStyles, /\.term-config-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
  assert.match(settingsStyles, /@media \(max-width: 1060px\)[\s\S]*?\.term-config-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
  assert.match(settingsStyles, /@media \(max-width: 560px\)[\s\S]*?\.term-config-grid\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(settingsStyles, /\.term-tracker-block\s*\{[^}]*padding:\s*16px;[^}]*border:\s*1px solid var\(--gray-200\);[^}]*border-radius:\s*var\(--radius-sm\);/s);
  assert.match(settingsStyles, /\.term-schedule-list\.three-term-schedule\s*\{\s*grid-template-columns:\s*repeat\(3,/);
  assert.match(settingsStyles, /@media \(max-width: 1060px\)[\s\S]*?\.term-schedule-list\.three-term-schedule\s*\{\s*grid-template-columns:\s*repeat\(2,/);
  assert.match(settingsStyles, /@media \(max-width: 560px\)[\s\S]*?\.term-schedule-list\.three-term-schedule\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(settingsStyles, /\.term-schedule-dates\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(2,/);
  assert.match(settingsStyles, /@media \(max-width: 560px\)[\s\S]*?\.term-schedule-list\.three-term-schedule \.term-schedule-row,\s*\.term-schedule-dates\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(settingsStyles, /\.term-schedule-row\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*minmax\(120px, \.8fr\) repeat\(2, minmax\(135px, 1fr\)\) 72px;/);
  checkInlineScript(settingsPage, 'edugnay-admin-schools.inline.js');
});

test('Opening and closing the calendar form updates its direct link', () => {
  const hashStart = settingsPage.indexOf('    function updateSchoolSettingsHash(');
  const listStart = settingsPage.indexOf('    function renderCalendarNoticesList()', hashStart);
  const formStart = settingsPage.indexOf('    function setCalendarNoticeFormOpen(', listStart);
  const loadStart = settingsPage.indexOf('    async function loadCalendarNotices()', formStart);
  assert.ok(hashStart >= 0 && listStart > hashStart && formStart > listStart && loadStart > formStart);
  let currentUrl = '';
  let renderCount = 0;
  const context = {
    state: { calendarFormOpen: false, calendarFocusRequested: false },
    window: {
      location: { pathname: '/views/admin/edugnay-admin-schools.html', search: '' },
      history: { replaceState(_state, _title, url) { currentUrl = url; } }
    },
    renderCalendarPane() { renderCount += 1; }
  };
  const source = settingsPage.slice(hashStart, listStart) + settingsPage.slice(formStart, loadStart);
  const helpers = vm.runInNewContext(`${source}\n({ setCalendarNoticeFormOpen })`, context);
  helpers.setCalendarNoticeFormOpen(true);
  assert.equal(context.state.calendarFormOpen, true);
  assert.equal(context.state.calendarFocusRequested, true);
  assert.equal(currentUrl, '/views/admin/edugnay-admin-schools.html#add-calendar-notice');
  helpers.setCalendarNoticeFormOpen(false);
  assert.equal(context.state.calendarFormOpen, false);
  assert.equal(context.state.calendarFocusRequested, false);
  assert.equal(currentUrl, '/views/admin/edugnay-admin-schools.html#school-calendar');
  assert.equal(renderCount, 2);
});
