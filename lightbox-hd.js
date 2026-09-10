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
  const hdController = setupHdSourceController(lightbox, image, title, fullscreenSources);
  const desktopViewer = setupDesktopViewer(lightbox, image, title);

  const syncSkin = () => {
    desktopViewer.reset();
    hdController.sync();
  };

  const observer = new MutationObserver(() => queueMicrotask(syncSkin));
  observer.observe(title, { childList: true, subtree: true, characterData: true });
  observer.observe(lightbox, { attributes: true, attributeFilter: ["hidden"] });

  syncSkin();
}

function setupHdSourceController(lightbox, image, title, fullscreenSources) {
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
          // onload is sufficient; decode() only prepares the bitmap earlier.
        }
        resolve(candidate.naturalWidth > 0 && candidate.naturalHeight > 0);
      };
      candidate.onerror = () => resolve(false);
      candidate.src = source;
    });

    preloadCache.set(source, promise);
    return promise;
  };

  const sync = async () => {
    const token = ++requestToken;
    if (lightbox.hidden) return;

    const champion = currentChampion();
    const skinName = title.textContent.trim();
    const key = skinKey(champion, skinName);
    const candidates = unique(fullscreenSources.get(key) || []);

    if (!champion || !skinName || !candidates.length) {
      lightbox.dataset.hdState = "unavailable";
      return;
    }

    const currentSource = image.getAttribute("src") || "";
    if (candidates.includes(currentSource) && image.complete && image.naturalWidth > 0) {
      lightbox.dataset.hdState = "ready";
      return;
    }

    lightbox.dataset.hdState = "loading";

    for (const source of candidates) {
      if (failedSources.has(source)) continue;

      const loaded = await preload(source);
      if (token !== requestToken || lightbox.hidden) return;
      if (skinKey(currentChampion(), title.textContent.trim()) !== key) return;

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
    maxScale: 1,
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
    frame: 0,
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const isOpen = () => desktopPointer.matches && !lightbox.hidden;

  const applyDesktopFrame = () => {
    const container = slide();
    if (!figure || !container) return;

    figure.style.width = "calc(100vw - 24px)";
    figure.style.height = "calc(100dvh - 24px)";
    figure.style.maxWidth = "none";
    figure.style.maxHeight = "none";

    container.style.position = "relative";
    container.style.overflow = "hidden";
  };

  const clearDesktopFrame = () => {
    const container = slide();

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

    if (container) {
      container.style.position = "";
      container.style.overflow = "";
    }

    if (figure) {
      figure.style.width = "";
      figure.style.height = "";
      figure.style.maxWidth = "";
      figure.style.maxHeight = "";
    }

    lightbox.dataset.desktopZoomed = "false";
  };

  const clampPlacement = () => {
    const container = slide();
    if (!container || !state.width || !state.height) return;

    const viewportWidth = container.clientWidth;
    const viewportHeight = container.clientHeight;

    const minLeft = Math.min(0, viewportWidth - state.width);
    const maxLeft = Math.max(0, viewportWidth - state.width);
    const minTop = Math.min(0, viewportHeight - state.height);
    const maxTop = Math.max(0, viewportHeight - state.height);

    state.left = clamp(state.left, minLeft, maxLeft);
    state.top = clamp(state.top, minTop, maxTop);
  };

  const render = () => {
    if (!isOpen() || !state.width || !state.height) return;

    clampPlacement();

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
    image.style.willChange = "auto";
    image.style.imageRendering = "auto";
    image.style.cursor = state.scale > 1.001
      ? (state.dragging ? "grabbing" : "grab")
      : (state.maxScale > 1.001 ? "zoom-in" : "default");

    image.title = state.scale > 1.001
      ? "Molette : zoom sous la souris · glisser : déplacer · double-clic : réinitialiser"
      : "Molette ou double-clic pour zoomer";

    lightbox.dataset.desktopZoomed = state.scale > 1.001 ? "true" : "false";
  };

  const centerImage = () => {
    const container = slide();
    if (!container) return;
    state.left = (container.clientWidth - state.width) / 2;
    state.top = (container.clientHeight - state.height) / 2;
  };

  const measure = ({ preserveView = true } = {}) => {
    cancelAnimationFrame(state.frame);

    if (!isOpen()) {
      state.baseWidth = 0;
      state.baseHeight = 0;
      state.width = 0;
      state.height = 0;
      state.maxScale = 1;
      clearDesktopFrame();
      return;
    }

    applyDesktopFrame();

    state.frame = requestAnimationFrame(() => {
      const container = slide();
      if (!container || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;

      const oldWidth = state.width;
      const oldHeight = state.height;
      const oldLeft = state.left;
      const oldTop = state.top;
      const viewportWidth = container.clientWidth;
      const viewportHeight = container.clientHeight;

      let focusX = 0.5;
      let focusY = 0.5;
      if (preserveView && oldWidth > 0 && oldHeight > 0) {
        focusX = clamp((viewportWidth / 2 - oldLeft) / oldWidth, 0, 1);
        focusY = clamp((viewportHeight / 2 - oldTop) / oldHeight, 0, 1);
      }

      const fit = Math.min(
        1,
        viewportWidth / image.naturalWidth,
        viewportHeight / image.naturalHeight,
      );

      state.baseWidth = Math.max(1, image.naturalWidth * fit);
      state.baseHeight = Math.max(1, image.naturalHeight * fit);
      state.maxScale = Math.max(
        1,
        Math.min(
          DESKTOP_MAX_ZOOM_SCALE,
          image.naturalWidth / state.baseWidth,
          image.naturalHeight / state.baseHeight,
        ),
      );
      state.scale = preserveView ? clamp(state.scale, 1, state.maxScale) : 1;
      state.width = state.baseWidth * state.scale;
      state.height = state.baseHeight * state.scale;

      if (preserveView && oldWidth > 0 && oldHeight > 0) {
        state.left = viewportWidth / 2 - focusX * state.width;
        state.top = viewportHeight / 2 - focusY * state.height;
      } else {
        centerImage();
      }

      render();
    });
  };

  const reset = () => {
    state.scale = 1;
    state.maxScale = 1;
    state.baseWidth = 0;
    state.baseHeight = 0;
    state.width = 0;
    state.height = 0;
    state.left = 0;
    state.top = 0;
    state.dragging = false;
    state.pointerId = null;

    if (isOpen()) measure({ preserveView: false });
    else clearDesktopFrame();
  };

  const zoomAt = (nextScale, clientX, clientY) => {
    const container = slide();
    if (!isOpen() || !container || !state.width || !state.height) return;

    const targetScale = clamp(nextScale, 1, state.maxScale);
    if (Math.abs(targetScale - state.scale) < 0.0001) return;

    if (targetScale <= 1.001) {
      state.scale = 1;
      state.width = state.baseWidth;
      state.height = state.baseHeight;
      centerImage();
      render();
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const pointerX = clientX - containerRect.left;
    const pointerY = clientY - containerRect.top;

    const anchorX = clamp(pointerX, state.left, state.left + state.width);
    const anchorY = clamp(pointerY, state.top, state.top + state.height);
    const localX = (anchorX - state.left) / state.width;
    const localY = (anchorY - state.top) / state.height;

    state.scale = targetScale;
    state.width = state.baseWidth * state.scale;
    state.height = state.baseHeight * state.scale;
    state.left = anchorX - localX * state.width;
    state.top = anchorY - localY * state.height;
    render();
  };

  figure?.addEventListener("wheel", (event) => {
    if (!isOpen()) return;
    event.preventDefault();

    if (!state.width || !state.height) measure({ preserveView: false });
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAt(state.scale * factor, event.clientX, event.clientY);
  }, { passive: false });

  image.addEventListener("dblclick", (event) => {
    if (!isOpen()) return;
    event.preventDefault();

    if (state.scale > 1.001) {
      zoomAt(1, event.clientX, event.clientY);
    } else {
      zoomAt(Math.min(2, state.maxScale), event.clientX, event.clientY);
    }
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
    render();
  });

  image.addEventListener("pointermove", (event) => {
    if (!state.dragging || event.pointerId !== state.pointerId) return;

    state.left = state.dragStartLeft + event.clientX - state.dragStartX;
    state.top = state.dragStartTop + event.clientY - state.dragStartY;
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

  image.addEventListener("load", () => measure({ preserveView: true }));

  // Navigation always wins over panning: reset the current zoom before app.js
  // starts its existing carousel transition, without stopping the event.
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

  window.addEventListener("resize", () => measure({ preserveView: true }), { passive: true });
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
      sources.set(skinKey(skin.champ, displaySkinName(skin)), candidates);
    }

    return sources;
  } catch (error) {
    console.warn("Sources HD plein écran indisponibles, utilisation des splash arts standards.", error);
    return new Map();
  }
}

function currentChampion() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  return params.get("champion") || "";
}

function skinKey(champion, skinName) {
  return `${champion}\u0000${skinName}`;
}

function displaySkinName(skin) {
  return skin.type === "Wild Rift" && !/\(Wild Rift\)/i.test(skin.skin)
    ? `${skin.skin} (Wild Rift)`
    : skin.skin;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}
