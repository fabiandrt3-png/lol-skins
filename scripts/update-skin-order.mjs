import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { metadataKey, normalizeName, skinTheme } from '../catalog-order.js';
import { extractReturnTable, parseImmediateTableEntries, fields, strings } from './wiki-skin-metadata.mjs';

const SOURCES = [
  ['Module:SkinData/data', 'pc-skins.lua', 'PC'],
  ['Module:SkinDataWR/data', 'wr-skins.lua', 'Wild Rift'],
  ['Module:SkinData/universes', 'skin-universes.lua'],
  ['Module:LoRCosmetics/skins', 'lor-skins-api.json.lua', 'Legends of Runeterra'],
];
const ALIASES = [
  ['Ashe', 'Glorious Admiral Ashe', 'Glorious Armada Ashe'],
  ['Diana', 'Immortal Journey Diana', 'Serene Sword Diana'],
  ['Dr. Mundo', 'Splendor Opus Mundo', 'Splendor Opus Dr. Mundo'],
  ['Jayce', 'Love Confession Jayce', 'Confession Melody Jayce'],
  ['Mel', 'Love Confession Mel', 'Confession Melody Mel'],
];

export function buildOrderMetadata(texts, catalog, lorSkins) {
  const groups = parseImmediateTableEntries(extractReturnTable(texts['Module:SkinData/universes']));
  if (groups.length < 100) throw new Error('Incomplete universe source; existing metadata retained.');
  const universesByLine = new Map();
  for (const group of groups) for (const line of strings(group.block)) {
    const key = normalizeName(line);
    if (!universesByLine.has(key)) universesByLine.set(key, []);
    universesByLine.get(key).push(group.key);
  }
  const entries = {};
  const readInfo = (block, canonicalSkin) => {
    const data = fields(block);
    const skinLines = strings(data.set?.table);
    return {
      ...(typeof data.release === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.release) ? { releaseDate: data.release } : {}),
      ...(!data.release && data.availability ? { releaseStatus: data.availability } : {}),
      canonicalSkin,
      ...(skinLines.length ? { skinLines, universes: [...new Set(skinLines.flatMap((line) => universesByLine.get(normalizeName(line)) || [line]))] } : {}),
    };
  };
  const counts = {};
  for (const [title, , type] of SOURCES.slice(0, 2)) {
    let count = 0;
    for (const champion of parseImmediateTableEntries(extractReturnTable(texts[title]))) {
      const skins = fields(champion.block).skins?.table;
      if (!skins) continue;
      for (const skin of parseImmediateTableEntries(skins)) {
        const data = fields(skin.block);
        const displayName = skin.key === 'Original' ? `Classic ${champion.key}` : data.formatname || `${skin.key} ${champion.key}`;
        const item = { champ: champion.key, skin: displayName, type };
        const info = readInfo(skin.block, skinTheme(item));
        entries[metadataKey(item)] = info;
        // Include both the formatted client name and the wiki's skin key.
        entries[metadataKey({ ...item, skin: `${skin.key} ${champion.key}` })] = info;
        count++;
      }
    }
    if (count < (type === 'PC' ? 2000 : 900)) throw new Error(`Incomplete ${type} source; existing metadata retained.`);
    counts[type] = count;
  }
  const championByCard = new Map(lorSkins.map((skin) => [skin.lorCardCode, skin.champ]));
  let lorCount = 0;
  for (const champion of parseImmediateTableEntries(extractReturnTable(texts['Module:LoRCosmetics/skins']))) {
    const champ = championByCard.get(champion.key);
    if (!champ) continue;
    for (const skin of parseImmediateTableEntries(champion.block)) {
      const item = { champ, skin: `${skin.key} ${champ}`, type: 'Legends of Runeterra' };
      entries[metadataKey(item)] = readInfo(skin.block, skinTheme(item));
      lorCount++;
    }
  }
  if (lorCount < 240) throw new Error('Incomplete LoR source; existing metadata retained.');
  counts['Legends of Runeterra'] = lorCount;

  for (const [champ, oldName, newName] of ALIASES) {
    const info = entries[metadataKey({ champ, skin: newName, type: 'Wild Rift' })];
    if (info) entries[metadataKey({ champ, skin: oldName, type: 'Wild Rift' })] = { ...info, isAlias: true };
  }

  // Chromas use their parent's universe, but never invent a chroma release date.
  // A dated parent is sufficient to place an undated chroma immediately after it.
  const missing = [];
  for (const item of [...catalog, ...lorSkins]) {
    const key = metadataKey(item);
    if (entries[key]) continue;
    if (/\bchroma\b/i.test(item.skin)) {
      const parentName = item.skin.replace(/\s*\([^)]*chroma[^)]*\)\s*/ig, '').trim();
      const parent = entries[metadataKey({ ...item, skin: parentName })];
      if (parent) {
        const { releaseDate, canonicalSkin, ...family } = parent;
        entries[key] = { ...family, parentSkin: parentName };
        continue;
      }
    }
    // New named editions can inherit a verified family's universe without
    // inheriting its date or being treated as the same skin.
    const baseName = item.skin.replace(/^Ascended\s+/i, '').replace(/\s+Ancient Wisdom\b/i, '');
    const base = entries[metadataKey({ ...item, skin: baseName })];
    if (base && baseName !== item.skin) {
      entries[key] = { skinLines: base.skinLines || [], universes: base.universes || [] };
    } else missing.push({ id: item.id, champ: item.champ, skin: item.skin });
  }
  return {
    schemaVersion: 1,
    sources: SOURCES.map(([title]) => `https://wiki.leagueoflegends.com/en-us/${title}`),
    sourceCounts: counts,
    entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b, 'en'))),
    unmatched: missing,
  };
}

