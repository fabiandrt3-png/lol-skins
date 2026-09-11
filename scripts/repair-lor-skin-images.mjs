import fs from 'node:fs';

const FILE = 'data/lor-skins.json';
const USER_AGENT = 'lol-skins-lor-image-repair/1.1 (+https://github.com/fabiandrt3-png/lol-skins)';
const WIKI_API = 'https://wiki.leagueoflegends.com/en-us/api.php';
const TIMEOUT_MS = 25000;
const REQUEST_DELAY_MS = 350;
const MAX_RETRIES = 5;

const payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const entries = Array.isArray(payload?.entries) ? payload.entries : [];
if (!entries.length) throw new Error('LoR skin catalog is empty.');

const queryPrefixes = unique(entries
  .map((entry) => baseCardCode(entry?.lorCardCode))
  .filter(Boolean));
const wikiFiles = new Map();

for (const prefix of queryPrefixes) {
  const files = await listWikiFiles(prefix);
  wikiFiles.set(prefix, files);
  if (Array.isArray(files)) console.log(`LoR ${prefix}: ${files.length} Wiki image file(s) discovered`);
  else console.warn(`LoR ${prefix}: Wiki lookup unavailable; existing sources will be preserved`);
  await sleep(REQUEST_DELAY_MS);
}

let repaired = 0;
let unresolved = 0;
let unchecked = 0;
let removedBrokenCandidates = 0;
const unresolvedEntries = [];
const uncheckedEntries = [];

for (const entry of entries) {
  const original = isOriginal(entry);
  const prefix = baseCardCode(entry.lorCardCode);
  const pool = wikiFiles.get(prefix);
  const lookupAvailable = Array.isArray(pool);
  const existing = existingCandidates(entry);

  // Never destroy a usable source merely because the Wiki API is temporarily
  // rate-limited or offline. The next scheduled repair can validate it later.
  if (!lookupAvailable) {
    if (entry.image) {
      entry.imageStatus = entry.imageStatus === 'verified' ? 'verified' : 'unchecked';
      unchecked += entry.imageStatus === 'unchecked' ? 1 : 0;
      if (entry.imageStatus === 'unchecked') uncheckedEntries.push(`${entry.champ} — ${entry.skin}`);
    } else {
      entry.imageStatus = 'unresolved';
      unresolved += 1;
      unresolvedEntries.push(`${entry.champ} — ${entry.skin}`);
    }
    continue;
  }

  const discovered = selectWikiCandidates(entry, pool);
  const riotCandidates = original ? officialRiotCandidates(entry) : [];
  let cardCandidates = unique([
    ...riotCandidates,
    ...discovered.card,
  ]);
  let fullscreenCandidates = unique([
    ...discovered.fullscreen,
    ...riotCandidates,
    ...discovered.card,
  ]);

  // When the exact Wiki lookup succeeds but no matching file is found, probe
  // the previous candidates before discarding them. Only real image responses
  // survive; guessed HTML/404 redirects are removed permanently.
  if (!discovered.card.length && !discovered.fullscreen.length) {
    const validatedExisting = [];
    for (const url of existing) {
      if (await isLiveImage(url)) validatedExisting.push(url);
      else removedBrokenCandidates += 1;
    }
    cardCandidates = unique([...cardCandidates, ...validatedExisting]);
    fullscreenCandidates = unique([...fullscreenCandidates, ...validatedExisting]);
  }

  const image = cardCandidates[0] || fullscreenCandidates[0] || '';
  if (!image) {
    const before = JSON.stringify({
      image: entry.image,
      fullImage: entry.fullImage,
      fallbacks: entry.fallbacks,
      fullHdFallbacks: entry.fullHdFallbacks,
      imageStatus: entry.imageStatus,
    });
    entry.imageStatus = 'unresolved';
    delete entry.image;
    delete entry.fullImage;
    delete entry.fallbacks;
    delete entry.fullHdFallbacks;
    const after = JSON.stringify({
      image: entry.image,
      fullImage: entry.fullImage,
      fallbacks: entry.fallbacks,
      fullHdFallbacks: entry.fullHdFallbacks,
      imageStatus: entry.imageStatus,
    });
    if (before !== after) repaired += 1;
    unresolved += 1;
    unresolvedEntries.push(`${entry.champ} — ${entry.skin}`);
    continue;
  }

  const before = JSON.stringify({
    image: entry.image,
    fullImage: entry.fullImage,
    fallbacks: entry.fallbacks,
    fullHdFallbacks: entry.fullHdFallbacks,
    imageStatus: entry.imageStatus,
  });

  entry.image = image;
  entry.fullImage = fullscreenCandidates[0] || image;
  if (cardCandidates.length > 1) entry.fallbacks = cardCandidates.slice(1);
  else delete entry.fallbacks;
  if (fullscreenCandidates.length > 1) entry.fullHdFallbacks = fullscreenCandidates.slice(1);
  else delete entry.fullHdFallbacks;
  entry.imageStatus = 'verified';

  const after = JSON.stringify({
    image: entry.image,
    fullImage: entry.fullImage,
    fallbacks: entry.fallbacks,
    fullHdFallbacks: entry.fullHdFallbacks,
    imageStatus: entry.imageStatus,
  });
  if (before !== after) repaired += 1;
}

payload.imageAudit = {
  verifiedAt: new Date().toISOString(),
  strategy: 'Rate-limited MediaWiki allimages lookup by base card code; exact level-code matching; direct image URLs only; dead guessed redirects removed; previous sources preserved when lookup is unavailable',
  total: entries.length,
  repaired,
  verified: entries.filter((entry) => entry.imageStatus === 'verified' && entry.image).length,
  unchecked,
  unresolved,
  removedBrokenCandidates,
  uncheckedEntries,
  unresolvedEntries,
};

