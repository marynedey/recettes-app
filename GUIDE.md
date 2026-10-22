# Guide — installer Mes Recettes

Trois étapes, une seule fois : publier l'app, créer le jeton, installer sur le téléphone.

## 1. Publier l'app (GitHub Pages)

1. Sur GitHub, dans `recettes-app` : **Settings → Pages**.
2. *Source* : **Deploy from a branch**, branche **main**, dossier **/ (root)** → **Save**.
3. Après une minute, l'app est en ligne sur **https://marynedey.github.io/recettes-app/**.

Dans `mes-recettes`, vérifier aussi **Settings → Actions → General → Workflow permissions** : choisir **Read and write permissions** (nécessaire pour l'import par lien).

## 2. Créer le jeton d'accès (fine-grained)

1. Ouvrir https://github.com/settings/personal-access-tokens/new
2. *Token name* : `Mes Recettes – téléphone`.
3. *Expiration* : la durée de votre choix (jusqu'à 1 an ; il faudra le recréer ensuite).
4. *Repository access* : **Only select repositories** → choisir **mes-recettes** uniquement.
5. *Permissions → Repository permissions* : **Contents → Read and write** (rien d'autre ; « Metadata : Read-only » s'ajoute tout seul).
6. **Generate token**, puis copier le jeton (`github_pat_…`). Il ne sera plus affiché ensuite.

Le jeton ne donne accès qu'aux recettes et reste uniquement sur le téléphone. En cas de perte du téléphone, le supprimer sur la même page GitHub.

## 3. Installer sur Android

1. Ouvrir **https://marynedey.github.io/recettes-app/** dans **Chrome**.
2. Menu **⋮ → Ajouter à l'écran d'accueil → Installer**.
3. Ouvrir l'app depuis l'icône, toucher ⚙️ (en haut à droite) :
   - Prénom (pour « Bonsoir … »),
   - coller le jeton,
   - dépôt : `marynedey/mes-recettes`,
   - **Enregistrer et tester** → « Connecté à marynedey/mes-recettes (privé) ».

## Utilisation

- **Ajouter une recette** : bouton **+ Ajouter**.
  - *Par lien* : coller l'adresse (Marmiton, 750g…). L'import prend environ une minute ; une bannière « Import en cours » s'affiche puis la recette apparaît.
  - *Depuis Chrome ou Marmiton* : **Partager → Mes Recettes** ouvre directement l'import.
  - *Saisie manuelle* : un ingrédient par ligne (quantité en premier : « 200 g farine »), une étape par ligne. Une ligne `### Pour la pâte` crée une sous-partie.
- **Mode cuisine** : une étape par écran, en gros. Les durées (« 12 min ») proposent un minuteur ; on peut balayer à gauche/droite pour changer d'étape. Autoriser les notifications pour être prévenue quand le minuteur sonne app en arrière-plan.
- **Hors ligne** : les recettes et photos déjà ouvertes restent consultables. Les modifications nécessitent une connexion.
- **PDF, captures, vidéos** : les donner à Claude dans une conversation pour qu'il les convertisse au format recette, puis les ajouter dans `mes-recettes/recettes/`.

## Si quelque chose ne marche pas

| Message | Solution |
|---|---|
| « Jeton refusé » | Jeton expiré ou mal copié : en recréer un (étape 2). |
| « Accès refusé » / « lecture seule » | Le jeton doit avoir **Contents : Read and write** sur `mes-recettes`. |
| « L'import n'a pas fonctionné » | Certains sites bloquent les robots : utiliser **Saisir**, le formulaire est pré-rempli avec le lien. |
| L'import reste « en cours » | Vérifier l'onglet **Actions** de `mes-recettes` (workflows activés, permissions en écriture). |
