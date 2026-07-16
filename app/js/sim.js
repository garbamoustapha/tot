// sim.js — Simulation de match animée (p5.js, mode instance).
// --------------------------------------------------------------------------
// Visualise un match tour-par-tour entre deux stratégies : jetons C/D animés,
// scores cumulés, barres de score, frise temporelle des coups, badge de gain
// (T/R/P/S). Le match est joué par engine.playMatch (source unique de vérité :
// mêmes gains, même consommation du PRNG, mêmes fautes/bruit que le tournoi) ;
// sim.js ne fait que cadencer les tours via onTurn — play/pause/pas-à-pas/
// restart. PRNG seedé (mulberry32) -> un match (graine, longueur) est
// reproductible, dans l'esprit du skill algorithmic-art (variation paramétrée).
//
// Respecte prefers-reduced-motion : tween désactivé, pacing minimal.

import { playMatch, COOPERATE, DEFECT } from './engine.js';

// Vitesse -> délai entre tours (ms). 0 = instantané.
export const SPEEDS = [
  { label: '0,5×', ms: 400 },
  { label: '1×', ms: 200 },
  { label: '2×', ms: 90 },
  { label: '4×', ms: 35 },
  { label: 'Instant', ms: 0 },
];

// PRNG mulberry32 — déterministe pour une graine donnée.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Palette lue depuis les variables CSS (styles.css) pour suivre le mode
// clair/sombre. Recalculée à chaque bascule de thème via l'événement
// `themechange` diffusé par theme.js.
function readPalette() {
  const fallback = {
    bg: '#0b1120', panel: '#111a2e', panel2: '#0d1526', border: '#1e293b',
    text: '#e2e8f0', muted: '#64748b', muted2: '#94a3b8',
    accent: '#6366f1', accentSoft: 'rgba(99,102,241,0.16)',
    coop: '#10b981', defect: '#f43f5e', bar: '#334155',
  };
  if (typeof window === 'undefined' || !window.getComputedStyle) return fallback;
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fb) => (cs.getPropertyValue(name).trim() || fb);
  return {
    bg: v('--bg', fallback.bg), panel: v('--panel', fallback.panel),
    panel2: v('--panel-2', fallback.panel2), border: v('--border', fallback.border),
    text: v('--text', fallback.text), muted: v('--muted', fallback.muted),
    muted2: v('--muted-2', fallback.muted2), accent: v('--accent', fallback.accent),
    accentSoft: v('--accent-soft', fallback.accentSoft),
    coop: v('--nice', fallback.coop), defect: v('--mean', fallback.defect),
    noisy: v('--noisy', '#f59e0b'), bar: v('--bar', fallback.bar),
  };
}

// Métadonnées d'une issue (les 4 quadrants du dilemme) — couleur + libellé,
// du point de vue du joueur A. Sert au badge d'échange et à la surbrillance.
function outcomeInfo(mA, mB) {
  if (mA === COOPERATE && mB === COOPERATE)
    return { code: 'R', color: COL.coop, label: 'Coopération mutuelle' };
  if (mA === DEFECT && mB === DEFECT)
    return { code: 'P', color: COL.defect, label: 'Trahison mutuelle' };
  if (mA === DEFECT && mB === COOPERATE)
    return { code: 'T', color: COL.noisy, label: 'A exploite B' };
  return { code: 'S', color: COL.noisy, label: 'B exploite A' };
}

// Interpolations d'accélération (0..1).
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
// Mélange linéaire de deux couleurs hex/rgb via p5 (retourne un p5.Color).
function lerpCol(p, a, b, t) { return p.lerpColor(p.color(a), p.color(b), t); }
let activeSim = null;           // instance MatchSim actuellement montée (pour redraw)
let COL = readPalette();
if (typeof window !== 'undefined') {
  window.addEventListener('themechange', () => {
    COL = readPalette();
    if (activeSim && activeSim.p5) { try { activeSim.p5.redraw(); } catch (e) {} }
  });
}

// encode un coup en libellé/couleur
const moveColor = (m) => (m === COOPERATE ? COL.coop : COL.defect);
const moveLabel = (m) => (m === COOPERATE ? 'C' : 'D');

