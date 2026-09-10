const APP_ASSET_VERSION = new URL(import.meta.url).searchParams.get("v");
const dataLoaderUrl = APP_ASSET_VERSION
  ? `./data-loader.js?v=${encodeURIComponent(APP_ASSET_VERSION)}`
  : "./data-loader.js";
const { loadSkinData } = await import(dataLoaderUrl);

const lightbox = document.querySelector("#lightbox");
const lightboxImage = document.querySelector("#lightboxImage");
const lightboxTitle = document.querySelector("#lightboxTitle");

if (lightbox && lightboxImage && lightboxTitle) {
  const fullscreenSources = await loadFullscreenSources();
  const loadedSources = new Set();
  const failedSources = new Set();
  const pendingSources = new Map();

  const syncFullscreenSource = () => {
    if (lightbox.hidden) return;

    const displayName = lightboxTitle.textContent.trim();
    const candidates = fullscreenSources.get(displayName) || [];
    const currentSource = lightboxImage.getAttribute("src") || "";
    if (!candidates.length || candidates.includes(currentSource)) return;

    const source = candidates.find((candidate) => !failedSources.has(candidate));
    if (!source) return;

    if (loadedSources.has(source)) {
      lightboxImage.src = source;
      return;
    }

    if (pendingSources.has(source)) return;

    // Keep the normal-size card splash visible until the HD file is ready.
    // Only the currently opened image is upgraded, so adjacent carousel slides
    // stay lightweight on mobile and desktop.
    const preload = new Image();
    preload.decoding = "async";
    pendingSources.set(source, preload);

    preload.onload = () => {
      pendingSources.delete(source);
      loadedSources.add(source);
      if (
        !lightbox.hidden &&
        lightboxTitle.textContent.trim() === displayName &&
        (fullscreenSources.get(displayName) || []).includes(source)
      ) {
        lightboxImage.src = source;
      }
    };

    preload.onerror = () => {
      pendingSources.delete(source);
      failedSources.add(source);
      queueMicrotask(syncFullscreenSource);
    };

    preload.src = source;
  };

  // app.js updates the image and title synchronously. Deferring one microtask
  // lets us always read the final skin title before choosing its HD source.
  const observer = new MutationObserver(() => queueMicrotask(syncFullscreenSource));
  observer.observe(lightboxTitle, { childList: true, subtree: true, characterData: true });
  observer.observe(lightboxImage, { attributes: true, attributeFilter: ["src"] });
  syncFullscreenSource();
}

async function loadFullscreenSources() {
  try {
    const skins = await loadSkinData();
    const sources = new Map();

    for (const skin of skins) {
      const candidates = unique(skin?.highResImageCandidates || []);
      if (candidates.length) sources.set(displaySkinName(skin), candidates);
    }

    return sources;
  } catch (error) {
    console.warn("Sources HD plein écran indisponibles, utilisation des splash arts standards.", error);
    return new Map();
  }
}

function displaySkinName(skin) {
  return skin.type === "Wild Rift" && !/\(Wild Rift\)/i.test(skin.skin)
    ? `${skin.skin} (Wild Rift)`
    : skin.skin;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}
