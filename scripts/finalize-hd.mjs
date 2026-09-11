import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OVERRIDES_FILE = path.join(ROOT, 'data', 'image-overrides.json');
const REPORT_FILE = path.join(ROOT, 'audit-report.json');
const ADDITION_REPORT_FILE = path.join(ROOT, 'addition-audit-report.json');
const VERSION_FILE = path.join(ROOT, 'version.json');
const WIKI_API = 'https://wiki.leagueoflegends.com/en-us/api.php';
const USER_AGENT = 'lol-skins-final-hd-validator/1.0 (+https://github.com/fabiandrt3-png/lol-skins)';
const TIMEOUT_MS = 25000;
const CONCURRENCY = 8;
const SENSITIVE_TERMS = ['prestige', 'select', 'special', 'edition', 'exquisite', 'mythic'];

const overrides = readJson(OVERRIDES_FILE, { entries: {}, catalog: [] });
const report = readJson(REPORT_FILE, { entries: [] });
const additions = readJson(ADDITION_REPORT_FILE, { entries: [] });
const catalog = Array.isArray(overrides.catalog) ? overrides.catalog : [];
const historical = Array.isArray(report.entries) ? report.entries : [];
const additionEntries = Array.isArray(additions.entries) ? additions.entries : [];
const additionById = new Map(additionEntries.map((entry) => [entry.id, entry]));
const infoCache = new Map();
const searchCache = new Map();

const stats = {
  runAt: new Date().toISOString(),
  historicalSearched: 0,
  historicalRecoveredHigher: 0,
  catalogSearched: 0,
  catalogRecoveredHigher: 0,
  cardFallbacksRepaired: 0,
  stillUnresolved: 0,
};
let changed = false;

const historicalTargets = historical.filter((entry) => {
  const current = overrides.entries?.[entry.id];
  return current && (
    /^league-wiki-(?:wr-)?hd-maximum$/.test(current.source || '')
    || Number(current.width || 0) < 2560
    || Number(current.height || 0) < 1440
  );
});

await runPool(historicalTargets.map((entry) => async () => {
  stats.historicalSearched += 1;
  const current = overrides.entries?.[entry.id];
  if (!current) return;
  const best = await findExactWikiMaximum(entry);
  if (!best || area(best) <= area(current)) return;

  overrides.entries[entry.id] = {
    ...current,
    url: best.url,
    width: best.width,
    height: best.height,
    bytes: best.bytes ?? current.bytes ?? null,
    source: 'league-wiki-searched-maximum',
    verifiedAt: new Date().toISOString(),
    fallbacks: unique([current.url, ...(current.fallbacks || [])]).filter((url) => url !== best.url).slice(0, 8),
  };
  entry.best = { ...best, source: 'league-wiki-searched-maximum', semantic: 'exact-quality-upgrade', area: area(best) };
  entry.validCandidates = uniqueCandidates([entry.best, ...(entry.validCandidates || [])]);
  entry.verified = true;
  entry.qualityUpgraded = true;
  stats.historicalRecoveredHigher += 1;
  changed = true;
  console.log(`↑ recovered ${entry.champion} — ${entry.skin}: ${current.width}x${current.height} → ${best.width}x${best.height}`);
}), CONCURRENCY);

const catalogTargets = catalog.filter((item) => {
  if (!item?.champ || !item?.skin || item.sourceKind === 'legacy') return false;
  const audit = additionById.get(item.id);
  return Boolean(item.hdSource || !audit?.card?.ok || !audit?.fullscreen?.ok || Number(audit?.fullscreen?.width || 0) < 2560 || Number(audit?.fullscreen?.height || 0) < 1440);
});

