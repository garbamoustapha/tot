// arena.js — Frontend de l'arène en ligne : soumission + classement temps réel
//           via SignalR. Cohérent avec ui.js (mêmes conventions d'icônes/badges).
// --------------------------------------------------------------------------
// Backend (ASP.NET Core + SignalR) :
//   GET  /api/icons            — icônes prédéfinies
//   GET  /api/leaderboard      — classement courant + prochain tournoi
//   POST /api/submit           — soumettre (nom joueur, nom algo, icône, code)
//   POST /api/tournament/trigger — déclencher un tournoi maintenant
//   WS   /arenaHub             — ReceiveHello / ReceiveCountdown / ReceiveTournamentStart
//                                ReceiveProgress / ReceiveLeaderboard / ReceiveSubmission / ReceiveStatus
//                                ReceiveDuels (matrice des duels = « la partie qu'il a jouée »)

import { MatchSim, SPEEDS } from './sim.js';
import { LENGTHS } from './engine.js';

const $ = (id) => document.getElementById(id);

// Template C# embarqué (l'arène en ligne compile le C# côté serveur via Roslyn).
const TEMPLATE_CSHARP = `// Stratégie pour l'arène en ligne (C#, exécutée sur le serveur).
// Classe OBLIGATOIRE nommée "Player" avec une méthode "Decide".
// 0 = Coopérer, 1 = Trahir. -1 = pas de coup précédent (tour 1).
// Interdit : accès réseau, fichier, processus, réflexion (validation + timeout).

using System;

public class Player
{
    private int _defectStreak = 0;

    public int Decide(
        int opponentLastMove, int currentTurn, int myScore,
        int opponentScore, double randomValue, int myLastMove)
    {
        // Premier tour : pas d'historique — une stratégie "nice" coopère.
        if (currentTurn == 1 || opponentLastMove < 0) return 0;

        // Tit for Tat : copie le dernier coup de l'adversaire.
        if (opponentLastMove == 1) { _defectStreak++; return 1; }
        _defectStreak = 0;
        return 0;

        // Variantes : Pavlov, GrimTrigger, Joss… expérimentez !
    }
}`;

const KIND_LABEL = {
  nice:  { label: 'Coopératif', cls: 'kind-nice' },
  mean:  { label: 'Traître',    cls: 'kind-mean' },
  noisy: { label: 'Aléatoire',  cls: 'kind-noisy' },
};

// --- État UI ---
let selectedIconId = null;
let icons = [];
let hub = null;
let prevRanks = {};      // id -> rank précédent (pour animer les variations)
let rowEls = {};         // id -> élément <tr> (diff-update du classement)
let statusRunning = false;

// --- Duel matrix & simulation (clic sur une ligne du classement) ---
let lastRows = [];                 // dernières lignes du classement (metas)
let duelMap = new Map();           // "AId|BId" -> DuelCell (i < j)
let sim = null;                    // instance MatchSim
let simSpeedMs = SPEEDS[1].ms;     // vitesse d'animation par défaut (1×)
let simPair = null;                // { aId, bId } du match animé courant

// ----------------------------- INIT -----------------------------------
async function main() {
  await loadIcons();
  bindSubmitModal();
  bindTrigger();
  bindDuelsModal();
  setupArenaSim();
  connectHub();
  setStatus('idle', 'En attente du prochain tournoi…');
  // Ouvre automatiquement le modal si l'URL contient ?submit (ex. venue depuis Solo).
  if (new URLSearchParams(location.search).has('submit')) openSubmitModal();
}

// ----------------------------- ICÔNES (modal) -------------------------
async function loadIcons() {
  try {
    const res = await fetch('/api/icons');
    icons = await res.json();
  } catch (e) { icons = []; }
  renderIconGrid();
}

const glyphOf = (id) => (icons.find((i) => i.id === id) || {}).glyph || '•';

function renderIconGrid() {
  const grid = $('iconGrid');
  if (!grid) return;
  grid.innerHTML = '';
  icons.forEach((ic) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'submit-cell';
    cell.setAttribute('role', 'radio');
    cell.setAttribute('aria-checked', 'false');
    cell.title = `${ic.label} (${ic.id})`;
    cell.dataset.id = ic.id;
    cell.textContent = ic.glyph;
    grid.appendChild(cell);
  });
}

