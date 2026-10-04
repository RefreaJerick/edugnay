const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const views = path.join(__dirname, '../../views');

test('every portal top bar loads the shared avatar styles and renderer', () => {
  let topbarPages = 0;
  for (const portal of fs.readdirSync(views)) {
    const folder = path.join(views, portal);
    if (!fs.statSync(folder).isDirectory()) continue;
    for (const filename of fs.readdirSync(folder).filter(name => name.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(folder, filename), 'utf8');
      if (!html.includes('tb-avatar')) continue;
      topbarPages += 1;
      assert.match(html, /assets\/css\/styles\.css/, `${portal}/${filename} is missing shared avatar styles`);
      assert.match(html, /assets\/js\/shell-common\.js/, `${portal}/${filename} is missing the avatar renderer`);
    }
  }
  assert.equal(topbarPages, 39);
});
