# Serveur des minuteurs

Petit serveur gratuit (Cloudflare Workers) qui fait sonner la fin d'un minuteur
**même quand l'app est fermée**. Facultatif : sans lui, les minuteurs ne sonnent
que l'app ouverte.

## Ce qu'il fait

1. Quand un minuteur démarre, l'app lui dit : « préviens ce téléphone à 19 h 42 ».
   Pause, ±1 min, « Recommencer » : l'app met à jour ou annule.
2. À l'heure dite, il envoie une notification **vide** au téléphone (Web Push).
3. Le service worker de l'app la reçoit et retrouve lui-même quel minuteur est
   terminé (« Tarte tatin · étape 6 : c'est prêt ! »).

Il ne reçoit que l'adresse de notification du téléphone et l'heure de fin :
ni recettes, ni jeton GitHub. Tout est effacé après l'envoi.
Les clés VAPID sont créées par le serveur au premier appel et restent chez Cloudflare.

## Mise en place (une fois, ~10 min, tout se fait depuis le téléphone)

1. **Compte Cloudflare** : créer un compte gratuit sur https://dash.cloudflare.com/sign-up.
2. **Sous-domaine workers.dev** : dans le tableau de bord, ouvrir
   **Compute (Workers) → Workers & Pages** une première fois ; si Cloudflare le
   demande, choisir un sous-domaine (par ex. `maryne`).
3. **Identifiant du compte** : sur la page **Workers & Pages**, copier
   **Account ID** (colonne de droite, ou menu ⋮ à côté du nom du compte → *Copy account ID*).
4. **Jeton d'API** : icône du profil → **My Profile → API Tokens → Create Token**,
   modèle **Edit Cloudflare Workers** → *Use template* ; dans *Account Resources*
   choisir votre compte, dans *Zone Resources* « All zones » → *Continue to summary*
   → *Create Token* → copier le jeton (il ne s'affiche qu'une fois).
5. **Secrets GitHub** : dépôt `recettes-app` → **Settings → Secrets and variables →
   Actions → New repository secret**, deux fois :
   - `CLOUDFLARE_API_TOKEN` = le jeton de l'étape 4
   - `CLOUDFLARE_ACCOUNT_ID` = l'identifiant de l'étape 3
6. **Déployer** : onglet **Actions → Serveur des minuteurs → Run workflow**
   (il se relance ensuite tout seul à chaque changement dans `serveur/`).
   À la fin du journal de l'étape *Déployer*, noter l'adresse
   `https://mes-recettes-minuteurs.<sous-domaine>.workers.dev`.
7. **Dans l'app** : Réglages → *Minuteurs, app fermée* → coller l'adresse →
   **Enregistrer et tester**, puis fermer l'app : une notification
   « Minuteur terminé » arrive au bout de 10 secondes.

Coût : 0 €. L'offre gratuite (100 000 requêtes par jour) est très loin d'être atteinte.

## Fichiers

- `src/index.js` : routes (`GET /cle`, `PUT|DELETE /minuteurs/<id>`) et Durable Objects
  (`Minuteur` : un par minuteur, réveillé par son alarme ; `Cles` : clés VAPID).
- `src/webpush.js` : signature VAPID et envoi, avec WebCrypto seulement (testé par `npm test`).
- `wrangler.toml` : configuration ; `ORIGINES` = sites autorisés à l'appeler.

Essai en local : `npx wrangler dev` dans ce dossier.
