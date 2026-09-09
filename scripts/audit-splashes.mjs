import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const LEGACY_FILE = path.join(ROOT, 'legacy', 'index-original.html');
const OVERRIDES_FILE = path.join(ROOT, 'data', 'image-overrides.json');
const REPORT_FILE = path.join(ROOT, 'audit-report.json');
const USER_AGENT = 'lol-skins-splash-audit/1.0 (+https://github.com/fabiandrt3-png/lol-skins)';
const TIMEOUT_MS = 20000;
const CONCURRENCY = 10;
const CDRAGON_ROOT = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/';
const WIKI_API = 'https://wiki.leagueoflegends.com/en-us/api.php';

const probeCache = new Map();
const wikiCache = new Map();
const championCache = new Map();

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const entries = readLegacyEntries();
  const catalog = await loadDDragonCatalog();
  const byChampion = groupBy(entries, (entry) => entry.champ);
  const tasks = [];

  for (const [champion, championEntries] of byChampion) {
    tasks.push(async () => auditChampion(champion, championEntries, catalog));
  }

  const auditedGroups = await runPool(tasks, Math.min(CONCURRENCY, tasks.length));
  const audited = auditedGroups.flat().sort((a, b) => a.index - b.index);
  const overrides = {};

  for (const item of audited) {
    if (!item.best) continue;
    overrides[item.id] = {
      url: item.best.url,
      width: item.best.width,
      height: item.best.height,
      bytes: item.best.bytes || null,
      source: item.best.source,
      verifiedAt: new Date().toISOString(),
      fallbacks: item.validCandidates
        .filter((candidate) => candidate.url !== item.best.url)
        .slice(0, 5)
        .map((candidate) => candidate.url),
    };
  }

  const summary = summarize(audited);
  fs.mkdirSync(path.dirname(OVERRIDES_FILE), { recursive: true });
  fs.writeFileSync(OVERRIDES_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    strategy: 'best verified resolution within semantically-correct candidates; stable fallbacks retained',
    entries: overrides,
  }, null, 2) + '\n');
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), summary, entries: audited }, null, 2) + '\n');
  installVerifiedImageLoader();

  console.log(JSON.stringify(summary, null, 2));
  if (summary.unresolved > 0) {
    console.error(`AUDIT FAILED: ${summary.unresolved} splash art(s) unresolved.`);
    process.exitCode = 2;
  }
}

