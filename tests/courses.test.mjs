import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRecipe } from '../js/format.js';
import { listeDeCourses, cleIngredient, nomCourses, formatQuantite, manque, texteQuantites, rayon } from '../js/courses.js';

const recette = (md, slug = 't') => parseRecipe(md, `recettes/${slug}.md`);
const fixture = f => recette(readFileSync(new URL(`./fixtures/${f}.md`, import.meta.url), 'utf8'), f);
const trouver = (liste, nom) => liste.find(a => a.nom === nom);

test('noms et clés : préparations ignorées, œ/oe et pluriels regroupés', () => {
  assert.equal(nomCourses('beurre fondu'), 'beurre');
  assert.equal(nomCourses('113 g beurre très froid'.replace(/^\d+ g /, '')), 'beurre');
  assert.equal(nomCourses('pommes Golden'), 'pommes Golden');
  assert.equal(nomCourses('jus de citron (environ 2 gros citrons)'), 'jus de citron');
  assert.equal(cleIngredient('Œufs'), cleIngredient('oeuf'));
  assert.equal(cleIngredient('gros œuf'), cleIngredient('œufs entiers'));
  assert.notEqual(cleIngredient('sucre glace'), cleIngredient('sucre'));
});

test('quantités : conversions et affichage', () => {
  assert.equal(formatQuantite(1500, 'g'), '1,5 kg');
  assert.equal(formatQuantite(1270, 'mL'), '1,27 L');
  assert.equal(formatQuantite(500, 'mL'), '50 cL');
  assert.equal(formatQuantite(6, 'c. à café'), '2 c. à soupe');
  assert.equal(formatQuantite(2, 'sachet'), '2 sachets');
});

test('liste : recettes additionnées et recalculées selon le nombre de personnes', () => {
  const a = recette('---\ntitre: A\nportions: 4\n---\n## Ingrédients\n- 200 g farine\n- 50 cL lait\n- 2 œufs\n- 1 c. à soupe sucre\n- sel\n- 100 mL eau\n', 'a');
  const b = recette('---\ntitre: B\nportions: 2\n---\n## Ingrédients\n- 0,5 kg de farine\n- 25 cL lait\n- 1 gros œuf\n- 30 g sucre\n- 600-800 g porc\n', 'b');
  const l = listeDeCourses([{ recette: a, portions: 8 }, { recette: b, portions: 2 }]);
  assert.equal(texteQuantites(trouver(l, 'Farine')), '900 g');           // 400 g + 500 g
  assert.equal(texteQuantites(trouver(l, 'Lait')), '1,25 L');            // 1 L + 25 cL
  assert.equal(texteQuantites(trouver(l, 'Œufs')), '5');                 // 4 + 1
  assert.equal(texteQuantites(trouver(l, 'Sucre')), '30 g + 2 c. à soupe');
  assert.equal(texteQuantites(trouver(l, 'Porc')), '800 g', 'fourchette : on prend le haut');
  assert.ok(trouver(l, 'Sel').sansQuantite);
  assert.ok(!l.some(x => /^eau/i.test(x.nom)), 'l\'eau du robinet n\'est pas sur la liste');
  assert.deepEqual(trouver(l, 'Farine').details.map(d => d.titre), ['A', 'B']);
});

test('recette sans nombre de personnes : multipliée par le nombre de fois', () => {
  const t = recette('---\ntitre: Tarte\n---\n## Ingrédients\n- 100 g beurre\n', 'tarte');
  assert.equal(texteQuantites(listeDeCourses([{ recette: t, portions: 2 }])[0]), '200 g');
});

test('ce qu\'il manque, une fois retiré ce qu\'on a déjà', () => {
  const [beurre] = listeDeCourses([{ recette: recette('---\ntitre: X\nportions: 1\n---\n## Ingrédients\n- 785 g beurre\n'), portions: 1 }]);
  assert.deepEqual(manque(beurre, 500), { n: 285, unite: 'g' });
  assert.deepEqual(manque(beurre, 1000), { n: 0, unite: 'g' });
  assert.equal(manque(beurre, 0), null);
});

test('rayons', () => {
  assert.equal(rayon(cleIngredient('sauce soja sucrée')), 'Épicerie salée');
  assert.equal(rayon(cleIngredient('sucre roux')), 'Épicerie sucrée');
  assert.equal(rayon(cleIngredient('jus de citron')), 'Fruits et légumes');
  assert.equal(rayon(cleIngredient('beurre demi-sel')), 'Crèmerie');
  assert.equal(rayon(cleIngredient('filet mignon')), 'Viandes et poissons');
  assert.equal(rayon(cleIngredient('truc inconnu')), 'Autres');
});

test('recettes d\'exemple : liste cohérente', () => {
  const l = listeDeCourses([{ recette: fixture('cinnamon-rolls'), portions: 24 }]);
  assert.equal(texteQuantites(trouver(l, 'Beurre')), '452 g');   // (113 + 113) × 2
  assert.equal(texteQuantites(trouver(l, 'Farine')), '1,08 kg + 2 c. à soupe');
});

