# Mes Recettes — notes pour Claude

App de recettes perso, pensée mobile (Android), en français. Maquette validée : Direction A « Carnet de cuisine ».

## Dépôts (compte GitHub `marynedey`)
- `recettes-app` (**public**, ce dépôt) : code de l'app, publié via **GitHub Pages**. Aucune donnée perso, aucun secret.
- `mes-recettes` (**privé**) : les recettes uniquement (1 fichier Markdown par recette + photos) et le workflow d'import.

## Architecture
- PWA statique en JavaScript vanilla (modules ES, **pas d'étape de build**), installable, lisible hors ligne.
- L'app lit/écrit les recettes directement dans `mes-recettes` via l'API REST GitHub, avec un jeton fine-grained limité à ce dépôt (Contents : read/write), saisi dans les réglages et stocké uniquement dans le `localStorage` du téléphone.
- Pas de serveur, pas d'IA payante.

| Fichier | Rôle |
|---|---|
| `index.html`, `manifest.webmanifest` | coquille, manifest PWA (+ `share_target` Android) |
| `sw.js` | service worker : cache de l'app (cache d'abord, mise à jour en arrière-plan). **Incrémenter `VERSION` et compléter `FICHIERS` quand on ajoute/renomme un fichier.** |
| `js/format.js` | front matter, Markdown ↔ objet recette, quantités (recalcul portions), minuteurs, ingrédients d'une étape. Sans dépendance navigateur, testé avec `node --test`. |
| `js/github.js` | appels API GitHub (arbre, blobs, contents PUT/DELETE) |
| `js/store.js` | cache local (texte brut des recettes par sha dans `localStorage`, photos dans le Cache API), favoris, historique, imports en attente |
| `js/ui.js` | icônes SVG, visuels/placeholder dégradé, cartes, toast |
| `js/app.js` | routeur par ancre (`#/`, `#/recettes`, `#/favoris`, `#/courses`, `#/recette/<slug>`, `#/cuisine/<slug>?p=<portions>`, `#/ajouter`, `#/modifier/<slug>`, `#/reglages`) |
| `js/views/*.js` | un module par écran |

Synchronisation : on lit l'arbre git du dépôt (`git/trees?recursive=1`) et on ne télécharge que les blobs dont le sha a changé.

## Format d'une recette (`recettes/<slug>.md`)
```
---
titre: Tarte tatin
categorie: Desserts       # Plats, Desserts, Entrées, Végé, Apéro, Boissons… (le singulier est accepté)
tags: [classique, pommes]
portions: 6
preparation: 20           # minutes
cuisson: 55               # minutes
repos: 30                 # minutes (pousse, frigo, marinade… facultatif)
difficulte: Facile        # Facile | Moyen | Difficile
photo: photos/tarte-tatin.jpg
source: https://…         # lien d'origine si import
ajoutee: 2026-10-22
---
## Ingrédients
### Pour la pâte           (sous-parties facultatives)
- 200 g farine
- 6 pommes Golden

## Étapes
### Pour la pâte           (même nom de groupe → ingrédients proposés en mode cuisine)
1. …
2. … (minuteur détecté automatiquement si « 12 min » dans le texte ; **gras** = mis en valeur)

## Notes
…
```
Quantités parsées (nombre + unité + nom) pour le recalcul selon le nombre de personnes.

## Import par lien (gratuit, sans IA)
1. l'app crée `import/a-traiter/<id>.json` (`{ "url": … }`) dans `mes-recettes` ;
2. le workflow `import.yml` (déclenché par ce push) lance `.github/scripts/importer.py` (Python stdlib) : JSON-LD schema.org `Recipe` → `recettes/<slug>.md` + photo, écrit `import/resultats/<id>.json` (`statut: ok|erreur`), supprime la demande ;
3. l'app interroge `import/resultats/<id>.json` toutes les 8 s, puis supprime le résultat. En cas d'échec : bannière + formulaire pré-rempli avec l'URL.

Captures, PDF, TikToks : convertis à la main par Claude dans une conversation (pas dans l'app), au format ci-dessus.

## Design (Direction A)
Fond `#F6F0E6`, cartes `#FFFBF4`, encre `#2B2118`, texte secondaire `#8A7B6B`, bordures `#E7DCCB`, accent `#C4552D`, minuteur `#E9B949`, fond doux `#F1E3D3`. Titres Fraunces, texte Inter (auto-hébergées dans `fonts/`, licence OFL). Rayons ~18 px. Images manquantes : placeholder dégradé chaud.

## Tests
`node --test tests/*.test.mjs` (format, quantités, minuteurs, aller-retour des recettes de `tests/fixtures/`). Pour tester l'UI en local : `python3 -m http.server` puis http://localhost:8000.

## Plus tard
Partage foyer, liste de courses, favoris synchronisés, import IA optionnel.
