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
    const translated = translateValue(current);
    if (translated !== current) target.nodeValue = translated;
    return;
  }

  if (target instanceof Element) translateElement(target);
}

document.documentElement.lang = "en";
translateElement(document.body);

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === "childList") {
      mutation.addedNodes.forEach(translateMutationTarget);
      translateMutationTarget(mutation.target);
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
