// builtin.js — Stratégies adversaires prédéfinies (portées de TourExec)
// --------------------------------------------------------------------------
// Chaque entrée est une fabrique d'objet { init(), decide(inst, ctx) }.
// L'état est conservé dans la closure retournée par init() (persistance
// d'un tour à l'autre, équivalent du -fno-automatic Fortran).
//
// ctx = { opponentLastMove, currentTurn, myScore, opponentScore,
//         randomValue, myLastMove }
// 0 = Coopérer, 1 = Trahir, opponentLastMove = -1 au tour 1.

const C = 0, D = 1;

function firstTurn(ctx) {
  return ctx.currentTurn === 1 || ctx.opponentLastMove < 0 || ctx.opponentLastMove == null;
}

// Fabrique générique : `impl(ctx, state)` retourne 0|1, state = objet mutable.
// On garde `impl` pour pouvoir afficher son code source (impl.toString()).
function makeStrategy(impl, meta) {
  return {
    meta,
    impl,
    init: () => ({}),
    decide: (state, ctx) => impl(ctx, state),
  };
}

// Tit for Tat (KTitForTatC) : coopère au tour 1 puis copie l'adversaire.
export const TitForTat = makeStrategy((ctx, s) => {
  if (firstTurn(ctx)) return C;
  return ctx.opponentLastMove;
}, { id: 'tft', name: 'Tit for Tat', desc: 'Nice · copie le dernier coup' });

// Tit for Two Tats (KTF2TC) : trahit après deux trahisons consécutives.
export const TitForTwoTats = makeStrategy((ctx, s) => {
  if (firstTurn(ctx)) return C;
  s.last = ctx.opponentLastMove;
  s.prev = (s.prev ?? C);
  const twoDefects = s.prev === D && s.last === D;
  s.prev = s.last;
  return twoDefects ? D : C;
}, { id: 'tf2t', name: 'Tit for Two Tats', desc: 'Pardonneresse · trahit après 2 trahisons' });

// Pavlov / Win-Stay Lose-Shift (KPavlovC) : garde son coup si le gain était
// élevé (R ou T), change sinon (S ou P).
export const Pavlov = makeStrategy((ctx, s) => {
  if (firstTurn(ctx) || ctx.myLastMove < 0) return C;
  const my = ctx.myLastMove, opp = ctx.opponentLastMove;
  const won = (my === C && opp === C) || (my === D && opp === C); // gain R ou T
  return won ? my : 1 - my;
}, { id: 'pavlov', name: 'Pavlov', desc: 'Win-Stay / Lose-Shift' });

// Random (KRandomC) : coopère/trahit selon random_value.
export const Random = makeStrategy((ctx, s) => {
  return ctx.randomValue < 0.5 ? C : D;
}, { id: 'random', name: 'Random', desc: 'Stochastique pur' });

// GrimTrigger : coopère jusqu'à la première trahison, puis trahit toujours.
export const GrimTrigger = makeStrategy((ctx, s) => {
  if (firstTurn(ctx)) { s.triggered = false; return C; }
  if (ctx.opponentLastMove === D) s.triggered = true;
  return s.triggered ? D : C;
}, { id: 'grim', name: 'Grim Trigger', desc: 'Coopère puis trahit à jamais' });

// AlwaysCooperate / AlwaysDefect (baselines).
export const AlwaysCooperate = makeStrategy(() => C, { id: 'allc', name: 'Always Cooperate', desc: 'Sainte' });
export const AlwaysDefect = makeStrategy(() => D, { id: 'alld', name: 'Always Defect', desc: 'Traître pur' });

