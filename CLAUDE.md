# Mes Recettes — notes pour Claude

App de recettes perso, pensée mobile (Android), en français. Maquette validée : Direction A « Carnet de cuisine ».

## Dépôts (compte GitHub `marynedey`)
- `recettes-app` (**public**, ce dépôt) : code de l'app, publié via **GitHub Pages**. Aucune donnée perso, aucun secret.
- `mes-recettes` (**privé**) : les recettes uniquement (1 fichier Markdown par recette + photos) et le workflow d'import.

## Architecture
- PWA statique en JavaScript vanilla (modules ES, **pas d'étape de build**), installable, lisible hors ligne.
- L'app lit/écrit les recettes directement dans `mes-recettes` via l'API REST GitHub, avec un jeton fine-grained limité à ce dépôt (Contents : read/write), saisi dans les réglages et stocké uniquement dans le `localStorage` du téléphone.
- Pas de serveur pour l'app ni les recettes, pas d'IA payante. Seule exception, facultative : le **serveur des minuteurs** (`serveur/`, Cloudflare Workers gratuit) qui envoie une notification vide à la fin d'un minuteur, app fermée (voir `serveur/LISEZMOI.md`).

| Fichier | Rôle |
|---|---|
| `index.html`, `manifest.webmanifest` | coquille, manifest PWA (+ `share_target` Android ; raccourcis « Liste de courses » et « Ajouter une recette » à l'appui long sur l'icône, icônes `icons/raccourci-*.png` ; pas de vrai widget possible pour une appli web) |
| `sw.js` | service worker : cache de l'app (cache d'abord, mise à jour en arrière-plan, rechargement automatique quand une nouvelle version s'installe). Compléter `FICHIERS` quand on ajoute/renomme un fichier. |
| `js/format.js` | front matter, Markdown ↔ objet recette, quantités (recalcul portions), minuteurs, ingrédients d'une étape. Sans dépendance navigateur, testé avec `node --test`. |
| `js/github.js` | appels API GitHub (arbre, blobs, contents PUT/DELETE) |
| `js/store.js` | cache local (texte brut des recettes par sha dans `localStorage`, photos dans le Cache API), favoris, historique, imports en attente |
| `js/ui.js` | icônes SVG, visuels/placeholder dégradé, cartes, toast, `ongletsGlissants` (onglets dans une piste à défilement natif + aimantation CSS ; la pastille suit pendant le glissement, la hauteur (= onglet affiché, chaque onglet observé) ne change qu'au repos : l'animer pendant le défilement le rendait lent et saccadé ; essai d'un glissement en JS abandonné, saccadé sur téléphone ; changement d'onglet depuis le bas de la page → retour en haut du nouvel onglet) |
| `js/minuteurs.js` | minuteurs du mode cuisine : plusieurs à la fois (clé `slug|étape|durée`), gardés dans `localStorage`, alarme, une notification par minuteur (heure de fin) ; notification touchée → étape du minuteur (événement `mr:etape` si le mode cuisine est déjà ouvert). Bouton « Recommencer » (étape 1, minuteurs arrêtés, ingrédients décochés). Bouton principal en texte seul (Démarrer, Pause, Reprendre, Arrêter, Relancer), centré comme « ±1 min ». « Relancer » repart de la durée de l'étape (sans les ±1 min) ; le bandeau des autres étapes ne garde pas les minuteurs terminés et arrêtés ; la carte ne clignote que tant que ça sonne. Notifications : heures, minutes et secondes. À la fin : `sonne` = sonnerie en boucle (app ouverte, son préparé au premier toucher) + bandeau « C'est prêt ! » (`app.js`, sauf dans le mode cuisine de la recette) avec « Arrêter » / « +1 min » ; mêmes boutons sur la notification (gérés par `sw.js`, app fermée : `actions.json` appliqué à la réouverture). Le serveur renvoie la notification toutes les 30 s pendant 2 min tant qu'on n'a pas arrêté. Copie des minuteurs dans le Cache API (`mr-donnees`, `minuteurs.json`) pour le service worker. |
| `js/voix.js` | mode cuisine **mains libres** (bouton micro, désactivé par défaut, à rallumer à chaque fois) : reconnaissance vocale du téléphone en continu (relancée après un silence), une commande ne compte que juste après « Recette » (`lireCommande`, testée avec `node --test`) : suivante, précédente, lance le minuteur, pause, arrête (sonnerie, sinon pause), relis, ingrédients ; lecture à voix haute de l'étape en arrivant (`speechSynthesis`, case « Lire les étapes » retenue dans `mr.voix.lire`), le micro est ignoré pendant la lecture. |
| `js/push.js` | serveur des minuteurs (adresse dans les réglages, `serveur`) : abonnement Web Push, `PUT`/`DELETE /minuteurs/<appareil>|<id>` quand un minuteur démarre / s'arrête. Le `push` reçu par `sw.js` est vide : le SW retrouve le minuteur terminé dans la copie. |
| `js/courses.js` | liste de courses : recettes prévues + nombre de personnes, ingrédients additionnés (g/kg, mL/cL/L, c. à café/soupe ; noms regroupés sans « fondu », « froid »…, œ/oe, pluriels), rayons, « j'en ai déjà » → ce qui manque, articles ajoutés à la main (`ajouts`), glisser pour retirer avec « Annuler » (`masques` : un article de recette revient si ses quantités changent) ; la feuille « Quelles recettes ? » a son entrée d'historique (le retour Android la ferme) ; un article à la main sans quantité n'affiche rien, un ingrédient de recette sans quantité « selon la recette » ; gardée dans `localStorage` (`mr.courses`) et **partagée** via `courses.json` du dépôt (toute la famille, un jeton par personne) : chaque modification est une opération (`faire`), mise en attente (`mr.courses.attente`) puis envoyée ; sur conflit (409/422, sha périmé) on relit et on rejoue les opérations ; relevé toutes les 8 s sur l'écran Courses et au retour dans l'app ; « Retirer les articles cochés » (cochés ou « j'en ai assez », annulable) |
| `js/app.js` | un écran s'ouvre toujours en haut (position retrouvée seulement au retour arrière) ; routeur par ancre (`#/`, `#/recettes`, `#/favoris`, `#/courses`, `#/recette/<slug>`, `#/cuisine/<slug>?p=<portions>`, `#/ajouter`, `#/modifier/<slug>`, `#/reglages`) |
| `js/views/*.js` | un module par écran (accueil : tri A → Z / plus rapides / récentes / anciennes, retenu dans `mr.tri` ; ajout : « Par lien » et « Saisie manuelle » sur une piste qu'on glisse, comme les onglets d'une fiche ; partage Android avec un lien → `#/ajouter?url=…&auto=1`, l'import part tout seul ; modifier : photos réordonnées par glisser-déposer ; fiche : « Personnes » ou « Taille du moule » (`etat.mode`, `monMoule`, facteur passé au mode cuisine par `&f=`), « Mon carnet » dans l'onglet Notes (`#/recette/<slug>?carnet=1` ouvre le formulaire ; « Noter dans le carnet » après « Terminé ») ; mode cuisine : toucher un ingrédient le grise et le barre, mêmes cases que la fiche (`mr.fiche.<slug>`, `coches`) ; plus de niveau/difficulté : ignoré à la lecture, retiré à l'enregistrement ; « Supprimer la recette » en bas de « Modifier » (et dans l'onglet Notes de la fiche)) |

