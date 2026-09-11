# LoL Skins

Galerie responsive de champions, skins, chromas et variantes League of Legends, Wild Rift et Legends of Runeterra.

## Ajouter un skin manuellement

Pour ajouter un skin toi-même, **ne modifie plus `data/image-overrides.json`**.

Modifie uniquement `data/manual-skins.txt`.

Une ligne = un skin :

```text
Champion | Nom du skin | PC, WR ou LoR | image carte | image plein écran HD | après ce skin (optionnel)
```

Exemple :

```text
Anivia | Old God Anivia | PC | https://exemple.com/anivia.jpg | https://exemple.com/anivia-hd.jpg
```

Pour Wild Rift, écris `WR` :

```text
Lux | Nouveau skin Lux | WR | https://exemple.com/lux.jpg | https://exemple.com/lux-hd.jpg
```

Pour Legends of Runeterra, écris `LoR` :

```text
Akshan | Variante LoR Akshan — Level 1 | LoR | https://exemple.com/akshan-lor.png | https://exemple.com/akshan-lor-hd.jpg
```

Pour placer un chroma ou une variante juste après son skin parent, ajoute le nom du parent en 6e colonne :

```text
Aatrox | Variante spéciale | PC | https://exemple.com/carte.jpg | https://exemple.com/hd.jpg | Mecha Aatrox
```

Règles simples :

- les lignes qui commencent par `#` sont des commentaires et sont ignorées ;
- `PC` est utilisé par défaut si tu écris autre chose que `WR` / `Wild Rift` ou `LoR` / `Legends of Runeterra` ;
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
- `data-loader.js` : charge le catalogue principal, les skins LoR générés et les ajouts manuels
- `data/image-overrides.json` : catalogue principal LoL / Wild Rift et carte des meilleures sources de splash arts vérifiées
- `data/lor-skins.json` : catalogue généré des skins Legends of Runeterra, avec une entrée distincte pour chaque artwork de niveau
- `data/lor-art.json` : index technique des illustrations officielles de champions LoR provenant du Data Dragon Riot
- `data/manual-skins.txt` : **petit fichier à modifier à la main pour ajouter/corriger rapidement des skins**
- `data/skin-lore.json` : métadonnées de lore affichées dans le plein écran
- `legacy/index-original.html` : copie intacte du prototype initial, conservée uniquement comme référence historique
- `scripts/` : audit, réparation Wild Rift, génération LoR et recherche d’originaux haute résolution

Les styles principaux Apple/mobile restent fusionnés dans `styles.css`. Le panneau de lore est volontairement isolé dans une petite feuille dédiée pour ne pas perturber les règles existantes du plein écran, du zoom et des cartes.

## Fonctionnalités

- interface Apple-inspired sobre, responsive PC / téléphone
- recherche de champions et de skins
- filtres PC, Wild Rift, Legends of Runeterra, Prestige / Mythic, Chromas et Favoris
- favoris persistants dans `localStorage`
- navigation par URL avec `#champion=...`
- lightbox clavier + swipe mobile
- bouton Lore en plein écran lorsqu’un lore officiel est disponible
- panneau de lore responsive avec le splash art conservé en arrière-plan, obscurci et flouté
- splash arts toujours affichés en entier en plein écran (`object-fit: contain`)
- chargement paresseux des images
- fallbacks automatiques avec mémorisation des URLs en échec pendant la session
- skins LoR affichés comme de vraies entrées distinctes, y compris leurs différents niveaux
- respect de `prefers-reduced-motion` et des safe areas iPhone

## Chargement et performances

Au runtime, l’application charge le catalogue principal depuis `data/image-overrides.json`, puis le petit catalogue pré-généré `data/lor-skins.json`, puis les quelques lignes éventuelles de `data/manual-skins.txt`.

Le navigateur ne télécharge jamais les gros jeux de données complets de Legends of Runeterra. GitHub Actions les traite en amont et ne publie que les entrées nécessaires dans `data/lor-skins.json`.

Pour LoR, les artworks d’un même champion sont ordonnés chronologiquement par date de sortie, puis par variante et par niveau. Par exemple, un champion possédant un skin Original puis un skin Pulsefire est présenté Original Level 1, Original Level 2, puis Pulsefire Level 1, Pulsefire Level 2.

Les cartes LoR conservent l’artwork exact de leur niveau. Le plein écran essaie en priorité la version HD exacte correspondante ; si elle n’existe pas, il retombe sur l’artwork original sans changer de variante.

Le petit fichier manuel est chargé sans cache afin qu'un nouveau skin apparaisse après le déploiement GitHub Pages sans avoir à modifier la version de l'application.

Le fichier de lore est chargé une seule fois par session du module plein écran. Le panneau n’est rendu que lorsqu’un skin disposant d’une entrée de lore est ouvert.

Les données sont indexées une fois en mémoire par champion afin d’éviter les filtrages complets répétés à chaque rendu.

La fusion des catalogues utilise également un index par identifiant, en conservant l’ordre des skins et la priorité des ajouts manuels. Les consommateurs partagent le même chargement ; une erreur du catalogue principal libère ce chargement pour permettre une nouvelle tentative.

Un changement de favori met à jour les boutons concernés sans recréer les cartes ni réinitialiser l’image HD ou le zoom. La galerie est recalculée lorsqu’un retrait dans le filtre Favoris modifie les résultats. Les traductions et badges ne parcourent que les éléments ajoutés ou modifiés.

Les images HD sont associées à l’identifiant unique du skin : deux niveaux LoR ayant le même titre affiché conservent chacun leur propre artwork.

## Sources de splash arts

Les sources peuvent notamment inclure League of Legends Wiki HD, Riot/CommunityDragon, Data Dragon League of Legends, les ressources Wild Rift vérifiées et le Data Dragon officiel Legends of Runeterra.

Legends of Runeterra est traité comme une plateforme distincte : ses artworks ne servent plus à remplacer silencieusement des splash arts LoL ou Wild Rift. Chaque skin/niveau LoR possède sa propre entrée et ses propres candidats d’image.

## Audit des splash arts

Le workflow `.github/workflows/audit-splashes.yml` s’exécute une fois par semaine (et manuellement à la demande). Il :

- actualise les données officielles Legends of Runeterra et régénère `data/lor-skins.json` ;
- conserve l’ordre chronologique des skins LoR et l’ordre des niveaux ;
- vérifie les splash arts LoL / Wild Rift ;
- tente de réparer les sources Wild Rift manquantes ;
- recherche les originaux exacts en meilleure résolution ;
- protège les sources déjà vérifiées contre toute baisse de résolution ;
- retire les anciennes métadonnées de fallback LoR devenues obsolètes ;
- conserve le catalogue centralisé intact ;
- met à jour les fichiers générés et les rapports d’audit si nécessaire.

## Lancer le projet

Le projet utilise `fetch()`, il doit donc être servi via HTTP. GitHub Pages fonctionne directement.

Exemple local :

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.

## Vérifications

Avec Node.js 22 ou supérieur, sans dépendance à installer :

```bash
node --test tests/*.test.mjs
```

Ces tests vérifient l’ordre des niveaux LoR, les doublons, les ajouts et corrections manuels, le partage des requêtes et la reprise après un échec de chargement. Le workflow `Runtime regression tests` les exécute sur les push et pull requests, avec une vérification de syntaxe des modules du navigateur.
