const VERIFIED_IMAGE_MAP = "data/image-overrides.json";
const CATALOG_SOURCE = VERIFIED_IMAGE_MAP;
const MANUAL_SKINS_SOURCE = "data/manual-skins.txt";
const LOR_SKINS_SOURCE = "data/lor-skins.json";
const APP_ASSET_VERSION = new URL(import.meta.url).searchParams.get("v");
const CARD_PREVIEW_WIDTH = 2560;

let skinDataPromise;

export function loadSkinData() {
  if (!skinDataPromise) {
    skinDataPromise = Promise.all([
      fetch(versionedAppAsset(CATALOG_SOURCE), { cache: "default" }).then(async (response) => {
        if (!response.ok) throw new Error(`Central catalog (${response.status})`);
        return response.json();
      }),
      loadManualSkins(),
      loadLorSkins(),
    ]).then(([payload, manualSkins, lorSkins]) => {
      const catalog = payload?.catalog;
      const verifiedImages = payload?.entries;

      if (!Array.isArray(catalog) || !catalog.length) {
        throw new Error("The central catalog is empty or invalid.");
      }

      const verifiedMap = verifiedImages && !Array.isArray(verifiedImages) ? verifiedImages : {};
      const withLor = mergeLorSkins(catalog, lorSkins);
      const mergedCatalog = mergeManualSkins(withLor, manualSkins);
      return mergedCatalog.filter(validSkinEntry).map((item) => mapCatalogSkin(item, verifiedMap));
    });
  }

  return skinDataPromise;
}

