// Parcours complets dans Chromium (format téléphone), avec un faux GitHub.
// Le faux GitHub refuse toute requête sans le bon jeton, et garde en mémoire
// les fichiers écrits par l'app pour qu'on puisse vérifier leur contenu.
//
// Lancer : npm run test:navigateur

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';
import { chromium, devices } from 'playwright';

const RACINE = new URL('../../', import.meta.url).pathname;
const JETON = 'github_pat_TEST_0123456789abcdefghij';
const DEPOT = 'marynedey/mes-recettes';

/* ---------- serveur statique de l'app ---------- */

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
let serveur, BASE;

/* ---------- faux GitHub ---------- */

const sha = b => createHash('sha1').update(b).digest('hex');
// Petite image valide (PNG 2×2) pour simuler des photos.
const IMAGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
let fichiers;   // chemin → Buffer
let ecritures;  // [{ methode, chemin, message, contenu }]
let requetesSansJeton;
let droitEcriture;  // false : jeton en lecture seule

function depotInitial() {
  fichiers = new Map();
  const dir = join(RACINE, 'tests/fixtures');
  for (const f of readdirSync(dir)) fichiers.set(`recettes/${f}`, readFileSync(join(dir, f)));
  ecritures = [];
  requetesSansJeton = 0;
  droitEcriture = true;
}

async function fauxGitHub(route) {
  const req = route.request();
  const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (req.headers().authorization !== `Bearer ${JETON}`) { requetesSansJeton++; return json({ message: 'Bad credentials' }, 401); }
  const p = new URL(req.url()).pathname.replace(`/repos/${DEPOT}`, '');
  if (p === '') return json({ default_branch: 'main', full_name: DEPOT, private: true, permissions: { push: droitEcriture } });
  if (p.startsWith('/git/trees/')) return json({ tree: [...fichiers].map(([path, b]) => ({ path, type: 'blob', sha: sha(b) })) });
  if (p.startsWith('/git/blobs/')) {
    const b = [...fichiers.values()].find(v => sha(v) === p.split('/').pop());
    if (!b) return json({ message: 'Not Found' }, 404);
    if (req.headers().accept.includes('raw')) return route.fulfill({ status: 200, body: b, headers: { 'access-control-allow-origin': '*' } });
    return json({ content: b.toString('base64') });
  }
  if (p.startsWith('/contents/')) {
    const chemin = decodeURIComponent(p.slice('/contents/'.length));
    if (req.method() === 'GET') {
      const b = fichiers.get(chemin);
      return b ? json({ content: b.toString('base64'), sha: sha(b) }) : json({ message: 'Not Found' }, 404);
    }
    const corps = JSON.parse(req.postData() || '{}');
    if (req.method() === 'PUT') {
      const b = Buffer.from(corps.content, 'base64');
      fichiers.set(chemin, b);
      ecritures.push({ methode: 'PUT', chemin, message: corps.message, contenu: b.toString('utf8') });
      return json({ content: { sha: sha(b) } });
    }
    if (req.method() === 'DELETE') {
      fichiers.delete(chemin);
      ecritures.push({ methode: 'DELETE', chemin, message: corps.message });
      return json({});
    }
  }
  return json({ message: `Non simulé : ${p}` }, 404);
}

/* ---------- navigateur ---------- */

let navigateur, ctx, page, erreurs;

async function nouvellePage({ configure = true, horloge = false, avant = null } = {}) {
  ctx = await navigateur.newContext({ ...devices['Pixel 7'], locale: 'fr-FR', serviceWorkers: 'allow', permissions: ['notifications'] });
  await ctx.route('https://api.github.com/**', fauxGitHub);
  if (avant) await avant(ctx);
  page = await ctx.newPage();
  if (horloge) await page.clock.install(); // temps simulé : on avance de plusieurs minutes d'un coup
  erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  await page.goto(BASE);
  if (configure) {
    await page.evaluate(([jeton, depot]) => localStorage.setItem('mr.reglages', JSON.stringify({ prenom: 'Test', jeton, depot })), [JETON, DEPOT]);
    await page.reload();
    await page.locator('.carte').first().waitFor();
  }
}

const ongletActif = () => page.textContent('[role=tab][aria-selected=true]');
const etape = () => page.textContent('.etape-label');

async function glisser(selecteur, sens) {
  const zone = await page.locator(selecteur).boundingBox();
  const y = zone.y + Math.min(60, zone.height / 2);
  const [x1, x2] = sens === 'gauche' ? [330, 80] : [80, 330];
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] });
  for (let k = 1; k <= 5; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * k / 5, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700); // le défilement natif s'aimante sur l'onglet
}

