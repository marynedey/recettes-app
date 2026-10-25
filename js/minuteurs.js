// Minuteurs du mode cuisine : plusieurs à la fois, gardés sur le téléphone
// (ils continuent si on change d'étape, de page, ou si l'app est rouverte),
// avec une notification par minuteur en cours. À la fin, ça sonne comme un réveil
// jusqu'à « Arrêter » ou « +1 min » (dans l'app ou depuis la notification).

import * as push from './push.js';

const CLE = 'mr.minuteurs';
const ecouteurs = new Set();

/* ---------- état ---------- */

// { [id]: { id, slug, titre, etape, label, total, fin, reste, fini, sonne, finiA } }
// fin : heure de fin (ms) quand il tourne, null en pause ; reste : secondes restantes en pause ;
// sonne : terminé et pas encore arrêté.
let tous = {};
try { tous = JSON.parse(localStorage.getItem(CLE)) || {}; } catch { tous = {}; }

const sauver = () => {
  try { localStorage.setItem(CLE, JSON.stringify(tous)); } catch { /* stockage plein */ }
  // Copie pour le service worker (qui n'a pas accès au localStorage) : à la réception d'une
  // notification du serveur des minuteurs, il y retrouve quel minuteur est terminé.
  if ('caches' in window) {
    caches.open(push.DONNEES).then(c => c.put(push.adresseDonnee('minuteurs.json'),
      new Response(JSON.stringify(tous), { headers: { 'Content-Type': 'application/json' } }))).catch(() => {});
  }
};
const prevenir = () => ecouteurs.forEach(fn => fn());

export const idMinuteur = (slug, etape, choix) => `${slug}|${etape}|${choix}`;
export const obtenir = id => tous[id] || null;
export const deRecette = slug => Object.values(tous).filter(m => m.slug === slug).sort((a, b) => a.etape - b.etape);
export const enCours = m => !!m && m.fin !== null && !m.fini;
export const restant = m => (m.fin !== null ? Math.max(0, Math.ceil((m.fin - Date.now()) / 1000)) : m.reste);
export const surChangement = fn => { ecouteurs.add(fn); return () => ecouteurs.delete(fn); };
export const quiSonnent = () => Object.values(tous).filter(m => m.sonne);

export function lancer({ id, slug, titre, etape, label, secondes }) {
  const m = tous[id];
  if (m && !m.fini) {
    if (m.fin === null && m.reste > 0) m.fin = Date.now() + m.reste * 1000;
  } else {
    // Nouveau minuteur, ou relance d'un minuteur terminé : durée de l'étape, sans les ±1 min.
    const total = secondes || m?.total;
    tous[id] = { id, slug, titre, etape, label, total, fin: Date.now() + total * 1000, reste: total, fini: false };
  }
  maj(id);
}

/** « Arrêter » : la sonnerie s'arrête, le minuteur reste affiché « Terminé ». */
export function arreter(id) {
  const m = tous[id];
  if (!m?.sonne) return;
  m.sonne = false;
  sauver();
  push.annuler(id); // plus de rappels du serveur
  fermerNotification(id);
  prevenir();
}

/** « +1 min » sur un minuteur terminé : il repart pour s secondes. */
export function prolonger(id, s = 60) {
  const m = tous[id];
  if (!m) return;
  Object.assign(m, { fini: false, sonne: false, finiA: null, fin: Date.now() + s * 1000, reste: s, total: s });
  maj(id);
}

export function pause(id) {
  const m = tous[id];
  if (!enCours(m)) return;
  m.reste = restant(m);
  m.fin = null;
  maj(id);
}

/** Ajoute (ou retire) d'secondes, en marche comme en pause. */
export function ajuster(id, d, defaut) {
  let m = tous[id];
  if (m?.fini && d > 0) { prolonger(id, d); return; }
  if (!m) { if (!defaut) return; m = tous[id] = { ...defaut, total: defaut.secondes, fin: null, reste: defaut.secondes, fini: false }; delete m.secondes; }
  if (m.fin !== null) m.fin = Math.max(Date.now() + 1000, m.fin + d * 1000);
  else m.reste = Math.max(0, m.reste + d);
  m.total = Math.max(m.total + d, restant(m), 1);
  if (restant(m) > 0) m.fini = false;
  maj(id);
}

