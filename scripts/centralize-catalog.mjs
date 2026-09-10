import fs from 'node:fs';

const FILE = 'data/image-overrides.json';
const payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));

if (!Array.isArray(payload.catalog) || !payload.catalog.length) {
  throw new Error('data/image-overrides.json does not contain a non-empty catalog array');
}

const before = payload.catalog;
const beforeIds = before.map(stableId);
const sorted = before
  .map((item, index) => ({ item, index }))
  .sort((a, b) =>
    String(a.item.champ || '').localeCompare(String(b.item.champ || ''), 'en', { sensitivity: 'base' })
    || a.index - b.index
  )
  .map(({ item }) => item);
const afterIds = sorted.map(stableId);

assertCatalogIntegrity(before, sorted);

const changed = beforeIds.some((id, index) => id !== afterIds[index]);
const strategy = 'single runtime catalogue; champions A-Z; existing per-champion skin order preserved; distinct chroma splash arts stay immediately after their parent skin; duplicate artwork remains excluded';

if (!changed && payload.catalogStrategy === strategy) {
  printSummary(sorted, false);
  process.exit(0);
}

payload.catalog = sorted;
payload.catalogGeneratedAt = new Date().toISOString();
payload.catalogStrategy = strategy;
fs.writeFileSync(FILE, JSON.stringify(payload, null, 2) + '\n');
printSummary(sorted, changed);

function stableId(item) {
  if (item?.id) return String(item.id);
  const platform = item?.type === 'Wild Rift' ? 'wild-rift' : 'pc';
  return `${slugify(item?.champ)}::${slugify(item?.skin)}::${platform}`;
}

function assertCatalogIntegrity(beforeCatalog, afterCatalog) {
  if (beforeCatalog.length !== afterCatalog.length) {
    throw new Error(`Catalog record count changed (${beforeCatalog.length} -> ${afterCatalog.length})`);
  }

  const beforeCounts = countIds(beforeCatalog);
  const afterCounts = countIds(afterCatalog);
  if (beforeCounts.size !== afterCounts.size) throw new Error('Catalog identity set changed while sorting');

  for (const [id, count] of beforeCounts) {
    if (afterCounts.get(id) !== count) throw new Error(`Catalog identity changed while sorting: ${id}`);
  }
}

function countIds(catalog) {
  const result = new Map();
  for (const item of catalog) {
    const id = stableId(item);
    result.set(id, (result.get(id) || 0) + 1);
  }
  return result;
}

function printSummary(catalog, changed) {
  const champions = [...new Set(catalog.map((item) => item.champ).filter(Boolean))];
  console.log(`${changed ? 'Sorted' : 'Verified'} ${catalog.length} skin records across ${champions.length} champions.`);
  console.log(`Champion range: ${champions.slice(0, 5).join(', ')} ... ${champions.slice(-5).join(', ')}`);

  for (const champion of ['Aatrox', 'Ahri', 'Akali']) {
    const skins = catalog.filter((item) => item.champ === champion).map((item) => item.skin);
    if (skins.length) console.log(`${champion}: ${skins.join(' > ')}`);
  }
}

function slugify(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
