const APP_ASSET_VERSION = new URL(import.meta.url).searchParams.get("v");
const LORE_SOURCE = "data/skin-lore.json";

const lightbox = document.querySelector("#lightbox");
const loreButton = document.querySelector("#lightboxLore");
const lightboxTitle = document.querySelector("#lightboxTitle");

if (lightbox && loreButton && lightboxTitle) {
  setupLorePanel(lightbox, loreButton, lightboxTitle);
}

async function setupLorePanel(lightbox, loreButton, lightboxTitle) {
  loreButton.hidden = true;
  loreButton.disabled = true;
  loreButton.setAttribute("aria-expanded", "false");

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
    <p class="lore-summary" id="loreSummary"></p>
    <div class="lore-details" id="loreDetails"></div>`;

  lightbox.append(scrim, panel);

  const panelTitle = panel.querySelector("#lorePanelTitle");
  const universe = panel.querySelector("#loreUniverse");
  const summary = panel.querySelector("#loreSummary");
  const details = panel.querySelector("#loreDetails");
  const closeButton = panel.querySelector(".lore-close");

  let entries = [];

  try {
    const url = versionedAsset(LORE_SOURCE);
    const response = await fetch(url, { cache: "default" });
    if (!response.ok) throw new Error(`Lore unavailable (${response.status})`);
    const payload = await response.json();
    entries = Array.isArray(payload?.entries) ? payload.entries : [];
  } catch (error) {
    console.warn("Lore data unavailable.", error);
  }

  const currentChampion = () => {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    return params.get("champion") || "";
  };

  const findCurrentEntry = () => {
    const championKey = normalizeKey(currentChampion());
    const skinKey = normalizeKey(lightboxTitle.textContent);
    if (!championKey || !skinKey) return null;

    return entries.find((entry) =>
      normalizeKey(entry?.champion) === championKey && normalizeKey(entry?.skin) === skinKey
    ) || null;
  };

  const renderEntry = (entry) => {
    panelTitle.textContent = entry?.skin || lightboxTitle.textContent.trim();
    universe.textContent = entry?.universe || "Alternate universe";
    summary.textContent = entry?.summary || "";

    details.replaceChildren();
    for (const paragraph of entry?.details || []) {
      const element = document.createElement("p");
      element.textContent = paragraph;
      details.appendChild(element);
    }
  };

  const closeLore = ({ restoreFocus = true } = {}) => {
    if (!lightbox.classList.contains("is-lore-open")) return;
    lightbox.classList.remove("is-lore-open");
    panel.hidden = true;
    scrim.hidden = true;
    loreButton.setAttribute("aria-expanded", "false");
    if (restoreFocus && !loreButton.hidden) loreButton.focus({ preventScroll: true });
  };

  const openLore = () => {
    const entry = findCurrentEntry();
    if (!entry) return;

    renderEntry(entry);
    scrim.hidden = false;
    panel.hidden = false;
    lightbox.classList.add("is-lore-open");
    loreButton.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => closeButton?.focus({ preventScroll: true }));
  };

  const sync = () => {
    const entry = findCurrentEntry();
    const available = Boolean(entry) && !lightbox.hidden;
    loreButton.hidden = !available;
    loreButton.disabled = !available;
    loreButton.setAttribute("aria-label", available ? `View ${lightboxTitle.textContent.trim()} lore` : "Lore unavailable");
    loreButton.title = available ? "View lore" : "";

    if (lightbox.classList.contains("is-lore-open")) {
      if (!available) closeLore({ restoreFocus: false });
      else renderEntry(entry);
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

  sync();
}

function versionedAsset(url) {
  if (!APP_ASSET_VERSION) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(APP_ASSET_VERSION)}`;
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
