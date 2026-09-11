import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUTPUT_FILE = path.join(ROOT, 'data', 'lor-skins.json');
const USER_AGENT = 'lol-skins-lor-skins/1.0 (+https://github.com/fabiandrt3-png/lol-skins)';
const TIMEOUT_MS = 30000;
const RIOT_DOCS = 'https://developer.riotgames.com/docs/lor';
const SKIN_METADATA_SOURCE = 'https://leagueoflegends.fandom.com/wiki/Module:LoRCosmetics/skins?action=raw';
const WIKI_API = 'https://wiki.leagueoflegends.com/en-us/api.php';
const WIKI_FILE_REDIRECT = 'https://wiki.leagueoflegends.com/en-us/Special:Redirect/file/';

const SETS = [
  source('set1', '1_0_0'),
  source('set2', '1_0_0'),
  source('set3', '1_8_0'),
  source('set4', '2_3_0'),
  source('set5', '2_14_0'),
  source('set6'),
  source('set6cde', '4_2_0'),
  source('set7', '4_3_0'),
  source('set7b', '4_6_0'),
  source('set8', '4_9_0'),
  source('set9', '5_4_0'),
];

const cardMap = new Map();
const loadedSets = [];

for (const set of SETS) {
  const loaded = await firstJson(set.urls);
  if (!loaded) {
    console.warn(`LoR ${set.name}: no Data Dragon endpoint available`);
    continue;
  }

  const cards = Array.isArray(loaded.payload) ? loaded.payload : [];
  loadedSets.push({ name: set.name, url: loaded.url, cards: cards.length });
  for (const card of cards) {
    if (!card?.cardCode) continue;
    cardMap.set(card.cardCode, card);
  }
}

if (!cardMap.size) throw new Error('No official LoR cards could be loaded.');

const rawMetadata = await fetchText(SKIN_METADATA_SOURCE);
if (!rawMetadata) throw new Error('LoR skin metadata source is unavailable.');

const parsedSkins = parseSkinModule(rawMetadata, cardMap);
if (!parsedSkins.length) throw new Error('No LoR champion skins could be parsed.');

const wikiFileNames = unique(parsedSkins.flatMap((skin) => skin.levels.flatMap((level) =>
  candidateWikiFiles(level.cardCode, skin.skinName)
)));
const wikiInfo = await loadWikiFileInfo(wikiFileNames);

const entries = [];
for (const skin of parsedSkins) {
  for (const level of skin.levels) {
    const card = cardMap.get(level.cardCode);
    const normalFiles = normalWikiFiles(level.cardCode, skin.skinName);
    const hdFiles = hdWikiFiles(level.cardCode, skin.skinName);
    const exactWikiCandidates = candidateWikiFiles(level.cardCode, skin.skinName)
      .map((filename) => ({ filename, ...(wikiInfo.get(filename) || {}) }))
      .filter((item) => item.url);

    const officialFull = skin.skinName === 'Original' ? officialFullArt(card) : null;
    const cardCandidates = unique([
      officialFull,
      ...normalFiles.map((filename) => wikiInfo.get(filename)?.url || wikiRedirect(filename)),
    ]);

    const fullscreenCandidates = unique([
      ...exactWikiCandidates
        .sort((a, b) => pixelArea(b) - pixelArea(a) || filePreference(b.filename) - filePreference(a.filename))
        .map((item) => item.url),
      officialFull,
      ...hdFiles.map(wikiRedirect),
      ...normalFiles.map(wikiRedirect),
    ]);

    const image = cardCandidates[0] || fullscreenCandidates[0];
    if (!image) continue;

    const levelNumber = parseLevelNumber(level.levelName);
    const displayName = skin.skinName === 'Original'
      ? `Original ${skin.champion} — ${level.levelName}`
      : `${skin.skinName} ${skin.champion} — ${level.levelName}`;

    entries.push({
      id: `lor::${slugify(skin.champion)}::${slugify(skin.skinName)}::${slugify(level.levelName)}`,
      champ: skin.champion,
      skin: displayName,
      type: 'Legends of Runeterra',
      releaseDate: skin.releaseDate || null,
      image,
      ...(fullscreenCandidates[0] ? { fullImage: fullscreenCandidates[0] } : {}),
      ...(cardCandidates.length > 1 ? { fallbacks: cardCandidates.slice(1) } : {}),
      ...(fullscreenCandidates.length > 1 ? { fullHdFallbacks: fullscreenCandidates.slice(1) } : {}),
      sourceKind: 'lor',
      lorSkinName: skin.skinName,
      lorLevel: level.levelName,
      lorLevelNumber: levelNumber,
      lorSkinIndex: skin.skinIndex,
      lorCardCode: level.cardCode,
      lorAvailability: skin.availability || null,
    });
  }
}

entries.sort(compareEntries);