export class MatchSim {
  constructor(container, { onStatus } = {}) {
    this.container = container;
    this.onStatus = onStatus || (() => {});
    this.p5 = null;
    this.state = this._blank();
    this.stratA = null; this.stratB = null;
    this.nameA = ''; this.nameB = '';
    this.length = 77; this.seed = 1; this.speedMs = 200;
    this.noise = 0;
    this._gen = 0;          // jeton de génération : un run s'arrête si sa génération est dépassée
    this._abort = null;     // AbortController du run en cours
    this._gateRelease = null; // résolveur de la pause en cours (resume/step/destroy)
    this._stepPending = 0;  // nb de tours à jouer en mode pas-à-pas
    this._mounted = this._mount();
  }

  _blank() {
    return {
      turn: 0, mA: null, mB: null, scoreA: 0, scoreB: 0,
      history: [], running: false, paused: false, finished: false,
      lastGain: null, turnAt: 0, // perf.now() du dernier tour (pour tween)
      result: null,
    };
  }

  async _mount() {
    const p5mod = window.p5;
    if (!p5mod) throw new Error('p5.js non chargé');
    this.p5 = new p5mod((p) => this._sketch(p), this.container);
    activeSim = this;      // cible du redraw lors d'une bascule de thème
    COL = readPalette();   // recale la palette sur le thème courant au montage
  }

  // Lance (ou relance) un match. Retourne une promesse qui se résout à la fin.
  // startPaused : démarre en pause après le premier tour (mode pas-à-pas).
  async play({ stratA, stratB, nameA, nameB, length, seed, speedMs, noise = 0, startPaused = false }) {
    await this._mounted;
    this.stratA = stratA; this.stratB = stratB;
    this.nameA = nameA; this.nameB = nameB;
    this.length = length; this.seed = seed; this.speedMs = speedMs;
    this.noise = noise;
    this._gen++; // invalide tout run précédent
    const gen = this._gen;
    if (this._abort) this._abort.abort(); // stoppe le playMatch précédent
    this._releaseGate();                  // débloque un éventuel run en pause
    const ac = new AbortController();
    this._abort = ac;
    this._stepPending = 0;
    this.state = this._blank();
    this.state.paused = startPaused;
    this.state.running = true;
    if (this.p5) this.p5.loop();
    this.onStatus(`${nameA} vs ${nameB} · ${length} tours · graine ${seed}`);

    let res;
    try {
      // Le moteur joue le match ; la simulation ne fait que cadencer les tours.
      res = await playMatch(stratA, stratB, length, {
        rng: mulberry32(seed),
        noise,
        signal: ac.signal,
        onTurn: async (ev) => {
          if (gen !== this._gen) return;
          this._applyTurn(ev);
          await this._gate(gen);
        },
      });
    } catch (e) {
      if (gen !== this._gen || ac.signal.aborted) return; // interrompu par restart/play/destroy
      this.state.running = false;
      this.onStatus(`Match interrompu : ${e.message}`);
      return;
    }
    if (gen !== this._gen) return;
    this._finish(res);
  }

  // Applique l'événement de tour du moteur à l'état de rendu.
  _applyTurn(ev) {
    const s = this.state;
    s.turn = ev.turn;
    s.mA = ev.mA; s.mB = ev.mB;
    s.scoreA = ev.scoreA; s.scoreB = ev.scoreB;
    s.lastGain = [ev.gainA, ev.gainB];
    s.turnAt = now();
    s.history.push(ev);
    // Mode instantané : redraws regroupés (1 tour sur 12 + le dernier) pour
    // ne pas payer 308 rendus synchrones.
    const instant = this.speedMs === 0 && !s.paused && this._stepPending === 0;
    if (this.p5 && (!instant || ev.turn === this.length || ev.turn % 12 === 0)) this.p5.redraw();
  }

  // Cadence entre deux tours : vitesse, pause, pas-à-pas. Sommeil découpé pour
  // réagir immédiatement à un changement de vitesse / pause / step.
  async _gate(gen) {
    while (gen === this._gen) {
      if (this._stepPending > 0) { this._stepPending--; return; } // avance d'un tour
      if (this.state.paused) { this._idleFreeze(); await this._waitResume(); continue; }
      const t0 = now();
      if (this.speedMs <= 0) {
        // Instantané : cède la main de temps en temps pour laisser respirer l'UI.
        if (this.state.turn % 24 === 0) await sleep(0);
        return;
      }
      while (gen === this._gen && !this.state.paused && this._stepPending === 0) {
        const target = this.speedMs;
        const elapsed = now() - t0;
        if (target <= 0 || elapsed >= target) return;
        await sleep(Math.min(50, target - elapsed));
      }
      // état changé pendant l'attente (pause ou step) : on ré-évalue
    }
  }

