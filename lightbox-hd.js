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

  const setHdState = (state) => {
    lightboxImage.dataset.hdState = state;
    lightbox.dataset.hdState = state;
  };

  const syncFullscreenSource = () => {
    if (lightbox.hidden) return;

    const displayName = lightboxTitle.textContent.trim();
    const candidates = fullscreenSources.get(displayName) || [];
    const currentSource = lightboxImage.getAttribute("src") || "";

    if (!candidates.length) {
      setHdState("unavailable");
      return;
    }

    if (candidates.includes(currentSource)) {
      setHdState("ready");
      return;
    }

    const source = candidates.find((candidate) => !failedSources.has(candidate));
    if (!source) {
      setHdState("unavailable");
      return;
    }

    setHdState("loading");

    if (loadedSources.has(source)) {
      lightboxImage.src = source;
      setHdState("ready");
      return;
    }

    if (pendingSources.has(source)) return;

    // Keep the lightweight card splash visible as a temporary preview, but
    // request the HD artwork immediately at high priority. Desktop zoom waits
    // for this HD request so a 1024 px preview is never enlarged by mistake.
    const preload = new Image();
    preload.decoding = "async";
    preload.loading = "eager";
    preload.fetchPriority = "high";
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
        setHdState("ready");
      }
    };

    preload.onerror = () => {
      pendingSources.delete(source);
      failedSources.add(source);
      queueMicrotask(syncFullscreenSource);
    };

    preload.src = source;
  };

  setupDesktopZoom(lightbox, lightboxImage, lightboxTitle);

  // app.js updates the image and title synchronously. Deferring one microtask
  // lets us always read the final skin title before choosing its HD source.
  const observer = new MutationObserver(() => queueMicrotask(syncFullscreenSource));
  observer.observe(lightboxTitle, { childList: true, subtree: true, characterData: true });
  observer.observe(lightboxImage, { attributes: true, attributeFilter: ["src"] });
  syncFullscreenSource();
}

