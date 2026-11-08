const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const roles = ['teacher', 'student', 'parent'];

function readRoleFile(role, file) {
  return fs.readFileSync(path.join(root, 'views', role, `edugnay-${role}-${file}.html`), 'utf8');
}

function extractOpenModal(source, role) {
  const start = source.indexOf('function openAnnModal(');
  const end = source.indexOf('function closeAnnModal(', start);
  assert.ok(start >= 0 && end > start, `${role} announcement modal handler is present`);
  return source.slice(start, end);
}

function createCard(title, postedAt, author) {
  return {
    querySelector(selector) {
      if (selector === '.ann-title') return { textContent: title };
      if (selector === '.ann-content') return { dataset: { full: 'Announcement body' }, innerHTML: 'Announcement body' };
      return null;
    },
    querySelectorAll(selector) {
      return selector === '.ann-meta-item'
        ? [{ textContent: postedAt }, { textContent: author }]
        : [];
    }
  };
}

test('announcement modal HTML uses a neutral metadata placeholder for each role', () => {
  for (const role of roles) {
    const html = readRoleFile(role, 'announcements');
    assert.match(html, /id="modalAnnMeta">Announcement details</, `${role} placeholder`);
    assert.doesNotMatch(html, /Today, 8:00 AM/, `${role} has no hard-coded post time`);
  }
});

test('teacher, student, and parent modals show each card author and matching publication time', () => {
  for (const role of roles) {
    const source = fs.readFileSync(path.join(root, 'assets', 'js', role, 'announcements.js'), 'utf8');
    const openModal = extractOpenModal(source, role);
    const elements = new Map();
    const document = {
      getElementById(id) {
        if (!elements.has(id)) {
          elements.set(id, {
            textContent: '',
            style: {},
            classList: { add() {} }
          });
        }
        return elements.get(id);
      }
    };

    const context = {
      document,
      todayCard: createCard('Today update', 'Today, 8:00 AM', 'Alex Test Admin'),
      olderCard: createCard('Earlier update', 'Nov 4, 2026, 11:15 AM', 'Maya Santos'),
      markAsRead() {}
    };

    vm.runInNewContext(`${openModal}\nopenAnnModal(todayCard);`, context);
    assert.equal(elements.get('modalAnnTitle').textContent, 'Today update', `${role} today's modal title`);
    assert.equal(elements.get('modalAnnMeta').textContent, 'Posted by Alex Test Admin · Today, 8:00 AM', `${role} today's header metadata`);
    assert.equal(elements.get('modalPostedAt').textContent, 'Posted · Today, 8:00 AM', `${role} today's posted detail matches`);

    vm.runInNewContext('openAnnModal(olderCard);', context);

    assert.equal(elements.get('modalAnnTitle').textContent, 'Earlier update', `${role} modal title refreshes`);
    assert.equal(elements.get('modalAnnMeta').textContent, 'Posted by Maya Santos · Nov 4, 2026, 11:15 AM', `${role} header metadata`);
    assert.equal(elements.get('modalPostedAt').textContent, 'Posted · Nov 4, 2026, 11:15 AM', `${role} posted detail matches`);
  }
});
