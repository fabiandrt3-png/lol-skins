# LoL Skins

Collection visuelle de champions, skins, chromas et éditions spéciales League of Legends / Wild Rift.

## Structure

- `index.html` : structure de l'interface
- `styles.css` : design et responsive
- `app.js` : navigation, recherche, filtres, favoris et lightbox
- `data-loader.js` : chargement des données historiques depuis `legacy/index-original.html`
- `legacy/index-original.html` : copie intacte du prototype d'origine

## Fonctionnalités

- Grille de champions
- Recherche instantanée
- Vue par champion
- Filtres PC / Wild Rift / Prestige-Mythic / Chromas
- Favoris persistants via `localStorage`
- Lightbox avec clavier et swipe mobile
- Lazy-loading des images
- Fallback en cas d'image distante cassée
- Interface responsive desktop / mobile

## Développement

Le projet reste volontairement sans framework pour le moment afin de garder une base simple, rapide et facile à maintenir.

À terme, les données pourront être migrées hors du fichier legacy vers une source dédiée (`JSON` ou API) sans modifier l'interface.