const previous = readJson(OUTPUT_FILE, {});
const stableNext = {
  source: 'Riot Games LoR Data Dragon + League of Legends Wiki LoR cosmetics metadata',
  sourceDocs: RIOT_DOCS,
  metadataSource: SKIN_METADATA_SOURCE,
  strategy: 'LoR champion skins are first-class gallery entries. Skins are ordered by release date, then skin index, then champion level. Card previews use the exact original/full artwork; fullscreen prefers the highest verified exact HD file when available.',
  sets: loadedSets.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })),
  entries,
};
const stablePrevious = {
  source: previous?.source,
  sourceDocs: previous?.sourceDocs,
  metadataSource: previous?.metadataSource,
  strategy: previous?.strategy,
  sets: previous?.sets || [],
  entries: previous?.entries || [],
};

if (JSON.stringify(stableNext) === JSON.stringify(stablePrevious)) {
  console.log(`LoR skin catalog unchanged: ${entries.length} level artworks across ${countSkins(entries)} skins.`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
  generatedAt: new Date().toISOString(),
  ...stableNext,
}, null, 2) + '\n');

const akshan = entries.filter((entry) => entry.champ === 'Akshan');
console.log(`LoR skin catalog updated: ${entries.length} level artworks across ${countSkins(entries)} skins.`);
if (akshan.length) console.log(`Akshan: ${akshan.map((entry) => entry.skin).join(' > ')}`);

function source(name, version = '') {
  const urls = [`https://dd.b.pvp.net/latest/${name}/en_us/data/${name}-en_us.json`];
  if (version) urls.push(`https://dd.b.pvp.net/${version}/${name}/en_us/data/${name}-en_us.json`);
  return { name, urls };
}

async function firstJson(urls) {
  for (const url of urls) {
    const payload = await fetchJson(url);
    if (payload) return { url, payload };
  }
  return null;
}

async function fetchJson(url) {
  const text = await fetchText(url, 'application/json,*/*;q=0.8');
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return null; }
}

async function fetchText(url, accept = 'text/plain,text/*;q=0.9,*/*;q=0.8') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseSkinModule(text, cards) {
  const championBlocks = namedBlocks(text, (name) => /^\d{2}[A-Z]{2}\d{3}$/.test(name));
  const result = [];

  for (const championBlock of championBlocks) {
    const baseCard = cards.get(championBlock.name);
    if (!baseCard || !isChampionUnit(baseCard)) continue;
    const champion = baseCard.name;
    const skins = namedBlocks(championBlock.body, (name) => !/^\d{2}[A-Z]{2}\d{3}$/.test(name));

    for (const skinBlock of skins) {
      const releaseDate = stringField(skinBlock.body, 'release');
      const skinIndex = numberField(skinBlock.body, 'idx') ?? 9999;
      const availability = stringField(skinBlock.body, 'availability');
      const associated = namedTableBlock(skinBlock.body, 'associatedCards');
      if (!associated) continue;

      const levels = parseAssociatedLevels(associated.body)
        .filter((level) => cards.has(level.cardCode) && isChampionUnit(cards.get(level.cardCode)));
      if (!levels.length) continue;

      result.push({
        champion,
        baseCardCode: championBlock.name,
        skinName: skinBlock.name,
        skinIndex,
        releaseDate,
        availability,
        levels,
      });
    }
  }

  return result.sort((a, b) =>
    a.champion.localeCompare(b.champion, 'en', { sensitivity: 'base' })
    || compareDates(a.releaseDate, b.releaseDate)
    || a.skinIndex - b.skinIndex
    || a.skinName.localeCompare(b.skinName, 'en', { sensitivity: 'base' })
  );
}

function parseAssociatedLevels(body) {
  const blocks = anonymousBlocks(body);
  const result = [];
  for (const block of blocks) {
    const cardCode = stringField(block, 'cardcode');
    const levelName = stringField(block, 'name');
    if (!cardCode || !/^Level\s+\d+/i.test(levelName || '')) continue;
    result.push({ cardCode, levelName: normalizeLevelName(levelName) });
  }
  return uniqueBy(result, (item) => `${item.cardCode}|${item.levelName}`)
    .sort((a, b) => parseLevelNumber(a.levelName) - parseLevelNumber(b.levelName));
}

