// sim.js — Simulation de match animée (p5.js, mode instance).
// --------------------------------------------------------------------------
// Visualise un match tour-par-tour entre deux stratégies : jetons C/D animés,
// scores cumulés, barres de score, frise temporelle des coups, badge de gain
// (T/R/P/S). Pilote le moteur via les mêmes encodeurs que engine.js (PAYOFF,
// sanitizeMove) mais boucle manuellement pour permettre play/pause/restart/
// pas-à-pas. PRNG seedé (mulberry32) -> un match (graine, longueur) est
// reproductible, dans l'esprit du skill algorithmic-art (variation paramétrée).
//
// Respecte prefers-reduced-motion : tween désactivé, pacing minimal.

import { PAYOFF, sanitizeMove, COOPERATE, DEFECT } from './engine.js';

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
const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Palette (alignée sur styles.css : slate + accent indigo + 2 sémantiques).
const COL = {
  bg: '#0b1120', panel: '#111a2e', panel2: '#0d1526', border: '#1e293b',
  text: '#e2e8f0', muted: '#64748b', muted2: '#94a3b8',
  accent: '#6366f1', accentSoft: 'rgba(99,102,241,0.16)',
  coop: '#10b981', defect: '#f43f5e', bar: '#334155',
};

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
    this.instA = null; this.instB = null;
    this._gen = 0; // jeton de génération : un run s'arrête si sa génération est dépassée
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
  }

  // Lance (ou relance) un match. Retourne une promesse qui se résout à la fin.
  async play({ stratA, stratB, nameA, nameB, length, seed, speedMs }) {
    await this._mounted;
    this.stratA = stratA; this.stratB = stratB;
    this.nameA = nameA; this.nameB = nameB;
    this.length = length; this.seed = seed; this.speedMs = speedMs;
    this._gen++; // invalide tout run précédent
    const gen = this._gen;
    this.state = this._blank();
    this.instA = await stratA.init();
    this.instB = await stratB.init();
    if (gen !== this._gen) return; // un nouveau play() a pris le relais pendant l'init
    this.rng = mulberry32(seed);
    this.lastA = -1; this.lastB = -1;
    this.state.running = true;
    if (this.p5) this.p5.loop();
    this.onStatus(`${nameA} vs ${nameB} · ${length} tours · graine ${seed}`);
    this._runLoop(gen);
  }

  async _runLoop(gen) {
    while (this.state.running && !this.state.finished && gen === this._gen) {
      if (this.state.paused) { await sleep(60); continue; }
      await this._step();
      if (gen !== this._gen) return; // interrompu par un restart/play
      if (this.speedMs > 0 && !this.state.finished) await sleep(this.speedMs);
    }
    if (this.state.finished && gen === this._gen) {
      const { scoreA, scoreB } = this.state;
      const winner = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'DRAW';
      this.state.result = { winner, scoreA, scoreB };
      this.onStatus(
        `Match terminé · ${this.nameA} ${scoreA} – ${scoreB} ${this.nameB} · ` +
        (winner === 'A' ? 'victoire' : winner === 'B' ? 'défaite' : 'égalité'),
      );
      if (this.p5) this.p5.redraw();
    }
  }

  async _step() {
    const s = this.state;
    const turn = s.turn + 1;
    if (turn > this.length) { s.finished = true; s.running = false; return; }

    const ctxA = {
      opponentLastMove: this.lastB, currentTurn: turn,
      myScore: s.scoreA, opponentScore: s.scoreB,
      randomValue: this.rng(), myLastMove: this.lastA,
    };
    const ctxB = {
      opponentLastMove: this.lastA, currentTurn: turn,
      myScore: s.scoreB, opponentScore: s.scoreA,
      randomValue: this.rng(), myLastMove: this.lastB,
    };
    let rawA, rawB;
    try { rawA = await this.stratA.decide(this.instA, ctxA); }
    catch (e) { rawA = DEFECT; }
    try { rawB = await this.stratB.decide(this.instB, ctxB); }
    catch (e) { rawB = DEFECT; }

    const sA = sanitizeMove(rawA), sB = sanitizeMove(rawB);
    const mA = sA.move, mB = sB.move;
    const [gA, gB] = PAYOFF[`${mA}${mB}`];

    s.turn = turn;
    s.mA = mA; s.mB = mB;
    s.scoreA += gA; s.scoreB += gB;
    s.lastGain = [gA, gB];
    s.turnAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    s.history.push({ turn, mA, mB, gA, gB });
    this.lastA = mA; this.lastB = mB;
    if (this.p5) this.p5.redraw();
  }

  setSpeed(ms) { this.speedMs = ms; }
  pause() { if (this.state.running) this.state.paused = true; }
  resume() { this.state.paused = false; }
  togglePause() { this.state.paused ? this.resume() : this.pause(); }
  isPaused() { return this.state.paused; }
  isRunning() { return this.state.running; }

  // Redémarre le même match (même graine/longueur/stratégies).
  async restart() {
    if (!this.stratA) return;
    await this.play({
      stratA: this.stratA, stratB: this.stratB,
      nameA: this.nameA, nameB: this.nameB,
      length: this.length, seed: this.seed, speedMs: this.speedMs,
    });
  }

  destroy() {
    this._gen++; // stoppe tout run en cours
    this.state.running = false;
    if (this.p5) { try { this.p5.remove(); } catch (e) {} }
    this.container.innerHTML = '';
  }

  // --------------------------- RENDU p5 ---------------------------------
  _sketch(p) {
    const sim = this;
    p.setup = () => {
      const w = sim.container.clientWidth || 460;
      const h = 300;
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
    const w = this._w || 460, h = this._h || 300;
    const s = this.state;
    p.background(COL.bg);

    // --- bandeau titre match ---
    p.noStroke();
    p.fill(COL.panel2);
    p.rect(0, 0, w, 34);
    p.fill(COL.muted2);
    p.textSize(11);
    p.textAlign(p.LEFT, p.CENTER);
    p.text(`${this.nameA}  vs  ${this.nameB}`, 12, 17);
    p.textAlign(p.RIGHT, p.CENTER);
    const turnTxt = s.finished ? `Terminé · ${this.length} tours`
      : s.turn > 0 ? `Tour ${s.turn} / ${this.length}` : `Prêt · ${this.length} tours`;
    p.text(turnTxt, w - 12, 17);

    // --- deux cartes joueur ---
    const pad = 14;
    const cardW = (w - pad * 3) / 2;
    const cardY = 44, cardH = 96;
    const xA = pad, xB = w - pad - cardW;
    this._drawCard(p, xA, cardY, cardW, cardH, this.nameA, s.scoreA, s.mA, true, s);
    this._drawCard(p, xB, cardY, cardW, cardH, this.nameB, s.scoreB, s.mB, false, s);

    // --- badge gain central (T/R/P/S) ---
    this._drawExchange(p, cardY, cardH, xA, xB, cardW, s);

    // --- frise temporelle ---
    const tlY = cardY + cardH + 18;
    const tlH = h - tlY - 14;
    this._drawTimeline(p, pad, tlY, w - pad * 2, tlH, s);
  }

  _drawCard(p, x, y, w, h, name, score, lastMove, isLeft, s) {
    const isUser = (isLeft && this.stratA && this.stratA.meta?.isUser) ||
                   (!isLeft && this.stratB && this.stratB.meta?.isUser);
    // fond carte
    p.noStroke();
    p.fill(COL.panel);
    p.rect(x, y, w, h, 8);
    // accent bordure si utilisateur
    if (isUser) {
      p.stroke(COL.accent); p.strokeWeight(2); p.noFill();
      p.rect(x + 1, y + 1, w - 2, h - 2, 8);
      p.noStroke();
    }
    // nom
    p.fill(COL.muted2);
    p.textSize(10); p.textAlign(p.LEFT, p.TOP);
    const tag = isUser ? 'VOUS' : 'IA';
    p.text(tag, x + 12, y + 10);
    p.fill(COL.text);
    p.textSize(13); p.textStyle(p.BOLD);
    p.text(this._truncate(p, name, w - 24), x + 12, y + 24);
    p.textStyle(p.NORMAL);
    // score grand
    p.fill(COL.text);
    p.textSize(30); p.textStyle(p.BOLD);
    p.textAlign(p.RIGHT, p.TOP);
    p.text(String(score), x + w - 12, y + 10);
    p.textStyle(p.NORMAL);
    // barre de score (max théorique = length * T = length*5)
    const maxScore = this.length * 5;
    const bx = x + 12, by = y + h - 18, bw = w - 24, bh = 6;
    p.fill(COL.bar); p.rect(bx, by, bw, bh, 3);
    const frac = Math.max(0, Math.min(1, score / maxScore));
    p.fill(isUser ? COL.accent : COL.muted2);
    p.rect(bx, by, bw * frac, bh, 3);
    // dernier coup (jeton)
    if (lastMove === 0 || lastMove === 1) {
      const r = 13;
      const cx = isLeft ? x + 16 + r : x + w - 16 - r;
      const cy = y + h - 16 - r + 3;
      p.fill(moveColor(lastMove));
      p.circle(cx, cy, r * 2);
      p.fill(COL.bg);
      p.textSize(12); p.textStyle(p.BOLD); p.textAlign(p.CENTER, p.CENTER);
      p.text(moveLabel(lastMove), cx, cy + 1);
      p.textStyle(p.NORMAL);
    }
  }

  _drawExchange(p, cardY, cardH, xA, xB, cardW, s) {
    if (s.mA === null || s.mB === null) return;
    const cx = (xA + cardW + xB) / 2;
    const cy = cardY + cardH / 2;
    // tween simple du badge (si mouvement réduit -> snap)
    const tween = reducedMotion() ? 1
      : Math.min(1, (performance.now() - s.turnAt) / 220);
    const scale = 0.85 + 0.15 * tween;
    p.push();
    p.translate(cx, cy);
    p.scale(scale);
    p.noStroke();
    p.fill(COL.panel2);
    p.rect(-34, -16, 68, 32, 8);
    const tag = `${moveLabel(s.mA)} / ${moveLabel(s.mB)}`;
    p.fill(COL.text);
    p.textSize(14); p.textStyle(p.BOLD); p.textAlign(p.CENTER, p.CENTER);
    p.text(tag, 0, -2);
    // gain T/R/P/S
    const [gA, gB] = s.lastGain || [0, 0];
    let code = 'P';
    if (s.mA === 0 && s.mB === 0) code = 'R';
    else if (s.mA === 1 && s.mB === 1) code = 'P';
    else if (s.mA === 1 && s.mB === 0) code = 'T';
    else if (s.mA === 0 && s.mB === 1) code = 'S';
    p.fill(COL.muted); p.textSize(10); p.textStyle(p.NORMAL);
    p.text(`${code} · ${gA}/${gB}`, 0, 11);
    p.pop();
  }

  _drawTimeline(p, x, y, w, h, s) {
    p.noStroke();
    p.fill(COL.muted);
    p.textSize(10); p.textAlign(p.LEFT, p.BOTTOM);
    p.text('Frise des coups', x, y - 3);
    p.textAlign(p.RIGHT, p.BOTTOM);
    p.text('C = coopérer · D = trahir', x + w, y - 3);

    const hist = s.history;
    const n = this.length;
    const innerY = y + 14, innerH = h - 14;
    // fond
    p.fill(COL.panel2);
    p.rect(x, innerY, w, innerH, 6);
    if (n === 0) return;
    const cell = Math.max(1, Math.floor(w / n));
    const used = cell * n;
    const ox = x + (w - used) / 2; // centré si cell<1 écart
    const rowH = (innerH - 4) / 2;
    for (let i = 0; i < hist.length; i++) {
      const ev = hist[i];
      const cx = x + (w - used) / 2 + i * cell;
      // ligne A (haut)
      p.fill(moveColor(ev.mA));
      p.rect(cx, innerY + 2, Math.max(1, cell - 0.5), rowH - 1, 1);
      // ligne B (bas)
      p.fill(moveColor(ev.mB));
      p.rect(cx, innerY + 2 + rowH, Math.max(1, cell - 0.5), rowH - 1, 1);
    }
    // curseur tour courant
    if (s.turn > 0 && !s.finished) {
      const cx = x + (w - used) / 2 + (s.turn - 1) * cell + cell / 2;
      p.stroke(COL.text); p.strokeWeight(1);
      p.line(cx, innerY, cx, innerY + innerH);
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