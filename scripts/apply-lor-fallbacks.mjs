import fs from 'node:fs';
import path from 'node:path';
import { loadLorArtIndex, lorCandidatesForEntry } from './lor-art-source.mjs';

const ROOT = process.cwd();
const OVERRIDES_FILE = path.join(ROOT, 'data', 'image-overrides.json');
const REPORT_FILE = path.join(ROOT, 'audit-report.json');
const MAX_LOR_FALLBACKS = 3;

const payload = readJson(OVERRIDES_FILE, { entries: {}, catalog: [] });
const report = readJson(REPORT_FILE, { entries: [] });
const lorIndex = loadLorArtIndex();
const reportById = new Map((report.entries || []).map((entry) => [entry.id, entry]));

let changedEntries = 0;
let changedCatalog = 0;
let linkedCandidates = 0;

for (const [id, override] of Object.entries(payload.entries || {})) {
  const reportEntry = reportById.get(id);
  if (!reportEntry) continue;

  const lor = lorCandidatesForEntry({
    id,
    champ: reportEntry.champion,
    skin: reportEntry.skin,
    type: reportEntry.type,
  }, lorIndex).slice(0, MAX_LOR_FALLBACKS);
  if (!lor.length) continue;

  const urls = lor.map((candidate) => candidate.url);
  const before = JSON.stringify(override.fallbacks || []);
  override.fallbacks = appendUnique(override.fallbacks, urls, 10, override.url);
  override.lorFallbacks = urls;
  if (JSON.stringify(override.fallbacks) !== before) changedEntries += 1;
  linkedCandidates += urls.length;
}

for (const item of payload.catalog || []) {
  const lor = lorCandidatesForEntry(item, lorIndex).slice(0, MAX_LOR_FALLBACKS);
  if (!lor.length) continue;

  const urls = lor.map((candidate) => candidate.url);
  const beforeCard = JSON.stringify(item.fallbacks || []);
  const beforeFull = JSON.stringify(item.fullHdFallbacks || []);

  // Keep the original LoL/Wild Rift art first. LoR is an official alternate-art
  // fallback and must not silently replace a healthy skin splash.
  item.fallbacks = appendUnique(item.fallbacks, urls, 10, item.image);
  item.fullHdFallbacks = appendUnique(item.fullHdFallbacks, urls, 10, item.fullImage);
  item.lorFallbacks = urls;

  if (JSON.stringify(item.fallbacks) !== beforeCard || JSON.stringify(item.fullHdFallbacks) !== beforeFull) {
    changedCatalog += 1;
  }
}

payload.lorArt = {
  source: lorIndex.source || 'Riot Games — Legends of Runeterra Data Dragon',
  generatedAt: lorIndex.generatedAt || null,
  championsIndexed: Object.keys(lorIndex.champions || {}).length,
  policy: 'secondary official fallback; exact skin matches require explicit curation',
};

if (changedEntries || changedCatalog) {
  payload.generatedAt = new Date().toISOString();
  fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(payload, null, 2) + '\n');
}

console.log(JSON.stringify({
  lorChampionsIndexed: Object.keys(lorIndex.champions || {}).length,
  changedEntries,
  changedCatalog,
  linkedCandidates,
}, null, 2));

function appendUnique(existing, extra, limit, primary) {
  const result = [];
  const seen = new Set(primary ? [primary] : []);
  for (const value of [...(existing || []), ...(extra || [])]) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