function namedBlocks(text, predicate = () => true) {
  const blocks = [];
  const re = /\[\s*["']([^"']+)["']\s*\]\s*=\s*\{/g;
  let match;
  while ((match = re.exec(text))) {
    const name = match[1];
    if (!predicate(name)) continue;
    const openIndex = match.index + match[0].lastIndexOf('{');
    if (braceDepthAt(text, openIndex) !== 0) continue;
    const closeIndex = findMatchingBrace(text, openIndex);
    if (closeIndex < 0) continue;
    blocks.push({ name, body: text.slice(openIndex + 1, closeIndex) });
    re.lastIndex = closeIndex + 1;
  }
  return blocks;
}

function namedTableBlock(text, field) {
  const re = new RegExp(`\\[\\s*["']${escapeRegExp(field)}["']\\s*\\]\\s*=\\s*\\{`, 'i');
  const match = re.exec(text);
  if (!match) return null;
  const openIndex = match.index + match[0].lastIndexOf('{');
  const closeIndex = findMatchingBrace(text, openIndex);
  if (closeIndex < 0) return null;
  return { body: text.slice(openIndex + 1, closeIndex) };
}

function anonymousBlocks(text) {
  const blocks = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{' || braceDepthAt(text, index) !== 0) continue;
    const closeIndex = findMatchingBrace(text, index);
    if (closeIndex < 0) break;
    blocks.push(text.slice(index + 1, closeIndex));
    index = closeIndex;
  }
  return blocks;
}

function braceDepthAt(text, index) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < index; i += 1) {
    const char = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
  }
  return depth;
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '-' && next === '-') { lineComment = true; i += 1; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stringField(text, field) {
  const re = new RegExp(`\\[\\s*["']${escapeRegExp(field)}["']\\s*\\]\\s*=\\s*["']([^"']*)["']`, 'i');
  return re.exec(text)?.[1]?.trim() || null;
}

function numberField(text, field) {
  const re = new RegExp(`\\[\\s*["']${escapeRegExp(field)}["']\\s*\\]\\s*=\\s*(\\d+)`, 'i');
  const value = re.exec(text)?.[1];
  return value == null ? null : Number(value);
}

function candidateWikiFiles(cardCode, skinName) {
  return unique([...hdWikiFiles(cardCode, skinName), ...normalWikiFiles(cardCode, skinName)]);
}

function hdWikiFiles(cardCode, skinName) {
  if (skinName === 'Original') return [`${cardCode}-HD-full.jpg`];
  return [`${cardCode} ${skinName}-HD-full.jpg`];
}

function normalWikiFiles(cardCode, skinName) {
  if (skinName === 'Original') return [`${cardCode}-full.png`];
  return [
    `${cardCode} ${skinName}-full.png`,
    `${cardCode} ${skinName}-alt-full.png`,
  ];
}

async function loadWikiFileInfo(filenames) {
  const result = new Map();
  const chunks = chunk(filenames, 40);
  for (const names of chunks) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'imageinfo',
      iiprop: 'url|size',
      titles: names.map((name) => `File:${name}`).join('|'),
    });
    const payload = await fetchJson(`${WIKI_API}?${params.toString()}`);
    for (const page of payload?.query?.pages || []) {
      const title = String(page?.title || '').replace(/^File:/i, '');
      const info = page?.imageinfo?.[0];
      if (!title || !info?.url) continue;
      result.set(title, {
        url: secureUrl(info.url),
        width: Number(info.width) || 0,
        height: Number(info.height) || 0,
        bytes: Number(info.size) || 0,
      });
    }
  }
  return result;
}

function officialFullArt(card) {
  for (const asset of card?.assets || []) {
    const url = secureUrl(asset?.fullAbsolutePath);
    if (url) return url;
  }
  return null;
}

function isChampionUnit(card) {
  return normalize(card?.type) === 'unit' && normalize(card?.supertype) === 'champion';
}

function wikiRedirect(filename) {
  return `${WIKI_FILE_REDIRECT}${encodeURIComponent(filename)}`;
}

function pixelArea(item) {
  return (Number(item?.width) || 0) * (Number(item?.height) || 0);
}

function filePreference(filename = '') {
  if (/-HD-full\.jpg$/i.test(filename)) return 3;
  if (/-full\.png$/i.test(filename) && !/-alt-full\.png$/i.test(filename)) return 2;
  if (/-alt-full\.png$/i.test(filename)) return 1;
  return 0;
}

function compareEntries(a, b) {
  return a.champ.localeCompare(b.champ, 'en', { sensitivity: 'base' })
    || compareDates(a.releaseDate, b.releaseDate)
    || Number(a.lorSkinIndex ?? 9999) - Number(b.lorSkinIndex ?? 9999)
    || Number(a.lorLevelNumber ?? 9999) - Number(b.lorLevelNumber ?? 9999)
    || a.skin.localeCompare(b.skin, 'en', { sensitivity: 'base' });
}

function compareDates(a, b) {
  const left = /^\d{4}-\d{2}-\d{2}$/.test(a || '') ? a : '9999-12-31';
  const right = /^\d{4}-\d{2}-\d{2}$/.test(b || '') ? b : '9999-12-31';
  return left.localeCompare(right);
}

function parseLevelNumber(value = '') {
  return Number(String(value).match(/\d+/)?.[0]) || 9999;
}

function normalizeLevelName(value = '') {
  const number = parseLevelNumber(value);
  return Number.isFinite(number) && number !== 9999 ? `Level ${number}` : String(value).trim();
}

function secureUrl(url) {
  if (!url) return null;
  return String(url).replace(/^http:\/\//i, 'https://');
}

function countSkins(entries) {
  return new Set(entries.map((entry) => `${entry.champ}|${entry.lorSkinName}`)).size;
}

function chunk(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
