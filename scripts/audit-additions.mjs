import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const CATALOG_FILE = path.join(ROOT, 'data', 'image-overrides.json');
const REPORT_FILE = path.join(ROOT, 'addition-audit-report.json');
const USER_AGENT = 'lol-skins-additions-audit/1.0 (+https://github.com/fabiandrt3-png/lol-skins)';
const TIMEOUT_MS = 20000;
const CONCURRENCY = 8;
const cache = new Map();

const payload = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
const catalog = Array.isArray(payload?.catalog) ? payload.catalog : [];
const entries = catalog.filter((entry) => entry?.sourceKind && entry.sourceKind !== 'legacy');

if (!entries.length) {
  throw new Error('No non-legacy additions found in data/image-overrides.json');
}

const tasks = entries.map((entry) => async () => auditEntry(entry));
const results = await runPool(tasks, Math.min(CONCURRENCY, Math.max(tasks.length, 1)));
const unresolved = results.filter((item) => !item.card.ok || !item.fullscreen.ok);
const lowCard = results.filter((item) => item.card.ok && (item.card.width < 1215 || item.card.height < 675));
const lowFullscreen = results.filter((item) => item.fullscreen.ok && (item.fullscreen.width < 1600 || item.fullscreen.height < 900));

const summary = {
  total: results.length,
  fullyVerified: results.length - unresolved.length,
  unresolved: unresolved.length,
  pc: results.filter((item) => item.type !== 'Wild Rift').length,
  wildRift: results.filter((item) => item.type === 'Wild Rift').length,
  belowCardTarget: lowCard.length,
  belowFullscreenTarget: lowFullscreen.length,
};

fs.writeFileSync(REPORT_FILE, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'data/image-overrides.json#catalog',
  summary,
  unresolved: unresolved.map(({ champion, skin, type, card, fullscreen }) => ({ champion, skin, type, card, fullscreen })),
  lowCard: lowCard.map(({ champion, skin, card }) => ({ champion, skin, card })),
  lowFullscreen: lowFullscreen.map(({ champion, skin, fullscreen }) => ({ champion, skin, fullscreen })),
  entries: results,
}, null, 2) + '\n');

console.log(JSON.stringify(summary, null, 2));
if (unresolved.length) {
  console.error(`ADDITION AUDIT FAILED: ${unresolved.length} entry/entries have no valid card or fullscreen splash.`);
  process.exitCode = 2;
}

async function auditEntry(entry) {
  const cardCandidates = unique([entry.image, ...(entry.fallbacks || [])]);
  const fullscreenCandidates = unique([entry.fullImage, ...(entry.fullHdFallbacks || []), ...cardCandidates]);
  const card = await firstWorking(cardCandidates);
  const fullscreen = await bestWorking(fullscreenCandidates);
  const result = {
    id: entry.id,
    champion: entry.champ,
    skin: entry.skin,
    type: entry.type || 'PC',
    releaseDate: entry.releaseDate || null,
    sourceKind: entry.sourceKind || null,
    card,
    fullscreen,
  };
  console.log(`${card.ok && fullscreen.ok ? '✓' : '✗'} ${entry.champ} — ${entry.skin} | card ${describe(card)} | full ${describe(fullscreen)}`);
  return result;
}

async function firstWorking(candidates) {
  for (const url of candidates) {
    const result = await probe(url);
    if (result) return { ok: true, ...result };
  }
  return { ok: false, attempted: candidates };
}

async function bestWorking(candidates) {
  const probes = (await Promise.all(candidates.map(probe))).filter(Boolean);
  if (!probes.length) return { ok: false, attempted: candidates };
  probes.sort((a, b) => (b.width * b.height) - (a.width * a.height));
  return { ok: true, ...probes[0] };
}

async function probe(url) {
  if (!url) return null;
  if (!cache.has(url)) cache.set(url, fetchImage(url));
  return cache.get(url);
}

async function fetchImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' },
    });
    if (!response.ok) return null;
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (!type.startsWith('image/')) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return null;
    const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
    if (!metadata.width || !metadata.height) return null;
    return {
      url: response.url || url,
      width: metadata.width,
      height: metadata.height,
      bytes: buffer.length,
      contentType: type,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function describe(result) {
  return result.ok ? `${result.width}x${result.height}` : 'unresolved';
}
