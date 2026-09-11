import fs from 'node:fs';

function replaceOnce(file, before, after, label) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(before)) throw new Error(`Missing expected block: ${label}`);
  fs.writeFileSync(file, text.replace(before, after));
}

const loaderBefore = `    let insertAt = -1;
    if (isOriginalLorSkin(lor)) {
      insertAt = merged.findIndex((item) => isClassicLeagueSkin(item, lor.champ));
      while (
        insertAt >= 0
        && insertAt + 1 < merged.length
        && merged[insertAt + 1].champ === lor.champ
        && isOriginalLorSkin(merged[insertAt + 1])
      ) {
        insertAt += 1;
      }
    }

    if (insertAt < 0) {
      for (let index = merged.length - 1; index >= 0; index -= 1) {
        if (merged[index].champ === lor.champ) {
          insertAt = index;
          break;
        }
      }
    }
`;

const loaderAfter = `    let insertAt = -1;
    if (isOriginalLorSkin(lor)) {
      insertAt = merged.findIndex((item) => isClassicLeagueSkin(item, lor.champ));
      while (
        insertAt >= 0
        && insertAt + 1 < merged.length
        && merged[insertAt + 1].champ === lor.champ
        && isOriginalLorSkin(merged[insertAt + 1])
      ) {
        insertAt += 1;
      }
    } else if (lor.insertAfterSkin) {
      insertAt = merged.findIndex((item) => item.champ === lor.champ && item.skin === lor.insertAfterSkin);
      while (
        insertAt >= 0
        && insertAt + 1 < merged.length
        && merged[insertAt + 1].champ === lor.champ
        && merged[insertAt + 1].type === "Legends of Runeterra"
        && merged[insertAt + 1].lorSkinName === lor.lorSkinName
      ) {
        insertAt += 1;
      }
    }

    if (insertAt < 0) {
      for (let index = merged.length - 1; index >= 0; index -= 1) {
        if (merged[index].champ === lor.champ) {
          insertAt = index;
          break;
        }
      }
    }
`;
replaceOnce('data-loader.js', loaderBefore, loaderAfter, 'LoR insertion logic');

const generatorMarker = `const SKIN_METADATA_SOURCES = [
  'https://wiki.leagueoflegends.com/en-us/Module:LoRCosmetics/skins?action=raw',
  'https://wiki.leagueoflegends.com/en-us/index.php?title=Module%3ALoRCosmetics%2Fskins&action=raw',
];
`;
const generatorReplacement = `${generatorMarker}
// Explicit chronology anchors are only needed where the main LoL/WR catalogue
// predates release-date metadata. Keep these anchors semantic (skin names), not
// numeric positions, so catalogue growth cannot silently reorder LoR artwork.
const CHRONOLOGY_ANCHORS = new Map([
  ['akshan|pulsefire', 'Crystal Rose Akshan'],
]);
`;
replaceOnce('scripts/update-lor-skins.mjs', generatorMarker, generatorReplacement, 'LoR chronology anchors');

const entryMarker = `    const levelNumber = parseLevelNumber(level.levelName);
    const displayName = skin.skinName === 'Original'
      ? \`Original \${skin.champion} — \${level.levelName}\`
      : \`\${skin.skinName} \${skin.champion} — \${level.levelName}\`;

    entries.push({
`;
const entryReplacement = `    const levelNumber = parseLevelNumber(level.levelName);
    const displayName = skin.skinName === 'Original'
      ? \`Original \${skin.champion} — \${level.levelName}\`
      : \`\${skin.skinName} \${skin.champion} — \${level.levelName}\`;
    const insertAfterSkin = CHRONOLOGY_ANCHORS.get(\`\${slugify(skin.champion)}|\${slugify(skin.skinName)}\`) || null;

    entries.push({
`;
replaceOnce('scripts/update-lor-skins.mjs', entryMarker, entryReplacement, 'LoR anchor lookup');

const releaseMarker = `      releaseDate: skin.releaseDate || null,
      image,
`;
const releaseReplacement = `      releaseDate: skin.releaseDate || null,
      ...(insertAfterSkin ? { insertAfterSkin } : {}),
      image,
`;
replaceOnce('scripts/update-lor-skins.mjs', releaseMarker, releaseReplacement, 'LoR anchor field');

const uiFile = 'english-ui.js';
let ui = fs.readFileSync(uiFile, 'utf8');
ui = ui.replace('const WILD_RIFT_SUFFIX = /\\s*\\(\\s*Wild Rift\\s*\\)/gi;\n\n', '');
const oldLorLabel = '  const lorLabel = parsed.lorLevel ? `Legends of Runeterra · ${parsed.lorLevel}` : "Legends of Runeterra";';
const newLorLabel = '  const lorLabel = parsed.lorLevel ? `Legends of Runeterra · ${parsed.lorLevel}` : existingLorBadge?.textContent?.trim() || "Legends of Runeterra";';
if (!ui.includes(oldLorLabel)) throw new Error('Missing expected LoR badge label logic');
ui = ui.replace(oldLorLabel, newLorLabel);
fs.writeFileSync(uiFile, ui);

const lorPath = 'data/lor-skins.json';
const lorPayload = JSON.parse(fs.readFileSync(lorPath, 'utf8'));
let pulsefireLevels = 0;
for (const entry of lorPayload.entries || []) {
  if (entry.champ === 'Akshan' && entry.lorSkinName === 'Pulsefire') {
    entry.insertAfterSkin = 'Crystal Rose Akshan';
    pulsefireLevels += 1;
  }
}
if (pulsefireLevels !== 2) throw new Error(`Expected 2 Pulsefire Akshan levels, found ${pulsefireLevels}`);
lorPayload.strategy = 'LoR champion skins are first-class gallery entries. Original LoR levels sit immediately after Classic; cosmetic LoR skins follow chronological anchors/release order and keep Level metadata in platform badges. Card previews use the exact original/full artwork; fullscreen tries the exact HD LoR artwork first.';
fs.writeFileSync(lorPath, JSON.stringify(lorPayload, null, 2) + '\n');

const versionPath = 'version.json';
const version = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
version.version = '20260911-95';
fs.writeFileSync(versionPath, JSON.stringify(version, null, 2) + '\n');

console.log('LoR chronology and level badge fix prepared.');
