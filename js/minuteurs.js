// Minuteurs du mode cuisine : plusieurs à la fois, gardés sur le téléphone
// (ils continuent si on change d'étape, de page, ou si l'app est rouverte),
// avec une notification par minuteur en cours.

const CLE = 'mr.minuteurs';
const ecouteurs = new Set();

/* ---------- état ---------- */

// { [id]: { id, slug, titre, etape, label, total, fin, reste, fini } }
// fin : heure de fin (ms) quand il tourne, null en pause ; reste : secondes restantes en pause.
let tous = {};
try { tous = JSON.parse(localStorage.getItem(CLE)) || {}; } catch { tous = {}; }

const sauver = () => { try { localStorage.setItem(CLE, JSON.stringify(tous)); } catch { /* stockage plein */ } };
const prevenir = () => ecouteurs.forEach(fn => fn());

export const idMinuteur = (slug, etape, choix) => `${slug}|${etape}|${choix}`;
export const obtenir = id => tous[id] || null;
export const deRecette = slug => Object.values(tous).filter(m => m.slug === slug).sort((a, b) => a.etape - b.etape);
export const enCours = m => !!m && m.fin !== null && !m.fini;
export const restant = m => (m.fin !== null ? Math.max(0, Math.ceil((m.fin - Date.now()) / 1000)) : m.reste);
export const surChangement = fn => { ecouteurs.add(fn); return () => ecouteurs.delete(fn); };

export function lancer({ id, slug, titre, etape, label, secondes }) {
  const m = tous[id];
  if (m && !m.fini) {
    if (m.fin === null && m.reste > 0) m.fin = Date.now() + m.reste * 1000;
  } else {
    // Nouveau minuteur, ou relance d'un minuteur terminé.
    const total = m?.total || secondes;
    tous[id] = { id, slug, titre, etape, label, total, fin: Date.now() + total * 1000, reste: total, fini: false };
  }
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
  if (!m) { if (!defaut) return; m = tous[id] = { ...defaut, total: defaut.secondes, fin: null, reste: defaut.secondes, fini: false }; delete m.secondes; }
  if (m.fin !== null) m.fin = Math.max(Date.now() + 1000, m.fin + d * 1000);
  else m.reste = Math.max(0, m.reste + d);
  m.total = Math.max(m.total + d, restant(m), 1);
  if (restant(m) > 0) m.fini = false;
  maj(id);
}

export function supprimer(id) {
  delete tous[id];
  sauver();
  fermerNotification(id);
  prevenir();
}

function maj(id) {
  sauver();
  notifier(tous[id]);
  prevenir();
}

/* ---------- alarme ---------- */

let audio = null;
function sonnerie() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
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
let dernierNotif = 0;
function tic() {
  let change = false;
  for (const m of Object.values(tous)) {
    if (enCours(m) && restant(m) === 0) {
      m.fini = true; m.fin = null; m.reste = 0; change = true;
      sonnerie();
      notifier(m);
    }
    // Ménage : un minuteur terminé depuis plus de 6 h n'a plus d'intérêt.
    if (m.fini && m.finiA && Date.now() - m.finiA > 6 * 3600e3) { delete tous[m.id]; change = true; }
    if (m.fini && !m.finiA) { m.finiA = Date.now(); change = true; }
  }
  // Notifications des minuteurs en cours rafraîchies toutes les 30 s (temps restant).
  if (Date.now() - dernierNotif > 30000) {
    dernierNotif = Date.now();
    Object.values(tous).filter(enCours).forEach(notifier);
  }
  if (change) { sauver(); prevenir(); }
}
setInterval(tic, 500);
document.addEventListener('visibilitychange', () => { dernierNotif = 0; tic(); });

/* ---------- notifications ---------- */

export const notificationsPossibles = () => 'Notification' in window && 'serviceWorker' in navigator;

export async function demanderNotifications() {
  if (!notificationsPossibles() || Notification.permission !== 'default') return;
  try { await Notification.requestPermission(); } catch { /* refusé */ }
  Object.values(tous).forEach(notifier);
}

const heure = ms => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
export const duree = s => {
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
  if (s >= 60) return `${Math.ceil(s / 60)} min`;
  return `${s} s`;
};

async function notifier(m) {
  if (!m || !notificationsPossibles() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg) return;
  const titre = `${m.titre} · étape ${m.etape + 1}`;
  const commun = { tag: m.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: `./#/cuisine/${encodeURIComponent(m.slug)}` } };
  try {
    if (m.fini) {
      await reg.showNotification(`⏰ ${titre} : c'est prêt !`, {
        ...commun, body: m.label, renotify: true, requireInteraction: true, vibrate: [400, 200, 400, 200, 400],
      });
    } else if (m.fin !== null) {
      await reg.showNotification(`⏳ ${titre}`, {
        ...commun, body: `${m.label} — prêt à ${heure(m.fin)} (encore ${duree(restant(m))})`, silent: true, renotify: false,
      });
    } else {
      await reg.showNotification(`⏸ ${titre}`, { ...commun, body: `${m.label} — en pause, reste ${duree(m.reste)}`, silent: true });
    }
  } catch { /* notifications indisponibles */ }
}

async function fermerNotification(id) {
  if (!notificationsPossibles()) return;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  (await reg?.getNotifications({ tag: id }).catch(() => []) || []).forEach(n => n.close());
}

/* ---------- app Horloge d'Android ---------- */

export const estAndroid = () => /Android/i.test(navigator.userAgent);

/**
 * Lance le même minuteur dans l'app Horloge d'Android (intention SET_TIMER) :
 * compte à rebours en direct dans les notifications, sonne même app fermée.
 */
export function lancerDansHorloge(secondes, message) {
  location.href = 'intent:#Intent;action=android.intent.action.SET_TIMER;'
    + `i.android.intent.extra.alarm.LENGTH=${Math.max(1, Math.round(secondes))};`
    + `S.android.intent.extra.alarm.MESSAGE=${encodeURIComponent(message)};`
    + 'B.android.intent.extra.alarm.SKIP_UI=true;end';
}