function installVerifiedImageLoader() {
  const loaderPath = path.join(ROOT, 'data-loader.js');
  let source = fs.readFileSync(loaderPath, 'utf8');
  if (source.includes('const VERIFIED_IMAGE_MAP = "data/image-overrides.json";')) return;

  const replacements = [
    [
      'const CDRAGON_ASSET_ROOT = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/";\n\nlet catalogPromise;',
      'const CDRAGON_ASSET_ROOT = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/";\nconst VERIFIED_IMAGE_MAP = "data/image-overrides.json";\n\nlet catalogPromise;\nlet verifiedImageMapPromise;'
    ],
    [
      '  return data.map((item, index) => {\n    const meta = catalog?.byName.get(normalize(item.champ));\n    const legacyCandidates = legacyImageCandidates(item.image);',
      '  const verifiedImages = await loadVerifiedImageMap();\n\n  return data.map((item, index) => {\n    const id = `${slugify(item.champ)}::${slugify(item.skin)}::${index}`;\n    const meta = catalog?.byName.get(normalize(item.champ));\n    const verified = verifiedImages[id] || null;\n    const verifiedCandidates = unique([verified?.url, ...(verified?.fallbacks || [])]);\n    const legacyCandidates = legacyImageCandidates(item.image);\n    const allImageCandidates = unique([...verifiedCandidates, ...legacyCandidates]);'
    ],
    [
      '      _id: `${slugify(item.champ)}::${slugify(item.skin)}::${index}`,\n      _legacyImage: item.image,',
      '      _id: id,\n      _legacyImage: item.image,\n      _verifiedImageCandidates: verifiedCandidates,\n      _verifiedImageMeta: verified,'
    ],
    [
      '      imageCandidates: legacyCandidates,\n      iconCandidates,\n      image: legacyCandidates[0] || item.image,',
      '      imageCandidates: allImageCandidates,\n      iconCandidates,\n      image: allImageCandidates[0] || item.image,'
    ],
    [
      '  const entries = allSkins.filter((skin) => skin.champ === champion);\n  if (!entries.length) return;\n\n  const key =',
      '  const entries = allSkins.filter((skin) => skin.champ === champion);\n  if (!entries.length) return;\n  if (entries.every((entry) => entry._verifiedImageCandidates?.length)) {\n    resolvedChampions.add(champion);\n    return;\n  }\n\n  const key ='
    ],
    [
      '    entries.forEach((entry) => {\n      if (entry.type === "Wild Rift") {',
      '    entries.forEach((entry) => {\n      if (entry._verifiedImageCandidates?.length) {\n        entry.imageCandidates = unique([...entry._verifiedImageCandidates, ...(entry.imageCandidates || [])]);\n        entry.image = entry.imageCandidates[0] || entry._legacyImage;\n        entry._assetSource = "verified-audit";\n        return;\n      }\n\n      if (entry.type === "Wild Rift") {'
    ],
    [
      'async function loadChampionCatalog() {',
      'async function loadVerifiedImageMap() {\n  if (!verifiedImageMapPromise) {\n    verifiedImageMapPromise = fetch(VERIFIED_IMAGE_MAP, { cache: "no-cache" })\n      .then(async (response) => {\n        if (response.status === 404) return {};\n        if (!response.ok) throw new Error(`Verified image map: ${response.status}`);\n        const payload = await response.json();\n        return payload?.entries || {};\n      })\n      .catch((error) => {\n        console.warn("Carte d’images vérifiées indisponible, utilisation des fallbacks dynamiques.", error);\n        return {};\n      });\n  }\n  return verifiedImageMapPromise;\n}\n\nasync function loadChampionCatalog() {'
    ],
  ];

  for (const [before, after] of replacements) {
    if (!source.includes(before)) {
      throw new Error(`Impossible d’installer la carte d’images vérifiées: motif introuvable: ${before.slice(0, 80)}`);
    }
    source = source.replace(before, after);
  }
  fs.writeFileSync(loaderPath, source);
}

function readLegacyEntries() {
  const source = fs.readFileSync(LEGACY_FILE, 'utf8');
  const declaration = 'const championsSkins = [';
  const declarationIndex = source.indexOf(declaration);
  if (declarationIndex === -1) throw new Error('championsSkins introuvable');
  const arrayStart = source.indexOf('[', declarationIndex);
  const arrayEnd = source.indexOf('];', arrayStart);
  if (arrayStart === -1 || arrayEnd === -1) throw new Error('championsSkins incomplet');
  const data = Function(`"use strict"; return (${source.slice(arrayStart, arrayEnd + 1)});`)();
  return data.map((entry, index) => ({
    ...entry,
    index,
    id: `${slugify(entry.champ)}::${slugify(entry.skin)}::${index}`,
  }));
}