function selectIcon(id) {
  selectedIconId = id;
  $('iconGrid').querySelectorAll('.submit-cell').forEach((c) => {
    const on = c.dataset.id === id;
    c.setAttribute('aria-checked', String(on));
    // Chaque cellule affiche TOUJOURS son propre glyphe ; la sélection ajoute juste le ✓.
    c.innerHTML = on ? `${glyphOf(c.dataset.id)}<span class="submit-check">✓</span>` : glyphOf(c.dataset.id);
  });
}

// ----------------------------- MODAL DE SOUMISSION --------------------
function bindSubmitModal() {
  $('submitOpen').onclick = openSubmitModal;
  $('submitClose').onclick = closeSubmitModal;
  $('submitCancel').onclick = closeSubmitModal;
  $('submitConfirm').onclick = submitStrategy;
  $('submitModal').addEventListener('click', (e) => { if (e.target === $('submitModal')) closeSubmitModal(); });
  $('iconGrid').addEventListener('click', (e) => {
    const cell = e.target.closest('.submit-cell');
    if (cell) selectIcon(cell.dataset.id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('submitModal').classList.contains('hidden')) closeSubmitModal();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !$('submitModal').classList.contains('hidden')) submitStrategy();
  });
}

function openSubmitModal() {
  // Récupère le code C# apporté depuis Solo (sessionStorage), sinon le modèle par défaut.
  let initial = TEMPLATE_CSHARP;
  try {
    const carried = sessionStorage.getItem('arenaSubmitCode');
    if (carried && carried.trim()) initial = carried;
    sessionStorage.removeItem('arenaSubmitCode');
  } catch (e) { /* stockage indisponible */ }
  $('submitCode').value = initial;
  $('playerName').value = '';
  $('algoName').value = '';
  selectedIconId = null;
  $('iconGrid').querySelectorAll('.submit-cell').forEach((c) => {
    c.setAttribute('aria-checked', 'false');
    c.textContent = glyphOf(c.dataset.id);
  });
  const err = $('submitError');
  err.classList.add('hidden'); err.textContent = '';
  $('submitModal').classList.remove('hidden');
  setTimeout(() => $('submitCode').focus(), 60);
}

function closeSubmitModal() { $('submitModal').classList.add('hidden'); }

function showSubmitError(msg) {
  const err = $('submitError');
  err.innerHTML = msg;
  err.classList.remove('hidden');
}

async function submitStrategy() {
  const playerName = $('playerName').value.trim();
  const algoName = $('algoName').value.trim();
  const code = $('submitCode').value;

  if (!playerName) return showSubmitError('Indiquez votre nom.');
  if (!algoName) return showSubmitError('Indiquez le nom de votre algorithme.');
  if (!selectedIconId) return showSubmitError('Choisissez une icône pour votre algorithme.');
  if (!code.trim()) return showSubmitError('Le code de la stratégie est vide.');

  const btn = $('submitConfirm');
  btn.disabled = true; btn.textContent = 'Envoi…';
  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName, algoName, iconId: selectedIconId, code }),
    });
    const data = await res.json();
    if (!res.ok) return showSubmitError(`Soumission refusée : <code>${data.error || res.statusText}</code>`);
    closeSubmitModal();
    showBanner(`✓ ${data.message || 'Stratégie enregistrée !'}`, 'ok', 6000);
  } catch (e) {
    showSubmitError(`Erreur réseau : <code>${e.message}</code>`);
  } finally {
    btn.disabled = false; btn.textContent = "Entrer dans l'arène en ligne";
  }
}

// ----------------------------- DUELS & SIMULATION (clic ligne) ----------
// Stocke la matrice des duels reçue du serveur et indexe par paire "AId|BId".
function setDuels(cells) {
  duelMap = new Map();
  (cells || []).forEach((c) => duelMap.set(`${c.aId}|${c.bId}`, c));
}

// Résultat du duel entre xId et yId, du point de vue de xId.
// Renvoie { myScore, oppScore, turns, wins, ties, losses } ou null.
function duelFor(xId, yId) {
  let c = duelMap.get(`${xId}|${yId}`);
  if (c) return { myScore: c.scoreA, oppScore: c.scoreB, turns: c.turns, wins: c.winsA, ties: c.ties, losses: c.winsB };
  c = duelMap.get(`${yId}|${xId}`);
  if (c) return { myScore: c.scoreB, oppScore: c.scoreA, turns: c.turns, wins: c.winsB, ties: c.ties, losses: c.winsA };
  return null;
}

