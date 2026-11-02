const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '../..');
const pages = [path.join(root, 'index.html')];
for (const role of fs.readdirSync(path.join(root, 'views'))) {
  const folder = path.join(root, 'views', role);
  if (fs.statSync(folder).isDirectory()) {
    pages.push(...fs.readdirSync(folder).filter(name => name.endsWith('.html')).map(name => path.join(folder, name)));
  }
}

test('every page loads external scripts and has no inline JavaScript', () => {
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i, page);
    assert.doesNotMatch(html, /\bon(?:click|change|input|submit|error|keydown|keyup|load|focus|blur|mouseenter|mouseleave)\s*=/i, page);

    const sources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi)]
      .map(([, url]) => path.resolve(path.dirname(page), url.split('?')[0]));
    for (const source of sources) assert.ok(fs.existsSync(source), `${page}: missing ${source}`);

    const loadedCode = sources.filter(source => source.includes(`${path.sep}assets${path.sep}js${path.sep}`))
      .map(source => fs.readFileSync(source, 'utf8')).join('\n');
    for (const [, event, id] of html.matchAll(/data-page-(click|change|input|submit|error|keydown|keyup|load|focus|blur|mouseenter|mouseleave)=["']([ps][a-f0-9]+)["']/gi)) {
      assert.match(loadedCode, new RegExp(`\\b${id}: function\\(event\\)`), `${page}: missing ${event} handler ${id}`);
    }
  }
});