async function loadDDragonCatalog() {
  const versions = await fetchJson('https://ddragon.leagueoflegends.com/api/versions.json');
  const version = versions[0];
  const payload = await fetchJson(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`);
  const byName = new Map();
  for (const champion of Object.values(payload.data || {})) {
    byName.set(normalize(champion.name), { key: String(champion.key), alias: champion.id });
  }
  return { version, byName };
}

async function auditChampion(champion, entries, catalog) {
  const meta = catalog.byName.get(normalize(champion));
  let index = null;
  if (meta) {
    try {
      index = buildAssetIndex(await loadCDragonChampion(meta.key), champion);
    } catch (error) {
      console.warn(`CommunityDragon indisponible pour ${champion}: ${error.message}`);
    }
  }

  const results = [];
  for (const entry of entries) {
    const candidateSets = await buildCandidateSets(entry, champion, meta, index);
    const exactValid = await probeCandidates(candidateSets.exact);
    let valid = exactValid;
    let degraded = false;

    if (!valid.length && candidateSets.fallback.length) {
      valid = await probeCandidates(candidateSets.fallback);
      degraded = valid.length > 0;
    }

    const best = chooseBest(valid);
    results.push({
      id: entry.id,
      index: entry.index,
      champion: entry.champ,
      skin: entry.skin,
      type: entry.type || 'PC',
      legacyUrl: entry.image,
      verified: Boolean(best),
      degraded,
      best,
      validCandidates: valid,
      attempted: [...candidateSets.exact, ...candidateSets.fallback].map(({ url, source, semantic }) => ({ url, source, semantic })),
    });
    console.log(`${best ? '✓' : '✗'} ${entry.champ} — ${entry.skin}${best ? ` → ${best.width}x${best.height} (${best.source})` : ''}`);
  }
  return results;
}

async function buildCandidateSets(entry, champion, meta, index) {
  const exact = [];
  const fallback = [];
  const wiki = await wikiCandidates(entry);

  if (entry.type === 'Wild Rift') {
    exact.push(...wiki);
    if (entry.image) exact.push(candidate(entry.image, 'legacy-wild-rift', 'exact'));
    return { exact: dedupeCandidates(exact), fallback: [] };
  }

  const resolved = index ? findPcAsset(entry, index, champion) : null;
  if (resolved?.kind === 'chroma') {
    const { chroma, parent } = resolved;
    exact.push(...wiki);
    if (entry.image) exact.push(candidate(entry.image, 'legacy-chroma', 'exact'));
    exact.push(candidate(cdragonAsset(chroma.chromaPath), 'communitydragon-chroma', 'exact'));
    exact.push(candidate(cdragonAsset(chroma.tilePath), 'communitydragon-chroma-tile', 'exact'));

    const num = skinNumber(parent.id);
    fallback.push(candidate(cdragonAsset(parent.uncenteredSplashPath), 'communitydragon-parent-uncentered', 'fallback-parent'));
    if (meta) fallback.push(candidate(ddragonSplash(meta.alias, num), 'ddragon-parent', 'fallback-parent'));
    fallback.push(candidate(cdragonAsset(parent.splashPath), 'communitydragon-parent-centered', 'fallback-parent'));
    return { exact: dedupeCandidates(exact), fallback: dedupeCandidates(fallback) };
  }

  if (resolved?.kind === 'skin') {
    const skin = resolved.skin;
    const num = skinNumber(skin.id);
    exact.push(...wiki);
    exact.push(candidate(cdragonAsset(skin.uncenteredSplashPath), 'communitydragon-uncentered', 'exact'));
    if (meta) exact.push(candidate(ddragonSplash(meta.alias, num), 'ddragon', 'exact'));
    exact.push(candidate(cdragonAsset(skin.splashPath), 'communitydragon-centered', 'exact'));
    if (entry.image) exact.push(candidate(entry.image, 'legacy', 'exact'));
    return { exact: dedupeCandidates(exact), fallback: [] };
  }

  exact.push(...wiki);
  if (entry.image) exact.push(candidate(entry.image, 'legacy-unmatched', 'exact'));
  return { exact: dedupeCandidates(exact), fallback: [] };
}

async function wikiCandidates(entry) {
  const filename = wikiFilename(entry.image || '');
  if (!filename) return [];
  const candidates = [];
  const info = await getWikiImageInfo(filename);
  if (info) {
    candidates.push({
      url: info.url,
      source: entry.type === 'Wild Rift' ? 'league-wiki-original-wild-rift' : 'league-wiki-original',
      semantic: 'exact',
      knownWidth: info.width,
      knownHeight: info.height,
    });
  }
  candidates.push(candidate(`https://wiki.leagueoflegends.com/en-us/Special:Redirect/file/${encodeURIComponent(filename)}`, 'league-wiki-redirect', 'exact'));
  return dedupeCandidates(candidates);
}

async function getWikiImageInfo(filename) {
  if (wikiCache.has(filename)) return wikiCache.get(filename);
  const promise = (async () => {
    const url = new URL(WIKI_API);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|size');
    url.searchParams.set('titles', `File:${filename}`);
    const payload = await fetchJson(url.href, { optional: true });
    const info = payload?.query?.pages?.[0]?.imageinfo?.[0];
    return info?.url ? { url: info.url, width: info.width || null, height: info.height || null } : null;
  })().catch(() => null);
  wikiCache.set(filename, promise);
  return promise;
}

async function loadCDragonChampion(id) {
  if (!championCache.has(id)) {
    championCache.set(id, fetchJson(`https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champions/${id}.json`));
  }
  return championCache.get(id);
}

function buildAssetIndex(championData, champion) {
  const skins = Array.isArray(championData?.skins) ? championData.skins : [];
  const skinByName = new Map();
  const chromaByName = new Map();
  const chromaByContentId = new Map();
  const coreSkinNames = new Map();

  for (const skin of skins) {
    for (const alias of skinAliases(skin, champion)) skinByName.set(alias, skin);
    addCore(coreSkinNames, coreName(skin.name, champion), skin);
    for (const chroma of skin.chromas || []) {
      for (const alias of chromaAliases(chroma, champion)) chromaByName.set(alias, { chroma, parent: skin });
      if (chroma.contentId) chromaByContentId.set(chroma.contentId.toLowerCase(), { chroma, parent: skin });
    }
  }
  return { skins, skinByName, chromaByName, chromaByContentId, coreSkinNames };
}

function findPcAsset(entry, index, champion) {
  const uuid = extractUuid(entry.image);
  if (uuid && index.chromaByContentId.has(uuid)) return { kind: 'chroma', ...index.chromaByContentId.get(uuid) };

  const normalized = normalizeSkinName(entry.skin, champion);
  const chroma = index.chromaByName.get(normalized);
  if (chroma) return { kind: 'chroma', ...chroma };

  const exact = index.skinByName.get(normalized);
  if (exact) return { kind: 'skin', skin: exact };

  const core = coreName(entry.skin, champion);
  const matches = index.coreSkinNames.get(core) || [];
  if (matches.length === 1) return { kind: 'skin', skin: matches[0] };
  return null;
}

async function probeCandidates(candidates) {
  const results = await Promise.all(candidates.map(probeCandidate));
  return results.filter(Boolean);
}

async function probeCandidate(candidateData) {
  if (!candidateData?.url) return null;
  if (!probeCache.has(candidateData.url)) {
    probeCache.set(candidateData.url, probeImage(candidateData.url, candidateData.knownWidth, candidateData.knownHeight));
  }
  const probed = await probeCache.get(candidateData.url);
  return probed ? { ...candidateData, ...probed } : null;
}

async function probeImage(url, knownWidth = null, knownHeight = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, 'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' },
    });
    if (!response.ok) return null;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return null;

    let width = knownWidth;
    let height = knownHeight;
    if (!width || !height) {
      const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
      width = metadata.width || null;
      height = metadata.height || null;
    }
    if (!width || !height) return null;
    return { url: response.url || url, width, height, bytes: buffer.length, contentType, area: width * height };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function chooseBest(valid) {
  if (!valid.length) return null;
  const sourceRank = {
    'league-wiki-original-wild-rift': 9,
    'communitydragon-uncentered': 8,
    'league-wiki-original': 7,
    'ddragon': 6,
    'communitydragon-centered': 5,
    'legacy-wild-rift': 4,
    'legacy-chroma': 4,
    'communitydragon-chroma': 3,
    'communitydragon-chroma-tile': 2,
    'legacy': 1,
    'legacy-unmatched': 1,
    'league-wiki-redirect': 1,
  };
  return [...valid].sort((a, b) => {
    const areaDiff = (b.area || 0) - (a.area || 0);
    if (areaDiff !== 0) return areaDiff;
    return (sourceRank[b.source] || 0) - (sourceRank[a.source] || 0);
  })[0];
}

