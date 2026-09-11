const APP_ASSET_VERSION = new URL(import.meta.url).searchParams.get("v");
const dataLoaderUrl = APP_ASSET_VERSION
  ? `./data-loader.js?v=${encodeURIComponent(APP_ASSET_VERSION)}`
  : "./data-loader.js";
const { loadSkinData } = await import(dataLoaderUrl);

const lightbox = document.querySelector("#lightbox");
const image = document.querySelector("#lightboxImage");
const title = document.querySelector("#lightboxTitle");
const DESKTOP_MAX_ZOOM_SCALE = 4;

if (lightbox && image && title) {
  const fullscreenSources = await loadFullscreenSources();
  const desktopViewer = setupDesktopViewer(lightbox, image, title);
  const hdController = setupHdSourceController(lightbox, image, title, fullscreenSources, {
    beforeSwap: desktopViewer.reset,
    afterSwap: desktopViewer.reset,
  });

  const syncSkin = () => {
    desktopViewer.reset();
    hdController.sync();
  };

  const observer = new MutationObserver(() => queueMicrotask(syncSkin));
  observer.observe(lightbox, { attributes: true, attributeFilter: ["hidden", "data-skin-id"] });

  syncSkin();
}

function setupHdSourceController(lightbox, image, title, fullscreenSources, hooks = {}) {
  const failedSources = new Set();
  const preloadCache = new Map();
  let requestToken = 0;

  const preload = (source) => {
    if (preloadCache.has(source)) return preloadCache.get(source);

    const promise = new Promise((resolve) => {
      const candidate = new Image();
      candidate.decoding = "async";
      candidate.loading = "eager";
      candidate.fetchPriority = "high";

      candidate.onload = async () => {
        try {
          await candidate.decode();
        } catch {
          // onload already confirms the source is usable.
        }

        resolve({
          ok: candidate.naturalWidth > 0 && candidate.naturalHeight > 0,
          width: candidate.naturalWidth,
          height: candidate.naturalHeight,
        });
      };

      candidate.onerror = () => resolve({ ok: false, width: 0, height: 0 });
      candidate.src = source;
    });

    preloadCache.set(source, promise);
    return promise;
  };

  const sync = async () => {
    const token = ++requestToken;
    if (lightbox.hidden) return;

    const key = lightbox.dataset.skinId;
    const candidates = unique(fullscreenSources.get(key) || []);

    if (!key || !candidates.length) {
      lightbox.dataset.hdState = "unavailable";
      image.removeAttribute("data-hd-source");
      return;
    }

    const currentSource = image.currentSrc || image.getAttribute("src") || "";
    if (
      image.complete
      && image.naturalWidth > 0
      && candidates.some((candidate) => sameImageSource(candidate, currentSource))
    ) {
      lightbox.dataset.hdState = "ready";
      return;
    }

    lightbox.dataset.hdState = "loading";

    for (const source of candidates) {
      if (failedSources.has(source)) continue;

      const loaded = await preload(source);
      if (token !== requestToken || lightbox.hidden) return;
      if (lightbox.dataset.skinId !== key) return;

      if (!loaded.ok) {
        failedSources.add(source);
        continue;
      }

      const liveSource = image.currentSrc || image.getAttribute("src") || "";
      if (sameImageSource(source, liveSource) && image.complete && image.naturalWidth > 0) {
        lightbox.dataset.hdState = "ready";
        return;
      }

      // Reset before changing the bitmap. Default presentation is always CSS
      // contain; HD loading must never inherit stale zoom geometry.
      hooks.beforeSwap?.();

      image.loading = "eager";
      image.fetchPriority = "high";
      image.dataset.hdSource = source;

      const markReady = () => {
        image.removeEventListener("load", markReady);
        if (token !== requestToken || lightbox.hidden) return;
        if (lightbox.dataset.skinId !== key) return;
        if (!sameImageSource(image.currentSrc || image.getAttribute("src") || "", source)) return;
        hooks.afterSwap?.();
        lightbox.dataset.hdState = "ready";
      };

      image.addEventListener("load", markReady);
      image.src = source;

      if (image.complete && image.naturalWidth > 0) queueMicrotask(markReady);
      return;
    }

    if (token === requestToken) lightbox.dataset.hdState = "unavailable";
  };

  return { sync };
}

