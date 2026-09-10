const LEGACY_SOURCE = "legacy/index-original.html";
const VERIFIED_IMAGE_MAP = "data/image-overrides.json";
const NEW_SKINS_SOURCE = "data/new-skins.json";
const ENTRY_FIELDS = ["champ", "skin", "image", "icon", "type"];
const APP_ASSET_VERSION = new URL(import.meta.url).searchParams.get("v");

let skinDataPromise;

/**
 * Runtime loader kept intentionally small: the weekly audit already resolves
 * and verifies historical splash sources, so the browser only needs the historical
 * catalog, the verified URL map, and the small additions file. No live metadata request
 * is necessary while the user is browsing the app.
 */
export function loadSkinData() {
  if (!skinDataPromise) {
    skinDataPromise = Promise.all([
      fetchText(LEGACY_SOURCE),
      loadVerifiedImageMap(),
      loadNewSkins(),
    ]).then(([source, verifiedImages, newSkins]) => {
      const historicalData = parseLegacyCatalog(source);
      const historicalSkins = historicalData.map((item, index) => mapHistoricalSkin(item, index, verifiedImages));
      const additions = newSkins.map(mapNewSkin);

      // Historical IDs stay untouched; additions are appended afterwards so
      // each champion keeps its existing chronological order.
      return [...historicalSkins, ...additions].filter((item) => !isHiddenSkin(item));
    });
  }

  return skinDataPromise;
}

function mapHistoricalSkin(item, index, verifiedImages) {
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
}

function mapNewSkin(item) {
  const id = item.id || `${slugify(item.champ)}::${slugify(item.skin)}::${slugify(item.type || "pc")}`;
  const imageCandidates = unique([item.image, ...(item.fallbacks || [])]);
  const fullImageCandidates = unique([item.fullImage, ...(item.fullFallbacks || []), ...imageCandidates]);

  return {
    champ: item.champ,
    skin: item.skin,
    ...(item.type ? { type: item.type } : {}),
    _id: id,
    _legacyImage: item.image,
    _verifiedImageMeta: null,
    imageCandidates,
    fullImageCandidates,
    iconCandidates: unique([item.icon]),
    image: imageCandidates[0] || item.image,
    fullImage: fullImageCandidates[0] || imageCandidates[0] || item.image,
  };
}

function isHiddenSkin(item) {
  return item.champ === "Ahri" && item.skin === "Foxfire Ahri" && item.type === "Wild Rift";
}

async function loadNewSkins() {
  try {
    const response = await fetch(versionedAppAsset(NEW_SKINS_SOURCE), { cache: "default" });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`Nouveaux skins (${response.status})`);
    const payload = await response.json();
    const entries = Array.isArray(payload) ? payload : payload?.entries;
    return Array.isArray(entries)
      ? entries.filter((item) => item?.champ && item?.skin && item?.image)
      : [];
  } catch (error) {
    console.warn("Catalogue des nouveaux skins indisponible.", error);
    return [];
  }
}

function versionedAppAsset(url) {
  if (!APP_ASSET_VERSION) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(APP_ASSET_VERSION)}`;
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