function summarize(entries) {
  const unresolvedEntries = entries.filter((entry) => !entry.verified);
  const wr = entries.filter((entry) => entry.type === 'Wild Rift');
  const pc = entries.filter((entry) => entry.type !== 'Wild Rift');
  const lowRes = entries.filter((entry) => entry.best && (entry.best.width < 1600 || entry.best.height < 900));
  const degraded = entries.filter((entry) => entry.degraded);
  return {
    total: entries.length,
    verified: entries.length - unresolvedEntries.length,
    unresolved: unresolvedEntries.length,
    pcTotal: pc.length,
    pcVerified: pc.filter((entry) => entry.verified).length,
    wildRiftTotal: wr.length,
    wildRiftVerified: wr.filter((entry) => entry.verified).length,
    wildRiftUnresolved: wr.filter((entry) => !entry.verified).length,
    degradedFallbacks: degraded.length,
    below1600x900: lowRes.length,
    unresolvedEntries: unresolvedEntries.map((entry) => ({ champion: entry.champion, skin: entry.skin, type: entry.type })),
    degradedEntries: degraded.map((entry) => ({ champion: entry.champion, skin: entry.skin, type: entry.type, best: entry.best })),
    lowResolutionEntries: lowRes.map((entry) => ({ champion: entry.champion, skin: entry.skin, type: entry.type, best: entry.best })),
  };
}

