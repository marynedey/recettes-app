// Apparence : « auto » (suit le téléphone), « clair » ou « sombre », choisie dans les réglages (localStorage « mr.theme »).
// Script classique chargé dans <head> : le thème est posé avant le premier affichage, sans éclair blanc.
(() => {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const lire = () => { try { return localStorage.getItem('mr.theme') || 'auto'; } catch { return 'auto'; } };
  const appliquer = () => {
    const choix = lire();
    const sombre = choix === 'sombre' || (choix === 'auto' && media.matches);
    document.documentElement.dataset.theme = sombre ? 'sombre' : 'clair';
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', sombre ? '#1C1712' : '#F6F0E6');
  };
  media.addEventListener('change', appliquer);
  window.mrTheme = {
    lire,
    choisir(c) { try { localStorage.setItem('mr.theme', c); } catch { /* stockage indisponible */ } appliquer(); },
  };
  appliquer();
})();
