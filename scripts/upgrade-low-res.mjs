import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REPORT_FILE = path.join(ROOT, 'audit-report.json');
const ADDITION_REPORT_FILE = path.join(ROOT, 'addition-audit-report.json');
const OVERRIDES_FILE = path.join(ROOT, 'data', 'image-overrides.json');
const MANUAL_FILE = path.join(ROOT, 'data', 'manual-skins.txt');
const VERSION_FILE = path.join(ROOT, 'version.json');
const WIKI_API = 'https://wiki.leagueoflegends.com/en-us/api.php';
const USER_AGENT = 'lol-skins-wiki-maximizer/2.1 (+https://github.com/fabiandrt3-png/lol-skins)';
const TIMEOUT_MS = 25000;
const CATEGORY_PC = 'Category:High definition champion skins';
const CATEGORY_WR = 'Category:WR High definition champion skins';
const CHROMA_PAGE = 'Chroma';
const CATEGORY_URLS = {
  pc: 'https://wiki.leagueoflegends.com/en-us/Category:High_definition_champion_skins',
  wr: 'https://wiki.leagueoflegends.com/en-us/Category:WR_High_definition_champion_skins',
  chroma: 'https://wiki.leagueoflegends.com/en-us/Chroma',
};
const SENSITIVE_TERMS = ['prestige', 'select', 'special', 'edition', 'exquisite', 'mythic'];
const infoCache = new Map();
const searchCache = new Map();

const report = readJson(REPORT_FILE, { entries: [] });
const additions = readJson(ADDITION_REPORT_FILE, { entries: [] });
const overrides = readJson(OVERRIDES_FILE, { entries: {}, catalog: [] });
const manualText = fs.existsSync(MANUAL_FILE) ? fs.readFileSync(MANUAL_FILE, 'utf8') : '';
const catalog = Array.isArray(overrides.catalog) ? overrides.catalog : [];
const historical = Array.isArray(report.entries) ? report.entries : [];
const additionById = new Map((additions.entries || []).map((item) => [item.id, item]));

console.log('Loading League of Legends Wiki HD indexes…');
const [pcFiles, wrFiles] = await Promise.all([
  loadCategoryIndex(CATEGORY_PC, 'PC'),
  loadCategoryIndex(CATEGORY_WR, 'Wild Rift'),
]);
console.log(`Wiki HD index: ${pcFiles.length} PC files, ${wrFiles.length} Wild Rift files`);

const stats = {
  runAt: new Date().toISOString(),
  sourcesChecked: CATEGORY_URLS,
  historicalChecked: 0,
  historicalUpgraded: 0,
  catalogChecked: 0,
  catalogUpgraded: 0,
  catalogCardsRepaired: 0,
  chromaChecked: 0,
  chromaUpgraded: 0,
  manualChecked: 0,
  manualUpgraded: 0,
  noExactWikiHd: 0,
};

let changed = false;

for (const entry of historical) {
  stats.historicalChecked += 1;
  if (/chroma/i.test(entry.skin || '')) stats.chromaChecked += 1;
  const pool = entry.type === 'Wild Rift' ? wrFiles : pcFiles;
  const extra = /chroma/i.test(entry.skin || '') ? await chromaSearchCandidates(entry) : [];
  const best = chooseBestWiki(entry, [...pool, ...extra]);
  if (!best) {
    stats.noExactWikiHd += 1;
    continue;
  }

  const previous = overrides.entries?.[entry.id] || null;
  const currentArea = Number(previous?.width || entry.best?.width || 0) * Number(previous?.height || entry.best?.height || 0);
  const bestArea = best.width * best.height;
  const shouldUpgrade = !previous?.url
    || bestArea > currentArea
    || (bestArea === currentArea && !isWikiHdUrl(previous.url));

  if (!shouldUpgrade) continue;

  overrides.entries ||= {};
  overrides.entries[entry.id] = {
    url: best.url,
    width: best.width,
    height: best.height,
    bytes: best.bytes ?? previous?.bytes ?? null,
    source: best.platform === 'Wild Rift' ? 'league-wiki-wr-hd-maximum' : 'league-wiki-hd-maximum',
    verifiedAt: new Date().toISOString(),
    fallbacks: unique([previous?.url, ...(previous?.fallbacks || [])]).filter((url) => url && url !== best.url).slice(0, 8),
  };

  entry.validCandidates = uniqueCandidates([
    { ...best, source: overrides.entries[entry.id].source, semantic: 'exact-wiki-hd-maximum', area: bestArea },
    ...(entry.validCandidates || []),
  ]);
  entry.best = { ...best, source: overrides.entries[entry.id].source, semantic: 'exact-wiki-hd-maximum', area: bestArea };
  entry.verified = true;
  entry.qualityUpgraded = true;
  stats.historicalUpgraded += 1;
  if (/chroma/i.test(entry.skin || '')) stats.chromaUpgraded += 1;
  changed = true;
  console.log(`↑ historical ${entry.champion} — ${entry.skin}: ${best.width}x${best.height}`);
}

