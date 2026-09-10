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
  const desktopCarousel = setupDesktopCrispCarousel(lightbox, lightboxImage);
  const hdController = setupHdSourceController(lightbox, lightboxImage, lightboxTitle, fullscreenSources);
  const desktopViewer = setupDesktopNativeViewer(
    lightbox,
    lightboxImage,
    lightboxTitle,
    desktopCarousel.sync,
  );

  const syncCurrentSkin = () => {
    desktopViewer.reset();
    desktopCarousel.sync();
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
        // onload already proves the source is usable. decode() only asks the
        // browser to finish preparing the full bitmap before it becomes visible.
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

      // app.js remains responsible for the card-sized fallback. The HD source
      // is swapped in only after it has loaded successfully, so the two source
      // systems never race against each other's error handlers.
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

function setupDesktopCrispCarousel(lightbox, image) {
  const desktopPointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const figure = image.closest(".lightbox-figure");
  const track = figure?.firstElementChild;
  const slides = track ? [...track.children] : [];
  let currentOffset = 0;

  if (!figure || !track || slides.length !== 3) return { sync() {} };

  const parseAppOffset = (transform) => {
    if (!transform) return null;
    const calcMatch = transform.match(/calc\(\s*-33\.333333%\s*\+\s*(-?\d+(?:\.\d+)?)px\s*\)/i);
    if (calcMatch) return Number(calcMatch[1]);
    if (/-33\.333333%/i.test(transform)) return 0;
    return null;
  };

  const applyOffset = (offset) => {
    currentOffset = Number.isFinite(offset) ? offset : 0;
    const atRest = Math.abs(currentOffset) < 0.01;
    track.style.transform = atRest ? "none" : `translate3d(${currentOffset}px, 0, 0)`;
    track.style.willChange = atRest ? "auto" : "transform";
  };

  const restoreAppGeometry = () => {
    currentOffset = 0;
    track.style.position = "";
    track.style.left = "";
    track.style.width = "300%";
    track.style.transform = "translate3d(-33.333333%, 0, 0)";
    track.style.willChange = "transform";
    slides.forEach((slide) => {
      slide.style.width = "";
      slide.style.flex = "0 0 33.333333%";
    });
  };

  const sync = () => {
    if (!desktopPointer.matches) {
      restoreAppGeometry();
      return;
    }

    const width = figure.clientWidth || window.innerWidth;
    if (!width) return;

    // The base app uses a 300%-wide track translated by -33.333333%. On a
    // desktop this can leave the displayed slide on a fractional/composited
    // position. Give every slide an exact pixel width and place the middle
    // slide with layout (left) instead. At rest there is no transform at all.
    track.style.position = "relative";
    track.style.left = `${-width}px`;
    track.style.width = `${width * 3}px`;
    slides.forEach((slide) => {
      slide.style.width = `${width}px`;
      slide.style.flex = `0 0 ${width}px`;
    });
    applyOffset(currentOffset);
  };

  const styleObserver = new MutationObserver(() => {
    if (!desktopPointer.matches) return;
    const appOffset = parseAppOffset(track.style.transform);
    if (appOffset === null) return;
    applyOffset(appOffset);
  });
  styleObserver.observe(track, { attributes: true, attributeFilter: ["style"] });

  window.addEventListener("resize", () => requestAnimationFrame(sync), { passive: true });
  desktopPointer.addEventListener?.("change", () => requestAnimationFrame(sync));

  // Closing or changing a skin always returns app.js to offset 0. Reassert the
  // exact desktop geometry after that synchronous render.
  const stateObserver = new MutationObserver(() => requestAnimationFrame(sync));
  stateObserver.observe(lightbox, { attributes: true, attributeFilter: ["hidden"] });

  requestAnimationFrame(sync);
  return { sync: () => requestAnimationFrame(sync) };
}

function setupDesktopNativeViewer(lightbox, image, title, syncCarousel) {
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
    // The stylesheet caps desktop at 1500x900. Fullscreen artwork should use
    // the real desktop viewport; the mobile dimensions remain untouched.
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

    // Zoom by changing the image's real layout dimensions. No scale() is used,
    // so the browser can sample the original source for every requested size.
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
      syncCarousel?.();
      return;
    }

    useFullDesktopViewport();
    syncCarousel?.();

    state.frame = requestAnimationFrame(() => {
      syncCarousel?.();
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

      // Native-size ceiling: beyond 1 source pixel per CSS pixel there is no
      // new image detail, only interpolation. Very large sources can still go
      // up to 8x if their native dimensions genuinely allow it.
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
      syncCarousel?.();
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

    // Preserve the exact artwork point under the cursor. In a letterbox area,
    // the nearest edge becomes the anchor instead of snapping to the center.
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
    // Card preview and HD source have different intrinsic sizes. Every source
    // change is remeasured from naturalWidth/naturalHeight before zoom resumes.
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
