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
      // Comme l'API GitHub : modifier un fichier existant exige la version (sha) qu'on modifie.
      if (fichiers.has(chemin) && corps.sha !== sha(fichiers.get(chemin))) return json({ message: 'sha ne correspond pas' }, 409);
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

async function nouvellePage({ configure = true, horloge = false, avant = null, sombre = false } = {}) {
  ctx = await navigateur.newContext({ ...devices['Pixel 7'], locale: 'fr-FR', serviceWorkers: 'allow', permissions: ['notifications'], colorScheme: sombre ? 'dark' : 'light' });
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

// Réglages : déroule une rubrique (si elle ne l'est pas déjà).
const ouvrirReglage = async id => {
  await page.locator(`#${id}`).waitFor({ state: 'attached' });
  if (!(await page.$eval(`#${id}`, d => d.open))) await page.click(`#${id} > summary`);
};
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
  assert.deepEqual(await page.locator('.puces-ing button').allTextContents(),
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

/** Agrandit tout le texte (× 1,3, comme le réglage Android) et vérifie que rien ne déborde. */
async function sansDebordement(nom) {
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
  assert.deepEqual(depassent, [], `${nom} : éléments plus larges que l'écran`);
  // Texte d'un bouton qui ne tient plus dedans (il passe à la ligne et déborde en hauteur).
  // (ou qui sort sur le côté, comme « Automatique » dans les réglages).
  const coupes = await page.evaluate(() => [...document.querySelectorAll('.bouton, button')]
    .filter(b => b.offsetParent && (b.scrollHeight > b.clientHeight + 2 || b.scrollWidth > b.clientWidth + 2))
    .map(b => b.textContent.trim().slice(0, 30)));
  assert.deepEqual(coupes, [], `${nom} : texte qui déborde d'un bouton`);
}

test('aucun écran ne déborde en largeur, même avec le texte agrandi (réglage Android)', async () => {
  depotInitial();
  await nouvellePage();
  // Des courses prévues, pour que l'écran Courses ait une liste à afficher.
  await page.evaluate(() => localStorage.setItem('mr.courses', JSON.stringify({ prevues: [{ slug: 'cinnamon-rolls', portions: 12 }, { slug: 'risotto-aux-champignons', portions: 4 }], articles: { farine: { coche: true } } })));
  const ecrans = ['#/', '#/frigo', '#/recettes', '#/recette/cinnamon-rolls', '#/cuisine/cinnamon-rolls', '#/modifier/cinnamon-rolls', '#/ajouter', '#/ajouter?manuel=1', '#/reglages', '#/courses'];
  for (const ecran of ecrans) {
    await page.goto(BASE + ecran);
    await page.reload(); // repart de tailles de police normales
    await page.waitForTimeout(400);
    await sansDebordement(ecran);
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
  assert.match(await article('Farine').locator('.art-qte').textContent(), /^807 g \+ 1 c\. à soupe/);
  assert.equal(await page.locator('h3.rayon').first().textContent(), 'Fruits et légumes');

  // « J'en ai déjà » : 500 g de farine → il manque 307 g.
  await article('Farine').locator('.art-corps').click();
  assert.match(await article('Farine').locator('.art-detail').textContent(), /Tarte tatin.*Cinnamon rolls/s);
  await article('Farine').locator('.art-dispo input').fill('500');
  await article('Farine').locator('.art-dispo input').press('Enter');
  await page.locator('.art-dispo input').blur();
  assert.match(await article('Farine').locator('.art-qte small').textContent(), /il manque 307 g/);

  // Cocher : l'article passe en bas, barré ; tout survit à un rechargement.
  await article('Lait').locator('.art-case').click();
  assert.match(await article('Lait').getAttribute('class'), /fait/);
  await page.reload();
  await page.locator('.article').first().waitFor();
  assert.match(await article('Lait').getAttribute('class'), /fait/);
  assert.match(await article('Farine').locator('.art-qte small').textContent(), /il manque 307 g/);

  // Changer le nombre de personnes recalcule ; retirer une recette l'enlève de la liste.
  await page.locator('.prevue', { hasText: 'Tarte tatin' }).locator('[data-d="-1"]').click();
  assert.match(await article('Farine').locator('.art-qte').textContent(), /^774 g/);
  await page.locator('.prevue', { hasText: 'Cinnamon rolls' }).locator('.pv-retirer').click();
  assert.equal(await article('Lait').count(), 0);
  assert.match(await article('Farine').locator('.art-qte').textContent(), /^234 g/);
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
  assert.equal(await article('Papier cuisson').locator('.art-qte').textContent(), '', 'rien d\'écrit pour un article sans quantité ajouté à la main');

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

test('« Partager → Recettes » lance l\'import tout seul', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '?text=' + encodeURIComponent('Regarde https://www.marmiton.org/recettes/x.aspx trop bon'));
  await page.locator('.banniere .spinner').waitFor();
  assert.match(page.url(), /#\/$/, 'retour à l\'accueil, import en cours');
  const demande = ecritures.find(w => w.chemin.startsWith('import/a-traiter/'));
  assert.equal(JSON.parse(demande.contenu).url, 'https://www.marmiton.org/recettes/x.aspx');
  await page.goBack();
  assert.equal(ecritures.filter(w => w.chemin.startsWith('import/a-traiter/')).length, 1, 'pas d\'import en double');

  // Un partage sans lien ouvre simplement la page d'ajout.
  await page.goto(BASE + '?text=' + encodeURIComponent('juste du texte'));
  await page.locator('#f-lien').waitFor();
  assert.equal(await page.inputValue('[name=url]'), '');
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
  await page.locator('#f-serveur').waitFor({ state: 'attached' });
  const version = readFileSync(join(RACINE, 'js/views/reglages.js'), 'utf8').match(/VERSION = '([\d.]+)'/)[1];
  assert.match(await page.textContent('.page'), new RegExp(`version ${version.replace(/\./g, '\\.')}`));

  await ouvrirReglage('r-github');
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
  await ouvrirReglage('r-minuteurs');
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

test('fiche : la hauteur suit chaque onglet, la pastille suit le glissement', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '#/recette/cinnamon-rolls');
  await page.click('[role=tab][data-o=etapes]');
  await page.waitForTimeout(400);
  const hauteurs = () => page.evaluate(() => {
    const piste = document.querySelector('#piste');
    return { piste: piste.offsetHeight, panneau: piste.querySelector('[data-o=etapes]').offsetHeight };
  });
  let h = await hauteurs();
  assert.equal(h.piste, h.panneau, 'toutes les étapes sont visibles');
  // L'onglet Étapes grandit après coup (police chargée en retard, texte agrandi…) : la piste suit.
  await page.evaluate(() => { document.querySelector('[data-o=etapes] .etape p').textContent += ' Encore du texte. '.repeat(30); });
  await page.waitForTimeout(400);
  h = await hauteurs();
  assert.equal(h.piste, h.panneau, 'aucune étape coupée');

  // Le doigt levé, la piste se cale sur l'onglet, la pastille et la hauteur suivent.
  const zone = await page.locator('#piste').boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const y = zone.y + 40;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
  for (let k = 1; k <= 4; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300 - 40 * k, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(800);
  const { gauche, largeur } = await page.evaluate(() => { const p = document.querySelector('#piste'); return { gauche: p.scrollLeft, largeur: p.clientWidth }; });
  assert.equal(await ongletActif(), 'Notes');
  assert.ok(Math.abs(gauche - 2 * largeur) < 2, `calée (${gauche} / ${2 * largeur})`);
  h = await page.evaluate(() => { const p = document.querySelector('#piste'); return { piste: p.offsetHeight, panneau: p.querySelector('[data-o=notes]').offsetHeight }; });
  assert.equal(h.piste, h.panneau, 'hauteur de l\'onglet Notes une fois au repos');
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('modifier : réordonner les photos en les faisant glisser', async () => {
  depotInitial();
  fichiers.set('recettes/gateau.md', Buffer.from('---\ntitre: Gâteau\ncategorie: Desserts\nphotos: [photos/a.jpg, photos/b.jpg, photos/c.jpg]\n---\n## Ingrédients\n- 200 g farine\n\n## Étapes\n1. Cuire.\n'));
  for (const [k, n] of [['a', 1], ['b', 2], ['c', 3]]) fichiers.set(`photos/${k}.jpg`, Buffer.concat([IMAGE, Buffer.alloc(n)]));
  await nouvellePage();
  await page.goto(BASE + '#/modifier/gateau');
  await page.locator('.vignette-photo').nth(2).waitFor();
  const centre = async i => { const b = await page.locator('.vignette-photo').nth(i).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const deplacer = async (de, vers) => {
    const a = await centre(de), b = await centre(vers);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
    for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * k / 8, y: a.y + (b.y - a.y) * k / 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
  };
  // La 3e photo glissée sur la 1re devient la principale ; les autres se décalent.
  await deplacer(2, 0);
  assert.equal(await page.locator('.vignette-photo').count(), 3);
  // Lâchée hors d'une photo : rien ne change.
  const a = await centre(1);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x, y: a.y + 300 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  await page.click('#enreg');
  await page.waitForURL(/#\/recette\/gateau$/);
  const md = ecritures.find(w => w.chemin === 'recettes/gateau.md');
  assert.match(md.contenu, /\nphotos: \[photos\/c\.jpg, photos\/a\.jpg, photos\/b\.jpg\]\n/);
  assert.deepEqual(ecritures.filter(w => w.methode === 'DELETE'), [], 'aucune photo supprimée');
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('minuteur terminé : sonnerie en boucle, « Arrêter » et « +1 min » (app, bandeau, notification)', async () => {
  depotInitial();
  await nouvellePage({ horloge: true });
  await page.evaluate(() => { window.vibrations = 0; navigator.vibrate = () => { window.vibrations++; return true; }; });
  const notifications = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications())
    .map(n => ({ tag: n.tag, titre: n.title, boutons: n.actions.map(a => a.title) })));
  await page.goto(BASE + '#/cuisine/tarte-tatin');
  await page.evaluate(() => navigator.serviceWorker.ready);
  for (let k = 0; k < 5; k++) await page.click('#suiv');
  assert.equal((await page.textContent('#m-lecture')).trim(), 'Démarrer');
  await page.click('#m-lecture');
  assert.equal((await page.textContent('#m-lecture')).trim(), 'Pause');
  await page.click('#m-lecture');
  assert.equal((await page.textContent('#m-lecture')).trim(), 'Reprendre');
  await page.click('#m-lecture');

  // Fin : dans le mode cuisine, le minuteur propose « Arrêter » (pas de bandeau par-dessus) ;
  // sur les autres écrans, un bandeau. La sonnerie se répète ; la notification a deux boutons.
  await page.clock.fastForward('12:00');
  await page.waitForTimeout(300);
  assert.equal((await page.textContent('#m-lecture')).trim(), 'Arrêter', 'le bouton dit ce qu\'il fait');
  assert.equal(await page.locator('.alarme').count(), 0);
  await page.goto(BASE + '#/');
  await page.locator('.alarme').waitFor();
  assert.match(await page.textContent('.alarme'), /C'est prêt !.*Tarte tatin · étape 6/s);
  const avant = await page.evaluate(() => window.vibrations);
  await page.clock.runFor(8000); // (fastForward ne déclenche chaque intervalle qu'une fois)
  assert.ok(await page.evaluate(() => window.vibrations) >= avant + 2, 'ça sonne encore');
  const n = (await notifications()).find(x => x.tag === 'tarte-tatin|5|0');
  assert.deepEqual(n.boutons, ['Arrêter', '+1 min']);

  // « +1 min » depuis le bandeau : il repart pour une minute.
  await page.click('.alarme [data-a=plus1]');
  assert.equal(await page.locator('.alarme').count(), 0);
  await page.goBack();
  await page.locator('#t-bloc').waitFor();
  assert.match(await page.textContent('#t-bloc'), /^(1:00|0:59)$/);
  await page.clock.fastForward('01:01');
  await page.waitForTimeout(300);
  assert.equal((await page.textContent('#m-lecture')).trim(), 'Arrêter');

  // « Arrêter » depuis le minuteur : plus de bandeau ni de sonnerie, « Relancer » proposé.
  await page.click('#m-lecture');
  assert.equal(await page.locator('.alarme').count(), 0);
  assert.equal((await page.textContent('#m-lecture')).trim(), 'Relancer');
  assert.equal(await page.textContent('#lib'), 'Terminé !');
  const apres = await page.evaluate(() => window.vibrations);
  await page.clock.runFor(10000);
  assert.equal(await page.evaluate(() => window.vibrations), apres, 'silence');
  assert.equal((await notifications()).filter(x => x.tag === 'tarte-tatin|5|0').length, 0, 'notification retirée');

  // Bouton « Arrêter » d'une notification, app ouverte : le service worker prévient l'app.
  await page.click('#prec'); await page.click('#prec'); await page.click('#prec'); await page.click('#prec'); await page.click('#prec');
  assert.match(await etape(), /Étape 1/);
  await page.click('#m-lecture');
  await page.clock.fastForward('30:00');
  await page.waitForTimeout(300);
  assert.equal((await page.textContent('#m-lecture')).trim(), 'Arrêter');
  const [sw] = ctx.serviceWorkers();
  await sw.evaluate(() => actionMinuteur('arreter', 'tarte-tatin|0|0'));
  await page.waitForTimeout(300);
  assert.equal((await page.textContent('#m-lecture')).trim(), 'Relancer');

  // App fermée : le service worker a noté « +1 min » ; l'app l'applique à sa réouverture.
  await page.click('#m-lecture'); // relance 30 min
  await page.clock.fastForward('30:00');
  await page.waitForTimeout(300);
  assert.equal((await page.textContent('#m-lecture')).trim(), 'Arrêter');
  await page.evaluate(async () => {
    const c = await caches.open('mr-donnees');
    await c.put(new URL('actions.json', document.baseURI).href, new Response(JSON.stringify([{ id: 'tarte-tatin|0|0', action: 'plus1', fin: Date.now() + 60e3 }])));
  });
  await page.reload();
  await page.locator('#t-bloc').waitFor();
  await page.waitForTimeout(300);
  assert.equal((await page.textContent('#m-lecture')).trim(), 'Pause', 'il tourne de nouveau');
  assert.match(await page.textContent('#t-bloc'), /^(1:00|0:59)$/);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('fiche : en changeant d\'onglet depuis le bas de la page, on arrive en haut du nouvel onglet', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '#/recette/cinnamon-rolls');
  await page.locator('#piste').waitFor();
  const hautOnglets = () => page.evaluate(() => Math.round(document.querySelector('[role=tablist]').getBoundingClientRect().top));
  // Tout en bas des ingrédients, on glisse vers les étapes.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  assert.ok(await hautOnglets() < 0, 'les onglets sont sortis de l\'écran');
  const zone = await page.locator('#piste').boundingBox();
  const y = Math.min(zone.y + zone.height - 40, 500);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 330, y }] });
  for (let k = 1; k <= 5; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 330 - 50 * k, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(1200);
  assert.equal(await ongletActif(), 'Étapes');
  const h = await hautOnglets();
  assert.ok(h >= 0 && h < 40, `onglets en haut de l'écran (${h})`);
  // Pareil en touchant un onglet.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.click('[role=tab][data-o=notes]', { force: true }).catch(() => page.evaluate(() => document.querySelector('[role=tab][data-o=notes]').click()));
  await page.waitForTimeout(1200);
  assert.equal(await ongletActif(), 'Notes');
  assert.ok(await hautOnglets() >= 0);
  // Sans être descendu, rien ne bouge.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('[role=tab][data-o=ingredients]');
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('mode cuisine : ingrédients cochés, minuteur arrêté (sans clignoter), relancé à sa durée, réinitialisé', async () => {
  depotInitial();
  await nouvellePage({ horloge: true });
  await page.goto(BASE + '#/recette/cinnamon-rolls');
  await page.click('#cuisiner');
  await page.click('#suiv');
  // Toucher un ingrédient le grise et le barre ; la fiche le montre coché.
  const puce = page.locator('.puces-ing button').first();
  await puce.click();
  assert.match(await puce.getAttribute('class'), /pris/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.puces-ing .pris')).textDecorationLine), 'line-through');
  await page.click('#fermer');
  await page.locator('.fiche-feuille').waitFor();
  await page.click('[role=tab][data-o=ingredients]');
  assert.equal(await page.locator('.ingredient input:checked').count(), 1, 'la même case est cochée sur la fiche');
  await page.click('#cuisiner');
  assert.match(await page.locator('.puces-ing button').first().getAttribute('class'), /pris/);

  // Étape 7 de la tarte tatin : 12 min.
  await page.goto(BASE + '#/cuisine/tarte-tatin');
  for (let k = 0; k < 5; k++) await page.click('#suiv');
  await page.click('#m-plus'); await page.click('#m-plus'); // 14 min
  await page.click('#m-lecture');
  await page.clock.fastForward('14:00');
  await page.waitForTimeout(300);
  assert.match(await page.getAttribute('#minuteur', 'class'), /sonne/);
  await page.click('#m-lecture'); // Arrêter
  assert.doesNotMatch(await page.getAttribute('#minuteur', 'class'), /sonne/, 'ne clignote plus');
  // Relancer : la durée de l'étape (12 min), pas la dernière valeur (14 min).
  await page.click('#m-lecture');
  assert.match(await page.textContent('#t-bloc'), /^(12:00|11:59)$/);
  // Réinitialiser : bien visible, remet le minuteur à zéro.
  assert.ok(await page.locator('#m-reset').isVisible());
  await page.click('#m-reset');
  assert.equal(await page.textContent('#t-bloc'), '12:00');
  assert.equal((await page.textContent('#m-lecture')).trim(), 'Démarrer');

  // Un minuteur terminé et arrêté ne reste pas dans le bandeau des autres étapes.
  await page.click('#m-lecture');
  await page.clock.fastForward('12:00');
  await page.waitForTimeout(300);
  await page.click('#m-lecture'); // Arrêter
  await page.click('#suiv');
  assert.equal(await page.locator('.minuteur-mini').count(), 0);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('écrans : toujours ouverts en haut, la position n\'est retrouvée qu\'au retour arrière ; plus de niveau', async () => {
  depotInitial();
  await nouvellePage();
  await page.evaluate(() => window.scrollTo(0, 400));
  const y = await page.evaluate(() => window.scrollY);
  assert.ok(y > 0);
  await page.goto(BASE + '#/reglages');
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.goBack();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.scrollY), y, 'retour arrière : position retrouvée');
  await page.goto(BASE + '#/reglages');
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'réglages rouverts en haut');
  // Écran quitté juste après avoir défilé (avant que l'événement « scroll » n'arrive) : position gardée quand même.
  await page.goBack();
  await page.waitForTimeout(200);
  const y2 = await page.evaluate(() => { window.scrollTo(0, 60); const v = window.scrollY; location.hash = '#/reglages'; return v; });
  assert.ok(y2 > 0);
  await page.waitForURL(/#\/reglages$/);
  await page.goBack();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.scrollY), y2, 'position gardée même en partant aussitôt');

  // Le niveau n'apparaît plus, et disparaît du fichier à l'enregistrement.
  await page.goto(BASE + '#/recette/risotto-aux-champignons');
  assert.doesNotMatch(await page.textContent('.stats'), /Niveau|Moyen/);
  await page.goto(BASE + '#/modifier/risotto-aux-champignons');
  assert.equal(await page.locator('[name=difficulte]').count(), 0);
  await page.click('#enreg');
  await page.waitForURL(/#\/recette\/risotto/);
  assert.doesNotMatch(ecritures.find(w => w.chemin === 'recettes/risotto-aux-champignons.md').contenu, /difficulte/);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('courses : le retour Android ferme « Quelles recettes ? » sans quitter les courses', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '#/');
  await page.goto(BASE + '#/courses');
  await page.click('#ajouter-recettes');
  await page.click('.f-recette:has-text("Tarte tatin")');
  await page.goBack();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.feuille').count(), 0, 'feuille fermée');
  assert.match(page.url(), /#\/courses$/);
  assert.equal(await page.locator('.prevue').count(), 1, 'la recette choisie est bien prévue');
  // Le bouton « Terminé » de la feuille ferme aussi sans changer d'écran.
  await page.click('#ajouter-recettes');
  await page.click('#f-fermer');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.feuille').count(), 0);
  assert.match(page.url(), /#\/courses$/);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('import annulé : la demande est retirée ; annulé trop tard, la recette créée est supprimée', async () => {
  depotInitial();
  await nouvellePage({ horloge: true });
  // Annulé avant que GitHub ne s'en occupe : la demande disparaît du dépôt.
  await page.goto(BASE + '#/ajouter');
  await page.fill('[name=url]', 'https://www.marmiton.org/recettes/a.aspx');
  await page.click('#go');
  await page.locator('.banniere [data-annuler]').waitFor();
  const demande = ecritures.find(w => w.chemin.startsWith('import/a-traiter/')).chemin;
  page.once('dialog', d => d.accept());
  await page.click('.banniere [data-annuler]');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.banniere').count(), 0);
  assert.ok(ecritures.some(w => w.methode === 'DELETE' && w.chemin === demande), 'demande retirée');
  await page.reload();
  await page.locator('.carte').first().waitFor();
  assert.equal(await page.locator('.banniere').count(), 0, 'toujours annulé après rechargement');

  // Annulé alors que GitHub l'avait déjà traité : la recette arrivée ensuite est supprimée, sans message.
  await page.goto(BASE + '#/ajouter');
  await page.fill('[name=url]', 'https://www.marmiton.org/recettes/b.aspx');
  await page.click('#go');
  await page.locator('.banniere [data-annuler]').waitFor();
  const id = ecritures.filter(w => w.chemin.startsWith('import/a-traiter/')).at(-1).chemin.match(/a-traiter\/(.+)\.json/)[1];
  fichiers.delete(`import/a-traiter/${id}.json`); // déjà pris par le workflow
  fichiers.set('recettes/gaufres.md', Buffer.from('---\ntitre: Gaufres\n---\n## Ingrédients\n- 250 g farine\n\n## Étapes\n1. Cuire.\n'));
  fichiers.set(`import/resultats/${id}.json`, Buffer.from(JSON.stringify({ statut: 'ok', slug: 'gaufres', titre: 'Gaufres' })));
  page.once('dialog', d => d.accept());
  await page.click('.banniere [data-annuler]');
  await page.clock.fastForward(9000);
  await page.waitForTimeout(1000);
  assert.ok(ecritures.some(w => w.methode === 'DELETE' && w.chemin === 'recettes/gaufres.md'), 'recette importée retirée');
  assert.ok(!fichiers.has(`import/resultats/${id}.json`), 'résultat nettoyé');
  assert.doesNotMatch(await page.textContent('body'), /« Gaufres » importée/);
  assert.equal(await page.locator('.carte h3', { hasText: 'Gaufres' }).count(), 0);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('supprimer une recette depuis « Modifier »', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '#/modifier/tarte-tatin');
  await page.locator('#suppr-recette').scrollIntoViewIfNeeded();
  // Le bouton n'est pas caché sous la barre Annuler / Enregistrer.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const b = await page.locator('#suppr-recette').boundingBox();
  const barre = await page.locator('.barre-bas').boundingBox();
  assert.ok(b.y + b.height <= barre.y + 1, 'visible au-dessus de la barre du bas');
  page.once('dialog', d => d.dismiss());
  await page.click('#suppr-recette');
  assert.equal(ecritures.length, 0, 'annuler ne supprime rien');
  page.once('dialog', d => d.accept());
  await page.click('#suppr-recette');
  await page.waitForURL(/#\/$/);
  assert.ok(ecritures.some(w => w.methode === 'DELETE' && w.chemin === 'recettes/tarte-tatin.md'));
  await page.locator('.carte').first().waitFor();
  assert.ok(!(await titresAccueil()).includes('Tarte tatin'));
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('courses partagées : deux téléphones, la même liste ; « Retirer les articles cochés »', async () => {
  depotInitial();
  await nouvellePage();
  const telephone1 = page;
  const article = (p, nom) => p.locator('.article', { has: p.locator('.art-nom', { hasText: new RegExp(`^${nom}$`) }) });
  await telephone1.goto(BASE + '#/courses');
  await telephone1.fill('#ajout-article input', '2 citrons');
  await telephone1.press('#ajout-article input', 'Enter');
  await telephone1.waitForTimeout(1500); // envoi regroupé
  assert.match(fichiers.get('courses.json')?.toString() || '', /2 citrons/, 'liste écrite dans le dépôt');

  // Un deuxième téléphone (autre jeton, même dépôt) voit la liste et la complète.
  const ctx2 = await navigateur.newContext({ ...devices['Pixel 7'], locale: 'fr-FR' });
  await ctx2.route('https://api.github.com/**', fauxGitHub);
  const telephone2 = await ctx2.newPage();
  telephone2.on('pageerror', e => erreurs.push(e.message));
  await telephone2.goto(BASE);
  await telephone2.evaluate(([jeton, depot]) => localStorage.setItem('mr.reglages', JSON.stringify({ jeton, depot })), [JETON, DEPOT]);
  await telephone2.goto(BASE + '?t=2#/courses');
  await article(telephone2, 'Citrons').waitFor();
  await telephone2.fill('#ajout-article input', 'lait');
  await telephone2.press('#ajout-article input', 'Enter');
  await article(telephone2, 'Citrons').locator('.art-case').click(); // acheté
  await telephone2.waitForTimeout(1500);

  // Le premier téléphone le voit à son prochain relevé (toutes les 8 s sur l'écran Courses).
  await article(telephone1, 'Lait').waitFor({ timeout: 12000 });
  assert.match(await article(telephone1, 'Citrons').getAttribute('class'), /fait/, 'la case cochée est partagée');

  // « Retirer les articles cochés » : les cochés disparaissent, chez tout le monde ; annulable.
  await telephone1.click('#retirer-coches');
  assert.equal(await article(telephone1, 'Citrons').count(), 0);
  assert.equal(await article(telephone1, 'Lait').count(), 1);
  await telephone1.click('.toast button.toast-action');
  assert.equal(await article(telephone1, 'Citrons').count(), 1, 'annuler le remet');
  await telephone1.click('#retirer-coches');
  await telephone1.waitForTimeout(1500);
  await telephone2.reload();
  await article(telephone2, 'Lait').waitFor();
  assert.equal(await article(telephone2, 'Citrons').count(), 0);
  assert.deepEqual(erreurs, []);
  await ctx2.close();
  await ctx.close();
});

for (const sombre of [true, false]) test(`mode ${sombre ? 'sombre' : 'clair'} : suit le réglage du téléphone, texte lisible partout`, async () => {
  depotInitial();
  await nouvellePage({ sombre });
  const couleurs = sel => page.evaluate(s => { const c = getComputedStyle(document.querySelector(s)); return { fond: c.backgroundColor, texte: c.color }; }, sel);
  assert.equal((await couleurs('body')).fond, sombre ? 'rgb(28, 23, 18)' : 'rgb(246, 240, 230)');
  assert.equal((await couleurs('.carte')).fond, sombre ? 'rgb(39, 32, 26)' : 'rgb(255, 251, 244)');
  assert.equal(await page.getAttribute('meta[name=theme-color]', 'content'), sombre ? '#1C1712' : '#F6F0E6', 'barre du téléphone');
  // Pastille avec un lien (« Bon appétit ! · Noter dans le carnet ») : le lien se lit sur le fond de la pastille.
  const contrastePastille = await page.evaluate(async () => {
    (await import('./js/ui.js')).toast('Bon appétit !', 5000, { texte: 'Noter dans le carnet', faire() {} });
    const rgb = c => c.match(/[\d.]+/g).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
      .reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
    const [a, b] = [lum(rgb(getComputedStyle(document.querySelector('.toast-action')).color)), lum(rgb(getComputedStyle(document.querySelector('.toast')).backgroundColor))];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  assert.ok(contrastePastille >= 4.5, `lien de la pastille : contraste ${contrastePastille.toFixed(1)}`);
  // Contraste du texte sur son fond, sur chaque écran (≥ 4,5:1, 3:1 pour les gros titres).
  const ecrans = ['#/', '#/recette/tarte-tatin', '#/courses', '#/reglages', '#/cuisine/tarte-tatin', '#/modifier/tarte-tatin'];
  for (const ecran of ecrans) {
    await page.goto(BASE + ecran);
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; })); // réglages dépliés
    const faibles = await page.evaluate(() => {
      const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
        .reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
      const fondDe = el => {
        for (let e = el; e; e = e.parentElement) {
          const c = getComputedStyle(e);
          if (c.backgroundImage !== 'none') return null; // sur une photo ou un dégradé : non mesuré
          const f = rgb(c.backgroundColor);
          if (f.length >= 3 && (f[3] ?? 1) > 0.5) return f;
        }
        return rgb(getComputedStyle(document.body).backgroundColor);
      };
      const res = [];
      for (const el of document.querySelectorAll('body *')) {
        if (!el.offsetParent || el.closest('.sr') || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
        const c = getComputedStyle(el);
        if (c.visibility === 'hidden' || parseFloat(c.opacity) < 1 || el.closest('[disabled], .fait, .pris, input')) continue;
        const fond = fondDe(el);
        if (!fond) continue;
        const [a, b] = [lum(rgb(c.color)), lum(fond)].sort((x, y) => y - x);
        const ratio = (a + 0.05) / (b + 0.05);
        const gros = parseFloat(c.fontSize) >= 24;
        if (ratio < (gros ? 3 : 4.5)) res.push(`${el.textContent.trim().slice(0, 25)} (${ratio.toFixed(1)})`);
      }
      return res;
    });
    assert.deepEqual(faibles, [], `${ecran} : texte trop peu contrasté`);
  }
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('moule : saisi dans « Modifier », quantités adaptées à mon moule sur la fiche et en mode cuisine', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '#/modifier/tarte-tatin');
  await page.locator('#form').waitFor();
  // Moule sans taille : refusé, rien n'est écrit.
  await page.fill('[name=moule]', 'grand moule');
  await page.click('#enreg');
  assert.match(await page.textContent('.toast'), /Moule : indiquer la taille/);
  assert.equal(ecritures.length, 0);
  await page.fill('[name=moule]', 'rond 24');
  await page.click('#enreg');
  await page.waitForURL(/#\/recette\/tarte-tatin$/);
  assert.match(ecritures.at(-1).contenu, /\nportions: 6\nmoule: rond 24 cm\n/);

  // Sur la fiche : « Personnes » ou « Taille du moule ».
  await page.locator('.fiche-feuille h1').waitFor();
  const qte = () => page.locator('[data-o=ingredients] .qte').first().textContent();
  assert.equal(await qte(), '200 g');
  await page.click('[data-mode=moule]');
  assert.match(await page.textContent('.moule-carte'), /Recette prévue pour\s*rond 24 cm/);
  for (let k = 0; k < 4; k++) await page.click('[data-taille=taille-a][data-d="1"]');
  assert.equal(await page.textContent('#taille-a'), '28 cm');
  assert.match(await page.textContent('#facteur-moule'), /Quantités × 1,36/);
  assert.equal(await qte(), '270 g');
  assert.match(await page.getAttribute('#cuisiner', 'href'), /\?p=6&f=1\.361$/);
  // Carré de 24 cm : plus grand qu'un rond de 24 (× 1,27).
  await page.click('[data-forme=carré]');
  await page.click('[data-taille=taille-a][data-d="-1"]');
  await page.click('[data-taille=taille-a][data-d="-1"]');
  await page.click('[data-taille=taille-a][data-d="-1"]');
  await page.click('[data-taille=taille-a][data-d="-1"]');
  assert.match(await page.textContent('#facteur-moule'), /× 1,27/);
  // Rectangle : longueur et largeur.
  await page.click('[data-forme=rectangle]');
  await page.click('[data-taille=taille-b][data-d="-1"]');
  assert.equal(await page.textContent('#taille-b'), '23 cm');
  await sansDebordement('fiche, moule rectangle');
  await page.reload();
  await page.locator('.moule-carte').waitFor();
  assert.equal(await page.textContent('#taille-b'), '23 cm', 'mon moule est retenu');

  // Le mode cuisine reprend les quantités du moule.
  await page.click('[data-forme=rond]');
  for (let k = 0; k < 4; k++) await page.click('[data-taille=taille-a][data-d="1"]');
  assert.equal(await page.textContent('#taille-a'), '28 cm');
  await page.click('#cuisiner');
  await page.locator('.etape-label').waitFor();
  const puces = await page.locator('.puces-ing').textContent().catch(() => '');
  if (puces) assert.doesNotMatch(puces, /200 g farine/);
  assert.match(page.url(), /f=1\.361/);

  // Retour à « Personnes » : quantités d'origine.
  await page.goBack();
  await page.locator('[data-mode=personnes]').waitFor();
  await page.click('[data-mode=personnes]');
  assert.equal(await qte(), '200 g');
  assert.equal(await page.locator('.moule-carte').count(), 0);

  // Équivalent en personnes, et liste de courses aux quantités exactes du moule.
  await page.click('[data-mode=moule]');
  assert.match(await page.textContent('#facteur-moule'), /Quantités × 1,36 \(surface du moule\), soit ≈ 8 personnes/);
  await page.click('#aux-courses');
  assert.match(await page.textContent('.toast'), /Ajoutée aux courses \(moule rond 28 cm\)/);
  await page.goto(BASE + '#/courses');
  await page.locator('.prevue').waitFor();
  assert.equal(await page.textContent('.pv-moule'), 'Moule rond 28 cm');
  assert.equal(await page.textContent('.prevue .stepper b'), '≈8');
  const articles = await page.locator('.article').evaluateAll(as => as.map(a => a.textContent.replace(/\s+/g, ' ').trim()));
  assert.ok(articles.includes('Farine 273 g'), `200 g × 1,36 arrondi au-dessus (et non 267 g pour 8 personnes) : ${articles}`);
  assert.ok(articles.includes('Pommes Golden 8¼'), 'jamais arrondi vers le bas');
  // + : on repasse en nombre de personnes.
  await page.click('.prevue [data-d="1"]');
  assert.equal(await page.textContent('.prevue .stepper b'), '9');
  assert.equal(await page.locator('.pv-moule').count(), 0);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('carnet : ajouter une note (avis, moule, four), la retrouver, la supprimer ; « Noter dans le carnet » après « Terminé »', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '#/recette/cinnamon-rolls');
  await page.click('[role=tab][data-o=notes]');
  await page.waitForTimeout(500);
  assert.match(await page.textContent('#carnet'), /Mon carnet/);
  assert.equal(await page.locator('.carnet-note').count(), 0);

  await page.click('#carnet-ajouter');
  // Note vide : refusée.
  await page.click('#carnet-form [type=submit]');
  assert.match(await page.textContent('.toast'), /La note est vide/);
  assert.equal(ecritures.length, 0);
  await page.fill('#carnet-form [name=date]', '2026-10-12');
  await page.click('[data-avis=Réussi]');
  assert.equal(await page.getAttribute('[data-avis=Réussi]', 'aria-pressed'), 'true');
  await page.fill('#carnet-form [name=moule]', 'rectangle 30 x 20 cm');
  await page.fill('#carnet-form [name=four]', '170');
  await page.fill('#carnet-form [name=texte]', 'Pousse 1 h 30 près du radiateur : parfait.');
  await sansDebordement('carnet, formulaire');
  await page.click('#carnet-form [type=submit]');
  await page.locator('.carnet-note').waitFor();
  const md = ecritures.at(-1);
  assert.equal(md.chemin, 'recettes/cinnamon-rolls.md');
  assert.match(md.contenu, /\n## Carnet\n\n- 2026-10-12 · Réussi · moule rectangle 30 x 20 cm · four 170 °C · \d+ pers\. : Pousse 1 h 30 près du radiateur : parfait\.\n$/);
  assert.match(await page.textContent('.carnet-stats'), /Cuisinée 1 fois · dernière fois le 12 octobre 2026/);
  assert.match(await page.textContent('.carnet-note'), /Réussi[\s\S]*Moule rectangle 30 x 20 cm · Four 170 °C[\s\S]*Pousse 1 h 30/);

  // Une deuxième, plus ancienne : elle passe après.
  await page.click('#carnet-ajouter');
  await page.fill('#carnet-form [name=date]', '2026-09-28');
  await page.click('[data-avis="À ajuster"]');
  await page.fill('#carnet-form [name=texte]', 'Glaçage trop liquide.');
  await page.click('#carnet-form [type=submit]');
  await page.locator('.carnet-note >> nth=1').waitFor();
  assert.match(await page.locator('.carnet-note').nth(1).textContent(), /À ajuster[\s\S]*Glaçage/);
  assert.match(await page.textContent('.carnet-stats'), /Cuisinée 2 fois · dernière fois le 12 octobre/);

  // Relu depuis le dépôt (nouvelle synchronisation) : le carnet est toujours là.
  await page.evaluate(() => { localStorage.removeItem('mr.recettes'); });
  await page.goto(BASE + '#/');
  await page.reload();
  await page.locator('.carte').first().waitFor();
  await page.goto(BASE + '#/recette/cinnamon-rolls');
  await page.locator('.fiche-feuille h1').waitFor();
  await page.click('[role=tab][data-o=notes]');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.carnet-note').count(), 2);

  // Supprimer la première (après confirmation).
  page.once('dialog', d => d.accept());
  await page.locator('.carnet-suppr').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.carnet-note').length === 1);
  assert.doesNotMatch(ecritures.at(-1).contenu, /Réussi/);
  assert.match(ecritures.at(-1).contenu, /- 2026-09-28 · À ajuster/);

  // Fin du mode cuisine : « Noter dans le carnet » ouvre le formulaire.
  await page.goto(BASE + '#/cuisine/cinnamon-rolls?e=99');
  await page.locator('.etape-label').waitFor();
  await page.click('#suiv');
  await page.locator('.toast .toast-action').waitFor();
  assert.match(await page.textContent('.toast'), /Bon appétit/);
  // Le message garde sa largeur à côté du bouton (pas un mot par ligne).
  const hauteurs = await page.evaluate(() => [document.querySelector('.toast-texte').offsetHeight, parseFloat(getComputedStyle(document.querySelector('.toast-texte')).lineHeight) || 20]);
  assert.ok(hauteurs[0] < hauteurs[1] * 1.6, `« Bon appétit ! » sur une ligne (${hauteurs})`);
  await page.click('.toast-action');
  await page.waitForURL(/#\/recette\/cinnamon-rolls$/);
  await page.locator('#carnet-form').waitFor();
  assert.equal(await ongletActif(), 'Notes');
  // On arrive directement sur le carnet, pas en haut de la recette.
  await page.waitForTimeout(200);
  const haut = await page.locator('#carnet').evaluate(e => e.getBoundingClientRect().top);
  assert.ok(await page.evaluate(() => window.scrollY) > 300 && haut >= -1 && haut < 120, `carnet en haut de l'écran (${haut})`);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

// Faux micro et fausse voix : `__dire(texte)` simule une phrase reconnue, `__voix.dits` garde ce qui est lu.
const fauxMicro = ctx => ctx.addInitScript(() => {
  window.__voix = { dits: [], reco: null, demarrages: 0 };
  window.SpeechRecognition = class {
    constructor() { window.__voix.reco = this; this.actif = false; }
    start() { window.__voix.demarrages++; this.actif = true; }
    abort() { this.actif = false; }
    stop() { this.actif = false; }
  };
  window.__dire = t => window.__voix.reco.onresult({ results: [Object.assign([{ transcript: t }], { isFinal: true })] });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    speak: u => { window.__voix.dits.push(u.text); setTimeout(() => u.onend?.(), 0); },
    cancel() {},
  } });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
});

test('mode cuisine mains libres : désactivé par défaut, commandes après « Recette », lecture des étapes', async () => {
  depotInitial();
  await nouvellePage({ avant: fauxMicro });
  await page.goto(BASE + '#/cuisine/tarte-tatin');
  await page.locator('.etape-label').waitFor();
  const dits = () => page.evaluate(() => window.__voix.dits);
  const dire = async t => { await page.evaluate(t => window.__dire(t), t); await page.waitForTimeout(150); };

  // Désactivé par défaut : micro éteint.
  assert.equal(await page.getAttribute('#mains-libres', 'aria-pressed'), 'false');
  assert.ok(await page.locator('#voix').isHidden());
  assert.equal(await page.evaluate(() => window.__voix.reco), null, 'le micro n\'écoute pas');

  await page.click('#mains-libres');
  assert.equal(await page.getAttribute('#mains-libres', 'aria-pressed'), 'true');
  assert.match(await page.textContent('#voix'), /J'écoute[\s\S]*Recette,[\s\S]*suivante/);
  await sansDebordement('mode cuisine, mains libres');
  await page.reload();
  await page.locator('.etape-label').waitFor();
  assert.equal(await page.getAttribute('#mains-libres', 'aria-pressed'), 'false', 'à rallumer à chaque fois');
  await page.click('#mains-libres');
  await page.waitForTimeout(100);
  const etape1 = await page.evaluate(() => document.querySelector('.cuisine-texte').textContent);
  assert.deepEqual(await dits(), [etape1.replace(/\s+/g, ' ').trim()], 'l\'étape affichée est lue');

  // Sans « Recette » devant : rien ne se passe.
  await dire('suivante');
  await dire('cette recette est bonne et après on verra');
  assert.match(await etape(), /Étape 1/);
  await dire('Recette, suivante');
  assert.match(await etape(), /Étape 2/);
  assert.match(await page.textContent('.toast'), /« Suivante »/);
  assert.equal((await dits()).length, 2, 'la nouvelle étape est lue');
  await dire('recette précédente');
  assert.match(await etape(), /Étape 1/);
  assert.equal((await dits()).length, 3, 'relue en y revenant');
  await dire('Recette, relis');
  assert.equal((await dits()).at(-1), (await dits())[0]);
  await dire('Recette, les ingrédients');
  assert.equal((await dits()).length, 5);

  // Minuteur de l'étape : lancer, mettre en pause, reprendre.
  await dire('Recette, lance le minuteur');
  assert.equal(await page.textContent('#m-lecture'), 'Pause');
  await dire('Recette, pause');
  assert.equal(await page.textContent('#m-lecture'), 'Reprendre');
  await dire('Recette, démarre le minuteur');
  assert.equal(await page.textContent('#m-lecture'), 'Pause');
  await dire('Recette, arrête');
  assert.equal(await page.textContent('#m-lecture'), 'Reprendre');
  assert.equal((await dits()).length, 5, 'l\'étape redessinée (minuteur) n\'est pas relue');

  // Sans lecture à voix haute (choix retenu).
  await page.click('#voix-lire');
  const avant = (await dits()).length;
  await dire('Recette, suivante');
  assert.match(await etape(), /Étape 2/);
  assert.equal((await dits()).length, avant);
  assert.equal(await page.evaluate(() => localStorage.getItem('mr.voix.lire')), 'non');

  // Le téléphone coupe l'écoute après un silence : elle repart toute seule.
  const n = await page.evaluate(() => window.__voix.demarrages);
  await page.evaluate(() => window.__voix.reco.onend());
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__voix.demarrages), n + 1);

  // Éteindre : le micro s'arrête et ne repart pas.
  await page.click('#mains-libres');
  assert.ok(await page.locator('#voix').isHidden());
  assert.equal(await page.evaluate(() => window.__voix.reco.actif), false);
  await page.evaluate(() => window.__voix.reco.onend());
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__voix.demarrages), n + 1);

  // Micro refusé : message clair, mode coupé.
  await page.click('#mains-libres');
  await page.evaluate(() => window.__voix.reco.onerror({ error: 'not-allowed' }));
  assert.match(await page.textContent('.toast'), /Micro refusé/);
  assert.equal(await page.getAttribute('#mains-libres', 'aria-pressed'), 'false');

  // En quittant le mode cuisine, le micro est coupé.
  await page.click('#mains-libres');
  await page.click('#fermer');
  await page.waitForURL(u => !u.hash.includes('cuisine'));
  assert.equal(await page.evaluate(() => window.__voix.reco.actif), false);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('avec ce que j\'ai : depuis l\'accueil, recettes classées par ce qui manque, placard modifiable', async () => {
  depotInitial();
  await nouvellePage();
  await page.click('.raccourci-frigo');
  await page.waitForURL(/#\/frigo$/);
  assert.match(await page.textContent('#resultats-frigo'), /Écris ce que tu as/);
  await page.fill('#mes', 'pommes, beurre, sucre et farine');
  assert.deepEqual(await page.locator('#puces span').allTextContents(), ['pommes', 'beurre', 'sucre', 'farine']);
  const lignes = () => page.locator('.ligne-frigo').evaluateAll(ls => ls.map(l => [l.querySelector('h3').textContent, l.querySelector('p').textContent, l.querySelector('.part').textContent]));
  assert.deepEqual(await lignes(), [
    ['Tarte tatin', 'Tout est là', '100 %'],
    ['Cinnamon rolls', 'Il manque : levure boulangère, lait, yaourt nature et 1 autre', '64 %'],
    ['Risotto aux champignons', 'Il manque : riz arborio, champignons de Paris, oignon et 5 autres', '11 %'],
  ]);
  assert.match(await page.textContent('#placard-resume'), /^sel, poivre, eau$/);
  await sansDebordement('avec ce que j\'ai');

  // Ce que je mets « toujours là » ne compte plus comme manquant.
  await page.reload();
  await page.locator('.ligne-frigo').first().waitFor();
  assert.equal(await page.inputValue('#mes'), 'pommes, beurre, sucre et farine', 'ma liste est retenue');
  await page.click('.placard summary');
  await page.fill('#placard', 'sel, poivre, eau, lait, levure');
  assert.equal((await lignes())[1][1], 'Il manque : yaourt nature, cannelle en poudre');

  // Rien d'utile.
  await page.fill('#mes', 'chocolat');
  assert.match(await page.textContent('#resultats-frigo'), /Aucune de mes recettes/);
  await page.fill('#mes', 'riz');
  await page.click('.ligne-frigo');
  await page.waitForURL(/#\/recette\/risotto-aux-champignons$/);
  await page.goBack();
  await page.locator('#mes').waitFor();
  assert.equal(await page.inputValue('#mes'), 'riz');
  await page.click('#retour');
  await page.locator('.raccourci-frigo').waitFor();
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('avec ce que j\'ai : chercher sur internet, puis importer le lien collé', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '#/frigo');
  await page.locator('#mes').waitFor();
  assert.ok(await page.locator('#internet').isHidden(), 'rien à chercher sans ingrédients');
  await page.fill('#mes', 'chocolat, noisettes');
  assert.match(await page.textContent('#resultats-frigo'), /cherchons sur internet/);
  const liens = await page.locator('#liens a').evaluateAll(as => as.map(a => [a.textContent.trim(), a.href, a.target, a.rel]));
  assert.deepEqual(liens, [
    ['Marmiton', 'https://www.marmiton.org/recettes/recherche.aspx?aqt=chocolat%20noisettes', '_blank', 'noopener'],
    ['Google', 'https://www.google.com/search?q=recette%20chocolat%20noisettes', '_blank', 'noopener'],
  ]);
  // Espaces verticaux égaux entre les lignes (liens, champ, bouton), aussi avec le texte agrandi.
  const ecarts = () => page.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    return [r('#lien').top - r('#liens').bottom, r('#coller button').top - r('#lien').bottom].map(Math.round);
  });
  const [e1, e2] = await ecarts();
  assert.ok(e1 === e2 && e1 > 0, `écarts ${e1} / ${e2}`);
  await sansDebordement('avec ce que j\'ai, sur internet');
  const [g1, g2] = await ecarts();
  assert.equal(g1, g2, 'texte agrandi : écarts toujours égaux');

  // Lien invalide : message ; lien collé (avec du texte autour) : l'import part tout seul.
  await page.fill('#lien', 'pas un lien');
  await page.evaluate(() => document.querySelector('#coller').requestSubmit());
  assert.match(await page.textContent('.toast'), /Colle le lien/);
  await page.fill('#lien', 'Regarde ça https://www.marmiton.org/recettes/recette_brownies_12345.aspx trop bon');
  await page.click('#coller button');
  await page.locator('.banniere .spinner').waitFor();
  const demande = ecritures.find(w => w.chemin.startsWith('import/a-traiter/'));
  assert.equal(JSON.parse(demande.contenu).url, 'https://www.marmiton.org/recettes/recette_brownies_12345.aspx');
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('mode cuisine : plusieurs durées dans une étape, chacune nommée (bouton, minuteur, notification)', async () => {
  depotInitial();
  fichiers.set('recettes/carrot-cake.md', Buffer.from(`---\ntitre: Carrot cake\nportions: 8\n---\n## Ingrédients\n- 250 g farine\n\n## Étapes\n1. Ajouter la cannelle, fouetter vitesse moyenne 1 minute. Ajouter la farine. Fouetter encore en vitesse moyenne 1 minute. Enfin ajouter l'huile. Fouetter encore 1 minute vitesse moyenne.\n`));
  await nouvellePage({ horloge: true });
  await page.goto(BASE + '#/cuisine/carrot-cake');
  await page.locator('.choix-durees').waitFor();
  assert.deepEqual(await page.locator('.choix-durees button').allTextContents(),
    ['Fouetter · 1 minute', 'Fouetter encore · 1 minute', 'Fouetter encore (2) · 1 minute']);
  assert.equal(await page.textContent('#lib'), 'Fouetter · 1 minute');
  await page.click('.choix-durees button >> nth=2');
  assert.equal(await page.textContent('#lib'), 'Fouetter encore (2) · 1 minute');
  await page.click('#m-lecture');
  assert.match(await page.textContent('.minuteurs-autres'), /Fouetter encore \(2\) · 1 minute/);
  await sansDebordement('mode cuisine, durées nommées');
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('réglages : rubriques repliées avec résumé, apparence au choix (automatique, clair, sombre)', async () => {
  depotInitial();
  await nouvellePage();
  await page.goto(BASE + '#/reglages');
  await page.locator('.reglage').first().waitFor();
  // Tout est replié (l'app est configurée), une ligne de résumé par rubrique.
  assert.deepEqual(await page.locator('.reglage').evaluateAll(ds => ds.map(d => d.open)), [false, false, false, false, false]);
  const resumes = await page.locator('.reglage summary').allTextContents();
  assert.match(resumes[0], /Vous\s*Test/);
  assert.match(resumes[1], /Connexion GitHub\s*marynedey\/mes-recettes/);
  assert.match(resumes[2], /Apparence\s*Automatique/);
  assert.match(resumes[3], /Minuteurs, app fermée\s*Désactivé/);
  assert.match(resumes[4], /Données\s*3 recette\(s\)/);
  assert.ok(await page.locator('[name=jeton]').isHidden(), 'le détail est replié');
  await page.click('#r-github > summary');
  assert.ok(await page.locator('[name=jeton]').isVisible());

  // Prénom : enregistré dès qu'on le tape.
  await ouvrirReglage('r-vous');
  await page.fill('[name=prenom]', 'Maryne');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mr.reglages')).prenom), 'Maryne');
  assert.match(await page.textContent('#r-vous .resume'), /Maryne/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mr.reglages')).jeton), JETON, 'le jeton est gardé');

  // Apparence : téléphone en clair, l'app en sombre (et l'inverse), retenu après rechargement.
  const fond = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await fond(), 'rgb(246, 240, 230)');
  await ouvrirReglage('r-apparence');
  await page.click('[data-theme-choix=sombre]');
  assert.equal(await fond(), 'rgb(28, 23, 18)');
  assert.equal(await page.getAttribute('meta[name=theme-color]', 'content'), '#1C1712');
  assert.match(await page.textContent('#r-apparence .resume'), /Sombre/);
  await page.reload();
  await page.locator('.reglage').first().waitFor();
  assert.equal(await fond(), 'rgb(28, 23, 18)', 'choix retenu');
  await page.emulateMedia({ colorScheme: 'dark' });
  await ouvrirReglage('r-apparence');
  await page.click('[data-theme-choix=clair]');
  assert.equal(await fond(), 'rgb(246, 240, 230)', 'clair même si le téléphone est en sombre');
  // Automatique : suit le téléphone, y compris quand il change.
  await page.click('[data-theme-choix=auto]');
  assert.equal(await fond(), 'rgb(28, 23, 18)');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'clair', null, { timeout: 3000 });
  assert.equal(await fond(), 'rgb(246, 240, 230)');
  assert.equal(await page.getAttribute('[data-theme-choix=auto]', 'aria-pressed'), 'true');

  await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
  await sansDebordement('réglages dépliés');
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('modifier : pendant l\'enregistrement, le bouton garde son texte et ne déborde pas (texte agrandi)', async () => {
  depotInitial();
  await nouvellePage();
  // GitHub qui répond lentement : on regarde le bouton pendant l'envoi.
  let liberer;
  const attente = new Promise(ok => { liberer = ok; });
  await ctx.route('https://api.github.com/**/contents/recettes/**', async route => {
    if (route.request().method() === 'PUT') await attente;
    return fauxGitHub(route);
  });
  await page.goto(BASE + '#/modifier/tarte-tatin');
  await page.locator('#form').waitFor();
  await page.click('#enreg');
  await page.locator('#enreg .spinner').waitFor();
  assert.equal((await page.textContent('#enreg')).trim(), 'Enregistrer');
  assert.ok(await page.locator('#enreg').isDisabled());
  await sansDebordement('modifier, enregistrement en cours');
  liberer();
  await page.waitForURL(/#\/recette\/tarte-tatin$/);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});

test('quantités : pas de fausse alerte pour « (T45) », « (11 g) » ; équivalences entre parenthèses recalculées', async () => {
  depotInitial();
  fichiers.set('recettes/carrot-cake.md', Buffer.from(`---\ntitre: Carrot cake\nportions: 8\n---\n## Ingrédients\n- 250 grammes farine (T45)\n- 1 sachet levure chimique (11g)\n- 250 grammes carottes (4 petites)\n- 8 g levure fraîche (ou 3 g de levure sèche)\n\n## Étapes\n1. Mélanger.\n`));
  await nouvellePage();
  // Modifier : aucune ligne signalée.
  await page.goto(BASE + '#/modifier/carrot-cake');
  await page.locator('#form').waitFor();
  await page.waitForTimeout(200);
  assert.doesNotMatch(await page.textContent('#form'), /Non recalculés/);
  // Fiche pour 16 : quantités et équivalences doublées, le sachet garde ses 11 g, pas de « à ajuster ».
  await page.goto(BASE + '#/recette/carrot-cake');
  for (let k = 0; k < 8; k++) await page.click('#plus');
  const lignes = await page.locator('[data-o=ingredients] .ingredient').evaluateAll(ls => ls.map(l => `${l.querySelector('.qte').textContent} ${l.querySelector('.nom').textContent.trim()}`));
  assert.deepEqual(lignes, ['500 g farine (T45)', '2 sachets levure chimique (11g)', '500 g carottes (8 petites)', '16 g levure fraîche (ou 6 g de levure sèche)']);
  assert.equal(await page.locator('.ajuster').count(), 0);
  assert.deepEqual(erreurs, []);
  await ctx.close();
});
