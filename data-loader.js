const VERIFIED_IMAGE_MAP = "data/image-overrides.json";
const CATALOG_SOURCE = VERIFIED_IMAGE_MAP;
const MANUAL_SKINS_SOURCE = "data/manual-skins.txt";
const APP_ASSET_VERSION = new URL(import.meta.url).searchParams.get("v");

let skinDataPromise;

export function loadSkinData() {
  if (!skinDataPromise) {
    skinDataPromise = Promise.all([
      fetch(versionedAppAsset(CATALOG_SOURCE), { cache: "default" }).then(async (response) => {
        if (!response.ok) throw new Error(`Catalogue centralisé (${response.status})`);
        return response.json();
      }),
      loadManualSkins(),
    ]).then(([payload, manualSkins]) => {
      const catalog = payload?.catalog;
      const verifiedImages = payload?.entries;

      if (!Array.isArray(catalog) || !catalog.length) {
        throw new Error("Le catalogue centralisé est vide ou invalide.");
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
    console.warn("Fichier des skins manuels indisponible, catalogue principal utilisé.", error);
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
      console.warn(`Skin manuel ignoré ligne ${index + 1}: format incomplet.`);
      return;
    }

    const [champ, skin, rawType, image, fullImage = "", afterSkin = ""] = parts;
    if (!champ || !skin || !image) {
      console.warn(`Skin manuel ignoré ligne ${index + 1}: champion, skin ou image manquant.`);
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
  const type = String(value || "PC").trim().toLocaleLowerCase("fr");
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
  const verifiedCandidates = unique([verified?.url, ...(verified?.fallbacks || [])]);
  const sourceCandidates = item.sourceKind === "legacy"
    ? legacyImageCandidates(item.image)
    : unique([item.image, ...(item.fallbacks || [])]);
  const cardCandidates = unique([...verifiedCandidates, ...sourceCandidates]);
  const imageCandidates = cardImageCandidates(cardCandidates);

  const explicitFullscreenCandidates = unique([item.fullImage, ...(item.fullHdFallbacks || [])]);
  const verifiedFullscreenCandidates = highResolutionImageCandidates(cardCandidates);
  const highResImageCandidates = unique([
    ...explicitFullscreenCandidates,
    ...verifiedFullscreenCandidates,
  ]);

  return {
    champ: item.champ,
    skin: item.skin,
    ...(item.type ? { type: item.type } : {}),
    ...(item.releaseDate ? { releaseDate: item.releaseDate } : {}),
    _id: id,
    _legacyImage: item.image,
    _verifiedImageMeta: verified,
    imageCandidates,
    highResImageCandidates,
    iconCandidates: unique([item.icon]),
    image: imageCandidates[0] || item.image,
  };
}

function validSkinEntry(item) {
  return Boolean(item?.champ && item?.skin && item?.image);
}

function versionedAppAsset(url) {
  if (!APP_ASSET_VERSION) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(APP_ASSET_VERSION)}`;
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