// k42r (Borufsen) — version simplifiée fidèle à l'esprit : TFT + détection
// d'adversaire "aléatoire/défectif" tous les 25 tours (trahit alors 25 tours).
export const K42R = makeStrategy((ctx, s) => {
  if (firstTurn(ctx)) {
    s.oppDefect = 0; s.oppCoop = 0; s.punishing = 0; s.punishLeft = 0;
    s.threeMutualDef = 0; s.lastMy = -1; s.lastOpp = -1; s.prevMy = -1; s.prevOpp = -1;
    return C;
  }
  // Mise à jour historique
  if (ctx.opponentLastMove === D) s.oppDefect++; else s.oppCoop++;

  let move;
  if (s.punishing) {
    move = D;
    s.punishLeft--;
    if (s.punishLeft <= 0) s.punishing = false;
  } else {
    // Trahisons mutuelles consécutives -> cooperate une fois après 3
    if (ctx.myLastMove === D && ctx.opponentLastMove === D) {
      s.threeMutualDef++;
      if (s.threeMutualDef >= 3) { move = C; s.threeMutualDef = 0; }
      else move = ctx.opponentLastMove; // TFT
    } else {
      s.threeMutualDef = 0;
      move = ctx.opponentLastMove; // TFT
    }
  }

  // Tous les 25 tours : test adversaire aléatoire/défectif
  if (ctx.currentTurn > 1 && (ctx.currentTurn - 1) % 25 === 0) {
    const defectRate = s.oppDefect / (s.oppDefect + s.oppCoop);
    if (defectRate > 0.7 || (s.oppCoop < 3 && ctx.currentTurn >= 25)) {
      s.punishing = true;
      s.punishLeft = 25;
      s.threeMutualDef = 0;
      move = D;
    }
    s.oppDefect = 0; s.oppCoop = 0;
  }

  s.prevMy = s.lastMy; s.prevOpp = s.lastOpp;
  s.lastMy = ctx.myLastMove; s.lastOpp = ctx.opponentLastMove;
  return move;
}, { id: 'k42r', name: 'k42r (Borufsen)', desc: 'TFT + détection aléatoires/défectifs' });

// Champion d'Axelrod (variante TFT avec une trahison exploratoire suivie
// d'un retour à la coopération pour sortir des cycles de trahison mutuelle).
export const Champion = makeStrategy((ctx, s) => {
  if (firstTurn(ctx)) { s.probed = false; return C; }
  if (!s.probed && ctx.currentTurn === 7) { s.probed = true; return D; } // sonde
  if (s.probed && ctx.currentTurn === 8) return C; // se excuse
  return ctx.opponentLastMove; // TFT
}, { id: 'champion', name: 'Champion Axelrod', desc: 'TFT + sonde stratégique' });

// -------------------- Stratégies supplémentaires ------------------------
// Portées fidèles de TourExec (k31r, k60r, k80r) + classiques Axelrod.

// Suspicious Tit for Tat : trahit au tour 1, puis copie l'adversaire.
export const SuspiciousTitForTat = makeStrategy((ctx) => {
  if (firstTurn(ctx)) return D;
  return ctx.opponentLastMove;
}, { id: 'stft', name: 'Suspicious Tit for Tat', desc: 'TFT méfiant · trahit au 1er tour' });

// Generous Tit for Tat : TFT qui pardonne une part p des trahisons de l'adv.
export const GenerousTitForTat = makeStrategy((ctx) => {
  if (firstTurn(ctx)) return C;
  if (ctx.opponentLastMove === D) return ctx.randomValue < 0.1 ? C : D; // pardonne 10%
  return C;
}, { id: 'gtft', name: 'Generous Tit for Tat', desc: 'TFT · pardonne 10% des trahisons' });

// Reverse Tit for Tat : fait l'inverse du dernier coup de l'adversaire.
export const ReverseTitForTat = makeStrategy((ctx) => {
  if (firstTurn(ctx)) return C;
  return 1 - ctx.opponentLastMove;
}, { id: 'rtft', name: 'Reverse Tit for Tat', desc: "Fait l'inverse de l'adversaire" });

// Hard Majority (k31r, Paula Gail Grisell) : trahit si l'adversaire a trahi
// dans au moins la moitié des tours. Porté de TourExec K31R.f.
export const HardMajority = makeStrategy((ctx, s) => {
  if (firstTurn(ctx)) { s.def = 0; s.n = 0; return C; }
  s.n++;
  if (ctx.opponentLastMove === D) s.def++;
  return s.def / s.n >= 0.5 ? D : C;
}, { id: 'hardmaj', name: 'Hard Majority (Grisell)', desc: "Trahit si l'adv. trahit ≥ 50%" });

// Soft Majority : coopère sauf si l'adversaire a trahi strictement plus qu'il
// n'a coopéré. Contrepartie clémente de Hard Majority.
export const SoftMajority = makeStrategy((ctx, s) => {
  if (firstTurn(ctx)) { s.def = 0; s.coop = 0; return C; }
  if (ctx.opponentLastMove === D) s.def++; else s.coop++;
  return s.def > s.coop ? D : C;
}, { id: 'softmaj', name: 'Soft Majority', desc: 'Coopère sauf majorité de trahisons' });

