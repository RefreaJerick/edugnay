const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function timetableSnapshot() {
  const source = read('assets/js/timetables.js').replace(
    "  document.addEventListener('DOMContentLoaded', () => {",
    "  globalThis.exportWeekForTest = exportWeek;\n  document.addEventListener('DOMContentLoaded', () => {"
  );
  const context = {
    document: { addEventListener() {}, getElementById: () => null }, window: {}
  };
  vm.runInNewContext(source, context);
  return context.exportWeekForTest;
}

function week(role = 'student') {
  const assignments = [
    { id: 1, weekday: 1, startTime: '10:00', endTime: '11:00', startDate: '2026-12-28', endDate: '2027-01-03', subjectName: 'Advanced Biology and Environmental Science', gradeName: 'Grade 12', sectionName: 'St. Peter', teacherName: 'Maya Santos', room: 'Science Lab' },
    { id: 2, weekday: 1, startTime: '08:00', endTime: '09:00', startDate: '2026-12-28', endDate: '2027-01-03', subjectName: 'Mathematics', gradeName: 'Grade 12', sectionName: 'St. Peter', teacherName: 'Ana Cruz', room: '' },
    { id: 3, weekday: 1, startTime: '13:00', endTime: '14:00', startDate: '2026-12-29', endDate: '2027-01-03', subjectName: 'Not effective Monday', gradeName: 'Grade 12', sectionName: 'St. Peter', teacherName: 'Maya Santos', room: '' },
    { id: 4, weekday: 7, startTime: '09:00', endTime: '10:00', startDate: '2027-01-01', endDate: '2027-01-03', subjectName: 'Sunday Class', gradeName: 'Grade 12', sectionName: 'St. Peter', teacherName: 'Maya Santos', room: '' }
  ];
  return { role, week: '2026-12-28', data: { year: { label: '2026-2027' }, meetings: assignments } };
}

