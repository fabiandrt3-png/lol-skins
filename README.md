# LoL Skins

Galerie visuelle de champions, skins, chromas et variantes League of Legends / Wild Rift.

## Branche `refactor-v2`

Cette branche modernise le prototype initial sans modifier la sauvegarde du projet.

### Structure

- `index.html` : structure de l'interface
- `styles.css` : design responsive
- `app.js` : navigation, recherche, filtres, favoris et lightbox
- `data-loader.js` : charge les données existantes sans les recopier
- `legacy/index-original.html` : copie bit-for-bit de l'ancien prototype et source de données pendant la migration

### Fonctionnalités ajoutées

- interface responsive desktop / mobile
- recherche de champions et de skins
- filtres PC, Wild Rift, Prestige / Mythic, Chromas et Favoris
- favoris persistants dans le navigateur (`localStorage`)
- lightbox avec navigation clavier, boutons et swipe mobile
- chargement paresseux des images (`loading="lazy"`)
- fallback si une image distante ne charge plus
- navigation par URL avec `#champion=...`
- meilleure accessibilité des boutons et contrôles

## Pourquoi garder le fichier legacy ?

Le prototype initial contient beaucoup de données saisies manuellement. Pour éviter de perdre ou d'altérer une seule entrée pendant la refonte, il est conservé intact et `data-loader.js` extrait uniquement le tableau `championsSkins`.

C'est une étape de migration sûre. Une prochaine étape pourra convertir ces données vers un vrai fichier `data/skins.json` ou vers une source de données automatisée, une fois le contenu vérifié.

## Lancer le projet

Le chargement des données utilise `fetch()`. Il faut donc servir le dossier avec un petit serveur HTTP (GitHub Pages fonctionne), et non ouvrir directement `index.html` avec `file://`.

Exemple avec Python :

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.