/** Arrête et efface tous les minuteurs d'une recette (fin de la recette). */
export function arreterRecette(slug) {
  deRecette(slug).forEach(m => supprimer(m.id));
}

export function supprimer(id) {
  if (enCours(tous[id]) || tous[id]?.sonne) push.annuler(id);
  delete tous[id];
  sauver();
  fermerNotification(id);
  prevenir();
}

function maj(id) {
  sauver();
  // Serveur des minuteurs (facultatif) : il préviendra le téléphone même app fermée.
  const m = tous[id];
  if (enCours(m)) push.planifier(id, m.fin); else push.annuler(id);
  notifier(tous[id]);
  prevenir();
}

/* ---------- alarme ---------- */

let audio = null;
// Le navigateur n'autorise le son qu'après un toucher dans l'app : on prépare le son au premier.
const preparerSon = () => {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { /* pas de son */ }
};
document.addEventListener('pointerdown', preparerSon, { passive: true });
function sonnerie() {
  try {
    preparerSon();
    const t0 = audio.currentTime;
    for (let i = 0; i < 6; i++) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = i % 2 ? 660 : 880;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.35);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.35 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.3);
      o.connect(g).connect(audio.destination);
      o.start(t0 + i * 0.35); o.stop(t0 + i * 0.35 + 0.32);
    }
  } catch { /* pas de son */ }
  navigator.vibrate?.([400, 200, 400, 200, 400]);
}

// Vérifie les minuteurs toutes les demi-secondes, quel que soit l'écran affiché.
function tic() {
  if (actionsEnAttente) return; // d'abord les « Arrêter » / « +1 min » touchés app fermée
  let change = false;
  for (const m of Object.values(tous)) {
    if (enCours(m) && restant(m) === 0) {
      m.fini = true; m.sonne = true; m.fin = null; m.reste = 0; change = true;
      signalerFin(m);
    }
    // Une sonnerie oubliée s'arrête d'elle-même au bout de 3 min.
    if (m.sonne && m.finiA && Date.now() - m.finiA > DUREE_SONNERIE) { m.sonne = false; change = true; }
    // Ménage : un minuteur terminé depuis plus de 6 h n'a plus d'intérêt.
    if (m.fini && m.finiA && Date.now() - m.finiA > 6 * 3600e3) { delete tous[m.id]; fermerNotification(m.id); change = true; }
    if (m.fini && !m.finiA) { m.finiA = Date.now(); change = true; }
  }
  if (change) { sauver(); prevenir(); }
}
setInterval(tic, 500);

// Sonnerie en boucle (app ouverte) tant qu'un minuteur terminé n'est pas arrêté.
const DUREE_SONNERIE = 3 * 60e3;
setInterval(() => { if (!document.hidden && quiSonnent().length) sonnerie(); }, 2500);

// Boutons « Arrêter » / « +1 min » touchés sur une notification alors que l'app était fermée :
// le service worker les a notés, on les applique en revenant dans l'app.
let actionsEnAttente = false;
async function appliquerActions() {
  actionsEnAttente = true;
  try {
    const c = await caches.open(push.DONNEES);
    const actions = await c.match(push.adresseDonnee('actions.json')).then(r => r?.json()).catch(() => null);
    if (!actions?.length) return;
    await c.delete(push.adresseDonnee('actions.json'));
    for (const a of actions) {
      const m = tous[a.id];
      if (!m) continue;
      if (a.action === 'arreter') m.sonne = false;
      if (a.action === 'plus1') Object.assign(m, { fini: false, sonne: false, finiA: null, fin: a.fin, reste: 60, total: 60 });
    }
    sauver();
    prevenir();
  } catch { /* Cache API indisponible */ } finally { actionsEnAttente = false; }
}
appliquerActions();
// Même chose si le service worker prévient alors que l'app est ouverte.
navigator.serviceWorker?.addEventListener('message', e => {
  const a = e.data?.minuteur;
  if (!a) return;
  if (a.action === 'arreter') arreter(a.id);
  if (a.action === 'plus1') prolonger(a.id, 60);
});
document.addEventListener('visibilitychange', () => {
  // Au retour dans l'app (autre onglet, autre appareil…), on relit l'état enregistré.
  if (document.hidden) return;
  try { tous = JSON.parse(localStorage.getItem(CLE)) || {}; } catch { /* garde l'état courant */ }
  appliquerActions();
  tic();
  resynchroniser();
});