fs.writeFileSync(FILE, JSON.stringify(payload, null, 2) + '\n');
console.log(`LoR image repair complete: ${payload.imageAudit.verified}/${entries.length} verified, ${unchecked} unchecked, ${unresolved} unresolved, ${repaired} updated, ${removedBrokenCandidates} dead candidate(s) removed.`);
if (uncheckedEntries.length) console.warn(`Temporarily unchecked LoR artwork: ${uncheckedEntries.join(' | ')}`);
if (unresolvedEntries.length) console.warn(`Unresolved LoR artwork: ${unresolvedEntries.join(' | ')}`);

async function listWikiFiles(prefix) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    list: 'allimages',
    aiprefix: prefix,
    ailimit: 'max',
    aiprop: 'url|mime|size|dimensions',
  });
  const url = `${WIKI_API}?${params}`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const result = await fetchJsonResponse(url);
    if (result.ok) {
      return (result.payload?.query?.allimages || [])
        .filter((file) => String(file?.mime || '').startsWith('image/'))
        .map((file) => ({
          name: String(file.name || ''),
          url: secureUrl(file.url),
          width: Number(file.width || 0),
          height: Number(file.height || 0),
          size: Number(file.size || 0),
        }))
        .filter((file) => file.name && file.url);
    }

    if (result.status !== 429) return null;
    const waitMs = Math.max(result.retryAfterMs || 0, 1500 * (2 ** attempt));
    console.warn(`Wiki rate limit for ${prefix}; retrying in ${waitMs}ms (${attempt + 1}/${MAX_RETRIES})`);
    await sleep(waitMs);
  }

  return null;
}

function selectWikiCandidates(entry, files) {
  const code = String(entry?.lorCardCode || '').trim();
  const skin = normalizeFileToken(entry?.lorSkinName);
  const original = isOriginal(entry);
  const codePattern = new RegExp(`^${escapeRegExp(code)}(?=[^A-Za-z0-9]|$)`, 'i');

  const matches = files.filter((file) => {
    const rawName = String(file.name || '');
    if (!codePattern.test(rawName)) return false;

    const remainder = rawName.slice(code.length);
    if (original) {
      return /^[ _-]*(?:(?:HD|alt)[ _-]*)*full\.(?:png|jpe?g|webp)$/i.test(remainder);
    }

    return skin && normalizeFileToken(rawName).includes(skin);
  });

  const ranked = matches
    .map((file) => ({ ...file, score: scoreWikiFile(file, entry) }))
    .sort((a, b) => b.score - a.score || (b.width * b.height) - (a.width * a.height) || b.size - a.size);

  const card = ranked
    .filter((file) => !isHdFile(file.name))
    .sort((a, b) => cardScore(b) - cardScore(a))
    .map((file) => file.url);
  const fullscreen = ranked.map((file) => file.url);

  return { card: unique(card), fullscreen: unique(fullscreen) };
}

function scoreWikiFile(file, entry) {
  const name = String(file.name || '').toLowerCase();
  let score = 0;
  if (isHdFile(name)) score += 1000;
  if (/[-_ ]full\.(?:png|jpe?g|webp)$/i.test(name)) score += 450;
  if (!/alt/i.test(name)) score += 300;
  if (/\.png$/i.test(name)) score += 80;
  if (/\.jpe?g$/i.test(name)) score += 60;
  if (new RegExp(`^${escapeRegExp(String(entry.lorCardCode || ''))}(?=[^A-Za-z0-9]|$)`, 'i').test(file.name)) score += 200;
  score += Math.min((file.width * file.height) / 100000, 400);
  return score;
}

function cardScore(file) {
  const name = String(file.name || '').toLowerCase();
  let score = 0;
  if (!/alt/i.test(name)) score += 500;
  if (/[-_ ]full\.png$/i.test(name)) score += 300;
  if (/\.png$/i.test(name)) score += 100;
  score += Math.min((file.width * file.height) / 100000, 300);
  return score;
}

function officialRiotCandidates(entry) {
  return existingCandidates(entry).filter(isRiotImage);
}

function existingCandidates(entry) {
  return unique([
    entry.image,
    ...(entry.fallbacks || []),
    entry.fullImage,
    ...(entry.fullHdFallbacks || []),
  ]);
}

function isOriginal(entry) {
  return /^original$/i.test(String(entry?.lorSkinName || '').trim());
}

function baseCardCode(value = '') {
  return String(value).trim().replace(/T\d+$/i, '');
}

function isHdFile(name) {
  return /(?:^|[-_ ])hd(?:[-_ ]|full|\.)/i.test(String(name || '')) || /-HD-full/i.test(String(name || ''));
}

function isRiotImage(url) {
  return /(?:^|\.)pvp\.net\//i.test(String(url || '')) || /dd\.b\.pvp\.net\//i.test(String(url || ''));
}

async function isLiveImage(url) {
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.1',
        range: 'bytes=0-1023',
      },
    });
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    return response.ok && type.startsWith('image/');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonResponse(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json,*/*;q=0.8' },
    });
    const retryAfterSeconds = Number(response.headers.get('retry-after') || 0);
    if (!response.ok) {
      if (response.status !== 429) console.warn(`Wiki image index failed: ${response.status} ${url}`);
      return { ok: false, status: response.status, retryAfterMs: retryAfterSeconds * 1000, payload: null };
    }
    return { ok: true, status: response.status, retryAfterMs: 0, payload: await response.json() };
  } catch (error) {
    console.warn(`Wiki image index failed: ${url} (${error?.name || 'network error'})`);
    return { ok: false, status: 0, retryAfterMs: 0, payload: null };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeFileToken(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function secureUrl(url) {
  return url ? String(url).replace(/^http:\/\//i, 'https://') : '';
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
