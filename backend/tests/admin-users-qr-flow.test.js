const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-users.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/users.css'), 'utf8');
const displayFunctions = html.split('    function setUserDetailsQrStatus(')[1]
  .split('    function downloadUserDetailsAttendanceQr(')[0];
const downloadFunction = html.split('    function downloadUserDetailsAttendanceQr(')[1]
  .split('    let regenerateAttendanceQrBusy = false;')[0];
const modalFunctions = html.split('    let regenerateAttendanceQrBusy = false;')[1]
  .split("    document.getElementById('regenerateAttendanceQrForm').addEventListener")[0];
const submitHandler = html.match(/    document\.getElementById\('regenerateAttendanceQrForm'\)\.addEventListener\('submit', async function \(event\) \{[\s\S]*?\n    \}\);/)?.[0];

test('reissue dialog uses the shared blue heading icon and a blue student context', () => {
  const dialog = html.split('id="regenerateAttendanceQrModalBackdrop"')[1].split('id="userDetailsModalBackdrop"')[0];
  assert.match(dialog, /class="modal-heading-icon"/);
  assert.match(dialog, /class="modal-context qr-reissue-context"/);
  assert.match(css, /\.qr-reissue-context\s*\{[^}]*var\(--blue-pale\)[^}]*var\(--blue-xpale\)/);
});

function element() {
  const classes = new Set();
  return {
    hidden: false, disabled: false, value: '', textContent: '', src: '',
    isConnected: true,
    classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      contains: value => classes.has(value),
      toggle(value, on) { if (on) classes.add(value); else classes.delete(value); }
    },
    setAttribute() {}, removeAttribute(name) { if (name === 'src') this.src = ''; },
    focus() { this.focused = true; },
    addEventListener(name, listener) { this[name] = listener; }
  };
}

