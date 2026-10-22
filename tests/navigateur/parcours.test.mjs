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
let fichiers;   // chemin → Buffer
let ecritures;  // [{ methode, chemin, message, contenu }]
let requetesSansJeton;

function depotInitial() {
  fichiers = new Map();
  const dir = join(RACINE, 'tests/fixtures');
  for (const f of readdirSync(dir)) fichiers.set(`recettes/${f}`, readFileSync(join(dir, f)));
  ecritures = [];
  requetesSansJeton = 0;
}

async function fauxGitHub(route) {
  const req = route.request();
  const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (req.headers().authorization !== `Bearer ${JETON}`) { requetesSansJeton++; return json({ message: 'Bad credentials' }, 401); }
  const p = new URL(req.url()).pathname.replace(`/repos/${DEPOT}`, '');
  if (p === '') return json({ default_branch: 'main', full_name: DEPOT, private: true, permissions: { push: true } });
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

async function nouvellePage({ configure = true } = {}) {
  ctx = await navigateur.newContext({ ...devices['Pixel 7'], locale: 'fr-FR', serviceWorkers: 'allow' });
  await ctx.route('https://api.github.com/**', fauxGitHub);
  page = await ctx.newPage();
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
  await page.waitForTimeout(300);
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
  navigateur = await chromium.launch();
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
  await glisser('#contenu', 'gauche');
  assert.equal(await ongletActif(), 'Étapes');
  await glisser('#contenu', 'gauche');
  assert.equal(await ongletActif(), 'Notes');
  await glisser('#contenu', 'droite');
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
