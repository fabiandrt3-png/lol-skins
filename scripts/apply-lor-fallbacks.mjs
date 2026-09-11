import fs from 'node:fs';
import path from 'node:path';
import { loadLorArtIndex, lorCandidatesForEntry } from './lor-art-source.mjs';

const ROOT = process.cwd();
const OVERRIDES_FILE = path.join(ROOT, 'data', 'image-overrides.json');
const REPORT_FILE = path.join(ROOT, 'audit-report.json');
const VERSION_FILE = path.join(ROOT, 'version.json');
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

  const urls = unique(lor.map((candidate) => candidate.url));
  const before = JSON.stringify(override.lorFallbacks || []);
  override.lorFallbacks = urls;
  if (JSON.stringify(override.lorFallbacks) !== before) changedEntries += 1;
  linkedCandidates += urls.length;
}

for (const item of payload.catalog || []) {
  const lor = lorCandidatesForEntry(item, lorIndex).slice(0, MAX_LOR_FALLBACKS);
  if (!lor.length) continue;

  const urls = unique(lor.map((candidate) => candidate.url));
  const before = JSON.stringify(item.lorFallbacks || []);

  // Dedicated field on purpose: data-loader appends these after every LoL/WR
  // candidate, so LoR can never outrank a healthy native splash.
  item.lorFallbacks = urls;

  if (JSON.stringify(item.lorFallbacks) !== before) changedCatalog += 1;
}

payload.lorArt = {
  source: lorIndex.source || 'Riot Games — Legends of Runeterra Data Dragon',
  generatedAt: lorIndex.generatedAt || null,
  championsIndexed: Object.keys(lorIndex.champions || {}).length,
  policy: 'secondary official fallback; native LoL/WR sources always remain first; exact skin matches require explicit curation',
};

const changed = changedEntries > 0 || changedCatalog > 0;
if (changed) {
  payload.generatedAt = new Date().toISOString();
  fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(payload, null, 2) + '\n');
  bumpVersion();
}

console.log(JSON.stringify({
  lorChampionsIndexed: Object.keys(lorIndex.champions || {}).length,
  changedEntries,
  changedCatalog,
  linkedCandidates,
  versionBumped: changed,
}, null, 2));

function bumpVersion() {
  const payload = readJson(VERSION_FILE, {});
  const current = String(payload?.version || '');
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const match = current.match(/^(\d{8})-(\d+)$/);
  const next = match && match[1] === today
    ? `${today}-${Number(match[2]) + 1}`
    : `${today}-1`;
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: next }, null, 2) + '\n');
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}
