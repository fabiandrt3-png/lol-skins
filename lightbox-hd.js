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
  const hdController = setupHdSourceController(lightbox, lightboxImage, lightboxTitle, fullscreenSources);
  const desktopViewer = setupDesktopMouseViewer(lightbox, lightboxImage, lightboxTitle);

  const syncCurrentSkin = () => {
    desktopViewer.reset();
    hdController.sync();
  };

  const observer = new MutationObserver(() => queueMicrotask(syncCurrentSkin));
  observer.observe(lightboxTitle, { childList: true, subtree: true, characterData: true });
  observer.observe(lightbox, { attributes: true, attributeFilter: ["hidden"] });

  syncCurrentSkin();
}

function setupHdSourceController(lightbox, image, title, fullscreenSources) {
  const failedSources = new Set();
  let requestToken = 0;

  const setState = (state) => {
    image.dataset.hdState = state;
    lightbox.dataset.hdState = state;
  };

  const sync = async () => {
    const token = ++requestToken;
    if (lightbox.hidden) return;

    const displayName = title.textContent.trim();
    const candidates = unique(fullscreenSources.get(displayName) || []);

    if (!candidates.length) {
      setState("unavailable");
      return;
    }

    for (const source of candidates) {
      if (failedSources.has(source)) continue;

      const currentSource = image.getAttribute("src") || "";
      if (currentSource === source && image.complete && image.naturalWidth > 0) {
        setState("ready");
        return;
      }

      setState("loading");
      const loaded = await preloadImage(source);

      if (token !== requestToken || lightbox.hidden || title.textContent.trim() !== displayName) return;
      if (!loaded) {
        failedSources.add(source);
        continue;
      }

      image.loading = "eager";
      image.fetchPriority = "high";
      image.dataset.hdSource = source;

      const markReady = () => {
        if (image.getAttribute("src") !== source) return;
        image.removeEventListener("load", markReady);
        setState("ready");
      };

      image.addEventListener("load", markReady);
      image.src = source;
      if (image.complete && image.naturalWidth > 0) queueMicrotask(markReady);
      return;
    }

    if (token === requestToken) setState("unavailable");
  };

  return { sync };
}

function preloadImage(source) {
  return new Promise((resolve) => {
    const preload = new Image();
    preload.decoding = "async";
    preload.loading = "eager";
    preload.fetchPriority = "high";
    preload.onload = () => resolve(preload.naturalWidth > 0 && preload.naturalHeight > 0);
    preload.onerror = () => resolve(false);
    preload.src = source;
  });
}