for (const item of catalog) {
  if (!item?.champ || !item?.skin || item.sourceKind === 'legacy') continue;
  stats.catalogChecked += 1;
  if (/chroma/i.test(item.skin || '')) stats.chromaChecked += 1;

  const entry = {
    champion: item.champ,
    skin: item.skin,
    type: item.type || 'PC',
  };
  const pool = entry.type === 'Wild Rift' ? wrFiles : pcFiles;
  const extra = /chroma/i.test(entry.skin || '') ? await chromaSearchCandidates(entry) : [];
  const best = chooseBestWiki(entry, [...pool, ...extra]);
  if (!best) {
    stats.noExactWikiHd += 1;
    continue;
  }

  const audit = additionById.get(item.id);
  const currentFullArea = Number(audit?.fullscreen?.width || 0) * Number(audit?.fullscreen?.height || 0);
  const bestArea = best.width * best.height;
  const currentIsWikiHd = isWikiHdUrl(item.fullImage || '');
  const shouldUpgradeFull = !item.fullImage
    || bestArea > currentFullArea
    || (bestArea === currentFullArea && !currentIsWikiHd)
    || (!currentFullArea && item.fullImage !== best.url);

  if (shouldUpgradeFull && item.fullImage !== best.url) {
    item.fullHdFallbacks = unique([item.fullImage, ...(item.fullHdFallbacks || [])]).filter((url) => url && url !== best.url).slice(0, 8);
    item.fullImage = best.url;
    item.hdSource = best.platform === 'Wild Rift' ? 'league-wiki-wr-hd-maximum' : 'league-wiki-hd-maximum';
    item.hdVerifiedAt = new Date().toISOString();
    stats.catalogUpgraded += 1;
    if (/chroma/i.test(item.skin || '')) stats.chromaUpgraded += 1;
    changed = true;
    console.log(`↑ catalog ${item.champ} — ${item.skin}: full ${best.width}x${best.height}`);
  }

  const standard = await standardCounterpart(best);
  if (standard && shouldUseStandardCard(item, audit, standard)) {
    item.fallbacks = unique([item.image, ...(item.fallbacks || [])]).filter((url) => url && url !== standard.url).slice(0, 8);
    item.image = standard.url;
    item.cardSource = 'league-wiki-current-client';
    item.cardVerifiedAt = new Date().toISOString();
    stats.catalogCardsRepaired += 1;
    changed = true;
    console.log(`↳ card ${item.champ} — ${item.skin}: ${standard.width}x${standard.height}`);
  }

  if (audit) {
    audit.fullscreen = {
      ok: true,
      url: best.url,
      width: best.width,
      height: best.height,
      bytes: best.bytes ?? null,
      contentType: best.mime || 'image/jpeg',
    };
    if (standard && (!audit.card?.ok || item.image === standard.url)) {
      audit.card = {
        ok: true,
        url: standard.url,
        width: standard.width,
        height: standard.height,
        bytes: standard.bytes ?? null,
        contentType: standard.mime || 'image/jpeg',
      };
    }
  }
}

const manualResult = await maximizeManualSkins(manualText, { pcFiles, wrFiles });
if (manualResult.changed) {
  fs.writeFileSync(MANUAL_FILE, manualResult.text);
  stats.manualUpgraded += manualResult.upgraded;
  changed = true;
}
stats.manualChecked = manualResult.checked;