// Joss : TFT mais trahit au hasard 10% du temps où il aurait coopéré.
export const Joss = makeStrategy((ctx) => {
  if (firstTurn(ctx)) return C;
  if (ctx.opponentLastMove === D) return D;
  return ctx.randomValue < 0.1 ? D : C;
}, { id: 'joss', name: 'Joss', desc: 'TFT + 10% de trahisons aléatoires' });

// Tester : trahit au 1er tour pour sonder. Si l'adversaire riposte, il
// s'excuse puis joue TFT. Sinon il exploite en alternant trahison/coop.
export const Tester = makeStrategy((ctx, s) => {
  if (firstTurn(ctx)) { s.retaliated = false; s.apologize = false; return D; }
  if (!s.retaliated && ctx.opponentLastMove === D) { s.retaliated = true; s.apologize = true; }
  if (s.retaliated) {
    if (s.apologize) { s.apologize = false; return C; }
    return ctx.opponentLastMove; // TFT
  }
  // exploitation : trahit sur les tours pairs, coopère sur les impairs (≥3)
  return ctx.currentTurn % 2 === 0 ? D : C;
}, { id: 'tester', name: 'Tester', desc: 'Sonde, exploite ou bascule en TFT' });

// Periodic C·C·D : répète coopérer, coopérer, trahir.
export const PeriodicCCD = makeStrategy((ctx) => {
  return ((ctx.currentTurn - 1) % 3) === 2 ? D : C;
}, { id: 'ccd', name: 'Periodic C·C·D', desc: 'Répète coopérer, coopérer, trahir' });

// Graaskamp (k60r, Graaskamp & Katzen) : TFT qui, à des tours de contrôle
// (11, 21, 31, 41, 51, 101), passe en trahison permanente si son score cumulé
// est sous un seuil calibré (donc si l'adversaire exploite). Porté de K60R.f.
export const Graaskamp = makeStrategy((ctx, s) => {
  if (firstTurn(ctx)) { s.gaveUp = false; return C; }
  if (s.gaveUp) return D;
  const ck = [[11, 23], [21, 53], [31, 83], [41, 113], [51, 143], [101, 293]];
  for (const [turn, thresh] of ck) {
    if (ctx.currentTurn === turn && ctx.myScore < thresh) { s.gaveUp = true; return D; }
  }
  return ctx.opponentLastMove; // TFT
}, { id: 'graaskamp', name: 'Graaskamp (k60r)', desc: 'TFT + contrôle, bascule si perdant' });

// Dawes & Batell (k80r) : coopère, mais si l'adversaire trahit trop (test
// pondéré 1.6667^def · 0.882^coop ≥ 5), bascule en trahison permanente.
// Porté de K80R.f.
export const DawesBatell = makeStrategy((ctx, s) => {
  if (firstTurn(ctx)) { s.mode = false; s.inod = 0; return C; }
  if (s.mode) return D;
  if (ctx.opponentLastMove === D) {
    s.inod++;
    const inoc = ctx.currentTurn - s.inod;
    const test = Math.pow(1.6667, s.inod) * Math.pow(0.882, inoc);
    if (test >= 5) { s.mode = true; return D; }
  }
  return C;
}, { id: 'dawes', name: 'Dawes & Batell (k80r)', desc: 'Coopère puis bascule sur seuil' });

export const BUILTIN = [
  TitForTat, TitForTwoTats, SuspiciousTitForTat, GenerousTitForTat,
  ReverseTitForTat, Pavlov, K42R, Champion, Tester, Joss,
  GrimTrigger, Graaskamp, DawesBatell, HardMajority, SoftMajority,
  PeriodicCCD, Random, AlwaysCooperate, AlwaysDefect,
];