test('articles ajoutés à la main : seuls, additionnés aux recettes, eau gazeuse gardée', () => {
  const t = recette('---\ntitre: Tarte\nportions: 2\n---\n## Ingrédients\n- 2 citrons\n- 100 g sucre\n- 10 cL eau\n', 'tarte');
  const l = listeDeCourses([{ recette: t, portions: 2 }], [
    { id: 'a', texte: '3 citrons' },
    { id: 'b', texte: 'papier cuisson' },
    { id: 'c', texte: '1 L eau gazeuse' },
  ]);
  assert.equal(texteQuantites(trouver(l, 'Citrons')), '5');
  assert.deepEqual(trouver(l, 'Citrons').details.map(d => d.titre), ['Tarte', 'Ajouté à la main']);
  assert.equal(trouver(l, 'Citrons').details[1].ajout, 'a');
  const papier = trouver(l, 'Papier cuisson');
  assert.ok(papier.sansQuantite);
  assert.equal(papier.rayon, 'Autres');
  assert.equal(texteQuantites(trouver(l, 'Eau gazeuse')), '1 L');
  assert.ok(!l.some(x => x.nom === 'Eau'), 'l\'eau de la recette reste exclue');

  const seuls = listeDeCourses([], [{ id: 'x', texte: '500 g farine' }]);
  assert.equal(seuls.length, 1);
  assert.equal(seuls[0].rayon, 'Épicerie sucrée');
  assert.deepEqual(listeDeCourses([], []), []);
});

test('formatQuantite : jamais arrondi vers le bas, unités naturelles', () => {
  assert.equal(formatQuantite(1500, 'g'), '1,5 kg');
  assert.equal(formatQuantite(452, 'g'), '452 g');
  assert.equal(formatQuantite(250, 'mL'), '25 cL');
  assert.equal(formatQuantite(1200, 'mL'), '1,2 L');
  assert.equal(formatQuantite(6, 'c. à café'), '2 c. à soupe');
  assert.equal(formatQuantite(2.01, ''), '2,1');
  assert.equal(formatQuantite(2, 'sachet'), '2 sachets');
});

test('nomCourses et cleIngredient', () => {
  assert.equal(nomCourses('beurre fondu (pour le moule)'), 'beurre');
  assert.equal(nomCourses('de farine'), 'farine');
  assert.equal(cleIngredient('Œufs'), cleIngredient('oeuf'));
  assert.equal(cleIngredient('pommes'), cleIngredient('pomme'));
});

test('liste gardée sur le téléphone : prévoir, ajouter, retirer', async () => {
  const memoire = new Map();
  globalThis.localStorage = { getItem: k => memoire.get(k) ?? null, setItem: (k, v) => memoire.set(k, String(v)) };
  const C = await import('../js/courses.js');
  assert.deepEqual(C.etat(), { prevues: [], ajouts: [], articles: {}, masques: {} });
  // Ancienne liste (avant les articles à la main) : relue sans erreur.
  memoire.set('mr.courses', JSON.stringify({ prevues: [{ slug: 'a', portions: 2 }], articles: {} }));
  assert.deepEqual(C.etat().ajouts, []);
  C.prevoir('a', 4); C.prevoir('b', 1);
  assert.deepEqual(C.etat().prevues, [{ slug: 'a', portions: 4 }, { slug: 'b', portions: 1 }]);
  assert.ok(C.estPrevue('b'));
  C.retirer('b');
  assert.ok(!C.estPrevue('b'));
  C.ajouterArticle('  2 citrons ');
  C.ajouterArticle('   ');
  const [ajout] = C.etat().ajouts;
  assert.equal(C.etat().ajouts.length, 1, 'une ligne vide n\'ajoute rien');
  assert.equal(ajout.texte, '2 citrons');
  C.retirerArticle(ajout.id);
  assert.deepEqual(C.etat().ajouts, []);
  delete globalThis.localStorage;
});

test('retirer un article d\'un glissement : supprimé, masqué, revient si les quantités changent, annulable', async () => {
  const memoire = new Map();
  globalThis.localStorage = { getItem: k => memoire.get(k) ?? null, setItem: (k, v) => memoire.set(k, String(v)) };
  const C = await import('../js/courses.js');
  const t = recette('---\ntitre: Tarte\nportions: 2\n---\n## Ingrédients\n- 100 g sucre\n- 2 citrons\n', 'tarte');
  const liste = (portions = 2) => C.listeDeCourses([{ recette: t, portions }], C.etat().ajouts)
    .filter(a => !C.estMasque(a, C.etat().masques));

  // Article ajouté à la main : vraiment supprimé.
  C.ajouterArticle('papier cuisson');
  const annuler = C.supprimerArticle(trouver(liste(), 'Papier cuisson'));
  assert.deepEqual(C.etat().ajouts, []);
  annuler();
  assert.equal(C.etat().ajouts.length, 1, 'annuler le remet');

  // Article d'une recette : masqué tant que rien ne change…
  C.supprimerArticle(trouver(liste(), 'Sucre'));
  assert.equal(trouver(liste(), 'Sucre'), undefined);
  assert.ok(trouver(liste(), 'Citrons'));
  // … mais revient si on prévoit plus de personnes (il en faut davantage).
  assert.equal(texteQuantites(trouver(liste(4), 'Sucre')), '200 g');
  delete globalThis.localStorage;
});