const rowById = (id) => lastRows.find((r) => r.id === id);

// Construit un objet "stratégie de rejeu" : au lieu de calculer les coups, il les
// lit dans une liste fournie par le serveur (qui rejoue le vrai match côté serveur
// via Roslyn).  MatchSim l'utilise comme n'importe quelle stratégie -> animation
// fidèle pour TOUTE paire du classement (Vous, builtins, autres joueurs).
function makeReplayStrat(meta, moves) {
  return {
    meta,
    init: async () => ({ moves, i: 0 }),
    decide: async (state) => {
      const m = state.moves[state.i];
      state.i += 1;
      return (m === 0 || m === 1) ? m : 1; // par sécurité : forfait = trahir
    },
  };
}

function bindDuelsModal() {
  $('duelsClose').onclick = closeDuelsModal;
  $('duelsModal').addEventListener('click', (e) => { if (e.target === $('duelsModal')) closeDuelsModal(); });
  // Délégation de clic sur les lignes du classement -> modal des matchs joués.
  $('arenaRanking').addEventListener('click', (e) => {
    const tr = e.target.closest('tbody tr[data-id]');
    if (tr) openDuelsModal(tr.dataset.id);
  });
  // Échap ferme la modale ouverte (sim en priorité, puis duels).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('simModal').classList.contains('hidden')) { closeArenaSim(); return; }
    if (!$('duelsModal').classList.contains('hidden')) closeDuelsModal();
  });
}

function openDuelsModal(id) {
  const me = rowById(id);
  if (!me) return;
  $('duelsTitle').innerHTML = `${me.icon || '•'}<span class="strat-name">${esc(me.name)}</span>${badgeFor(me)} <span class="vs">· matchs joués</span>`;
  renderDuelsBody(me);
  $('duelsModal').classList.remove('hidden');
}

function closeDuelsModal() { $('duelsModal').classList.add('hidden'); }

function renderDuelsBody(me) {
  const body = $('duelsBody');
  if (!duelMap.size) {
    body.innerHTML = '<div class="duels-empty">Aucun tournoi terminé pour l\'instant. Patientez jusqu\'au prochain tournoi (ou lancez-le maintenant) pour voir les matchs joués.</div>';
    return;
  }
  // Construit la liste des duels de `me` contre chaque autre stratégie.
  const rows = lastRows
    .filter((r) => r.id !== me.id)
    .map((r) => {
      const d = duelFor(me.id, r.id);
      if (!d) return null;
      const diff = d.myScore - d.oppScore;
      const avg = d.turns ? d.myScore / d.turns : 0;
      return { opp: r, d, diff, avg };
    })
    .filter(Boolean)
    .sort((a, b) => b.diff - a.diff || b.d.myScore - a.d.myScore);

  // Toutes les paires du classement sont rejouables par le serveur -> Simuler partout.
  body.innerHTML =
    `<table class="duels-table arena-duels">
       <thead><tr><th>Adversaire</th><th class="num">Mon score</th><th class="num">Son score</th><th class="num">Diff</th><th class="num">V·E·D</th><th class="duels-action"></th></tr></thead>
       <tbody>${rows.map((row) => duelsRowHtml(me, row)).join('')}</tbody>
     </table>`;
  // Branche les boutons « Simuler ▶ » (builtin vs builtin uniquement).
  body.querySelectorAll('.duel-sim-btn').forEach((btn) => {
    btn.onclick = () => openArenaSim(btn.dataset.a, btn.dataset.b);
  });
}

function duelsRowHtml(me, row) {
  const { opp, d, diff, avg } = row;
  const diffCls = diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'neu';
  const diffTxt = diff > 0 ? `+${diff}` : `${diff}`;
  const action = `<button class="duel-sim-btn" data-a="${esc(me.id)}" data-b="${esc(opp.id)}" title="Rejouer le match animé">▶ Simuler</button>`;
  return `<tr>
    <td><span class="strat-icon">${opp.icon || '•'}</span><span class="strat-name">${esc(opp.name)}</span>${badgeFor(opp)}</td>
    <td class="num">${d.myScore} <span class="duel-avg">${avg.toFixed(2)}/t</span></td>
    <td class="num">${d.oppScore}</td>
    <td class="num ${diffCls}">${diffTxt}</td>
    <td class="num">${d.wins}·${d.ties}·${d.losses}</td>
    <td class="duels-action">${action}</td>
  </tr>`;
}

