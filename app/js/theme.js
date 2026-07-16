// theme.js — bascule clair / sombre, persistée dans localStorage.
// Le thème est appliqué très tôt (script inline dans <head>) pour éviter le
// « flash » ; ce module ne fait que câbler le bouton et diffuser l'événement
// `themechange` pour que l'éditeur Monaco et le canvas (p5) se re-colorent.
const KEY = 'pd-theme';
const META_COLOR = { light: '#f4f7fb', dark: '#0b1120' };

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(KEY, t); } catch (e) { /* stockage indispo : on ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_COLOR[t]);
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t } }));
}

export function toggleTheme() {
  applyTheme(getTheme() === 'light' ? 'dark' : 'light');
}

function syncButton(btn) {
  const light = getTheme() === 'light';
  btn.setAttribute('aria-pressed', String(light));
  btn.setAttribute('title', light ? 'Passer en mode sombre' : 'Passer en mode clair');
  btn.setAttribute('aria-label', light ? 'Passer en mode sombre' : 'Passer en mode clair');
}

export function initThemeToggle(btn) {
  if (!btn) return;
  syncButton(btn);
  btn.addEventListener('click', () => { toggleTheme(); syncButton(btn); });
  window.addEventListener('themechange', () => syncButton(btn));
}

// Auto-câblage : le bouton #themeToggle est présent dans la topbar des deux pages.
function boot() { initThemeToggle(document.getElementById('themeToggle')); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
