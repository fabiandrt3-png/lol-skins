import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const LEGACY_FILE = path.join(ROOT, 'legacy', 'index-original.html');
const NEW_SKINS_FILE = path.join(ROOT, 'data', 'new-skins.json');
const POST_CUTOFF_FILE = path.join(ROOT, 'data', 'post-cutoff-additions.js');
const OUTPUT_FILE = path.join(ROOT, 'data', 'image-overrides.json');
const ENTRY_FIELDS = ['champ', 'skin', 'image', 'icon', 'type'];

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

const HIDDEN_DUPLICATE_SPLASHES = new Set([
  'ahri::classic-ahri::wild-rift',
  'ahri::popstar-ahri::wild-rift',
]);

const existing = readJson(OUTPUT_FILE, { entries: {} });
const legacy = readLegacyEntries();
const recent = readJson(NEW_SKINS_FILE, []);
const postCutoffModule = await import(`${pathToFileURL(POST_CUTOFF_FILE).href}?v=${Date.now()}`);
const postCutoff = Array.isArray(postCutoffModule.postCutoffAdditions) ? postCutoffModule.postCutoffAdditions : [];

let catalog = [
  ...legacy.map((item, index) => ({
    id: `${slugify(item.champ)}::${slugify(item.skin)}::${index}`,
    champ: item.champ,
    skin: item.skin,
    image: item.image,
    ...(item.icon ? { icon: item.icon } : {}),
    ...(item.type ? { type: item.type } : {}),
    sourceKind: 'legacy',
  })),
  ...recent.filter(validSkin).map((item) => normalizeAddition(item, 'new-skins')),
  ...postCutoff.filter(validSkin).map((item) => normalizeAddition(item, 'post-cutoff')),
];

catalog = dedupeSkins(catalog).filter((item) => !isHiddenDuplicateSplash(item));
catalog = sortChampion(catalog, 'Aatrox', AATROX_ORDER);
catalog = sortChampion(catalog, 'Ahri', AHRI_ORDER);
catalog = sortChampion(catalog, 'Akali', AKALI_ORDER);

const output = {
  ...existing,
  generatedAt: existing.generatedAt || new Date().toISOString(),
  strategy: existing.strategy || 'best verified resolution within semantically-correct candidates; stable fallbacks retained',
  catalogGeneratedAt: new Date().toISOString(),
  catalogStrategy: 'single runtime catalogue; unique artwork only; distinct chroma splash arts grouped after their parent skin',
  catalog,
  entries: existing.entries && !Array.isArray(existing.entries) ? existing.entries : {},
};

fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Centralized ${catalog.length} skin records in data/image-overrides.json`);

function normalizeAddition(item, sourceKind) {
  const id = item.id || `${slugify(item.champ)}::${slugify(item.skin)}::${slugify(item.type || 'pc')}`;
  return {
    id,
    champ: item.champ,
    skin: item.skin,
    ...(item.type ? { type: item.type } : {}),
    ...(item.releaseDate ? { releaseDate: item.releaseDate } : {}),
    image: item.image,
    ...(Array.isArray(item.fallbacks) && item.fallbacks.length ? { fallbacks: unique(item.fallbacks) } : {}),
    ...(item.fullImage ? { fullImage: item.fullImage } : {}),
    ...(Array.isArray(item.fullHdFallbacks) && item.fullHdFallbacks.length ? { fullHdFallbacks: unique(item.fullHdFallbacks) } : {}),
    ...(item.icon ? { icon: item.icon } : {}),
    sourceKind,
  };
}

function dedupeSkins(items) {
  const seen = new Set();
  return items.filter((item) => {
    const platform = item.type === 'Wild Rift' ? 'wild-rift' : 'pc';
    const key = `${slugify(item.champ)}::${slugify(item.skin)}::${platform}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isHiddenDuplicateSplash(item) {
  const platform = item.type === 'Wild Rift' ? 'wild-rift' : 'pc';
  return HIDDEN_DUPLICATE_SPLASHES.has(`${slugify(item.champ)}::${slugify(item.skin)}::${platform}`);
}

function sortChampion(items, champion, order) {
  const chronology = new Map(order.map((name, index) => [name, index]));
  const championItems = [];
  const remainder = [];
  let insertAt = -1;

  for (const item of items) {
    if (item.champ === champion) {
      if (insertAt === -1) insertAt = remainder.length;
      championItems.push(item);
    } else {
      remainder.push(item);
    }
  }

  if (championItems.length < 2) return items;
  championItems.sort((a, b) => knownOrder(a, chronology) - knownOrder(b, chronology));
  remainder.splice(insertAt, 0, ...championItems);
  return remainder;
}

function knownOrder(item, chronology) {
  const platform = item.type === 'Wild Rift' ? 'wild-rift' : 'pc';
  return chronology.get(`${item.skin}::${platform}`)
    ?? chronology.get(item.skin)
    ?? Number.MAX_SAFE_INTEGER;
}

function readLegacyEntries() {
  const source = fs.readFileSync(LEGACY_FILE, 'utf8');
  const declaration = 'const championsSkins = [';
  const declarationIndex = source.indexOf(declaration);
  if (declarationIndex === -1) throw new Error('championsSkins introuvable dans le fichier legacy');

  const arrayStart = source.indexOf('[', declarationIndex);
  const arrayEnd = source.indexOf('];', arrayStart);
  if (arrayStart === -1 || arrayEnd === -1) throw new Error('Collection championsSkins incomplète');

  const arraySource = source.slice(arrayStart + 1, arrayEnd);
  const objectPattern = /\{([^{}]*)\}/g;
  const entries = [];
  let match;

  while ((match = objectPattern.exec(arraySource))) {
    const body = match[1];
    const item = {};
    for (const field of ENTRY_FIELDS) {
      const fieldPattern = new RegExp(`\\b${field}\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"`);
      const fieldMatch = fieldPattern.exec(body);
      if (fieldMatch) item[field] = decodeString(fieldMatch[1]);
    }
    if (validSkin(item)) entries.push(item);
  }

  if (!entries.length) throw new Error('Aucune entrée legacy lisible');
  return entries;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function validSkin(item) {
  return Boolean(item?.champ && item?.skin && item?.image);
}

function decodeString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function slugify(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}
