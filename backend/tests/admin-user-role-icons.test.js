const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'views/admin/edugnay-admin-users.html'), 'utf8');
const colors = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
const modal = fs.readFileSync(path.join(root, 'assets/css/admin/users.css'), 'utf8');

test('account and import role icons use theme colors for Student and Parent', () => {
  for (const [role, expected] of [
    ['stud', 'background:var(--surface-success-pale);color:var(--theme-success-text);'],
    ['parents', 'background:var(--purple-pale);color:var(--theme-purple-text);']
  ]) {
    const matches = [...html.matchAll(new RegExp(`<button[^>]*class="role-opt"[^>]*data-role="${role}"[\\s\\S]*?<div class="role-opt-icon" style="([^"]+)"`, 'g'))];
    assert.equal(matches.length, 2, `${role} appears in both account and import modals`);
    for (const match of matches) assert.equal(match[1], expected);
  }
  assert.doesNotMatch(html, /role-opt-icon" style="background:#(?:f0fdf4|fdf4ff)/);
});

test('light colors and selected styling stay unchanged while dark tokens are available', () => {
  for (const token of [
    '--surface-success-pale: #f0fdf4;', '--surface-success-pale: #19382f;',
    '--theme-success-text: #16a34a;', '--theme-success-text: #7ae2a8;',
    '--purple-pale: #fdf4ff;', '--purple-pale: #382747;',
    '--theme-purple-text: #7c3aed;', '--theme-purple-text: #c9adff;'
  ]) assert.ok(colors.includes(token), token);
  assert.match(modal, /\.role-opt:nth-child\(3\)\.selected \.role-opt-icon\s*\{[^}]*var\(--green-pale\)/);
  assert.match(modal, /\.role-opt:nth-child\(4\)\.selected \.role-opt-icon\s*\{[^}]*var\(--purple-pale\)/);
});
