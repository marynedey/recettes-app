// Notifications de fin de minuteur même quand l'app est fermée, via le petit serveur
// des minuteurs (dossier serveur/, Cloudflare Workers). Facultatif : sans adresse de
// serveur dans les réglages, rien ne part et les minuteurs marchent comme avant.
// Le serveur ne reçoit que l'adresse de notification du téléphone et l'heure de fin.

const REGLAGES = 'mr.reglages';
const APPAREIL = 'mr.appareil';

export function adresseServeur() {
  try { return (JSON.parse(localStorage.getItem(REGLAGES)) || {}).serveur || ''; } catch { return ''; }
}

// Identifiant de ce téléphone (pour que deux téléphones n'annulent pas les minuteurs l'un de l'autre).
function appareil() {
  let id = localStorage.getItem(APPAREIL);
  if (!id) { id = Math.random().toString(36).slice(2, 12); localStorage.setItem(APPAREIL, id); }
  return id;
}

const appel = (chemin, options) => fetch(adresseServeur() + chemin, options).then(r => {
  if (!r.ok) throw new Error(`Serveur des minuteurs : erreur ${r.status}`);
  return r.json();
});

const versOctets = b64 => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const versTexte = octets => btoa(String.fromCharCode(...new Uint8Array(octets))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Abonnement aux notifications de ce téléphone (créé au besoin avec la clé du serveur). */
async function abonnement() {
  const reg = await navigator.serviceWorker.ready;
  const { cle } = await appel('/cle');
  let a = await reg.pushManager.getSubscription();
  // Abonné avec une autre clé (autre serveur) : on se réabonne.
  if (a && versTexte(a.options.applicationServerKey || []) !== cle) { await a.unsubscribe(); a = null; }
  return a || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: versOctets(cle) });
}

let enCours = null;
const abonnementPartage = () => (enCours ||= abonnement().catch(e => { enCours = null; throw e; }));

const actif = () => !!adresseServeur() && 'PushManager' in window && Notification.permission === 'granted';
const chemin = id => `/minuteurs/${encodeURIComponent(`${appareil()}|${id}`)}`;

/** Demande au serveur de prévenir ce téléphone à l'heure `fin` (ms). */
export async function planifier(id, fin) {
  if (!actif()) return;
  try {
    const { endpoint } = await abonnementPartage();
    await appel(chemin(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adresse: endpoint, fin }) });
  } catch (e) { console.warn(e); /* hors ligne ou serveur absent : la notification locale reste */ }
}

export async function annuler(id) {
  if (!actif()) return;
  try { await appel(chemin(id), { method: 'DELETE' }); } catch (e) { console.warn(e); }
}

/** Réglages : vérifie le serveur et envoie une notification d'essai dans 10 secondes. */
export async function tester() {
  if (!('PushManager' in window)) throw new Error('Ce navigateur ne gère pas les notifications en arrière-plan.');
  if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') {
    throw new Error('Autorisez les notifications pour Mes Recettes (paramètres Android de l\'app).');
  }
  const { endpoint } = await abonnementPartage();
  await appel(chemin('essai'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adresse: endpoint, fin: Date.now() + 10e3 }) });
}
