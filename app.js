import { loadSkinData } from "./data-loader.js";

const FAVORITES_KEY = "lol-skins:favorites:v2";
const IMAGE_FALLBACK = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
  <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#161a22"/><stop offset="1" stop-color="#080a0f"/></linearGradient></defs>
  <rect width="1600" height="900" fill="url(#g)"/>
  <text x="800" y="450" fill="#737b8c" font-family="Arial,sans-serif" font-size="52" text-anchor="middle">Image indisponible</text>
</svg>`);

const els = {
  backButton: document.querySelector("#backButton"),
  brand: document.querySelector(".brand"),
  globalCounter: document.querySelector("#globalCounter"),
  heroBackdrop: document.querySelector("#heroBackdrop"),
  eyebrow: document.querySelector("#eyebrow"),
  pageTitle: document.querySelector("#pageTitle"),
  pageDescription: document.querySelector("#pageDescription"),
  searchInput: document.querySelector("#searchInput"),
  searchShortcut: document.querySelector("#searchShortcut"),
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
  lightboxPrev: document.querySelector("#lightboxPrev"),
  lightboxNext: document.querySelector("#lightboxNext"),
  lightboxFigure: document.querySelector("#lightboxFigure"),
};

const state = {
  skins: [],
  currentChampion: null,
  search: "",
  filter: "all",
  favorites: readFavorites(),
  visibleSkins: [],
  lightboxIndex: -1,
  touchStartX: null,
};

init();

async function init() {
  bindEvents();
  try {
    state.skins = await loadSkinData();
    els.globalCounter.textContent = `${getChampionNames().length} champions · ${state.skins.length} entrées`;
    setLoaded(true);
    handleRoute();
  } catch (error) {
    console.error(error);
    setLoaded(true);
    els.cardGrid.hidden = true;
    els.emptyState.hidden = false;
    els.emptyState.querySelector("h3").textContent = "Impossible de charger la collection";
    els.emptyState.querySelector("p").textContent = "La source de données legacy n'a pas pu être lue. Recharge la page ou vérifie le dépôt.";
  }
}

function bindEvents() {
  window.addEventListener("hashchange", handleRoute);
  els.backButton.addEventListener("click", () => navigateHome());
  els.brand.addEventListener("click", (event) => {
    event.preventDefault();
    navigateHome();
  });

  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderCurrentView();
  });

  els.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      els.filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      renderCurrentView();
    });
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
    if (Math.abs(delta) < 45) return;
    moveLightbox(delta > 0 ? -1 : 1);
  }, { passive: true });
}

function handleRoute() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const requestedChampion = params.get("champion");
  const exists = requestedChampion && state.skins.some((skin) => skin.champ === requestedChampion);

  state.currentChampion = exists ? requestedChampion : null;
  state.search = "";
  state.filter = "all";
  els.searchInput.value = "";
  els.filterButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.filter === "all"));
  closeLightbox();
  renderCurrentView();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function renderCurrentView() {
  if (state.currentChampion) {
    renderSkinsView(state.currentChampion);
  } else {
    renderChampionsView();
  }
}

function renderChampionsView() {
  els.backButton.hidden = true;
  els.filterRow.hidden = true;
  els.searchInput.placeholder = "Rechercher un champion…";
  els.eyebrow.textContent = "League of Legends · Wild Rift";
  els.pageTitle.textContent = "Tous les champions";
  els.pageDescription.textContent = "Parcours ta collection de splash arts, skins, chromas et éditions spéciales.";
  els.sectionKicker.textContent = "Collection";
  els.sectionTitle.textContent = "Champions";
  els.heroBackdrop.style.backgroundImage = "";

  const query = state.search;
  const champions = getChampionNames()
    .filter((champion) => champion.toLowerCase().includes(query))
    .map((champion) => {
      const championSkins = state.skins.filter((skin) => skin.champ === champion);
      const icon = championSkins.find((skin) => skin.icon)?.icon || championSkins[0]?.image || IMAGE_FALLBACK;
      const pcCount = championSkins.filter((skin) => skin.type !== "Wild Rift").length;
      const wrCount = championSkins.filter((skin) => skin.type === "Wild Rift").length;
      return { champion, icon, total: championSkins.length, pcCount, wrCount };
    });

  els.resultCount.textContent = pluralize(champions.length, "champion", "champions");
  els.cardGrid.innerHTML = "";
  els.cardGrid.className = "card-grid champion-grid";

  const fragment = document.createDocumentFragment();
  champions.forEach((item) => fragment.appendChild(createChampionCard(item)));
  els.cardGrid.appendChild(fragment);
  setEmpty(champions.length === 0);
}

function renderSkinsView(champion) {
  els.backButton.hidden = false;
  els.filterRow.hidden = false;
  els.searchInput.placeholder = `Rechercher un skin de ${champion}…`;

  const allChampionSkins = state.skins.filter((skin) => skin.champ === champion);
  const heroImage = allChampionSkins[0]?.image || "";
  els.heroBackdrop.style.backgroundImage = heroImage ? `url("${cssUrl(heroImage)}")` : "";
  els.eyebrow.textContent = "Champion";
  els.pageTitle.textContent = champion;
  els.pageDescription.textContent = `${pluralize(allChampionSkins.length, "skin / variante", "skins / variantes")} dans ta collection.`;
  els.sectionKicker.textContent = "Collection";
  els.sectionTitle.textContent = `Skins de ${champion}`;

  state.visibleSkins = allChampionSkins.filter(matchesCurrentFilters);
  els.resultCount.textContent = pluralize(state.visibleSkins.length, "résultat", "résultats");
  els.cardGrid.innerHTML = "";
  els.cardGrid.className = "card-grid skin-grid";

  const fragment = document.createDocumentFragment();
  state.visibleSkins.forEach((skin, index) => fragment.appendChild(createSkinCard(skin, index)));
  els.cardGrid.appendChild(fragment);
  setEmpty(state.visibleSkins.length === 0);
}

function createChampionCard(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "champion-card";
  button.setAttribute("aria-label", `Voir les skins de ${item.champion}`);
  button.innerHTML = `
    <span class="champion-image-wrap">
      <img class="champion-image" src="${escapeAttr(item.icon)}" alt="" loading="lazy" decoding="async">
      <span class="champion-glow" aria-hidden="true"></span>
    </span>
    <span class="champion-info">
      <strong>${escapeHtml(item.champion)}</strong>
      <span>${item.total} entrées</span>
      <small>${item.pcCount} PC${item.wrCount ? ` · ${item.wrCount} WR` : ""}</small>
    </span>
    <span class="card-arrow" aria-hidden="true">→</span>
  `;
  attachImageFallback(button.querySelector("img"));
  button.addEventListener("click", () => navigateToChampion(item.champion));
  return button;
}

function createSkinCard(skin, index) {
  const article = document.createElement("article");
  article.className = "skin-card";

  const isFavorite = state.favorites.has(skin._id);
  article.innerHTML = `
    <button class="skin-preview" type="button" aria-label="Ouvrir ${escapeAttr(skin.skin)} en plein écran">
      <img src="${escapeAttr(skin.image)}" alt="${escapeAttr(displaySkinName(skin))}" loading="lazy" decoding="async">
      <span class="skin-gradient" aria-hidden="true"></span>
      <span class="skin-badges">${badgesFor(skin)}</span>
    </button>
    <div class="skin-meta">
      <div class="skin-title-wrap">
        <h3>${formatSkinName(skin)}</h3>
        <p>${skin.type === "Wild Rift" ? "Wild Rift" : "League of Legends PC"}</p>
      </div>
      <button class="favorite-button ${isFavorite ? "is-favorite" : ""}" type="button" aria-label="${isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}" aria-pressed="${isFavorite}">${isFavorite ? "♥" : "♡"}</button>
    </div>
  `;

  const image = article.querySelector("img");
  attachImageFallback(image);
  article.querySelector(".skin-preview").addEventListener("click", () => openLightbox(index));
  article.querySelector(".favorite-button").addEventListener("click", () => toggleFavorite(skin._id));
  return article;
}

function matchesCurrentFilters(skin) {
  const queryMatch = displaySkinName(skin).toLowerCase().includes(state.search);
  if (!queryMatch) return false;

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

  els.lightboxImage.src = skin.image;
  els.lightboxImage.alt = displaySkinName(skin);
  attachImageFallback(els.lightboxImage);
  els.lightboxTitle.textContent = displaySkinName(skin);
  els.lightboxPosition.textContent = `${state.lightboxIndex + 1} / ${state.visibleSkins.length}`;
  const isFavorite = state.favorites.has(skin._id);
  els.lightboxFavorite.textContent = isFavorite ? "♥" : "♡";
  els.lightboxFavorite.classList.toggle("is-favorite", isFavorite);
  els.lightboxFavorite.setAttribute("aria-label", isFavorite ? "Retirer des favoris" : "Ajouter aux favoris");
}

function toggleFavorite(id) {
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
  const params = new URLSearchParams();
  params.set("champion", champion);
  location.hash = params.toString();
}

function navigateHome() {
  if (location.hash) location.hash = "";
  else {
    state.currentChampion = null;
    renderCurrentView();
  }
}

function getChampionNames() {
  return [...new Set(state.skins.map((skin) => skin.champ))].sort((a, b) => a.localeCompare(b, "fr"));
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
  if (skin.type === "Wild Rift" && !/\(Wild Rift\)/i.test(skin.skin)) {
    return `${skin.skin} (Wild Rift)`;
  }
  return skin.skin;
}

function formatSkinName(skin) {
  return escapeHtml(displaySkinName(skin)).replace(/\(([^)]+)\)/g, (_, content) => {
    let className = "skin-tag";
    if (/wild rift/i.test(content)) className += " skin-tag-wr";
    else if (/prestige|special edition|mythic chroma|exquisite edition/i.test(content)) className += " skin-tag-prestige";
    else if (/chroma/i.test(content)) className += " skin-tag-chroma";
    return `<span class="${className}">(${escapeHtml(content)})</span>`;
  });
}

function attachImageFallback(image) {
  if (!image || image.dataset.fallbackBound) return;
  image.dataset.fallbackBound = "true";
  image.addEventListener("error", () => {
    if (image.src === IMAGE_FALLBACK) return;
    image.src = IMAGE_FALLBACK;
    image.classList.add("is-fallback");
  }, { once: true });
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
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
}

function pluralize(count, singular, plural) {
  return `${count} ${count > 1 ? plural : singular}`;
}

function cssUrl(value) {
  return String(value).replace(/["\\\n\r]/g, (char) => `\\${char}`);
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
