import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireCommande, texteALire } from '../js/voix.js';

test('commandes vocales : seulement après « recette »', () => {
  const cas = {
    'Recette, suivante': 'suivante',
    'recette suivant': 'suivante',
    'Recette, passe à l\'étape suivante': 'suivante',
    'recettes suivante': 'suivante',
    'Recette, précédente': 'precedente',
    'recette reviens en arrière': 'precedente',
    'Recette, lance le minuteur': 'minuteur',
    'recette démarre le chrono': 'minuteur',
    'Recette, mets en pause le minuteur': 'pause',
    'Recette, arrête le minuteur': 'stop',
    'recette stop': 'stop',
    'Recette, relis': 'relis',
    'recette répète': 'relis',
    'Recette, relis les ingrédients': 'ingredients',
    'recette les ingrédients': 'ingredients',
    // Sans « recette », ou « recette » dans une phrase : rien.
    'suivante': null,
    'lance le minuteur': null,
    'cette recette est bonne et après on verra': null,
    'recette': null,
    'Recette, bonjour': null,
    '': null,
  };
  for (const [dit, attendu] of Object.entries(cas)) assert.equal(lireCommande(dit), attendu, dit);
});

test('texte lu à voix haute : sans le Markdown', () => {
  assert.equal(texteALire('Cuire **12 min**  à  `180 °C`'), 'Cuire 12 min à 180 °C');
});
