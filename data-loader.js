const LEGACY_SOURCE = "legacy/index-original.html";
const DDRAGON_VERSIONS = "https://ddragon.leagueoflegends.com/api/versions.json";
const CDRAGON_CHAMPION = (id) => `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champions/${id}.json`;
const CDRAGON_ASSET_ROOT = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/";
const VERIFIED_IMAGE_MAP = "data/image-overrides.json";

let catalogPromise;
let verifiedImageMapPromise;
const championDataCache = new Map();
const resolvedChampions = new Set();

/** Charge la collection et les métadonnées utiles en parallèle. */
export async function loadSkinData() {
  const [response, catalog, verifiedImages] = await Promise.all([
    fetch(LEGACY_SOURCE, { cache: "default" }),
    loadChampionCatalog().catch((error) => {
      console.warn("Data Dragon indisponible, les icônes legacy seront utilisées.", error);
      return null;
    }),
    loadVerifiedImageMap(),
  ]);

  if (!response.ok) throw new Error(`Impossible de charger ${LEGACY_SOURCE} (${response.status})`);

  const source = await response.text();
  const declaration = "const championsSkins = [";
  const declarationIndex = source.indexOf(declaration);
  if (declarationIndex === -1) throw new Error("La collection championsSkins est introuvable dans la source legacy.");

  const arrayStart = source.indexOf("[", declarationIndex);
  const arrayEnd = source.indexOf("];", arrayStart);
  if (arrayStart === -1 || arrayEnd === -1) throw new Error("La collection championsSkins est incomplète dans la source legacy.");

  const arrayLiteral = source.slice(arrayStart, arrayEnd + 1);
  const data = Function(`"use strict"; return (${arrayLiteral});`)();
  if (!Array.isArray(data)) throw new Error("Les données chargées ne sont pas un tableau valide.");

  return data.map((item, index) => {
    const id = `${slugify(item.champ)}::${slugify(item.skin)}::${index}`;
    const meta = catalog?.byName.get(normalize(item.champ));
    const verified = verifiedImages[id] || null;
    const verifiedCandidates = unique([verified?.url, ...(verified?.fallbacks || [])]);
    const legacyCandidates = legacyImageCandidates(item.image);
    const allImageCandidates = unique([...verifiedCandidates, ...legacyCandidates]);
    const iconCandidates = unique([
      meta ? `https://ddragon.leagueoflegends.com/cdn/${catalog.version}/img/champion/${meta.alias}.png` : null,
      item.icon,
    ]);

    return {
      ...item,
      _id: id,
      _legacyImage: item.image,
      _verifiedImageCandidates: verifiedCandidates,
      _verifiedImageMeta: verified,
      _championKey: meta?.key || null,
      _championAlias: meta?.alias || null,
      imageCandidates: allImageCandidates,
      iconCandidates,
      image: allImageCandidates[0] || item.image,
    };
  });
}

