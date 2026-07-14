// util.js — Petits helpers purs partagés par les modules de l'UI.

// Raccourci getElementById. Concision pour la lecture du DOM par id.
export const $ = (id) => document.getElementById(id);

// Échappe le texte pour injection sûre dans du HTML (noms d'algo, code source…).
export function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Formate un nombre avec un nombre fixe de décimales (scores, moyennes).
export function fmt(n, d = 2) { return n.toFixed(d); }