  _waitResume() {
    return new Promise((r) => { this._gateRelease = r; });
  }

  _releaseGate() {
    if (this._gateRelease) { const r = this._gateRelease; this._gateRelease = null; r(); }
  }

  // Fige le rendu p5 après le tween si toujours en pause (économie CPU).
  _idleFreeze(delay = 450) {
    const gen = this._gen;
    setTimeout(() => {
      if (gen === this._gen && this.p5 && this.state.paused && this._stepPending === 0) {
        this.p5.noLoop();
      }
    }, delay);
  }

  _finish(res) {
    const s = this.state;
    s.finished = true; s.running = false; s.paused = false;
    const { scoreA, scoreB, winner, faultsA, faultsB } = res;
    s.result = { winner, scoreA, scoreB };
    s.finishedAt = now();
    // Verdict relatif au joueur ("VOUS") quand il participe, neutre sinon.
    const userA = !!this.stratA?.meta?.isUser;
    const userB = !!this.stratB?.meta?.isUser;
    const winName = winner === 'A' ? this.nameA : this.nameB;
    let verdict;
    if (winner === 'DRAW') verdict = 'égalité';
    else if (userA && userB) verdict = `${winName} l'emporte`;
    else if ((winner === 'A' && userA) || (winner === 'B' && userB)) verdict = 'victoire';
    else if (userA || userB) verdict = 'défaite';
    else verdict = `${winName} l'emporte`;
    const faults =
      (faultsA ? ` · ${faultsA} coup(s) invalide(s) — ${this.nameA}` : '') +
      (faultsB ? ` · ${faultsB} coup(s) invalide(s) — ${this.nameB}` : '');
    this.onStatus(`Match terminé · ${this.nameA} ${scoreA} – ${scoreB} ${this.nameB} · ${verdict}${faults}`);
    // Laisse tourner la boucle ~1,4 s pour animer le pop final + la bannière
    // de victoire, puis fige le rendu (économie CPU) tout en gardant l'image.
    if (this.p5) {
      this.p5.redraw();
      this.p5.loop();
      const gen2 = this._gen;
      setTimeout(() => { if (gen2 === this._gen && this.p5) this.p5.noLoop(); }, 1400);
    }
  }

  setSpeed(ms) { this.speedMs = ms; }

  pause() {
    if (!this.state.running || this.state.finished) return;
    this.state.paused = true; // la porte de cadencement gèle le rendu (_idleFreeze)
  }

  resume() {
    this.state.paused = false;
    if (this.p5) this.p5.loop();
    this._releaseGate();
  }

  togglePause() { this.state.paused ? this.resume() : this.pause(); }
  isPaused() { return this.state.paused; }
  isRunning() { return this.state.running; }

  // Avance d'exactement un tour. Si aucun match ne tourne (jamais lancé ou
  // terminé), relance le même match en pause : le premier appui joue le tour 1.
  step() {
    if (!this.state.running || this.state.finished) {
      if (!this.stratA) return;
      this.play({
        stratA: this.stratA, stratB: this.stratB,
        nameA: this.nameA, nameB: this.nameB,
        length: this.length, seed: this.seed, speedMs: this.speedMs,
        noise: this.noise, startPaused: true,
      });
      return;
    }
    this.state.paused = true;
    this._stepPending++;
    if (this.p5) this.p5.loop();
    this._releaseGate();
  }

  // Redémarre le même match (même graine/longueur/stratégies).
  async restart() {
    if (!this.stratA) return;
    await this.play({
      stratA: this.stratA, stratB: this.stratB,
      nameA: this.nameA, nameB: this.nameB,
      length: this.length, seed: this.seed, speedMs: this.speedMs,
      noise: this.noise,
    });
  }

  destroy() {
    this._gen++; // stoppe tout run en cours
    if (this._abort) this._abort.abort();
    this._releaseGate();
    this.state.running = false;
    if (this.p5) { try { this.p5.remove(); } catch (e) {} }
    if (activeSim === this) activeSim = null;
    this.container.innerHTML = '';
  }

  // --------------------------- RENDU p5 ---------------------------------
  _sketch(p) {
    const sim = this;
    p.setup = () => {
      const w = sim.container.clientWidth || 460;
      const h = 336;
      const c = p.createCanvas(w, h);
      c.parent(sim.container);
      p.pixelDensity(window.devicePixelRatio || 1);
      p.textFont('Inter');
      p.noLoop();
      sim._w = w; sim._h = h;
    };
    p.windowResized = () => {
      const w = sim.container.clientWidth || 460;
      sim._w = w;
      p.resizeCanvas(w, sim._h);
      p.redraw();
    };
    p.draw = () => sim._draw(p);
  }

