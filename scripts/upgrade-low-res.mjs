import fs from 'node:fs';
import sharp from 'sharp';

const REPORT_FILE = 'audit-report.json';
const OVERRIDES_FILE = 'data/image-overrides.json';
const WIKI_API = 'https://wiki.leagueoflegends.com/en-us/api.php';
const USER_AGENT = 'lol-skins-quality-upgrader/1.1 (+https://github.com/fabiandrt3-png/lol-skins)';
const TIMEOUT_MS = 20000;
const MIN_FULLSCREEN_WIDTH = 1600;
const MIN_FULLSCREEN_HEIGHT = 900;
const QUALITY_TARGET_WIDTH = 2560;
const QUALITY_TARGET_HEIGHT = 1440;
const MIN_GAIN = 1.05;
const infoCache = new Map();

const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
const overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
const qualityCandidates = report.entries.filter((entry) => entry.best && (
  entry.best.width < QUALITY_TARGET_WIDTH || entry.best.height < QUALITY_TARGET_HEIGHT
));

let upgraded = 0;
let unchanged = 0;

for (const entry of qualityCandidates) {
  const better = await findHigherResolutionExact(entry);
  if (!better) {
    unchanged += 1;
    console.log(`· ${entry.champion} — ${entry.skin}: meilleur original exact non trouvé au-dessus de ${entry.best.width}x${entry.best.height}`);
    continue;
  }

  const currentArea = entry.best.width * entry.best.height;
  const newArea = better.width * better.height;
  if (newArea < currentArea * MIN_GAIN) {
    unchanged += 1;
    continue;
  }

  const previous = overrides.entries[entry.id];
  overrides.entries[entry.id] = {
    url: better.url,
    width: better.width,
    height: better.height,
    bytes: better.bytes,
    source: 'league-wiki-higher-resolution-original',
    verifiedAt: new Date().toISOString(),
    fallbacks: unique([previous?.url, ...(previous?.fallbacks || [])]).filter((url) => url && url !== better.url).slice(0, 5),
  };

  entry.validCandidates = uniqueCandidates([
    { ...better, source: 'league-wiki-higher-resolution-original', semantic: 'exact-quality-upgrade', area: newArea },
    ...(entry.validCandidates || []),
  ]);
  entry.best = { ...better, source: 'league-wiki-higher-resolution-original', semantic: 'exact-quality-upgrade', area: newArea };
  entry.qualityUpgraded = true;
  upgraded += 1;
  console.log(`↑ ${entry.champion} — ${entry.skin}: ${Math.round(currentArea / 1e6 * 10) / 10}MP → ${Math.round(newArea / 1e6 * 10) / 10}MP (${better.width}x${better.height})`);
}

report.summary = summarize(report.entries);
report.qualityPass = {
  runAt: new Date().toISOString(),
  target: `${QUALITY_TARGET_WIDTH}x${QUALITY_TARGET_HEIGHT}`,
  candidatesBelowTargetBefore: qualityCandidates.length,
  upgraded,
  unchanged,
  remainingBelowTarget: countBelow(report.entries, QUALITY_TARGET_WIDTH, QUALITY_TARGET_HEIGHT),
};
overrides.generatedAt = new Date().toISOString();
overrides.qualityPolicy = 'Exact skin identity first; highest verified pixel area second. Search for a higher-resolution exact original below the 2560x1440 fullscreen target. Never substitute a different skin/chroma/edition merely for more pixels.';

fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2) + '\n');

console.log(JSON.stringify(report.qualityPass, null, 2));

async function findHigherResolutionExact(entry) {
  const titles = new Set();
  for (const query of searchQueries(entry)) {
    for (const title of await wikiSearch(query)) titles.add(title.replace(/^File:/i, ''));
  }

  const ranked = [...titles]
    .map((title) => ({ title, ...scoreTitle(title, entry) }))
    .filter((item) => item.accept)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  const probed = [];
  for (const item of ranked) {
    const info = await imageInfo(item.title);
    if (!info) continue;
    const image = await probe(info.url, info.width, info.height);
    if (!image) continue;
    probed.push({ ...image, title: item.title, score: item.score });
  }

  if (!probed.length) return null;
  return probed.sort((a, b) => (b.width * b.height) - (a.width * a.height) || b.score - a.score)[0];
}

function searchQueries(entry) {
  const clean = cleanSkinName(entry.skin, entry.champion);
  const platform = entry.type === 'Wild Rift' ? ' Wild Rift' : '';
  return unique([
    `${entry.champion} ${clean}${platform}`,
    `${entry.champion} ${clean} skin${platform}`,
    `${entry.champion} ${clean} splash${platform}`,
  ]);
}

