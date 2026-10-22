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
