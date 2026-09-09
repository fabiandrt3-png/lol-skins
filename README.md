# LoL Skins

Galerie responsive de champions, skins, chromas et variantes League of Legends / Wild Rift.

## Architecture

Le front est volontairement compact :

- `index.html` : structure sémantique de l’interface
- `styles.css` : **unique feuille de styles** pour desktop et mobile
- `app.js` : navigation, recherche, filtres, favoris, lightbox et gestion des images
- `data-loader.js` : charge le catalogue historique et la carte d’images vérifiées
- `data/image-overrides.json` : meilleures sources de splash arts validées par l’audit automatique
- `legacy/index-original.html` : copie intacte du prototype initial, conservée comme source de données
- `scripts/` : audit, réparation Wild Rift et recherche d’originaux haute résolution

Les anciennes couches CSS Apple/mobile ont été fusionnées dans `styles.css`. Cela évite les conflits de spécificité et garantit que desktop et téléphone utilisent la même base visuelle avec des media queries adaptées.

## Fonctionnalités

- interface Apple-inspired sobre, responsive PC / téléphone
- recherche de champions et de skins
- filtres PC, Wild Rift, Prestige / Mythic, Chromas et Favoris
- favoris persistants dans `localStorage`
- navigation par URL avec `#champion=...`
- lightbox clavier + swipe mobile
- splash arts toujours affichés en entier (`object-fit: contain`)
- chargement paresseux des images
- fallbacks automatiques avec mémorisation des URLs en échec pendant la session
- respect de `prefers-reduced-motion` et des safe areas iPhone

## Chargement et performances

Au runtime, l’application ne télécharge plus les métadonnées Data Dragon / CommunityDragon à chaque ouverture de champion. Le workflow hebdomadaire fait ce travail en amont et enregistre les URLs vérifiées dans `data/image-overrides.json`.

Le navigateur charge donc seulement :

1. le catalogue historique ;
2. la carte des splash arts vérifiés ;
3. les images réellement visibles, en lazy loading.

Les données sont indexées une fois en mémoire par champion afin d’éviter les filtrages complets répétés à chaque rendu.

## Audit des splash arts

Le workflow `.github/workflows/audit-splashes.yml` s’exécute une fois par semaine (et manuellement à la demande). Il :

- vérifie les splash arts ;
- tente de réparer les sources Wild Rift manquantes ;
- recherche les originaux exacts en meilleure résolution ;
- met à jour `data/image-overrides.json` et `audit-report.json` si nécessaire ;
- reste silencieux en cas d’éléments non résolus afin d’éviter le spam d’e-mails GitHub.

## Lancer le projet

Le projet utilise `fetch()`, il doit donc être servi via HTTP. GitHub Pages fonctionne directement.

Exemple local :

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.