Synchronisation : on lit l'arbre git du dépôt (`git/trees?recursive=1`) et on ne télécharge que les blobs dont le sha a changé.

## Format d'une recette (`recettes/<slug>.md`)
```
---
titre: Tarte tatin
categorie: Desserts       # Plats, Desserts, Entrées, Végé, Apéro, Boissons… (le singulier est accepté)
tags: [classique, pommes]
portions: 6
moule: rond 24 cm         # facultatif (rond/carré/rectangle 30 x 20 cm) : la fiche adapte les quantités à mon moule (rapport des surfaces)
preparation: 20           # minutes
cuisson: 55               # minutes
repos: 30                 # minutes (pousse, frigo, marinade… facultatif)
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

## Carnet                  (facultatif, écrit depuis l'onglet Notes de la fiche ; la plus récente en premier)
- 2026-10-12 · Réussi · moule rond 28 cm · four 170 °C · 8 pers. : Pousse 1 h 30 près du radiateur.
```
Quantités parsées (nombre + unité + nom) pour le recalcul selon le nombre de personnes.

## Import par lien (gratuit, sans IA)
1. l'app crée `import/a-traiter/<id>.json` (`{ "url": … }`) dans `mes-recettes` ;
2. le workflow `import.yml` (déclenché par ce push) lance `.github/scripts/importer.py` (Python stdlib) : JSON-LD schema.org `Recipe` → `recettes/<slug>.md` + photo, écrit `import/resultats/<id>.json` (`statut: ok|erreur`), supprime la demande ;
3. l'app interroge `import/resultats/<id>.json` toutes les 8 s, puis supprime le résultat. En cas d'échec : bannière + formulaire pré-rempli avec l'URL.
4. bouton × de la bannière « Import en cours » = annuler : la demande est retirée du dépôt si elle y est encore ; l'import reste suivi (`annule: true`) et, s'il aboutit quand même, la recette créée est supprimée sans message.