/** Sonne et notifie, sauf si le serveur des minuteurs l'a déjà fait (app en arrière-plan). */
async function signalerFin(m) {
  if (await dejaSignale(m.id)) return;
  sonnerie();
  notifier(m);
}

/* ---------- notifications ---------- */

async function dejaSignale(id) {
  if (!notificationsPossibles() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  return (await reg?.getNotifications({ tag: id }).catch(() => []) || []).some(n => n.title.startsWith('⏰'));
}

export const notificationsPossibles = () => 'Notification' in window && 'serviceWorker' in navigator;

export async function demanderNotifications() {
  if (!notificationsPossibles() || Notification.permission !== 'default') return;
  try { await Notification.requestPermission(); } catch { /* refusé */ }
  Object.values(tous).filter(m => !m.fini || m.sonne).forEach(notifier);
}

// Heures, minutes et secondes, comme sur le minuteur de l'app.
const heure = ms => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const deux = n => String(n).padStart(2, '0');
export const duree = s => (s >= 3600 ? `${Math.floor(s / 3600)}:${deux(Math.floor(s % 3600 / 60))}:${deux(s % 60)}` : `${Math.floor(s / 60)}:${deux(s % 60)}`);

// Le texte d'une notification ne dépend pas du temps qui passe (« prêt à 21:42 ») :
// il reste exact même quand Android met l'app en pause et qu'elle ne peut plus le rafraîchir.
async function notifier(m) {
  if (!m || !notificationsPossibles() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg) return;
  const titre = `${m.titre} · étape ${m.etape + 1}`;
  const commun = {
    tag: m.id, icon: 'icons/icon-192.png', badge: 'icons/badge-minuteur.png',
    data: { url: `#/cuisine/${encodeURIComponent(m.slug)}?e=${m.etape}` },
  };
  try {
    if (m.fini) {
      await reg.showNotification(`⏰ ${titre} : c'est prêt !`, {
        ...commun, body: m.label, renotify: true, requireInteraction: true, vibrate: [400, 200, 400, 200, 400],
        actions: [{ action: 'arreter', title: 'Arrêter' }, { action: 'plus1', title: '+1 min' }],
        data: { ...commun.data, minuteur: m.id },
      });
    } else if (m.fin !== null) {
      await reg.showNotification(`⏳ ${titre} · prêt à ${heure(m.fin)}`, {
        ...commun, body: `${m.label} (${duree(m.total)})`, timestamp: m.fin, silent: true, renotify: false,
      });
    } else {
      await reg.showNotification(`⏸ ${titre} · en pause`, { ...commun, body: `${m.label} — reste ${duree(m.reste)}`, silent: true });
    }
  } catch { /* notifications indisponibles */ }
}

/**
 * Remet les notifications affichées en accord avec les minuteurs réels, et ferme celles qui n'ont plus
 * lieu d'être (minuteur effacé, ou terminé et arrêté). Ne recrée jamais une notification qu'on a balayée :
 * elle revenait à chaque ouverture de l'app.
 */
export async function resynchroniser() {
  if (!notificationsPossibles() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg) return;
  for (const n of await reg.getNotifications().catch(() => [])) {
    if (!n.tag || !n.tag.includes('|')) continue;
    const m = tous[n.tag];
    if (!m || (m.fini && !m.sonne)) n.close();
    else if (!m.fini) notifier(m); // texte remis à jour (pause, +1 min touché app fermée…) ; une sonnerie reste telle quelle
  }
}
resynchroniser();

async function fermerNotification(id) {
  if (!notificationsPossibles()) return;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  (await reg?.getNotifications({ tag: id }).catch(() => []) || []).forEach(n => n.close());
}