/** Résout les assets dynamiques uniquement si l'audit n'a pas déjà fourni des sources vérifiées. */
export async function resolveChampionAssets(allSkins, champion) {
  if (resolvedChampions.has(champion)) return;

  const entries = allSkins.filter((skin) => skin.champ === champion);
  if (!entries.length) return;
  if (entries.every((entry) => entry._verifiedImageCandidates?.length)) {
    resolvedChampions.add(champion);
    return;
  }

  const key = entries.find((skin) => skin._championKey)?._championKey;
  const alias = entries.find((skin) => skin._championAlias)?._championAlias;
  if (!key || !alias) {
    resolvedChampions.add(champion);
    return;
  }

  try {
    const championData = await loadCommunityDragonChampion(key);
    const index = buildAssetIndex(championData, champion);

    entries.forEach((entry) => {
      if (entry._verifiedImageCandidates?.length) {
        entry.imageCandidates = unique([...entry._verifiedImageCandidates, ...(entry.imageCandidates || [])]);
        entry.image = entry.imageCandidates[0] || entry._legacyImage;
        entry._assetSource = "verified-audit";
        return;
      }

      if (entry.type === "Wild Rift") {
        entry.imageCandidates = unique([...wikiOriginalCandidates(entry._legacyImage), entry._legacyImage]);
        entry.image = entry.imageCandidates[0] || entry._legacyImage;
        entry._assetSource = "wild-rift-legacy";
        return;
      }

      const resolved = findPcAsset(entry, index, champion);
      if (!resolved) {
        entry.imageCandidates = unique([...wikiOriginalCandidates(entry._legacyImage), entry._legacyImage]);
        entry.image = entry.imageCandidates[0] || entry._legacyImage;
        entry._assetSource = "legacy";
        return;
      }

      if (resolved.kind === "chroma") {
        const parent = resolved.parent;
        const chroma = resolved.chroma;
        const num = skinNumber(parent.id);
        entry.imageCandidates = unique([
          entry._legacyImage,
          cdragonAsset(chroma.chromaPath || chroma.tilePath),
          cdragonAsset(parent.uncenteredSplashPath),
          ddragonSplash(alias, num),
          cdragonAsset(parent.splashPath),
          ...wikiOriginalCandidates(entry._legacyImage),
        ]);
        entry._assetSource = "chroma";
      } else {
        const skin = resolved.skin;
        const num = skinNumber(skin.id);
        entry.imageCandidates = unique([
          cdragonAsset(skin.uncenteredSplashPath),
          ddragonSplash(alias, num),
          cdragonAsset(skin.splashPath),
          ...wikiOriginalCandidates(entry._legacyImage),
          entry._legacyImage,
        ]);
        entry._assetSource = "riot-pc";
      }

      entry.image = entry.imageCandidates[0] || entry._legacyImage;
    });
  } catch (error) {
    console.warn(`Impossible de résoudre les assets officiels de ${champion}.`, error);
  } finally {
    resolvedChampions.add(champion);
  }
}

async function loadVerifiedImageMap() {
  if (!verifiedImageMapPromise) {
    verifiedImageMapPromise = fetch(VERIFIED_IMAGE_MAP, { cache: "default" })
      .then(async (response) => {
        if (response.status === 404) return {};
        if (!response.ok) throw new Error(`Verified image map: ${response.status}`);
        const payload = await response.json();
        return payload?.entries || {};
      })
      .catch((error) => {
        console.warn("Carte d’images vérifiées indisponible, utilisation des fallbacks dynamiques.", error);
        return {};
      });
  }
  return verifiedImageMapPromise;
}

