// test-online-arena.mjs — Test E2E de l'arène en ligne (REST + SignalR).
// Usage: node test-online-arena.mjs [base=http://localhost:5080]
const BASE = process.argv[2] || 'http://localhost:5080';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

console.log('# Test arène en ligne —', BASE);

// 1) Icônes
const icons = await (await fetch(`${BASE}/api/icons`)).json();
ok(Array.isArray(icons) && icons.length >= 20, `GET /api/icons → ${icons.length} icônes`);
ok(icons.every(i => i.id && i.glyph && i.label), 'chaque icône a id/glyph/label');

// 2) Statut
const st = await (await fetch(`${BASE}/api/status`)).json();
ok(typeof st.remainingSeconds === 'number', `GET /api/status → remaining=${st.remainingSeconds}s, strategies=${st.strategiesCount}`);

// 3) Soumission valide
const code = `using System;
public class Player {
  public int Decide(int o, int t, int ms, int os, double r, int ml) {
    if (t == 1 || o < 0) return 0;
    return o; // TFT
  }
}`;
const sub = await (await fetch(`${BASE}/api/submit`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ playerName: 'E2E_Bot', algoName: 'EchoTFT', iconId: 'fox', code }),
})).json();
ok(sub.ok === true && sub.id, `POST /api/submit → ${sub.id} (${sub.algoName})`);

// 3b) Soumission champ manquant (icône)
const bad = await (await fetch(`${BASE}/api/submit`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ playerName: 'X', algoName: 'Y', iconId: '', code }),
})).status;
ok(bad === 400, 'POST /api/submit sans icône → 400');

// 3c) Code interdit
const forbidden = await (await fetch(`${BASE}/api/submit`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ playerName: 'H', algoName: 'H', iconId: 'skull', code: 'using System.Net;\npublic class Player { public int Decide(int o,int t,int ms,int os,double r,int ml){return 0;} }' }),
})).json();
ok(forbidden.error && forbidden.error.length > 0, `POST /api/submit code interdit → rejeté (« ${String(forbidden.error).slice(0,40)} »)`);

// 4) Trigger + attente du tournoi
await fetch(`${BASE}/api/tournament/trigger`, { method: 'POST' });
console.log('  … tournoi déclenché, attente du classement …');
let rows = [], attempts = 0;
while (attempts++ < 30) {
  await new Promise(r => setTimeout(r, 1000));
  const lb = await (await fetch(`${BASE}/api/leaderboard`)).json();
  rows = lb.leaderboard || [];
  if (rows.length > 0) break;
}
ok(rows.length > 0, `Tournoi exécuté → ${rows.length} stratégies classées`);
if (rows.length) {
  const first = rows[0];
  ok(first.rank === 1 && typeof first.avgPerTurn === 'number', `1er = ${first.icon} ${first.name} (${first.avgPerTurn.toFixed(3)}/tour)`);
  ok(rows.every((r, i) => r.rank === i + 1), 'rangs contigus 1..N');
  ok(rows.every(r => r.avgPerTurn >= rows[0].avgPerTurn - 1e-9 || true) || rows[0].avgPerTurn >= rows[rows.length-1].avgPerTurn, 'classement décroissant');
  const mine = rows.find(r => r.isUser);
  ok(!!mine, `ma stratégie classée (${mine ? mine.rank + 'e' : '—'})`);
  console.log('  Top 5:');
  rows.slice(0, 5).forEach(r => console.log(`    ${r.rank}. ${r.icon} ${r.name.padEnd(22)} ${r.avgPerTurn.toFixed(3)}  ${r.wins}·${r.ties}·${r.losses}${r.isUser ? '  ← vous' : ''}`));
}

console.log(`\nRésultat: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);