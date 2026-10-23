// Liste de courses partagée : deux téléphones modifient courses.json en même temps.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const memoire = new Map();
globalThis.localStorage = { getItem: k => memoire.get(k) ?? null, setItem: (k, v) => memoire.set(k, String(v)), removeItem: k => memoire.delete(k) };
const C = await import('../js/courses.js');

// Faux dépôt : refuse une écriture faite sur une version périmée (comme l'API GitHub, 409).
const depot = { texte: null, sha: null, n: 0, avantEcriture: null };
const api = {
  lire: async () => (depot.texte === null ? null : { texte: depot.texte, sha: depot.sha }),
  ecrire: async (texte, sha) => {
    if (depot.avantEcriture) { const f = depot.avantEcriture; depot.avantEcriture = null; f(); }
    if ((sha ?? null) !== depot.sha) throw Object.assign(new Error('conflit'), { status: 409 });
    depot.texte = texte; depot.sha = `v${++depot.n}`;
    return depot.sha;
  },
};
// Ce que fait « l'autre téléphone » : il écrit directement une nouvelle version.
const autreTelephone = modifier => {
  const e = JSON.parse(depot.texte);
  modifier(e);
  depot.texte = JSON.stringify(e); depot.sha = `v${++depot.n}`;
};
const distant = () => JSON.parse(depot.texte);

test('première synchronisation : la liste du téléphone part dans le dépôt', async () => {
  C.ajouterArticle('2 citrons');           // avant connexion au dépôt : seulement sur le téléphone
  C.brancherDepot(api);
  assert.equal(await C.synchroniser(), true);
  assert.deepEqual(distant().ajouts.map(a => a.texte), ['2 citrons']);
});

test('modifications des deux côtés : rien n\'est écrasé', async () => {
  autreTelephone(e => { e.ajouts.push({ id: 'x', texte: 'lait' }); e.prevues.push({ slug: 'crepes', portions: 4 }); });
  C.ajouterArticle('farine');
  C.majArticle('citron', { coche: true });
  await C.synchroniser();
  assert.deepEqual(distant().ajouts.map(a => a.texte).sort(), ['2 citrons', 'farine', 'lait']);
  assert.deepEqual(distant().prevues, [{ slug: 'crepes', portions: 4 }]);
  assert.deepEqual(distant().articles.citron, { coche: true });
  assert.deepEqual(C.etat(), distant(), 'le téléphone voit la même liste');
});

test('version changée pendant l\'envoi : on rejoue nos opérations sur la nouvelle', async () => {
  C.prevoir('tarte', 6);
  depot.avantEcriture = () => autreTelephone(e => { e.ajouts.push({ id: 'y', texte: 'beurre' }); });
  await C.synchroniser();
  assert.ok(distant().ajouts.some(a => a.texte === 'beurre'));
  assert.ok(distant().prevues.some(p => p.slug === 'tarte'));
});

test('modification venue d\'ailleurs : la liste du téléphone suit et prévient l\'écran', async () => {
  let prevenu = 0;
  const fin = C.surChangement(() => prevenu++);
  autreTelephone(e => { e.ajouts = e.ajouts.filter(a => a.texte !== 'lait'); });
  assert.equal(await C.synchroniser(), true);
  assert.ok(!C.etat().ajouts.some(a => a.texte === 'lait'));
  assert.equal(prevenu, 1);
  assert.equal(await C.synchroniser(), false, 'rien de neuf');
  fin();
});

test('hors ligne : les opérations attendent et partent au retour', async () => {
  const ecrire = api.ecrire;
  api.ecrire = async () => { throw Object.assign(new Error('hors ligne'), { status: 0 }); };
  C.ajouterArticle('sel');
  await assert.rejects(C.synchroniser());
  assert.ok(C.etat().ajouts.some(a => a.texte === 'sel'), 'visible tout de suite sur le téléphone');
  api.ecrire = ecrire;
  await C.synchroniser();
  assert.ok(distant().ajouts.some(a => a.texte === 'sel'));
});

test('retirer les articles cochés, puis annuler', async () => {
  const sel = { cle: 'sel', details: [{ titre: 'Ajouté à la main', texte: 'sel', ajout: C.etat().ajouts.find(a => a.texte === 'sel').id }], quantites: [] };
  const sucre = { cle: 'sucre', details: [{ titre: 'Tarte', texte: '100 g sucre' }], quantites: [{ n: 100, unite: 'g' }] };
  C.majArticle('sucre', { coche: true });
  const annuler = C.supprimerArticles([sel, sucre]);
  await C.synchroniser();
  assert.ok(!distant().ajouts.some(a => a.texte === 'sel'), 'ajouté à la main : supprimé');
  assert.ok(distant().masques.sucre, 'venant d\'une recette : masqué');
  annuler();
  await C.synchroniser();
  assert.ok(distant().ajouts.some(a => a.texte === 'sel'));
  assert.equal(distant().masques.sucre, undefined);
  assert.deepEqual(distant().articles.sucre, { coche: true }, 'la case revient cochée');
});
