import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nonRecalcule, nomIngredient, listePhotos, parseRecipe, serializeRecipe, parseIngredient, formatQty, detectTimers, flatSteps, ingredientsForStep, textToGroups, slugify } from '../js/format.js';

const DIR = new URL('./fixtures/', import.meta.url).pathname;

test('ingrédients', () => {
  const t = (s, qty, unit, name) => { const i = parseIngredient(s); assert.deepEqual([i.qty, i.unit, i.name], [qty, unit, name], s); };
  t('200 g farine', 200, 'g', 'farine');
  t('540g de farine', 540, 'g', 'farine');
  t('270mL de lait', 270, 'mL', 'lait');
  t('3 cuillères à soupe de cannelle en poudre', 3, 'c. à soupe', 'cannelle en poudre');
  t('1 gousse d\'ail', 1, 'gousse', 'ail');
  t('6 pommes Golden', 6, '', 'pommes Golden');
  t('6 gros œufs', 6, '', 'gros œufs');
  t('1/2 citron', 0.5, '', 'citron');
  t('1,5 L de bouillon', 1.5, 'L', 'bouillon');
  t('sel, poivre', null, '', 'sel, poivre');
  t('2 c. à s. d\'huile', 2, 'c. à soupe', 'huile');
  t('une pincée de sel', 1, 'pincée', 'sel');
  t('deux oeufs', 2, '', 'oeufs');
  t('un peu de sel', null, '', 'un peu de sel');
});

test('recalcul des portions', () => {
  assert.equal(formatQty(parseIngredient('200 g farine'), 1.5), '300 g');
  assert.equal(formatQty(parseIngredient('1 pincée sel'), 2), '2 pincées');
  assert.equal(formatQty(parseIngredient('3 oeufs'), 0.5), '1½');
  assert.equal(formatQty(parseIngredient('8 g levure'), 0.5), '4 g');
  assert.equal(formatQty(parseIngredient('113 g beurre'), 1), '113 g');
  assert.equal(formatQty(parseIngredient('1,5 L lait'), 1), '1,5 L');
  assert.equal(formatQty(parseIngredient('2-3 c. à soupe crème'), 2), '4–6 c. à soupe');
});

test('minuteurs', () => {
  assert.deepEqual(detectTimers('laisser 10 min à température ambiante').map(t => t.secondes), [600]);
  assert.deepEqual(detectTimers('four à 35-40 °C pendant 1 h').map(t => t.secondes), [3600]);
  assert.deepEqual(detectTimers('compter 20-22 min de cuisson, vers 15 min').map(t => t.secondes), [1200, 900]);
  assert.deepEqual(detectTimers('cuire 1h30').map(t => t.secondes), [5400]);
  assert.deepEqual(detectTimers('un rectangle de 50 × 30 cm').length, 0);
});

test('aller-retour des recettes d\'exemple', () => {
  for (const f of ['cinnamon-rolls.md', 'tarte-tatin.md', 'risotto-aux-champignons.md']) {
    const txt = readFileSync(DIR + f, 'utf8');
    const r = parseRecipe(txt, 'recettes/' + f);
    assert.ok(r.meta.titre && r.ingredients.length && r.etapes.length, f);
    const again = parseRecipe(serializeRecipe(r), r.path);
    assert.deepEqual(again, r, f);
  }
});

test('cinnamon rolls', () => {
  const r = parseRecipe(readFileSync(DIR + 'cinnamon-rolls.md', 'utf8'), 'recettes/cinnamon-rolls.md');
  assert.equal(r.slug, 'cinnamon-rolls');
  assert.equal(r.meta.portions, 12);
  assert.equal(r.meta.repos, 80);
  assert.deepEqual(r.ingredients.map(g => g.group), ['Pour la pâte à brioche', 'Pour la garniture', 'Pour le glaçage']);
  const steps = flatSteps(r);
  assert.equal(steps.length, 18);
  const glacage = ingredientsForStep(r, steps[16]).map(i => i.name);
  assert.deepEqual(glacage, ['sucre glace', 'beurre fondu', 'sucre vanillé']);
  const garniture = ingredientsForStep(r, steps[9]).map(i => i.name);
  assert.ok(garniture.includes('cannelle en poudre') && garniture.includes('sucre roux') && !garniture.includes('sucre glace'));
});