// --- Simulation animée (rejeu serveur de n'importe quelle paire) ---
function setupArenaSim() {
  const speedSel = $('simSpeed');
  SPEEDS.forEach((s, i) => {
    const o = document.createElement('option');
    o.value = String(s.ms); o.textContent = s.label;
    if (i === 1) o.selected = true;
    speedSel.appendChild(o);
  });
  const lenSel = $('simLength');
  LENGTHS.forEach((l, i) => {
    const o = document.createElement('option');
    o.value = String(l); o.textContent = `${l} tours`;
    if (i === 1) o.selected = true;
    lenSel.appendChild(o);
  });
  $('simPlay').onclick = () => {
    if (!sim) return;
    if (sim.state.finished || !sim.state.running) sim.restart();
    else sim.togglePause();
    refreshPlayBtn();
  };
  $('simRestart').onclick = () => { if (sim) { sim.restart(); refreshPlayBtn(); } };
  $('simSpeed').onchange = (e) => { simSpeedMs = parseInt(e.target.value, 10); if (sim) sim.setSpeed(simSpeedMs); };
  $('simLength').onchange = (e) => { if (sim) { sim.length = parseInt(e.target.value, 10) || sim.length; sim.restart(); } };
  $('simSeed').onchange = (e) => {
    const v = Math.max(1, parseInt(e.target.value, 10) || 1);
    e.target.value = String(v);
    if (sim) { sim.seed = v; sim.restart(); }
  };
  $('simSeedRand').onclick = () => {
    const v = Math.floor(Math.random() * 1e6) + 1;
    $('simSeed').value = String(v);
    if (sim) { sim.seed = v; sim.restart(); }
  };
  $('simClose').onclick = closeArenaSim;
  $('simModal').addEventListener('click', (e) => { if (e.target === $('simModal')) closeArenaSim(); });
}

async function openArenaSim(aId, bId) {
  simPair = { aId, bId };
  const length = parseInt($('simLength').value, 10) || LENGTHS[1];
  const seed = Math.max(1, parseInt($('simSeed').value, 10) || 1);
  simSpeedMs = parseInt($('simSpeed').value, 10);

  // Titre provisoire pendant le rejeu serveur (vraies infos juste après).
  const me = rowById(aId), opp = rowById(bId);
  $('simTitle').innerHTML = `${(me && me.icon) || '•'}<span class="strat-name">${esc((me && me.name) || '…')}</span> <span class="vs">vs</span> ${(opp && opp.icon) || '•'}<span class="strat-name">${esc((opp && opp.name) || '…')}</span>`;
  $('simStatus').textContent = 'Rejeu du match côté serveur…';
  $('simModal').classList.remove('hidden');
  if (sim) { sim.destroy(); sim = null; }

  let data;
  try {
    const res = await fetch('/api/replay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aId, bId, length, seed }),
    });
    data = await res.json();
    if (!res.ok) { $('simStatus').textContent = `Rejeu impossible : ${data.error || res.statusText}`; return; }
  } catch (e) {
    $('simStatus').textContent = `Erreur réseau : ${e.message}`;
    return;
  }

  // Reconstruit le titre avec les noms/icônes renvoyés par le serveur.
  const nameA = data.nameA, nameB = aId === bId ? `${data.nameB} (miroir)` : data.nameB;
  $('simTitle').innerHTML = `${data.iconA}<span class="strat-name">${esc(nameA)}</span> <span class="vs">vs</span> ${data.iconB}<span class="strat-name">${esc(nameB)}</span>`;

  // Deux "stratégies de rejeu" qui lisent les coups calculés par le serveur.
  const A = makeReplayStrat({ id: data.aId, name: nameA, isUser: !!data.isUserA, icon: data.iconA }, data.movesA);
  const B = makeReplayStrat({ id: data.bId, name: nameB, isUser: !!data.isUserB, icon: data.iconB }, data.movesB);

  sim = new MatchSim($('simCanvas'), { onStatus: (t) => { $('simStatus').textContent = t; refreshPlayBtn(); } });
  sim.play({ stratA: A, stratB: B, nameA, nameB, length: data.length, seed, speedMs: simSpeedMs });
  refreshPlayBtn();
  $('simPlay').focus();
}