async function loadManualSkins() {
  try {
    const response = await fetch(`${MANUAL_SKINS_SOURCE}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return [];
    return parseManualSkins(await response.text());
  } catch (error) {
    console.warn("Manual skins file unavailable; using the main catalog.", error);
    return [];
  }
}

async function loadLorSkins() {
  try {
    const response = await fetch(versionedAppAsset(LOR_SKINS_SOURCE), { cache: "default" });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload?.entries) ? payload.entries : [];
  } catch (error) {
    console.warn("Legends of Runeterra skin catalog unavailable; continuing without LoR entries.", error);
    return [];
  }
}

function parseManualSkins(text) {
  const rows = String(text || "").split(/\r?\n/);
  const result = [];

  rows.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;

    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 4) {
      console.warn(`Manual skin ignored at line ${index + 1}: incomplete format.`);
      return;
    }

    const [champ, skin, rawType, image, fullImage = "", afterSkin = ""] = parts;
    if (!champ || !skin || !image) {
      console.warn(`Manual skin ignored at line ${index + 1}: missing champion, skin or image.`);
      return;
    }

    const type = normalizeManualType(rawType);
    const id = `${slugify(champ)}::${slugify(skin)}::${platformSlug(type)}`;

    result.push({
      id,
      champ,
      skin,
      image,
      ...(fullImage ? { fullImage } : {}),
      ...(type ? { type } : {}),
      ...(afterSkin ? { _manualAfterSkin: afterSkin } : {}),
      sourceKind: "manual",
    });
  });

  return result;
}

function normalizeManualType(value) {
  const type = String(value || "PC").trim().toLocaleLowerCase("en");
  if (["wr", "wild rift", "wild-rift", "wildrift"].includes(type)) return "Wild Rift";
  if (["lor", "legends of runeterra", "legends-of-runeterra", "runeterra"].includes(type)) return "Legends of Runeterra";
  return "PC";
}

function mergeLorSkins(catalog, lorSkins) {
  const merged = catalog.map((item) => ({ ...item }));
  const orderedLor = (lorSkins || [])
    .filter(validSkinEntry)
    .map((item, index) => ({ ...item, _lorInputIndex: index }))
    .sort(compareLorEntries);

  for (const lor of orderedLor) {
    const id = stableSkinId(lor);
    const existingIndex = merged.findIndex((item) => stableSkinId(item) === id);
    if (existingIndex >= 0) {
      if (merged[existingIndex]?.sourceKind === "lor") merged[existingIndex] = { ...merged[existingIndex], ...lor };
      continue;
    }

    let insertAt = -1;
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      if (merged[index].champ === lor.champ) {
        insertAt = index;
        break;
      }
    }

    const cleanLor = { ...lor };
    delete cleanLor._lorInputIndex;
    merged.splice(insertAt >= 0 ? insertAt + 1 : merged.length, 0, cleanLor);
  }

  return merged;
}

function compareLorEntries(a, b) {
  return String(a.champ || "").localeCompare(String(b.champ || ""), "en", { sensitivity: "base" })
    || compareReleaseDates(a.releaseDate, b.releaseDate)
    || Number(a.lorSkinIndex ?? 9999) - Number(b.lorSkinIndex ?? 9999)
    || Number(a.lorLevelNumber ?? 9999) - Number(b.lorLevelNumber ?? 9999)
    || Number(a._lorInputIndex ?? 0) - Number(b._lorInputIndex ?? 0);
}

function compareReleaseDates(left, right) {
  const a = /^\d{4}-\d{2}-\d{2}$/.test(String(left || "")) ? String(left) : "9999-12-31";
  const b = /^\d{4}-\d{2}-\d{2}$/.test(String(right || "")) ? String(right) : "9999-12-31";
  return a.localeCompare(b);
}

function mergeManualSkins(catalog, manualSkins) {
  const merged = catalog.map((item) => ({ ...item }));

  for (const manual of manualSkins) {
    const existingIndex = merged.findIndex((item) => stableSkinId(item) === manual.id);
    if (existingIndex >= 0) {
      merged[existingIndex] = { ...merged[existingIndex], ...manual };
      continue;
    }

    let insertAt = -1;
    if (manual._manualAfterSkin) {
      insertAt = merged.findIndex((item) => item.champ === manual.champ && item.skin === manual._manualAfterSkin);
    }

    if (insertAt < 0) {
      for (let index = merged.length - 1; index >= 0; index -= 1) {
        if (merged[index].champ === manual.champ) {
          insertAt = index;
          break;
        }
      }
    }

    const cleanManual = { ...manual };
    delete cleanManual._manualAfterSkin;
    merged.splice(insertAt >= 0 ? insertAt + 1 : merged.length, 0, cleanManual);
  }

  return merged;
}

function stableSkinId(item) {
  if (item?.id) return String(item.id);
  return `${slugify(item?.champ)}::${slugify(item?.skin)}::${platformSlug(item?.type)}`;
}

function platformSlug(type) {
  if (type === "Wild Rift") return "wild-rift";
  if (type === "Legends of Runeterra") return "legends-of-runeterra";
  return "pc";
}

function mapCatalogSkin(item, verifiedImages) {
  const id = item.id || `${slugify(item.champ)}::${slugify(item.skin)}::${platformSlug(item.type)}`;
  const verified = verifiedImages[id] || null;
  const isManual = item.sourceKind === "manual";
  const isChroma = isChromaSkin(item);
  const verifiedCandidates = unique([verified?.url, ...(verified?.fallbacks || [])]);
  const sourceCandidates = item.sourceKind === "legacy"
    ? legacyImageCandidates(item.image)
    : unique([item.image, ...(item.fallbacks || [])]);

  const rawExplicitFullscreenCandidates = unique([item.fullImage, ...(item.fullHdFallbacks || [])]);
  const explicitFullscreenCandidates = isChroma
    ? rawExplicitFullscreenCandidates.filter((source) => isSafeChromaFullscreenSource(source, item))
    : rawExplicitFullscreenCandidates;

  const optimizedExactCardCandidates = !isManual && shouldUseExactHdPreview(item)
    ? explicitFullscreenCandidates.flatMap((source) => wikiSizedImageCandidates(source, CARD_PREVIEW_WIDTH))
    : [];
  const cardCandidates = isManual
    ? unique([...sourceCandidates, ...verifiedCandidates])
    : unique([...verifiedCandidates, ...sourceCandidates]);
  const imageCandidates = unique([
    ...optimizedExactCardCandidates,
    ...cardImageCandidates(cardCandidates),
  ]);

  // Chromas are special: a base-skin HD splash must never replace a real chroma
  // splash in fullscreen. Keep the exact chroma source unless a fullscreen source
  // is explicitly the same image or is clearly chroma-specific.
  const highResImageCandidates = isChroma
    ? unique([
        ...explicitFullscreenCandidates,
        ...verifiedCandidates,
        ...sourceCandidates,
      ])
    : buildStandardFullscreenCandidates(item, cardCandidates, explicitFullscreenCandidates);

  return {
    champ: item.champ,
    skin: item.skin,
    ...(item.type ? { type: item.type } : {}),
    ...(item.releaseDate ? { releaseDate: item.releaseDate } : {}),
    ...(item.lorSkinName ? { lorSkinName: item.lorSkinName } : {}),
    ...(item.lorLevel ? { lorLevel: item.lorLevel } : {}),
    ...(item.lorLevelNumber ? { lorLevelNumber: item.lorLevelNumber } : {}),
    ...(item.lorCardCode ? { lorCardCode: item.lorCardCode } : {}),
    _id: id,
    _legacyImage: item.image,
    _verifiedImageMeta: verified,
    imageCandidates,
    highResImageCandidates,
    iconCandidates: unique([item.icon]),
    image: imageCandidates[0] || item.image,
  };
}

function buildStandardFullscreenCandidates(item, cardCandidates, explicitFullscreenCandidates) {
  const verifiedFullscreenCandidates = highResolutionImageCandidates(cardCandidates);
  const inferredFullscreenCandidates = explicitFullscreenCandidates.length || verifiedFullscreenCandidates.length
    ? []
    : inferredWikiHdCandidates(item);

  return unique([
    ...explicitFullscreenCandidates,
    ...verifiedFullscreenCandidates,
    ...inferredFullscreenCandidates,
  ]);
}

function isChromaSkin(item) {
  return /\bchroma\b/i.test(String(item?.skin || ""));
}

function isSafeChromaFullscreenSource(source, item) {
  if (!source) return false;
  if (sameImageSource(source, item?.image)) return true;

  let readable = String(source);
  try {
    readable = decodeURIComponent(readable);
  } catch {
    // Keep the raw URL if it is not valid percent-encoding.
  }

  return /\bchroma\b/i.test(readable);
}

function validSkinEntry(item) {
  return Boolean(item?.champ && item?.skin && item?.image);
}

function versionedAppAsset(url) {
  if (!APP_ASSET_VERSION) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(APP_ASSET_VERSION)}`;
}

function shouldUseExactHdPreview(item) {
  if (item?.sourceKind === "lor") return false;
  if (!item?.fullImage || !isWikiHighDefinitionSource(item.fullImage)) return false;
  if (isChromaSkin(item) && !isSafeChromaFullscreenSource(item.fullImage, item)) return false;
  return !isLeagueWikiSource(item.image);
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

function inferredWikiHdCandidates(item) {
  if (!item?.champ || !item?.skin || isChromaSkin(item) || item?.type === "Legends of Runeterra") return [];

  const championToken = wikiFileToken(item.champ);
  const rawSkinName = String(item.skin)
    .replace(/\(Wild Rift\)/gi, " ")
    .replace(new RegExp(escapeRegExp(item.champ), "ig"), " ")
    .replace(/\s+/g, " ")
    .trim();
  const skinToken = /^classic(?:\s|$)/i.test(rawSkinName) ? "Original" : wikiFileToken(rawSkinName);
  if (!championToken || !skinToken) return [];

  const platformSuffix = item.type === "Wild Rift" ? "_WR" : "";
  const filename = `${championToken}_${skinToken}Skin${platformSuffix}_HD.jpg`;
  return [`https://wiki.leagueoflegends.com/en-us/Special:Redirect/file/${encodeURIComponent(filename)}`];
}

function wikiFileToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wikiSizedImageCandidates(url, width) {
  if (!isWikiHighDefinitionSource(url)) return [];
  const filename = wikiFilename(url);
  if (!filename) return [];
  return [`https://wiki.leagueoflegends.com/en-us/Special:Redirect/file/${encodeURIComponent(filename)}?width=${width}`];
}

function wikiStandardCandidates(url) {
  if (!isWikiHighDefinitionSource(url)) return [];
  const filename = wikiFilename(url);
  if (!filename) return [];
  const standardFilename = filename.replace(/_HD(?=\.(?:jpe?g|png|webp)$)/i, "");
  if (standardFilename === filename) return [];
  return [`https://wiki.leagueoflegends.com/en-us/Special:Redirect/file/${encodeURIComponent(standardFilename)}`];
}

function isLeagueWikiSource(url) {
  return Boolean(url && /wiki\.leagueoflegends\.com\/en-us\//i.test(url));
}

function isWikiHighDefinitionSource(url) {
  const filename = wikiFilename(url);
  return Boolean(filename && /_HD\.(?:jpe?g|png|webp)$/i.test(filename));
}

function wikiFilename(url) {
  if (!isLeagueWikiSource(url)) return "";
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

function sameImageSource(left, right) {
  if (!left || !right) return false;

  const normalize = (value) => {
    try {
      const url = new URL(value, "https://example.invalid/");
      url.hash = "";
      url.search = "";
      return url.href;
    } catch {
      return String(value).split(/[?#]/)[0];
    }
  };

  return normalize(left) === normalize(right);
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
