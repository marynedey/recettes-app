// Mode cuisine mains libres : commandes vocales et lecture à voix haute.
// `lireCommande` est sans dépendance navigateur (testée avec `node --test`) ;
// `ecouter` utilise la reconnaissance vocale du téléphone (Web Speech API).

const sansAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Une commande n'est prise en compte que précédée du mot « recette » :
// on parle en cuisinant, et « … la suivante … » dans une conversation ne doit pas changer d'étape.
const COMMANDES = [
  ['precedente', /\b(precedente?|retour|reviens|recule)\b/],
  ['suivante', /\b(suivante?|apres|continue|avance)\b/],
  ['stop', /\b(stop|arrete|arreter|silence|coupe)\b/],
  ['pause', /\bpause\b/],
  ['minuteur', /\b(minuteur|chrono|lance|demarre)\b/],
  ['ingredients', /\bingredients?\b/],
  ['relis', /\b(relis|relire|repete|lis|lire|redis)\b/],
];

const PETITS_MOTS = new Set('a au aux d de des du en et etape l la le les mets moi nous passe peux s stp svp te tu va vas'.split(' '));

/** « Recette, suivante » → 'suivante' ; sans « recette » devant → null. */
export function lireCommande(texte) {
  const t = sansAccents(String(texte || '')).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
  const k = t.lastIndexOf('recette');
  if (k === -1) return null;
  // La commande suit directement « recette » (deux mots, hors petits mots) :
  // « cette recette est bonne, et après… » ne compte pas.
  const apres = t.slice(k + 'recette'.length).replace(/^s\b/, '').split(/\s+/)
    .filter(m => m && !PETITS_MOTS.has(m)).slice(0, 2).join(' ');
  for (const [nom, motif] of COMMANDES) if (motif.test(apres)) return nom;
  return null;
}

/** Texte d'une étape tel qu'il sera lu (sans le Markdown). */
export const texteALire = s => String(s || '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();

export const reconnaissancePossible = () =>
  typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

/**
 * Écoute en continu jusqu'à `arreter()`. `surCommande(nom, texte)` à chaque commande reconnue ;
 * `surErreur(message)` si le micro est refusé ou indisponible (l'écoute s'arrête).
 * `parler(texte)` lit à voix haute ; pendant ce temps, ce qu'entend le micro est ignoré.
 */
export function ecouter({ surCommande, surErreur = () => {} }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'fr-FR';
  rec.continuous = true;
  rec.interimResults = false;
  let actif = true;
  let parle = false;
  rec.onresult = e => {
    if (parle) return;
    const r = e.results[e.results.length - 1];
    if (!r.isFinal) return;
    const texte = r[0].transcript;
    const nom = lireCommande(texte);
    if (nom) surCommande(nom, texte);
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
      actif = false;
      surErreur(e.error === 'audio-capture' ? 'Micro introuvable.' : 'Micro refusé : autorisez-le dans les réglages du téléphone.');
    }
  };
  // Le téléphone coupe l'écoute après un silence : on la relance tant que le mode est actif.
  rec.onend = () => { if (actif) setTimeout(() => { if (actif) try { rec.start(); } catch { /* déjà relancée */ } }, 250); };
  try { rec.start(); } catch { /* déjà démarrée */ }

  return {
    arreter() {
      actif = false;
      try { rec.abort(); } catch { /* déjà arrêtée */ }
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    },
    parler(texte) {
      if (!('speechSynthesis' in window) || !texte) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texteALire(texte));
      u.lang = 'fr-FR';
      parle = true;
      u.onend = u.onerror = () => { parle = false; };
      speechSynthesis.speak(u);
    },
  };
}
