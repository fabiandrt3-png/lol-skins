const ENGLISH_IMAGE_FALLBACK = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
  <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#16171a"/><stop offset="1" stop-color="#050506"/></linearGradient></defs>
  <rect width="1600" height="900" fill="url(#g)"/>
  <text x="800" y="450" fill="#73737a" font-family="Arial,sans-serif" font-size="52" text-anchor="middle">Image unavailable</text>
</svg>`);

const exactTranslations = new Map([
  ["Rechercher un champion…", "Search for a champion…"],
  ["Tous les champions", "All Champions"],
  ["Impossible de charger la collection", "Unable to load the collection"],
  ["Recharge la page ou vérifie les fichiers du dépôt.", "Reload the page or check the repository files."],
  ["Retirer des favoris", "Remove from favorites"],
  ["Ajouter aux favoris", "Add to favorites"],
  ["Voir le lore", "View lore"],
  ["Lore indisponible", "Lore unavailable"],
  ["Fermer le lore", "Close lore"],
  ["Univers alternatif", "Alternate universe"],
  ["Molette : zoom sous la souris · glisser : déplacer · double-clic : réinitialiser", "Wheel: zoom under cursor · drag: pan · double-click: reset"],
  ["Molette ou double-clic pour zoomer", "Wheel or double-click to zoom"],
]);

function translateValue(value) {
  if (!value) return value;
  if (exactTranslations.has(value)) return exactTranslations.get(value);

  let match = value.match(/^Rechercher un skin de (.+)…$/);
  if (match) return `Search ${match[1]} skins…`;

  match = value.match(/^Skins de (.+)$/);
  if (match) return `${match[1]} Skins`;

  match = value.match(/^(\d+) résultat$/);
  if (match) return `${match[1]} result`;

  match = value.match(/^(\d+) résultats$/);
  if (match) return `${match[1]} results`;

  match = value.match(/^Voir les skins de (.+)$/);
  if (match) return `View ${match[1]} skins`;

  match = value.match(/^Ouvrir (.+) en plein écran$/);
  if (match) return `Open ${match[1]} in fullscreen`;

  match = value.match(/^Voir le lore de (.+)$/);
  if (match) return `View ${match[1]} lore`;

  return value;
}

function translateElement(element) {
  if (!(element instanceof Element)) return;

  for (const attribute of ["placeholder", "aria-label", "title"]) {
    const current = element.getAttribute(attribute);
    if (!current) continue;
    const translated = translateValue(current);
    if (translated !== current) element.setAttribute(attribute, translated);
  }

  if (element instanceof HTMLImageElement && element.src.startsWith("data:image/svg+xml")) {
    try {
      if (decodeURIComponent(element.src).includes("Image indisponible")) element.src = ENGLISH_IMAGE_FALLBACK;
    } catch {
      // Ignore malformed data URLs and keep the existing fallback.
    }
  }

  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const current = child.nodeValue;
      const translated = translateValue(current);
      if (translated !== current) child.nodeValue = translated;
    } else if (child instanceof Element) {
      translateElement(child);
    }
  }
}

function translateMutationTarget(target) {
  if (target.nodeType === Node.TEXT_NODE) {
    const current = target.nodeValue;
    if (target.parentElement?.id === "lightboxTitle") {
      const parsed = parseCardSkinName(current);
      if (parsed.lorLevel) {
        target.nodeValue = parsed.displayName;
        return;
      }
    }
    const translated = translateValue(current);
    if (translated !== current) target.nodeValue = translated;
    return;
  }

  if (target instanceof Element) translateElement(target);
}

function installCardBadgeStyles() {
  let style = document.querySelector("#skin-platform-card-styles");
  if (!style) {
    style = document.createElement("style");
    style.id = "skin-platform-card-styles";
    document.head.appendChild(style);
  }

  style.textContent = `
    .skin-title-wrap .skin-platform-label,
    .skin-title-wrap > p:not(.skin-badges) {
      display: none !important;
    }

    .skin-title-wrap .skin-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 7px;
    }

    .skin-title-wrap .badge {
      min-height: 22px;
      padding: 0 8px;
      border: 1px solid var(--separator-strong);
      border-radius: 999px;
      background: var(--surface-soft);
      font-size: 9px;
      font-weight: 650;
      line-height: 1;
    }

    .skin-title-wrap .badge-wr {
      border-color: rgba(100, 210, 255, .24);
      background: rgba(100, 210, 255, .13);
      color: #64d2ff;
    }

    .skin-title-wrap .badge-lor {
      border-color: rgba(191, 90, 242, .28);
      background: rgba(191, 90, 242, .14);
      color: #bf5af2;
    }

    .skin-title-wrap .badge-chroma {
      border-color: rgba(255, 159, 154, .22);
      background: rgba(255, 159, 154, .10);
      color: #ff9f9a;
    }

    .skin-title-wrap .badge-prestige {
      border-color: color-mix(in srgb, var(--yellow) 26%, transparent);
      background: color-mix(in srgb, var(--yellow) 10%, transparent);
      color: var(--yellow);
    }
  `;
}

function currentChampionName() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  return params.get("champion") || "";
}

function normalizeDisplayName(value) {
  return String(value || "")
    .replace(/[()]/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/(?:\s*[-–—:|/]\s*)+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeChromaLabel(value) {
  const clean = normalizeDisplayName(value)
    .replace(/^[-–—:|/\s]+|[-–—:|/\s]+$/g, "")
    .trim();
  if (!clean) return "Chroma";
  return /\bChroma$/i.test(clean) ? clean.replace(/\bchroma$/i, "Chroma") : `${clean} Chroma`;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCardSkinName(rawValue) {
  const raw = String(rawValue || "").trim();
  let displayName = raw;
  let chromaLabel = "";
  let lorLevel = "";

  const levelMatch = displayName.match(/\s*[—–-]\s*(Level\s*\d+)\s*$/i);
  if (levelMatch) {
    lorLevel = levelMatch[1].replace(/level/i, "Level").replace(/\s+/g, " ");
    displayName = displayName.slice(0, levelMatch.index).trim();
  }

  const isWildRift = /\(\s*Wild Rift\s*\)/i.test(raw) || /\bWild Rift\b/i.test(raw);

  displayName = displayName.replace(/\(([^()]*)\)/g, (full, content) => {
    if (/\bChroma\b/i.test(content) && !chromaLabel) {
      chromaLabel = normalizeChromaLabel(content);
      return " ";
    }
    if (/^\s*Wild Rift\s*$/i.test(content)) return " ";
    return ` ${content} `;
  });

  displayName = displayName.replace(/\bWild Rift\b/gi, " ");

  if (!chromaLabel && /\bChroma\b/i.test(displayName)) {
    const champion = currentChampionName();
    if (champion) {
      const championPattern = escapeRegExp(champion);
      const match = displayName.match(new RegExp(`^(.*?\\b${championPattern}\\b)\\s*[-–—:|/]?\\s*(.+?\\bChroma\\b)\\s*$`, "i"));
      if (match) {
        displayName = match[1];
        chromaLabel = normalizeChromaLabel(match[2]);
      }
    }
  }

  if (!chromaLabel && /\bChroma\b/i.test(displayName)) {
    const separated = displayName.match(/^(.*?)\s*[-–—:|/]\s*(.+?\bChroma\b)\s*$/i);
    if (separated) {
      displayName = separated[1];
      chromaLabel = normalizeChromaLabel(separated[2]);
    }
  }

  if (!chromaLabel && /\bChroma\b/i.test(displayName)) {
    chromaLabel = "Chroma";
    displayName = displayName.replace(/\bChroma\b/gi, " ");
  }

  return {
    displayName: normalizeDisplayName(displayName),
    chromaLabel,
    lorLevel,
    isWildRift,
  };
}

function ensureBadge(row, className, label) {
  let badge = row.querySelector(`.${className}`);
  if (!badge) {
    badge = document.createElement("span");
    badge.className = `badge ${className}`;
    row.appendChild(badge);
  }
  badge.textContent = label;
  return badge;
}

function processSkinCard(card) {
  if (!(card instanceof Element) || card.dataset.cardBadgesReady === "true") return;

  const titleWrap = card.querySelector(".skin-title-wrap");
  const title = titleWrap?.querySelector("h3");
  if (!titleWrap || !title) return;

  const rawTitle = title.textContent || "";
  const parsed = parseCardSkinName(rawTitle);
  const inlineWildRiftTag = title.querySelector(".skin-tag-wr");
  const existingWildRiftBadge = card.querySelector(".badge-wr");
  const existingLorBadge = card.querySelector(".badge-lor");
  const existingChromaBadge = card.querySelector(".badge-chroma");
  const legacyPlatformText = [...titleWrap.querySelectorAll("p")]
    .find((element) => /^(Wild Rift|League of Legends PC|Legends of Runeterra)$/i.test(element.textContent.trim()));

  const isWildRift = Boolean(
    parsed.isWildRift
    || inlineWildRiftTag
    || existingWildRiftBadge
    || /^Wild Rift$/i.test(legacyPlatformText?.textContent?.trim() || "")
  );
  const isLor = Boolean(
    existingLorBadge
    || /^Legends of Runeterra$/i.test(legacyPlatformText?.textContent?.trim() || "")
  );
  const isChroma = Boolean(parsed.chromaLabel || existingChromaBadge || /\bchroma\b/i.test(rawTitle));
  const chromaLabel = parsed.chromaLabel || existingChromaBadge?.textContent?.trim() || "Chroma";
  const lorLabel = parsed.lorLevel ? `Legends of Runeterra · ${parsed.lorLevel}` : "Legends of Runeterra";

  card.dataset.cardBadgesReady = "true";
  title.textContent = parsed.displayName;

  titleWrap.querySelectorAll(".skin-platform-label").forEach((element) => element.remove());
  titleWrap.querySelectorAll("p").forEach((element) => {
    if (/^(Wild Rift|League of Legends PC|Legends of Runeterra)$/i.test(element.textContent.trim())) element.remove();
  });

  let badgeRow = titleWrap.querySelector(".skin-badges");
  const needsBadgeRow = isWildRift || isLor || isChroma || Boolean(badgeRow?.children.length);

  if (needsBadgeRow && !badgeRow) {
    badgeRow = document.createElement("div");
    badgeRow.className = "skin-badges";
    titleWrap.appendChild(badgeRow);
  }

  if (badgeRow) {
    badgeRow.querySelectorAll(".badge-wr").forEach((badge, index) => {
      if (!isWildRift || index > 0) badge.remove();
    });
    badgeRow.querySelectorAll(".badge-lor").forEach((badge, index) => {
      if (!isLor || index > 0) badge.remove();
    });
    badgeRow.querySelectorAll(".badge-chroma").forEach((badge, index) => {
      if (!isChroma || index > 0) badge.remove();
    });

    if (isWildRift) ensureBadge(badgeRow, "badge-wr", "Wild Rift");
    if (isLor) ensureBadge(badgeRow, "badge-lor", lorLabel);
    if (isChroma) ensureBadge(badgeRow, "badge-chroma", chromaLabel);

    if (!badgeRow.children.length) badgeRow.remove();
  }
}

function processSkinCards(root = document) {
  if (root instanceof Element && root.matches(".skin-card")) processSkinCard(root);
  root.querySelectorAll?.(".skin-card").forEach(processSkinCard);
}

function installFullscreenNavigationBehavior() {
  const lightbox = document.querySelector("#lightbox");
  const figure = document.querySelector("#lightboxFigure");
  const previousButton = document.querySelector("#lightboxPrev");
  const nextButton = document.querySelector("#lightboxNext");
  if (!lightbox || !figure || !previousButton || !nextButton) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const track = () => figure.firstElementChild;
  const isZoomed = () =>
    lightbox.dataset.zoomed === "true"
    || lightbox.dataset.desktopZoomed === "true"
    || (window.visualViewport?.scale ?? 1) > 1.01;

  const finishAppTransitionImmediately = () => {
    queueMicrotask(() => {
      const element = track();
      if (!element) return;
      element.dispatchEvent(new Event("transitionend", { bubbles: true }));
    });
  };

  // Arrow buttons and keyboard arrows should never visibly slide. app.js still
  // performs its normal state update; we simply finish its carousel transition
  // in the same event turn, before the browser paints an intermediate frame.
  lightbox.addEventListener("click", (event) => {
    if (event.target.closest(".lightbox-nav")) finishAppTransitionImmediately();
  }, { capture: true });

  document.addEventListener("keydown", (event) => {
    if (lightbox.hidden) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") finishAppTransitionImmediately();
  }, { capture: true });

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let startedAt = 0;
  let dragging = false;
  let blocked = false;
  let finishing = false;

  const clearPointer = () => {
    pointerId = null;
    startX = 0;
    startY = 0;
    lastX = 0;
    lastY = 0;
    startedAt = 0;
    dragging = false;
    blocked = false;
    figure.style.cursor = "";
  };

  const setTrackOffset = (offset, animate) => {
    const element = track();
    if (!element) return;
    element.style.transition = animate && !reducedMotion.matches
      ? "transform 260ms cubic-bezier(.22, .61, .36, 1)"
      : "none";
    element.style.transform = `translate3d(calc(-33.333333% + ${offset}px), 0, 0)`;
  };

  const snapBack = () => {
    setTrackOffset(0, true);
  };

  const completeMouseSwipe = (direction) => {
    if (finishing) return;
    finishing = true;
    const element = track();
    if (!element) {
      finishing = false;
      return;
    }

    const width = figure.clientWidth || window.innerWidth;
    setTrackOffset(direction > 0 ? -width : width, true);

    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      finishing = false;
      if (direction > 0) nextButton.click();
      else previousButton.click();
    };

    if (reducedMotion.matches) {
      finish();
      return;
    }

    element.addEventListener("transitionend", finish, { once: true });
    window.setTimeout(finish, 340);
  };

  figure.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || lightbox.hidden || isZoomed()) return;
    if (previousButton.disabled && nextButton.disabled) return;

    pointerId = event.pointerId;
    startX = lastX = event.clientX;
    startY = lastY = event.clientY;
    startedAt = performance.now();
    dragging = false;
    blocked = false;
    setTrackOffset(0, false);
    figure.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  figure.addEventListener("pointermove", (event) => {
    if (pointerId === null || event.pointerId !== pointerId || finishing) return;
    if (isZoomed()) {
      blocked = true;
      setTrackOffset(0, false);
      return;
    }

    lastX = event.clientX;
    lastY = event.clientY;
    const deltaX = lastX - startX;
    const deltaY = lastY - startY;

    if (!dragging) {
      if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        blocked = true;
        return;
      }
      dragging = true;
      figure.style.cursor = "grabbing";
    }

    if (!blocked) setTrackOffset(deltaX, false);
  });

  const endPointerSwipe = (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;

    const activePointerId = pointerId;
    const wasDragging = dragging;
    const wasBlocked = blocked || isZoomed();
    const deltaX = lastX - startX;
    const deltaY = lastY - startY;
    const duration = Math.max(performance.now() - startedAt, 1);

    clearPointer();
    if (figure.hasPointerCapture?.(activePointerId)) figure.releasePointerCapture(activePointerId);

    if (wasBlocked || !wasDragging) {
      snapBack();
      return;
    }

    const width = figure.clientWidth || window.innerWidth;
    const threshold = Math.min(90, Math.max(48, width * 0.16));
    const velocity = Math.abs(deltaX) / duration;
    const horizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.15;
    const shouldChange = horizontal && (Math.abs(deltaX) >= threshold || (Math.abs(deltaX) >= 28 && velocity >= 0.45));

    if (!shouldChange) {
      snapBack();
      return;
    }

    completeMouseSwipe(deltaX < 0 ? 1 : -1);
  };

  figure.addEventListener("pointerup", endPointerSwipe);
  figure.addEventListener("pointercancel", (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    clearPointer();
    snapBack();
  });
}

document.documentElement.lang = "en";
installCardBadgeStyles();
translateElement(document.body);
processSkinCards(document);
installFullscreenNavigationBehavior();

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === "childList") {
      mutation.addedNodes.forEach((node) => {
        translateMutationTarget(node);
        if (node instanceof Element) processSkinCards(node);
      });
      translateMutationTarget(mutation.target);
      if (mutation.target instanceof Element) processSkinCards(mutation.target);
    } else {
      translateMutationTarget(mutation.target);
    }
  }
});

observer.observe(document.body, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["placeholder", "aria-label", "title", "src"],
});
