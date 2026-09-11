import fs from 'node:fs';

const FILE = 'data/image-overrides.json';
const payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let removed = 0;

for (const entry of Object.values(payload.entries || {})) {
  if (Object.prototype.hasOwnProperty.call(entry, 'lorFallbacks')) {
    delete entry.lorFallbacks;
    removed += 1;
  }
}

for (const item of payload.catalog || []) {
  if (Object.prototype.hasOwnProperty.call(item, 'lorFallbacks')) {
    delete item.lorFallbacks;
    removed += 1;
  }
}

if (Object.prototype.hasOwnProperty.call(payload, 'lorArt')) {
  delete payload.lorArt;
  removed += 1;
}

if (!removed) {
  console.log('No obsolete LoR fallback metadata found.');
  process.exit(0);
}

payload.generatedAt = new Date().toISOString();
fs.writeFileSync(FILE, JSON.stringify(payload, null, 2) + '\n');
console.log(`Removed ${removed} obsolete LoR fallback fields. LoR is now represented only as first-class gallery entries.`);
