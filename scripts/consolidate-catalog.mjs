import fs from 'node:fs';

const FILE = 'data/image-overrides.json';
const payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));

if (!Array.isArray(payload.catalog) || !payload.catalog.length) {
  throw new Error('data/image-overrides.json does not contain a non-empty catalog array');
}
if (!payload.entries || Array.isArray(payload.entries)) {
  throw new Error('data/image-overrides.json does not contain a valid verified-image map');
}

const before = payload.catalog;
const sorted = before
  .map((item, index) => ({ item, index }))
  .sort((a, b) =>
    String(a.item.champ || '').localeCompare(String(b.item.champ || ''), 'en', { sensitivity: 'base' })
    || a.index - b.index
  )
  .map(({ item }) => item);

assertCatalogIntegrity(before, sorted);

const beforeIds = before.map(stableId);
const afterIds = sorted.map(stableId);
const changed = beforeIds.some((id, index) => id !== afterIds[index]);
const strategy = 'single runtime catalogue; champions A-Z; existing per-champion skin order preserved; distinct chroma splash arts stay immediately after their parent skin; duplicate artwork remains excluded';

if (changed || payload.catalogStrategy !== strategy) {
  payload.catalog = sorted;
  payload.catalogGeneratedAt = new Date().toISOString();
  payload.catalogStrategy = strategy;
  fs.writeFileSync(FILE, JSON.stringify(payload, null, 2) + '\n');
}

printSummary(sorted, changed);

function assertCatalogIntegrity(beforeCatalog, afterCatalog) {
  if (beforeCatalog.length !== afterCatalog.length) {
    throw new Error(`Catalog record count changed (${beforeCatalog.length} -> ${afterCatalog.length})`);
  }

  const beforeCounts = countIds(beforeCatalog);
  const afterCounts = countIds(afterCatalog);
  if (beforeCounts.size !== afterCounts.size) {
    throw new Error('Catalog identity set changed while sorting');
  }

  for (const [id, count] of beforeCounts) {
    if (afterCounts.get(id) !== count) {
      throw new Error(`Catalog identity changed while sorting: ${id}`);
    }
  }

  const recordKeys = new Set();
  for (const item of afterCatalog) {
    if (!item?.champ || !item?.skin || !item?.image) {
      throw new Error(`Invalid catalog record: ${JSON.stringify(item)}`);
    }

    const platform = item.type === 'Wild Rift' ? 'wild-rift' : 'pc';
    const key = `${slugify(item.champ)}::${slugify(item.skin)}::${platform}`;
    if (recordKeys.has(key)) {
      throw new Error(`Duplicate catalog record: ${key}`);
    }
    recordKeys.add(key);
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

function stableId(item) {
  if (item?.id) return String(item.id);
  const platform = item?.type === 'Wild Rift' ? 'wild-rift' : 'pc';
  return `${slugify(item?.champ)}::${slugify(item?.skin)}::${platform}`;
}

function printSummary(catalog, changed) {
  const champions = new Set(catalog.map((item) => item.champ).filter(Boolean));
  console.log(`Central catalog: ${catalog.length} skins across ${champions.size} champions; ${changed ? 'champion order normalized' : 'order already valid'}.`);
  console.log(`Verified image overrides retained: ${Object.keys(payload.entries).length}`);
}

function slugify(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