report.summary = summarizeHistorical(historical);
report.wikiMaximumPass = stats;
additions.summary = summarizeAdditions(additions.entries || []);
additions.wikiMaximumPass = stats;
overrides.generatedAt = new Date().toISOString();
overrides.qualityPolicy = 'For every current skin: preserve the standard/original splash for cards; use the highest-resolution exact-match League Wiki HD/WR HD splash for fullscreen when available; never substitute another skin, prestige edition, special edition or chroma merely for more pixels.';
overrides.qualitySources = CATEGORY_URLS;

fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(ADDITION_REPORT_FILE, JSON.stringify(additions, null, 2) + '\n');
fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2) + '\n');

if (changed) bumpVersion();
console.log(JSON.stringify({ changed, ...stats, historicalSummary: report.summary, additionSummary: additions.summary }, null, 2));

async function loadCategoryIndex(category, platform) {
  const titles = [];
  let cmcontinue = null;
  do {
    const url = new URL(WIKI_API);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('list', 'categorymembers');
    url.searchParams.set('cmtitle', category);
    url.searchParams.set('cmnamespace', '6');
    url.searchParams.set('cmlimit', '500');
    if (cmcontinue) url.searchParams.set('cmcontinue', cmcontinue);
    const payload = await fetchJson(url.href);
    for (const member of payload?.query?.categorymembers || []) titles.push(member.title);
    cmcontinue = payload?.continue?.cmcontinue || null;
  } while (cmcontinue);

  const files = [];
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const url = new URL(WIKI_API);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|size|mime');
    url.searchParams.set('titles', batch.join('|'));
    const payload = await fetchJson(url.href);
    for (const page of payload?.query?.pages || []) {
      const info = page?.imageinfo?.[0];
      if (!info?.url || !info.width || !info.height) continue;
      files.push({
        title: String(page.title || '').replace(/^File:/i, ''),
        url: info.url,
        width: info.width,
        height: info.height,
        bytes: info.size || null,
        mime: info.mime || null,
        platform,
      });
    }
  }
  return dedupeFiles(files);
}

async function chromaSearchCandidates(entry) {
  const query = `${entry.champion} ${cleanSkinName(entry.skin, entry.champion)} chroma`;
  if (searchCache.has(query)) return searchCache.get(query);
  const promise = (async () => {
    const url = new URL(WIKI_API);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srnamespace', '6');
    url.searchParams.set('srlimit', '50');
    url.searchParams.set('srsearch', query);
    const payload = await fetchJson(url.href, true);
    const titles = (payload?.query?.search || []).map((item) => item.title).filter(Boolean);
    const out = [];
    for (let i = 0; i < titles.length; i += 50) {
      const batch = titles.slice(i, i + 50);
      const infoUrl = new URL(WIKI_API);
      infoUrl.searchParams.set('action', 'query');
      infoUrl.searchParams.set('format', 'json');
      infoUrl.searchParams.set('formatversion', '2');
      infoUrl.searchParams.set('prop', 'imageinfo');
      infoUrl.searchParams.set('iiprop', 'url|size|mime');
      infoUrl.searchParams.set('titles', batch.join('|'));
      const infoPayload = await fetchJson(infoUrl.href, true);
      for (const page of infoPayload?.query?.pages || []) {
        const info = page?.imageinfo?.[0];
        if (!info?.url || !info.width || !info.height) continue;
        out.push({
          title: String(page.title || '').replace(/^File:/i, ''),
          url: info.url,
          width: info.width,
          height: info.height,
          bytes: info.size || null,
          mime: info.mime || null,
          platform: entry.type === 'Wild Rift' ? 'Wild Rift' : 'PC',
          chromaSearch: CHROMA_PAGE,
        });
      }
    }
    return dedupeFiles(out);
  })();
  searchCache.set(query, promise);
  return promise;
}

function chooseBestWiki(entry, candidates) {
  const scored = [];
  for (const file of dedupeFiles(candidates)) {
    const score = scoreFile(file.title, entry);
    if (!score.accept) continue;
    scored.push({ ...file, score: score.score });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => {
    const area = (b.width * b.height) - (a.width * a.height);
    if (area) return area;
    const oldPenalty = Number(/\bold\d*\b/i.test(a.title)) - Number(/\bold\d*\b/i.test(b.title));
    if (oldPenalty) return oldPenalty;
    return b.score - a.score;
  });
  return scored[0];
}

