const fs = require('node:fs');
const path = require('node:path');

function readFileSync(file, ...args) {
  const contents = fs.readFileSync(file, ...args);
  if (typeof contents !== 'string' || path.extname(String(file)) !== '.html') return contents;
  const page = path.basename(String(file), '.html');
  const match = /^edugnay-(admin|teacher|student|parent|platform)-(.+)$/.exec(page);
  const folder = match?.[1] || (path.basename(path.dirname(String(file))) === 'onboarding' ? 'onboarding' : page === 'index' ? 'auth' : null);
  const basename = match?.[2] || (page === 'index' ? 'login' : page.replace(/^edugnay-/, ''));
  if (!folder) return contents;

  return contents.replace(/<script\b([^>]*\bsrc=["']([^"']+)["'][^>]*)><\/script>/gi, (tag, attributes, url) => {
    const cleanUrl = url.split('?')[0];
    if (!cleanUrl.endsWith(`/assets/js/${folder}/${basename}.js`)) return tag;
    const script = path.resolve(path.dirname(String(file)), cleanUrl);
    return `<script>window.EDUGNAY_PAGE_EVENTS ||= { bind() {}, register() { return ''; } };\n${fs.readFileSync(script, 'utf8')}</script>`;
  });
}

module.exports = { readFileSync };
