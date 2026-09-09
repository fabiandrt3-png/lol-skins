import { loadSkinData } from "./data-loader.js";

const FAVORITES_KEY = "lol-skins:favorites:v2";
const IMAGE_FALLBACK = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
  <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#16171a"/><stop offset="1" stop-color="#050506"/></linearGradient></defs>
  <rect width="1600" height="900" fill="url(#g)"/>
  <text x="800" y="450" fill="#73737a" font-family="Arial,sans-serif" font-size="52" text-anchor="middle">Image indisponible</text>
</svg>`);

const els = {
  backButton: document.querySelector("#backButton"),
  heroBackdrop: document.querySelector("#heroBackdrop"),
  pageTitle: document.querySelector("#pageTitle"),
  searchInput: document.querySelector("#searchInput"),
  filterRow: document.querySelector("#filterRow"),
  filterButtons: [...document.querySelectorAll(".filter-chip")],
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
  lightboxClose: document.querySelector("#lightboxClose"),
  lightboxPrev: document.querySelector("#lightboxPrev"),
  lightboxNext: document.querySelector("#lightboxNext"),
  lightboxFigure: document.querySelector("#lightboxFigure"),
};

const state = {
  skins: [],
  skinsByChampion: new Map(),
  championSummaries: [],
  currentChampion: null,
  search: "",
  filter: "all",
  favorites: readFavorites(),
  visibleSkins: [],
  lightboxIndex: -1,
  touchStartX: null,
  renderFrame: 0,
  lastFocus: null,
};

const failedImageSources = new Set();

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
    els.emptyState.querySelector("p").textContent = "Recharge la page ou vérifie les fichiers du dépôt.";
  }
}

function buildIndexes() {
  const grouped = new Map();

  for (const skin of state.skins) {
    if (!grouped.has(skin.champ)) grouped.set(skin.champ, []);
    grouped.get(skin.champ).push(skin);
  }

  state.skinsByChampion = grouped;
  state.championSummaries = [...grouped.entries()]
    .map(([champion, skins]) => {
      const first = skins[0];
      const iconCandidates = unique([
        ...skins.flatMap((skin) => skin.iconCandidates || []),
        ...skins.map((skin) => skin.icon),
        ...(first?.imageCandidates || []),
        first?.image,
      ]);

      return {
        champion,
        skins,
        iconCandidates,
        total: skins.length,
        pcCount: skins.filter((skin) => skin.type !== "Wild Rift").length,
        wrCount: skins.filter((skin) => skin.type === "Wild Rift").length,
      };
    })
    .sort((a, b) => a.champion.localeCompare(b.champion, "fr"));
}

function bindEvents() {
  window.addEventListener("hashchange", handleRoute);
  els.backButton.addEventListener("click", navigateHome);

  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLocaleLowerCase("fr");
    scheduleRender();
  });

  els.filterRow.addEventListener("click", (event) => {
    const button = event.target.closest(".filter-chip");
    if (!button) return;

    state.filter = button.dataset.filter || "all";
    els.filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    renderCurrentView();
  });

  els.cardGrid.addEventListener("click", (event) => {
    const favoriteButton = event.target.closest("[data-favorite-id]");
    if (favoriteButton) {
      toggleFavorite(favoriteButton.dataset.favoriteId);
      return;
    }

    const skinPreview = event.target.closest("[data-skin-index]");
    if (skinPreview) {
      openLightbox(Number(skinPreview.dataset.skinIndex));
      return;
    }

    const championCard = event.target.closest("[data-champion]");
    if (championCard) navigateToChampion(championCard.dataset.champion);
  });

  document.addEventListener("keydown", (event) => {
    const isTyping = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "");

    if (event.key === "/" && !isTyping && els.lightbox.hidden) {
      event.preventDefault();
      els.searchInput.focus();
      return;
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

function scheduleRender() {
  cancelAnimationFrame(state.renderFrame);
  state.renderFrame = requestAnimationFrame(renderCurrentView);
}

function handleRoute() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const requestedChampion = params.get("champion");
  state.currentChampion = requestedChampion && state.skinsByChampion.has(requestedChampion) ? requestedChampion : null;
  state.search = "";
  state.filter = "all";
  els.searchInput.value = "";
  els.filterButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.filter === "all"));
  closeLightbox({ restoreFocus: false });

  document.body.classList.toggle("is-champion-view", Boolean(state.currentChampion));
  document.title = state.currentChampion ? `${state.currentChampion} · LoL Skins` : "LoL Skins";
  renderCurrentView();
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
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

  const champions = state.championSummaries.filter(({ champion }) =>
    champion.toLocaleLowerCase("fr").includes(state.search)
  );

  els.resultCount.textContent = pluralize(champions.length, "champion", "champions");
  renderCards(champions, createChampionCard, "card-grid champion-grid");
}

function renderSkinsView(champion) {
  els.backButton.hidden = false;
  els.filterRow.hidden = false;
  els.searchInput.placeholder = `Rechercher un skin de ${champion}…`;
  els.pageTitle.textContent = champion;
  els.sectionKicker.textContent = "Collection";
  els.sectionTitle.textContent = `Skins de ${champion}`;

  const allChampionSkins = state.skinsByChampion.get(champion) || [];
  const heroSkin = allChampionSkins.find((skin) => !/chroma/i.test(skin.skin)) || allChampionSkins[0];
  const heroImage = primaryImage(heroSkin);
  els.heroBackdrop.style.backgroundImage = heroImage ? `url("${cssUrl(heroImage)}")` : "";

  state.visibleSkins = allChampionSkins.filter(matchesCurrentFilters);
  els.resultCount.textContent = pluralize(state.visibleSkins.length, "résultat", "résultats");
  renderCards(state.visibleSkins, createSkinCard, "card-grid skin-grid");
}

function renderCards(items, factory, className) {
  els.cardGrid.replaceChildren();
  els.cardGrid.className = className;

  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => fragment.appendChild(factory(item, index)));
  els.cardGrid.appendChild(fragment);
  setEmpty(items.length === 0);
}

function createChampionCard(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "champion-card";
  button.dataset.champion = item.champion;
  button.setAttribute("aria-label", `Voir les skins de ${item.champion}`);
  button.innerHTML = `
    <span class="champion-image-wrap">
      <img class="champion-image" alt="" loading="lazy" decoding="async">
      <span class="champion-glow" aria-hidden="true"></span>
    </span>
    <span class="champion-info">
      <strong>${escapeHtml(item.champion)}</strong>
      <span>${item.total} entrées</span>
      <small>${item.pcCount} PC${item.wrCount ? ` · ${item.wrCount} WR` : ""}</small>
    </span>
    <span class="card-arrow" aria-hidden="true">›</span>`;

  setImageSources(button.querySelector("img"), item.iconCandidates);
  return button;
}

function createSkinCard(skin, index) {
  const article = document.createElement("article");
  article.className = "skin-card";
  const isFavorite = state.favorites.has(skin._id);
  const badges = badgesFor(skin);

  article.innerHTML = `
    <button class="skin-preview" type="button" data-skin-index="${index}" aria-label="Ouvrir ${escapeAttr(displaySkinName(skin))} en plein écran">
      <img alt="${escapeAttr(displaySkinName(skin))}" loading="lazy" decoding="async">
    </button>
    <div class="skin-meta">
      <div class="skin-title-wrap">
        <h3>${formatSkinName(skin)}</h3>
        ${badges ? `<div class="skin-badges">${badges}</div>` : `<p>${skin.type === "Wild Rift" ? "Wild Rift" : "League of Legends PC"}</p>`}
      </div>
      <button class="favorite-button ${isFavorite ? "is-favorite" : ""}" type="button" data-favorite-id="${escapeAttr(skin._id)}" aria-label="${isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}" aria-pressed="${isFavorite}">${isFavorite ? "♥" : "♡"}</button>
    </div>`;

  setImageSources(article.querySelector("img"), imageSources(skin));
  return article;
}

function matchesCurrentFilters(skin) {
  if (!displaySkinName(skin).toLocaleLowerCase("fr").includes(state.search)) return false;

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
  state.lastFocus = document.activeElement;
  els.lightbox.hidden = false;
  document.body.classList.add("is-lightbox-open");
  renderLightbox();
  requestAnimationFrame(() => els.lightboxClose.focus());
}

function closeLightbox({ restoreFocus = true } = {}) {
  if (els.lightbox.hidden) return;
  els.lightbox.hidden = true;
  document.body.classList.remove("is-lightbox-open");
  state.lightboxIndex = -1;

  if (restoreFocus && state.lastFocus instanceof HTMLElement) state.lastFocus.focus({ preventScroll: true });
  state.lastFocus = null;
}

function moveLightbox(direction) {
  if (!state.visibleSkins.length) return;
  state.lightboxIndex = (state.lightboxIndex + direction + state.visibleSkins.length) % state.visibleSkins.length;
  renderLightbox();
}

function renderLightbox() {
  const skin = state.visibleSkins[state.lightboxIndex];
  if (!skin) return;

  setImageSources(els.lightboxImage, imageSources(skin), { eager: true });
  els.lightboxImage.alt = displaySkinName(skin);
  els.lightboxTitle.textContent = displaySkinName(skin);
  els.lightboxPosition.textContent = `${state.lightboxIndex + 1} / ${state.visibleSkins.length}`;

  const isFavorite = state.favorites.has(skin._id);
  els.lightboxFavorite.textContent = isFavorite ? "♥" : "♡";
  els.lightboxFavorite.classList.toggle("is-favorite", isFavorite);
  els.lightboxFavorite.setAttribute("aria-label", isFavorite ? "Retirer des favoris" : "Ajouter aux favoris");
  els.lightboxFavorite.setAttribute("aria-pressed", String(isFavorite));

  const disableNav = state.visibleSkins.length <= 1;
  els.lightboxPrev.disabled = disableNav;
  els.lightboxNext.disabled = disableNav;
}

function toggleFavorite(id) {
  if (!id) return;
  const previousLightboxId = state.lightboxIndex >= 0 ? state.visibleSkins[state.lightboxIndex]?._id : null;

  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  saveFavorites();
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
  if (location.hash) location.hash = "";
  else {
    state.currentChampion = null;
    document.body.classList.remove("is-champion-view");
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
  return skin.type === "Wild Rift" && !/\(Wild Rift\)/i.test(skin.skin)
    ? `${skin.skin} (Wild Rift)`
    : skin.skin;
}

function formatSkinName(skin) {
  const value = displaySkinName(skin);
  const pattern = /\(([^)]+)\)/g;
  let result = "";
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(value))) {
    result += escapeHtml(value.slice(lastIndex, match.index));
    const content = match[1];
    let className = "skin-tag";
    if (/wild rift/i.test(content)) className += " skin-tag-wr";
    else if (/prestige|special edition|mythic chroma|exquisite edition/i.test(content)) className += " skin-tag-prestige";
    else if (/chroma/i.test(content)) className += " skin-tag-chroma";
    result += `<span class="${className}">(${escapeHtml(content)})</span>`;
    lastIndex = pattern.lastIndex;
  }

  return result + escapeHtml(value.slice(lastIndex));
}

function imageSources(skin) {
  return unique([...(skin?.imageCandidates || []), skin?.image, skin?._legacyImage]);
}

function primaryImage(skin) {
  return imageSources(skin)[0] || "";
}

function setImageSources(image, candidates, { eager = false } = {}) {
  if (!image) return;

  const sources = unique(candidates).filter((source) => !failedImageSources.has(source));
  let index = 0;

  image.classList.remove("is-fallback");
  image.loading = eager ? "eager" : "lazy";
  image.fetchPriority = eager ? "high" : "auto";

  const loadCurrent = () => {
    if (index >= sources.length) {
      image.onerror = null;
      image.src = IMAGE_FALLBACK;
      image.classList.add("is-fallback");
      return;
    }
    image.src = sources[index];
  };

  image.onerror = () => {
    if (sources[index]) failedImageSources.add(sources[index]);
    index += 1;
    loadCurrent();
  };

  image.onload = () => image.classList.remove("is-fallback");
  loadCurrent();
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

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function cssUrl(value) {
  return String(value).replace(/["\\\n\r]/g, (char) => `\\${char}`);
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
