# LoL Skins

Galerie visuelle de champions, skins, chromas et variantes League of Legends / Wild Rift.

## Structure

- `index.html` : structure de l'interface
- `styles.css` : design responsive
- `app.js` : navigation, recherche, filtres, favoris, lightbox et fallbacks d'images
- `data-loader.js` : charge les données historiques et résout les meilleures sources d'assets disponibles
- `legacy/index-original.html` : copie intacte de l'ancien prototype et source de métadonnées pendant la migration

## Fonctionnalités

- interface responsive desktop / mobile
- recherche de champions et de skins
- filtres PC, Wild Rift, Prestige / Mythic, Chromas et Favoris
- favoris persistants dans le navigateur (`localStorage`)
- lightbox avec navigation clavier, boutons et swipe mobile
- chargement paresseux des images (`loading="lazy"`)
- navigation par URL avec `#champion=...`
- fallbacks automatiques lorsqu'une source d'image ne répond plus

## Sources des splash arts

L'application ne dépend plus d'une seule URL saisie à la main.

Pour les champions et skins PC, elle utilise en priorité les métadonnées Riot / CommunityDragon pour retrouver le skin exact, puis construit plusieurs sources possibles :

1. splash `uncentered` de CommunityDragon
2. splash officiel Riot Data Dragon
3. splash `centered` de CommunityDragon
4. ancien lien du prototype en dernier recours

Les données CommunityDragon ne sont chargées que lorsqu'un champion est ouvert afin d'éviter des dizaines de requêtes au démarrage.

Pour les chromas, l'application tente de reconnaître les entrées grâce au nom et, quand il est présent dans l'ancienne URL Tencent, au `contentId` du chroma. Le splash historique reste prioritaire quand il représente réellement le chroma, puis l'app essaie les assets CommunityDragon et le splash du skin parent si ce lien disparaît.

Pour Wild Rift, les liens historiques du League of Legends Wiki sont conservés pour le moment, avec une tentative via `Special:Redirect/file` afin de récupérer le fichier original plutôt qu'une ancienne URL directe fragile.

Si toutes les sources échouent, l'application affiche seulement alors `Image indisponible`.

## Pourquoi garder le fichier legacy ?

Le prototype initial contient beaucoup de données saisies manuellement. Pour éviter de perdre une seule entrée pendant la migration, il reste conservé intact dans `legacy/index-original.html`.

À terme, les métadonnées pourront être déplacées vers un vrai fichier `data/skins.json`, sans dépendre du HTML historique.

## Lancer le projet

Le chargement utilise `fetch()`. Il faut donc servir le dossier avec un serveur HTTP ; GitHub Pages fonctionne directement.

Exemple local :

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.
