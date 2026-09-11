const VERIFIED_IMAGE_MAP = "data/image-overrides.json";
const CATALOG_SOURCE = VERIFIED_IMAGE_MAP;
const MANUAL_SKINS_SOURCE = "data/manual-skins.txt";
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
    ]).then(([payload, manualSkins]) => {
      const catalog = payload?.catalog;
      const verifiedImages = payload?.entries;

      if (!Array.isArray(catalog) || !catalog.length) {
        throw new Error("The central catalog is empty or invalid.");
      }

      const verifiedMap = verifiedImages && !Array.isArray(verifiedImages) ? verifiedImages : {};
      const mergedCatalog = mergeManualSkins(catalog, manualSkins);
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
    const id = `${slugify(champ)}::${slugify(skin)}::${type === "Wild Rift" ? "wild-rift" : "pc"}`;

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
  return "PC";
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
  const platform = item?.type === "Wild Rift" ? "wild-rift" : "pc";
  return `${slugify(item?.champ)}::${slugify(item?.skin)}::${platform}`;
}

function mapCatalogSkin(item, verifiedImages) {
  const id = item.id || `${slugify(item.champ)}::${slugify(item.skin)}::${slugify(item.type || "pc")}`;
  const verified = verifiedImages[id] || null;
  const isManual = item.sourceKind === "manual";
  const isChroma = isChromaSkin(item);
  const verifiedCandidates = unique([verified?.url, ...(verified?.fallbacks || [])]);
  const lorFallbackCandidates = unique([
    ...(item.lorFallbacks || []),
    ...(verified?.lorFallbacks || []),
  ]);
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
    ...lorFallbackCandidates,
  ]);

  // Chromas are special: a base-skin HD splash must never replace a real chroma
  // splash in fullscreen. Keep the exact chroma source unless a fullscreen source
  // is explicitly the same image or is clearly chroma-specific. LoR is always
  // appended last so an alternate official illustration never outranks LoL/WR.
  const primaryFullscreenCandidates = isChroma
    ? unique([
        ...explicitFullscreenCandidates,
        ...verifiedCandidates,
        ...sourceCandidates,
      ])
    : buildStandardFullscreenCandidates(item, cardCandidates, explicitFullscreenCandidates);
  const highResImageCandidates = unique([
    ...primaryFullscreenCandidates,
    ...lorFallbackCandidates,
  ]);

  return {
    champ: item.champ,
    skin: item.skin,
    ...(item.type ? { type: item.type } : {}),
    ...(item.releaseDate ? { releaseDate: item.releaseDate } : {}),
    _id: id,
    _legacyImage: item.image,
    _verifiedImageMeta: verified,
    _lorFallbackCandidates: lorFallbackCandidates,
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
  if (!item?.champ || !item?.skin || isChromaSkin(item)) return [];

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
