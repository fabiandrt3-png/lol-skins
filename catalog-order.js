// One chronological PC spine per champion. Cross-game artwork follows its
// matching PC skin; names, editions and distinct LoR levels retain their IDs.
export function platformOf(skin) {
  return skin.type === "Wild Rift" ? "Wild Rift" : skin.type === "Legends of Runeterra" ? "Legends of Runeterra" : "PC";
}

export function normalizeName(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function skinTheme(skin) {
  const name = normalizeName(String(skin.skin || "")
    .replace(/\s*\(Wild Rift\)/ig, "").replace(/\s*[—–-]\s*Level\s+\d+\s*$/i, ""));
  const champion = normalizeName(skin.champ);
  const theme = (` ${name} `).replace(` ${champion} `, " ").trim();
  return /^(classic|original)$/.test(theme) || !theme ? "original" : theme;
}

export function metadataKey(skin) {
  return `${platformOf(skin)}|${normalizeName(skin.champ)}|${skinTheme(skin).split(" ").sort().join(" ")}`;
}

export function artworkKey(source) {
  if (!source || String(source).startsWith("data:")) return "";
  try {
    const url = new URL(source);
    let file = decodeURIComponent(url.pathname.split("/").pop()).replace(/^\d+px-/, "");
    if (url.hostname === "wiki.leagueoflegends.com") {
      // HD and resized copies are the same artwork. Keep WR, old editions,
      // alternate art, chroma names and card codes intact.
      file = file.replace(/_HD(?=\.[a-z]+$)/i, "");
      return `wiki:${file.toLowerCase()}`;
    }
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { return ""; }
}

function variantKey(skin) {
  const name = normalizeName(skin.skin);
  // LoR levels and chroma colors are never interchangeable. Editions can share
  // one card only when the source actually points at the same illustration.
  return [
    skin.lorCardCode || "", skin.lorLevelNumber || "",
    (name.match(/\b(?:19|20)\d{2}\b/g) || []).filter((year) => year !== "2022" || !name.includes("prestige")).join(" "),
    (name.match(/\b(?:prestige|exalted|transcendent|immortalized|signature|redeemed)\b/g) || []).join(" "),
    /\bchroma\b/.test(name) ? skinTheme(skin) : "",
  ].join("|");
}

function platforms(skin) { return skin.platforms || [platformOf(skin)]; }
function idOf(skin) { return skin._id || skin.id; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : ""; }
function dateOf(skin) { return validDate(skin.releaseDate) || "9999-12-31"; }
const rank = (skin) => ["PC", "Wild Rift", "Legends of Runeterra"].indexOf(platformOf(skin));
const isChroma = (skin) => /\bchroma\b/i.test(skin.skin);
const isOriginal = (skin) => skinTheme(skin) === "original";

function identityKey(skin) {
  let identity = normalizeName(skin.canonicalSkin || skinTheme(skin));
  if (identity.includes("prestige")) identity = identity.replace(/\b2022\b/g, "");
  identity = identity.replace(/^reignited\s+/, "").split(" ").filter(Boolean).sort().join(" ");
  return `${normalizeName(skin.champ)}|${identity}|${variantKey(skin)}`;
}

function primaryArtwork(skin) { return artworkKey(skin.imageCandidates?.[0] || skin.image); }
function duplicateKey(skin) {
  const image = primaryArtwork(skin);
  return image ? `${identityKey(skin)}|${image}` : "";
}

function verifiedArtworkAliases(skins, equivalences) {
  const records = new Map(skins.map((skin) => [idOf(skin), skin]));
  const targets = new Map();
  for (const evidence of Array.isArray(equivalences) ? equivalences : []) {
    if (!evidence) continue;
    const pc = records.get(evidence.pcId);
    const wr = records.get(evidence.wrId);
    // Similar names alone are not proof: an explicit visual comparison must
    // still refer to these exact primary files and the same skin/variant.
    if (!pc || !wr || platformOf(pc) !== "PC" || platformOf(wr) !== "Wild Rift"
      || identityKey(pc) !== identityKey(wr)
      || !evidence.pcArtwork || !evidence.wrArtwork
      || primaryArtwork(pc) !== evidence.pcArtwork || primaryArtwork(wr) !== evidence.wrArtwork) continue;
    const source = duplicateKey(wr);
    if (!targets.has(source)) targets.set(source, new Set());
    targets.get(source).add(duplicateKey(pc));
  }
  // Conflicting evidence is ignored until the source data is reviewed again.
  return new Map([...targets].filter(([, values]) => values.size === 1).map(([source, values]) => [source, [...values][0]]));
}

export function deduplicateSkins(skins, artworkEquivalences = []) {
  const artworkAliases = verifiedArtworkAliases(skins, artworkEquivalences);
  const byArtwork = new Map();
  const byId = new Map();
  const output = [];
  for (const skin of skins) {
    const originalKey = duplicateKey(skin);
    const key = artworkAliases.get(originalKey) || originalKey;
    const previous = byId.get(idOf(skin)) || (key && byArtwork.get(key));
    if (!previous) {
      const entry = { ...skin, platforms: [...platforms(skin)], _duplicateIds: [...(skin._duplicateIds || [])] };
      output.push(entry);
      if (key) byArtwork.set(key, entry);
      if (idOf(entry)) byId.set(idOf(entry), entry);
      continue;
    }
    const old = { ...previous };
    const preferred = rank(skin) < rank(old) || (rank(skin) === rank(old) && old.isAlias && !skin.isAlias) ? skin : old;
    // Replace, rather than overlay, the surviving record so a former WR type
    // or alias flag cannot leak onto the preferred PC record.
    for (const property of Object.keys(previous)) delete previous[property];
    Object.assign(previous, preferred, {
      platforms: unique([...platforms(old), ...platforms(skin)]),
      _duplicateIds: unique([idOf(old), idOf(skin), ...(old._duplicateIds || []), ...(skin._duplicateIds || [])]).filter((id) => id !== idOf(preferred)),
      _duplicateSkinNames: unique([old.skin, skin.skin, ...(old._duplicateSkinNames || []), ...(skin._duplicateSkinNames || [])]).filter((name) => name !== preferred.skin),
      imageCandidates: unique([...(preferred.imageCandidates || []), ...(old.imageCandidates || []), ...(skin.imageCandidates || [])]),
      highResImageCandidates: unique([...(preferred.highResImageCandidates || []), ...(old.highResImageCandidates || []), ...(skin.highResImageCandidates || [])]),
      iconCandidates: unique([...(preferred.iconCandidates || []), ...(old.iconCandidates || []), ...(skin.iconCandidates || [])]),
    });
    if (key) byArtwork.set(key, previous);
    if (idOf(skin)) byId.set(idOf(skin), previous);
  }
  return output;
}

function chronological(a, b) {
  return Number(isOriginal(b)) - Number(isOriginal(a))
    || (a._sortDate || dateOf(a)).localeCompare(b._sortDate || dateOf(b))
    || rank(a) - rank(b)
    || Number(a.lorSkinIndex ?? 9999) - Number(b.lorSkinIndex ?? 9999)
    || Number(a.lorLevelNumber ?? 0) - Number(b.lorLevelNumber ?? 0)
    || a._inputOrder - b._inputOrder;
}

function shares(left, right) {
  const values = new Set((left || []).map(normalizeName));
  return (right || []).some((value) => values.has(normalizeName(value)));
}

function chromaParent(skin, candidates) {
  if (!isChroma(skin)) return null;
  const name = skinTheme(skin);
  return candidates.filter((candidate) => !isChroma(candidate) && platforms(candidate).includes(platformOf(skin)))
    .map((candidate) => ({ candidate, length: Math.max(0, ...[candidate.skin, ...(candidate._duplicateSkinNames || [])]
      .map((alias) => skinTheme({ ...candidate, skin: alias }))
      .filter((theme) => name.startsWith(`${theme} `)).map((theme) => theme.length)) }))
    .filter(({ length }) => length > 0).sort((a, b) => b.length - a.length)[0]?.candidate || null;
}

function choosePcAnchor(skin, pc) {
  const theme = skinTheme(skin);
  const orderedTheme = (value) => value.split(" ").sort().join(" ");
  const exact = pc.find((candidate) => orderedTheme(skinTheme(candidate)) === orderedTheme(theme));
  if (exact) return exact;
  if (isOriginal(skin)) return pc.find(isOriginal) || null;
  // Exact skin line wins over the broader universe. Choose its earliest
  // standard PC skin when there is no exact cross-platform counterpart.
  const standardFirst = (a, b) => Number(/prestige|mythic|special edition/i.test(a.skin)) - Number(/prestige|mythic|special edition/i.test(b.skin)) || chronological(a, b);
  const line = pc.filter((candidate) => !isOriginal(candidate) && shares(skin.skinLines, candidate.skinLines)).sort(standardFirst);
  if (line.length) return line[0];
  const universe = pc.filter((candidate) => !isOriginal(candidate) && shares(skin.universes, candidate.universes)).sort(standardFirst);
  return universe[0] || null;
}

export function organizeSkins(skins, metadata = {}) {
  const entries = metadata.entries || {};
  const enriched = skins.map((skin, index) => {
    const info = entries[metadataKey(skin)] || {};
    return { ...skin, ...info, releaseDate: validDate(info.releaseDate) || validDate(skin.releaseDate) || null, _inputOrder: index };
  });
  const uniqueSkins = deduplicateSkins(enriched, metadata.artworkEquivalences);
  const champions = new Map();
  for (const skin of uniqueSkins) {
    const key = normalizeName(skin.champ);
    if (!champions.has(key)) champions.set(key, []);
    champions.get(key).push(skin);
  }
  const result = [];
  for (const [, group] of [...champions].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const pc = group.filter((skin) => platformOf(skin) === "PC" && !isChroma(skin)).sort(chronological);
    const parents = new Map();
    // Explicit placements win before automatic cross-platform grouping.
    for (const skin of group) {
      const manualParent = skin._orderAfterSkin && group.find((item) => item !== skin && !item._orderAfterSkin && !isChroma(item)
        && (item.skin === skin._orderAfterSkin || item._duplicateSkinNames?.includes(skin._orderAfterSkin)));
      if (manualParent) parents.set(skin, manualParent);
    }
    for (const skin of group) {
      if (parents.has(skin)) continue;
      const parent = chromaParent(skin, group) || (platformOf(skin) !== "PC" ? choosePcAnchor(skin, pc) : null);
      if (parent) {
        let ancestor = parent;
        while (ancestor && ancestor !== skin) ancestor = parents.get(ancestor);
        // A cycle would hide its entire subtree because it has no root.
        if (ancestor !== skin) parents.set(skin, parent);
      }
    }
    const children = new Map();
    for (const [skin, parent] of parents) {
      if (!validDate(skin.releaseDate)) skin._sortDate = dateOf(parent);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(skin);
    }
    const append = (skin, anchor = null) => {
      const { _inputOrder, _sortDate, ...clean } = skin;
      result.push({ ...clean, _chronologyParentId: anchor ? idOf(anchor) : null });
      for (const child of (children.get(skin) || []).sort(chronological)) append(child, skin);
    };
    for (const skin of group.filter((item) => !parents.has(item)).sort(chronological)) append(skin);
  }
  return result;
}