  _draw(p) {
    const w = this._w || 460, h = this._h || 336;
    const s = this.state;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // Progression d'apparition du dernier coup (0..1) : pilote les pops/tweens.
    this._appear = reducedMotion() ? 1 : Math.min(1, (now - s.turnAt) / 260);
    p.background(COL.bg);

    // --- bandeau titre match ---
    p.noStroke();
    p.fill(COL.panel2);
    p.rect(0, 0, w, 34);
    p.fill(COL.muted2);
    p.textSize(11);
    p.textAlign(p.LEFT, p.CENTER);
    p.textStyle(p.BOLD);
    p.text(`${this.nameA}  vs  ${this.nameB}`, 12, 17);
    p.textStyle(p.NORMAL);
    p.textAlign(p.RIGHT, p.CENTER);
    const turnTxt = s.finished ? `Terminé · ${this.length} tours`
      : s.turn > 0 ? `Tour ${s.turn} / ${this.length}` : `Prêt · ${this.length} tours`;
    p.text(turnTxt, w - 12, 17);
    // fine barre de progression du match sous le bandeau
    const prog = this.length ? Math.min(1, s.turn / this.length) : 0;
    p.fill(COL.border); p.rect(0, 33, w, 2);
    p.fill(COL.accent); p.rect(0, 33, w * prog, 2);

    // --- deux cartes joueur ---
    const pad = 14;
    const cardW = (w - pad * 3) / 2;
    const cardY = 44, cardH = 96;
    const xA = pad, xB = w - pad - cardW;
    const winner = s.result?.winner;
    this._drawCard(p, xA, cardY, cardW, cardH, this.nameA, s.scoreA, s.mA, true, s, winner === 'A');
    this._drawCard(p, xB, cardY, cardW, cardH, this.nameB, s.scoreB, s.mB, false, s, winner === 'B');

    // --- bande d'issue (pleine largeur, colorée par le quadrant) ---
    const stripY = cardY + cardH + 10, stripH = 28;
    this._drawOutcome(p, pad, stripY, w - pad * 2, stripH, s);

    // --- frise temporelle ---
    const tlY = stripY + stripH + 16;
    const tlH = h - tlY - 12;
    this._drawTimeline(p, pad, tlY, w - pad * 2, tlH, s);
  }

