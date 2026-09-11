import fs from 'node:fs';

const FILE = 'data/lor-skins.json';
const USER_AGENT = 'lol-skins-lor-image-repair/1.0 (+https://github.com/fabiandrt3-png/lol-skins)';
const WIKI_API = 'https://wiki.leagueoflegends.com/en-us/api.php';
const TIMEOUT_MS = 25000;
const CONCURRENCY = 6;

const payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const entries = Array.isArray(payload?.entries) ? payload.entries : [];
if (!entries.length) throw new Error('LoR skin catalog is empty.');

const byCardCode = new Map();
for (const entry of entries) {
  const code = String(entry?.lorCardCode || '').trim();
  if (!code) continue;
  if (!byCardCode.has(code)) byCardCode.set(code, []);
  byCardCode.get(code).push(entry);
}

const wikiFiles = new Map();
await mapLimit([...byCardCode.keys()], CONCURRENCY, async (code) => {
  const files = await listWikiFiles(code);
  wikiFiles.set(code, files);
  console.log(`LoR ${code}: ${files.length} Wiki image file(s) discovered`);
});

let repaired = 0;
let unresolved = 0;
let removedBrokenCandidates = 0;
const unresolvedEntries = [];

for (const entry of entries) {
  const original = isOriginal(entry);
  const discovered = selectWikiCandidates(entry, wikiFiles.get(entry.lorCardCode) || []);
  const riotCandidates = original ? officialRiotCandidates(entry) : [];
  const existing = existingCandidates(entry);

  const cardCandidates = unique([
    ...riotCandidates,
    ...discovered.card,
    ...existing.filter((url) => isRiotImage(url)),
  ]);
  const fullscreenCandidates = unique([
    ...discovered.fullscreen,
    ...riotCandidates,
    ...discovered.card,
    ...existing.filter((url) => isRiotImage(url)),
  ]);

  // If the Wiki API did not find a matching cosmetic file, validate the old
  // candidates before keeping them. This prevents guessed dead redirects from
  // reappearing in the published catalog.
  if (!original && !discovered.card.length && !discovered.fullscreen.length) {
    const validatedExisting = [];
    for (const url of existing) {
      if (await isLiveImage(url)) validatedExisting.push(url);
      else removedBrokenCandidates += 1;
    }
    cardCandidates.push(...validatedExisting);
    fullscreenCandidates.push(...validatedExisting);
  }

  const finalCard = unique(cardCandidates);
  const finalFullscreen = unique(fullscreenCandidates);
  const image = finalCard[0] || finalFullscreen[0] || '';

  if (!image) {
    unresolved += 1;
    unresolvedEntries.push(`${entry.champ} — ${entry.skin}`);
    entry.imageStatus = 'unresolved';
    delete entry.image;
    delete entry.fullImage;
    delete entry.fallbacks;
    delete entry.fullHdFallbacks;
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
  entry.fullImage = finalFullscreen[0] || image;
  if (finalCard.length > 1) entry.fallbacks = finalCard.slice(1);
  else delete entry.fallbacks;
  if (finalFullscreen.length > 1) entry.fullHdFallbacks = finalFullscreen.slice(1);
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
  strategy: 'MediaWiki allimages lookup by exact LoR card code and cosmetic name; direct image URLs only; dead guessed redirects removed',
  total: entries.length,
  repaired,
  unresolved,
  removedBrokenCandidates,
  unresolvedEntries,
};

fs.writeFileSync(FILE, JSON.stringify(payload, null, 2) + '\n');
console.log(`LoR image repair complete: ${entries.length - unresolved}/${entries.length} resolved, ${repaired} updated, ${removedBrokenCandidates} dead candidate(s) removed.`);
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
  const payload = await fetchJson(`${WIKI_API}?${params}`);
  return (payload?.query?.allimages || [])
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

function selectWikiCandidates(entry, files) {
  const code = normalizeFileToken(entry.lorCardCode);
  const skin = normalizeFileToken(entry.lorSkinName);
  const original = isOriginal(entry);

  const matches = files.filter((file) => {
    const name = normalizeFileToken(file.name);
    if (!name.startsWith(code)) return false;
    if (original) {
      const remainder = name.slice(code.length);
      return !remainder || /^(hdfull|full|altfull|hdfulljpg|fullpng)/.test(remainder);
    }
    return skin && name.includes(skin);
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
  if (normalizeFileToken(name).startsWith(normalizeFileToken(entry.lorCardCode))) score += 150;
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

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json,*/*;q=0.8' },
    });
    if (!response.ok) {
      console.warn(`Wiki image index failed: ${response.status} ${url}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn(`Wiki image index failed: ${url} (${error?.name || 'network error'})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(values, limit, mapper) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (index < values.length) {
      const current = values[index++];
      await mapper(current);
    }
  });
  await Promise.all(workers);
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