test('export is available only on teacher and student schedule pages', () => {
  for (const role of ['teacher', 'student']) {
    const html = read(`views/${role}/edugnay-${role}-schedules.html`);
    assert.match(html, /timetable-export\.js/);
    assert.match(html, /id="timetable-export-open"[^>]*hidden/);
    assert.match(html, /id="timetable-export-dialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
    assert.match(html, /name="timetable-export-layout" value="mobile" checked/);
    assert.match(html, /name="timetable-export-theme" value="light" checked/);
    assert.match(html, /id="timetable-export-download"[^>]*disabled/);
    for (const [icon, label] of [['smartphone', 'Mobile'], ['monitor', 'Desktop'], ['sun', 'Light'], ['moon', 'Dark']]) {
      assert.match(html, new RegExp(`<i data-lucide="${icon}" aria-hidden="true"><\\/i>${label}<\\/span>`));
    }
  }
  const admin = read('views/admin/edugnay-admin-timetables.html');
  assert.doesNotMatch(admin, /timetable-export\.js|timetable-export-open|timetable-export-dialog/);
  const css = read('assets/css/timetables.css');
  assert.match(css, /\.timetable-export-preview\s*\{[^}]*overflow: auto/);
  assert.match(css, /\.timetable-export-choice span\s*\{[^}]*display: flex; align-items: center; justify-content: center; gap: 6px/);
  assert.match(css, /\.timetable-export-choice span svg\s*\{\s*width: 15px; height: 15px; flex: 0 0 auto;\s*\}/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.timetable-export-options\s*\{\s*grid-template-columns: 1fr/);
});

test('selected-week snapshot filters effective dates, sorts times, and includes role-specific details', () => {
  const exportWeek = timetableSnapshot();
  const student = exportWeek(week('student'));
  assert.equal(student.days.length, 7);
  assert.equal(student.days[0].date, '2026-12-28');
  assert.equal(student.days[6].date, '2027-01-03');
  assert.equal(student.days[0].meetings.length, 2);
  assert.deepEqual(Array.from(student.days[0].meetings, item => item.subject), ['Mathematics', 'Advanced Biology and Environmental Science']);
  assert.equal(student.days[2].meetings.length, 0);
  assert.equal(student.days[6].meetings[0].subject, 'Sunday Class');
  assert.deepEqual(Array.from(student.days[0].meetings[1].details), ['Teacher: Maya Santos', 'Room: Science Lab']);
  assert.doesNotMatch(JSON.stringify(student), /Grade 12|St\. Peter/);

  const teacher = exportWeek(week('teacher'));
  assert.deepEqual(Array.from(teacher.days[0].meetings[1].details), ['Grade 12 · St. Peter', 'Room: Science Lab']);
  assert.doesNotMatch(JSON.stringify(teacher), /Maya Santos|Ana Cruz|Teacher:/);
  const changed = week('teacher');
  changed.week = '2027-01-04';
  changed.data.year.label = '2027-2028';
  const nextWeek = exportWeek(changed);
  assert.equal(nextWeek.weekStart, '2027-01-04');
  assert.equal(nextWeek.yearLabel, '2027-2028');
  assert.equal(nextWeek.days[0].meetings.length, 0);
});

function exporterHarness() {
  const painted = [];
  const canvases = [];
  const blobbed = [];
  const downloads = [];
  const toasts = [];
  const elements = new Map();
  let activeElement = null;
  const makeElement = () => ({
    hidden: false, disabled: false, checked: false, dataset: {}, style: {}, children: [], textContent: '',
    listeners: {}, classList: { toggle() {} },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    dispatch(type, event = {}) { return this.listeners[type]?.({ target: this, currentTarget: this, ...event }); },
    replaceChildren(...children) { this.children = children; },
    focus() { activeElement = this; },
    appendChild(child) { this.children.push(child); },
    remove() {}
  });
  const element = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const radios = {};
  for (const [name, value, checked] of [
    ['layout', 'mobile', true], ['layout', 'desktop', false], ['theme', 'light', true], ['theme', 'dark', false]
  ]) {
    const radio = makeElement();
    radio.name = `timetable-export-${name}`;
    radio.value = value;
    radio.checked = checked;
    radios[`${name}-${value}`] = radio;
  }
  const dialog = element('timetable-export-dialog');
  dialog.querySelector = selector => {
    if (selector.includes('input[name=')) {
      const name = selector.match(/timetable-export-(layout|theme)/)?.[1];
      const value = selector.match(/value="(mobile|desktop|light|dark)"/)?.[1];
      return value ? radios[`${name}-${value}`] : Object.values(radios).find(radio => radio.name === `timetable-export-${name}` && radio.checked);
    }
    return null;
  };
  dialog.querySelectorAll = () => [element('timetable-export-close'), ...Object.values(radios), element('timetable-export-cancel'), element('timetable-export-download')];
  const canvasContext = () => ({
    font: '', fillStyle: '', path: [],
    beginPath() { this.path = []; },
    moveTo(x, y) { this.path.push([x, y]); },
    lineTo(x, y) { this.path.push([x, y]); },
    quadraticCurveTo(cx, cy, x, y) { this.path.push([cx, cy], [x, y]); },
    closePath() {},
    fill() {
      painted.push({ type: 'shape', color: this.fillStyle,
        left: Math.min(...this.path.map(point => point[0])),
        right: Math.max(...this.path.map(point => point[0])),
        top: Math.min(...this.path.map(point => point[1])),
        bottom: Math.max(...this.path.map(point => point[1])) });
    },
    measureText(value) { const size = Number(this.font.match(/\d+(?=px)/)?.[0] || 20); return { width: String(value).length * size * .52 }; },
    fillRect(x, y, width, height) { painted.push({ type: 'background', color: this.fillStyle, x, y, width, height }); },
    fillText(value, x, y) { painted.push({ type: 'text', value, x, y, font: this.font }); },
    drawImage() { painted.push({ type: 'logo' }); }
  });
  const document = {
    fonts: { ready: Promise.resolve() }, body: { style: { overflow: '' }, appendChild() {} },
    get activeElement() { return activeElement; },
    getElementById: element, listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; },
    createElement(tag) {
      if (tag === 'canvas') {
        const canvas = { width: 0, height: 0, getContext: canvasContext,
          toBlob(callback) { blobbed.push(this); callback({ type: 'image/png' }); } };
        canvases.push(canvas);
        return canvas;
      }
      const link = makeElement();
      link.click = () => downloads.push(link.download);
      return link;
    }
  };
  class ImageMock { set src(value) { this.url = value; this.onload(); } }
  const window = { location: { href: 'http://127.0.0.1:5500/views/student/edugnay-student-schedules.html' }, setTimeout() {} };
  class URLMock extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() {} }
  const context = {
    document, window, Image: ImageMock, URL: URLMock,
    showAppToast(message, type) { toasts.push({ message, type }); }, setTimeout() {}
  };
  vm.runInNewContext(read('assets/js/timetable-export.js'), context);
  return { exporter: window.AcademixTimetableExport, painted, canvases, blobbed, downloads, toasts, element, radios, document };
}