async function wikiSearch(query) {
  const url = new URL(WIKI_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srnamespace', '6');
  url.searchParams.set('srlimit', '30');
  url.searchParams.set('srsearch', query);
  const payload = await fetchJson(url.href, true);
  return (payload?.query?.search || []).map((item) => item.title);
}

function scoreTitle(title, entry) {
  const raw = String(title).replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '');
  const text = normalize(raw);
  const championTokens = significantTokens(entry.champion);
  const skinText = cleanSkinName(entry.skin, entry.champion);
  let skinTokens = significantTokens(skinText);

  if (/^classic\b/i.test(entry.skin)) skinTokens = ['original'];
  if (!skinTokens.length) skinTokens = significantTokens(entry.skin);

  const isWrCandidate = /(?:^|\b)(wr|wild rift)(?:\b|$)/.test(text);
  const wantsWr = entry.type === 'Wild Rift';
  if (wantsWr && !isWrCandidate) return { accept: false, score: -999 };
  if (!wantsWr && isWrCandidate) return { accept: false, score: -999 };

  const entryChroma = /chroma/i.test(entry.skin);
  const candidateChroma = /chroma/.test(text);
  if (entryChroma !== candidateChroma && candidateChroma) return { accept: false, score: -999 };

  if (/loading|square|icon|portrait|tile|model|render|ability|emote|chromas?\b/.test(text) && !entryChroma) {
    return { accept: false, score: -999 };
  }

  const championMatches = championTokens.filter((token) => text.includes(token));
  if (championTokens.length && championMatches.length < championTokens.length) return { accept: false, score: -999 };

  const matchedSkin = skinTokens.filter((token) => text.includes(token));
  const required = Math.max(1, Math.ceil(skinTokens.length * 0.8));
  if (matchedSkin.length < required) return { accept: false, score: -999 };

  const sensitiveTerms = ['prestige', 'special', 'edition', 'exquisite', 'mythic', 'select'];
  for (const term of sensitiveTerms) {
    const wanted = normalize(entry.skin).includes(term);
    const present = text.includes(term);
    if (wanted && !present) return { accept: false, score: -999 };
  }

  let score = championMatches.length * 5 + matchedSkin.length * 5;
  if (/\bskin\b/.test(text)) score += 2;
  if (/\bhd\b/.test(text)) score += 2;
  if (wantsWr && isWrCandidate) score += 6;
  if (matchedSkin.length === skinTokens.length) score += 10;
  return { accept: true, score };
}

function cleanSkinName(value, champion) {
  return String(value || '')
    .replace(/\(Wild Rift\)/gi, ' ')
    .replace(new RegExp(`\\b${escapeRegExp(champion)}\\b`, 'ig'), ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(value) {
  const stop = new Set(['skin', 'league', 'legends', 'wild', 'rift', 'the', 'of', 'and', 'a', 'an']);
  return normalize(value).split(' ').filter((token) => token.length > 1 && !stop.has(token));
}

async function imageInfo(filename) {
  if (infoCache.has(filename)) return infoCache.get(filename);
  const promise = (async () => {
    const url = new URL(WIKI_API);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|size');
    url.searchParams.set('titles', `File:${filename}`);
    const payload = await fetchJson(url.href, true);
    const info = payload?.query?.pages?.[0]?.imageinfo?.[0];
    return info?.url ? { url: info.url, width: info.width || null, height: info.height || null } : null;
  })().catch(() => null);
  infoCache.set(filename, promise);
  return promise;
}

async function probe(url, knownWidth, knownHeight) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'image/*,*/*;q=0.8' },
    });
    if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    let width = knownWidth;
    let height = knownHeight;
    if (!width || !height) {
      const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
      width = metadata.width;
      height = metadata.height;
    }
    if (!width || !height) return null;
    return { url: response.url || url, width, height, bytes: buffer.length, contentType: response.headers.get('content-type') || 'image/unknown' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, optional = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': USER_AGENT, accept: 'application/json,*/*;q=0.8' } });
    if (!response.ok) {
      if (optional) return null;
      throw new Error(`${response.status} ${url}`);
    }
    return await response.json();
  } catch (error) {
    if (optional) return null;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function summarize(entries) {
  const unresolved = entries.filter((entry) => !entry.verified);
  const wr = entries.filter((entry) => entry.type === 'Wild Rift');
  const pc = entries.filter((entry) => entry.type !== 'Wild Rift');
  const lowRes = entries.filter((entry) => entry.best && (
    entry.best.width < MIN_FULLSCREEN_WIDTH || entry.best.height < MIN_FULLSCREEN_HEIGHT
  ));
  const belowQualityTarget = entries.filter((entry) => entry.best && (
    entry.best.width < QUALITY_TARGET_WIDTH || entry.best.height < QUALITY_TARGET_HEIGHT
  ));
  const degraded = entries.filter((entry) => entry.degraded);
  return {
    total: entries.length,
    verified: entries.length - unresolved.length,
    unresolved: unresolved.length,
    pcTotal: pc.length,
    pcVerified: pc.filter((entry) => entry.verified).length,
    wildRiftTotal: wr.length,
    wildRiftVerified: wr.filter((entry) => entry.verified).length,
    wildRiftUnresolved: wr.filter((entry) => !entry.verified).length,
    degradedFallbacks: degraded.length,
    below1600x900: lowRes.length,
    below2560x1440: belowQualityTarget.length,
    unresolvedEntries: unresolved.map((entry) => ({ champion: entry.champion, skin: entry.skin, type: entry.type })),
    degradedEntries: degraded.map((entry) => ({ champion: entry.champion, skin: entry.skin, type: entry.type, best: entry.best })),
    lowResolutionEntries: lowRes.map((entry) => ({ champion: entry.champion, skin: entry.skin, type: entry.type, best: entry.best })),
  };
}

function countBelow(entries, width, height) {
  return entries.filter((entry) => entry.best && (entry.best.width < width || entry.best.height < height)).length;
}

function unique(values) { return [...new Set(values.filter(Boolean))]; }
function uniqueCandidates(values) {
  const seen = new Set();
  return values.filter((item) => item?.url && !seen.has(item.url) && seen.add(item.url));
}
function normalize(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