function setupDesktopViewer(lightbox, image, title) {
  const desktopPointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const figure = image.closest(".lightbox-figure");
  const slide = () => image.parentElement;

  const state = {
    scale: 1,
    maxScale: DESKTOP_MAX_ZOOM_SCALE,
    baseWidth: 0,
    baseHeight: 0,
    width: 0,
    height: 0,
    left: 0,
    top: 0,
    dragging: false,
    pointerId: null,
    dragStartX: 0,
    dragStartY: 0,
    dragStartLeft: 0,
    dragStartTop: 0,
    skinName: title.textContent.trim(),
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const isOpen = () => desktopPointer.matches && !lightbox.hidden;

  const clearImageGeometry = () => {
    image.style.width = "";
    image.style.height = "";
    image.style.maxWidth = "";
    image.style.maxHeight = "";
    image.style.position = "";
    image.style.left = "";
    image.style.top = "";
    image.style.transform = "";
    image.style.transformOrigin = "";
    image.style.transition = "";
    image.style.willChange = "";
    image.style.imageRendering = "";
    image.style.cursor = "";
  };

  const reset = () => {
    state.scale = 1;
    state.maxScale = DESKTOP_MAX_ZOOM_SCALE;
    state.baseWidth = 0;
    state.baseHeight = 0;
    state.width = 0;
    state.height = 0;
    state.left = 0;
    state.top = 0;
    state.dragging = false;
    state.pointerId = null;

    // Set the flag before clearing geometry so CSS contain wins immediately,
    // even during an asynchronous HD source replacement.
    lightbox.dataset.desktopZoomed = "false";
    clearImageGeometry();

    const container = slide();
    if (container) {
      container.style.position = "relative";
      container.style.overflow = "hidden";
    }

    image.title = isOpen() ? "Wheel or double-click to zoom" : "";
  };

  const captureContainedGeometry = () => {
    const container = slide();
    if (!isOpen() || !container || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      return false;
    }

    const containerRect = container.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    if (imageRect.width <= 0 || imageRect.height <= 0 || containerRect.width <= 0 || containerRect.height <= 0) {
      return false;
    }

    // Use the browser's actual CSS-contained rectangle as the 1x zoom basis.
    // This guarantees that zoom starts from the exact fully-visible splash.
    state.baseWidth = imageRect.width;
    state.baseHeight = imageRect.height;
    state.width = imageRect.width;
    state.height = imageRect.height;
    state.left = imageRect.left - containerRect.left;
    state.top = imageRect.top - containerRect.top;
    state.scale = 1;
    state.maxScale = DESKTOP_MAX_ZOOM_SCALE;
    return true;
  };

  const clampPlacement = () => {
    const container = slide();
    if (!container || !state.width || !state.height) return;

    const viewportWidth = container.clientWidth;
    const viewportHeight = container.clientHeight;

    if (state.width <= viewportWidth) {
      state.left = (viewportWidth - state.width) / 2;
    } else {
      state.left = clamp(state.left, viewportWidth - state.width, 0);
    }

    if (state.height <= viewportHeight) {
      state.top = (viewportHeight - state.height) / 2;
    } else {
      state.top = clamp(state.top, viewportHeight - state.height, 0);
    }
  };

  const renderZoomed = () => {
    if (!isOpen() || state.scale <= 1.001 || !state.width || !state.height) return;

    clampPlacement();
    lightbox.dataset.desktopZoomed = "true";

    image.style.position = "absolute";
    image.style.maxWidth = "none";
    image.style.maxHeight = "none";
    image.style.width = `${state.width}px`;
    image.style.height = `${state.height}px`;
    image.style.left = `${state.left}px`;
    image.style.top = `${state.top}px`;
    image.style.transform = "none";
    image.style.transformOrigin = "0 0";
    image.style.transition = "none";
    image.style.willChange = state.dragging ? "left, top" : "auto";
    image.style.imageRendering = "auto";
    image.style.cursor = state.dragging ? "grabbing" : "grab";
    image.title = "Wheel: zoom under cursor · drag: pan · double-click: reset";
  };

  const zoomAt = (nextScale, clientX, clientY) => {
    if (!isOpen()) return;

    const targetScale = clamp(nextScale, 1, state.maxScale);
    if (targetScale <= 1.001) {
      reset();
      return;
    }

    if (state.scale <= 1.001 || !state.baseWidth || !state.baseHeight) {
      if (!captureContainedGeometry()) return;
    }

    const container = slide();
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const pointerX = clientX - containerRect.left;
    const pointerY = clientY - containerRect.top;

    const currentWidth = state.width || state.baseWidth;
    const currentHeight = state.height || state.baseHeight;
    const currentLeft = state.left;
    const currentTop = state.top;

    const anchorX = clamp(pointerX, currentLeft, currentLeft + currentWidth);
    const anchorY = clamp(pointerY, currentTop, currentTop + currentHeight);
    const localX = currentWidth ? (anchorX - currentLeft) / currentWidth : 0.5;
    const localY = currentHeight ? (anchorY - currentTop) / currentHeight : 0.5;

    state.scale = targetScale;
    state.width = state.baseWidth * state.scale;
    state.height = state.baseHeight * state.scale;
    state.left = anchorX - localX * state.width;
    state.top = anchorY - localY * state.height;
    renderZoomed();
  };

  figure?.addEventListener("wheel", (event) => {
    if (!isOpen()) return;
    event.preventDefault();

    if (state.scale <= 1.001 && !captureContainedGeometry()) return;
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAt(state.scale * factor, event.clientX, event.clientY);
  }, { passive: false });

  image.addEventListener("dblclick", (event) => {
    if (!isOpen()) return;
    event.preventDefault();

    if (state.scale > 1.001) {
      reset();
      return;
    }

    if (!captureContainedGeometry()) return;
    zoomAt(Math.min(2, state.maxScale), event.clientX, event.clientY);
  });

  image.addEventListener("pointerdown", (event) => {
    if (!isOpen() || event.pointerType !== "mouse" || state.scale <= 1.001) return;
    event.preventDefault();

    state.dragging = true;
    state.pointerId = event.pointerId;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    state.dragStartLeft = state.left;
    state.dragStartTop = state.top;
    image.setPointerCapture?.(event.pointerId);
    renderZoomed();
  });

  image.addEventListener("pointermove", (event) => {
    if (!state.dragging || event.pointerId !== state.pointerId) return;

    state.left = state.dragStartLeft + event.clientX - state.dragStartX;
    state.top = state.dragStartTop + event.clientY - state.dragStartY;
    renderZoomed();
  });

  const stopDragging = (event) => {
    if (!state.dragging || (event?.pointerId != null && event.pointerId !== state.pointerId)) return;

    const pointerId = state.pointerId;
    state.dragging = false;
    state.pointerId = null;

    if (event?.type !== "lostpointercapture" && pointerId != null && image.hasPointerCapture?.(pointerId)) {
      image.releasePointerCapture(pointerId);
    }
    renderZoomed();
  };

  image.addEventListener("pointerup", stopDragging);
  image.addEventListener("pointercancel", stopDragging);
  image.addEventListener("lostpointercapture", stopDragging);

  // Any bitmap replacement (standard -> HD, fallback, skin change) returns to
  // the canonical fully-visible state. No image load is allowed to preserve or
  // recalculate a zoom automatically.
  image.addEventListener("load", reset);

  lightbox.addEventListener("click", (event) => {
    if (event.target.closest(".lightbox-nav")) reset();
  }, { capture: true });

  document.addEventListener("keydown", (event) => {
    if (!lightbox.hidden && (event.key === "ArrowLeft" || event.key === "ArrowRight")) reset();
  }, { capture: true });

  const stateObserver = new MutationObserver(() => {
    const skinName = title.textContent.trim();
    if (lightbox.hidden || skinName !== state.skinName) {
      state.skinName = skinName;
      reset();
    }
  });
  stateObserver.observe(lightbox, { attributes: true, attributeFilter: ["hidden"] });
  stateObserver.observe(title, { childList: true, subtree: true, characterData: true });

  window.addEventListener("resize", reset, { passive: true });
  desktopPointer.addEventListener?.("change", reset);

  reset();
  return { reset };
}

async function loadFullscreenSources() {
  try {
    const skins = await loadSkinData();
    const sources = new Map();

    for (const skin of skins) {
      const candidates = unique(skin?.highResImageCandidates || []);
      if (!candidates.length) continue;
      sources.set(skin._id, candidates);
    }

    return sources;
  } catch (error) {
    console.warn("Fullscreen HD sources unavailable; using standard splash arts.", error);
    return new Map();
  }
}

function sameImageSource(left, right) {
  if (!left || !right) return false;

  try {
    const normalize = (value) => {
      const url = new URL(value, location.href);
      url.hash = "";
      return url.href;
    };
    return normalize(left) === normalize(right);
  } catch {
    return String(left) === String(right);
  }
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}