  _drawCard(p, x, y, w, h, name, score, lastMove, isLeft, s, isWinner) {
    const isUser = (isLeft && this.stratA && this.stratA.meta?.isUser) ||
                   (!isLeft && this.stratB && this.stratB.meta?.isUser);
    const accent = isUser ? COL.accent : COL.muted2;
    // fond carte (léger halo doré pour le vainqueur)
    p.noStroke();
    p.fill(COL.panel);
    p.rect(x, y, w, h, 10);
    if (isWinner) {
      p.stroke(COL.noisy); p.strokeWeight(2); p.noFill();
      p.rect(x + 1, y + 1, w - 2, h - 2, 10);
      p.noStroke();
    } else if (isUser) {
      p.stroke(COL.accent); p.strokeWeight(1.5); p.noFill();
      p.rect(x + 1, y + 1, w - 2, h - 2, 10);
      p.noStroke();
    }
    // pastille de rôle + éventuelle couronne du vainqueur
    p.fill(accent);
    p.textSize(9.5); p.textAlign(p.LEFT, p.TOP); p.textStyle(p.BOLD);
    const tag = (isUser ? 'VOUS' : 'IA') + (isWinner ? '  👑' : '');
    p.text(tag, x + 13, y + 12);
    // nom
    p.fill(COL.text);
    p.textSize(13); p.textStyle(p.BOLD);
    p.text(this._truncate(p, name, w - 26), x + 13, y + 26);
    p.textStyle(p.NORMAL);
    // score grand (mono)
    p.fill(COL.text);
    p.textSize(32); p.textStyle(p.BOLD);
    p.textAlign(p.RIGHT, p.TOP);
    p.text(String(score), x + w - 13, y + 12);
    p.textStyle(p.NORMAL);
    // gain flottant du dernier tour (fondu ascendant)
    const gain = s.lastGain ? (isLeft ? s.lastGain[0] : s.lastGain[1]) : null;
    if (gain != null && s.turn > 0 && this._appear < 1) {
      const a = 1 - this._appear;
      const gc = gain >= 3 ? COL.coop : gain === 0 ? COL.defect : COL.muted2;
      p.push();
      const c = p.color(gc); c.setAlpha(200 * a);
      p.fill(c);
      p.textSize(12); p.textStyle(p.BOLD); p.textAlign(p.RIGHT, p.TOP);
      p.text(`+${gain}`, x + w - 13, y + 44 - 10 * easeOutCubic(this._appear));
      p.pop();
      p.textStyle(p.NORMAL);
    }
    // barre de score (max théorique = length * T = length*5)
    const maxScore = this.length * 5;
    const bx = x + 13, by = y + h - 34, bw = w - 26, bh = 6;
    p.fill(COL.bar); p.rect(bx, by, bw, bh, 3);
    const frac = Math.max(0, Math.min(1, score / maxScore));
    p.fill(accent);
    p.rect(bx, by, bw * frac, bh, 3);

    // dernier coup : gros jeton animé (pop) + libellé sous la barre
    if (lastMove === 0 || lastMove === 1) {
      const r = 15;
      const cx = isLeft ? x + 15 + r : x + w - 15 - r;
      const cy = y + h - 16;
      const pop = reducedMotion() ? 1 : easeOutBack(this._appear);
      p.push();
      p.translate(cx, cy);
      p.scale(0.4 + 0.6 * Math.max(0, pop));
      // anneau de pulsation à l'apparition
      if (this._appear < 1 && !reducedMotion()) {
        const rc = p.color(moveColor(lastMove));
        rc.setAlpha(120 * (1 - this._appear));
        p.noFill(); p.stroke(rc); p.strokeWeight(2);
        p.circle(0, 0, r * 2 + 16 * this._appear);
        p.noStroke();
      }
      p.fill(moveColor(lastMove));
      p.circle(0, 0, r * 2);
      p.fill(COL.bg);
      p.textSize(14); p.textStyle(p.BOLD); p.textAlign(p.CENTER, p.CENTER);
      p.text(moveLabel(lastMove), 0, 1);
      p.textStyle(p.NORMAL);
      p.pop();
      // libellé du coup à côté du jeton
      p.fill(COL.muted);
      p.textSize(10); p.textStyle(p.NORMAL);
      p.textAlign(isLeft ? p.LEFT : p.RIGHT, p.CENTER);
      const lbl = lastMove === COOPERATE ? 'coopère' : 'trahit';
      p.text(lbl, isLeft ? cx + r + 8 : cx - r - 8, cy);
    }
  }

  // Bande d'issue pleine largeur sous les cartes : liseré de couleur du quadrant,
  // jetons des deux coups, libellé de l'issue et gains. Zéro chevauchement avec
  // les scores. Fond en fondu à chaque nouveau tour.
  _drawOutcome(p, x, y, w, h, s) {
    const cy = y + h / 2;
    if (s.mA === null || s.mB === null) {
      p.noStroke(); p.fill(COL.panel2); p.rect(x, y, w, h, 8);
      p.fill(COL.muted); p.textSize(11); p.textStyle(p.NORMAL);
      p.textAlign(p.CENTER, p.CENTER);
      p.text('En attente du premier tour…', x + w / 2, cy);
      return;
    }
    const info = outcomeInfo(s.mA, s.mB);
    const [gA, gB] = s.lastGain || [0, 0];
    const app = this._appear;

    // fond : teinte de l'issue qui s'estompe vers le panneau neutre
    p.noStroke();
    p.fill(lerpCol(p, info.color, COL.panel2, 0.82 + 0.14 * app));
    p.rect(x, y, w, h, 8);
    // liseré gauche de couleur pleine (coins : haut-gauche, haut-droit, bas-droit, bas-gauche)
    p.fill(info.color); p.rect(x, y, 4, h, 8, 0, 0, 8);

    // deux jetons de coups (A puis B), pop à l'apparition
    const r = 10;
    const pop = reducedMotion() ? 1 : easeOutBack(app);
    const drawTok = (tx, move, who) => {
      p.push(); p.translate(tx, cy); p.scale(0.5 + 0.5 * Math.max(0, pop));
      p.fill(moveColor(move)); p.circle(0, 0, r * 2);
      p.fill(COL.bg); p.textSize(11); p.textStyle(p.BOLD);
      p.textAlign(p.CENTER, p.CENTER); p.text(moveLabel(move), 0, 1);
      p.pop();
      p.fill(COL.muted); p.textSize(8.5); p.textStyle(p.BOLD);
      p.textAlign(p.CENTER, p.CENTER); p.text(who, tx, cy - r - 6);
    };
    drawTok(x + 22, s.mA, 'A');
    drawTok(x + 48, s.mB, 'B');

    // libellé de l'issue (centré)
    p.fill(info.color);
    p.textSize(12); p.textStyle(p.BOLD); p.textAlign(p.LEFT, p.CENTER);
    p.text(info.label, x + 70, cy - 1);

    // code + gains (à droite)
    p.textAlign(p.RIGHT, p.CENTER);
    p.fill(COL.muted2); p.textSize(10); p.textStyle(p.NORMAL);
    p.text(`gain  +${gA} / +${gB}`, x + w - 30, cy);
    p.fill(info.color); p.textSize(12); p.textStyle(p.BOLD);
    p.text(info.code, x + w - 12, cy);
    p.textStyle(p.NORMAL);
  }