function setupDesktopMouseViewer(lightbox, image, title) {
  const desktopPointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const figure = image.closest(".lightbox-figure");
  const state = {
    level: 1,
    baseWidth: 0,
    baseHeight: 0,
    maxLevel: 1,
    panX: 0,
    panY: 0,
    dragging: false,
    pointerId: null,
    startPointerX: 0,
    startPointerY: 0,
    startPanX: 0,
    startPanY: 0,
    title: title.textContent.trim(),
    frame: 0,
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const isDesktopOpen = () => desktopPointer.matches && !lightbox.hidden;
  const slide = () => image.parentElement;

  const clearDesktopStyles = () => {
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
    image.style.cursor = "";
    image.style.imageRendering = "";
    image.title = "";

    if (figure) {
      figure.style.width = "";
      figure.style.height = "";
      figure.style.maxWidth = "";
      figure.style.maxHeight = "";
    }

    lightbox.dataset.desktopZoomed = "false";
  };

  const useDesktopViewport = () => {
    if (!figure) return;
    figure.style.width = "calc(100vw - 24px)";
    figure.style.height = "calc(100dvh - 24px)";
    figure.style.maxWidth = "none";
    figure.style.maxHeight = "none";
  };

  const currentSize = () => ({
    width: state.baseWidth * state.level,
    height: state.baseHeight * state.level,
  });

  const clampPan = () => {
    const container = slide();
    if (!container || !state.baseWidth || !state.baseHeight) {
      state.panX = 0;
      state.panY = 0;
      return;
    }

    const { width, height } = currentSize();

    // When the image is still smaller than the viewport, allow it to move only
    // until one of its edges reaches the viewport edge. Once it is larger, use
    // the same bounds to prevent dragging it completely out of view.
    const maxX = Math.abs(width - container.clientWidth) / 2;
    const maxY = Math.abs(height - container.clientHeight) / 2;
    state.panX = clamp(state.panX, -maxX, maxX);
    state.panY = clamp(state.panY, -maxY, maxY);
  };

  const render = () => {
    if (!isDesktopOpen() || !state.baseWidth || !state.baseHeight) return;

    clampPan();
    const { width, height } = currentSize();

    // Real layout resizing instead of transform: scale(). The browser keeps
    // sampling the original bitmap as the requested display size changes.
    image.style.maxWidth = "none";
    image.style.maxHeight = "none";
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    image.style.position = "relative";
    image.style.left = `${state.panX}px`;
    image.style.top = `${state.panY}px`;
    image.style.transform = "none";
    image.style.transformOrigin = "center center";
    image.style.transition = "none";
    image.style.willChange = "auto";
    image.style.imageRendering = "auto";
    image.style.cursor = state.level > 1.001
      ? (state.dragging ? "grabbing" : "grab")
      : (state.maxLevel > 1.001 ? "zoom-in" : "default");

    image.title = state.level > 1.001
      ? "Molette : zoom sous la souris · glisser : déplacer · double-clic : réinitialiser"
      : "Molette ou double-clic pour zoomer";

    lightbox.dataset.desktopZoomed = state.level > 1.001 ? "true" : "false";
  };

  const measureBase = () => {
    cancelAnimationFrame(state.frame);

    if (!isDesktopOpen()) {
      state.baseWidth = 0;
      state.baseHeight = 0;
      state.maxLevel = 1;
      clearDesktopStyles();
      return;
    }

    useDesktopViewport();

    state.frame = requestAnimationFrame(() => {
      const container = slide();
      if (!container || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;

      const availableWidth = container.clientWidth || figure?.clientWidth || window.innerWidth;
      const availableHeight = container.clientHeight || figure?.clientHeight || window.innerHeight;
      const fit = Math.min(
        1,
        availableWidth / image.naturalWidth,
        availableHeight / image.naturalHeight,
      );

      state.baseWidth = Math.max(1, image.naturalWidth * fit);
      state.baseHeight = Math.max(1, image.naturalHeight * fit);

      const nativeLevelX = image.naturalWidth / state.baseWidth;
      const nativeLevelY = image.naturalHeight / state.baseHeight;
      state.maxLevel = Math.max(1, Math.min(8, nativeLevelX, nativeLevelY));
      state.level = clamp(state.level, 1, state.maxLevel);
      render();
    });
  };

  const reset = () => {
    state.level = 1;
    state.panX = 0;
    state.panY = 0;
    state.dragging = false;
    state.pointerId = null;

    if (isDesktopOpen()) measureBase();
    else clearDesktopStyles();
  };

  const zoomAt = (nextLevel, clientX, clientY) => {
    if (!isDesktopOpen() || !state.baseWidth || !state.baseHeight) return;

    const targetLevel = clamp(nextLevel, 1, state.maxLevel);
    if (Math.abs(targetLevel - state.level) < 0.0001) return;

    if (targetLevel <= 1.001) {
      state.level = 1;
      state.panX = 0;
      state.panY = 0;
      render();
      return;
    }

    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const anchorX = clamp(clientX, rect.left, rect.right);
    const anchorY = clamp(clientY, rect.top, rect.bottom);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const ratio = targetLevel / state.level;

    // Use only the image's current on-screen geometry. This stays correct even
    // while the surrounding carousel is translated, and prevents the old jump
    // toward the left edge. The artwork point under the cursor remains fixed.
    state.panX += (1 - ratio) * (anchorX - centerX);
    state.panY += (1 - ratio) * (anchorY - centerY);
    state.level = targetLevel;
    render();
  };

  figure?.addEventListener("wheel", (event) => {
    if (!isDesktopOpen()) return;
    event.preventDefault();

    // If the full-resolution source is still loading, zooming the current image
    // remains possible. When HD arrives, the load handler remeasures from its
    // natural dimensions and resets cleanly to level 1.
    const factor = event.deltaY < 0 ? 1.16 : 1 / 1.16;
    zoomAt(state.level * factor, event.clientX, event.clientY);
  }, { passive: false });

  image.addEventListener("dblclick", (event) => {
    if (!isDesktopOpen()) return;
    event.preventDefault();

    if (state.level > 1.001) {
      state.level = 1;
      state.panX = 0;
      state.panY = 0;
      render();
      return;
    }

    zoomAt(Math.min(2, state.maxLevel), event.clientX, event.clientY);
  });

  image.addEventListener("pointerdown", (event) => {
    if (!isDesktopOpen() || event.pointerType !== "mouse" || state.level <= 1.001) return;
    event.preventDefault();
    state.dragging = true;
    state.pointerId = event.pointerId;
    state.startPointerX = event.clientX;
    state.startPointerY = event.clientY;
    state.startPanX = state.panX;
    state.startPanY = state.panY;
    image.setPointerCapture?.(event.pointerId);
    render();
  });

  image.addEventListener("pointermove", (event) => {
    if (!state.dragging || event.pointerId !== state.pointerId) return;
    state.panX = state.startPanX + (event.clientX - state.startPointerX);
    state.panY = state.startPanY + (event.clientY - state.startPointerY);
    render();
  });

  const stopDragging = (event) => {
    if (!state.dragging || (event?.pointerId != null && event.pointerId !== state.pointerId)) return;
    const pointerId = state.pointerId;
    state.dragging = false;
    state.pointerId = null;

    if (event?.type !== "lostpointercapture" && pointerId != null && image.hasPointerCapture?.(pointerId)) {
      image.releasePointerCapture(pointerId);
    }
    render();
  };

  image.addEventListener("pointerup", stopDragging);
  image.addEventListener("pointercancel", stopDragging);
  image.addEventListener("lostpointercapture", stopDragging);

  document.addEventListener("keydown", (event) => {
    if (!isDesktopOpen() || state.level <= 1.001) return;

    const step = event.shiftKey ? 160 : 72;
    if (event.key === "ArrowLeft") state.panX += step;
    else if (event.key === "ArrowRight") state.panX -= step;
    else if (event.key === "ArrowUp") state.panY += step;
    else if (event.key === "ArrowDown") state.panY -= step;
    else return;

    event.preventDefault();
    event.stopImmediatePropagation();
    render();
  }, { capture: true });

  image.addEventListener("load", () => {
    state.level = 1;
    state.panX = 0;
    state.panY = 0;
    measureBase();
  });

  const stateObserver = new MutationObserver(() => {
    const currentTitle = title.textContent.trim();
    if (lightbox.hidden || currentTitle !== state.title) {
      state.title = currentTitle;
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
