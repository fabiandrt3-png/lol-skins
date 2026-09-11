import fs from 'node:fs';

const CATALOG_FILE = 'data/image-overrides.json';
const MANUAL_FILE = 'data/manual-skins.txt';
const VERSION_FILE = 'version.json';
const WIKI_API = 'https://wiki.leagueoflegends.com/en-us/api.php';
const USER_AGENT = 'lol-skins-catalog-sync/1.1 (+https://github.com/fabiandrt3-png/lol-skins)';
const TIMEOUT_MS = 25000;
const SENSITIVE_TERMS = ['prestige', 'select', 'special', 'edition', 'exquisite', 'mythic'];
const CATALOG_STRATEGY =
  'single runtime catalogue; champions A-Z; existing per-champion skin order preserved; all released PC and Wild Rift skins synced from League Wiki skin data; nested chromas excluded unless represented as a standalone skin with its own splash; duplicate artwork remains excluded';
const SOURCES = [
  { module: 'Module:SkinData/data', type: 'PC', platform: 'pc' },
  { module: 'Module:SkinDataWR/data', type: 'Wild Rift', platform: 'wild-rift' },
];

const payload = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
if (!Array.isArray(payload.catalog)) throw new Error('Missing catalog array in data/image-overrides.json');

const catalog = payload.catalog;
const manualEntries = parseManualFile(fs.existsSync(MANUAL_FILE) ? fs.readFileSync(MANUAL_FILE, 'utf8') : '');
const existing = buildExistingIndex([...catalog, ...manualEntries]);
const now = new Date();
const runDate = now.toISOString().slice(0, 10);
const discovered = [];
const unresolved = [];
const sourceStats = {};

for (const source of SOURCES) {
  console.log(`Loading ${source.module}…`);
  const moduleText = await fetchModuleSource(source.module);
  const records = parseSkinModule(moduleText, source);
  sourceStats[source.type] = { total: records.length, missing: 0, added: 0, unresolved: 0 };

  for (const record of records) {
    if (!isEligibleSkin(record, now)) continue;
    if (matchesExisting(record, existing)) continue;
    sourceStats[source.type].missing += 1;
    discovered.push(record);
  }
}

console.log(`Detected ${discovered.length} missing released skin records.`);

const predicted = await resolvePredictedFiles(discovered);
for (const record of discovered) {
  let image = predicted.get(record.lookupKey) || null;
  if (!image) image = await searchWikiSplash(record, false);
  if (!image) image = await searchWikiSplash(record, true);

  if (!image) {
    unresolved.push({ champion: record.champion, skin: record.displayName, type: record.type });
    sourceStats[record.type].unresolved += 1;
    console.warn(`⚠ unresolved ${record.type}: ${record.champion} — ${record.displayName}`);
    continue;
  }

  const verifiedAt = now.toISOString();
  const item = {
    id: `${slugify(record.champion)}::${slugify(record.displayName)}::${record.platform}`,
    champ: record.champion,
    skin: record.displayName,
    ...(record.type === 'Wild Rift' ? { type: 'Wild Rift' } : {}),
    ...(record.releaseDate ? { releaseDate: record.releaseDate } : {}),
    image: image.url,
    sourceKind: 'wiki-catalog-sync',
    cardSource: image.isHd ? 'league-wiki-hd-fallback' : 'league-wiki-current-client',
    cardVerifiedAt: verifiedAt,
    ...(image.isHd ? { fullImage: image.url, hdSource: 'league-wiki-hd-fallback', hdVerifiedAt: verifiedAt } : {}),
  };

  insertCatalogItem(catalog, item);
  registerExisting(item, existing);
  sourceStats[record.type].added += 1;
  console.log(`+ ${record.type}: ${record.champion} — ${record.displayName}`);
}

