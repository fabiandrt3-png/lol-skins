const LEGACY_SOURCE = "legacy/index-original.html";
const VERIFIED_IMAGE_MAP = "data/image-overrides.json";
const ENTRY_FIELDS = ["champ", "skin", "image", "icon", "type"];

let skinDataPromise;

/**
 * Runtime loader kept intentionally small: the weekly audit already resolves
 * and verifies splash sources, so the browser only needs the historical
 * catalog plus the verified URL map. No Riot/CommunityDragon metadata request
 * is necessary while the user is browsing the app.
 */
export function loadSkinData() {
  if (!skinDataPromise) {
    skinDataPromise = Promise.all([
      fetchText(LEGACY_SOURCE),
      loadVerifiedImageMap(),
    ]).then(([source, verifiedImages]) => {
      const data = parseLegacyCatalog(source);

      return data.map((item, index) => {
        const id = `${slugify(item.champ)}::${slugify(item.skin)}::${index}`;
        const verified = verifiedImages[id] || null;
        const verifiedCandidates = unique([verified?.url, ...(verified?.fallbacks || [])]);
        const legacyCandidates = legacyImageCandidates(item.image);
        const imageCandidates = unique([...verifiedCandidates, ...legacyCandidates]);

        return {
          ...item,
          _id: id,
          _legacyImage: item.image,
          _verifiedImageMeta: verified,
          imageCandidates,
          iconCandidates: unique([item.icon]),
          image: imageCandidates[0] || item.image,
        };
      });
    });
  }

  return skinDataPromise;
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "default" });
  if (!response.ok) throw new Error(`Impossible de charger ${url} (${response.status})`);
  return response.text();
}

async function loadVerifiedImageMap() {
  try {
    const response = await fetch(VERIFIED_IMAGE_MAP, { cache: "default" });
    if (response.status === 404) return {};
    if (!response.ok) throw new Error(`Carte d’images vérifiées (${response.status})`);
    const payload = await response.json();
    return payload?.entries || {};
  } catch (error) {
    console.warn("Carte d’images vérifiées indisponible, utilisation des sources historiques.", error);
    return {};
  }
}

function parseLegacyCatalog(source) {
  const declaration = "const championsSkins = [";
  const declarationIndex = source.indexOf(declaration);
  if (declarationIndex === -1) throw new Error("La collection championsSkins est introuvable.");

  const arrayStart = source.indexOf("[", declarationIndex);
  const arrayEnd = source.indexOf("];", arrayStart);
  if (arrayStart === -1 || arrayEnd === -1) throw new Error("La collection championsSkins est incomplète.");

  const arraySource = source.slice(arrayStart + 1, arrayEnd);
  const entries = [];
  const objectPattern = /\{([^{}]*)\}/g;
  let match;

  while ((match = objectPattern.exec(arraySource))) {
    const body = match[1];
    const item = {};

    for (const field of ENTRY_FIELDS) {
      const fieldPattern = new RegExp(`\\b${field}\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"`);
      const fieldMatch = fieldPattern.exec(body);
      if (fieldMatch) item[field] = decodeString(fieldMatch[1]);
    }

    if (item.champ && item.skin && item.image) entries.push(item);
  }

  if (!entries.length) throw new Error("Aucune entrée de skin n’a pu être lue.");
  return entries;
}

function decodeString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function legacyImageCandidates(url) {
  return unique([...wikiOriginalCandidates(url), url]);
}

function wikiOriginalCandidates(url) {
  if (!url || !/wiki\.leagueoflegends\.com\/en-us\/images\//i.test(url)) return [];
  const rawFilename = url.split("/").pop() || "";
  const filename = decodeURIComponent(rawFilename.split(/[?#]/)[0]);
  if (!filename) return [];
  return [`https://wiki.leagueoflegends.com/en-us/Special:Redirect/file/${encodeURIComponent(filename)}`];
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

export function slugify(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
