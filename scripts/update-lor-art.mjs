import fs from 'node:fs';
import path from 'node:path';
import { LOR_ART_FILE } from './lor-art-source.mjs';

const USER_AGENT = 'lol-skins-lor-art-index/1.0 (+https://github.com/fabiandrt3-png/lol-skins)';
const TIMEOUT_MS = 25000;
const RIOT_LOR_DOCS = 'https://developer.riotgames.com/docs/lor';

// Riot's LoR Data Dragon exposes the card JSON directly next to the downloadable
// set bundles. Prefer latest and keep the documented versioned endpoint as a
// fallback for sets whose latest alias is unavailable.
const SETS = [
  source('set1', '1_0_0'),
  source('set2', '1_0_0'),
  source('set3', '1_8_0'),
  source('set4', '2_3_0'),
  source('set5', '2_14_0'),
  source('set6'),
  source('set6cde', '4_2_0'),
  source('set7', '4_3_0'),
  source('set7b', '4_6_0'),
  source('set8', '4_9_0'),
  source('set9', '5_4_0'),
];

const previous = readJson(LOR_ART_FILE, {});
const matches = previous?.matches && typeof previous.matches === 'object' ? previous.matches : {};
const champions = {};
const loadedSets = [];

for (const set of SETS) {
  const loaded = await firstJson(set.urls);
  if (!loaded) {
    console.warn(`LoR ${set.name}: no Data Dragon endpoint available`);
    continue;
  }

  const cards = Array.isArray(loaded.payload) ? loaded.payload : [];
  loadedSets.push({ name: set.name, url: loaded.url, cards: cards.length });

  for (const card of cards) {
    if (!isChampionCard(card) || !card?.name) continue;
    const urls = fullArtUrls(card);
    if (!urls.length) continue;

    const key = normalize(card.name);
    if (!key) continue;
    if (!champions[key]) champions[key] = { name: card.name, arts: [] };

    for (const url of urls) {
      champions[key].arts.push({
        url,
        cardCode: card.cardCode || null,
        set: set.name,
        collectible: Boolean(card.collectible),
      });
    }
  }
}

for (const champion of Object.values(champions)) {
  champion.arts = uniqueArts(champion.arts).sort(compareArts);
}

const orderedChampions = Object.fromEntries(
  Object.entries(champions).sort((a, b) => a[0].localeCompare(b[0], 'en')),
);
const orderedSets = loadedSets.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

const stableNext = {
  source: 'Riot Games — Legends of Runeterra Data Dragon',
  sourceDocs: RIOT_LOR_DOCS,
  strategy: 'Official LoR full card illustrations indexed as secondary art candidates; automatic use is limited to safe fallbacks or explicit curated skin matches.',
  sets: orderedSets,
  champions: orderedChampions,
  matches,
};

const stablePrevious = {
  source: previous?.source,
  sourceDocs: previous?.sourceDocs,
  strategy: previous?.strategy,
  sets: previous?.sets || [],
  champions: previous?.champions || {},
  matches,
};

if (JSON.stringify(stableNext) === JSON.stringify(stablePrevious)) {
  console.log(`LoR art index unchanged: ${Object.keys(orderedChampions).length} champion names across ${orderedSets.length} sets`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(LOR_ART_FILE), { recursive: true });
fs.writeFileSync(LOR_ART_FILE, JSON.stringify({
  generatedAt: new Date().toISOString(),
  ...stableNext,
}, null, 2) + '\n');

console.log(`LoR art index updated: ${Object.keys(orderedChampions).length} champion names across ${orderedSets.length} sets`);

function source(name, version = '') {
  const urls = [`https://dd.b.pvp.net/latest/${name}/en_us/data/${name}-en_us.json`];
  if (version) urls.push(`https://dd.b.pvp.net/${version}/${name}/en_us/data/${name}-en_us.json`);
  return { name, urls };
}

async function firstJson(urls) {
  for (const url of urls) {
    const payload = await fetchJson(url);
    if (payload) return { url, payload };
  }
  return null;
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
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isChampionCard(card) {
  return normalize(card?.supertype) === 'champion' || normalize(card?.rarityRef) === 'champion';
}

function fullArtUrls(card) {
  const result = [];
  for (const asset of card?.assets || []) {
    const url = secureUrl(asset?.fullAbsolutePath);
    if (url) result.push(url);
  }
  return [...new Set(result)];
}

function secureUrl(url) {
  if (!url) return null;
  return String(url).replace(/^http:\/\//i, 'https://');
}

function uniqueArts(arts) {
  const seen = new Set();
  const result = [];
  for (const art of arts || []) {
    if (!art?.url || seen.has(art.url)) continue;
    seen.add(art.url);
    result.push(art);
  }
  return result;
}

function compareArts(a, b) {
  const collectible = Number(Boolean(b.collectible)) - Number(Boolean(a.collectible));
  if (collectible) return collectible;
  const aMain = /T\d+$/i.test(a.cardCode || '') ? 1 : 0;
  const bMain = /T\d+$/i.test(b.cardCode || '') ? 1 : 0;
  if (aMain !== bMain) return aMain - bMain;
  return String(a.cardCode || '').localeCompare(String(b.cardCode || ''), 'en');
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
