// engine.js — Moteur de tournoi du Dilemme du Prisonnier Itéré (Axelrod)
// --------------------------------------------------------------------------
// Matrice de gain (T,R,P,S) = (5,3,1,0)  — conforme à TourExec/AxTest.f
//   C/C -> R=3 / R=3      (coopération mutuelle)
//   D/D -> P=1 / P=1      (trahison mutuelle)
//   D/C -> T=5 / S=0      (tentation / pigeon)
// Encodage des coups : 0 = Coopérer, 1 = Trahir.
// Convention "pas de coup précédent" au tour 1 : opponentLastMove = -1.

export const COOPERATE = 0;
export const DEFECT = 1;
export const LENGTHS = [63, 77, 151, 156, 308];
export const PAYOFF = {
  '00': [3, 3],
  '11': [1, 1],
  '10': [5, 0], // joueur trahit (1), adv coopère (0) -> T/S
  '01': [0, 5], // joueur coopère (0), adv trahit (1) -> S/T
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Force toute valeur retournée par une stratégie vers 0 ou 1.
// Toute valeur invalide -> coup forfait (trahir) + marque une faute.
export function sanitizeMove(mv) {
  if (mv === 0 || mv === 1) return { move: mv, fault: false };
  if (mv === true) return { move: 1, fault: false };
  if (mv === false) return { move: 0, fault: false };
  const n = Number(mv);
  if (n === 0) return { move: 0, fault: false };
  if (n === 1) return { move: 1, fault: false };
  return { move: DEFECT, fault: true }; // coup forfait
}

// Une "stratégie" est un objet : { init(): instance, decide(instance, ctx): 0|1 }
// ctx = { opponentLastMove, currentTurn, myScore, opponentScore, randomValue, myLastMove }
// decide peut être synchrone ou asynchrone (Pyodide).

// Joue un match unique de `length` tours entre stratA et stratB.
// opts = { rng, noise (0..1), onTurn(event), delayMs, signal }
export async function playMatch(stratA, stratB, length, opts = {}) {
  const rng = opts.rng || Math.random;
  const noise = opts.noise || 0;
  const instA = await stratA.init();
  const instB = await stratB.init();
  let lastA = -1;
  let lastB = -1;
  let scoreA = 0;
  let scoreB = 0;
  let faultsA = 0;
  let faultsB = 0;
  const log = [];

  for (let turn = 1; turn <= length; turn++) {
    if (opts.signal?.aborted) throw new Error('aborted');

    const ctxA = {
      opponentLastMove: lastB,
      currentTurn: turn,
      myScore: scoreA,
      opponentScore: scoreB,
      randomValue: rng(),
      myLastMove: lastA,
    };
    const ctxB = {
      opponentLastMove: lastA,
      currentTurn: turn,
      myScore: scoreB,
      opponentScore: scoreA,
      randomValue: rng(),
      myLastMove: lastB,
    };

    let rawA = await stratA.decide(instA, ctxA);
    let rawB = await stratB.decide(instB, ctxB);

    let sA = sanitizeMove(rawA);
    let sB = sanitizeMove(rawB);
    if (sA.fault) faultsA++;
    if (sB.fault) faultsB++;
    let mA = sA.move;
    let mB = sB.move;

    // Bruit (trembling hand) : un coup est inversé avec probabilité `noise`.
    if (noise > 0) {
      if (rng() < noise) mA = 1 - mA;
      if (rng() < noise) mB = 1 - mB;
    }

    const [gainA, gainB] = PAYOFF[`${mA}${mB}`];
    scoreA += gainA;
    scoreB += gainB;

    const ev = {
      turn, mA, mB, gainA, gainB, scoreA, scoreB,
      rawA, rawB, faultA: sA.fault, faultB: sB.fault,
    };
    log.push(ev);
    lastA = mA;
    lastB = mB;

    if (opts.onTurn) opts.onTurn(ev, { instA, instB });
    if (opts.delayMs && opts.delayMs > 0) await sleep(opts.delayMs);
  }

  return {
    scoreA, scoreB, faultsA, faultsB, log, length,
    winner: scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'DRAW',
  };
}

// Benchmark complet : 5 longueurs × N répétitions, moyenne des scores.
// Stratégies : re-instanciées à chaque match (joue aussi contre elle-même
// si a et b sont le même objet, pour mesurer la robustesse face à un clone).
export async function benchmark(stratA, stratB, { lengths = LENGTHS, reps = 10, rng, noise = 0, onProgress } = {}) {
  const results = [];
  let totalA = 0, totalB = 0, n = 0;
  for (const len of lengths) {
    let lenA = 0, lenB = 0;
    for (let r = 0; r < reps; r++) {
      const res = await playMatch(stratA, stratB, len, { rng, noise });
      lenA += res.scoreA;
      lenB += res.scoreB;
      totalA += res.scoreA;
      totalB += res.scoreB;
      n++;
      if (onProgress) onProgress({ len, rep: r + 1, reps, totalA, totalB, n });
    }
    results.push({ length: len, avgA: lenA / reps, avgB: lenB / reps });
  }
  return {
    results,
    avgA: totalA / n,
    avgB: totalB / n,
    matches: n,
  };
}

// Tournoi round-robin : chaque stratégie affronte toutes les autres ET elle-même
// (self-play inclus, à la Axelrod), sur les 5 longueurs de manches. Renvoie le
// classement du premier au dernier, trié par score moyen par tour (métrique
// equitable quelle que soit la longueur des manches).
//
// strategies : tableau d'objets { meta:{id,name}, init, decide }.
// opts : { lengths=LENGTHS, reps=1, onProgress(done, total, stats), onResult(i,j,length,res) }
//   onResult est appelé après chaque match (utile pour accumuler un head-to-head).
// Retour : tableau trié de { index, name, isUser, rank, totalScore, totalTurns,
//   matches, avgPerTurn, avgPerMatch, wins, ties, losses }.
export async function roundRobin(strategies, { lengths = LENGTHS, reps = 1, onProgress, onResult } = {}) {
  const n = strategies.length;
  const stats = strategies.map((s, i) => ({
    index: i,
    name: s.meta?.name || `Stratégie ${i + 1}`,
    isUser: !!s.meta?.isUser,
    totalScore: 0,
    totalTurns: 0,
    matches: 0,
    wins: 0,
    ties: 0,
    losses: 0,
  }));

  const totalPairs = (n * (n + 1)) / 2; // i <= j, self-play inclus
  let done = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      for (const len of lengths) {
        for (let r = 0; r < reps; r++) {
          const res = await playMatch(strategies[i], strategies[j], len);
          stats[i].totalScore += res.scoreA;
          stats[i].totalTurns += len;
          stats[i].matches += 1;
          stats[j].totalScore += res.scoreB;
          stats[j].totalTurns += len;
          stats[j].matches += 1;
          if (onResult) onResult(i, j, len, res);
          if (i !== j) {
            if (res.scoreA > res.scoreB) { stats[i].wins++; stats[j].losses++; }
            else if (res.scoreA < res.scoreB) { stats[i].losses++; stats[j].wins++; }
            else { stats[i].ties++; stats[j].ties++; }
          }
        }
      }
      done++;
      if (onProgress) onProgress(done, totalPairs, stats);
    }
  }

  stats.forEach((s) => {
    s.avgPerTurn = s.totalTurns ? s.totalScore / s.totalTurns : 0;
    s.avgPerMatch = s.matches ? s.totalScore / s.matches : 0;
  });
  stats.sort((a, b) => b.avgPerTurn - a.avgPerTurn || b.totalScore - a.totalScore);
  stats.forEach((s, i) => { s.rank = i + 1; });
  return stats;
}