test('ingrédients d\'une étape : quantité citée et homonymes', () => {
  const r = parseRecipe(`## Ingrédients
- 540 g farine
- 8 g levure
- 1 c. à soupe sucre (pour la levure)
- 1 c. à soupe farine (pour la levure)
- 90 g sucre
- 100 g beurre froid
- 50 g beurre demi-sel

## Étapes
1. Ajouter 1 c. à soupe de sucre, 1 c. à soupe de farine et la levure.
2. Mélanger la farine et le sucre.
3. Sabler avec le beurre froid.
`, 'recettes/t.md');
  const [e1, e2, e3] = flatSteps(r).map(s => ingredientsForStep(r, s).map(i => i.raw));
  assert.deepEqual(e1, ['8 g levure', '1 c. à soupe sucre (pour la levure)', '1 c. à soupe farine (pour la levure)']);
  assert.deepEqual(e2, ['540 g farine', '90 g sucre']);
  assert.deepEqual(e3, ['100 g beurre froid']);
});

test('formulaire', () => {
  assert.deepEqual(textToGroups('Pour la pâte :\n- 200 g farine\n\n### Sauce\n2 oeufs'), [
    { group: 'Pour la pâte', items: ['200 g farine'] }, { group: 'Sauce', items: ['2 oeufs'] }]);
  assert.equal(slugify('Velouté de potimarron & châtaignes'), 'veloute-de-potimarron-chataignes');
});

test('photos : nouvelle liste et ancien champ « photo »', () => {
  assert.deepEqual(listePhotos({ photo: 'photos/a.jpg' }), ['photos/a.jpg']);
  assert.deepEqual(listePhotos({ photos: ['photos/a.jpg', 'photos/a-2.jpg'] }), ['photos/a.jpg', 'photos/a-2.jpg']);
  assert.deepEqual(listePhotos({ photos: ['photos/b.jpg'], photo: 'photos/a.jpg' }), ['photos/b.jpg']);
  assert.deepEqual(listePhotos({}), []);
  const r = parseRecipe('---\ntitre: T\nphotos: [photos/t.jpg, photos/t-2.jpg]\n---\n## Ingrédients\n- 1 oeuf\n', 'recettes/t.md');
  assert.match(serializeRecipe(r), /\nphotos: \[photos\/t\.jpg, photos\/t-2\.jpg\]\n/);
});

test('carnet : lu et réécrit à l\'identique, la plus récente en premier', async () => {
  const { parseRecipe, serializeRecipe, lireNoteCarnet, ecrireNoteCarnet } = await import('../js/format.js');
  const md = '---\ntitre: Cake\nportions: 8\nmoule: rectangle 26 x 10 cm\n---\n\n## Ingrédients\n- 200 g farine\n\n## Étapes\n1. Cuire.\n\n## Notes\n\nMeilleur le lendemain.\n\n## Carnet\n\n- 2026-10-12 · Réussi · moule rond 28 cm · four 170 °C · 12 pers. : Pousse 1 h 30 près du radiateur.\n- 2026-09-28 · À ajuster : Glaçage trop liquide.\n- 2026-09-02\n';
  const r = parseRecipe(md, 'recettes/cake.md');
  assert.equal(r.notes, 'Meilleur le lendemain.', 'le carnet ne se mélange pas aux notes');
  assert.equal(r.carnet.length, 3);
  assert.deepEqual(r.carnet[0], { date: '2026-10-12', avis: 'Réussi', moule: 'rond 28 cm', four: '170 °C', personnes: 12, texte: 'Pousse 1 h 30 près du radiateur.' });
  assert.deepEqual(r.carnet[2], { date: '2026-09-02', avis: '', moule: '', four: '', personnes: '', texte: '' });
  assert.equal(serializeRecipe(r), md, 'réécrit à l\'identique');
  assert.equal(r.meta.moule, 'rectangle 26 x 10 cm');
  // Le texte peut contenir « · » et « : » sans casser la ligne.
  const n = { date: '2026-10-23', avis: 'Raté', moule: '', four: '', personnes: 4, texte: 'Trop cuit : 10 min de moins · four trop chaud' };
  assert.deepEqual(lireNoteCarnet(ecrireNoteCarnet(n)), n);
  assert.equal(lireNoteCarnet('- pas une date'), null);
});

test('moule : formes, surfaces et facteur des quantités', async () => {
  const { lireMoule, facteurMoule, texteMoule } = await import('../js/format.js');
  assert.deepEqual(lireMoule('rond 24 cm'), { forme: 'rond', a: 24, b: 24 });
  assert.deepEqual(lireMoule('Ø 24'), { forme: 'rond', a: 24, b: 24 });
  assert.deepEqual(lireMoule('carré 20 cm'), { forme: 'carré', a: 20, b: 20 });
  assert.deepEqual(lireMoule('rectangle 30 x 20 cm'), { forme: 'rectangle', a: 30, b: 20 });
  assert.deepEqual(lireMoule('rectangle 22,5x11'), { forme: 'rectangle', a: 22.5, b: 11 });
  assert.equal(lireMoule('grand'), null);
  assert.equal(facteurMoule(lireMoule('rond 24'), lireMoule('rond 28')).toFixed(2), '1.36');
  assert.equal(facteurMoule(lireMoule('rond 24'), lireMoule('rond 24')), 1);
  assert.equal(facteurMoule(lireMoule('carré 20'), lireMoule('rectangle 30 x 20')), 1.5);
  assert.equal(texteMoule(lireMoule('rectangle 22,5 x 11')), 'rectangle 22,5 x 11 cm');
});

