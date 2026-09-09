import fs from 'node:fs';
import sharp from 'sharp';

const REPORT = 'audit-report.json';
const OVERRIDES = 'data/image-overrides.json';
const WIKI_API = 'https://wiki.leagueoflegends.com/en-us/api.php';
const UA = 'lol-skins-wild-rift-resolver/1.0 (+https://github.com/fabiandrt3-png/lol-skins)';
const TIMEOUT = 20000;
const infoCache = new Map();

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const overrideMap = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'));
const unresolved = report.entries.filter((e) => !e.verified && e.type === 'Wild Rift');

for (const entry of unresolved) {
  const result = await resolveEntry(entry);
  if (!result) {
    console.error(`✗ WR unresolved: ${entry.champion} — ${entry.skin}`);
    continue;
  }
  console.log(`✓ WR repaired: ${entry.champion} — ${entry.skin} → ${result.width}x${result.height} ${result.url}`);
  overrideMap.entries[entry.id] = {
    url: result.url,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    source: 'league-wiki-search-wild-rift',
    verifiedAt: new Date().toISOString(),
    fallbacks: [],
  };
  entry.verified = true;
  entry.degraded = false;
  entry.best = {
    url: result.url,
    source: 'league-wiki-search-wild-rift',
    semantic: 'exact-search',
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    contentType: result.contentType,
    area: result.width * result.height,
  };
  entry.validCandidates = [entry.best];
  entry.resolvedByWikiSearch = true;
}

report.summary = summarize(report.entries);
report.repairedAt = new Date().toISOString();
overrideMap.generatedAt = new Date().toISOString();
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(OVERRIDES, JSON.stringify(overrideMap, null, 2) + '\n');

console.log(JSON.stringify(report.summary, null, 2));
if (report.summary.unresolved > 0) process.exitCode = 2;

async function resolveEntry(entry) {
  const names = filenameVariants(entry.legacyUrl);
  const direct = [];
  for (const name of names) {
    const info = await imageInfo(name);
    if (info) direct.push({ ...info, score: scoreTitle(name, entry) + 100 });
  }
  if (direct.length) return await chooseVerified(direct, entry);

  const titles = new Set();
  for (const query of searchQueries(entry)) {
    const results = await wikiSearch(query);
    for (const title of results) titles.add(title.replace(/^File:/i, ''));
  }

  const ranked = [...titles]
    .map((title) => ({ title, score: scoreTitle(title, entry) }))
    .filter((x) => x.score >= 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  const candidates = [];
  for (const item of ranked) {
    const info = await imageInfo(item.title);
    if (info) candidates.push({ ...info, score: item.score });
  }
  return await chooseVerified(candidates, entry);
}

function filenameVariants(url = '') {
  let filename = '';
  try { filename = decodeURIComponent(url.split('/').pop() || '').split('?')[0]; }
  catch { filename = (url.split('/').pop() || '').split('?')[0]; }
  if (!filename) return [];
  const stem = filename.replace(/\.(jpg|jpeg|png|webp)$/i, '');
  const ext = filename.match(/\.(jpg|jpeg|png|webp)$/i)?.[0] || '.jpg';
  const variants = new Set([filename]);
  variants.add(`${stem.replace(/_HD$/i, '')}${ext}`);
  variants.add(`${stem.replace(/_WR_HD$/i, '_WR')}${ext}`);
  variants.add(`${stem.replace(/_HD$/i, '')}.png`);
  variants.add(`${stem.replace(/_WR_HD$/i, '_WR')}.png`);
  return [...variants];
}

function searchQueries(entry) {
  const skin = stripAnnotations(entry.skin);
  const withoutChampion = skin.replace(new RegExp(`\\b${escapeRegExp(entry.champion)}\\b`, 'ig'), ' ').replace(/\s+/g, ' ').trim();
  return [
    `${entry.champion} ${withoutChampion} WR`,
    `${entry.champion} ${withoutChampion} Wild Rift`,
    `${entry.champion} ${withoutChampion}`,
  ];
}

async function wikiSearch(query) {
  const url = new URL(WIKI_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srnamespace', '6');
  url.searchParams.set('srlimit', '25');
  url.searchParams.set('srsearch', query);
  const payload = await fetchJson(url.href);
  return (payload?.query?.search || []).map((x) => x.title);
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
    return info?.url ? { url: info.url, width: info.width || null, height: info.height || null, filename } : null;
  })().catch(() => null);
  infoCache.set(filename, promise);
  return promise;
}