async function loadChampionCatalog() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const versionsResponse = await fetch(DDRAGON_VERSIONS, { cache: "default" });
      if (!versionsResponse.ok) throw new Error(`Versions Data Dragon: ${versionsResponse.status}`);
      const versions = await versionsResponse.json();
      const version = versions?.[0];
      if (!version) throw new Error("Aucune version Data Dragon disponible.");

      const catalogResponse = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`, { cache: "default" });
      if (!catalogResponse.ok) throw new Error(`Catalogue Data Dragon: ${catalogResponse.status}`);
      const payload = await catalogResponse.json();
      const byName = new Map();

      Object.values(payload?.data || {}).forEach((champion) => {
        byName.set(normalize(champion.name), { key: String(champion.key), alias: champion.id });
      });

      return { version, byName };
    })();
  }
  return catalogPromise;
}

async function loadCommunityDragonChampion(id) {
  if (!championDataCache.has(id)) {
    championDataCache.set(id, fetch(CDRAGON_CHAMPION(id), { cache: "default" }).then(async (response) => {
      if (!response.ok) throw new Error(`CommunityDragon ${id}: ${response.status}`);
      return response.json();
    }));
  }
  return championDataCache.get(id);
}

function buildAssetIndex(championData, champion) {
  const skins = Array.isArray(championData?.skins) ? championData.skins : [];
  const skinByName = new Map();
  const chromaByName = new Map();
  const chromaByContentId = new Map();
  const coreSkinNames = new Map();

  skins.forEach((skin) => {
    skinAliases(skin, champion).forEach((alias) => skinByName.set(alias, skin));
    addCore(coreSkinNames, coreName(skin.name, champion), skin);

    (skin.chromas || []).forEach((chroma) => {
      chromaAliases(chroma, champion).forEach((alias) => chromaByName.set(alias, { chroma, parent: skin }));
      if (chroma.contentId) chromaByContentId.set(chroma.contentId.toLowerCase(), { chroma, parent: skin });
    });
  });

  return { skinByName, chromaByName, chromaByContentId, coreSkinNames };
}

function findPcAsset(entry, index, champion) {
  const uuid = extractUuid(entry._legacyImage);
  if (uuid && index.chromaByContentId.has(uuid)) return { kind: "chroma", ...index.chromaByContentId.get(uuid) };

  const normalized = normalizeSkinName(entry.skin, champion);
  const chroma = index.chromaByName.get(normalized);
  if (chroma) return { kind: "chroma", ...chroma };

  const exactSkin = index.skinByName.get(normalized);
  if (exactSkin) return { kind: "skin", skin: exactSkin };

  const coreMatches = index.coreSkinNames.get(coreName(entry.skin, champion)) || [];
  if (coreMatches.length === 1) return { kind: "skin", skin: coreMatches[0] };
  return null;
}

function skinAliases(skin, champion) {
  const aliases = new Set([normalizeSkinName(skin.name, champion)]);
  if (skin.isBase) {
    aliases.add(normalizeSkinName(champion, champion));
    aliases.add(normalizeSkinName(`Classic ${champion}`, champion));
  }
  if (/^prestige\s+/i.test(skin.name)) {
    const withoutPrefix = skin.name.replace(/^prestige\s+/i, "");
    aliases.add(normalizeSkinName(`${withoutPrefix} (Prestige)`, champion));
  }
  return aliases;
}

function chromaAliases(chroma, champion) {
  const clean = chroma.name.replace(/\s+Chroma(?=\))/gi, "");
  return new Set([normalizeSkinName(chroma.name, champion), normalizeSkinName(clean, champion)]);
}

function normalizeSkinName(value, champion) {
  let text = String(value || "");
  text = text.replace(/\(Wild Rift\)/gi, "");
  text = text.replace(/\s+Chroma(?=\))/gi, "");
  text = text.replace(/^Classic\s+/i, "");
  text = normalize(text);

  const champNorm = normalize(champion);
  if (text === champNorm || text === `classic ${champNorm}`) return champNorm;
  if (/\bprestige\b/.test(text) && !text.startsWith("prestige ")) {
    text = `prestige ${text.replace(/\bprestige\b/g, "").trim()}`;
  }
  return normalize(text);
}

function coreName(value, champion) {
  const champ = normalize(champion);
  return normalizeSkinName(value, champion)
    .replace(new RegExp(`\\b${escapeRegExp(champ)}\\b`, "g"), " ")
    .replace(/\b(prestige|mythic|chroma|special|edition|exquisite|select)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addCore(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function legacyImageCandidates(url) {
  return unique([...wikiOriginalCandidates(url), url]);
}

function wikiOriginalCandidates(url) {
  if (!url || !/wiki\.leagueoflegends\.com\/en-us\/images\//i.test(url)) return [];
  const filename = decodeURIComponent(url.split("/").pop() || "");
  if (!filename) return [];
  return [`https://wiki.leagueoflegends.com/en-us/Special:Redirect/file/${encodeURIComponent(filename)}`];
}

function cdragonAsset(path) {
  if (!path) return null;
  const prefix = "/lol-game-data/assets/";
  if (!path.toLowerCase().startsWith(prefix)) return null;
  return `${CDRAGON_ASSET_ROOT}${path.slice(prefix.length).toLowerCase()}`;
}

function ddragonSplash(alias, num) {
  if (!alias && alias !== 0) return null;
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${alias}_${num}.jpg`;
}

function skinNumber(id) { return Number(id) % 1000; }
function extractUuid(value = "") { return String(value).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]?.toLowerCase() || null; }
function normalize(value = "") { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function slugify(value = "") {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