function scoreFile(title, entry) {
  const raw = String(title || '').replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '');
  const text = normalize(raw);
  const wantsWr = entry.type === 'Wild Rift';
  const candidateWr = /(?:^|\s)wr(?:\s|$)/.test(text) || /wild rift/.test(text);
  if (wantsWr !== candidateWr) return { accept: false, score: -999 };
  if (!/(?:^|\s)hd(?:\s|$)/.test(text)) return { accept: false, score: -999 };

  const championTokens = significantTokens(entry.champion);
  if (championTokens.some((token) => !text.includes(token))) return { accept: false, score: -999 };

  let skinTokens = significantTokens(cleanSkinName(entry.skin, entry.champion));
  if (/^classic(?:\s|$)/i.test(String(entry.skin || ''))) skinTokens = ['original'];
  if (!skinTokens.length) return { accept: false, score: -999 };

  const entryText = normalize(entry.skin);
  for (const term of SENSITIVE_TERMS) {
    const wanted = entryText.includes(term);
    const present = text.includes(term);
    if (wanted !== present) return { accept: false, score: -999 };
  }

  const isChroma = /chroma/i.test(entry.skin || '');
  if (!isChroma && /\bchroma\b/.test(text)) return { accept: false, score: -999 };

  const matched = skinTokens.filter((token) => text.includes(token));
  const required = isChroma
    ? Math.max(1, Math.ceil(skinTokens.length * 0.85))
    : skinTokens.length;
  if (matched.length < required) return { accept: false, score: -999 };

  let score = matched.length * 10 + championTokens.length * 6;
  if (/\bskin\b/.test(text)) score += 3;
  if (/\bhd\b/.test(text)) score += 6;
  if (matched.length === skinTokens.length) score += 15;
  if (wantsWr && candidateWr) score += 8;
  if (/\bold\d*\b/.test(text)) score -= 4;
  return { accept: true, score };
}

async function standardCounterpart(best) {
  const filename = best.title;
  const standard = filename.replace(/_HD(?=\.(?:jpe?g|png|webp)$)/i, '');
  if (standard === filename) return null;
  return imageInfo(standard);
}

async function imageInfo(filename) {
  if (!filename) return null;
  if (infoCache.has(filename)) return infoCache.get(filename);
  const promise = (async () => {
    const url = new URL(WIKI_API);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|size|mime');
    url.searchParams.set('titles', `File:${filename}`);
    const payload = await fetchJson(url.href, true);
    const page = payload?.query?.pages?.[0];
    const info = page?.imageinfo?.[0];
    if (!info?.url || !info.width || !info.height) return null;
    return {
      title: String(page.title || `File:${filename}`).replace(/^File:/i, ''),
      url: info.url,
      width: info.width,
      height: info.height,
      bytes: info.size || null,
      mime: info.mime || null,
    };
  })().catch(() => null);
  infoCache.set(filename, promise);
  return promise;
}

function shouldUseStandardCard(item, audit, standard) {
  if (!standard?.url) return false;
  if (!item.image) return true;
  if (item.image === standard.url) return false;
  if (isWikiHdUrl(item.image)) return true;
  if (audit?.card && audit.card.ok === false) return true;
  if (/wildrift-jp-wiki\.com|wp\.com/i.test(item.image)) return true;
  return false;
}

async function maximizeManualSkins(text, indexes) {
  const lines = String(text || '').split(/\r?\n/);
  let checked = 0;
  let upgraded = 0;
  let changed = false;
  const out = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      out.push(raw);
      continue;
    }
    const parts = raw.split('|').map((part) => part.trim());
    if (parts.length < 4) {
      out.push(raw);
      continue;
    }
    const [champ, skin, type, image, fullImage = '', afterSkin = ''] = parts;
    checked += 1;
    const entry = { champion: champ, skin, type: /wild\s*rift|\bwr\b/i.test(type) ? 'Wild Rift' : 'PC' };
    const pool = entry.type === 'Wild Rift' ? indexes.wrFiles : indexes.pcFiles;
    const extra = /chroma/i.test(skin) ? await chromaSearchCandidates(entry) : [];
    const best = chooseBestWiki(entry, [...pool, ...extra]);
    if (!best) {
      out.push(raw);
      continue;
    }
    const standard = await standardCounterpart(best);
    const nextImage = standard?.url || image;
    const nextFull = best.url;
    if (nextImage !== image || nextFull !== fullImage) {
      upgraded += 1;
      changed = true;
      const rebuilt = [champ, skin, type, nextImage, nextFull, afterSkin].filter((value, index) => index < 5 || value).join(' | ');
      out.push(rebuilt);
    } else {
      out.push(raw);
    }
  }
  return { text: out.join('\n'), checked, upgraded, changed };
}