await runPool(catalogTargets.map((item) => async () => {
  stats.catalogSearched += 1;
  const entry = { champion: item.champ, skin: item.skin, type: item.type || 'PC' };
  const audit = additionById.get(item.id);
  const best = await findExactWikiMaximum(entry);

  let bestFullscreen = best;
  if (!bestFullscreen && audit?.fullscreen?.ok && item.fullImage) {
    bestFullscreen = {
      url: item.fullImage,
      width: audit.fullscreen.width,
      height: audit.fullscreen.height,
      bytes: audit.fullscreen.bytes ?? null,
      mime: audit.fullscreen.contentType || 'image/jpeg',
      title: wikiFilename(item.fullImage),
    };
  }
  if (!bestFullscreen) return;

  const currentArea = Number(audit?.fullscreen?.width || 0) * Number(audit?.fullscreen?.height || 0);
  if (best?.url && area(best) > currentArea && item.fullImage !== best.url) {
    item.fullHdFallbacks = unique([item.fullImage, ...(item.fullHdFallbacks || [])]).filter((url) => url && url !== best.url).slice(0, 8);
    item.fullImage = best.url;
    item.hdSource = 'league-wiki-searched-maximum';
    item.hdVerifiedAt = new Date().toISOString();
    stats.catalogRecoveredHigher += 1;
    changed = true;
    console.log(`↑ recent ${item.champ} — ${item.skin}: ${audit?.fullscreen?.width || '?'}x${audit?.fullscreen?.height || '?'} → ${best.width}x${best.height}`);
  }

  if (audit && (!audit.fullscreen?.ok || area(bestFullscreen) > currentArea)) {
    audit.fullscreen = {
      ok: true,
      url: bestFullscreen.url,
      width: bestFullscreen.width,
      height: bestFullscreen.height,
      bytes: bestFullscreen.bytes ?? null,
      contentType: bestFullscreen.mime || 'image/jpeg',
    };
  }

  if (audit && !audit.card?.ok) {
    const standard = await standardCounterpart(bestFullscreen);
    const card = standard || bestFullscreen;
    const previousImage = item.image;
    if (standard?.url) {
      item.image = standard.url;
      item.fallbacks = unique([previousImage, ...(item.fallbacks || []), bestFullscreen.url]).filter((url) => url && url !== standard.url).slice(0, 8);
      item.cardSource = 'league-wiki-standard-repaired';
    } else {
      item.fallbacks = unique([...(item.fallbacks || []), bestFullscreen.url]).filter((url) => url && url !== item.image).slice(0, 8);
      item.cardSource = 'league-wiki-hd-fallback';
    }
    item.cardVerifiedAt = new Date().toISOString();
    audit.card = {
      ok: true,
      url: card.url,
      width: card.width,
      height: card.height,
      bytes: card.bytes ?? null,
      contentType: card.mime || 'image/jpeg',
    };
    stats.cardFallbacksRepaired += 1;
    changed = true;
    console.log(`↳ repaired card ${item.champ} — ${item.skin}: ${card.width}x${card.height}${standard ? ' standard' : ' HD fallback'}`);
  }
}), CONCURRENCY);

const additionSummary = summarizeAdditions(additionEntries);
additions.summary = additionSummary.summary;
additions.unresolved = additionSummary.unresolved;
additions.lowCard = additionSummary.lowCard;
additions.lowFullscreen = additionSummary.lowFullscreen;
stats.stillUnresolved = additionSummary.unresolved.length;
additions.finalHdPass = stats;
report.summary = summarizeHistorical(historical);
report.finalHdPass = stats;
overrides.finalHdPass = stats;
overrides.generatedAt = new Date().toISOString();

fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2) + '\n');
fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(ADDITION_REPORT_FILE, JSON.stringify(additions, null, 2) + '\n');
if (changed) bumpVersion();
console.log(JSON.stringify({ changed, ...stats, additionSummary: additions.summary, historicalSummary: report.summary }, null, 2));