function setup(options = {}) {
  const ids = [
    'userDetailsAttendanceQrStatus', 'userDetailsAttendanceQrImage', 'userDetailsAttendanceQrDownload',
    'userDetailsAttendanceQrReload', 'userDetailsModalBackdrop', 'regenerateAttendanceQrStudentId',
    'regenerateAttendanceQrStudentName', 'regenerateAttendanceQrModalBackdrop',
    'regenerateAttendanceQrModalClose', 'regenerateAttendanceQrCancel',
    'regenerateAttendanceQrConfirm', 'regenerateAttendanceQrForm'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  const qrBox = element();
  elements.userDetailsAttendanceQrImage.parentElement = qrBox;
  elements.userDetailsModalBackdrop.classList.add('open');
  elements.regenerateAttendanceQrStudentId.value = '4';
  const trigger = element();
  const download = element();
  download.click = () => { download.clicked = true; };
  let reads = 0;
  let writes = 0;
  const messages = [];
  const context = vm.createContext({
    document: { getElementById: id => elements[id], createElement: () => download, activeElement: trigger },
    window: {
      EDUGNAY_API: {
        async getStudentQr() {
          reads += 1;
          return options.getQr ? options.getQr() : { qrPayload: options.unavailable ? null : 'academix:attendance:old' };
        },
        async regenerateStudentQr() {
          writes += 1;
          if (options.requestError) throw options.requestError;
          return options.regenerateQr ? options.regenerateQr() : { qrPayload: 'academix:attendance:new' };
        }
      },
      EDUGNAY_CONFIG: {
        parseAttendanceQrPayload: payload => payload?.split(':').at(-1) || '',
        async generateAttendanceQrDataUrl(token) {
          if (options.imageError && token === 'new') throw new Error('Image failed');
          return `data:image/png;base64,${token}`;
        }
      }
    },
    lucide: { createIcons() {} },
    showAppToast: message => messages.push(message),
    findManagedUser: () => null
  });
  vm.runInContext(`
    let userDetailsAttendanceQrDataUrl = '';
    let userDetailsQrStudent = { id: '4', apiId: 4, role: 'student', displayName: 'Student' };
    let userDetailsQrRequestId = 0;
    let usersApiActive = true;
    function setUserDetailsQrStatus(${displayFunctions}
    function downloadUserDetailsAttendanceQr(${downloadFunction}
    let regenerateAttendanceQrBusy = false;${modalFunctions}
    ${submitHandler}
  `, context);
  return { context, elements, trigger, download, messages, get reads() { return reads; }, get writes() { return writes; } };
}

test('opening details reads QR without reissuing, including when no QR is available', async () => {
  for (const unavailable of [false, true]) {
    const page = setup({ unavailable });
    await vm.runInContext('renderUserDetailsAttendanceQr(userDetailsQrStudent)', page.context);
    assert.equal(page.reads, 1);
    assert.equal(page.writes, 0);
    assert.equal(page.elements.userDetailsAttendanceQrDownload.disabled, unavailable);
    if (unavailable) assert.match(page.elements.userDetailsAttendanceQrStatus.textContent, /QR unavailable/);
  }
});

test('cancel restores user details without rotating a QR', () => {
  const page = setup();
  vm.runInContext('openRegenerateAttendanceQrModal()', page.context);
  assert.equal(page.elements.userDetailsModalBackdrop.classList.contains('open'), false);
  assert.equal(page.elements.userDetailsModalBackdrop.hidden, true);
  assert.equal(page.elements.regenerateAttendanceQrModalBackdrop.classList.contains('open'), true);
  vm.runInContext('closeRegenerateAttendanceQrModal()', page.context);
  assert.equal(page.elements.userDetailsModalBackdrop.classList.contains('open'), true);
  assert.equal(page.elements.userDetailsModalBackdrop.hidden, false);
  assert.equal(page.elements.regenerateAttendanceQrModalBackdrop.classList.contains('open'), false);
  assert.equal(page.trigger.focused, true);
  assert.equal(page.writes, 0);
});

test('confirmation rotates once and shows only the replacement QR', async () => {
  const page = setup();
  await vm.runInContext('renderUserDetailsAttendanceQr(userDetailsQrStudent)', page.context);
  vm.runInContext('openRegenerateAttendanceQrModal()', page.context);
  const submit = page.elements.regenerateAttendanceQrForm.submit;
  await submit({ preventDefault() {} });
  assert.equal(page.writes, 1);
  assert.equal(page.elements.userDetailsAttendanceQrImage.src, 'data:image/png;base64,new');
  assert.equal(page.elements.userDetailsAttendanceQrDownload.disabled, false);
  vm.runInContext('downloadUserDetailsAttendanceQr()', page.context);
  assert.equal(page.download.href, 'data:image/png;base64,new');
  assert.equal(page.download.clicked, true);
  assert.equal(page.elements.userDetailsModalBackdrop.classList.contains('open'), true);
  assert.match(page.elements.userDetailsAttendanceQrStatus.textContent, /previous QR is no longer valid/);
});

test('request failure keeps the old QR; image failure hides it and offers reload', async () => {
  const denied = setup({ requestError: Object.assign(new Error('Not allowed'), { status: 403 }) });
  await vm.runInContext('renderUserDetailsAttendanceQr(userDetailsQrStudent)', denied.context);
  vm.runInContext('openRegenerateAttendanceQrModal()', denied.context);
  await denied.elements.regenerateAttendanceQrForm.submit({ preventDefault() {} });
  assert.equal(denied.elements.userDetailsAttendanceQrImage.src, 'data:image/png;base64,old');
  assert.equal(denied.elements.userDetailsModalBackdrop.classList.contains('open'), true);

  const brokenImage = setup({ imageError: true });
  await vm.runInContext('renderUserDetailsAttendanceQr(userDetailsQrStudent)', brokenImage.context);
  vm.runInContext('openRegenerateAttendanceQrModal()', brokenImage.context);
  await brokenImage.elements.regenerateAttendanceQrForm.submit({ preventDefault() {} });
  assert.equal(brokenImage.writes, 1);
  assert.equal(brokenImage.elements.userDetailsAttendanceQrDownload.disabled, true);
  assert.equal(brokenImage.elements.userDetailsAttendanceQrReload.hidden, false);
  assert.match(brokenImage.elements.userDetailsAttendanceQrStatus.textContent, /QR reissued/);
});

test('a double submit makes one request and a stale read cannot replace the new image', async () => {
  let finishRead;
  let finishReissue;
  const page = setup({
    getQr: () => new Promise(resolve => { finishRead = resolve; }),
    regenerateQr: () => new Promise(resolve => { finishReissue = resolve; })
  });
  const read = vm.runInContext('renderUserDetailsAttendanceQr(userDetailsQrStudent)', page.context);
  vm.runInContext('openRegenerateAttendanceQrModal()', page.context);
  const submit = page.elements.regenerateAttendanceQrForm.submit;
  const first = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  assert.equal(page.writes, 1);
  finishReissue({ qrPayload: 'academix:attendance:new' });
  await first;
  finishRead({ qrPayload: 'academix:attendance:old' });
  await read;
  assert.equal(page.elements.userDetailsAttendanceQrImage.src, 'data:image/png;base64,new');
});
