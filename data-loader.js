const CATALOG_SOURCE = "data/image-overrides.json";
const APP_ASSET_VERSION = new URL(import.meta.url).searchParams.get("v");

let skinDataPromise;

export function loadSkinData() {
  if (!skinDataPromise) {
    skinDataPromise = fetch(versionedAppAsset(CATALOG_SOURCE), { cache: "default" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Catalogue centralisé (${response.status})`);
        const payload = await response.json();
        const catalog = payload?.catalog;
        const verifiedImages = payload?.entries;

        if (!Array.isArray(catalog) || !catalog.length) {
          throw new Error("Le catalogue centralisé est vide ou invalide.");
        }

        const verifiedMap = verifiedImages && !Array.isArray(verifiedImages) ? verifiedImages : {};
        return catalog.filter(validSkinEntry).map((item) => mapCatalogSkin(item, verifiedMap));
      });
  }

  return skinDataPromise;
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
