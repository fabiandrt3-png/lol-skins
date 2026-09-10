const APP_ASSET_VERSION = new URL(import.meta.url).searchParams.get("v");
const NEW_SKINS_SOURCE = versionedAsset("data/new-skins.json");

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
    const source = fullscreenSources.get(displayName);
    if (!source || failedSources.has(source) || lightboxImage.getAttribute("src") === source) return;

    if (loadedSources.has(source)) {
      lightboxImage.src = source;
      return;
    }

    if (pendingSources.has(source)) return;

    // Keep the normal splash visible while the large file downloads. This avoids
    // blank frames and prevents the gallery's own fallback handler from treating
    // a temporarily unavailable HD source as a failed normal splash.
    const preload = new Image();
    preload.decoding = "async";
    pendingSources.set(source, preload);

    preload.onload = () => {
      pendingSources.delete(source);
      loadedSources.add(source);
      if (!lightbox.hidden && fullscreenSources.get(lightboxTitle.textContent.trim()) === source) {
        lightboxImage.src = source;
      }
    };

    preload.onerror = () => {
      pendingSources.delete(source);
      failedSources.add(source);
    };

    preload.src = source;
  };

  const observer = new MutationObserver(() => queueMicrotask(syncFullscreenSource));
  observer.observe(lightboxTitle, { childList: true, subtree: true, characterData: true });
  observer.observe(lightboxImage, { attributes: true, attributeFilter: ["src"] });
  syncFullscreenSource();
}

async function loadFullscreenSources() {
  try {
    const response = await fetch(NEW_SKINS_SOURCE, { cache: "default" });
    if (!response.ok) return new Map();

    const payload = await response.json();
    const entries = Array.isArray(payload) ? payload : payload?.entries;
    if (!Array.isArray(entries)) return new Map();

    const sources = new Map();
    for (const item of entries) {
      if (!item?.skin || !item?.fullImage) continue;
      sources.set(displaySkinName(item), item.fullImage);
    }
    return sources;
  } catch {
    return new Map();
  }
}

function displaySkinName(item) {
  return item.type === "Wild Rift" && !/\(Wild Rift\)/i.test(item.skin)
    ? `${item.skin} (Wild Rift)`
    : item.skin;
}

function versionedAsset(url) {
  if (!APP_ASSET_VERSION) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(APP_ASSET_VERSION)}`;
}