async function main() {
  const sourceIndex = process.argv.indexOf('--source-dir');
  const sourceDirectory = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : null;
  const texts = {};
  for (const [title, filename] of SOURCES) {
    if (sourceDirectory) texts[title] = fs.readFileSync(path.join(sourceDirectory, filename), 'utf8');
    else {
      const url = new URL('https://wiki.leagueoflegends.com/en-us/api.php');
      Object.entries({ action: 'query', format: 'json', formatversion: '2', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: title }).forEach(([k, v]) => url.searchParams.set(k, v));
      const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'lol-skins-order/1.0 (+https://github.com/fabiandrt3-png/lol-skins)' } });
      if (!response.ok) throw new Error(`${title}: HTTP ${response.status}`);
      const data = await response.json();
      const page = data.query?.pages?.find((entry) => entry.title === title);
      const content = page?.revisions?.[0]?.slots?.main?.content;
      if (!content) throw new Error(`Missing source ${title}; existing metadata retained.`);
      texts[title] = content;
    }
  }
  const catalog = JSON.parse(fs.readFileSync('data/image-overrides.json', 'utf8')).catalog;
  const lor = JSON.parse(fs.readFileSync('data/lor-skins.json', 'utf8')).entries;
  const next = buildOrderMetadata(texts, catalog, lor);
  const overrides = JSON.parse(fs.readFileSync('data/skin-order-overrides.json', 'utf8'));
  for (const [key, info] of Object.entries(overrides.entries || {})) {
    // Prefer the upstream release date once its missing field is completed.
    next.entries[key] = { ...info, ...(next.entries[key] || {}) };
  }
  const fixes = 'data/skin-artwork-corrections.json';
  if (fs.existsSync(fixes)) next.artworkOverrides = JSON.parse(fs.readFileSync(fixes, 'utf8')).artworkOverrides;
  const visualDuplicates = 'data/skin-visual-duplicates.json';
  if (fs.existsSync(visualDuplicates)) next.artworkEquivalences = JSON.parse(fs.readFileSync(visualDuplicates, 'utf8')).artworkEquivalences;
  const file = 'data/skin-order.json';
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const { generatedAt, ...stablePrevious } = previous;
  if (!isDeepStrictEqual(stablePrevious, next)) {
    // Keep one entry per line for readable diffs without shipping indentation.
    const { entries, ...header } = { generatedAt: new Date().toISOString(), ...next };
    const lines = Object.entries(entries).map(([key, info]) => `    ${JSON.stringify(key)}: ${JSON.stringify(info)}`);
    fs.writeFileSync(file, JSON.stringify(header, null, 2).slice(0, -2) + ',\n  "entries": {\n' + lines.join(',\n') + '\n  }\n}\n');
  }
  console.log(JSON.stringify({ metadata: Object.keys(next.entries).length, sources: next.sourceCounts, unmatched: next.unmatched }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
