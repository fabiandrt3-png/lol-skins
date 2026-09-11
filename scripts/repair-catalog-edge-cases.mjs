import fs from 'node:fs';

const CATALOG_FILE = 'data/image-overrides.json';
const VERSION_FILE = 'version.json';
const WIKI_API = 'https://wiki.leagueoflegends.com/en-us/api.php';
const USER_AGENT = 'lol-skins-edge-case-repair/1.0 (+https://github.com/fabiandrt3-png/lol-skins)';

const data = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
if (!Array.isArray(data.catalog)) throw new Error('Missing catalog array');

let changed = false;
const resolved = [];
const unresolved = [];

const prestige2022 = [
  ['Aatrox', 'Prestige Blood Moon Aatrox (2022)', 'Aatrox_PrestigeBloodMoon', ['blood', 'moon']],
  ['Ahri', 'Prestige K/DA Ahri (2022)', 'Ahri_PrestigeKDA', ['k', 'da']],
  ['Akali', 'Prestige K/DA Akali (2022)', 'Akali_PrestigeKDA', ['k', 'da']],
  ['Caitlyn', 'Prestige Arcade Caitlyn (2022)', 'Caitlyn_PrestigeArcade', ['arcade']],
  ['Evelynn', 'Prestige K/DA Evelynn (2022)', 'Evelynn_PrestigeKDA', ['k', 'da']],
  ['Fizz', 'Prestige Fuzz Fizz (2022)', 'Fizz_PrestigeFuzz', ['fuzz']],
  ['Irelia', 'Prestige PROJECT: Irelia (2022)', 'Irelia_PrestigePROJECT', ['project']],
  ["Kai'Sa", "Prestige K/DA Kai'Sa (2022)", "Kai'Sa_PrestigeKDA", ['k', 'da']],
  ['Lee Sin', 'Prestige Nightbringer Lee Sin (2022)', 'Lee_Sin_PrestigeNightbringer', ['nightbringer']],
  ['Lux', 'Prestige Battle Academia Lux (2022)', 'Lux_PrestigeBattleAcademia', ['battle', 'academia']],
  ['Miss Fortune', 'Prestige Bewitching Miss Fortune (2022)', 'Miss_Fortune_PrestigeBewitching', ['bewitching']],
  ['Neeko', 'Prestige Star Guardian Neeko (2022)', 'Neeko_PrestigeStarGuardian', ['star', 'guardian']],
  ['Qiyana', 'Prestige True Damage Qiyana (2022)', 'Qiyana_PrestigeTrueDamage', ['true', 'damage']],
  ['Riven', 'Prestige Valiant Sword Riven (2022)', 'Riven_PrestigeValiantSword', ['valiant', 'sword']],
  ['Thresh', 'Prestige Pulsefire Thresh (2022)', 'Thresh_PrestigePulsefire', ['pulsefire']],
  ['Vayne', 'Prestige Firecracker Vayne (2022)', 'Vayne_PrestigeFirecracker', ['firecracker']],
];

const nunuPC = [
  ['Classic Nunu & Willump', 'Original'],
  ['Sasquatch Nunu & Willump', 'Sasquatch'],
  ['Workshop Nunu & Willump', 'Workshop'],
  ['Grungy Nunu & Willump', 'Grungy'],
  ['Nunu & Willump Bot', 'NunuBot'],
  ['Demolisher Nunu & Willump', 'Demolisher'],
  ['TPA Nunu & Willump', 'TPA'],
  ['Zombie Nunu & Willump', 'Zombie'],
  ['Papercraft Nunu & Willump', 'Papercraft'],
  ['Space Groove Nunu & Willump', 'SpaceGroove'],
  ['Nunu & Beelump', 'Nunu&Beelump'],
  ['Cosmic Paladins Nunu & Willump', 'CosmicPaladins'],
  ['Fright Night Nunu & Willump', 'FrightNight'],
];

const nunuWR = [
  ['Classic Nunu & Willump', 'Original'],
  ['Grungy Nunu & Willump', 'Grungy'],
  ['Zombie Nunu & Willump', 'Zombie'],
  ['Space Groove Nunu & Willump', 'SpaceGroove'],
  ['Nunu & Beelump', 'Nunu&Beelump'],
  ['Dreambuilder Nunu & Willump', 'Dreambuilder'],
];

