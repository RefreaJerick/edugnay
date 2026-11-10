const fs = require('node:fs');
const path = require('node:path');

const backendDirectory = path.resolve(__dirname, '..');
const example = fs.readFileSync(path.join(backendDirectory, '.env.example'), 'utf8');
const documented = new Set(
  [...example.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map(match => match[1])
);
const used = new Set();

function checkDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!['node_modules', 'scripts', 'tests'].includes(entry.name)) {
        checkDirectory(path.join(directory, entry.name));
      }
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;

    const source = fs.readFileSync(path.join(directory, entry.name), 'utf8');
    for (const match of source.matchAll(/\bprocess\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g)) {
      used.add(match[1] || match[2]);
    }
  }
}

checkDirectory(backendDirectory);
const missing = [...used].filter(name => !documented.has(name)).sort();
if (missing.length) {
  console.error(`Missing from .env.example: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('.env.example documents all named backend runtime variables.');
}
