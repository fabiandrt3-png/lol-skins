import fs from 'node:fs';
import path from 'node:path';

const TARGET = path.resolve('data/image-overrides.json');
const USER_AGENT = 'lol-skins-quality-preserver/1.0 (+https://github.com/fabiandrt3-png/lol-skins)';
const baselines = process.argv.slice(2);

if (!baselines.length) {
  throw new Error('Usage: node scripts/preserve-audit-quality.mjs <baseline file or URL> [...]');
}

const current = readJson(TARGET, { entries: {}, catalog: [] });
let restored = 0;
let compared = 0;

for (const source of baselines) {
  const baseline = await loadJson(source);
  for (const [id, previous] of Object.entries(baseline?.entries || {})) {
    const live = current?.entries?.[id];
    if (!live || !previous) continue;
    compared += 1;

    const previousArea = imageArea(previous);
    const liveArea = imageArea(live);
    if (!previousArea || previousArea <= liveArea) continue;

    current.entries[id] = {
      ...previous,
      ...(Array.isArray(live.lorFallbacks) && live.lorFallbacks.length
        ? { lorFallbacks: live.lorFallbacks }
        : {}),
      qualityPreservedAt: new Date().toISOString(),
    };
    restored += 1;
    console.log(`↑ preserved ${id}: ${live.width || '?'}x${live.height || '?'} → ${previous.width || '?'}x${previous.height || '?'}`);
  }
}

if (restored) {
  current.generatedAt = new Date().toISOString();
  current.qualityPreservation = {
    checkedAt: current.generatedAt,
    baselines: baselines.map(describeSource),
    compared,
    restored,
    rule: 'Never replace an already verified splash with a lower-pixel-area source during automated audits.',
  };
  fs.writeFileSync(TARGET, JSON.stringify(current, null, 2) + '\n');
}

console.log(JSON.stringify({ compared, restored }, null, 2));

function imageArea(entry) {
  const width = Number(entry?.width || 0);
  const height = Number(entry?.height || 0);
  return width > 0 && height > 0 ? width * height : 0;
}

async function loadJson(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'application/json,*/*;q=0.8' },
    });
    if (!response.ok) throw new Error(`Baseline ${response.status}: ${source}`);
    return response.json();
  }
  return readJson(path.resolve(source), {});
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function describeSource(source) {
  if (!/^https?:\/\//i.test(source)) return path.basename(source);
  try {
    const url = new URL(source);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return source;
  }
}
