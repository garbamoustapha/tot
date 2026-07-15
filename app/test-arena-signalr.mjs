// test-arena-signalr.mjs — Test du hub SignalR (temps réel) sur WebSocket.
// Capture ReceiveHello / ReceiveCountdown / ReceiveSubmission / ReceiveTournamentStart /
// ReceiveProgress / ReceiveLeaderboard / ReceiveStatus via le protocole JSON SignalR.
const BASE = process.argv[2] || 'http://localhost:5080';
const SEP = '\x1e';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const seen = new Set();

// 1) Négociation
const neg = await (await fetch(`${BASE}/arenaHub/negotiate?negotiateVersion=1`, { method: 'POST' })).json();
ok(!!neg.connectionId, `negotiate → connectionId présent (${(neg.connectionId||'').slice(0,8)}…)`);
const id = neg.connectionToken || neg.connectionId;

// 2) Connexion WebSocket + handshake JSON
const wsUrl = BASE.replace(/^http/, 'ws') + `/arenaHub?id=${id}`;
const ws = new WebSocket(wsUrl);
let handshakeOk = false;
const buf = { s: '' };

await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(), 10000);
  ws.onopen = () => ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + SEP);
  ws.onmessage = (ev) => {
    buf.s += ev.data;
    let i;
    while ((i = buf.s.indexOf(SEP)) >= 0) {
      const raw = buf.s.slice(0, i); buf.s = buf.s.slice(i + 1);
      if (!raw.trim()) continue;
      let msg;
      try { msg = JSON.parse(raw); } catch { continue; }
      // Handshake ack = empty object {type:1? no, handshake response has no type}
      if (!handshakeOk && msg.type === undefined && Object.keys(msg).length === 0) {
        handshakeOk = true; ok(true, 'handshake SignalR accepté');
        continue;
      }
      if (msg.type === 6) continue; // ping
      if (msg.type === 1 && msg.target) {
        seen.add(msg.target);
        if (msg.target === 'ReceiveHello') {
          const h = msg.arguments[0];
          ok(!!h && 'leaderboard' in h && 'remainingSeconds' in h, `ReceiveHello (lb=${h?.leaderboard?.length}, remain=${h?.remainingSeconds}s)`);
          ok(Array.isArray(h?.duels), `ReceiveHello.duels matrice (${h?.duels?.length} duels)`);
        }
        if (msg.target === 'ReceiveDuels') {
          ok(true, `ReceiveDuels cells=${msg.arguments[0]?.length} id=${msg.arguments[1]}`);
        }
        if (msg.target === 'ReceiveCountdown') {
          ok(true, `ReceiveCountdown remaining=${msg.arguments[0]}s`);
        }
        if (msg.target === 'ReceiveTournamentStart') {
          ok(true, `ReceiveTournamentStart id=${msg.arguments[0]} n=${msg.arguments[1]}`);
        }
        if (msg.target === 'ReceiveProgress') {
          ok(true, `ReceiveProgress ${msg.arguments[0]}/${msg.arguments[1]} (rows=${msg.arguments[2]?.length})`);
        }
        if (msg.target === 'ReceiveLeaderboard') {
          ok(true, `ReceiveLeaderboard final rows=${msg.arguments[0]?.length} id=${msg.arguments[1]}`);
        }
      }
    }
  };
  ws.onerror = (e) => { console.log('  ws error', e?.message || e); clearTimeout(timer); resolve(); };
  ws.onclose = (e) => { ok(handshakeOk, 'connexion maintenue puis fermée propre'); clearTimeout(timer); resolve(); };

  // 3) Provoque une soumission (déclenche ReceiveSubmission) + un tournoi (déclenche Start/Progress/Leaderboard)
  setTimeout(async () => {
    const code = 'using System; public class Player { public int Decide(int o,int t,int ms,int os,double r,int ml){ if(t==1||o<0) return 0; return o; } }';
    await fetch(`${BASE}/api/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'RT_Bot', algoName: 'RtEcho', iconId: 'bolt', code }) });
    await fetch(`${BASE}/api/tournament/trigger`, { method: 'POST' });
  }, 1500);

  // Laisse le temps de capter tous les évènements (tournoi + countdowns).
  setTimeout(() => { try { ws.close(); } catch {} }, 9000);
  setTimeout(() => { clearTimeout(timer); resolve(); }, 10500);
});

console.log('\n  Évènements captés :', [...seen].join(', ') || '—');
ok(seen.has('ReceiveHello'), 'ReceiveHello reçu');
ok(seen.has('ReceiveCountdown'), 'ReceiveCountdown reçu (temps réel)');
ok(seen.has('ReceiveSubmission'), 'ReceiveSubmission reçu (toast fun)');
ok(seen.has('ReceiveTournamentStart') && seen.has('ReceiveLeaderboard'), 'cycle tournoi complet (Start→Leaderboard)');
ok(seen.has('ReceiveDuels'), 'ReceiveDuels reçu (matrice des matchs joués)');
console.log(`\nRésultat SignalR: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);