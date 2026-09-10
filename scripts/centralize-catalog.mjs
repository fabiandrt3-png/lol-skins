import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const LEGACY_FILE = path.join(ROOT, 'legacy', 'index-original.html');
const OVERRIDES_FILE = path.join(ROOT, 'data', 'image-overrides.json');
const NEW_SKINS_FILE = path.join(ROOT, 'data', 'new-skins.json');
const POST_CUTOFF_FILE = path.join(ROOT, 'data', 'post-cutoff-additions.js');

const AATROX_ORDER = [
  'Classic Aatrox',
  'Justicar Aatrox',
  'Mecha Aatrox',
  'Mecha Aatrox (Pearl Chroma)',
  'Sea Hunter Aatrox',
  'Blood Moon Aatrox',
  'Blood Moon Aatrox (Prestige)',
  'Victorious Aatrox',
  'Odyssey Aatrox',
  'Lunar Eclipse Aatrox',
  'DRX Aatrox',
  'DRX Aatrox (Prestige)',
  'Shan Hai Scrolls Aatrox',
  'Dragon Lantern Aatrox',
  'Dragon Lantern Aatrox (Prestige Select)',
  'Primordian Aatrox',
  'Primordian Aatrox (Catseye Chroma)',
  'Primordian Aatrox (Ruby Chroma)',
  'Primordian Aatrox (Sapphire Chroma)',
  'Weather Entity Aatrox',
  'Mecha Aatrox (Exquisite Edition)',
];

const AHRI_ORDER = [
  'Classic Ahri::pc',
  'Dynasty Ahri',
  'Midnight Ahri',
  'Midnight Ahri (Ahri-versary Chroma)',
  'Foxfire Ahri::pc',
  'Foxfire Ahri (Emerald Chroma)',
  'Popstar Ahri::pc',
  'Popstar Ahri (Amethyst Chroma)',
  'Popstar Ahri (Catseye Chroma)',
  'Popstar Ahri (Pearl Chroma)',
  'Popstar Ahri (Ahri-versary Chroma)',
  'Challenger Ahri',
  'Academy Ahri',
  'Arcade Ahri',
  'Star Guardian Ahri',
  'Star Guardian Ahri (Mythic Chroma)',
  'K/DA Ahri',
  'K/DA Ahri (Ahri-versary Chroma)',
  'K/DA Ahri (Prestige)',
  'Elderwood Ahri',
  'Foxfire Ahri::wild-rift',
  'Spirit Blossom Ahri',
  'Spirit Blossom Ahri (Rose Quartz Chroma)',
  'K/DA ALL OUT Ahri',
  'K/DA ALL OUT Ahri (Rose Quartz Chroma)',
  'Coven Ahri',
  'Coven Ahri (Ahri-versary Chroma)',
  'Coven Ahri (Pearl Chroma)',
  'Arcana Ahri',
  'Snow Moon Ahri',
  'Snow Moon Ahri (Turquoise Chroma)',
  'Soda Pop Ahri',
  'Shan Hai Scrolls Ahri',
  'Risen Legend Ahri',
  'Immortalized Legend Ahri',
  'Spirit Blossom Springs Ahri',
  'Spirit Blossom Springs Ahri (Pearl Chroma)',
  'Spirit Blossom Springs Ahri (Ruby Chroma)',
  'Spirit Blossom Springs Ahri (Sapphire Chroma)',
  'Spirit Blossom Springs Ahri (Tanzanite Chroma)',
  'Spirit Blossom Springs Ahri (Catseye Chroma)',
  'After Hours Spirit Blossom Springs Ahri',
  'Crystal Rose Ahri',
];

const AKALI_ORDER = [
  'Classic Akali',
  'Stinger Akali',
  'Infernal Akali',
  'All-star Akali',
  'Nurse Akali',
  'Blood Moon Akali',
  'Silverfang Akali',
  'Headhunter Akali',
  'Headhunter Akali (Pearl Chroma)',
  'Sashimi Akali',
  'K/DA Akali',
  'K/DA Akali (Prestige)',
  'PROJECT: Akali',
  'True Damage Akali',
  'K/DA ALL OUT Akali',
  'K/DA ALL OUT Akali (Rose Quartz Chroma)',
  'Crime City Nightmare Akali',
  'Star Guardian Akali',
  'Star Guardian Akali (Rose Quartz Chroma)',
  'Star Guardian Akali (Ruby Chroma)',
  'Crystal Rose Akali',
  'DRX Akali',
  'Coven Akali',
  'Coven Akali (Sapphire Chroma)',
  'Coven Akali (Prestige)',
  'Supreme Cells Akali',
  'Empyrean Akali',
  'Spirit Blossom Akali',
  'Spirit Blossom Akali (Citrine Chroma)',
  'Spirit Blossom Akali (Rose Quartz Chroma)',
  'Spirit Blossom Akali (Pearl Chroma)',
  'Calligraphia Akali',
  'Prestige Select Crystal Rose Akali',
];

