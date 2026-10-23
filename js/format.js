// Lecture / écriture du format recette (front matter YAML + Markdown),
// analyse des quantités et détection des minuteurs.
// Module sans dépendance au navigateur : testable avec `node --test`.

export const CATEGORIES = ['Plats', 'Desserts', 'Entrées', 'Végé', 'Apéro', 'Boissons', 'Petit-déj', 'Goûter', 'Sauces', 'Pains'];
const META_ORDER = ['titre', 'categorie', 'tags', 'portions', 'moule', 'preparation', 'cuisson', 'repos', 'difficulte', 'photo', 'photos', 'source', 'ajoutee'];

/* ---------- utilitaires ---------- */

export function sansAccents(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function slugify(s) {
  return sansAccents(s).toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'recette';
}

/* ---------- front matter (sous-ensemble YAML) ---------- */

function parseScalar(v) {
  v = v.trim();
  if (v === '') return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    if (v[0] === '"') { try { return JSON.parse(v); } catch { /* tombe sur le cas simple */ } }
    return v.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  return v;
}

function stripComment(v) {
  // Un commentaire YAML commence par « # » précédé d'un espace, hors guillemets.
  let q = null;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(v[i - 1]))) return v.slice(0, i);
  }
  return v;
}

function splitFlowList(s) {
  const out = []; let cur = ''; let q = null;
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === ',') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map(parseScalar).filter(x => x !== '');
}

