import { loadSkinData, resolveChampionAssets } from "./data-loader.js";

const FAVORITES_KEY = "lol-skins:favorites:v2";
const COLLATOR = new Intl.Collator("fr", { sensitivity: "base" });
const IMAGE_FALLBACK = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
  <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#161a22"/><stop offset="1" stop-color="#080a0f"/></linearGradient></defs>
  <rect width="1600" height="900" fill="url(#g)"/>
  <text x="800" y="450" fill="#737b8c" font-family="Arial,sans-serif" font-size="52" text-anchor="middle">Image indisponible</text>
</svg>`);

const els = {
  backButton: document.querySelector("#backButton"),
  heroBackdrop: document.querySelector("#heroBackdrop"),
  pageTitle: document.querySelector("#pageTitle"),
  searchInput: document.querySelector("#searchInput"),
  filterRow: document.querySelector("#filterRow"),
  sectionKicker: document.querySelector("#sectionKicker"),
  sectionTitle: document.querySelector("#sectionTitle"),
  resultCount: document.querySelector("#resultCount"),
  loadingState: document.querySelector("#loadingState"),
  emptyState: document.querySelector("#emptyState"),
  cardGrid: document.querySelector("#cardGrid"),
  lightbox: document.querySelector("#lightbox"),
  lightboxImage: document.querySelector("#lightboxImage"),
  lightboxTitle: document.querySelector("#lightboxTitle"),
  lightboxPosition: document.querySelector("#lightboxPosition"),
  lightboxFavorite: document.querySelector("#lightboxFavorite"),
  lightboxPrev: document.querySelector("#lightboxPrev"),
  lightboxNext: document.querySelector("#lightboxNext"),
  lightboxFigure: document.querySelector("#lightboxFigure"),
};

const state = {
  skins: [],
  champions: [],
  byChampion: new Map(),
  currentChampion: null,
  search: "",
  filter: "all",
  favorites: readFavorites(),
  visibleSkins: [],
  lightboxIndex: -1,
  touchStartX: null,
  assetRequest: 0,
  renderFrame: 0,
};

init();

async function init() {
  bindEvents();
  try {
    state.skins = await loadSkinData();
    buildIndexes();
    setLoaded(true);
    handleRoute();
  } catch (error) {
    console.error(error);
    setLoaded(true);
    els.cardGrid.hidden = true;
    els.emptyState.hidden = false;
    els.emptyState.querySelector("h3").textContent = "Impossible de charger la collection";
    els.emptyState.querySelector("p").textContent = "La source de données n'a pas pu être lue. Recharge la page ou vérifie le dépôt.";
  }
}

function buildIndexes() {
  const grouped = new Map();
  for (const skin of state.skins) {
    if (!grouped.has(skin.champ)) grouped.set(skin.champ, []);
    grouped.get(skin.champ).push(skin);
  }
  state.byChampion = grouped;
  state.champions = [...grouped.keys()].sort(COLLATOR.compare);
}

function bindEvents() {
  window.addEventListener("hashchange", handleRoute);
  els.backButton.addEventListener("click", navigateHome);

  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLocaleLowerCase("fr");
    queueRender();
  });

  els.filterRow.addEventListener("click", (event) => {
    const button = event.target.closest(".filter-chip");
    if (!button) return;
    state.filter = button.dataset.filter || "all";
    updateActiveFilter();
    renderCurrentView();
  });

  els.cardGrid.addEventListener("click", (event) => {
    const championButton = event.target.closest("[data-champion]");
    if (championButton) {
      navigateToChampion(championButton.dataset.champion);
      return;
    }

    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "open-skin") {
      openLightbox(Number(action.dataset.index));
    } else if (action.dataset.action === "favorite") {
      toggleFavorite(action.dataset.id);
    }
  });

  document.addEventListener("keydown", (event) => {
    const isTyping = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "");
    if (event.key === "/" && !isTyping && els.lightbox.hidden) {
      event.preventDefault();
      els.searchInput.focus();
    }
    if (els.lightbox.hidden) return;
    if (event.key === "Escape") closeLightbox();
    if (event.key === "ArrowLeft") moveLightbox(-1);
    if (event.key === "ArrowRight") moveLightbox(1);
  });

  document.querySelectorAll("[data-close-lightbox]").forEach((element) => {
    element.addEventListener("click", closeLightbox);
  });
  els.lightboxPrev.addEventListener("click", () => moveLightbox(-1));
  els.lightboxNext.addEventListener("click", () => moveLightbox(1));
  els.lightboxFavorite.addEventListener("click", () => {
    const skin = state.visibleSkins[state.lightboxIndex];
    if (skin) toggleFavorite(skin._id);
  });

  els.lightboxFigure.addEventListener("touchstart", (event) => {
    state.touchStartX = event.changedTouches[0]?.clientX ?? null;
  }, { passive: true });
  els.lightboxFigure.addEventListener("touchend", (event) => {
    if (state.touchStartX === null) return;
    const endX = event.changedTouches[0]?.clientX ?? state.touchStartX;
    const delta = endX - state.touchStartX;
    state.touchStartX = null;
    if (Math.abs(delta) >= 45) moveLightbox(delta > 0 ? -1 : 1);
  }, { passive: true });
}

function queueRender() {
  cancelAnimationFrame(state.renderFrame);
  state.renderFrame = requestAnimationFrame(renderCurrentView);
}

function handleRoute() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const requestedChampion = params.get("champion");
  state.currentChampion = requestedChampion && state.byChampion.has(requestedChampion) ? requestedChampion : null;
  state.search = "";
  state.filter = "all";
  els.searchInput.value = "";
  updateActiveFilter();
  closeLightbox();
  renderCurrentView();
  window.scrollTo({ top: 0, behavior: "auto" });

  if (state.currentChampion) hydrateChampionAssets(state.currentChampion);
}

function updateActiveFilter() {
  els.filterRow.querySelectorAll(".filter-chip").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === state.filter);
  });
}

async function hydrateChampionAssets(champion) {
  const request = ++state.assetRequest;
  try {
    await resolveChampionAssets(state.skins, champion);
    if (request !== state.assetRequest || state.currentChampion !== champion) return;
    renderCurrentView();
  } catch (error) {
    console.warn(`Assets haute qualité indisponibles pour ${champion}.`, error);
  }
}

function renderCurrentView() {
  if (state.currentChampion) renderSkinsView(state.currentChampion);
  else renderChampionsView();
}

function renderChampionsView() {
  els.backButton.hidden = true;
  els.filterRow.hidden = true;
  els.searchInput.placeholder = "Rechercher un champion…";
  els.pageTitle.textContent = "Tous les champions";
  els.sectionKicker.textContent = "Collection";
  els.sectionTitle.textContent = "Champions";
  els.heroBackdrop.style.backgroundImage = "";

  const query = state.search;
  const champions = query
    ? state.champions.filter((champion) => champion.toLocaleLowerCase("fr").includes(query))
    : state.champions;

  const fragment = document.createDocumentFragment();
  for (const champion of champions) {
    fragment.appendChild(createChampionCard(champion, state.byChampion.get(champion) || []));
  }
  replaceGrid(fragment, "card-grid champion-grid");
  els.resultCount.textContent = pluralize(champions.length, "champion", "champions");
  setEmpty(champions.length === 0);
}

function renderSkinsView(champion) {
  els.backButton.hidden = false;
  els.filterRow.hidden = false;
  els.searchInput.placeholder = `Rechercher un skin de ${champion}…`;

  const allChampionSkins = state.byChampion.get(champion) || [];
  const heroImage = primaryImage(allChampionSkins[0]);
  els.heroBackdrop.style.backgroundImage = heroImage ? `url("${cssUrl(heroImage)}")` : "";
  els.pageTitle.textContent = champion;
  els.sectionKicker.textContent = "Collection";
  els.sectionTitle.textContent = `Skins de ${champion}`;

  state.visibleSkins = allChampionSkins.filter(matchesCurrentFilters);
  const fragment = document.createDocumentFragment();
  state.visibleSkins.forEach((skin, index) => fragment.appendChild(createSkinCard(skin, index)));
  replaceGrid(fragment, "card-grid skin-grid");
  els.resultCount.textContent = pluralize(state.visibleSkins.length, "résultat", "résultats");
  setEmpty(state.visibleSkins.length === 0);
}

function replaceGrid(fragment, className) {
  els.cardGrid.className = className;
  els.cardGrid.replaceChildren(fragment);
}

function createChampionCard(champion, championSkins) {
  const first = championSkins[0];
  const iconCandidates = unique([
    ...(championSkins.find((skin) => skin.iconCandidates?.length)?.iconCandidates || []),
    championSkins.find((skin) => skin.icon)?.icon,
    ...(first?.imageCandidates || []),
    first?.image,
  ]);
  const pcCount = championSkins.reduce((count, skin) => count + (skin.type === "Wild Rift" ? 0 : 1), 0);
  const wrCount = championSkins.length - pcCount;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "champion-card";
  button.dataset.champion = champion;
  button.setAttribute("aria-label", `Voir les skins de ${champion}`);
  button.innerHTML = `
    <span class="champion-image-wrap"><img class="champion-image" alt="" loading="lazy" decoding="async" fetchpriority="low"><span class="champion-glow" aria-hidden="true"></span></span>
    <span class="champion-info"><strong>${escapeHtml(champion)}</strong><span>${championSkins.length} entrées</span><small>${pcCount} PC${wrCount ? ` · ${wrCount} WR` : ""}</small></span>
    <span class="card-arrow" aria-hidden="true">›</span>`;
  setImageSources(button.querySelector("img"), iconCandidates);
  return button;
}

function createSkinCard(skin, index) {
  const article = document.createElement("article");
  article.className = "skin-card";
  const isFavorite = state.favorites.has(skin._id);
  article.innerHTML = `
    <button class="skin-preview" type="button" data-action="open-skin" data-index="${index}" aria-label="Ouvrir ${escapeAttr(displaySkinName(skin))} en plein écran">
      <img alt="${escapeAttr(displaySkinName(skin))}" loading="lazy" decoding="async" fetchpriority="low">
      <span class="skin-gradient" aria-hidden="true"></span><span class="skin-badges">${badgesFor(skin)}</span>
    </button>
    <div class="skin-meta">
      <div class="skin-title-wrap"><h3>${formatSkinName(skin)}</h3><p>${skin.type === "Wild Rift" ? "Wild Rift" : "League of Legends PC"}</p></div>
      <button class="favorite-button ${isFavorite ? "is-favorite" : ""}" type="button" data-action="favorite" data-id="${escapeAttr(skin._id)}" aria-label="${isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}" aria-pressed="${isFavorite}">${isFavorite ? "♥" : "♡"}</button>
    </div>`;
  setImageSources(article.querySelector("img"), imageSources(skin));
  return article;
}

function matchesCurrentFilters(skin) {
  if (state.search && !displaySkinName(skin).toLocaleLowerCase("fr").includes(state.search)) return false;
  switch (state.filter) {
    case "pc": return skin.type !== "Wild Rift";
    case "wild-rift": return skin.type === "Wild Rift";
    case "prestige": return /prestige|mythic chroma|special edition|exquisite edition/i.test(skin.skin);
    case "chroma": return /chroma/i.test(skin.skin);
    case "favorites": return state.favorites.has(skin._id);
    default: return true;
  }
}

function openLightbox(index) {
  if (!state.visibleSkins[index]) return;
  state.lightboxIndex = index;
  els.lightbox.hidden = false;
  document.body.classList.add("is-lightbox-open");
  els.lightboxImage.fetchPriority = "high";
  renderLightbox();
}

function closeLightbox() {
  if (els.lightbox.hidden) return;
  els.lightbox.hidden = true;
  document.body.classList.remove("is-lightbox-open");
  state.lightboxIndex = -1;
}

function moveLightbox(direction) {
  if (!state.visibleSkins.length) return;
  state.lightboxIndex = (state.lightboxIndex + direction + state.visibleSkins.length) % state.visibleSkins.length;
  renderLightbox();
}

function renderLightbox() {
  const skin = state.visibleSkins[state.lightboxIndex];
  if (!skin) return;
  setImageSources(els.lightboxImage, imageSources(skin));
  els.lightboxImage.alt = displaySkinName(skin);
  els.lightboxTitle.textContent = displaySkinName(skin);
  els.lightboxPosition.textContent = `${state.lightboxIndex + 1} / ${state.visibleSkins.length}`;
  const isFavorite = state.favorites.has(skin._id);
  els.lightboxFavorite.textContent = isFavorite ? "♥" : "♡";
  els.lightboxFavorite.classList.toggle("is-favorite", isFavorite);
  els.lightboxFavorite.setAttribute("aria-label", isFavorite ? "Retirer des favoris" : "Ajouter aux favoris");
}

function toggleFavorite(id) {
  if (!id) return;
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  saveFavorites();

  const previousLightboxId = state.lightboxIndex >= 0 ? state.visibleSkins[state.lightboxIndex]?._id : null;
  renderCurrentView();
  if (!els.lightbox.hidden && previousLightboxId) {
    const nextIndex = state.visibleSkins.findIndex((skin) => skin._id === previousLightboxId);
    if (nextIndex === -1) closeLightbox();
    else {
      state.lightboxIndex = nextIndex;
      renderLightbox();
    }
  }
}

function navigateToChampion(champion) {
  if (!champion) return;
  const params = new URLSearchParams();
  params.set("champion", champion);
  location.hash = params.toString();
}

function navigateHome() {
  state.assetRequest += 1;
  if (location.hash) location.hash = "";
  else {
    state.currentChampion = null;
    renderCurrentView();
  }
}

function badgesFor(skin) {
  const badges = [];
  if (skin.type === "Wild Rift") badges.push('<span class="badge badge-wr">Wild Rift</span>');
  if (/prestige/i.test(skin.skin)) badges.push('<span class="badge badge-prestige">Prestige</span>');
  else if (/mythic chroma|special edition|exquisite edition/i.test(skin.skin)) badges.push('<span class="badge badge-prestige">Mythic</span>');
  if (/chroma/i.test(skin.skin)) badges.push('<span class="badge badge-chroma">Chroma</span>');
  return badges.join("");
}

function displaySkinName(skin) {
  return skin.type === "Wild Rift" && !/\(Wild Rift\)/i.test(skin.skin) ? `${skin.skin} (Wild Rift)` : skin.skin;
}

function formatSkinName(skin) {
  const raw = displaySkinName(skin);
  let output = "";
  let cursor = 0;
  const pattern = /\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(raw))) {
    output += escapeHtml(raw.slice(cursor, match.index));
    const content = match[1];
    let className = "skin-tag";
    if (/wild rift/i.test(content)) className += " skin-tag-wr";
    else if (/prestige|special edition|mythic chroma|exquisite edition/i.test(content)) className += " skin-tag-prestige";
    else if (/chroma/i.test(content)) className += " skin-tag-chroma";
    output += `<span class="${className}">(${escapeHtml(content)})</span>`;
    cursor = pattern.lastIndex;
  }
  return output + escapeHtml(raw.slice(cursor));
}

function imageSources(skin) {
  return unique([...(skin?.imageCandidates || []), skin?.image, skin?._legacyImage]);
}

function primaryImage(skin) {
  return imageSources(skin)[0] || "";
}

function setImageSources(image, candidates) {
  if (!image) return;
  const sources = unique(candidates);
  let index = 0;
  image.classList.remove("is-fallback");
  image.onerror = () => {
    index += 1;
    if (index < sources.length) {
      image.src = sources[index];
      return;
    }
    image.onerror = null;
    image.src = IMAGE_FALLBACK;
    image.classList.add("is-fallback");
  };
  image.src = sources[0] || IMAGE_FALLBACK;
}

function setLoaded(loaded) {
  els.loadingState.hidden = loaded;
  if (loaded) els.cardGrid.hidden = false;
}

function setEmpty(isEmpty) {
  els.emptyState.hidden = !isEmpty;
  els.cardGrid.hidden = isEmpty;
}

function readFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
  } catch (error) {
    console.warn("Impossible d’enregistrer les favoris.", error);
  }
}

function pluralize(count, singular, plural) { return `${count} ${count > 1 ? plural : singular}`; }
function cssUrl(value) { return String(value).replace(/["\\\n\r]/g, (char) => `\\${char}`); }
function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function escapeAttr(value) { return escapeHtml(value); }
