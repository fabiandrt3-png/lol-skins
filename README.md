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

Le front reste volontairement compact :

- `index.html` : structure sémantique de l’interface
- `styles.css` : styles principaux desktop et mobile
- `lore.css` : styles isolés du panneau de lore plein écran
- `app.js` : navigation, recherche, filtres, favoris, lightbox et gestion des images
- `lightbox-hd.js` : sources HD et zoom plein écran desktop
- `lore.js` : bouton et panneau de lore, sans modifier le carrousel ou le zoom
- `data-loader.js` : charge le catalogue principal et les ajouts manuels
- `data/image-overrides.json` : catalogue principal et carte des meilleures sources de splash arts vérifiées
- `data/lor-art.json` : index généré des illustrations officielles Legends of Runeterra provenant du Data Dragon Riot
- `data/manual-skins.txt` : **petit fichier à modifier à la main pour ajouter/corriger rapidement des skins**
- `data/skin-lore.json` : lore affiché dans le plein écran ; l’essai initial couvre Akshan et ses skins
- `legacy/index-original.html` : copie intacte du prototype initial, conservée uniquement comme référence historique
- `scripts/` : audit, réparation Wild Rift, index LoR et recherche d’originaux haute résolution

Les styles principaux Apple/mobile restent fusionnés dans `styles.css`. Le panneau de lore est volontairement isolé dans une petite feuille dédiée pour ne pas perturber les règles existantes du plein écran, du zoom et des cartes.

## Fonctionnalités

- interface Apple-inspired sobre, responsive PC / téléphone
- recherche de champions et de skins
- filtres PC, Wild Rift, Prestige / Mythic, Chromas et Favoris
- favoris persistants dans `localStorage`
- navigation par URL avec `#champion=...`
- lightbox clavier + swipe mobile
- bouton Lore en plein écran lorsqu’un lore est disponible
- panneau de lore responsive avec le splash art conservé en arrière-plan, obscurci et flouté
- splash arts toujours affichés en entier (`object-fit: contain`)
- chargement paresseux des images
- fallbacks automatiques avec mémorisation des URLs en échec pendant la session
- source officielle Legends of Runeterra disponible comme fallback secondaire sûr
- respect de `prefers-reduced-motion` et des safe areas iPhone

## Chargement et performances

Au runtime, l’application charge le catalogue principal depuis `data/image-overrides.json`, puis ajoute les quelques lignes éventuelles de `data/manual-skins.txt`.

Le petit fichier manuel est chargé sans cache afin qu'un nouveau skin apparaisse après le déploiement GitHub Pages sans avoir à modifier la version de l'application.

Les gros jeux de données Legends of Runeterra ne sont **pas** téléchargés par le navigateur. Le workflow GitHub construit `data/lor-art.json` depuis le Data Dragon officiel Riot puis rattache uniquement quelques URLs utiles au catalogue principal.

Le fichier de lore est chargé une seule fois par session du module plein écran. Le panneau n’est rendu que lorsqu’un skin disposant d’une entrée de lore est ouvert.

Les données sont indexées une fois en mémoire par champion afin d’éviter les filtrages complets répétés à chaque rendu.

## Sources de splash arts

Les sources peuvent notamment inclure League of Legends Wiki HD, Riot/CommunityDragon, Data Dragon League of Legends, les ressources Wild Rift vérifiées et désormais **Legends of Runeterra Data Dragon**.

Les illustrations LoR sont des artworks officiels Riot, mais elles peuvent être différentes du splash League correspondant. Elles restent donc derrière les sources LoL/WR normales. Pour un champion PC de base elles peuvent servir de dernier fallback officiel ; pour un skin précis, une illustration LoR n’est utilisée que si une correspondance explicite a été validée dans l’index.

## Audit des splash arts

Le workflow `.github/workflows/audit-splashes.yml` s’exécute une fois par semaine (et manuellement à la demande). Il :

- actualise l’index officiel Legends of Runeterra depuis Riot Data Dragon ;
- vérifie les splash arts ;
- tente de réparer les sources Wild Rift manquantes ;
- recherche les originaux exacts en meilleure résolution ;
- ajoute les fallbacks LoR sans remplacer un splash LoL/WR sain par un artwork différent ;
- conserve le catalogue centralisé intact ;
- met à jour `data/image-overrides.json`, `data/lor-art.json` et les rapports d’audit si nécessaire ;
- reste silencieux en cas d’éléments non résolus afin d’éviter le spam d’e-mails GitHub.

## Lancer le projet

Le projet utilise `fetch()`, il doit donc être servi via HTTP. GitHub Pages fonctionne directement.

Exemple local :

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.