const KNOWN_ORDERS = new Map([
  ['Aatrox', buildOrder(AATROX_ORDER)],
  ['Ahri', buildOrder(AHRI_ORDER)],
  ['Akali', buildOrder(AKALI_ORDER)],
]);

// Same illustration on PC and Wild Rift: one visible catalogue entry only.
const HIDDEN_DUPLICATE_SPLASHES = new Set([
  'ahri::classic-ahri::wild-rift',
  'ahri::popstar-ahri::wild-rift',
]);

const previousPayload = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
const verifiedEntries = previousPayload?.entries || {};
const legacy = readLegacyEntries();
const newSkins = readJsonArray(NEW_SKINS_FILE);
const postCutoff = await readPostCutoffEntries();

const historical = legacy.map((item) => mapHistorical(item, verifiedEntries));
const additions = [...newSkins, ...postCutoff].map(mapAddition);
const merged = dedupe([...historical, ...additions]).filter((item) => !isHiddenDuplicate(item));
const champions = groupAndSort(merged);
const championCount = Object.keys(champions).length;
const skinCount = Object.values(champions).reduce((sum, skins) => sum + skins.length, 0);

const output = {
  generatedAt: new Date().toISOString(),
  strategy: 'Single source of truth for the app catalogue. Champions A-Z; existing chronological skin order preserved; distinct chroma splash arts stay immediately after their parent skin.',
  championCount,
  skinCount,
  champions,
  // Retained for the verification/repair scripts. The app itself reads `champions` only.
  entries: verifiedEntries,
};

if (previousPayload?.qualityPolicy) output.qualityPolicy = previousPayload.qualityPolicy;

fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(output, null, 2) + '\n');
console.log(`Centralized ${skinCount} skins across ${championCount} champions into data/image-overrides.json`);

function readLegacyEntries() {
  const source = fs.readFileSync(LEGACY_FILE, 'utf8');
  const declaration = 'const championsSkins = [';
  const declarationIndex = source.indexOf(declaration);
  if (declarationIndex === -1) throw new Error('championsSkins introuvable');
  const arrayStart = source.indexOf('[', declarationIndex);
  const arrayEnd = source.indexOf('];', arrayStart);
  if (arrayStart === -1 || arrayEnd === -1) throw new Error('championsSkins incomplet');
  const entries = Function(`"use strict"; return (${source.slice(arrayStart, arrayEnd + 1)});`)();
  return entries.map((entry, index) => ({ ...entry, index }));
}

function readJsonArray(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  return Array.isArray(parsed?.entries) ? parsed.entries : [];
}

async function readPostCutoffEntries() {
  const url = `${pathToFileURL(POST_CUTOFF_FILE).href}?centralize=${Date.now()}`;
  const module = await import(url);
  return Array.isArray(module?.postCutoffAdditions) ? module.postCutoffAdditions : [];
}

function mapHistorical(item, verifiedMap) {
  const id = `${slugify(item.champ)}::${slugify(item.skin)}::${item.index}`;
  const verified = verifiedMap[id] || null;
  const verifiedCandidates = unique([verified?.url, ...(verified?.fallbacks || [])]);
  const legacyCandidates = legacyImageCandidates(item.image);
  const allCandidates = unique([...verifiedCandidates, ...legacyCandidates]);
  const cardCandidates = cardImageCandidates(allCandidates);
  const hdCandidates = highResolutionImageCandidates(allCandidates);
  const image = cardCandidates[0] || item.image;
  const fullImage = hdCandidates[0] || allCandidates[0] || image;

  const record = {
    id,
    skin: item.skin,
    type: item.type === 'Wild Rift' ? 'Wild Rift' : 'PC',
    image,
    fallbacks: cardCandidates.filter((url) => url !== image),
    fullImage,
    fullHdFallbacks: unique([
      ...hdCandidates.filter((url) => url !== fullImage),
      ...allCandidates.filter((url) => url !== fullImage),
    ]),
  };

  if (item.icon) record.icon = item.icon;
  if (verified) {
    record.verified = compactVerifiedMeta(verified);
  }
  return { champ: item.champ, ...record, _sourceOrder: item.index };
}

