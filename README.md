# LoL Skins

Galerie visuelle de champions, skins, chromas et variantes League of Legends / Wild Rift.

## Structure

- `index.html` : structure minimale de l'interface
- `styles.css` : unique feuille de style, responsive PC / mobile, avec adaptation clair / sombre
- `app.js` : navigation, recherche, filtres, favoris, lightbox et fallbacks d'images
- `data-loader.js` : charge les données historiques et les meilleures sources d'assets disponibles
- `data/image-overrides.json` : carte des splash arts vérifiés par l'audit automatique
- `legacy/index-original.html` : copie intacte de l'ancien prototype et source de métadonnées pendant la migration

## Fonctionnalités

- interface commune PC / téléphone avec adaptations responsive
- recherche de champions et de skins
- filtres PC, Wild Rift, Prestige / Mythic, Chromas et Favoris
- favoris persistants dans le navigateur (`localStorage`)
- lightbox avec navigation clavier, boutons et swipe mobile
- splash arts affichés entièrement avec `object-fit: contain`
- chargement paresseux des images (`loading="lazy"`) et décodage asynchrone
- navigation par URL avec `#champion=...`
- fallbacks automatiques lorsqu'une source d'image ne répond plus
- respect de `prefers-reduced-motion`
- thème clair / sombre basé sur le réglage système

## Optimisations

L'interface utilise une seule feuille CSS afin d'éviter les cascades de correctifs contradictoires entre Safari mobile et les navigateurs desktop.

Le JavaScript construit un index en mémoire des skins par champion au chargement. Les recherches et changements de filtres ne rescannent donc plus inutilement toute la collection pour chaque carte. Les clics sur les cartes sont gérés par délégation d'événements, ce qui évite de créer des centaines d'écouteurs individuels.

Les cartes utilisent `content-visibility: auto` quand le navigateur le prend en charge, et les images de galerie sont chargées avec `loading="lazy"`, `decoding="async"` et une priorité faible. La lightbox augmente la priorité de l'image ouverte.

Les données locales, la carte d'images vérifiées et le catalogue Riot sont chargés en parallèle. Le cache HTTP normal du navigateur est utilisé au lieu de forcer une revalidation à chaque visite.

## Sources des splash arts

L'application utilise d'abord la carte générée par l'audit automatique. Les fallbacks restent disponibles via Riot Data Dragon, CommunityDragon, League Wiki et les anciennes URLs conservées dans la source historique.

Les données CommunityDragon d'un champion ne sont chargées à la demande que si les sources vérifiées ne suffisent pas.

Si toutes les sources échouent, l'application affiche `Image indisponible`.

## Pourquoi garder le fichier legacy ?

Le prototype initial contient beaucoup de données saisies manuellement. Pour éviter de perdre une entrée pendant la migration, il reste conservé intact dans `legacy/index-original.html`.

À terme, ces métadonnées pourront être déplacées vers un vrai fichier `data/skins.json`, ce qui permettra de supprimer le parsing du HTML historique.

## Lancer le projet

Le chargement utilise `fetch()`. Il faut donc servir le dossier avec un serveur HTTP ; GitHub Pages fonctionne directement.

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.
