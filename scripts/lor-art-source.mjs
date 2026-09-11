import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
export const LOR_ART_FILE = path.join(ROOT, 'data', 'lor-art.json');

let cachedIndex;

export function loadLorArtIndex() {
  if (cachedIndex !== undefined) return cachedIndex;

  try {
    const payload = JSON.parse(fs.readFileSync(LOR_ART_FILE, 'utf8'));
    cachedIndex = payload && typeof payload === 'object' ? payload : emptyIndex();
  } catch {
    cachedIndex = emptyIndex();
  }

  return cachedIndex;
}

export function lorCandidatesForEntry(entry, index = loadLorArtIndex()) {
  if (!entry?.champ || !entry?.skin || entry.type === 'Wild Rift') return [];

  const explicit = explicitMatches(entry, index);
  if (explicit.length) return explicit;

  // LoR champion cards are alternate official illustrations, not the same LoL
  // splash. They are therefore only a last-resort fallback for the PC classic
  // champion unless a skin-specific match has been explicitly curated above.
  if (!isClassicSkin(entry)) return [];

  const champion = index?.champions?.[normalize(entry.champ)];
  const arts = Array.isArray(champion?.arts) ? champion.arts : [];

  return uniqueCandidates(arts.map((art) => ({
    url: art?.url,
    source: 'riot-lor-full-art',
    semantic: 'fallback-official-alternate',
    cardCode: art?.cardCode || null,
    set: art?.set || null,
  })));
}

function explicitMatches(entry, index) {
  const keys = unique([
    entry.id,
    entry._id,
    `${normalize(entry.champ)}::${normalize(entry.skin)}`,
  ]);

  const values = [];
  for (const key of keys) {
    const mapped = index?.matches?.[key];
    if (!mapped) continue;
    for (const item of Array.isArray(mapped) ? mapped : [mapped]) {
      if (typeof item === 'string') {
        values.push({ url: item, source: 'riot-lor-full-art', semantic: 'exact-curated' });
      } else if (item?.url) {
        values.push({
          url: item.url,
          source: 'riot-lor-full-art',
          semantic: 'exact-curated',
          cardCode: item.cardCode || null,
          set: item.set || null,
        });
      }
    }
  }
  return uniqueCandidates(values);
}

function isClassicSkin(entry) {
  const champion = normalize(entry.champ);
  const skin = normalize(entry.skin)
    .replace(/^classic\s+/, '')
    .replace(/\s+classic$/, '')
    .trim();
  return Boolean(champion && skin === champion);
}

function emptyIndex() {
  return { champions: {}, matches: {} };
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

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function uniqueCandidates(values) {
  const seen = new Set();
  const result = [];
  for (const item of values || []) {
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    result.push(item);
  }
  return result;
}
