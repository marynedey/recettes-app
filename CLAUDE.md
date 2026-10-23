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
| `sw.js` | service worker : cache de l'app (cache d'abord, mise à jour en arrière-plan, rechargement automatique quand une nouvelle version s'installe). Compléter `FICHIERS` quand on ajoute/renomme un fichier. |
| `js/format.js` | front matter, Markdown ↔ objet recette, quantités (recalcul portions), minuteurs, ingrédients d'une étape. Sans dépendance navigateur, testé avec `node --test`. |
| `js/github.js` | appels API GitHub (arbre, blobs, contents PUT/DELETE) |
| `js/store.js` | cache local (texte brut des recettes par sha dans `localStorage`, photos dans le Cache API), favoris, historique, imports en attente |
| `js/ui.js` | icônes SVG, visuels/placeholder dégradé, cartes, toast |
| `js/minuteurs.js` | minuteurs du mode cuisine : plusieurs à la fois (clé `slug|étape|durée`), gardés dans `localStorage`, alarme, une notification par minuteur (heure de fin) ; notification touchée → étape du minuteur (événement `mr:etape` si le mode cuisine est déjà ouvert). Bouton « Recommencer » (étape 1, minuteurs de la recette arrêtés). |
| `js/courses.js` | liste de courses : recettes prévues + nombre de personnes, ingrédients additionnés (g/kg, mL/cL/L, c. à café/soupe ; noms regroupés sans « fondu », « froid »…, œ/oe, pluriels), rayons, « j'en ai déjà » → ce qui manque, articles ajoutés à la main (`ajouts`) ; gardée dans `localStorage` (`mr.courses`) |
| `js/app.js` | routeur par ancre (`#/`, `#/recettes`, `#/favoris`, `#/courses`, `#/recette/<slug>`, `#/cuisine/<slug>?p=<portions>`, `#/ajouter`, `#/modifier/<slug>`, `#/reglages`) |
| `js/views/*.js` | un module par écran (accueil : tri A → Z / plus rapides / récentes / anciennes, retenu dans `mr.tri` ; ajout : « Par lien » et « Saisie manuelle » sur une piste qu'on glisse, comme les onglets d'une fiche) |

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
photos: [photos/tarte-tatin.jpg, photos/tarte-tatin-2.jpg]   # la première = photo principale (l'ancien « photo: x.jpg » est toujours lu ; l'import l'utilise)
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

## Design (Direction A, couleurs de l'icône)
Fond `#F6F0E6`, cartes `#FFFBF4`, encre `#2B2118`, texte secondaire `#8A7B6B`, bordures `#E7DCCB`.
Orange tiré de l'icône (marmite, `icons/`) : accent `#C9480A` pour boutons, liens et texte (contraste 4,8 avec le blanc ; l'orange vif de l'icône `#F07818` ne fait que 2,9), `--accent-vif` `#F07818` pour le décor sans texte (progression), minuteur `#F7A12B`, fond doux `#FBE3CC`, pastel `#FFF0E0` avec texte `#8A3300`, accent foncé `#9C2400` (contour de l'icône). Toutes les couleurs sont des variables dans `:root` (`css/app.css`). Titres Fraunces, texte Inter (auto-hébergées dans `fonts/`, licence OFL). Rayons ~18 px. Images manquantes : placeholder dégradé chaud.

## Versions
À **chaque** changement publié, augmenter la version dans `js/views/reglages.js` (affichée en bas des Réglages) **et** la même dans `sw.js` (`mr-app-X.Y.Z`) : c'est ce qui fait installer la nouvelle version sur le téléphone. Un test vérifie que les deux correspondent.
- `Z` (1.2.0 → 1.2.1) : correction de bug.
- `Y` (1.2.0 → 1.3.0) : nouvelle fonctionnalité.
- `X` (1.x → 2.0.0) : changement incompatible (ex. format des recettes à migrer).

## Tests
- `npm test` : tests unitaires (format, quantités, minuteurs, ingrédients d'une étape, jeton envoyé à GitHub, versions et fichiers du service worker).
- `npm run test:navigateur` : parcours complets dans Chromium (format téléphone) avec un faux GitHub qui refuse toute requête sans le bon jeton : réglages, accueil, fiche (portions, « à ajuster », glisser), photos (carrousel, visionneuse), mode cuisine (retour, plusieurs minuteurs avec horloge simulée et notifications), débordement avec texte agrandi, ajout manuel (contenu du fichier écrit), import (demande, résultat ok/erreur), partage Android, tri de l'accueil, Recettes/Favoris, courses (articles à la main, « Voir la liste », partage), recommencer une recette, retour après « Terminé », notification touchée, modifier/supprimer, erreurs des réglages, hors ligne. Nécessite `npm ci` (Playwright, utilisé uniquement pour les tests) ; utilise le Chromium complet (`channel: 'chromium'`), la version « headless shell » refusant les notifications.
- `npm run verifier-version` : échoue si l'app a changé sans que la version augmente.
- Le workflow `.github/workflows/tests.yml` lance les trois sur chaque PR (contrôles « Tests unitaires », « Parcours navigateur », « Version augmentée ») ; ils sont obligatoires pour fusionner dans `main`.
- Pour voir l'UI en local : `python3 -m http.server` puis http://localhost:8000.

## Plus tard
Partage foyer (dont liste de courses partagée), favoris synchronisés, import IA optionnel.