test('the shared image renderer supports four styles without clipping or leaking role details', async () => {
  const harness = exporterHarness();
  const exportWeek = timetableSnapshot();
  const student = exportWeek(week('student'));
  const teacher = exportWeek(week('teacher'));
  for (const roleSnapshot of [student, teacher]) {
    for (const layout of ['mobile', 'desktop']) {
      for (const theme of ['light', 'dark']) {
        harness.painted.length = 0;
        const canvas = await harness.exporter.render(roleSnapshot, layout, theme);
        assert.equal(canvas.width, layout === 'mobile' ? 1080 : 2100);
        assert.ok(canvas.height > 400);
        const text = harness.painted.filter(item => item.type === 'text');
        assert.ok(text.some(item => item.value === 'No classes'));
        assert.ok(text.some(item => item.value === 'Acade'));
        assert.ok(text.some(item => item.value === 'Mix'));
        assert.ok(text.some(item => item.value === 'S.Y. 2026-2027'));
        assert.ok(text.every(item => !/December 28, 2026|January 3, 2027|Generated on/.test(item.value)));
        for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
          assert.ok(text.some(item => item.value === day));
        }
        assert.ok(text.every(item => item.value !== 'Dec 28' && item.value !== 'Jan 3'));
        assert.ok(text.every(item => item.y < canvas.height));
        if (layout === 'mobile') assert.ok(text.every(item => !item.value.includes('Schedule snapshot')));
        else {
          assert.ok(text.some(item => item.value.includes('Schedule snapshot')));
          const surfaces = harness.painted.filter(item => item.type === 'shape' && item.color === (theme === 'light' ? '#ffffff' : '#112b49'));
          assert.equal(surfaces.length, 7);
          assert.ok(surfaces.every(item => item.top === surfaces[0].top));
        }
        assert.ok(harness.painted.some(item => item.type === 'logo'));
        assert.equal(harness.painted.find(item => item.type === 'background').color, theme === 'light' ? '#eff4fa' : '#081a32');
        const imageText = text.map(item => item.value).join(' ');
        if (roleSnapshot === student) {
          assert.match(imageText, /Teacher: Maya Santos/);
          assert.doesNotMatch(imageText, /Grade 12|St\. Peter/);
        } else {
          assert.match(imageText, /Grade 12 · St\. Peter/);
          assert.doesNotMatch(imageText, /Teacher: Maya Santos/);
        }
      }
    }
  }
  const longer = structuredClone(student);
  longer.days[0].meetings.push(...Array.from({ length: 8 }, (_, index) => ({
    subject: `A very long subject title with additional text for class ${index}`,
    time: '09:00 AM - 10:00 AM', details: ['Teacher: Maya Santos', 'Room: Long room name']
  })));
  const shortCanvas = await harness.exporter.render(student, 'mobile', 'light');
  const longCanvas = await harness.exporter.render(longer, 'mobile', 'light');
  assert.ok(longCanvas.height > shortCanvas.height);
});

test('mobile export uses one sheet with measured meeting rows and slim empty days', async () => {
  const harness = exporterHarness();
  const exportWeek = timetableSnapshot();
  for (const role of ['student', 'teacher']) {
    const snapshot = exportWeek(week(role));
    snapshot.days[0].meetings.push(...Array.from({ length: 5 }, (_, index) => ({
      subject: `An extended subject title for class ${index} with additional words that must wrap`,
      time: '09:00 AM - 10:00 AM', details: role === 'student'
        ? ['Teacher: Maya Santos', 'Room: Science Lab with a very long name']
        : ['Grade 12 · St. Peter', 'Room: Science Lab with a very long name']
    })));
    snapshot.days[6].meetings.push({
      subject: 'Sunday workshop with a long subject name', time: '11:00 AM - 12:00 PM',
      details: role === 'student' ? ['Teacher: Maya Santos'] : ['Grade 12 · St. Peter']
    });
    for (const theme of ['light', 'dark']) {
      harness.painted.length = 0;
      const canvas = await harness.exporter.render(snapshot, 'mobile', theme);
      const surfaceColor = theme === 'light' ? '#ffffff' : '#112b49';
      const cardColor = theme === 'light' ? '#eff6ff' : '#1b3a5f';
      const sheets = harness.painted.map((item, index) => ({ ...item, index }))
        .filter(item => item.type === 'shape' && item.color === surfaceColor);
      assert.equal(sheets.length, 1);
      const sheet = sheets[0];
      assert.equal(sheet.left, 48);
      assert.equal(sheet.right, 1032);
      assert.equal(canvas.height - sheet.bottom, 48);
      assert.equal(harness.painted.filter(item => item.type === 'shape' && item.color === cardColor).length, 0);
      const text = harness.painted.slice(sheet.index + 1).filter(item => item.type === 'text');
      const weekdayLabels = snapshot.days.map(day => text.find(item => item.value === day.name));
      assert.ok(weekdayLabels.every(Boolean));
      assert.ok(weekdayLabels.every((item, index) => index === 0 || item.y > weekdayLabels[index - 1].y));
      assert.equal(weekdayLabels[2].y - weekdayLabels[1].y, 73, 'empty days use short rows');
      assert.equal(text.filter(item => item.value === 'No classes').length, 5);
      assert.ok(harness.painted.filter(item => item.type === 'background' && item.color === (theme === 'light' ? '#dce6f2' : '#375575')).length >= 6);
      const time = text.find(item => item.value === snapshot.days[0].meetings[0].time);
      const subject = text.find(item => item.value === snapshot.days[0].meetings[0].subject);
      assert.ok(time && subject && time.x < subject.x);
      assert.ok(text.some(item => item.value.includes('An extended subject title')));
      assert.ok(text.every(item => !item.value.includes('Schedule snapshot')));
      for (const item of text) {
        const size = Number(item.font.match(/\d+(?=px)/)?.[0] || 20);
        assert.ok(item.x >= sheet.left && item.x + item.value.length * size * .52 <= sheet.right - 28, item.value);
        assert.ok(item.y >= sheet.top && item.y < sheet.bottom, item.value);
      }
    }
  }
  const empty = exportWeek(week('student'));
  empty.days.forEach(day => { day.meetings = []; });
  harness.painted.length = 0;
  const emptyCanvas = await harness.exporter.render(empty, 'mobile', 'light');
  assert.ok(emptyCanvas.height < emptyCanvas.width, 'empty days should not create a tall image');
  assert.equal(harness.painted.filter(item => item.type === 'text' && item.value === 'No classes').length, 7);
});