async function findExactWikiMaximum(entry) {
  const key = `${entry.type || 'PC'}|${entry.champion}|${entry.skin}`;
  if (searchCache.has(key)) return searchCache.get(key);
  const promise = (async () => {
    const clean = cleanSkinName(entry.skin, entry.champion);
    const queries = unique([`${entry.champion} ${clean}`, `${entry.champion} ${clean} skin`, `${entry.champion} ${clean} HD`]);
    const titles = new Set();
    for (const query of queries) {
      const url = new URL(WIKI_API);
      url.searchParams.set('action', 'query');
      url.searchParams.set('format', 'json');
      url.searchParams.set('formatversion', '2');
      url.searchParams.set('list', 'search');
      url.searchParams.set('srnamespace', '6');
      url.searchParams.set('srlimit', '25');
      url.searchParams.set('srsearch', query);
      const payload = await fetchJson(url.href, true);
      for (const result of payload?.query?.search || []) titles.add(result.title);
    }

    const candidates = [];
    const list = [...titles].slice(0, 60);
    for (let i = 0; i < list.length; i += 50) {
      const url = new URL(WIKI_API);
      url.searchParams.set('action', 'query');
      url.searchParams.set('format', 'json');
      url.searchParams.set('formatversion', '2');
      url.searchParams.set('prop', 'imageinfo');
      url.searchParams.set('iiprop', 'url|size|mime');
      url.searchParams.set('titles', list.slice(i, i + 50).join('|'));
      const payload = await fetchJson(url.href, true);
      for (const page of payload?.query?.pages || []) {
        const info = page?.imageinfo?.[0];
        if (!info?.url || !info.width || !info.height) continue;
        const candidate = { title: String(page.title || '').replace(/^File:/i, ''), url: info.url, width: info.width, height: info.height, bytes: info.size || null, mime: info.mime || null };
        if (isExactCandidate(candidate.title, entry)) candidates.push(candidate);
      }
    }
    candidates.sort((a, b) => area(b) - area(a) || oldPenalty(a.title) - oldPenalty(b.title));
    return candidates[0] || null;
  })();
  searchCache.set(key, promise);
  return promise;
}

function isExactCandidate(title, entry) {
  const text = normalize(String(title || '').replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, ''));
  if (!/(?:^|\s)hd(?:\s|$)/.test(text)) return false;
  const wantsWr = entry.type === 'Wild Rift';
  const candidateWr = /(?:^|\s)wr(?:\s|$)/.test(text) || /wild rift/.test(text);
  if (wantsWr !== candidateWr) return false;
  if (tokens(entry.champion).some((token) => !text.includes(token))) return false;
  let skinTokens = tokens(cleanSkinName(entry.skin, entry.champion));
  if (/^classic(?:\s|$)/i.test(String(entry.skin || ''))) skinTokens = ['original'];
  if (!skinTokens.length) return false;
  const entryText = normalize(entry.skin);
  for (const term of SENSITIVE_TERMS) if (entryText.includes(term) !== text.includes(term)) return false;
  const wantsChroma = /chroma/i.test(entry.skin || '');
  if (wantsChroma !== /\bchroma\b/.test(text)) return false;
  return skinTokens.every((token) => text.includes(token));
}

async function standardCounterpart(best) {
  const filename = best?.title || wikiFilename(best?.url || '');
  if (!filename) return null;
  const standard = filename.replace(/_HD(?=\.(?:jpe?g|png|webp)$)/i, '');
  if (standard === filename) return null;
  return imageInfo(standard);
}

async function imageInfo(filename) {
  if (!filename) return null;
  if (infoCache.has(filename)) return infoCache.get(filename);
  const promise = (async () => {
    const url = new URL(WIKI_API);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|size|mime');
    url.searchParams.set('titles', `File:${filename}`);
    const payload = await fetchJson(url.href, true);
    const page = payload?.query?.pages?.[0];
    const info = page?.imageinfo?.[0];
    if (!info?.url || !info.width || !info.height) return null;
    return { title: String(page.title || `File:${filename}`).replace(/^File:/i, ''), url: info.url, width: info.width, height: info.height, bytes: info.size || null, mime: info.mime || null };
  })().catch(() => null);
  infoCache.set(filename, promise);
  return promise;
}