function setupDesktopZoom(lightbox, image, title) {
  const desktopPointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const figure = image.closest(".lightbox-figure");
  const zoom = {
    scale: 1,
    x: 0,
    y: 0,
    dragging: false,
    pointerId: null,
    startPointerX: 0,
    startPointerY: 0,
    startX: 0,
    startY: 0,
    title: title.textContent.trim(),
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const hdIsLoading = () => image.dataset.hdState === "loading";
  const isActive = () => desktopPointer.matches && !lightbox.hidden && !hdIsLoading();

  const clampPan = () => {
    if (!figure || zoom.scale <= 1) {
      zoom.x = 0;
      zoom.y = 0;
      return;
    }

    const imageWidth = image.clientWidth || 0;
    const imageHeight = image.clientHeight || 0;
    const figureWidth = figure.clientWidth || window.innerWidth;
    const figureHeight = figure.clientHeight || window.innerHeight;
    const maxX = Math.max(0, ((imageWidth * zoom.scale) - figureWidth) / 2);
    const maxY = Math.max(0, ((imageHeight * zoom.scale) - figureHeight) / 2);

    zoom.x = clamp(zoom.x, -maxX, maxX);
    zoom.y = clamp(zoom.y, -maxY, maxY);
  };

  const applyZoom = ({ animate = true } = {}) => {
    clampPan();
    image.style.transformOrigin = "center center";
    image.style.transform = `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`;
    image.style.transition = animate && !zoom.dragging && !reducedMotion.matches
      ? "transform 140ms cubic-bezier(.2,.8,.2,1)"
      : "none";
    image.style.willChange = zoom.scale > 1 ? "transform" : "auto";

    if (hdIsLoading()) image.style.cursor = "progress";
    else {
      image.style.cursor = zoom.scale > 1
        ? (zoom.dragging ? "grabbing" : "grab")
        : "zoom-in";
    }

    image.title = desktopPointer.matches
      ? (hdIsLoading()
        ? "Chargement de l’image HD…"
        : zoom.scale > 1
          ? "Glisser pour déplacer · molette pour zoomer · double-clic pour réinitialiser"
          : "Molette ou double-clic pour zoomer")
      : "";
    lightbox.dataset.desktopZoomed = zoom.scale > 1 ? "true" : "false";
  };

  const resetZoom = ({ animate = false } = {}) => {
    zoom.scale = 1;
    zoom.x = 0;
    zoom.y = 0;
    zoom.dragging = false;
    zoom.pointerId = null;
    applyZoom({ animate });
  };

  const setScale = (nextScale, { animate = true } = {}) => {
    zoom.scale = clamp(nextScale, 1, 5);
    if (zoom.scale <= 1.001) {
      resetZoom({ animate });
      return;
    }
    applyZoom({ animate });
  };

  figure?.addEventListener("wheel", (event) => {
    if (!desktopPointer.matches || lightbox.hidden) return;
    if (hdIsLoading()) {
      event.preventDefault();
      applyZoom({ animate: false });
      return;
    }
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.16 : 1 / 1.16;
    setScale(zoom.scale * factor, { animate: false });
  }, { passive: false });

  image.addEventListener("dblclick", (event) => {
    if (!desktopPointer.matches || lightbox.hidden) return;
    event.preventDefault();
    if (hdIsLoading()) {
      applyZoom({ animate: false });
      return;
    }
    setScale(zoom.scale > 1 ? 1 : 2.25);
  });

  image.addEventListener("pointerdown", (event) => {
    if (!isActive() || event.pointerType !== "mouse" || zoom.scale <= 1) return;
    event.preventDefault();
    zoom.dragging = true;
    zoom.pointerId = event.pointerId;
    zoom.startPointerX = event.clientX;
    zoom.startPointerY = event.clientY;
    zoom.startX = zoom.x;
    zoom.startY = zoom.y;
    image.setPointerCapture?.(event.pointerId);
    applyZoom({ animate: false });
  });

  image.addEventListener("pointermove", (event) => {
    if (!zoom.dragging || event.pointerId !== zoom.pointerId) return;
    zoom.x = zoom.startX + (event.clientX - zoom.startPointerX);
    zoom.y = zoom.startY + (event.clientY - zoom.startPointerY);
    applyZoom({ animate: false });
  });

  const stopDragging = (event) => {
    if (!zoom.dragging || (event?.pointerId != null && event.pointerId !== zoom.pointerId)) return;
    const pointerId = zoom.pointerId;
    zoom.dragging = false;
    zoom.pointerId = null;
    if (event?.type !== "lostpointercapture" && pointerId != null && image.hasPointerCapture?.(pointerId)) {
      image.releasePointerCapture(pointerId);
    }
    applyZoom({ animate: false });
  };

  image.addEventListener("pointerup", stopDragging);
  image.addEventListener("pointercancel", stopDragging);
  image.addEventListener("lostpointercapture", stopDragging);

  document.addEventListener("keydown", (event) => {
    if (!isActive() || zoom.scale <= 1) return;

    const step = event.shiftKey ? 160 : 72;
    if (event.key === "ArrowLeft") zoom.x += step;
    else if (event.key === "ArrowRight") zoom.x -= step;
    else if (event.key === "ArrowUp") zoom.y += step;
    else if (event.key === "ArrowDown") zoom.y -= step;
    else return;

    event.preventDefault();
    event.stopPropagation();
    applyZoom({ animate: false });
  }, { capture: true });

  const stateObserver = new MutationObserver(() => {
    const currentTitle = title.textContent.trim();
    if (lightbox.hidden || currentTitle !== zoom.title) {
      zoom.title = currentTitle;
      resetZoom();
      return;
    }
    applyZoom({ animate: false });
  });
  stateObserver.observe(lightbox, { attributes: true, attributeFilter: ["hidden", "data-hd-state"] });
  stateObserver.observe(title, { childList: true, subtree: true, characterData: true });

  image.addEventListener("load", () => applyZoom({ animate: false }));

  window.addEventListener("resize", () => {
    if (zoom.scale > 1) applyZoom({ animate: false });
  }, { passive: true });

  desktopPointer.addEventListener?.("change", () => resetZoom());
  applyZoom({ animate: false });
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