before(async () => {
  serveur = createServer((req, res) => {
    let chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (chemin.endsWith('/')) chemin += 'index.html';
    const f = join(RACINE, chemin);
    if (!f.startsWith(RACINE) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
    res.end(readFileSync(f));
  });
  await new Promise(ok => serveur.listen(0, ok));
  BASE = `http://localhost:${serveur.address().port}/`;
  // Chromium complet (et non la version « headless shell ») : il gère les notifications.
  navigateur = await chromium.launch({ channel: 'chromium' });
});

after(async () => {
  await navigateur?.close();
  serveur?.close();
});

/* ---------- parcours ---------- */

test('réglages : le jeton est envoyé et la connexion réussit', async () => {
  depotInitial();
  await nouvellePage({ configure: false });
  await page.goto(BASE + '#/reglages');
  await page.fill('[name=jeton]', `  ${JETON}\n`);
  await page.click('#tester');
  await page.locator('#etat.ok').waitFor();
  assert.match(await page.textContent('#etat'), /Connecté à marynedey\/mes-recettes/);
  assert.equal(requetesSansJeton, 0, 'aucune requête ne doit partir sans le jeton');

  await page.fill('[name=jeton]', 'MonMotDePasse');
  await page.click('#tester');
  assert.match(await page.textContent('#etat'), /pas un jeton GitHub/);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('accueil : liste, recherche et filtres', async () => {
  depotInitial();
  await nouvellePage();
  assert.equal(await page.locator('#resultats .carte').count(), 3);
  await page.fill('input[type=search]', 'champignon');
  assert.equal(await page.locator('#resultats .carte').count(), 1, 'la recherche porte aussi sur les ingrédients');
  await page.fill('input[type=search]', '');
  await page.click('.puce[data-cat=Desserts]');
  assert.equal(await page.locator('#resultats .carte').count(), 2);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('fiche : portions recalculées, « à ajuster », glisser entre onglets', async () => {
  depotInitial();
  fichiers.set('recettes/crepes.md', Buffer.from('---\ntitre: Crêpes\ncategorie: Desserts\nportions: 4\n---\n## Ingrédients\n- 250 g farine\n- Lait : 50 cL\n\n## Étapes\n1. Mélanger.\n'));
  await nouvellePage();
  await page.goto(BASE + '#/recette/crepes');
  assert.equal(await page.textContent('.surtitre'), 'Desserts', 'seule la catégorie au-dessus du titre');
  assert.equal(await page.locator('.ajuster').count(), 0);
  await page.click('#plus'); await page.click('#plus');
  assert.equal(await page.textContent('#nb'), '6');
  assert.equal(await page.locator('.ingredient .qte').first().textContent(), '375 g');
  assert.ok(await page.locator('.ingredient .ajuster').count() === 1, '« Lait : 50 cL » est signalé à ajuster');

  assert.equal(await ongletActif(), 'Ingrédients');
  await glisser('.fiche-feuille h1', 'gauche');
  assert.equal(await ongletActif(), 'Ingrédients', 'glisser sur le titre ne change pas d\'onglet');
  await glisser('#piste', 'gauche');
  assert.equal(await ongletActif(), 'Étapes');
  await glisser('#piste', 'gauche');
  assert.equal(await ongletActif(), 'Notes');
  await glisser('#piste', 'droite');
  assert.equal(await ongletActif(), 'Étapes');
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('mode cuisine : étapes, retour = étape précédente, minuteur, ingrédients de l\'étape', async () => {
  depotInitial();
  await nouvellePage();
  await page.click('text=Cinnamon rolls');
  await page.click('#cuisiner');
  assert.match(await etape(), /Étape 1\s*sur 18/);
  await page.click('#suiv');
  assert.deepEqual(await page.locator('.puces-ing span').allTextContents(),
    ['8 g levure boulangère', '1 c. à soupe sucre (pour la levure)', '1 c. à soupe farine (pour la levure)'],
    'la quantité citée choisit le bon sucre et la bonne farine');
  await page.click('#suiv'); await page.click('#suiv');
  assert.match(await etape(), /Étape 4/);
  await page.goBack();
  assert.match(await etape(), /Étape 3/);
  await page.click('#prec');
  assert.match(await etape(), /Étape 2/);
  await page.goBack(); await page.goBack();
  await page.locator('.fiche-feuille').waitFor();
  assert.match(page.url(), /#\/recette\/cinnamon-rolls/, 'retour depuis l\'étape 1 = fiche');

  await page.click('#cuisiner');
  for (let k = 0; k < 6; k++) await page.click('#suiv');
  assert.equal(await page.textContent('#t-bloc'), '1:00:00');
  await page.click('#m-lecture');
  await page.waitForTimeout(1300);
  assert.match(await page.textContent('#t-bloc'), /^59:5\d$/);
  await page.click('#m-plus');
  assert.match(await page.textContent('#t-bloc'), /^1:00:5\d$/);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('ajout manuel : le fichier écrit dans le dépôt est au bon format', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '#/ajouter?manuel=1');
  await page.fill('[name=titre]', 'Crêpes de test');
  await page.fill('[name=preparation]', '10');
  await page.fill('[name=repos]', '60');
  await page.fill('[name=ingredients]', '### Pâte\n250 g farine\nFarine : 2 g');
  assert.match(await page.textContent('#verif-ing'), /Farine : 2 g/, 'la ligne non recalculée est signalée');
  await page.fill('[name=ingredients]', '### Pâte\n250 g farine\nune pincée de sel');
  assert.ok(await page.locator('#verif-ing').isHidden());
  await page.fill('[name=etapes]', 'Mélanger.\nLaisser reposer 1 h.');
  await page.click('#enreg');
  await page.waitForURL(/#\/recette\/crepes-de-test/);
  const e = ecritures.find(w => w.chemin === 'recettes/crepes-de-test.md');
  assert.ok(e, 'recettes/crepes-de-test.md écrit');
  assert.match(e.contenu, /^---\ntitre: Crêpes de test\n/);
  assert.match(e.contenu, /\nrepos: 60\n/);
  assert.match(e.contenu, /## Ingrédients\n\n### Pâte\n- 250 g farine\n- une pincée de sel\n/);
  assert.match(e.contenu, /## Étapes\n1\. Mélanger\.\n2\. Laisser reposer 1 h\.\n/);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('import par lien : la demande est déposée dans import/a-traiter', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '#/ajouter');
  await page.fill('[name=url]', 'https://www.marmiton.org/recettes/recette_test.aspx');
  await page.click('#go');
  await page.locator('.banniere .spinner').waitFor();
  const e = ecritures.find(w => w.chemin.startsWith('import/a-traiter/'));
  assert.ok(e, 'demande d\'import écrite');
  assert.equal(JSON.parse(e.contenu).url, 'https://www.marmiton.org/recettes/recette_test.aspx');
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('hors ligne : l\'app et les recettes restent consultables', async () => {
  depotInitial();
  await nouvellePage();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.locator('.carte').first().waitFor();
  await ctx.setOffline(true);
  await page.reload();
  await page.locator('.carte').first().waitFor();
  await page.click('text=Tarte tatin');
  await page.locator('.fiche-feuille h1').waitFor();
  assert.equal(await page.textContent('.fiche-feuille h1'), 'Tarte tatin');
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('aucun écran ne déborde en largeur, même avec le texte agrandi (réglage Android)', async () => {
  depotInitial();
  await nouvellePage();
  // Des courses prévues, pour que l'écran Courses ait une liste à afficher.
  await page.evaluate(() => localStorage.setItem('mr.courses', JSON.stringify({ prevues: [{ slug: 'cinnamon-rolls', portions: 12 }, { slug: 'risotto-aux-champignons', portions: 4 }], articles: {} })));
  const ecrans = ['#/', '#/recettes', '#/recette/cinnamon-rolls', '#/cuisine/cinnamon-rolls', '#/modifier/cinnamon-rolls', '#/ajouter', '#/ajouter?manuel=1', '#/reglages', '#/courses'];
  for (const ecran of ecrans) {
    await page.goto(BASE + ecran);
    await page.reload(); // repart de tailles de police normales
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
    const depassent = await page.evaluate(() => {
      // Comme la « taille du texte » d'Android : toutes les polices × 1,3.
      const els = [...document.querySelectorAll('body, body *')];
      const tailles = els.map(e => parseFloat(getComputedStyle(e).fontSize));
      els.forEach((e, i) => { e.style.fontSize = `${tailles[i] * 1.3}px`; });
      const largeur = document.documentElement.clientWidth;
      // Dans les zones qui défilent horizontalement (onglets, carrousel), les panneaux
      // hors champ sont à droite par construction : seul le panneau affiché compte.
      const horsChamp = e => {
        const zone = e.closest('.onglets-piste, .carrousel, .v-defile');
        if (!zone) return false;
        const panneau = [...zone.children].find(c => c.contains(e));
        return panneau && panneau.getBoundingClientRect().left >= zone.getBoundingClientRect().right - 1;
      };
      return els.filter(e => e.getBoundingClientRect().right > largeur + 1 && !horsChamp(e))
        .map(e => `${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(' ').join('.') : ''}`);
    });
    assert.deepEqual(depassent, [], `${ecran} : éléments plus larges que l'écran`);
  }
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('photos : plusieurs photos, carrousel, photo principale et retrait', async () => {
  depotInitial();
  fichiers.set('recettes/gateau.md', Buffer.from('---\ntitre: Gâteau\ncategorie: Desserts\nportions: 4\nphotos: [photos/gateau.jpg, photos/gateau-2.jpg]\n---\n## Ingrédients\n- 200 g farine\n\n## Étapes\n1. Cuire.\n'));
  fichiers.set('photos/gateau.jpg', IMAGE);
  fichiers.set('photos/gateau-2.jpg', Buffer.concat([IMAGE, Buffer.from([0])]));
  // Au démarrage, plusieurs photos se chargent en même temps (ici deux recettes
  // qui partagent la même photo) avant la fin de la synchronisation.
  fichiers.set('recettes/cake.md', Buffer.from('---\ntitre: Cake\ncategorie: Desserts\nphotos: [photos/gateau.jpg]\n---\n## Ingrédients\n- 1 œuf\n\n## Étapes\n1. Cuire.\n'));
  await nouvellePage();

  await page.locator('.visuel.a-photo').nth(1).waitFor();
  assert.deepEqual(erreurs, [], 'chargement simultané de plusieurs photos');

  await page.goto(BASE + '#/recette/gateau');
  await page.locator('.diapo img').nth(1).waitFor({ state: 'attached' });
  assert.equal(await page.locator('.diapo').count(), 2);
  assert.equal(await page.locator('.points span').count(), 2);

  // Toucher la photo l'agrandit ; on glisse à la suivante ; le retour Android ferme sans quitter la fiche.
  await page.click('.fiche-hero', { position: { x: 200, y: 150 } });
  await page.locator('.visionneuse .v-photo img').nth(1).waitFor({ state: 'attached' });
  assert.equal(await page.textContent('.v-compteur'), '1 / 2');
  await page.evaluate(() => { const d = document.querySelector('.v-defile'); d.scrollLeft = d.clientWidth; });
  await page.waitForTimeout(200);
  assert.equal(await page.textContent('.v-compteur'), '2 / 2');
  await page.goBack();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.visionneuse').count(), 0);
  assert.match(page.url(), /#\/recette\/gateau$/);
  await page.click('.fiche-hero #fav');
  assert.equal(await page.locator('.visionneuse').count(), 0, 'les boutons sur la photo n\'ouvrent pas la visionneuse');

  // Ajout d'une recette avec deux photos choisies d'un coup dans la galerie.
  await page.goto(BASE + '#/ajouter?manuel=1');
  await page.fill('[name=titre]', 'Tarte');
  await page.setInputFiles('#f-galerie', [
    { name: 'a.png', mimeType: 'image/png', buffer: IMAGE },
    { name: 'b.png', mimeType: 'image/png', buffer: IMAGE },
  ]);
  await page.locator('.vignette-photo').nth(1).waitFor();
  assert.equal(await page.locator('.vp-principale').count(), 1);
  await page.click('#enreg');
  await page.waitForURL(/#\/recette\/tarte/);
  const chemins = ecritures.filter(w => w.methode === 'PUT').map(w => w.chemin);
  assert.deepEqual(chemins, ['photos/tarte.jpg', 'photos/tarte-2.jpg', 'recettes/tarte.md']);
  assert.match(ecritures.at(-1).contenu, /\nphotos: \[photos\/tarte\.jpg, photos\/tarte-2\.jpg\]\n/);

  // Modification : la 2e photo devient principale, la 1re est retirée puis supprimée du dépôt.
  ecritures.length = 0;
  await page.goto(BASE + '#/modifier/gateau');
  await page.locator('.vignette-photo').nth(1).waitFor();
  await page.locator('.vp-image').nth(1).click();
  await page.locator('.vp-retirer').nth(1).click();
  assert.equal(await page.locator('.vignette-photo').count(), 1);
  await page.click('#enreg');
  await page.waitForURL(/#\/recette\/gateau/);
  const md = ecritures.find(w => w.chemin === 'recettes/gateau.md');
  assert.match(md.contenu, /\nphotos: \[photos\/gateau-2\.jpg\]\n/);
  assert.ok(!/\nphoto:/.test(md.contenu));
  await page.waitForTimeout(300);
  assert.deepEqual(ecritures.filter(w => w.methode === 'DELETE').map(w => w.chemin), ['photos/gateau.jpg']);
  assert.ok(ecritures.findIndex(w => w.chemin === 'recettes/gateau.md') < ecritures.findIndex(w => w.methode === 'DELETE'), 'la photo est supprimée après l\'enregistrement de la recette');
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('minuteurs : plusieurs à la fois, bandeau, notifications fidèles, fin de recette', async () => {
  depotInitial();
  await nouvellePage({ horloge: true });
  const notifications = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications())
    .map(n => ({ tag: n.tag, titre: n.title, texte: n.body, badge: n.badge })));
  await page.goto(BASE + '#/cuisine/tarte-tatin');
  await page.evaluate(() => navigator.serviceWorker.ready);

  // Étape 1 : « réserver au frais 30 min ». Dès le lancement, il apparaît dans le bandeau.
  assert.equal(await page.textContent('#t-bloc'), '30:00');
  await page.click('#m-lecture');
  assert.match(await page.locator('.minuteur-mini.ici').textContent(), /Cette étape.*30:00|Cette étape.*29:5\d/s);

  // Étape 6 : « cuire … 12 min », lancé alors que celui de l'étape 1 tourne encore.
  for (let k = 0; k < 5; k++) await page.click('#suiv');
  assert.match(await etape(), /Étape 6/);
  assert.equal(await page.textContent('#t-bloc'), '12:00', 'le minuteur de l\'étape 6 part de sa propre durée');
  await page.click('#m-lecture');
  await page.clock.fastForward('00:05');
  assert.match(await page.textContent('#t-bloc'), /^11:5\d$/);
  const autre = page.locator('.minuteur-mini:not(.ici)');
  assert.equal(await autre.count(), 1);
  assert.match(await autre.textContent(), /Étape 1.*29:5\d/s);
  assert.equal(await page.locator('.minuteur-mini.ici').count(), 1);

  // Les boutons Précédente / Suivante restent à l'écran même en bas d'une longue page.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const suiv = await page.locator('#suiv').boundingBox();
  assert.ok(suiv.y + suiv.height <= page.viewportSize().height, 'bouton Suivante visible');

  // 12 min plus tard : seul celui de l'étape 6 est terminé.
  await page.clock.fastForward('12:00');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('#lib'), /Terminé/);
  assert.match(await autre.textContent(), /Étape 1.*17:5\d/s);

  // Notifications : texte exact sans mise à jour (heure de fin), pastille chronomètre, lien vers l'étape.
  const notifs = await notifications();
  assert.equal(notifs.length, 2, JSON.stringify(notifs));
  const n6 = notifs.find(n => n.tag === 'tarte-tatin|5|0');
  const n1 = notifs.find(n => n.tag === 'tarte-tatin|0|0');
  assert.match(n6.titre, /étape 6 : c'est prêt/);
  assert.match(n1.titre, /étape 1 · prêt à \d\d:\d\d/);
  assert.match(n1.badge, /badge-minuteur\.png$/);

  // Toucher une notification ouvre l'étape concernée (le service worker envoie « #/cuisine/…?e=0 »).
  await page.goto(BASE + '#/');
  await page.goto(BASE + '#/cuisine/tarte-tatin?e=0');
  assert.match(await etape(), /Étape 1/);
  assert.match(page.url(), /#\/cuisine\/tarte-tatin$/, '?e= retiré de l\'adresse');
  assert.match(await page.textContent('#t-bloc'), /^17:5\d$/);

  // Il survit à un rechargement de l'app.
  await page.reload();
  await page.locator('#t-bloc').waitFor();
  assert.match(await page.textContent('#t-bloc'), /^17:5\d$/);

  // Terminer la recette avec un minuteur en cours : confirmation, puis tout est effacé.
  let question = '';
  page.once('dialog', d => { question = d.message(); d.dismiss(); });
  for (let k = 0; k < 9; k++) await page.click('#suiv');
  assert.match(question, /Un minuteur est encore en cours/);
  assert.match(page.url(), /#\/cuisine\//, 'annuler reste en mode cuisine');
  page.once('dialog', d => d.accept());
  await page.click('#suiv');
  await page.waitForURL(u => !/#\/cuisine\//.test(u)); // retour à la page d'avant le mode cuisine
  await page.waitForTimeout(300);
  assert.deepEqual(await notifications(), [], 'plus aucune notification après la fin de la recette');
  assert.equal(await page.evaluate(() => localStorage.getItem('mr.minuteurs')), '{}');
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('courses : recettes prévues, liste additionnée par rayon, cases et « j\'en ai déjà »', async () => {
  depotInitial();
  await nouvellePage();
  const article = nom => page.locator('.article', { has: page.locator('.art-nom', { hasText: new RegExp(`^${nom}$`) }) });

  // Depuis une fiche : la recette part aux courses avec le nombre de personnes affiché.
  await page.goto(BASE + '#/recette/tarte-tatin');
  await page.click('#plus'); await page.click('#plus');
  await page.click('#aux-courses');
  await page.goto(BASE + '#/courses');
  assert.match(await page.locator('.prevue').textContent(), /Tarte tatin.*8.*pers/s);

  // Depuis l'onglet Courses : choix dans la liste des recettes.
  await page.click('#ajouter-recettes');
  await page.click('.f-recette:has-text("Cinnamon rolls")');
  await page.click('#f-fermer');
  assert.equal(await page.locator('.prevue').count(), 2);

  // Farine : 200 g × 8/6 (tatin) + 540 g et 1 c. à soupe (cinnamon rolls).
  assert.match(await article('Farine').locator('.art-qte').textContent(), /^806,7 g \+ 1 c\. à soupe/);
  assert.equal(await page.locator('h3.rayon').first().textContent(), 'Fruits et légumes');

  // « J'en ai déjà » : 500 g de farine → il manque 306,7 g.
  await article('Farine').locator('.art-corps').click();
  assert.match(await article('Farine').locator('.art-detail').textContent(), /Tarte tatin.*Cinnamon rolls/s);
  await article('Farine').locator('.art-dispo input').fill('500');
  await article('Farine').locator('.art-dispo input').press('Enter');
  await page.locator('.art-dispo input').blur();
  assert.match(await article('Farine').locator('.art-qte small').textContent(), /il manque 306,7 g/);

  // Cocher : l'article passe en bas, barré ; tout survit à un rechargement.
  await article('Lait').locator('.art-case').click();
  assert.match(await article('Lait').getAttribute('class'), /fait/);
  await page.reload();
  await page.locator('.article').first().waitFor();
  assert.match(await article('Lait').getAttribute('class'), /fait/);
  assert.match(await article('Farine').locator('.art-qte small').textContent(), /il manque 306,7 g/);

  // Changer le nombre de personnes recalcule ; retirer une recette l'enlève de la liste.
  await page.locator('.prevue', { hasText: 'Tarte tatin' }).locator('[data-d="-1"]').click();
  assert.match(await article('Farine').locator('.art-qte').textContent(), /^773,4 g/);
  await page.locator('.prevue', { hasText: 'Cinnamon rolls' }).locator('.pv-retirer').click();
  assert.equal(await article('Lait').count(), 0);
  assert.match(await article('Farine').locator('.art-qte').textContent(), /^233,4 g$|^233,4 g/);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

/* ---------- autres écrans et cas particuliers ---------- */

const titresAccueil = () => page.locator('#resultats .carte h3').allTextContents();

test('accueil : tri (A → Z, plus rapides, plus récentes, plus anciennes) retenu, sans « Cuisinées récemment »', async () => {
  depotInitial();
  fichiers.set('recettes/crepes.md', Buffer.from('---\ntitre: Crêpes\ncategorie: Desserts\najoutee: 2026-10-23\n---\n## Ingrédients\n- 250 g farine\n\n## Étapes\n1. Mélanger.\n'));
  fichiers.set('recettes/salade.md', Buffer.from('---\ntitre: Salade\ncategorie: Entrées\npreparation: 10\najoutee: 2025-01-05\n---\n## Ingrédients\n- 1 salade\n\n## Étapes\n1. Laver.\n'));
  await nouvellePage();
  await page.evaluate(() => localStorage.setItem('mr.historique', JSON.stringify(['tarte-tatin'])));
  await page.reload();
  await page.locator('#resultats .carte').nth(4).waitFor();
  assert.equal(await page.locator('text=Cuisinées récemment').count(), 0);

  assert.deepEqual(await titresAccueil(), ['Cinnamon rolls', 'Crêpes', 'Risotto aux champignons', 'Salade', 'Tarte tatin'], 'A → Z par défaut');
  await page.selectOption('#tri', 'rapide');
  assert.deepEqual(await titresAccueil(), ['Salade', 'Risotto aux champignons', 'Tarte tatin', 'Cinnamon rolls', 'Crêpes'], 'durée inconnue en dernier');
  await page.selectOption('#tri', 'recente');
  assert.deepEqual(await titresAccueil(), ['Crêpes', 'Cinnamon rolls', 'Risotto aux champignons', 'Tarte tatin', 'Salade']);
  await page.selectOption('#tri', 'ancienne');
  assert.deepEqual(await titresAccueil(), ['Salade', 'Cinnamon rolls', 'Risotto aux champignons', 'Tarte tatin', 'Crêpes']);

  // Le choix est retenu, et se combine avec les filtres.
  await page.reload();
  await page.locator('#resultats .carte').nth(4).waitFor();
  assert.equal(await page.inputValue('#tri'), 'ancienne');
  await page.click('.puce[data-cat=Desserts]');
  assert.deepEqual(await titresAccueil(), ['Cinnamon rolls', 'Tarte tatin', 'Crêpes']);
  await page.fill('input[type=search]', 'zzz');
  assert.match(await page.textContent('#resultats'), /Rien ne correspond à « zzz »/);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('onglets Recettes et Favoris', async () => {
  depotInitial();
  await nouvellePage();
  await page.click('.tabbar a[href="#/recettes"]');
  await page.locator('.lettre').nth(2).waitFor();
  assert.deepEqual(await page.locator('.lettre').allTextContents(), ['C', 'R', 'T']);
  await page.fill('input[type=search]', 'pommes');
  assert.deepEqual(await page.locator('.ligne-recette h3').allTextContents(), ['Tarte tatin']);

  await page.click('.tabbar a[href="#/favoris"]');
  await page.locator('.vide').waitFor();
  assert.match(await page.textContent('.vide'), /Pas encore de favoris/);
  await page.goto(BASE + '#/recette/risotto-aux-champignons');
  await page.click('#fav');
  assert.equal(await page.getAttribute('#fav', 'aria-pressed'), 'true');
  await page.goto(BASE + '#/favoris');
  await page.locator('.carte').waitFor();
  assert.deepEqual(await page.locator('.carte h3').allTextContents(), ['Risotto aux champignons']);
  await page.click('.carte');
  await page.click('#fav');
  await page.goto(BASE + '#/favoris');
  await page.locator('.vide').waitFor();
  assert.equal(await page.locator('.carte').count(), 0, 'retirée des favoris');
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('courses : « Voir la liste » après l\'ajout, articles ajoutés à la main', async () => {
  depotInitial();
  await nouvellePage();
  const article = nom => page.locator('.article', { has: page.locator('.art-nom', { hasText: new RegExp(`^${nom}$`) }) });

  // Liste vide : on peut quand même ajouter des articles, sans aucune recette.
  await page.goto(BASE + '#/courses');
  await page.fill('#ajout-article input', '2 citrons');
  await page.press('#ajout-article input', 'Enter');
  await page.fill('#ajout-article input', 'papier cuisson');
  await page.click('#ajout-article button');
  await page.fill('#ajout-article input', '   ');
  await page.press('#ajout-article input', 'Enter');
  assert.equal(await page.locator('.article').count(), 2, 'une ligne vide n\'ajoute rien');
  assert.equal(await page.evaluate(() => document.activeElement.name), 'texte', 'le champ reste prêt pour l\'article suivant');
  assert.equal(await article('Citrons').locator('.art-qte').textContent(), '2');
  assert.equal(await article('Papier cuisson').locator('.art-qte').textContent(), 'à vérifier');

  // Depuis une fiche : le message propose d'ouvrir la liste.
  await page.goto(BASE + '#/recette/tarte-tatin');
  await page.click('#aux-courses');
  await page.locator('.toast.visible .toast-action').waitFor();
  assert.match(await page.textContent('.toast'), /Ajoutée aux courses \(6 pers\.\)/);
  await page.click('.toast-action');
  await page.waitForURL(/#\/courses$/);
  assert.match(await page.locator('.prevue').textContent(), /Tarte tatin/);

  // Les articles à la main restent, à côté de ceux des recettes ; on peut les retirer un par un.
  assert.equal(await article('Citrons').count(), 1);
  await article('Papier cuisson').locator('.art-corps').click();
  assert.match(await article('Papier cuisson').locator('.art-detail').textContent(), /Ajouté à la main/);
  await article('Papier cuisson').locator('[data-ajout]').click();
  assert.equal(await article('Papier cuisson').count(), 0);
  await page.reload();
  await page.locator('.article').first().waitFor();
  assert.equal(await article('Citrons').count(), 1, 'gardé après rechargement');

  // Partage : uniquement ce qu'il reste à acheter.
  await article('Citrons').locator('.art-case').click();
  await page.evaluate(() => { delete Navigator.prototype.share; navigator.clipboard.writeText = t => { window.copie = t; return Promise.resolve(); }; });
  await page.click('#partager');
  await page.waitForFunction(() => window.copie);
  const copie = await page.evaluate(() => window.copie);
  assert.match(copie, /^Liste de courses\n/);
  assert.match(copie, /- Farine : 200 g/);
  assert.ok(!/Citrons/.test(copie), 'les articles cochés ne sont pas partagés');

  // Glisser un article le retire, avec « Annuler » quelques secondes.
  const glisserArticle = async (nom, sens = 'gauche') => {
    await article(nom).scrollIntoViewIfNeeded();
    const zone = await article(nom).locator('.art-ligne').boundingBox();
    const y = zone.y + zone.height / 2;
    const [x1, x2] = sens === 'gauche' ? [330, 60] : [60, 330];
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] });
    for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * k / 6, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
  };
  await glisserArticle('Sucre');
  assert.equal(await article('Sucre').count(), 0);
  assert.match(await page.textContent('.toast'), /« Sucre » retiré de la liste/);
  await page.click('.toast button.toast-action');
  assert.equal(await article('Sucre').count(), 1, 'annuler le remet');
  assert.doesNotMatch(await article('Sucre').getAttribute('class'), /fait|ouvert/, 'le glissement ne coche ni ne déplie');
  await glisserArticle('Sucre', 'droite');
  await page.reload();
  await page.locator('.article').first().waitFor();
  assert.equal(await article('Sucre').count(), 0, 'reste retiré après rechargement');
  // Plus de personnes : il en faut davantage, il revient.
  await page.locator('.prevue', { hasText: 'Tarte tatin' }).locator('[data-d="1"]').click();
  assert.equal(await article('Sucre').count(), 1);
  // Un petit mouvement ne retire rien.
  const avant = await page.locator('.article').count();
  await article('Beurre').scrollIntoViewIfNeeded();
  const zone = await article('Beurre').locator('.art-ligne').boundingBox();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: zone.y + 20 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 260, y: zone.y + 20 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.article').count(), avant);

  // Vider : on confirme, tout part (recettes et articles à la main).
  page.once('dialog', d => d.accept());
  await page.click('#vider');
  assert.equal(await page.locator('.article').count(), 0);
  assert.equal(await page.locator('.prevue').count(), 0);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('mode cuisine : recommencer, messages au pluriel, retour après « Terminé »', async () => {
  depotInitial();
  await nouvellePage({ horloge: true });
  await page.click('text=Tarte tatin');
  await page.click('#cuisiner');
  await page.click('#m-lecture'); // étape 1 : 30 min
  for (let k = 0; k < 5; k++) await page.click('#suiv');
  await page.click('#m-lecture'); // étape 6 : 12 min
  await page.click('#suiv');
  assert.match(await etape(), /Étape 7/);

  // En revenant plus tard, on retrouve l'étape et les minuteurs…
  await page.click('#fermer');
  await page.locator('.fiche-feuille').waitFor();
  await page.click('#cuisiner');
  assert.match(await etape(), /Étape 7/);
  assert.equal(await page.locator('.minuteur-mini').count(), 2);

  // … sauf si on recommence (après confirmation).
  page.once('dialog', d => d.dismiss());
  await page.click('#recommencer');
  assert.match(await etape(), /Étape 7/, 'annuler ne change rien');
  page.once('dialog', d => d.accept());
  await page.click('#recommencer');
  await page.waitForTimeout(300);
  assert.match(await etape(), /Étape 1/);
  assert.equal(await page.locator('.minuteur-mini').count(), 0);
  assert.equal(await page.textContent('#t-bloc'), '30:00', 'minuteur remis à zéro');
  assert.match(await page.textContent('.toast'), /Recette recommencée/);
  await page.goBack();
  await page.locator('.fiche-feuille').waitFor();
  assert.match(page.url(), /#\/recette\/tarte-tatin$/, 'l\'étape 1 est bien la première de l\'historique');

  // Deux minuteurs en cours à la fin : « les arrêter », avec un espace.
  await page.click('#cuisiner');
  await page.click('#m-lecture');
  for (let k = 0; k < 5; k++) await page.click('#suiv');
  await page.click('#m-lecture');
  let question = '';
  page.once('dialog', d => { question = d.message(); d.accept(); });
  for (let k = 0; k < 4; k++) await page.click('#suiv');
  assert.equal(question, '2 minuteurs sont encore en cours. Terminer la recette et les arrêter ?');

  // Après « Terminé » on est sur la fiche ; « retour » mène à l'accueil, pas au mode cuisine.
  await page.waitForURL(/#\/recette\/tarte-tatin$/);
  await page.locator('.fiche-feuille').waitFor();
  await page.goBack();
  await page.waitForTimeout(300);
  assert.match(page.url(), /\/(#\/)?$/);
  assert.equal(await page.locator('.cuisine-corps').count(), 0);
  assert.ok(await page.locator('.grand-titre').isVisible());

  // Mode cuisine ouvert directement (notification, app fermée) : « Terminé » mène à la fiche,
  // et « retour » depuis la fiche à l'accueil, jamais de nouveau au mode cuisine.
  const autre = await ctx.newPage();
  autre.on('pageerror', e => erreurs.push(e.message));
  await autre.goto(BASE + '#/cuisine/tarte-tatin');
  await autre.locator('.etape-label').waitFor();
  // Dans l'app ouverte par une notification, le mode cuisine est la toute première page ;
  // ici un onglet neuf commence par about:blank, qu'on rend inaccessible.
  await autre.evaluate(() => { const go = history.go.bind(history); history.go = n => { if (-n < history.length - 1) go(n); }; });
  for (let k = 0; k < 9; k++) await autre.click('#suiv');
  await autre.waitForURL(/#\/recette\/tarte-tatin$/);
  await autre.locator('.fiche-feuille').waitFor();
  await autre.click('.fiche-hero #retour, .retour-tete #retour');
  await autre.waitForTimeout(400);
  assert.equal(await autre.locator('.cuisine-corps').count(), 0, 'pas de retour au mode cuisine');
  assert.ok(await autre.locator('.grand-titre').isVisible());
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('mode cuisine : notification touchée alors que le mode cuisine est déjà ouvert', async () => {
  depotInitial();
  await nouvellePage();
  await page.click('text=Tarte tatin');
  await page.click('#cuisiner');
  for (let k = 0; k < 5; k++) await page.click('#suiv');
  assert.match(await etape(), /Étape 6/);
  const longueur = await page.evaluate(() => history.length);
  // Ce que fait le service worker quand on touche la notification du minuteur de l'étape 1.
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { aller: '#/cuisine/tarte-tatin?e=0' } })));
  await page.waitForTimeout(300);
  assert.match(await etape(), /Étape 1/);
  assert.match(page.url(), /#\/cuisine\/tarte-tatin(\?p=6)?$/);
  assert.ok(await page.evaluate(() => history.length) <= longueur, 'pas de second historique empilé');
  await page.click('#suiv');
  assert.match(await etape(), /Étape 2/);
  await page.goBack(); await page.goBack();
  await page.locator('.fiche-feuille').waitFor();
  assert.match(page.url(), /#\/recette\/tarte-tatin$/);

  // Depuis un autre écran, la notification ouvre le mode cuisine à la bonne étape.
  await page.goto(BASE + '#/');
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { aller: '#/cuisine/tarte-tatin?e=5' } })));
  await page.locator('.etape-label').waitFor();
  assert.match(await etape(), /Étape 6/);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('nouvelle recette : glisser entre « Par lien » et « Saisie manuelle »', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '#/ajouter');
  await page.locator('#f-lien').waitFor();
  assert.equal(await ongletActif(), 'Par lien');
  assert.ok(await page.locator('.barre-bas').isHidden(), 'pas de barre Enregistrer sur l\'import par lien');

  await glisser('#piste', 'gauche');
  assert.equal(await ongletActif(), 'Saisie manuelle');
  assert.ok(await page.locator('.barre-bas').isVisible());
  await page.fill('[name=titre]', 'Brouillon');
  await glisser('#piste', 'droite');
  assert.equal(await ongletActif(), 'Par lien');
  assert.ok(await page.locator('.barre-bas').isHidden());

  // Les onglets se touchent aussi ; la saisie n'est pas perdue en passant de l'un à l'autre.
  await page.click('[role=tab][data-o=manuel]');
  await page.waitForTimeout(600);
  assert.equal(await ongletActif(), 'Saisie manuelle');
  assert.equal(await page.inputValue('[name=titre]'), 'Brouillon');

  // Le titre est obligatoire.
  await page.fill('[name=titre]', '');
  await page.click('#enreg');
  assert.match(await page.textContent('.toast'), /titre est obligatoire/);
  assert.equal(ecritures.length, 0);

  // Adresse invalide refusée sans rien écrire.
  await page.click('[role=tab][data-o=lien]');
  await page.waitForTimeout(600);
  await page.fill('[name=url]', 'pas une adresse');
  await page.click('#go');
  assert.equal(ecritures.length, 0);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('modifier puis supprimer une recette', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '#/recette/risotto-aux-champignons');
  await page.click('.actions a[aria-label=Modifier]');
  await page.locator('#form').waitFor();
  assert.equal(await page.inputValue('[name=titre]'), 'Risotto aux champignons');
  await page.fill('[name=portions]', '2');
  await page.click('#enreg');
  await page.waitForURL(/#\/recette\/risotto-aux-champignons$/);
  const md = ecritures.find(w => w.chemin === 'recettes/risotto-aux-champignons.md');
  assert.match(md.contenu, /\nportions: 2\n/);
  await page.locator('.fiche-feuille h1').waitFor();
  await page.click('[role=tab][data-o=notes]');
  page.once('dialog', d => d.accept());
  await page.click('#suppr');
  await page.waitForURL(/#\/$/);
  assert.ok(ecritures.some(w => w.methode === 'DELETE' && w.chemin === 'recettes/risotto-aux-champignons.md'));
  await page.locator('#resultats .carte').first().waitFor();
  assert.ok(!(await titresAccueil()).includes('Risotto aux champignons'));
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('import par lien : résultat réussi, puis échec avec formulaire pré-rempli', async () => {
  depotInitial();
  await nouvellePage({ horloge: true });
  const attendre = async (id, resultat) => {
    fichiers.set(`import/resultats/${id}.json`, Buffer.from(JSON.stringify(resultat)));
    await page.evaluate(id => {
      localStorage.setItem('mr.imports', JSON.stringify([{ id, url: 'https://exemple.fr/r', depuis: Date.now() }]));
      window.dispatchEvent(new Event('mr:imports'));
    }, id);
  };

  fichiers.set('recettes/gaufres.md', Buffer.from('---\ntitre: Gaufres\ncategorie: Desserts\n---\n## Ingrédients\n- 250 g farine\n\n## Étapes\n1. Cuire.\n'));
  await attendre('a1', { statut: 'ok', slug: 'gaufres', titre: 'Gaufres' });
  await page.clock.fastForward(9000);
  await page.locator('.toast.visible').waitFor();
  assert.match(await page.textContent('.toast'), /« Gaufres » importée/);
  await page.locator('.carte h3', { hasText: 'Gaufres' }).waitFor();
  assert.ok(!fichiers.has('import/resultats/a1.json'), 'résultat nettoyé');

  await attendre('a2', { statut: 'erreur', message: 'Pas de recette trouvée sur cette page.' });
  await page.reload();
  assert.match(await page.textContent('.banniere'), /Import en cours/);
  await page.clock.fastForward(9000);
  await page.locator('.banniere.erreur').waitFor();
  assert.match(await page.textContent('.banniere.erreur'), /Pas de recette trouvée/);
  await page.click('.banniere.erreur a');
  await page.waitForURL(/#\/ajouter\?manuel=1/);
  assert.equal(await ongletActif(), 'Saisie manuelle');
  assert.equal(await page.inputValue('[name=source]'), 'https://exemple.fr/r');
  await page.goto(BASE + '#/');
  assert.equal(await page.locator('.banniere.erreur').count(), 0, 'bannière oubliée une fois traitée');
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('« Partager → Mes Recettes » ouvre l\'import avec le lien', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '?text=' + encodeURIComponent('Regarde https://www.marmiton.org/recettes/x.aspx trop bon'));
  await page.locator('#f-lien').waitFor();
  assert.match(page.url(), /#\/ajouter\?url=/);
  assert.equal(await page.inputValue('[name=url]'), 'https://www.marmiton.org/recettes/x.aspx');
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('réglages : erreurs claires, version affichée, app non configurée', async () => {
  depotInitial();
  await nouvellePage({ configure: false });
  assert.match(await page.textContent('#resultats'), /Bienvenue/);
  await page.goto(BASE + '#/ajouter');
  assert.match(await page.textContent('.vide'), /Réglages nécessaires/);
  await page.goto(BASE + '#/nimporte-quoi');
  await page.waitForURL(/#\/$/);

  await page.goto(BASE + '#/reglages');
  const version = readFileSync(join(RACINE, 'js/views/reglages.js'), 'utf8').match(/VERSION = '([\d.]+)'/)[1];
  assert.match(await page.textContent('.page'), new RegExp(`version ${version.replace(/\./g, '\\.')}`));

  await page.fill('[name=jeton]', JETON);
  await page.fill('[name=depot]', 'mes-recettes');
  await page.click('#tester');
  assert.match(await page.textContent('#etat'), /utilisateur\/nom-du-depot/);

  droitEcriture = false;
  await page.fill('[name=depot]', `https://github.com/${DEPOT}/`);
  await page.click('#tester');
  await page.locator('#etat.ko').waitFor();
  assert.match(await page.textContent('#etat'), /lecture seule/);

  droitEcriture = true;
  await page.click('#tester');
  await page.locator('#etat.ok').waitFor();
  assert.match(await page.textContent('#etat'), /3 recette\(s\)/);

  await page.fill('[name=jeton]', 'github_pat_MAUVAIS_0123456789abcdef');
  await page.click('#tester');
  await page.locator('#etat.ko').waitFor();
  assert.match(await page.textContent('#etat'), /jeton|Bad credentials|refus/i);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('serveur des minuteurs : réglage, minuteurs planifiés et annulés, notification reçue app fermée', async () => {
  depotInitial();
  const appels = [];
  const CLE = Buffer.alloc(65, 7).toString('base64url');
  await nouvellePage({
    avant: async c => {
      // Faux serveur des minuteurs.
      await c.route('https://minuteurs.test/**', route => {
        const req = route.request();
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        const chemin = decodeURIComponent(new URL(req.url()).pathname);
        appels.push({ methode: req.method(), chemin, corps: req.postData() ? JSON.parse(req.postData()) : null });
        return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(chemin === '/cle' ? { cle: CLE } : { ok: true }) });
      });
      // Chromium de test n'a pas de service de notifications : abonnement simulé.
      await c.addInitScript(() => {
        let abonne = null;
        PushManager.prototype.getSubscription = async () => abonne;
        PushManager.prototype.subscribe = async o => (abonne = {
          endpoint: 'https://fcm.googleapis.com/fcm/send/faux',
          options: { applicationServerKey: o.applicationServerKey.buffer },
          unsubscribe: async () => { abonne = null; return true; },
        });
      });
    },
  });
  const planifies = () => appels.filter(a => a.chemin.startsWith('/minuteurs/'));

  // Sans serveur dans les réglages : rien ne part.
  await page.goto(BASE + '#/cuisine/tarte-tatin');
  await page.click('#m-lecture');
  await page.click('#m-lecture');
  assert.equal(appels.length, 0);
  await page.goto(BASE + '#/');

  // Réglages : adresse invalide, puis la bonne ; une notification d'essai est planifiée.
  await page.goto(BASE + '#/reglages');
  await page.fill('[name=serveur]', 'http://minuteurs.test');
  await page.click('#tester-serveur');
  assert.match(await page.textContent('#etat-serveur'), /https:\/\//);
  await page.fill('[name=serveur]', 'https://minuteurs.test/');
  await page.click('#tester-serveur');
  await page.locator('#etat-serveur.ok').waitFor();
  const appareil = await page.evaluate(() => localStorage.getItem('mr.appareil'));
  const essai = planifies().at(-1);
  assert.equal(essai.methode, 'PUT');
  assert.equal(essai.chemin, `/minuteurs/${appareil}|essai`);
  assert.equal(essai.corps.adresse, 'https://fcm.googleapis.com/fcm/send/faux');
  assert.ok(Math.abs(essai.corps.fin - Date.now() - 10e3) < 3000);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mr.reglages')).jeton), JETON, 'le jeton est gardé');

  // Mode cuisine : lancer planifie, pause annule, reprendre replanifie, recommencer annule.
  appels.length = 0;
  await page.goto(BASE + '#/cuisine/tarte-tatin');
  await page.click('#m-lecture');
  await page.waitForTimeout(300);
  const id = `${appareil}|tarte-tatin|0|0`;
  assert.deepEqual(planifies().map(a => [a.methode, a.chemin]), [['PUT', `/minuteurs/${id}`]]);
  assert.ok(Math.abs(planifies()[0].corps.fin - Date.now() - 30 * 60e3) < 3000, 'fin dans 30 min');
  await page.click('#m-lecture');
  await page.waitForTimeout(300);
  assert.deepEqual(planifies().at(-1).methode, 'DELETE');
  await page.click('#m-lecture');
  await page.waitForTimeout(300);
  assert.deepEqual(planifies().at(-1).methode, 'PUT');

  // La copie pour le service worker suit les minuteurs.
  const copie = await page.evaluate(async () => (await caches.match(new URL('minuteurs.json', document.baseURI).href)).json());
  assert.ok(copie['tarte-tatin|0|0'].fin > Date.now());

  page.once('dialog', d => d.accept());
  await page.click('#recommencer');
  await page.waitForTimeout(300);
  assert.deepEqual(planifies().at(-1), { methode: 'DELETE', chemin: `/minuteurs/${id}`, corps: null });

  // Réception d'une notification du serveur (app en arrière-plan) : le service worker
  // retrouve le minuteur terminé dans la copie et l'annonce.
  const cdp = await ctx.newCDPSession(page);
  const inscriptions = new Promise(ok => cdp.on('ServiceWorker.workerRegistrationUpdated', e => { if (e.registrations.length) ok(e.registrations); }));
  await cdp.send('ServiceWorker.enable');
  const [{ registrationId }] = await inscriptions;
  const recevoir = async () => {
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: BASE.slice(0, -1), registrationId, data: '' });
    await page.waitForTimeout(500);
    return page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ tag: n.tag, titre: n.title })));
  };
  await page.evaluate(async () => {
    const m = { id: 'tarte-tatin|5|0', slug: 'tarte-tatin', titre: 'Tarte tatin', etape: 5, label: 'Cuire 12 min', total: 720, fin: Date.now() - 1000, reste: 0, fini: false };
    await (await caches.open('mr-donnees')).put(new URL('minuteurs.json', document.baseURI).href, new Response(JSON.stringify({ [m.id]: m })));
  });
  let notifs = await recevoir();
  assert.deepEqual(notifs.find(n => n.tag === 'tarte-tatin|5|0'), { tag: 'tarte-tatin|5|0', titre: 'Tarte tatin · étape 6 : c\'est prêt !'.replace(/^/, '⏰ ') });

  // Aucun minuteur terminé (notification d'essai) : message générique.
  await page.evaluate(async () => (await caches.open('mr-donnees')).put(new URL('minuteurs.json', document.baseURI).href, new Response('{}')));
  notifs = await recevoir();
  assert.ok(notifs.some(n => n.titre === '⏰ Minuteur terminé'));
  assert.deepEqual(erreurs, []);
  await ctx.close();
});