function mapAddition(item, additionIndex) {
  const platform = item.type === 'Wild Rift' ? 'wild-rift' : 'pc';
  const id = item.id || `${slugify(item.champ)}::${slugify(item.skin)}::${platform}`;
  const cardCandidates = unique([item.image, ...(item.fallbacks || [])]);
  const fullscreenCandidates = unique([item.fullImage, ...(item.fullHdFallbacks || []), ...cardCandidates]);
  const record = {
    id,
    skin: item.skin,
    type: item.type === 'Wild Rift' ? 'Wild Rift' : 'PC',
    ...(item.releaseDate ? { releaseDate: item.releaseDate } : {}),
    image: cardCandidates[0] || item.image,
    fallbacks: cardCandidates.slice(1),
    fullImage: fullscreenCandidates[0] || item.image,
    fullHdFallbacks: fullscreenCandidates.slice(1),
  };
  if (item.icon) record.icon = item.icon;
  return { champ: item.champ, ...record, _sourceOrder: legacy.length + additionIndex };
}

function compactVerifiedMeta(meta) {
  const result = {};
  for (const key of ['width', 'height', 'bytes', 'source', 'verifiedAt']) {
    if (meta?.[key] !== undefined && meta?.[key] !== null) result[key] = meta[key];
  }
  return result;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const platform = item.type === 'Wild Rift' ? 'wild-rift' : 'pc';
    const key = `${slugify(item.champ)}::${slugify(item.skin)}::${platform}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isHiddenDuplicate(item) {
  const platform = item.type === 'Wild Rift' ? 'wild-rift' : 'pc';
  return HIDDEN_DUPLICATE_SPLASHES.has(`${slugify(item.champ)}::${slugify(item.skin)}::${platform}`);
}

function groupAndSort(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.champ)) groups.set(item.champ, []);
    groups.get(item.champ).push(item);
  }

  const sortedChampionNames = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  const result = {};

  for (const champion of sortedChampionNames) {
    const order = KNOWN_ORDERS.get(champion);
    const skins = groups.get(champion);
    if (order) {
      skins.sort((a, b) => knownOrder(a, order) - knownOrder(b, order) || a._sourceOrder - b._sourceOrder);
    } else {
      skins.sort((a, b) => a._sourceOrder - b._sourceOrder);
    }

    result[champion] = skins.map(({ champ, _sourceOrder, ...skin }) => skin);
  }

  return result;
}

function buildOrder(values) {
  return new Map(values.map((value, index) => [value, index]));
}

function knownOrder(item, order) {
  const platform = item.type === 'Wild Rift' ? 'wild-rift' : 'pc';
  return order.get(`${item.skin}::${platform}`) ?? order.get(item.skin) ?? Number.MAX_SAFE_INTEGER;
}

function cardImageCandidates(candidates) {
  const standardWikiCandidates = candidates.flatMap(wikiStandardCandidates);
  const nonHdCandidates = candidates.filter((source) => !isWikiHighDefinitionSource(source));
  return unique([...standardWikiCandidates, ...nonHdCandidates, ...candidates]);
}

function highResolutionImageCandidates(candidates) {
  const hdCandidates = candidates.filter(isWikiHighDefinitionSource);
  return unique([...hdCandidates.flatMap(wikiOriginalCandidates), ...hdCandidates]);
}

function wikiStandardCandidates(url) {
  if (!isWikiHighDefinitionSource(url)) return [];
  const filename = wikiFilename(url);
  if (!filename) return [];
  const standardFilename = filename.replace(/_HD(?=\.(?:jpe?g|png|webp)$)/i, '');
  if (standardFilename === filename) return [];
  return [`https://wiki.leagueoflegends.com/en-us/Special:Redirect/file/${encodeURIComponent(standardFilename)}`];
}

function isWikiHighDefinitionSource(url) {
  const filename = wikiFilename(url);
  return Boolean(filename && /_HD\.(?:jpe?g|png|webp)$/i.test(filename));
}

function wikiFilename(url) {
  if (!url || !/wiki\.leagueoflegends\.com\/en-us\//i.test(url)) return '';
  const rawFilename = url.split('/').pop() || '';
  try {
    return decodeURIComponent(rawFilename.split(/[?#]/)[0]);
  } catch {
    return rawFilename.split(/[?#]/)[0];
  }
}

function legacyImageCandidates(url) {
  return unique([...wikiOriginalCandidates(url), url]);
}

function wikiOriginalCandidates(url) {
  if (!url || !/wiki\.leagueoflegends\.com\/en-us\/images\//i.test(url)) return [];
  const filename = wikiFilename(url);
  if (!filename) return [];
  return [`https://wiki.leagueoflegends.com/en-us/Special:Redirect/file/${encodeURIComponent(filename)}`];
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function slugify(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
