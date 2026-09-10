# LoL Skins

Galerie responsive de champions, skins, chromas et variantes League of Legends / Wild Rift.

## Ajouter un skin manuellement

Pour ajouter un skin toi-même, **ne modifie plus `data/image-overrides.json`**.

Modifie uniquement `data/manual-skins.txt`.

Une ligne = un skin :

```text
Champion | Nom du skin | PC ou WR | image carte | image plein écran HD | après ce skin (optionnel)
```

Exemple :

```text
Anivia | Old God Anivia | PC | https://exemple.com/anivia.jpg | https://exemple.com/anivia-hd.jpg
```

Pour Wild Rift, écris `WR` :

```text
Lux | Nouveau skin Lux | WR | https://exemple.com/lux.jpg | https://exemple.com/lux-hd.jpg
```

Pour placer un chroma ou une variante juste après son skin parent, ajoute le nom du parent en 6e colonne :

```text
Aatrox | Variante spéciale | PC | https://exemple.com/carte.jpg | https://exemple.com/hd.jpg | Mecha Aatrox
```

Règles simples :

- les lignes qui commencent par `#` sont des commentaires et sont ignorées ;
- `PC` est utilisé par défaut si tu écris autre chose que `WR` / `Wild Rift` ;
- l'identifiant technique est créé automatiquement ;
- si tu ne renseignes pas la 6e colonne, le skin est ajouté après le dernier skin du champion ;
- si une ligne est mal écrite, elle est ignorée au lieu de casser toute l'application ;
- le fichier est rechargé sans cache : tu n'as pas besoin de modifier `version.json` après chaque ajout manuel ;
- utilise de préférence un lien direct vers une image pour `image` et `fullImage`.

## Architecture

Le front est volontairement compact :

- `index.html` : structure sémantique de l’interface
- `styles.css` : **unique feuille de styles** pour desktop et mobile
- `app.js` : navigation, recherche, filtres, favoris, lightbox et gestion des images
- `data-loader.js` : charge le catalogue principal et les ajouts manuels
- `data/image-overrides.json` : catalogue principal et carte des meilleures sources de splash arts vérifiées
- `data/manual-skins.txt` : **petit fichier à modifier à la main pour ajouter/corriger rapidement des skins**
- `legacy/index-original.html` : copie intacte du prototype initial, conservée uniquement comme référence historique
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

Au runtime, l’application charge le catalogue principal depuis `data/image-overrides.json`, puis ajoute les quelques lignes éventuelles de `data/manual-skins.txt`.

Le petit fichier manuel est chargé sans cache afin qu'un nouveau skin apparaisse après le déploiement GitHub Pages sans avoir à modifier la version de l'application.

Les données sont indexées une fois en mémoire par champion afin d’éviter les filtrages complets répétés à chaque rendu.

## Audit des splash arts

Le workflow `.github/workflows/audit-splashes.yml` s’exécute une fois par semaine (et manuellement à la demande). Il :

- vérifie les splash arts ;
- tente de réparer les sources Wild Rift manquantes ;
- recherche les originaux exacts en meilleure résolution ;
- conserve le catalogue centralisé intact ;
- met à jour `data/image-overrides.json` et `audit-report.json` si nécessaire ;
- reste silencieux en cas d’éléments non résolus afin d’éviter le spam d’e-mails GitHub.

## Lancer le projet

Le projet utilise `fetch()`, il doit donc être servi via HTTP. GitHub Pages fonctionne directement.

Exemple local :

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.