const addedCount = Object.values(sourceStats).reduce((sum, value) => sum + value.added, 0);
const nextSync = {
  sources: SOURCES.map((source) => source.module),
  ...sourceStats,
  added: addedCount,
  unresolved,
};
const currentSync = stableSyncState(payload.catalogSync);
const syncChanged = !deepEqual(currentSync, nextSync);
const catalogChanged = addedCount > 0;
const strategyChanged = payload.catalogStrategy !== CATALOG_STRATEGY;
const shouldWrite = catalogChanged || syncChanged || strategyChanged;

if (shouldWrite) {
  payload.catalog = catalog;
  payload.catalogGeneratedAt = now.toISOString();
  payload.catalogStrategy = CATALOG_STRATEGY;
  payload.catalogSync = nextSync;
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Catalog state updated (${addedCount} skin${addedCount === 1 ? '' : 's'} added).`);
} else {
  console.log('Catalog already synchronized; no material file changes.');
}

if (catalogChanged) bumpVersion();
console.log(JSON.stringify({ runDate, changed: shouldWrite, ...nextSync }, null, 2));

function stableSyncState(value) {
  if (!value || typeof value !== 'object') return {};
  const { runAt: _runAt, checkedAt: _checkedAt, ...stable } = value;
  return stable;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function bumpVersion() {
  if (!fs.existsSync(VERSION_FILE)) return;
  const data = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  const current = String(data.version || '');
  const match = current.match(/^(.*-)(\d+)$/);
  data.version = match ? `${match[1]}${Number(match[2]) + 1}` : `${current || runDate}-1`;
  fs.writeFileSync(VERSION_FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`Version: ${current || '(none)'} -> ${data.version}`);
}

function parseManualFile(text) {
  const entries = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [champ, skin, rawType] = line.split('|').map((part) => part.trim());
    if (!champ || !skin) continue;
    const type = /^(?:wr|wild\s*rift|wild-rift)$/i.test(rawType || '') ? 'Wild Rift' : 'PC';
    entries.push({ champ, skin, ...(type === 'Wild Rift' ? { type } : {}), sourceKind: 'manual' });
  }
  return entries;
}

function buildExistingIndex(items) {
  const index = new Map();
  for (const item of items) registerExisting(item, index);
  return index;
}

function registerExisting(item, index) {
  if (!item?.champ || !item?.skin) return;
  const platform = item.type === 'Wild Rift' ? 'wild-rift' : 'pc';
  const key = `${normalize(item.champ)}::${platform}`;
  const values = index.get(key) || new Set();
  for (const candidate of canonicalNameVariants(item.skin, item.champ)) values.add(candidate);
  index.set(key, values);
}

function matchesExisting(record, index) {
  const values = index.get(`${normalize(record.champion)}::${record.platform}`);
  if (!values) return false;
  return record.canonicalNames.some((name) => values.has(name));
}

function canonicalNameVariants(value, champion) {
  const raw = normalize(value);
  const championText = normalize(champion);
  const stripped = raw.replace(new RegExp(`(?:^| )${escapeRegExp(championText)}(?: |$)`, 'g'), ' ').replace(/\s+/g, ' ').trim();
  const variants = new Set([raw, stripped]);
  if (/^(?:classic|original)(?: |$)/.test(raw) || !stripped) variants.add('original');
  for (const candidate of [...variants]) {
    const tokens = candidate.split(' ').filter(Boolean).sort();
    if (tokens.length) variants.add(tokens.join(' '));
  }
  return [...variants].filter(Boolean);
}

async function fetchModuleSource(title) {
  const url = new URL(WIKI_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('prop', 'revisions');
  url.searchParams.set('rvprop', 'content');
  url.searchParams.set('rvslots', 'main');
  url.searchParams.set('titles', title);
  const data = await fetchJson(url.href);
  const page = data?.query?.pages?.[0];
  const content = page?.revisions?.[0]?.slots?.main?.content;
  if (!content) throw new Error(`Could not load ${title}`);
  return content;
}

function parseSkinModule(source, sourceInfo) {
  const champions = parseImmediateTableEntries(extractReturnTable(source));
  const records = [];

  for (const championEntry of champions) {
    const champion = championEntry.key;
    const skinsTable = extractPropertyTable(championEntry.block, 'skins');
    if (!skinsTable) continue;

    const skins = parseImmediateTableEntries(skinsTable);
    for (const skinEntry of skins) {
      const skinName = skinEntry.key;
      const meta = {
        release: extractStringProperty(skinEntry.block, 'release'),
        formatname: extractStringProperty(skinEntry.block, 'formatname'),
        availability: extractStringProperty(skinEntry.block, 'availability'),
      };
      const displayName = buildDisplayName(champion, skinName, meta.formatname);
      const expectedFilename = buildExpectedFilename(champion, skinName, sourceInfo.type === 'Wild Rift');
      const canonicalNames = new Set([
        ...canonicalNameVariants(skinName, champion),
        ...canonicalNameVariants(displayName, champion),
        ...(meta.formatname ? canonicalNameVariants(meta.formatname, champion) : []),
      ]);

      records.push({
        champion,
        skinName,
        displayName,
        type: sourceInfo.type,
        platform: sourceInfo.platform,
        releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(meta.release || '') ? meta.release : '',
        availability: meta.availability || '',
        expectedFilename,
        lookupKey: `${sourceInfo.platform}::${normalize(champion)}::${normalize(skinName)}`,
        canonicalNames: [...canonicalNames],
      });
    }
  }

  return records;
}

function isEligibleSkin(record, date) {
  const availability = normalize(record.availability);
  if (availability.includes('canceled') || availability.includes('cancelled')) return false;
  if (record.releaseDate && record.releaseDate > date.toISOString().slice(0, 10)) return false;
  if (!record.releaseDate && availability.includes('upcoming')) return false;
  return true;
}

function buildDisplayName(champion, skinName, formatname) {
  if (skinName === 'Original') return `Classic ${champion}`;
  if (formatname) return formatname;
  return `${skinName} ${champion}`;
}

function buildExpectedFilename(champion, skinName, isWildRift) {
  const championToken = wikiFileToken(champion);
  const skinToken = skinName === 'Original' ? 'Original' : wikiFileToken(skinName);
  return `${championToken}_${skinToken}Skin${isWildRift ? '_WR' : ''}.jpg`;
}

async function resolvePredictedFiles(records) {
  const map = new Map();
  const byTitle = new Map();
  for (const record of records) {
    const title = `File:${record.expectedFilename}`;
    const titleKey = normalizeTitleKey(title);
    if (!byTitle.has(titleKey)) byTitle.set(titleKey, { title, records: [] });
    byTitle.get(titleKey).records.push(record);
  }

  const titles = [...byTitle.values()].map((entry) => entry.title);
  for (let index = 0; index < titles.length; index += 50) {
    const batch = titles.slice(index, index + 50);
    const url = new URL(WIKI_API);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|size|mime');
    url.searchParams.set('titles', batch.join('|'));
    const data = await fetchJson(url.href, true);
    for (const page of data?.query?.pages || []) {
      const info = page?.imageinfo?.[0];
      if (!info?.url) continue;
      const requested = byTitle.get(normalizeTitleKey(page.title))?.records || [];
      for (const record of requested) {
        map.set(record.lookupKey, {
          url: info.url,
          width: info.width || 0,
          height: info.height || 0,
          isHd: /_HD\.(?:jpe?g|png|webp)$/i.test(page.title),
          title: page.title,
        });
      }
    }
  }
  return map;
}

async function searchWikiSplash(record, allowHd) {
  const cacheKey = `${record.lookupKey}:${allowHd ? 'hd' : 'std'}`;
  searchWikiSplash.cache ||= new Map();
  if (searchWikiSplash.cache.has(cacheKey)) return searchWikiSplash.cache.get(cacheKey);

  const promise = (async () => {
    const query = `${record.champion} ${record.skinName} Skin${record.type === 'Wild Rift' ? ' WR' : ''}`;
    const searchUrl = new URL(WIKI_API);
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('formatversion', '2');
    searchUrl.searchParams.set('list', 'search');
    searchUrl.searchParams.set('srnamespace', '6');
    searchUrl.searchParams.set('srlimit', '30');
    searchUrl.searchParams.set('srsearch', query);
    const searchData = await fetchJson(searchUrl.href, true);
    const titles = (searchData?.query?.search || []).map((item) => item.title).filter(Boolean);
    if (!titles.length) return null;

    const candidates = [];
    for (let index = 0; index < titles.length; index += 50) {
      const batch = titles.slice(index, index + 50);
      const infoUrl = new URL(WIKI_API);
      infoUrl.searchParams.set('action', 'query');
      infoUrl.searchParams.set('format', 'json');
      infoUrl.searchParams.set('formatversion', '2');
      infoUrl.searchParams.set('prop', 'imageinfo');
      infoUrl.searchParams.set('iiprop', 'url|size|mime');
      infoUrl.searchParams.set('titles', batch.join('|'));
      const infoData = await fetchJson(infoUrl.href, true);
      for (const page of infoData?.query?.pages || []) {
        const info = page?.imageinfo?.[0];
        if (!info?.url) continue;
        const score = scoreSplashTitle(page.title, record, allowHd);
        if (score < 0) continue;
        candidates.push({
          title: page.title,
          url: info.url,
          width: info.width || 0,
          height: info.height || 0,
          isHd: /_HD\.(?:jpe?g|png|webp)$/i.test(page.title),
          score,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score || (b.width * b.height) - (a.width * a.height));
    return candidates[0] || null;
  })();

  searchWikiSplash.cache.set(cacheKey, promise);
  return promise;
}

function scoreSplashTitle(title, record, allowHd) {
  const raw = String(title || '').replace(/^File:/i, '');
  const lower = raw.toLowerCase();
  if (!/\.(?:jpe?g|png|webp)$/i.test(raw)) return -1;
  if (/loading|circle|square|tile|icon|concept|unused/i.test(raw)) return -1;
  const isHd = /_HD\.(?:jpe?g|png|webp)$/i.test(raw);
  if (isHd !== allowHd) return -1;
  if (/\bold\d*\b/i.test(raw)) return -1;

  const wantsWr = record.type === 'Wild Rift';
  const hasWr = /(?:_|\s)WR(?:_|\.|\s)/i.test(raw) || /wild.?rift/i.test(raw);
  if (wantsWr !== hasWr) return -1;

  const titleToken = normalizeCompact(raw.replace(/\.[^.]+$/, '').replace(/_HD$/i, '').replace(/_WR$/i, ''));
  const championToken = normalizeCompact(wikiFileToken(record.champion));
  const skinToken = normalizeCompact(record.skinName === 'Original' ? 'Original' : wikiFileToken(record.skinName));
  if (!titleToken.includes(championToken) || !titleToken.includes(skinToken)) return -1;

  const recordText = normalize(`${record.skinName} ${record.displayName}`);
  const titleText = normalize(lower.replace(/[_-]+/g, ' '));
  for (const term of SENSITIVE_TERMS) {
    if (recordText.includes(term) !== titleText.includes(term)) return -1;
  }

  const wantsChroma = /chroma/i.test(record.skinName);
  if (!wantsChroma && /chroma/i.test(raw)) return -1;
  if (wantsChroma && !/chroma/i.test(raw)) return -1;

  let score = 100;
  if (normalizeCompact(raw).includes(normalizeCompact(record.expectedFilename))) score += 100;
  if (/Skin(?:_WR)?(?:_HD)?\.(?:jpe?g|png|webp)$/i.test(raw)) score += 30;
  return score;
}

function insertCatalogItem(catalogArray, item) {
  let insertAt = -1;
  for (let index = catalogArray.length - 1; index >= 0; index -= 1) {
    if (normalize(catalogArray[index]?.champ) === normalize(item.champ)) {
      insertAt = index + 1;
      break;
    }
  }
  catalogArray.splice(insertAt >= 0 ? insertAt : catalogArray.length, 0, item);
}

function extractReturnTable(source) {
  const match = /\breturn\s*\{/.exec(source);
  if (!match) throw new Error('Lua module has no return table');
  const open = source.indexOf('{', match.index);
  const close = findMatchingBrace(source, open);
  return source.slice(open, close + 1);
}

function extractPropertyTable(block, property) {
  const regex = new RegExp(`\\["${escapeRegExp(property)}"\\]\\s*=\\s*\\{`);
  const match = regex.exec(block);
  if (!match) return null;
  const open = block.indexOf('{', match.index);
  const close = findMatchingBrace(block, open);
  return block.slice(open, close + 1);
}

function extractStringProperty(block, property) {
  const regex = new RegExp(`\\["${escapeRegExp(property)}"\\]\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const match = regex.exec(block);
  if (!match) return '';
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseImmediateTableEntries(tableText) {
  const entries = [];
  let index = 1;
  let depth = 1;

  while (index < tableText.length - 1) {
    const skipped = skipTrivia(tableText, index);
    index = skipped.index;
    if (index >= tableText.length - 1) break;

    const char = tableText[index];
    if (char === '"' || char === "'") {
      index = skipString(tableText, index);
      continue;
    }
    if (char === '{') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      index += 1;
      continue;
    }

    if (depth === 1 && tableText.startsWith('["', index)) {
      const keyEnd = findStringEnd(tableText, index + 1);
      if (keyEnd > index) {
        const rawKey = tableText.slice(index + 2, keyEnd);
        let cursor = keyEnd + 1;
        cursor = skipWhitespace(tableText, cursor);
        if (tableText[cursor] === ']') cursor += 1;
        cursor = skipWhitespace(tableText, cursor);
        if (tableText[cursor] === '=') cursor += 1;
        cursor = skipWhitespace(tableText, cursor);
        if (tableText[cursor] === '{') {
          const close = findMatchingBrace(tableText, cursor);
          entries.push({ key: rawKey.replace(/\\"/g, '"').replace(/\\\\/g, '\\'), block: tableText.slice(cursor, close + 1) });
          index = close + 1;
          continue;
        }
      }
    }

    index += 1;
  }
  return entries;
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const skipped = skipTrivia(text, index);
    if (skipped.index !== index) {
      index = skipped.index - 1;
      continue;
    }
    const char = text[index];
    if (char === '"' || char === "'") {
      index = skipString(text, index) - 1;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unbalanced Lua table near index ${openIndex}`);
}

function skipTrivia(text, index) {
  let cursor = index;
  while (cursor < text.length) {
    if (/\s/.test(text[cursor])) {
      cursor += 1;
      continue;
    }
    if (text.startsWith('--[[', cursor)) {
      const end = text.indexOf(']]', cursor + 4);
      cursor = end >= 0 ? end + 2 : text.length;
      continue;
    }
    if (text.startsWith('--', cursor)) {
      const end = text.indexOf('\n', cursor + 2);
      cursor = end >= 0 ? end + 1 : text.length;
      continue;
    }
    break;
  }
  return { index: cursor };
}

function skipString(text, quoteIndex) {
  const end = findStringEnd(text, quoteIndex);
  return end >= quoteIndex ? end + 1 : text.length;
}

function findStringEnd(text, quoteIndex) {
  const quote = text[quoteIndex];
  for (let index = quoteIndex + 1; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1;
      continue;
    }
    if (text[index] === quote) return index;
  }
  return -1;
}

function skipWhitespace(text, index) {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

async function fetchJson(url, soft = false) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    } finally {
      clearTimeout(timeout);
    }
  }
  if (soft) {
    console.warn(`Wiki request failed: ${url} (${lastError?.message || lastError})`);
    return {};
  }
  throw lastError;
}

function wikiFileToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '');
}

function slugify(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeCompact(value = '') {
  return normalize(value).replace(/\s+/g, '');
}

function normalizeTitleKey(value = '') {
  return String(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