function summarizeAdditions(entries) {
  const unresolved = entries.filter((entry) => !entry.card?.ok || !entry.fullscreen?.ok);
  const lowCard = entries.filter((entry) => entry.card?.ok && (entry.card.width < 1215 || entry.card.height < 675));
  const lowFullscreen = entries.filter((entry) => entry.fullscreen?.ok && (entry.fullscreen.width < 1600 || entry.fullscreen.height < 900));
  return {
    summary: { total: entries.length, fullyVerified: entries.length - unresolved.length, unresolved: unresolved.length, pc: entries.filter((entry) => entry.type !== 'Wild Rift').length, wildRift: entries.filter((entry) => entry.type === 'Wild Rift').length, belowCardTarget: lowCard.length, belowFullscreenTarget: lowFullscreen.length },
    unresolved: unresolved.map(({ champion, skin, type, card, fullscreen }) => ({ champion, skin, type, card, fullscreen })),
    lowCard: lowCard.map(({ champion, skin, card }) => ({ champion, skin, card })),
    lowFullscreen: lowFullscreen.map(({ champion, skin, fullscreen }) => ({ champion, skin, fullscreen })),
  };
}

function summarizeHistorical(entries) {
  const unresolved = entries.filter((entry) => !entry.verified);
  const wr = entries.filter((entry) => entry.type === 'Wild Rift');
  const pc = entries.filter((entry) => entry.type !== 'Wild Rift');
  const low = entries.filter((entry) => entry.best && (entry.best.width < 1600 || entry.best.height < 900));
  const below = entries.filter((entry) => entry.best && (entry.best.width < 2560 || entry.best.height < 1440));
  return { total: entries.length, verified: entries.length - unresolved.length, unresolved: unresolved.length, pcTotal: pc.length, pcVerified: pc.filter((entry) => entry.verified).length, wildRiftTotal: wr.length, wildRiftVerified: wr.filter((entry) => entry.verified).length, wildRiftUnresolved: wr.filter((entry) => !entry.verified).length, degradedFallbacks: entries.filter((entry) => entry.degraded).length, below1600x900: low.length, below2560x1440: below.length, unresolvedEntries: unresolved.map((entry) => ({ champion: entry.champion, skin: entry.skin, type: entry.type })) };
}

async function runPool(tasks, concurrency) {
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= tasks.length) return;
      await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(tasks.length, 1)) }, () => worker()));
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

function cleanSkinName(value, champion) {
  return String(value || '').replace(/\(Wild Rift\)/gi, ' ').replace(new RegExp(`\\b${escapeRegExp(champion)}\\b`, 'ig'), ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(value) {
  const stop = new Set(['skin', 'league', 'legends', 'wild', 'rift', 'the', 'of', 'and', 'a', 'an', 'chroma']);
  return normalize(value).split(' ').filter((token) => token.length > 1 && !stop.has(token));
}
function wikiFilename(url) {
  const raw = String(url || '').split('/').pop()?.split(/[?#]/)[0] || '';
  try { return decodeURIComponent(raw); } catch { return raw; }
}
function oldPenalty(title) { return /\bold\d*\b/i.test(String(title || '')) ? 1 : 0; }
function area(value) { return Number(value?.width || 0) * Number(value?.height || 0); }
function normalize(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
function uniqueCandidates(values) {
  const seen = new Set();
  return (values || []).filter((item) => item?.url && !seen.has(item.url) && seen.add(item.url));
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function bumpVersion() {
  if (!fs.existsSync(VERSION_FILE)) return;
  const payload = readJson(VERSION_FILE, {});
  const current = String(payload.version || '');
  const match = current.match(/^(\d{8})-(\d+)$/);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const next = match && match[1] === today ? `${today}-${Number(match[2]) + 1}` : `${today}-1`;
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: next }, null, 2) + '\n');
  console.log(`Version → ${next}`);
}