function closeArenaSim() {
  if (sim) { sim.destroy(); sim = null; }
  $('simModal').classList.add('hidden');
}

function refreshPlayBtn() {
  const btn = $('simPlay');
  if (!sim) return;
  const st = sim.state;
  if (st.finished || !st.running) btn.textContent = '▶';
  else if (st.paused) btn.textContent = '▶';
  else btn.textContent = '⏸';
  btn.setAttribute('aria-label', st.paused || st.finished ? 'Lecture' : 'Pause');
}

// ----------------------------- SIGNALR --------------------------------
function connectHub() {
  setConn('busy', 'Connexion…');
  hub = new signalR.HubConnectionBuilder()
    .withUrl('/arenaHub')
    .withAutomaticReconnect([0, 2000, 5000, 10000])
    .build();

  hub.on('ReceiveHello', (hello) => {
    setConn('on', 'Connecté');
    if (hello?.duels) setDuels(hello.duels);
    if (hello?.leaderboard?.length) renderLeaderboard(hello.leaderboard, true);
    if (hello?.status === 'running') setStatus('running', 'Tournoi en cours…');
    updateCountdown(hello?.remainingSeconds ?? 0);
  });
  hub.on('ReceiveCountdown', (remaining) => updateCountdown(remaining));
  hub.on('ReceiveDuels', (cells) => setDuels(cells));
  hub.on('ReceiveStatus', (status) => {
    if (status === 'running') setStatus('running', 'Tournoi en cours…');
    else setStatus('idle', 'En attente du prochain tournoi…');
  });
  hub.on('ReceiveTournamentStart', (id, count) => {
    setStatus('running', `Tournoi #${id} — ${count} stratégies engagées…`);
    $('arenaProgress').textContent = `0 / ? paires`;
    prevRanks = {}; rowEls = {}; // reset pour l'animation du nouveau tournoi
    $('arenaRanking').innerHTML = '';
  });
  hub.on('ReceiveProgress', (done, total, rows) => {
    $('arenaProgress').textContent = `${done} / ${total} paires`;
    if (rows && rows.length) renderLeaderboard(rows, false);
  });
  hub.on('ReceiveLeaderboard', (rows, id) => {
    setStatus('idle', `Tournoi #${id} terminé — classement final`);
    if (rows && rows.length) renderLeaderboard(rows, true);
    setTimeout(() => { if (!statusRunning) $('arenaProgress').textContent = ''; }, 3000);
  });
  hub.on('ReceiveSubmission', (playerName, algoName, iconGlyph, total) => {
    toast(iconGlyph, `${esc(playerName)} entre dans l'arène`, `« ${esc(algoName)} » · ${total} stratégie(s)`);
  });

  hub.start().catch((e) => {
    setConn('off', 'Hors ligne');
    showBanner(`Connexion SignalR échouée : <code>${e}</code>. Le backend est-il démarré ?`, 'err', 12000);
  });
  hub.onreconnecting(() => setConn('busy', 'Reconnexion…'));
  hub.onreconnected(() => setConn('on', 'Connecté'));
  hub.onclose(() => setConn('off', 'Déconnecté'));
}