test('the preview canvas is the same canvas downloaded for the current selection', async () => {
  const harness = exporterHarness();
  let snapshot = timetableSnapshot()(week('student'));
  const control = harness.exporter.init(() => snapshot);
  const open = harness.element('timetable-export-open');
  control.setAvailable(true);
  open.dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  const preview = harness.element('timetable-export-preview');
  const first = preview.children[0];
  assert.equal(first.width, 1080);
  assert.equal(harness.element('timetable-export-download').disabled, false);

  harness.radios['layout-mobile'].checked = false;
  harness.radios['layout-desktop'].checked = true;
  harness.radios['theme-light'].checked = false;
  harness.radios['theme-dark'].checked = true;
  harness.radios['layout-desktop'].dispatch('change');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(preview.children[0].width, 2100);
  assert.notEqual(preview.children[0], first);
  const shown = preview.children[0];
  harness.element('timetable-export-download').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.downloads.at(-1), 'Academix-Schedule-2026-12-28-desktop-dark.png');
  assert.equal(preview.children[0], shown);
  assert.equal(harness.blobbed.at(-1), shown);

  harness.element('timetable-export-cancel').dispatch('click');
  assert.equal(harness.element('timetable-export-overlay').hidden, true);
  assert.equal(harness.document.activeElement, open);
  const next = week('teacher');
  next.week = '2027-01-04';
  next.data.year.label = '2027-2028';
  snapshot = timetableSnapshot()(next);
  harness.painted.length = 0;
  harness.element('timetable-export-open').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(preview.children[0].width, 1080);
  assert.equal(harness.radios['layout-mobile'].checked, true);
  assert.equal(harness.radios['theme-light'].checked, true);
  assert.ok(harness.painted.some(item => item.type === 'text' && item.value === 'S.Y. 2027-2028'));
  assert.ok(harness.painted.every(item => item.type !== 'text' || !item.value.includes('Advanced Biology')));
  harness.element('timetable-export-download').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.downloads.at(-1), 'Academix-Schedule-2027-01-04-mobile-light.png');
  harness.document.listeners.keydown({ key: 'Escape' });
  assert.equal(harness.element('timetable-export-overlay').hidden, true);
  assert.equal(harness.document.activeElement, open);
});

test('export errors, duplicate clicks, cancellation, and unavailable data stay safe', async () => {
  const harness = exporterHarness();
  const snapshot = timetableSnapshot()(week('student'));
  const control = harness.exporter.init(() => snapshot);
  control.setAvailable(true);
  const open = harness.element('timetable-export-open');
  const overlay = harness.element('timetable-export-overlay');
  const download = harness.element('timetable-export-download');
  open.dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  const canvas = harness.element('timetable-export-preview').children[0];
  let finishBlob;
  let calls = 0;
  canvas.toBlob = callback => { calls += 1; finishBlob = callback; };
  download.dispatch('click');
  download.dispatch('click');
  assert.equal(calls, 1);
  assert.equal(download.disabled, true);
  finishBlob(null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.downloads.length, 0);
  assert.equal(download.disabled, false);
  assert.equal(harness.toasts.at(-1).type, 'error');

  canvas.toBlob = callback => { finishBlob = callback; };
  download.dispatch('click');
  overlay.dispatch('click', { target: overlay });
  finishBlob({ type: 'image/png' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.downloads.length, 0);
  assert.equal(overlay.hidden, true);
  assert.equal(harness.document.activeElement, open);
  control.setAvailable(false);
  assert.equal(open.disabled, true);
  open.dispatch('click');
  assert.equal(overlay.hidden, true);
});