test('minuteurs : nommés d\'après le verbe devant la durée', () => {
  const noms = t => detectTimers(t).map(x => `${x.nom || '—'} · ${x.texte}`);
  assert.deepEqual(noms('Ajouter la cannelle, fouetter vitesse moyenne 1 minute). Ajouter la farine. Fouetter encore en vitesse moyenne 1 minute. Enfin ajouter l\'huile. Fouetter encore 1 minute vitesse moyenne.'),
    ['Fouetter · 1 minute', 'Fouetter encore · 1 minute', 'Fouetter encore (2) · 1 minute']);
  assert.deepEqual(noms('Verser 80 mL de pâte et cuire environ 2 min : quand c\'est doré, retourner et cuire encore 1 min.'),
    ['Cuire · 2 min', 'Cuire encore · 1 min']);
  // « à partir de » n'est pas une action ; sans verbe, pas de nom.
  assert.deepEqual(noms('Enfourner 55 minutes (vérifier la cuisson à partir de 45 minutes).'), ['Enfourner · 55 minutes', 'Vérifier · 45 minutes']);
  assert.deepEqual(noms('Enfourner à 200 °C pendant 20 min, puis à 180 °C pendant 10 min.'), ['Enfourner · 20 min', '— · 10 min']);
  assert.deepEqual(noms('Ajouter le sucre 5 min.'), ['Ajouter · 5 min'], '« sucre » n\'est pas un verbe');
});

test('« à ajuster » : seulement les nombres que l\'app ne recalcule pas', () => {
  const aAjuster = l => nonRecalcule(parseIngredient(l));
  // Quantité en début de ligne, recalculée ; parenthèses et « T45 » ne sont que des précisions.
  for (const l of ['250 grammes farine (T45)', '1 sachet levure chimique (11g)', '250 grammes carottes (4 petites)', '1 pot yaourt (125 g)', 'farine T55', '3 oeufs', 'sel'])
    assert.equal(aAjuster(l), false, l);
  // Quantité ailleurs qu'en début de ligne : l'app ne sait pas la recalculer.
  for (const l of ['Lait : 50 cL', 'Farine : 200 g', '2 œufs + 1 jaune', 'sucre, environ 30 g'])
    assert.equal(aAjuster(l), true, l);
});

test('équivalences entre parenthèses recalculées, pas le contenu d\'un sachet ou d\'un pot', () => {
  const nom = (l, k) => nomIngredient(parseIngredient(l), k);
  assert.equal(nom('8 g levure fraîche (ou 3 g de levure sèche)', 2), 'levure fraîche (ou 6 g de levure sèche)');
  assert.equal(nom('250 grammes carottes (4 petites)', 1.5), 'carottes (6 petites)');
  assert.equal(nom('40 g poudre d\'amandes (ou 30 g de farine)', 0.5), 'poudre d\'amandes (ou 15 g de farine)');
  assert.equal(nom('150 g jus de citron (environ 2 gros citrons)', 2), 'jus de citron (environ 4 gros citrons)');
  assert.equal(nom('1 sachet levure chimique (11g)', 2), 'levure chimique (11g)', 'par sachet');
  assert.equal(nom('1 pot yaourt (125 g)', 2), 'yaourt (125 g)', 'par pot');
  assert.equal(nom('250 grammes farine (T45)', 2), 'farine (T45)');
  assert.equal(nom('8 g levure fraîche (ou 3 g de levure sèche)', 1), 'levure fraîche (ou 3 g de levure sèche)');
  assert.equal(nom('sel', 2), 'sel');
});

test('unités écrites en entier, cuillère rase', () => {
  const p = l => { const i = parseIngredient(l); return [i.qty, i.unit, i.name]; };
  assert.deepEqual(p('10 centilitres huile'), [10, 'cL', 'huile']);
  assert.deepEqual(p('250 millilitres lait'), [250, 'mL', 'lait']);
  assert.deepEqual(p('2 décilitres crème'), [2, 'dL', 'crème']);
  assert.deepEqual(p('1 kilogramme pommes'), [1, 'kg', 'pommes']);
  assert.deepEqual(p('1 cuillère à café rase cannelle'), [1, 'c. à café', 'cannelle (rase)']);
  assert.deepEqual(p('2 c. à soupe bombées de sucre'), [2, 'c. à soupe', 'sucre (bombées)']);
});