// ----------------------------- COMPTE À REBOURS -----------------------
function updateCountdown(remaining) {
  const s = Math.max(0, remaining | 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  $('cdValue').textContent = h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  $('countdown').classList.toggle('imminent', s <= 10 && s > 0);
}

// ----------------------------- STATUT / CONNEXION ---------------------
function setStatus(kind, text) {
  const el = $('arenaStatus');
  statusRunning = kind === 'running';
  el.className = `arena-status ${kind}`;
  const icon = kind === 'running'
    ? '<span class="spinner"></span>'
    : '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  el.innerHTML = icon + `<span>${esc(text)}</span>`;
}
function setConn(kind, text) {
  const el = $('connStatus');
  el.querySelector('.dot').className = `dot ${kind}`;
  $('connText').textContent = text;
}

// ----------------------------- CLASSEMENT (diff animé) ---------------
function badgeFor(row) {
  if (row.isUser) return '<span class="you-badge">Vous</span>';
  const k = KIND_LABEL[row.type];
  return k ? `<span class="kind-badge ${k.cls}">${k.label}</span>` : '';
}

function renderLeaderboard(rows, isFinal) {
  const tbody = ensureTable();
  const seen = new Set();
  lastRows = rows;   // mémos des stratégies (pour le modal des duels au clic)
  const maxAvg = Math.max(...rows.map((r) => r.avgPerTurn), 0.0001);

  rows.forEach((r) => {
    seen.add(r.id);
    let tr = rowEls[r.id];
    const isNew = !tr;
    if (isNew) {
      tr = document.createElement('tr');
      tr.dataset.id = r.id;
      tbody.appendChild(tr);
      rowEls[r.id] = tr;
    }

    // Animation de variation de rang (hors création initiale d'un tournoi).
    const prev = prevRanks[r.id];
    if (!isFinal && prev != null && r.rank < prev) {
      tr.classList.remove('row-flashed');
      void tr.offsetWidth; // reflow pour relancer l'animation
      tr.classList.add('row-flashed');
    }
    prevRanks[r.id] = r.rank;

    const pct = Math.round((r.avgPerTurn / maxAvg) * 100);
    const rankCls = r.rank === 1 ? 'top1' : r.rank === 2 ? 'top2' : r.rank === 3 ? 'top3' : '';
    const crown = r.rank === 1 ? '<span class="crown" aria-hidden="true"><svg class="crown-svg" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3 7l4.5 3.5L12 4l4.5 6.5L21 7l-2 11H5L3 7z"/></svg></span>' : '';
    const playerLine = r.isUser && r.playerName ? `<div class="player-name">par ${esc(r.playerName)}</div>` : '';
    tr.className = `${r.isUser ? 'user' : ''}`;
    tr.innerHTML = `
      <td class="rank-cell ${rankCls}">${crown}${r.rank}</td>
      <td>
        <span class="strat-icon" aria-hidden="true">${r.icon || '•'}</span>
        <span class="strat-name">${esc(r.name)}</span>${badgeFor(r)}
        ${playerLine}
      </td>
      <td>
        <div class="score-cell">${r.avgPerTurn.toFixed(2)}</div>
        <div class="bar-track" style="margin-top:5px"><div class="bar-fill ${r.isUser ? 'user' : ''}" style="width:${pct}%"></div></div>
      </td>
      <td class="num">${r.totalScore}</td>
      <td class="num">${r.wins}·${r.ties}·${r.losses}</td>`;
  });

  // Réordonne selon l'ordre courant (déplace les <tr> existants — fluide).
  rows.forEach((r) => {
    const tr = rowEls[r.id];
    if (tr) tbody.appendChild(tr);
  });
  // Supprime les lignes disparues.
  Object.keys(rowEls).forEach((id) => {
    if (!seen.has(id)) { rowEls[id].remove(); delete rowEls[id]; }
  });
}

function ensureTable() {
  let table = $('arenaRanking').querySelector('table.arena-standings');
  if (!table) {
    $('arenaRanking').innerHTML = `
      <table class="arena-standings">
        <thead><tr><th>#</th><th>Stratégie</th><th>Score / tour</th><th>Total</th><th>V·E·D</th></tr></thead>
        <tbody></tbody>
      </table>`;
    table = $('arenaRanking').querySelector('table.arena-standings');
    rowEls = {};
  }
  return table.querySelector('tbody');
}

// ----------------------------- TRIGGER --------------------------------
function bindTrigger() {
  $('triggerBtn').onclick = async () => {
    $('triggerBtn').disabled = true;
    try {
      await fetch('/api/tournament/trigger', { method: 'POST' });
    } catch (e) { /* ignoré : le hub notifiera */ }
    finally { setTimeout(() => { $('triggerBtn').disabled = false; }, 1500); }
  };
}

// ----------------------------- TOASTS / BANNER ------------------------
function toast(iconGlyph, title, sub) {
  const host = $('arenaToasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-icon">${iconGlyph}</span>` +
    `<div class="toast-body"><div class="toast-title">${title}</div>` +
    `<div class="toast-sub">${sub}</div></div>`;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 350); }, 4200);
}
function showBanner(msg, kind = 'ok', autoCloseMs = 6000) {
  const el = $('statusBanner');
  el.innerHTML = `<div class="banner ${kind}">${msg}</div>`;
  el.classList.remove('hidden');
  if (autoCloseMs) setTimeout(() => el.classList.add('hidden'), autoCloseMs);
}
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

main();