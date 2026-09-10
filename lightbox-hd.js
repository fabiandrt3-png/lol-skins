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
  const desktopViewer = setupDesktopNativeViewer(lightbox, lightboxImage, lightboxTitle);

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
  const loadedSources = new Set();
  const failedSources = new Set();
  let requestToken = 0;

  const setState = (state) => {
    image.dataset.hdState = state;
    lightbox.dataset.hdState = state;
  };

  const preloadSource = (source) => new Promise((resolve) => {
    if (loadedSources.has(source)) {
      resolve(true);
      return;
    }

    const preload = new Image();
    preload.decoding = "async";
    preload.loading = "eager";
    preload.fetchPriority = "high";

    preload.onload = async () => {
      try {
        await preload.decode();
      } catch {
        // onload already proves the image is usable; decode() is only an extra
        // attempt to have the full-resolution bitmap ready before the swap.
      }
      loadedSources.add(source);
      resolve(true);
    };

    preload.onerror = () => {
      failedSources.add(source);
      resolve(false);
    };

    preload.src = source;
  });

  const sync = async () => {
    const token = ++requestToken;
    if (lightbox.hidden) return;

    const displayName = title.textContent.trim();
    const candidates = unique(fullscreenSources.get(displayName) || []);

    if (!candidates.length) {
      setState("unavailable");
      return;
    }

    const currentSource = image.getAttribute("src") || "";
    if (candidates.includes(currentSource) && image.complete && image.naturalWidth > 0) {
      setState("ready");
      return;
    }

    setState("loading");

    for (const source of candidates) {
      if (failedSources.has(source)) continue;

      const loaded = await preloadSource(source);
      if (!loaded) continue;
      if (token !== requestToken || lightbox.hidden || title.textContent.trim() !== displayName) return;

      // Swap only after the HD file is loaded/decoded. This leaves app.js in
      // charge of the lightweight card fallback and avoids competing onerror
      // handlers or a race between the card URL and the HD URL.
      image.loading = "eager";
      image.fetchPriority = "high";
      image.dataset.hdSource = source;

      const onHdDisplayed = () => {
        if (image.getAttribute("src") !== source) return;
        image.removeEventListener("load", onHdDisplayed);
        setState("ready");
      };

      image.addEventListener("load", onHdDisplayed);
      image.src = source;

      if (image.complete && image.naturalWidth > 0) queueMicrotask(onHdDisplayed);
      return;
    }

    if (token === requestToken) setState("unavailable");
  };

  return { sync };
}

function setupDesktopNativeViewer(lightbox, image, title) {
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
  const hdIsLoading = () => image.dataset.hdState === "loading";
  const slide = () => image.parentElement;

  const clearImageLayout = () => {
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
    lightbox.dataset.desktopZoomed = "false";
  };

  const restoreFigureSize = () => {
    if (!figure) return;
    figure.style.width = "";
    figure.style.height = "";
    figure.style.maxWidth = "";
    figure.style.maxHeight = "";
  };

  const useFullDesktopViewport = () => {
    if (!figure) return;
    // The stylesheet intentionally keeps the mobile viewer compact. On a
    // desktop pointer, the splash art should instead use the actual viewport;
    // the old 1500x900 cap threw away a large part of the available display.
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
    const maxX = Math.max(0, (width - container.clientWidth) / 2);
    const maxY = Math.max(0, (height - container.clientHeight) / 2);
    state.panX = clamp(state.panX, -maxX, maxX);
    state.panY = clamp(state.panY, -maxY, maxY);
  };

  const render = () => {
    if (!isDesktopOpen() || !state.baseWidth || !state.baseHeight) return;

    clampPan();
    const { width, height } = currentSize();

    // Important: zoom by changing the image's real layout size, NOT with
    // transform: scale(). Chrome therefore resamples from the original image
    // pixels at the requested size instead of enlarging a smaller compositor
    // layer. left/top are used only for panning and never for scaling.
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

    if (hdIsLoading()) image.style.cursor = "progress";
    else if (state.level > 1.001) image.style.cursor = state.dragging ? "grabbing" : "grab";
    else image.style.cursor = state.maxLevel > 1.001 ? "zoom-in" : "default";

    image.title = hdIsLoading()
      ? "Chargement du splash art HD…"
      : state.level > 1.001
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
      clearImageLayout();
      restoreFigureSize();
      return;
    }

    useFullDesktopViewport();

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

      // Stop at the source's native CSS-pixel size. Past this point there is no
      // additional detail to reveal, only interpolation, so the viewer does not
      // manufacture blur by over-zooming a low-resolution splash art.
      state.maxLevel = Math.max(1, Math.min(8, 1 / fit));
      state.level = clamp(state.level, 1, state.maxLevel);
      clampPan();
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
    else {
      clearImageLayout();
      restoreFigureSize();
    }
  };

  const zoomAt = (nextLevel, clientX, clientY) => {
    if (!isDesktopOpen() || hdIsLoading() || !state.baseWidth || !state.baseHeight) return;

    const container = slide();
    if (!container) return;

    const targetLevel = clamp(nextLevel, 1, state.maxLevel);
    if (Math.abs(targetLevel - state.level) < 0.0001) return;

    if (targetLevel <= 1.001) {
      state.level = 1;
      state.panX = 0;
      state.panY = 0;
      render();
      return;
    }

    const imageRect = image.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (!imageRect.width || !imageRect.height) return;

    // Anchor the zoom to the artwork point currently below the cursor. If the
    // cursor is in the black letterbox area, use the nearest image edge.
    const anchorX = clamp(clientX, imageRect.left, imageRect.right);
    const anchorY = clamp(clientY, imageRect.top, imageRect.bottom);
    const localX = (anchorX - imageRect.left) / imageRect.width;
    const localY = (anchorY - imageRect.top) / imageRect.height;

    const newWidth = state.baseWidth * targetLevel;
    const newHeight = state.baseHeight * targetLevel;
    const centeredLeft = containerRect.left + (containerRect.width - newWidth) / 2;
    const centeredTop = containerRect.top + (containerRect.height - newHeight) / 2;

    state.level = targetLevel;
    state.panX = anchorX - centeredLeft - (localX * newWidth);
    state.panY = anchorY - centeredTop - (localY * newHeight);
    render();
  };

  figure?.addEventListener("wheel", (event) => {
    if (!isDesktopOpen()) return;
    event.preventDefault();
    if (hdIsLoading()) {
      image.style.cursor = "progress";
      return;
    }

    const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14;
    zoomAt(state.level * factor, event.clientX, event.clientY);
  }, { passive: false });

  image.addEventListener("dblclick", (event) => {
    if (!isDesktopOpen()) return;
    event.preventDefault();
    if (hdIsLoading()) return;

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
    // A newly displayed HD source has different intrinsic dimensions from the
    // card preview, so remeasure from naturalWidth/naturalHeight every time.
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
