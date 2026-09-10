const LEGACY_SOURCE = "legacy/index-original.html";
const VERIFIED_IMAGE_MAP = "data/image-overrides.json";
const NEW_SKINS_SOURCE = "data/new-skins.json";
const POST_CUTOFF_SOURCE = "data/post-cutoff-additions.js";
const ENTRY_FIELDS = ["champ", "skin", "image", "icon", "type"];
const APP_ASSET_VERSION = new URL(import.meta.url).searchParams.get("v");

let skinDataPromise;

export function loadSkinData() {
  if (!skinDataPromise) {
    skinDataPromise = Promise.all([
      fetchText(LEGACY_SOURCE),
      loadVerifiedImageMap(),
      loadNewSkins(),
      loadPostCutoffSkins(),
    ]).then(([source, verifiedImages, newSkins, postCutoffSkins]) => {
      const historicalData = parseLegacyCatalog(source);
      const historicalSkins = historicalData.map((item, index) => mapHistoricalSkin(item, index, verifiedImages));
      const additions = [...newSkins, ...postCutoffSkins].map(mapNewSkin);

      // Some historical entries were manually added after the repository was created.
      // Keep the oldest occurrence and prevent the post-cutoff feed from duplicating it.
      return dedupeSkins([...historicalSkins, ...additions]).filter((item) => !isHiddenSkin(item));
    });
  }

  return skinDataPromise;
}

function mapHistoricalSkin(item, index, verifiedImages) {
  const id = `${slugify(item.champ)}::${slugify(item.skin)}::${index}`;
  const verified = verifiedImages[id] || null;
  const verifiedCandidates = unique([verified?.url, ...(verified?.fallbacks || [])]);
  const legacyCandidates = legacyImageCandidates(item.image);
  const allCandidates = unique([...verifiedCandidates, ...legacyCandidates]);
  const imageCandidates = cardImageCandidates(allCandidates);
  const highResImageCandidates = highResolutionImageCandidates(allCandidates);

  return {
    ...item,
    _id: id,
    _legacyImage: item.image,
    _verifiedImageMeta: verified,
    imageCandidates,
    highResImageCandidates,
    iconCandidates: unique([item.icon]),
    image: imageCandidates[0] || item.image,
  };
}

function mapNewSkin(item) {
  const id = item.id || `${slugify(item.champ)}::${slugify(item.skin)}::${slugify(item.type || "pc")}`;
  const imageCandidates = unique([item.image, ...(item.fallbacks || [])]);
  const highResImageCandidates = unique([item.fullImage, ...(item.fullHdFallbacks || [])]);

  return {
    champ: item.champ,
    skin: item.skin,
    ...(item.type ? { type: item.type } : {}),
    ...(item.releaseDate ? { releaseDate: item.releaseDate } : {}),
    _id: id,
    _legacyImage: item.image,
    _verifiedImageMeta: null,
    imageCandidates,
    highResImageCandidates,
    iconCandidates: unique([item.icon]),
    image: imageCandidates[0] || item.image,
  };
}

function dedupeSkins(items) {
  const seen = new Set();
  return items.filter((item) => {
    const platform = item.type === "Wild Rift" ? "wild-rift" : "pc";
    const key = `${slugify(item.champ)}::${slugify(item.skin)}::${platform}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    return validSkinEntries(entries);
  } catch (error) {
    console.warn("Catalogue des nouveaux skins indisponible.", error);
    return [];
  }
}

async function loadPostCutoffSkins() {
  try {
    const module = await import(versionedAppAsset(`./${POST_CUTOFF_SOURCE}`));
    return validSkinEntries(module?.postCutoffAdditions);
  } catch (error) {
    console.warn("Catalogue postérieur à la création du projet indisponible.", error);
    return [];
  }
}

function validSkinEntries(entries) {
  return Array.isArray(entries)
    ? entries.filter((item) => item?.champ && item?.skin && item?.image)
    : [];
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

function cardImageCandidates(candidates) {
  const standardWikiCandidates = candidates.flatMap(wikiStandardCandidates);
  const nonHdCandidates = candidates.filter((source) => !isWikiHighDefinitionSource(source));
  return unique([...standardWikiCandidates, ...nonHdCandidates, ...candidates]);
}

function highResolutionImageCandidates(candidates) {
  const hdCandidates = candidates.filter(isWikiHighDefinitionSource);
  return unique([
    ...hdCandidates.flatMap(wikiOriginalCandidates),
    ...hdCandidates,
  ]);
}

function wikiStandardCandidates(url) {
  if (!isWikiHighDefinitionSource(url)) return [];
  const filename = wikiFilename(url);
  if (!filename) return [];
  const standardFilename = filename.replace(/_HD(?=\.(?:jpe?g|png|webp)$)/i, "");
  if (standardFilename === filename) return [];
  return [`https://wiki.leagueoflegends.com/en-us/Special:Redirect/file/${encodeURIComponent(standardFilename)}`];
}

function isWikiHighDefinitionSource(url) {
  const filename = wikiFilename(url);
  return Boolean(filename && /_HD\.(?:jpe?g|png|webp)$/i.test(filename));
}

function wikiFilename(url) {
  if (!url || !/wiki\.leagueoflegends\.com\/en-us\//i.test(url)) return "";
  const rawFilename = url.split("/").pop() || "";
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

export function slugify(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