Captures, PDF, TikToks : convertis à la main par Claude dans une conversation (pas dans l'app), au format ci-dessus.

## Design (Direction A, couleurs de l'icône)
Fond `#F6F0E6`, cartes `#FFFBF4`, encre `#2B2118`, texte secondaire `#736455` (5:1 ; l'ancien `#8A7B6B` ne faisait que 3,6), bordures `#E7DCCB`.
Orange tiré de l'icône (marmite à toque, `icons/` ; dessin d'origine `icons/source-icone.jpg` : `icon-*` = carré arrondi détouré, `maskable-*` et `apple-touch-icon` = fond crème plein, dessin dans la zone sûre) : accent `#C9480A` pour boutons, liens et texte (contraste 4,8 avec le blanc ; l'orange vif de l'icône `#F07818` ne fait que 2,9), `--accent-vif` `#F07818` pour le décor sans texte (progression), minuteur `#F7A12B`, fond doux `#FBE3CC`, pastel `#FFF0E0` avec texte `#8A3300`, accent foncé `#9C2400` (contour de l'icône). Texte et liens orange : `--accent-texte` `#B03F09` (5,2:1 sur le crème ; les boutons gardent `#C9480A`). Toutes les couleurs sont des variables dans `:root` (`css/app.css`), redéfinies pour le **mode sombre** (`@media (prefers-color-scheme: dark)`, suit le téléphone : fond `#1C1712`, cartes `#27201A`, encre `#F3EBE0`, orange texte `#F2944F`) ; aucune couleur en dur hors des variables (sauf texte foncé sur l'orange du minuteur). Un test vérifie le contraste de tous les textes (≥ 4,5:1, 3:1 au-dessus de 24 px) dans les deux modes. Titres Fraunces, texte Inter (auto-hébergées dans `fonts/`, licence OFL). Rayons ~18 px. Images manquantes : placeholder en dégradé vif tiré de l'orange de l'icône, un seul rond clair derrière l'assiette.

## Versions
À **chaque** changement publié, augmenter la version dans `js/views/reglages.js` (affichée en bas des Réglages) **et** la même dans `sw.js` (`mr-app-X.Y.Z`) : c'est ce qui fait installer la nouvelle version sur le téléphone. Un test vérifie que les deux correspondent.
- `Z` (1.2.0 → 1.2.1) : correction de bug.
- `Y` (1.2.0 → 1.3.0) : nouvelle fonctionnalité.
- `X` (1.x → 2.0.0) : changement incompatible (ex. format des recettes à migrer).

## Tests
- `npm test` : tests unitaires (format, quantités, minuteurs, ingrédients d'une étape, liste de courses (dont partage entre deux téléphones : conflits, hors ligne), jeton envoyé à GitHub, versions et fichiers du service worker, signature VAPID du serveur des minuteurs).
- `npm run test:navigateur` : parcours complets dans Chromium (format téléphone) avec un faux GitHub qui refuse toute requête sans le bon jeton : réglages, accueil, fiche (portions, « à ajuster », glisser), photos (carrousel, visionneuse), mode cuisine (retour, mains libres avec faux micro, plusieurs minuteurs avec horloge simulée et notifications), débordement avec texte agrandi (largeur et texte qui sort d'un bouton ; les boutons ont une hauteur minimale et grandissent), ajout manuel (contenu du fichier écrit), import (demande, résultat ok/erreur), partage Android, tri de l'accueil, Recettes/Favoris, courses (articles à la main, « Voir la liste », partage), recommencer une recette, retour après « Terminé », notification touchée, modifier/supprimer, erreurs des réglages, serveur des minuteurs (faux serveur, notification push livrée au SW par DevTools), hors ligne. Nécessite `npm ci` (Playwright, utilisé uniquement pour les tests) ; utilise le Chromium complet (`channel: 'chromium'`), la version « headless shell » refusant les notifications.
- `npm run verifier-version` : échoue si l'app a changé sans que la version augmente.
- Le workflow `.github/workflows/tests.yml` lance les trois sur chaque PR (contrôles « Tests unitaires », « Parcours navigateur », « Version augmentée ») ; ils sont obligatoires pour fusionner dans `main`.
- Le workflow `.github/workflows/serveur.yml` déploie `serveur/` sur Cloudflare à chaque changement sur `main` (secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).
- Pour voir l'UI en local : `python3 -m http.server` puis http://localhost:8000.

## Plus tard
Favoris synchronisés, import IA optionnel. (Partage foyer : fait avec un jeton par personne sur le même dépôt ; liste de courses dans `courses.json`.)