// Personnalité de chaque stratégie : icône, type (nice/mean/noisy) et un texte
// de comportement plus détaillé que meta.desc. Appliqué par enrichment.
// type : "nice" = coopératif par défaut, "mean" = traître, "noisy" = aléatoire.
const PERSONALITY = {
  tft:     { icon: '🪞', type: 'nice',  behavior: "Coopère au 1er tour puis copie le dernier coup de l'adversaire. Simple, indulgente et rancunière — la gagnante historique d'Axelrod." },
  tf2t:    { icon: '🐢', type: 'nice',  behavior: "Ne trahit qu'après deux trahisons consécutives de l'adversaire. Plus clémente que TFT, mais exploitable par les stratégies bruitées." },
  stft:    { icon: '🤨', type: 'mean',  behavior: "TFT méfiante : trahit au 1er tour, puis copie l'adversaire. Prend l'avantage sur les gentilles, mais s'enlise contre elle-même." },
  gtft:    { icon: '💝', type: 'nice',  behavior: "TFT qui pardonne : après une trahison adverse, coopère quand même 10 % du temps. Casse les cycles de vengeance mutuelle." },
  rtft:    { icon: '🙃', type: 'mean',  behavior: "Fait l'inverse du dernier coup de l'adversaire. Anti-réciprocité pure — performe mal dans un champ de stratégies gentilles." },
  pavlov:  { icon: '🔔', type: 'nice',  behavior: "Win-Stay Lose-Shift : conserve son coup s'il a bien payé (R ou T), sinon change. Sait revenir à la coopération après une trahison mutuelle." },
  k42r:    { icon: '🛡️', type: 'nice',  behavior: "TFT robuste de Borufsen : tous les 25 tours, détecte les adversaires aléatoires ou trop défectifs et les punit 25 tours." },
  champion:{ icon: '🏆', type: 'nice',  behavior: "TFT avec une sonde : trahit au tour 7 puis se réexcuse au tour 8, pour sortir des cycles de trahison mutuelle." },
  tester:  { icon: '🧪', type: 'mean',  behavior: "Trahit au 1er tour pour sonder. Si l'adversaire riposte, s'excuse puis joue TFT ; sinon l'exploite en alternant." },
  joss:    { icon: '🎯', type: 'noisy', behavior: "TFT bruitée : comme TFT, mais trahit au hasard 10 % du temps où elle aurait coopéré. Provoque des cascades de trahison avec TFT." },
  grim:    { icon: '☠️', type: 'nice',  behavior: "Gâchette : coopère jusqu'à la moindre trahison adverse, puis trahit à jamais. Intransigeante — une seule erreur la condamne." },
  graaskamp:{ icon: '📊', type: 'nice',  behavior: "TFT avec contrôles : aux tours 11, 21, 31, 41, 51, 101, abandonne et trahit toujours si son score cumulé est sous un seuil calibré." },
  dawes:   { icon: '⚖️', type: 'nice',  behavior: "Coopère, mais si l'adversaire trahit trop (seuil pondéré), bascule en trahison permanente. Clémente puis impitoyable." },
  hardmaj: { icon: '🗳️', type: 'nice',  behavior: "Trahit dès que l'adversaire a trahi dans au moins la moitié des tours. Décision à la majorité des actes passés." },
  softmaj: { icon: '🌿', type: 'nice',  behavior: "Coopère sauf si l'adversaire a trahi strictement plus qu'il n'a coopéré. Version indulgente de Hard Majority." },
  ccd:     { icon: '🔁', type: 'mean',  behavior: "Joue périodiquement Coopérer·Coopérer·Trahir. Trahit sans provocation — déclenche des ripostes." },
  random:  { icon: '🎲', type: 'noisy', behavior: "Coopère ou trahit au hasard (50/50). Aucune mémoire, aucun objectif — utile comme étalon stochastique." },
  allc:    { icon: '🤍', type: 'nice',  behavior: "Coopère toujours, quoi qu'il arrive. Inoffensive — la proie idéale des traîtres." },
  alld:    { icon: '💀', type: 'mean',  behavior: "Trahit toujours. Gagne en duel unique mais s'effondre en tournoi à cause des trahisons mutuelles." },
};

BUILTIN.forEach((s) => {
  const p = PERSONALITY[s.meta.id];
  if (p) s.meta = { ...s.meta, ...p };
});

// Libellés affichables du type.
export const KIND_LABEL = {
  nice: { label: 'Coopératif', cls: 'kind-nice' },
  mean: { label: 'Traître', cls: 'kind-mean' },
  noisy: { label: 'Aléatoire', cls: 'kind-noisy' },
};

export function getBuiltinById(id) {
  return BUILTIN.find((s) => s.meta.id === id) || TitForTat;
}