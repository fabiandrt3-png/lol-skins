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

const WILD_RIFT_SUFFIX = /\s*\(\s*Wild Rift\s*\)/gi;

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
    const translated = translateValue(current);
    if (translated !== current) target.nodeValue = translated;
    return;
  }

  if (target instanceof Element) translateElement(target);
}

function installCardPlatformStyles() {
  if (document.querySelector("#skin-platform-card-styles")) return;

  const style = document.createElement("style");
  style.id = "skin-platform-card-styles";
  style.textContent = `
    .skin-preview { position: relative; }
    .skin-preview .skin-platform-badge {
      position: absolute;
      left: 10px;
      bottom: 10px;
      z-index: 2;
      display: inline-flex;
      min-height: 24px;
      align-items: center;
      padding: 0 9px;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 999px;
      background: rgba(28,28,30,.72);
      color: #64d2ff;
      box-shadow: 0 4px 14px rgba(0,0,0,.22);
      backdrop-filter: blur(14px) saturate(1.15);
      -webkit-backdrop-filter: blur(14px) saturate(1.15);
      font-size: 10px;
      font-weight: 700;
      line-height: 1;
      pointer-events: none;
    }
    @media (max-width: 720px) {
      .skin-preview .skin-platform-badge {
        left: 9px;
        bottom: 9px;
        min-height: 23px;
        padding-inline: 8px;
        font-size: 9px;
      }
    }
  `;
  document.head.appendChild(style);
}

function cleanWildRiftLabel(value) {
  return String(value || "").replace(WILD_RIFT_SUFFIX, "").replace(/\s{2,}/g, " ").trim();
}

function processWildRiftCard(card) {
  if (!(card instanceof Element) || card.dataset.wildRiftCardReady === "true") return;

  const title = card.querySelector(".skin-title-wrap h3");
  const preview = card.querySelector(".skin-preview");
  if (!title || !preview) return;

  const inlineTag = title.querySelector(".skin-tag-wr");
  const existingBadge = card.querySelector(".badge-wr");
  const isWildRift = Boolean(inlineTag || existingBadge || /\(\s*Wild Rift\s*\)/i.test(title.textContent || ""));
  if (!isWildRift) {
    card.dataset.wildRiftCardReady = "true";
    return;
  }

  card.dataset.wildRiftCardReady = "true";

  inlineTag?.remove();
  title.normalize();

  for (const node of title.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) node.nodeValue = cleanWildRiftLabel(node.nodeValue);
  }

  const image = preview.querySelector("img");
  if (image?.alt) image.alt = cleanWildRiftLabel(image.alt);

  const ariaLabel = preview.getAttribute("aria-label");
  if (ariaLabel) preview.setAttribute("aria-label", cleanWildRiftLabel(ariaLabel));

  const badge = existingBadge || document.createElement("span");
  badge.classList.add("badge", "badge-wr", "skin-platform-badge");
  badge.textContent = "Wild Rift";
  preview.appendChild(badge);

  const oldBadgeRow = card.querySelector(".skin-badges");
  if (oldBadgeRow && !oldBadgeRow.children.length) oldBadgeRow.remove();
}

function processSkinCards(root = document) {
  if (root instanceof Element && root.matches(".skin-card")) processWildRiftCard(root);
  root.querySelectorAll?.(".skin-card").forEach(processWildRiftCard);
}

document.documentElement.lang = "en";
installCardPlatformStyles();
translateElement(document.body);
processSkinCards(document);

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
