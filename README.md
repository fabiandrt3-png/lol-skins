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
- sans 6e colonne, le skin suit le tri automatique ; s'il n'a ni date connue ni parent, il reste à la fin du champion ;
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
- `catalog-order.js` : tri chronologique, rattachement aux skins PC et dédoublonnage des illustrations
- `data/skin-order.json` : dates et univers pré-générés, chargés avec le catalogue
- `data/skin-order-overrides.json` : dates absentes du Wiki, accompagnées de leur source
- `data/skin-artwork-corrections.json` : corrections vérifiées de liens vers une mauvaise illustration, intégrées aux métadonnées générées
- `data/skin-visual-duplicates.json` : équivalences PC/Wild Rift vérifiées en comparant les images, avec preuves et variantes conservées
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

Au runtime, l’application charge en parallèle le catalogue principal, les entrées LoR, les ajouts manuels et les métadonnées de tri pré-générées. Elle ne contacte pas le Wiki pour retrouver les dates et les univers.

Le navigateur ne télécharge jamais les gros jeux de données complets de Legends of Runeterra. GitHub Actions les traite en amont et ne publie que les entrées nécessaires dans `data/lor-skins.json`.

Pour chaque champion, les skins PC forment la base chronologique, avec Classic en premier. Une illustration Wild Rift ou LoR suit son équivalent PC, sinon le premier skin PC de la même gamme, sinon du même univers. La gamme exacte est prioritaire sur l'univers plus large (par exemple Coven avant Eclipse). Les skins sans équivalent PC restent classés selon leur propre date. Les chromas suivent leur parent, les niveaux LoR restent dans l'ordre et les placements manuels explicites sont prioritaires.

Une même illustration, identifiée par son fichier source canonique et son skin, n'apparaît qu'une fois. Les miniatures et versions HD du même fichier sont rapprochées ; les artworks distincts, chromas et niveaux LoR sont conservés. Un lien HD ou de secours commun ne suffit pas à fusionner deux skins. Les favoris d'un doublon sont transférés à la carte conservée. Les corrections de liens erronés sont appliquées avant cette comparaison.

Les fichiers PC et Wild Rift peuvent aussi contenir la même illustration sous des noms différents, avec un recadrage, une symétrie ou une compression différente. Le catalogue utilise alors les équivalences visuelles vérifiées de `data/skin-visual-duplicates.json`. La carte PC est conservée avec les deux badges et reste accessible dans les deux filtres. Les favoris WR rejoignent cette carte ; les chromas WR suivent toujours leur parent. Une équivalence n'est appliquée que si les deux identifiants, le skin et les fichiers principaux correspondent encore aux preuves. Les versions redessinées ou comportant des détails visuels différents restent séparées. La comparaison ne s'exécute pas dans le navigateur.

Les dates et univers proviennent des modules SkinData, SkinDataWR et LoRCosmetics du League of Legends Wiki. Un skin sans date fiable reste à la fin de son groupe ; aucune date n'est inventée pour une sortie annulée ou annoncée. Au 16 septembre 2026, les entrées indépendantes concernées sont Grand Reckoning Alistar (annulé), Old God Anivia (à venir) et Founders Silver Kayle (jour exact non confirmé). Une indisponibilité des métadonnées laisse fonctionner la galerie avec les dates du catalogue et les correspondances de noms exactes.

Les cartes LoR conservent l’artwork exact de leur niveau. Le plein écran essaie en priorité la version HD exacte correspondante ; si elle n’existe pas, il retombe sur l’artwork original sans changer de variante.

Le petit fichier manuel est chargé sans cache afin qu'un nouveau skin apparaisse après le déploiement GitHub Pages sans avoir à modifier la version de l'application.

Le fichier de lore est chargé une seule fois par session du module plein écran. Le panneau n’est rendu que lorsqu’un skin disposant d’une entrée de lore est ouvert.

Les données sont indexées une fois en mémoire par champion afin d’éviter les filtrages complets répétés à chaque rendu.

La fusion des catalogues utilise également un index par identifiant et conserve la priorité des ajouts manuels avant le tri. Les consommateurs partagent le même chargement ; une erreur du catalogue principal libère ce chargement pour permettre une nouvelle tentative.

Un changement de favori met à jour les boutons concernés sans recréer les cartes ni réinitialiser l’image HD ou le zoom. La galerie est recalculée lorsqu’un retrait dans le filtre Favoris modifie les résultats. Les traductions et badges ne parcourent que les éléments ajoutés ou modifiés.

Les images HD sont associées à l’identifiant unique du skin : deux niveaux LoR ayant le même titre affiché conservent chacun leur propre artwork.

## Sources de splash arts

Les sources peuvent notamment inclure League of Legends Wiki HD, Riot/CommunityDragon, Data Dragon League of Legends, les ressources Wild Rift vérifiées et le Data Dragon officiel Legends of Runeterra.

Legends of Runeterra est traité comme une plateforme distincte : ses artworks ne servent plus à remplacer silencieusement des splash arts LoL ou Wild Rift. Chaque skin/niveau LoR possède sa propre entrée et ses propres candidats d’image.

## Audit des splash arts

Le workflow `.github/workflows/audit-splashes.yml` s’exécute une fois par semaine (et manuellement à la demande). Il :

- actualise les données officielles Legends of Runeterra et régénère `data/lor-skins.json` ;
- conserve l’ordre chronologique des skins LoR et l’ordre des niveaux ;
- actualise les dates et univers avec `node scripts/update-skin-order.mjs`, en gardant le fichier précédent si une source est incomplète ou indisponible ;
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

Ces tests vérifient le tri PC et les regroupements par univers, les niveaux LoR, les doublons et leurs alias de favoris, les ajouts manuels, le partage des requêtes, la reprise après un échec de chargement et la conservation des entrées du catalogue complet. Le workflow `Runtime regression tests` les exécute sur les push et pull requests, avec une vérification de syntaxe des modules du navigateur.