export function parseFrontMatter(yaml) {
  const meta = {};
  let lastKey = null;
  for (const raw of yaml.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = raw.match(/^\s+-\s*(.*)$/);
    if (item && lastKey) {
      if (!Array.isArray(meta[lastKey])) meta[lastKey] = [];
      meta[lastKey].push(parseScalar(stripComment(item[1])));
      continue;
    }
    const m = raw.match(/^([A-Za-zÀ-ÿ_][\wÀ-ÿ-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    lastKey = m[1];
    const v = stripComment(m[2]).trim();
    if (v.startsWith('[') && v.endsWith(']')) meta[lastKey] = splitFlowList(v.slice(1, -1));
    else meta[lastKey] = parseScalar(v);
  }
  return meta;
}

function yamlValue(v) {
  if (Array.isArray(v)) return '[' + v.map(yamlValue).join(', ') + ']';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v ?? '');
  if (s === '') return '""';
  if (/^[\wÀ-ſ][\wÀ-ſ .,'’()\/-]*$/.test(s) && !/^(true|false|null|-?\d+(\.\d+)?)$/.test(s)) return s;
  if (/^https?:\/\/\S+$/.test(s) && !/\s#/.test(s)) return s;
  return JSON.stringify(s);
}

export function serializeFrontMatter(meta) {
  const keys = [...META_ORDER.filter(k => k in meta), ...Object.keys(meta).filter(k => !META_ORDER.includes(k))];
  return keys
    .filter(k => meta[k] !== undefined && meta[k] !== null && meta[k] !== '' && !(Array.isArray(meta[k]) && !meta[k].length))
    .map(k => `${k}: ${yamlValue(meta[k])}`).join('\n');
}

/* ---------- quantités ---------- */

const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+[½¼¾⅓⅔]|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛])`;

// Du plus long au plus court pour que « c. à soupe » passe avant « c ».
const UNITS = [
  ['cuillères? à soupe', 'c. à soupe'], ['cuillères? à café', 'c. à café'],
  ['cuil\\.? à soupe', 'c. à soupe'], ['cuil\\.? à café', 'c. à café'],
  ['c\\. ?à ?soupe', 'c. à soupe'], ['c\\. ?à ?café', 'c. à café'],
  ['c\\. ?à ?s\\.?', 'c. à soupe'], ['c\\. ?à ?c\\.?', 'c. à café'],
  ['càs', 'c. à soupe'], ['càc', 'c. à café'], ['cs', 'c. à soupe'], ['cc', 'c. à café'], ['cas', 'c. à soupe'], ['cac', 'c. à café'],
  ['kilogrammes?', 'kg'], ['kilos?', 'kg'], ['milligrammes?', 'mg'], ['kg', 'kg'], ['grammes?', 'g'], ['gr\\.?', 'g'], ['mg', 'mg'], ['g', 'g'],
  ['centilitres?', 'cL'], ['millilitres?', 'mL'], ['décilitres?', 'dL'], ['litres?', 'L'], ['dl', 'dL'], ['cl', 'cL'], ['ml', 'mL'], ['l', 'L'],
  ['pincées?', 'pincée'], ['sachets?', 'sachet'], ['pots?', 'pot'], ['verres?', 'verre'], ['tasses?', 'tasse'],
  ['gousses?', 'gousse'], ['tranches?', 'tranche'], ['boîtes?', 'boîte'], ['brins?', 'brin'], ['bottes?', 'botte'],
  ['feuilles?', 'feuille'], ['poignées?', 'poignée'], ['bouquets?', 'bouquet'], ['filets?', 'filet'],
  ['cubes?', 'cube'], ['noisettes?', 'noisette'], ['noix', 'noix'], ['rouleaux?', 'rouleau'], ['pâtons?', 'pâton'],
  ['zestes?', 'zeste'], ['bâtons?', 'bâton'], ['branches?', 'branche'], ['têtes?', 'tête'], ['traits?', 'trait'],
];
const UNIT_RE = new RegExp(`^(${UNITS.map(u => u[0]).join('|')})(?![a-zà-ÿœ])\\.?\\s*`, 'i');
const QTY_RE = new RegExp(`^(${NUM})(?:\\s*(?:-|–|à)\\s*(${NUM}))?\\s*`);
const INVARIABLES = new Set(['g', 'kg', 'mg', 'L', 'dL', 'cL', 'mL', 'c. à soupe', 'c. à café', 'noix']);

export function parseNumber(s) {
  s = s.trim();
  let m;
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
  if ((m = s.match(/^(\d+)([½¼¾⅓⅔])$/))) return +m[1] + FRACTIONS[m[2]];
  if (FRACTIONS[s] !== undefined) return FRACTIONS[s];
  return parseFloat(s.replace(',', '.'));
}

// « une pincée », « deux oeufs »… mais pas « un peu de », « une dizaine de ».
const MOTS_NOMBRES = ['un', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze'];
const MOT_RE = new RegExp(`^(${MOTS_NOMBRES.join('|')})\\s+(?!peu\\b|demi|dizaine|douzaine|quinzaine|vingtaine|trentaine|centaine)`, 'i');

export function parseIngredient(raw) {
  const text = raw.trim();
  let rest = text;
  const ing = { raw: text, qty: null, qtyMax: null, unit: '', name: text };
  const q = rest.match(QTY_RE);
  const mot = !q && rest.match(MOT_RE);
  if (!q && !mot) return ing;
  if (q) {
    ing.qty = parseNumber(q[1]);
    if (q[2]) ing.qtyMax = parseNumber(q[2]);
    rest = rest.slice(q[0].length);
  } else {
    ing.qty = Math.max(1, MOTS_NOMBRES.indexOf(mot[1].toLowerCase()));
    rest = rest.slice(mot[0].length);
  }
  const u = rest.match(UNIT_RE);
  if (u) {
    const found = UNITS.find(([re]) => new RegExp(`^(?:${re})$`, 'i').test(u[1]));
    ing.unit = found ? found[1] : u[1];
    rest = rest.slice(u[0].length);
  }
  // « 1 c. à café rase cannelle » : la précision de la cuillère va après le nom.
  const precision = rest.match(/^(rases?|bomb[ée]es?|pleines?)\s+/i);
  if (precision) rest = rest.slice(precision[0].length);
  rest = rest.replace(/^(de |d['’]\s*)/i, '');
  ing.name = rest.trim() + (precision ? ` (${precision[1].toLowerCase()})` : '');
  return ing;
}

function arrondi(n, unit) {
  if (['g', 'mL', 'mg'].includes(unit)) {
    if (n >= 100) return Math.round(n / 5) * 5;
    if (n >= 10) return Math.round(n);
    return Math.round(n * 10) / 10;
  }
  if (unit === 'cL') return Math.round(n * 2) / 2; // 11,25 cL → 11,5 cL
  if (['kg', 'L', 'dL'].includes(unit)) return Math.round(n * 100) / 100;
  // Unités « comptables » : on vise le quart le plus proche.
  const q = Math.round(n * 4) / 4;
  return q === 0 ? Math.round(n * 100) / 100 : q;
}

export function formatNumber(n, unit = '', exact = false) {
  // Quantité d'origine (exact) : affichée telle quelle ; recalculée : arrondie.
  const v = exact ? Math.round(n * 1000) / 1000 : arrondi(n, unit);
  const ent = Math.floor(v);
  const frac = Math.round((v - ent) * 100) / 100;
  const sym = { 0.25: '¼', 0.5: '½', 0.75: '¾' }[frac];
  if (sym && !['g', 'mL', 'mg', 'kg', 'L', 'dL', 'cL'].includes(unit)) return ent ? `${ent}${sym}` : sym;
  return String(v).replace('.', ',');
}

function pluriel(unit, n) {
  if (!unit || INVARIABLES.has(unit) || n <= 1) return unit;
  if (unit === 'rouleau') return 'rouleaux';
  return unit + 's';
}

/**
 * Vrai si la ligne contient un nombre que l'app ne sait pas recalculer
 * (« Farine : 200 g », « Lait : 50 cL ») : à ajuster à la main.
 * Ne comptent pas : ce qui est entre parenthèses, une précision (« farine (T45) »,
 * « 1 sachet levure (11 g) », « 250 g carottes (4 petites) »), ni un chiffre collé
 * à une lettre (« farine T55 »).
 */
export function nonRecalcule(ing) {
  const texte = (ing.qty == null ? ing.raw : ing.name).replace(/\([^)]*\)/g, '');
  return /(^|[^\p{L}\d])\d/u.test(texte);
}

// Unités qui mesurent la quantité elle-même : ce qui est entre parenthèses en est une autre écriture.
const MESURES = new Set(['g', 'kg', 'mg', 'L', 'dL', 'cL', 'mL', 'c. à soupe', 'c. à café', 'pincée']);
const UNITE_NOMBRE = { g: 'g', kg: 'kg', mg: 'mg', ml: 'mL', cl: 'cL', dl: 'dL', l: 'L' };

/**
 * Nom de l'ingrédient pour un facteur donné : les nombres entre parenthèses suivent quand ce sont
 * des équivalences (« 8 g levure fraîche (ou 3 g de levure sèche) », « 250 g carottes (4 petites) »,
 * « (environ 2 citrons) »), pas le contenu d'un contenant (« 1 sachet levure (11 g) » : par sachet).
 */
export function nomIngredient(ing, factor = 1) {
  if (ing.qty == null) return ing.raw;
  if (factor === 1) return ing.name;
  return ing.name.replace(/\(([^)]*)\)/g, (tout, dedans) => {
    if (!MESURES.has(ing.unit) && !/^\s*(ou|environ|env\.|soit|~)/i.test(dedans)) return tout;
    return `(${dedans.replace(/(^|[^\p{L}\d])(\d+(?:[.,]\d+)?)(\s*)(kg|mg|g|ml|cl|dl|l)?(?![\p{L}\d])/giu,
      (m, avant, n, esp, u) => `${avant}${formatNumber(parseFloat(n.replace(',', '.')) * factor, UNITE_NOMBRE[(u || '').toLowerCase()] || '')}${esp}${u || ''}`)})`;
  });
}

/** Quantité formatée (« 200 g », « 1½ c. à soupe ») pour un facteur donné. */
/**
 * Quantité adaptée telle qu'affichée sur la fiche (arrondie, sauf sans changement de personnes) :
 * la liste de courses additionne exactement ces nombres-là.
 */
export const quantiteAdaptee = (n, unit, factor = 1) => (factor === 1 ? n : arrondi(n * factor, unit));

export function formatQty(ing, factor = 1) {
  if (ing.qty == null) return '';
  const a = ing.qty * factor;
  const exact = factor === 1;
  let s = formatNumber(a, ing.unit, exact);
  if (ing.qtyMax != null) s += '–' + formatNumber(ing.qtyMax * factor, ing.unit, exact);
  const unit = pluriel(ing.unit, ing.qtyMax != null ? ing.qtyMax * factor : a);
  return unit ? `${s} ${unit}` : s;
}

/* ---------- minuteurs ---------- */

const DUREE_RE = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|à)\s*(\d+(?:[.,]\d+)?))?\s*(heures?|h|minutes?|min|mn)(?![a-zà-ÿ])(?:\s*(\d{1,2})(?!\s*(?:°|%|\d)))?/gi;

/** Durées trouvées dans le texte d'une étape : [{ secondes, texte, index }]. */
export function detectTimers(text) {
  const out = [];
  for (const m of String(text).matchAll(DUREE_RE)) {
    const n = parseFloat(m[1].replace(',', '.'));
    const unit = m[3].toLowerCase();
    let sec = unit.startsWith('h') ? n * 3600 : n * 60;
    if (unit.startsWith('h') && m[4] && !m[2]) sec += parseInt(m[4], 10) * 60;
    else if (m[4]) continue; // « 5 min 30 » ambigu après une plage : on ignore la fin
    if (sec > 0 && sec <= 24 * 3600) out.push({ secondes: Math.round(sec), texte: m[0].trim(), index: m.index, fin: m.index + m[0].length });
  }
  nommerMinuteurs(String(text), out);
  return out;
}

// Mots en -er/-ir/-re qui ne sont pas des verbes d'action (« à partir de », « le sucre »…).
const PAS_VERBES = new Set('amer autre beurre centre encore cher cidre contre cuiller dernier desir entier entre fer hiver leger libre litre maitre membre mer nombre notre ordre panier papier partir plaisir poivre premier propre saladier sombre sucre tiroir verre votre'.split(' '));
const verbe = mot => /^\p{L}{3,}(er|ir|re|ez)$/iu.test(mot) && !PAS_VERBES.has(sansAccents(mot).toLowerCase());

/**
 * Nom de chaque minuteur : le dernier verbe juste avant la durée, dans le même bout de phrase
 * (« … et cuire encore 1 min » → « Cuire encore »). Sans verbe : nom vide.
 * Deux minuteurs au même nom : « Fouetter encore », « Fouetter encore (2) ».
 */
function nommerMinuteurs(texte, minuteurs) {
  let debut = 0;
  const vus = {};
  for (const t of minuteurs) {
    const avant = texte.slice(debut, t.index);
    debut = t.fin;
    const morceau = avant.slice(Math.max(...['.', ';', ':', '!', '?', '(', ')', ','].map(c => avant.lastIndexOf(c))) + 1);
    const mots = morceau.replace(/\*\*/g, '').split(/[\s'’]+/).filter(Boolean);
    let k = mots.length - 1;
    while (k >= 0 && !verbe(mots[k])) k--;
    if (k < 0) { t.nom = ''; continue; }
    let nom = mots[k] + (/^encore$/i.test(mots[k + 1] || '') ? ' encore' : '');
    nom = nom[0].toUpperCase() + nom.slice(1).toLowerCase();
    const cle = `${nom}|${t.texte}`;
    vus[cle] = (vus[cle] || 0) + 1;
    t.nom = vus[cle] > 1 ? `${nom} (${vus[cle]})` : nom;
  }
}

export function formatDuree(minutes) {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/* ---------- corps Markdown ---------- */

function sectionKey(title) {
  const t = sansAccents(title).toLowerCase();
  if (t.startsWith('ingredient')) return 'ingredients';
  if (t.startsWith('etape') || t.startsWith('preparation') || t.startsWith('instruction')) return 'etapes';
  if (t.startsWith('note') || t.startsWith('astuce') || t.startsWith('conseil')) return 'notes';
  if (t.startsWith('carnet')) return 'carnet';
  return null;
}

function parseGroupedList(lines, ordered) {
  const groups = [];
  let cur = { group: '', items: [] };
  const push = () => { if (cur.items.length || cur.group) groups.push(cur); };
  for (const line of lines) {
    const h = line.match(/^#{3,6}\s+(.*)$/);
    if (h) { push(); cur = { group: h[1].trim(), items: [] }; continue; }
    const it = line.match(ordered ? /^\s*(?:\d+[.)]|[-*+])\s+(.*)$/ : /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (it) { cur.items.push(it[1].trim()); continue; }
    if (line.trim() && cur.items.length && /^\s+\S/.test(line)) { cur.items[cur.items.length - 1] += ' ' + line.trim(); continue; }
    if (line.trim()) cur.items.push(line.trim());
  }
  push();
  return groups.filter(g => g.items.length || g.group);
}

export function parseRecipe(text, path = '') {
  text = text.replace(/^﻿/, '');
  let meta = {}, body = text;
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) { meta = parseFrontMatter(fm[1]); body = text.slice(fm[0].length); }
  const sections = { ingredients: [], etapes: [], notes: [], carnet: [] };
  const autres = [];
  let cible = null;
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      const k = sectionKey(h[1]);
      if (k) cible = sections[k];
      else { autres.push(line); cible = autres; }
      continue;
    }
    if (line.match(/^#\s+/) && !meta.titre) { meta.titre = line.replace(/^#\s+/, '').trim(); continue; }
    (cible || sections.notes).push(line);
  }
  const slug = path ? path.split('/').pop().replace(/\.md$/i, '') : slugify(meta.titre || '');
  if (!Array.isArray(meta.tags)) meta.tags = meta.tags ? String(meta.tags).split(',').map(s => s.trim()).filter(Boolean) : [];
  const ingredients = parseGroupedList(sections.ingredients, false)
    .map(g => ({ group: g.group, items: g.items.map(parseIngredient) }));
  const etapes = parseGroupedList(sections.etapes, true);
  const notes = [...sections.notes, ...(autres.length ? ['', ...autres] : [])].join('\n').trim();
  const carnet = sections.carnet.map(lireNoteCarnet).filter(Boolean);
  return { slug, path, meta: { titre: slug, ...meta }, ingredients, etapes, notes, carnet };
}

export function serializeRecipe(r) {
  const out = ['---', serializeFrontMatter(r.meta), '---', ''];
  out.push('## Ingrédients');
  for (const g of r.ingredients) {
    if (g.group) out.push('', `### ${g.group}`);
    for (const i of g.items) out.push(`- ${typeof i === 'string' ? i : i.raw}`);
  }
  out.push('', '## Étapes');
  let n = 1;
  for (const g of r.etapes) {
    if (g.group) out.push('', `### ${g.group}`);
    for (const s of g.items) out.push(`${n++}. ${s}`);
  }
  if (r.notes && r.notes.trim()) out.push('', '## Notes', '', r.notes.trim());
  if (r.carnet?.length) out.push('', '## Carnet', '', ...r.carnet.map(ecrireNoteCarnet));
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

/* ---------- carnet de la recette ---------- */

// Une ligne par fois cuisinée, la plus récente en premier :
// « - 2026-10-12 · Réussi · moule rond 28 cm · four 170 °C · 12 pers. : Pousse 1 h 30 près du radiateur. »
export const AVIS = ['Réussi', 'À ajuster', 'Raté'];

export function lireNoteCarnet(ligne) {
  const m = ligne.match(/^\s*[-*+]\s+(\d{4}-\d{2}-\d{2})(.*)$/);
  if (!m) return null;
  let reste = m[2];
  let texte = '';
  const deuxPoints = reste.indexOf(' : ');
  if (deuxPoints !== -1) { texte = reste.slice(deuxPoints + 3).trim(); reste = reste.slice(0, deuxPoints); }
  const note = { date: m[1], avis: '', moule: '', four: '', personnes: '', texte };
  for (const morceau of reste.split(' · ').map(s => s.trim()).filter(Boolean)) {
    if (/^moule\s/i.test(morceau)) note.moule = morceau.replace(/^moule\s+/i, '');
    else if (/^four\s/i.test(morceau)) note.four = morceau.replace(/^four\s+/i, '');
    else if (/^\d+\s*pers\.?$/i.test(morceau)) note.personnes = parseInt(morceau, 10);
    else note.avis = morceau;
  }
  return note;
}

export function ecrireNoteCarnet(n) {
  const morceaux = [n.date, n.avis, n.moule && `moule ${n.moule}`, n.four && `four ${n.four}`, n.personnes && `${n.personnes} pers.`].filter(Boolean);
  return `- ${morceaux.join(' · ')}${n.texte ? ` : ${n.texte.replace(/\s+/g, ' ').trim()}` : ''}`;
}

/* ---------- moule ---------- */

// « rond 24 cm », « carré 20 », « rectangle 30 x 20 cm », « Ø 24 cm ».
export function lireMoule(s) {
  const t = sansAccents(String(s || '')).toLowerCase().replace(',', '.');
  const n = (t.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (!n.length) return null;
  if (/rect/.test(t) || n.length >= 2) return { forme: 'rectangle', a: n[0], b: n[1] ?? n[0] };
  if (/carr/.test(t)) return { forme: 'carré', a: n[0], b: n[0] };
  return { forme: 'rond', a: n[0], b: n[0] };
}

export const surfaceMoule = m => (m.forme === 'rond' ? Math.PI * (m.a / 2) ** 2 : m.a * m.b);

export function texteMoule(m) {
  const nb = x => String(x).replace('.', ',');
  if (m.forme === 'rectangle') return `rectangle ${nb(m.a)} x ${nb(m.b)} cm`;
  return `${m.forme} ${nb(m.a)} cm`;
}

/** Facteur des quantités pour passer du moule de la recette au mien (rapport des surfaces). */
export const facteurMoule = (recette, mien) => surfaceMoule(mien) / surfaceMoule(recette);

/* ---------- aides pour l'affichage ---------- */

/** Liste à plat des étapes : [{ texte, group, numero }]. */
export function flatSteps(r) {
  const out = [];
  for (const g of r.etapes) for (const t of g.items) out.push({ texte: t, group: g.group, numero: out.length + 1 });
  return out;
}

function motCle(name) {
  const mots = sansAccents(name.replace(/\(.*?\)/g, '')).toLowerCase()
    .split(/[^a-z0-9œ]+/).filter(w => w.length >= 3 && !['des', 'les', 'une', 'pour', 'avec', 'sans', 'bien', 'tres', 'gros', 'grosse', 'petit', 'petite'].includes(w));
  return mots;
}

const STOP_DEUX = new Set(['sucre', 'beurre', 'farine', 'lait', 'creme', 'huile', 'sel', 'poivre']);

// Ingrédients dont le nom apparaît dans le texte de l'étape. On privilégie
// le groupe d'ingrédients qui porte le même nom que le groupe d'étapes.
function candidats(r, step) {
  const txt = ' ' + sansAccents(step.texte).toLowerCase().replace(/[^a-z0-9œ]+/g, ' ') + ' ';
  const has = w => txt.includes(' ' + w + ' ') || txt.includes(' ' + w + 's ') || (w.endsWith('s') && txt.includes(' ' + w.slice(0, -1) + ' '));
  const norm = s => sansAccents(s).toLowerCase().trim();
  const memeGroupe = r.ingredients.filter(g => g.group && step.group && norm(g.group) === norm(step.group));
  const pool = memeGroupe.length ? memeGroupe : r.ingredients;
  const out = [];
  for (const g of pool) {
    for (const ing of g.items) {
      const mots = motCle(ing.name);
      if (!mots.length) continue;
      // Pour « sucre glace » vs « sucre roux », on exige le second mot quand il existe.
      const ok = STOP_DEUX.has(mots[0]) && mots[1] && !['fondu', 'froid', 'mou', 'demi', 'nature', 'entier', 'poudre'].includes(mots[1])
        ? has(mots[0]) && has(mots[1])
        : has(mots[0]);
      if (ok) out.push({ ing, cle: mots[0], precis: mots.every(has) });
    }
  }
  return out;
}

/** Quantités écrites dans le texte d'une étape (« 1 c. à soupe de sucre » → 1 | c. à soupe). */
function quantitesCitees(texte) {
  const out = new Set();
  for (const m of texte.matchAll(/(^|[^\w.,])(?=\d|[½¼¾⅓⅔⅛])/g)) {
    const q = parseIngredient(texte.slice(m.index + m[1].length));
    if (q.qty != null) out.add(`${q.qty}|${q.unit}`);
  }
  for (const m of texte.matchAll(/(^|\s)(?=(?:une?|deux|trois|quatre)\s)/gi)) {
    const q = parseIngredient(texte.slice(m.index + m[1].length));
    if (q.qty != null && q.unit) out.add(`${q.qty}|${q.unit}`);
  }
  return out;
}

/**
 * Ingrédients probablement utilisés dans une étape. Quand l'étape cite une
 * quantité (« 1 c. à soupe de sucre »), on garde l'ingrédient qui a cette
 * quantité plutôt que les autres du même nom (« 90 g sucre »), et un
 * ingrédient ainsi cité n'est plus proposé aux étapes suivantes.
 */
export function ingredientsForStep(r, step) {
  const choisir = s => {
    const cites = quantitesCitees(s.texte);
    const liste = candidats(r, s).filter(c => !utilises.has(c.ing));
    const estCite = c => cites.has(`${c.ing.qty}|${c.ing.unit}`);
    // Entre plusieurs ingrédients du même nom, on garde ceux dont la quantité
    // est citée, sinon ceux dont tous les mots sont dans l'étape (« beurre froid »).
    const garder = (c, critere) => critere(c) || !liste.some(o => o.cle === c.cle && critere(o));
    return liste.filter(c => garder(c, estCite) && garder(c, o => o.precis || estCite(o)))
      .map(c => ({ ...c, cite: estCite(c) }));
  };
  const utilises = new Set();
  for (const s of flatSteps(r)) {
    if (s.numero === step.numero || s.texte === step.texte) break;
    for (const c of choisir(s)) if (c.cite) utilises.add(c.ing);
  }
  return choisir(step).map(c => c.ing);
}

/** Photos d'une recette, la principale en premier. L'ancien champ « photo » est toujours lu. */
export function listePhotos(meta) {
  const l = Array.isArray(meta.photos) ? meta.photos : [meta.photos || meta.photo];
  return l.filter(Boolean).map(String);
}

export function emptyRecipe() {
  return {
    slug: '', path: '',
    meta: { titre: '', categorie: 'Plats', tags: [], portions: 4, preparation: '', cuisson: '', repos: '', source: '', ajoutee: new Date().toISOString().slice(0, 10) },
    ingredients: [], etapes: [], notes: '', carnet: [],
  };
}

/** Texte éditable (une ligne par ingrédient, « ### Groupe » pour les sous-parties). */
export function groupsToText(groups, numbered = false) {
  const lines = [];
  for (const g of groups) {
    if (g.group) { if (lines.length) lines.push(''); lines.push(`### ${g.group}`); }
    for (const i of g.items) lines.push(typeof i === 'string' ? i : i.raw);
  }
  return lines.join('\n');
}

export function textToGroups(text) {
  const groups = [];
  let cur = { group: '', items: [] };
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    const h = line.match(/^#{1,6}\s*(.*)$/) || line.match(/^(pour .{2,40}?)\s*:$/i);
    if (h) { if (cur.items.length || cur.group) groups.push(cur); cur = { group: h[1].trim(), items: [] }; continue; }
    cur.items.push(line.replace(/^(?:[-*•]|\d+[.)])\s*/, ''));
  }
  if (cur.items.length || cur.group) groups.push(cur);
  return groups;
}