function summarizeHistorical(entries) {
  const unresolved = entries.filter((entry) => !entry.verified);
  const wr = entries.filter((entry) => entry.type === 'Wild Rift');
  const pc = entries.filter((entry) => entry.type !== 'Wild Rift');
  const lowRes = entries.filter((entry) => entry.best && (entry.best.width < 1600 || entry.best.height < 900));
  const belowQuality = entries.filter((entry) => entry.best && (entry.best.width < 2560 || entry.best.height < 1440));
  return {
    total: entries.length,
    verified: entries.length - unresolved.length,
    unresolved: unresolved.length,
    pcTotal: pc.length,
    pcVerified: pc.filter((entry) => entry.verified).length,
    wildRiftTotal: wr.length,
    wildRiftVerified: wr.filter((entry) => entry.verified).length,
    wildRiftUnresolved: wr.filter((entry) => !entry.verified).length,
    degradedFallbacks: entries.filter((entry) => entry.degraded).length,
    below1600x900: lowRes.length,
    below2560x1440: belowQuality.length,
    unresolvedEntries: unresolved.map((entry) => ({ champion: entry.champion, skin: entry.skin, type: entry.type })),
  };
}

function summarizeAdditions(entries) {
  const unresolved = entries.filter((item) => !item.card?.ok || !item.fullscreen?.ok);
  const lowCard = entries.filter((item) => item.card?.ok && (item.card.width < 1215 || item.card.height < 675));
  const lowFullscreen = entries.filter((item) => item.fullscreen?.ok && (item.fullscreen.width < 1600 || item.fullscreen.height < 900));
  return {
    total: entries.length,
    fullyVerified: entries.length - unresolved.length,
    unresolved: unresolved.length,
    pc: entries.filter((item) => item.type !== 'Wild Rift').length,
    wildRift: entries.filter((item) => item.type === 'Wild Rift').length,
    belowCardTarget: lowCard.length,
    belowFullscreenTarget: lowFullscreen.length,
  };
}

function bumpVersion() {
  if (!fs.existsSync(VERSION_FILE)) return;
  const payload = readJson(VERSION_FILE, {});
  const current = String(payload.version || '');
  const match = current.match(/^(\d{8})-(\d+)$/);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const next = match && match[1] === today ? `${today}-${Number(match[2]) + 1}` : `${today}-1`;
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: next }, null, 2) + '\n');
  console.log(`Version → ${next}`);
}

async function fetchJson(url, optional = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json,*/*;q=0.8' },
    });
    if (!response.ok) {
      if (optional) return null;
      throw new Error(`${response.status} ${url}`);
    }
    return await response.json();
  } catch (error) {
    if (optional) return null;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function cleanSkinName(value, champion) {
  return String(value || '')
    .replace(/\(Wild Rift\)/gi, ' ')
    .replace(new RegExp(`\\b${escapeRegExp(champion)}\\b`, 'ig'), ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(value) {
  const stop = new Set(['skin', 'league', 'legends', 'wild', 'rift', 'the', 'of', 'and', 'a', 'an', 'chroma']);
  return normalize(value).split(' ').filter((token) => token.length > 1 && !stop.has(token));
}

function isWikiHdUrl(url) {
  return /wiki\.leagueoflegends\.com\/en-us\/(?:images|Special:Redirect\/file)\//i.test(String(url || ''))
    && /_HD(?:\.|%2E)/i.test(String(url || ''));
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function dedupeFiles(values) {
  const seen = new Set();
  return (values || []).filter((item) => item?.url && !seen.has(item.url) && seen.add(item.url));
}

function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
function uniqueCandidates(values) {
  const seen = new Set();
  return (values || []).filter((item) => item?.url && !seen.has(item.url) && seen.add(item.url));
}
function normalize(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