async function fetchJson(url, { optional = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': USER_AGENT, 'accept': 'application/json,*/*;q=0.8' } });
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

function candidate(url, source, semantic) { return url ? { url, source, semantic } : null; }

function cdragonAsset(assetPath) {
  if (!assetPath) return null;
  const prefix = '/lol-game-data/assets/';
  if (!assetPath.toLowerCase().startsWith(prefix)) return null;
  return `${CDRAGON_ROOT}${assetPath.slice(prefix.length).toLowerCase()}`;
}

function ddragonSplash(alias, num) { return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${alias}_${num}.jpg`; }
function skinNumber(id) { return Number(id) % 1000; }

function wikiFilename(url = '') {
  if (!/wiki\.leagueoflegends\.com\/en-us\/images\//i.test(url)) return null;
  try { return decodeURIComponent(url.split('/').pop() || '') || null; }
  catch { return url.split('/').pop() || null; }
}

function skinAliases(skin, champion) {
  const aliases = new Set([normalizeSkinName(skin.name, champion)]);
  if (skin.isBase) {
    aliases.add(normalizeSkinName(champion, champion));
    aliases.add(normalizeSkinName(`Classic ${champion}`, champion));
  }
  if (/^prestige\s+/i.test(skin.name)) {
    const withoutPrefix = skin.name.replace(/^prestige\s+/i, '');
    aliases.add(normalizeSkinName(`${withoutPrefix} (Prestige)`, champion));
  }
  return aliases;
}

function chromaAliases(chroma, champion) {
  const clean = chroma.name.replace(/\s+Chroma(?=\))/gi, '');
  return new Set([normalizeSkinName(chroma.name, champion), normalizeSkinName(clean, champion)]);
}

function normalizeSkinName(value, champion) {
  let text = String(value || '');
  text = text.replace(/\(Wild Rift\)/gi, '');
  text = text.replace(/\s+Chroma(?=\))/gi, '');
  text = text.replace(/^Classic\s+/i, '');
  text = normalize(text);
  const champNorm = normalize(champion);
  if (text === champNorm || text === `classic ${champNorm}`) return champNorm;
  if (/\bprestige\b/.test(text) && !text.startsWith('prestige ')) {
    text = `prestige ${text.replace(/\bprestige\b/g, '').trim()}`;
  }
  return normalize(text);
}

function coreName(value, champion) {
  const champ = normalize(champion);
  return normalizeSkinName(value, champion)
    .replace(new RegExp(`\\b${escapeRegExp(champ)}\\b`, 'g'), ' ')
    .replace(/\b(prestige|mythic|chroma|special|edition|exquisite|select)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addCore(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function extractUuid(value = '') {
  return String(value).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]?.toLowerCase() || null;
}

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function slugify(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function dedupeCandidates(values) {
  const seen = new Set();
  const result = [];
  for (const item of values.filter(Boolean)) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    result.push(item);
  }
  return result;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (true) {
      const current = next++;
      if (current >= tasks.length) return;
      results[current] = await tasks[current]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
