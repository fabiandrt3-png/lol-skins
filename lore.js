const APP_ASSET_VERSION = new URL(import.meta.url).searchParams.get("v");
const LORE_METADATA_SOURCE = "data/skin-lore.json";
const WILD_RIFT_LORE_SOURCE = "data/wild-rift-lore.json";
const COMMUNITYDRAGON_BASE = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1";
const CHAMPION_SUMMARY_SOURCE = `${COMMUNITYDRAGON_BASE}/champion-summary.json`;

const lightbox = document.querySelector("#lightbox");
const loreButton = document.querySelector("#lightboxLore");
const lightboxTitle = document.querySelector("#lightboxTitle");

if (lightbox && loreButton && lightboxTitle) {
  setupLorePanel(lightbox, loreButton, lightboxTitle);
}

async function setupLorePanel(lightbox, loreButton, lightboxTitle) {
  // Keep the control visible in the fullscreen toolbar at all times. It is
  // temporarily disabled only while lore data is loading or truly unavailable.
  loreButton.hidden = false;
  loreButton.disabled = true;
  loreButton.setAttribute("aria-expanded", "false");
  loreButton.setAttribute("aria-label", "Loading lore");

  const scrim = document.createElement("button");
  scrim.type = "button";
  scrim.className = "lore-scrim";
  scrim.hidden = true;
  scrim.setAttribute("aria-label", "Close lore");

  const panel = document.createElement("section");
  panel.className = "lore-panel";
  panel.id = "lorePanel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "lorePanelTitle");
  panel.innerHTML = `
    <div class="lore-panel-handle" aria-hidden="true"></div>
    <div class="lore-panel-header">
      <div class="lore-heading-wrap">
        <span class="lore-kicker">Lore</span>
        <h2 id="lorePanelTitle"></h2>
      </div>
      <button class="lore-close" type="button" aria-label="Close lore">×</button>
    </div>
    <div class="lore-universe" id="loreUniverse"></div>
    <div class="lore-text" id="loreText"></div>`;

  lightbox.append(scrim, panel);

  const panelTitle = panel.querySelector("#lorePanelTitle");
  const universe = panel.querySelector("#loreUniverse");
  const loreText = panel.querySelector("#loreText");
  const closeButton = panel.querySelector(".lore-close");

  const championDataCache = new Map();
  let championSummaryPromise = null;
  let metadataEntries = [];
  let wildRiftLoreEntries = [];
  let currentLore = null;
  let syncToken = 0;

  const currentChampion = () => {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    return params.get("champion") || "";
  };

  const metadataFor = (championName, skinName) => metadataEntries.find((entry) =>
    normalizeKey(entry?.champion) === normalizeKey(championName)
      && normalizeKey(entry?.skin) === normalizeKey(skinName)
  ) || null;

  const wildRiftLoreFor = (championName, skinName) => wildRiftLoreEntries.find((entry) =>
    normalizeKey(entry?.champion) === normalizeKey(championName)
      && normalizeKey(entry?.skin) === normalizeKey(skinName)
  ) || null;

  const loadChampionSummary = () => {
    if (!championSummaryPromise) {
      championSummaryPromise = fetch(CHAMPION_SUMMARY_SOURCE, { cache: "default" })
        .then((response) => {
          if (!response.ok) throw new Error(`Champion summary unavailable (${response.status})`);
          return response.json();
        })
        .then((payload) => Array.isArray(payload) ? payload : [])
        .catch((error) => {
          championSummaryPromise = null;
          throw error;
        });
    }
    return championSummaryPromise;
  };

  const loadChampionData = async (championName) => {
    const key = normalizeKey(championName);
    if (!key) return null;
    if (championDataCache.has(key)) return championDataCache.get(key);

    const promise = (async () => {
      const summary = await loadChampionSummary();
      const champion = summary.find((entry) =>
        normalizeKey(entry?.name) === key || normalizeKey(entry?.alias) === key
      );
      if (!champion?.id) return null;

      const response = await fetch(`${COMMUNITYDRAGON_BASE}/champions/${champion.id}.json`, { cache: "default" });
      if (!response.ok) throw new Error(`Champion lore unavailable (${response.status})`);
      return response.json();
    })().catch((error) => {
      championDataCache.delete(key);
      console.warn(`Official Riot lore unavailable for ${championName}.`, error);
      return null;
    });

    championDataCache.set(key, promise);
    return promise;
  };

  const resolveOfficialLore = async (championName, displayedSkinName) => {
    if (!championName || !displayedSkinName) return null;

    const cleanSkinName = stripPlatformSuffix(displayedSkinName);
    const skinKey = normalizeKey(cleanSkinName);
    const championKey = normalizeKey(championName);
    const isBaseSkin = skinKey === championKey || skinKey === normalizeKey(`Classic ${championName}`);
    const isWildRiftSkin = /\(\s*wild\s+rift\s*\)\s*$/i.test(displayedSkinName);
    const metadata = metadataFor(championName, displayedSkinName) || metadataFor(championName, cleanSkinName);

    if (isWildRiftSkin) {
      const wrEntry = wildRiftLoreFor(championName, cleanSkinName);
      const text = officialText(wrEntry?.text);
      if (!text) return null;

      return {
        skin: displayedSkinName,
        universe: wrEntry?.universe || metadata?.universe || "Wild Rift",
        text,
      };
    }

    const championData = await loadChampionData(championName);
    if (!championData) return null;

    let text = "";
    if (isBaseSkin) {
      text = officialText(championData.shortBio);
    } else {
      const skin = (championData.skins || []).find((entry) => normalizeKey(entry?.name) === skinKey);
      text = officialText(skin?.description);

      if (!text) {
        for (const parentSkin of championData.skins || []) {
          const chroma = (parentSkin?.chromas || []).find((entry) => normalizeKey(entry?.name) === skinKey);
          if (chroma) {
            text = officialText(chroma.description);
            break;
          }
        }
      }
    }

    if (!text) return null;

    return {
      skin: displayedSkinName,
      universe: metadata?.universe || (isBaseSkin ? "Runeterra Prime" : "League of Legends"),
      text,
    };
  };

  const renderLore = (entry) => {
    panelTitle.textContent = entry?.skin || lightboxTitle.textContent.trim();
    universe.textContent = entry?.universe || "League of Legends";
    loreText.textContent = entry?.text || "";
  };

  const closeLore = ({ restoreFocus = true } = {}) => {
    if (!lightbox.classList.contains("is-lore-open")) return;
    lightbox.classList.remove("is-lore-open");
    panel.hidden = true;
    scrim.hidden = true;
    loreButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) loreButton.focus({ preventScroll: true });
  };

  const openLore = () => {
    if (!currentLore) return;
    renderLore(currentLore);
    scrim.hidden = false;
    panel.hidden = false;
    lightbox.classList.add("is-lore-open");
    loreButton.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => closeButton?.focus({ preventScroll: true }));
  };

  const sync = async () => {
    const token = ++syncToken;
    currentLore = null;
    loreButton.hidden = false;
    loreButton.disabled = true;
    loreButton.classList.add("is-loading-lore");
    loreButton.setAttribute("aria-label", "Loading lore");
    loreButton.title = "Loading lore";

    if (lightbox.hidden) {
      closeLore({ restoreFocus: false });
      return;
    }

    const championName = currentChampion();
    const displayedSkinName = lightboxTitle.textContent.trim();
    const lore = await resolveOfficialLore(championName, displayedSkinName);
    if (token !== syncToken || lightbox.hidden) return;
    if (displayedSkinName !== lightboxTitle.textContent.trim()) return;

    currentLore = lore;
    const available = Boolean(lore?.text);
    loreButton.hidden = false;
    loreButton.disabled = !available;
    loreButton.classList.remove("is-loading-lore");
    loreButton.setAttribute("aria-label", available ? `View ${displayedSkinName} lore` : "Lore unavailable");
    loreButton.title = available ? "View lore" : "Lore unavailable";

    if (lightbox.classList.contains("is-lore-open")) {
      if (!available) closeLore({ restoreFocus: false });
      else renderLore(lore);
    }
  };

  loreButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (lightbox.classList.contains("is-lore-open")) closeLore();
    else openLore();
  });

  closeButton?.addEventListener("click", () => closeLore());
  scrim.addEventListener("click", () => closeLore());

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !lightbox.classList.contains("is-lore-open")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeLore();
  }, { capture: true });

  const observer = new MutationObserver(() => queueMicrotask(sync));
  observer.observe(lightboxTitle, { childList: true, subtree: true, characterData: true });
  observer.observe(lightbox, { attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("hashchange", () => queueMicrotask(sync));

  // Register the UI first, then load local lore in parallel. Once the files are
  // ready, resync the current skin so opening fullscreen during deployment or a
  // slow network can no longer leave the button permanently hidden.
  Promise.all([
    loadLocalEntries(LORE_METADATA_SOURCE, "Lore metadata").then((entries) => {
      metadataEntries = entries;
    }),
    loadLocalEntries(WILD_RIFT_LORE_SOURCE, "Wild Rift lore").then((entries) => {
      wildRiftLoreEntries = entries;
    }),
  ]).finally(() => queueMicrotask(sync));

  sync();
}

async function loadLocalEntries(source, label) {
  try {
    const response = await fetch(versionedAsset(source), { cache: "no-store" });
    if (!response.ok) throw new Error(`${label} unavailable (${response.status})`);
    const payload = await response.json();
    return Array.isArray(payload?.entries) ? payload.entries : [];
  } catch (error) {
    console.warn(`${label} unavailable.`, error);
    return [];
  }
}

function versionedAsset(url) {
  if (!APP_ASSET_VERSION) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(APP_ASSET_VERSION)}`;
}

function stripPlatformSuffix(value) {
  return String(value || "").replace(/\s*\(\s*wild\s+rift\s*\)\s*$/i, "").trim();
}

function officialText(value) {
  return String(value || "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*\(\s*wild\s+rift\s*\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");
}