for (const [champion, skin, stem, coreWords] of prestige2022) {
  const existing2022 = findCatalog(champion, skin, 'PC');
  if (existing2022) continue;

  const currentCard = await resolveFile(`${stem}(2022)Skin.jpg`);
  const currentHd = await resolveFile(`${stem}(2022)Skin_HD.jpg`);
  if (!currentCard && !currentHd) {
    unresolved.push(`${champion} — ${skin}`);
    continue;
  }

  // The Wiki's canonical Prestige file points at the 2022 Special Edition art.
  // Move the pre-2022 entry back to the verified _old artwork before adding 2022,
  // so the app never shows the same splash for both editions.
  const legacy = data.catalog.find((item) => {
    if (normalize(item?.champ) !== normalize(champion)) return false;
    if (item?.type === 'Wild Rift') return false;
    const value = normalize(item?.skin);
    if (!value.includes('prestige') || value.includes('2022')) return false;
    return coreWords.every((word) => value.includes(normalize(word)));
  });

  if (legacy) {
    const oldCard = await resolveFile(`${stem}Skin_old.jpg`);
    const oldHd = await resolveFile(`${stem}Skin_old_HD.jpg`);
    if (oldCard || oldHd) {
      const cardUrl = oldCard?.url || oldHd.url;
      const hdUrl = oldHd?.url || oldCard?.url;
      if (legacy.image !== cardUrl) {
        legacy.image = cardUrl;
        changed = true;
      }
      if (hdUrl && legacy.fullImage !== hdUrl) {
        legacy.fullImage = hdUrl;
        changed = true;
      }
      legacy.sourceKind = 'wiki-prestige-original-edition';
      legacy.cardSource = 'league-wiki-original-edition';
      if (hdUrl) legacy.hdSource = 'league-wiki-original-edition-hd';
    }
  }

  const card = currentCard?.url || currentHd.url;
  const full = currentHd?.url || currentCard?.url;
  insertAfterChampion({
    id: `${slugify(champion)}::${slugify(skin)}::pc`,
    champ: champion,
    skin,
    image: card,
    ...(full ? { fullImage: full } : {}),
    sourceKind: 'wiki-prestige-2022-special-edition',
    cardSource: 'league-wiki-current-client',
    ...(currentHd ? { hdSource: 'league-wiki-hd-maximum' } : {}),
  });
  resolved.push(`${champion} — ${skin}`);
}

for (const [skin, token] of nunuPC) {
  await ensureNunu(skin, token, false);
}
for (const [skin, token] of nunuWR) {
  await ensureNunu(skin, token, true);
}

if (changed) {
  data.catalogGeneratedAt = new Date().toISOString();
  data.catalogStrategy = 'single runtime catalogue; champions A-Z; existing per-champion skin order preserved; distinct chroma splash arts stay immediately after their parent skin; Prestige 2022 special editions and Nunu & Willump filename aliases resolved explicitly; duplicate artwork remains excluded';
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(data, null, 2) + '\n');
  bumpVersion();
}

console.log(JSON.stringify({ changed, resolved: resolved.length, unresolved }, null, 2));
if (unresolved.length) {
  throw new Error(`Could not resolve ${unresolved.length} catalog edge case(s)`);
}

async function ensureNunu(skin, token, isWildRift) {
  const type = isWildRift ? 'Wild Rift' : 'PC';
  if (findCatalog('Nunu & Willump', skin, type)) return;

  const suffix = isWildRift ? '_WR' : '';
  const card = await resolveFile(`Nunu_${token}Skin${suffix}.jpg`);
  const hd = await resolveFile(`Nunu_${token}Skin${suffix}_HD.jpg`);
  if (!card && !hd) {
    unresolved.push(`Nunu & Willump — ${skin} (${type})`);
    return;
  }

  insertAfterChampion({
    id: `nunu-willump::${slugify(skin)}::${isWildRift ? 'wild-rift' : 'pc'}`,
    champ: 'Nunu & Willump',
    skin,
    ...(isWildRift ? { type: 'Wild Rift' } : {}),
    image: card?.url || hd.url,
    ...(hd?.url ? { fullImage: hd.url, hdSource: isWildRift ? 'league-wiki-wr-hd-maximum' : 'league-wiki-hd-maximum' } : {}),
    sourceKind: 'wiki-catalog-nunu-alias',
    cardSource: 'league-wiki-current-client',
  });
  resolved.push(`Nunu & Willump — ${skin} (${type})`);
}

function findCatalog(champion, skin, type) {
  return data.catalog.find((item) =>
    normalize(item?.champ) === normalize(champion)
    && normalize(item?.skin) === normalize(skin)
    && (item?.type === 'Wild Rift' ? 'Wild Rift' : 'PC') === type
  );
}

function insertAfterChampion(item) {
  let index = -1;
  for (let i = data.catalog.length - 1; i >= 0; i -= 1) {
    if (normalize(data.catalog[i]?.champ) === normalize(item.champ)) {
      index = i + 1;
      break;
    }
  }
  data.catalog.splice(index >= 0 ? index : data.catalog.length, 0, item);
  changed = true;
}

async function resolveFile(filename) {
  const url = new URL(WIKI_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|size');
  url.searchParams.set('titles', `File:${filename}`);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!response.ok) return null;
    const json = await response.json();
    const page = json?.query?.pages?.[0];
    const info = page?.imageinfo?.[0];
    if (!info?.url) return null;
    return { url: info.url, width: info.width || 0, height: info.height || 0, title: page.title };
  } catch {
    return null;
  }
}

function bumpVersion() {
  if (!fs.existsSync(VERSION_FILE)) return;
  const version = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  const current = String(version.version || '');
  const match = current.match(/^(.*-)(\d+)$/);
  version.version = match ? `${match[1]}${Number(match[2]) + 1}` : `${current || 'catalog'}-1`;
  fs.writeFileSync(VERSION_FILE, JSON.stringify(version, null, 2) + '\n');
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function slugify(value = '') {
  return normalize(value).replace(/\s+/g, '-');
}