  _drawTimeline(p, x, y, w, h, s) {
    p.noStroke();
    p.fill(COL.muted2);
    p.textSize(10); p.textStyle(p.BOLD); p.textAlign(p.LEFT, p.BOTTOM);
    p.text('Frise des coups', x, y - 4);
    p.textStyle(p.NORMAL);
    // légende C/D
    p.textAlign(p.RIGHT, p.BOTTOM);
    const lx = x + w;
    p.fill(COL.coop); p.circle(lx - 92, y - 8, 8);
    p.fill(COL.muted); p.text('coopérer', lx - 52, y - 3);
    p.fill(COL.defect); p.circle(lx - 44, y - 8, 8);
    p.fill(COL.muted); p.text('trahir', lx, y - 3);

    const hist = s.history;
    const n = this.length;
    const labelW = 16;                       // colonne des libellés A / B
    const gx = x + labelW, gw = w - labelW;
    const innerY = y + 2, innerH = h - 2;
    p.fill(COL.panel2);
    p.rect(gx, innerY, gw, innerH, 6);
    if (n === 0) return;

    const cell = gw / n;                      // largeur exacte (float) d'un tour
    const gap = cell > 4 ? 1 : 0;             // petit espace si les cellules sont larges
    const rowGap = 3;
    const rowH = (innerH - rowGap) / 2;
    const yArow = innerY, yBrow = innerY + rowH + rowGap;

    // libellés de ligne A / B
    p.fill(COL.muted2); p.textSize(9); p.textStyle(p.BOLD);
    p.textAlign(p.LEFT, p.CENTER);
    p.text('A', x, yArow + rowH / 2);
    p.text('B', x, yBrow + rowH / 2);
    p.textStyle(p.NORMAL);

    // graduations tous les 25 tours
    p.textAlign(p.CENTER, p.TOP);
    for (let t = 25; t < n; t += 25) {
      const gxt = gx + t * cell;
      const gc = p.color(COL.border); gc.setAlpha(160);
      p.stroke(gc); p.strokeWeight(1);
      p.line(gxt, innerY, gxt, innerY + innerH);
      p.noStroke();
    }

    // cellules de coups (A en haut, B en bas)
    for (let i = 0; i < hist.length; i++) {
      const ev = hist[i];
      const cxr = gx + i * cell;
      const cw = Math.max(1, cell - gap);
      p.fill(moveColor(ev.mA)); p.rect(cxr, yArow, cw, rowH, 1);
      p.fill(moveColor(ev.mB)); p.rect(cxr, yBrow, cw, rowH, 1);
    }

    // curseur du tour courant, avec petit halo
    if (s.turn > 0 && !s.finished) {
      const cxr = gx + (s.turn - 1) * cell + cell / 2;
      const gc = p.color(COL.text); gc.setAlpha(60);
      p.stroke(gc); p.strokeWeight(3); p.line(cxr, innerY, cxr, innerY + innerH);
      p.stroke(COL.text); p.strokeWeight(1); p.line(cxr, innerY, cxr, innerY + innerH);
      p.noStroke();
    }
  }

  _truncate(p, txt, maxW) {
    if (p.textWidth(txt) <= maxW) return txt;
    let t = txt;
    while (t.length > 1 && p.textWidth(t + '…') > maxW) t = t.slice(0, -1);
    return t + '…';
  }
}
