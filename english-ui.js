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
const CHROMA_TOKEN = /\s*[-–—:|/]?\s*\bchroma\b\s*[-–—:|/]?\s*/gi;

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

function cleanSkinCardName(value) {
  return String(value || "")
    .replace(WILD_RIFT_SUFFIX, " ")
    .replace(CHROMA_TOKEN, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/(?:\s*[-–—:|/]\s*)+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  const preview = card.querySelector(".skin-preview");
  if (!titleWrap || !title || !preview) return;

  const rawTitle = title.textContent || "";
  const inlineWildRiftTag = title.querySelector(".skin-tag-wr");
  const existingWildRiftBadge = card.querySelector(".badge-wr");
  const existingChromaBadge = card.querySelector(".badge-chroma");
  const legacyPlatformText = [...titleWrap.querySelectorAll("p")]
    .find((element) => /^(Wild Rift|League of Legends PC)$/i.test(element.textContent.trim()));

  const isWildRift = Boolean(
    inlineWildRiftTag
    || existingWildRiftBadge
    || /\(\s*Wild Rift\s*\)/i.test(rawTitle)
    || /^Wild Rift$/i.test(legacyPlatformText?.textContent?.trim() || "")
  );
  const isChroma = Boolean(existingChromaBadge || /\bchroma\b/i.test(rawTitle));

  card.dataset.cardBadgesReady = "true";

  title.textContent = cleanSkinCardName(rawTitle);

  const image = preview.querySelector("img");
  if (image?.alt) image.alt = cleanSkinCardName(image.alt);

  const ariaLabel = preview.getAttribute("aria-label");
  if (ariaLabel) preview.setAttribute("aria-label", cleanSkinCardName(ariaLabel));

  titleWrap.querySelectorAll(".skin-platform-label").forEach((element) => element.remove());
  titleWrap.querySelectorAll("p").forEach((element) => {
    if (/^(Wild Rift|League of Legends PC)$/i.test(element.textContent.trim())) element.remove();
  });

  let badgeRow = titleWrap.querySelector(".skin-badges");
  const needsBadgeRow = isWildRift || isChroma || Boolean(badgeRow?.children.length);

  if (needsBadgeRow && !badgeRow) {
    badgeRow = document.createElement("div");
    badgeRow.className = "skin-badges";
    titleWrap.appendChild(badgeRow);
  }

  if (badgeRow) {
    badgeRow.querySelectorAll(".badge-wr").forEach((badge, index) => {
      if (!isWildRift || index > 0) badge.remove();
    });
    badgeRow.querySelectorAll(".badge-chroma").forEach((badge, index) => {
      if (!isChroma || index > 0) badge.remove();
    });

    if (isWildRift) ensureBadge(badgeRow, "badge-wr", "Wild Rift");
    if (isChroma) ensureBadge(badgeRow, "badge-chroma", "Chroma");

    if (!badgeRow.children.length) badgeRow.remove();
  }
}

function processSkinCards(root = document) {
  if (root instanceof Element && root.matches(".skin-card")) processSkinCard(root);
  root.querySelectorAll?.(".skin-card").forEach(processSkinCard);
}

document.documentElement.lang = "en";
installCardBadgeStyles();
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
