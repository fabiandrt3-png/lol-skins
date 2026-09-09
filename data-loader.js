const LEGACY_SOURCE = "legacy/index-original.html";

/**
 * Charge les données sans les recopier ni les altérer pendant la refonte.
 * Le fichier legacy est une copie bit-for-bit de l'ancien index.html.
 * On extrait uniquement le littéral de tableau championsSkins, puis on l'évalue
 * dans une Function isolée au lieu d'exécuter le reste de l'ancien script.
 */
export async function loadSkinData() {
  const response = await fetch(LEGACY_SOURCE, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Impossible de charger ${LEGACY_SOURCE} (${response.status})`);
  }

  const source = await response.text();
  const declaration = "const championsSkins = [";
  const declarationIndex = source.indexOf(declaration);

  if (declarationIndex === -1) {
    throw new Error("La collection championsSkins est introuvable dans la source legacy.");
  }

  const arrayStart = source.indexOf("[", declarationIndex);
  const arrayEnd = source.indexOf("];", arrayStart);

  if (arrayStart === -1 || arrayEnd === -1) {
    throw new Error("La collection championsSkins est incomplète dans la source legacy.");
  }

  const arrayLiteral = source.slice(arrayStart, arrayEnd + 1);
  const data = Function(`"use strict"; return (${arrayLiteral});`)();

  if (!Array.isArray(data)) {
    throw new Error("Les données chargées ne sont pas un tableau valide.");
  }

  return data.map((item, index) => ({
    ...item,
    _id: `${slugify(item.champ)}::${slugify(item.skin)}::${index}`,
  }));
}

export function slugify(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