async function chooseVerified(candidates, entry) {
  const sorted = candidates
    .filter((c) => c.url)
    .sort((a, b) => (b.score - a.score) || ((b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)));

  for (const candidate of sorted) {
    if (scoreTitle(candidate.filename || candidate.url, entry) < 8 && candidate.score < 100) continue;
    const verified = await probe(candidate.url, candidate.width, candidate.height);
    if (verified) return verified;
  }
  return null;
}

function scoreTitle(title, entry) {
  const text = normalize(title.replace(/^File:/i, ''));
  const champ = normalize(entry.champion);
  const skin = normalize(stripAnnotations(entry.skin));
  const skinNoChamp = skin.replace(new RegExp(`\\b${escapeRegExp(champ)}\\b`, 'g'), ' ').replace(/\s+/g, ' ').trim();
  const wanted = new Set((`${champ} ${skinNoChamp}`).split(' ').filter((t) => t.length > 1));
  let score = 0;
  for (const token of wanted) if (text.includes(token)) score += token.length >= 5 ? 3 : 2;
  if (text.includes(champ)) score += 4;
  if (/\bwr\b/.test(text) || text.includes('wild rift')) score += 5;
  if (text.includes('skin')) score += 1;
  if (text.includes('hd')) score += 1;
  if (/loading|square|icon|chrom|model|render|ability|emote/.test(text)) score -= 8;
  return score;
}

async function probe(url, knownWidth, knownHeight) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'user-agent': UA, accept: 'image/*,*/*;q=0.8' } });
    if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    let width = knownWidth;
    let height = knownHeight;
    if (!width || !height) {
      const meta = await sharp(buffer, { failOn: 'none' }).metadata();
      width = meta.width;
      height = meta.height;
    }
    if (!width || !height) return null;
    return { url: response.url || url, width, height, bytes: buffer.length, contentType: response.headers.get('content-type') || 'image/unknown' };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function fetchJson(url, optional = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': UA, accept: 'application/json,*/*;q=0.8' } });
    if (!response.ok) {
      if (optional) return null;
      throw new Error(`${response.status} ${url}`);
    }
    return await response.json();
  } catch (e) {
    if (optional) return null;
    throw e;
  } finally { clearTimeout(timer); }
}

function summarize(entries) {
  const unresolved = entries.filter((e) => !e.verified);
  const wr = entries.filter((e) => e.type === 'Wild Rift');
  const pc = entries.filter((e) => e.type !== 'Wild Rift');
  const low = entries.filter((e) => e.best && (e.best.width < 1600 || e.best.height < 900));
  const degraded = entries.filter((e) => e.degraded);
  return {
    total: entries.length,
    verified: entries.length - unresolved.length,
    unresolved: unresolved.length,
    pcTotal: pc.length,
    pcVerified: pc.filter((e) => e.verified).length,
    wildRiftTotal: wr.length,
    wildRiftVerified: wr.filter((e) => e.verified).length,
    wildRiftUnresolved: wr.filter((e) => !e.verified).length,
    degradedFallbacks: degraded.length,
    below1600x900: low.length,
    unresolvedEntries: unresolved.map((e) => ({ champion: e.champion, skin: e.skin, type: e.type })),
    degradedEntries: degraded.map((e) => ({ champion: e.champion, skin: e.skin, type: e.type, best: e.best })),
    lowResolutionEntries: low.map((e) => ({ champion: e.champion, skin: e.skin, type: e.type, best: e.best })),
  };
}

function stripAnnotations(value = '') { return String(value).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(); }
function normalize(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
