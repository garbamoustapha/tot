// ui.js — Arène de tournoi : éditeur + classement round-robin.
// L'utilisateur ne choisit pas d'adversaire : son code affronte TOUS les
// algorithmes de référence, puis le classement (1er -> dernier) s'affiche.
import { roundRobin, LENGTHS } from './engine.js';
import { BUILTIN, KIND_LABEL } from './builtin.js';
import { makePythonStrategy } from './python-runner.js';
import { makeCsharpStrategy } from './cs-interpreter.js';
import { TEMPLATE_PYTHON, TEMPLATE_CSHARP } from './templates.js';
import { MatchSim, SPEEDS } from './sim.js';

const $ = (id) => document.getElementById(id);

let lang = 'python';
let monacoEditor = null;
let monacoModel = null;
let running = false;

// Stratégie joueur cachée après un tournoi pour réutilisation dans la simulation.
let cachedUserStrat = null;
let cachedUserLang = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Head-to-head complet (matrice) rempli pendant le tournoi : pour chaque paire
// (i<=j) on agrège scores/issue sur les 5 longueurs. Permet d'afficher les
// duels de N'IMPORTE QUEL algorithme, pas seulement le joueur.
let h2hMatrix = {};
// Rendu live du classement (chargement step-by-step pendant le tournoi).
let liveRows = {};        // index -> élément <tr> (diff-update, comme arena.js)
let prevLiveRanks = {};   // index -> rang précédent (animation de remontée)
const STRAT_COUNT = 1 + BUILTIN.length; // Vous + 19 = 20
let duelViewpoint = 0; // index de la stratégie dont on regarde les duels
let currentView = 'ranking';
let summaryVisible = false;

// ----------------------------- MONACO ---------------------------------
let monacoResizeObserver = null;
let monacoLayoutTimeout = null;
let monacoWarmupInterval = null;
let monacoEditorFocused = false;

function layoutEditor() {
  if (monacoEditor) monacoEditor.layout();
}

function debouncedLayoutEditor(ms = 80) {
  if (monacoLayoutTimeout) clearTimeout(monacoLayoutTimeout);
  monacoLayoutTimeout = setTimeout(() => layoutEditor(), ms);
}


const MONACO_BASE_URL = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/';
const MONACO_VS_URL = MONACO_BASE_URL + 'vs';

// Quand la page est ouverte en file://, les web workers de Monaco (chargés depuis
// jsDelivr) sont bloqués par la same-origin policy. On les charge via une data URL
// qui exécute importScripts dans le worker, contournant ainsi la restriction.
window.MonacoEnvironment = window.MonacoEnvironment || {};
window.MonacoEnvironment.getWorkerUrl = function (_workerId, _label) {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
    self.MonacoEnvironment = { baseUrl: '${MONACO_BASE_URL}' };
    importScripts('${MONACO_BASE_URL}vs/base/worker/workerMain.js');
  `)}`;
};

const monacoReady = new Promise((resolve) => {
  require.config({ paths: { vs: MONACO_VS_URL } });
  require(['vs/editor/editor.main'], () => {
    // Thème personnalisé avec curseur bien visible (évite le curseur "invisible").
    monaco.editor.defineTheme('arena', {
      base: 'vs-dark', inherit: true,
      rules: [{ token: '', foreground: 'cbd5e1' }],
      colors: {
        'editor.background': '#0b1120', 'editorGutter.background': '#0b1120',
        'editorLineNumber.foreground': '#475569', 'editor.lineHighlightBackground': '#111a2e',
        'editorCursor.foreground': '#f43f5e',
        'editorCursor.background': '#0b1120',
      },
    });

    const createWhenSized = () => {
      const wrap = $('monacoWrap');
      const rect = wrap ? wrap.getBoundingClientRect() : { width: 0, height: 0 };
      if (rect.width > 0 && rect.height > 0) {
        doCreate();
      } else {
        // Le conteneur n'a pas encore de taille (CSS/flex en cours), on attend un frame.
        requestAnimationFrame(createWhenSized);
      }
    };

    const doCreate = () => {
      monacoModel = monaco.editor.createModel(TEMPLATE_PYTHON, 'python');
      monacoEditor = monaco.editor.create($('monaco'), {
        model: monacoModel, theme: 'arena', fontSize: 13,
        // JetBrains Mono est chargée en webfont. On laisse une police de fallback
        // fallback pour que le navigateur ait toujours une métrique utilisable.
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', 'Courier New', monospace",
        minimap: { enabled: false },
        // automaticLayout géré nativement par Monaco : plus fiable qu'un ResizeObserver
        // maison pour un cas flex simple.
        automaticLayout: true, scrollBeyondLastLine: false,
        padding: { top: 14, bottom: 14 }, renderLineHighlight: 'all', tabSize: 4,
        lineNumbers: 'on', smoothScrolling: true,
        cursorStyle: 'line', cursorBlinking: 'blink',
      });

      // Capture le focus pour le diagnostic.
      monacoEditor.onDidFocusEditorText(() => { monacoEditorFocused = true; });
      monacoEditor.onDidBlurEditorText(() => { monacoEditorFocused = false; });

      // La police JetBrains Mono est une web font. Monaco mesure les caractères
      // lors de la création ; si la police n'est pas encore chargée, les mesures
      // sont fausses et le curseur peut paraître figé ou mal positionné.
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          try { monaco.editor.remeasureFonts(); } catch (e) {}
          layoutEditor();
        });
      }
      requestAnimationFrame(() => layoutEditor());
      setTimeout(() => layoutEditor(), 60);

      // Coloration C#/Python en best-effort (ne bloque pas l'init).
      try { require(['vs/basic-languages/python/python', 'vs/basic-languages/csharp/csharp'], () => {}); }
      catch (e) {}
      resolve();
    };

    createWhenSized();
  });
});

function setLang(l) {
  if (lang === l) return;
  lang = l;
  const tpl = l === 'python' ? TEMPLATE_PYTHON : TEMPLATE_CSHARP;
  monacoModel.setValue(tpl);
  try { monaco.editor.setModelLanguage(monacoModel, l === 'python' ? 'python' : 'csharp'); }
  catch (e) { /* coloration désactivée, exécution OK */ }
  $('langPython').classList.toggle('active', l === 'python');
  $('langCsharp').classList.toggle('active', l === 'csharp');
}

// ----------------------------- STATUS ---------------------------------
function setEngineStatus(text, on = true) {
  $('engineStatusText').textContent = text;
  $('engineStatus').querySelector('.dot').classList.toggle('on', on);
}
function showBanner(msg, kind = 'ok', autoCloseMs = 8000) {
  const el = $('statusBanner');
  el.innerHTML = `<div class="banner ${kind}">${msg}</div>`;
  el.classList.remove('hidden');
  if (autoCloseMs) setTimeout(() => el.classList.add('hidden'), autoCloseMs);
}
function clearBanner() { $('statusBanner').classList.add('hidden'); }

// ----------------------------- STRATÉGIE JOUEUR -----------------------
async function buildPlayerStrategy() {
  const code = monacoEditor.getValue();
  if (lang === 'python') {
    setEngineStatus('Chargement de Python…', true);
    const strat = await makePythonStrategy(code, { onStatus: setEngineStatus });
    setEngineStatus('Prêt', true);
    strat.meta = { id: 'you', name: `Votre stratégie (Python)`, isUser: true, icon: '🧑‍💻' };
    return strat;
  }
  const strat = makeCsharpStrategy(code);
  strat.meta = { id: 'you', name: `Votre stratégie (C#)`, isUser: true, icon: '🧑‍💻' };
  return strat;
}

// ----------------------------- RENDU CLASSEMENT -----------------------
function fmt(n, d = 2) { return n.toFixed(d); }

// Méta d'une stratégie par index du tournoi (0 = Vous, 1.. = BUILTIN).
function strategyMeta(index) {
  if (index === 0) return cachedUserStrat?.meta || { name: `Votre stratégie (${lang})`, isUser: true, icon: '🧑‍💻' };
  return BUILTIN[index - 1].meta;
}
function iconFor(index) {
  const ic = strategyMeta(index).icon;
  return ic ? `<span class="strat-icon" aria-hidden="true">${ic}</span>` : '';
}
function kindBadgeFor(index) {
  const m = strategyMeta(index);
  if (m.isUser) return '<span class="you-badge">Vous</span>';
  if (m.type && KIND_LABEL[m.type]) {
    const k = KIND_LABEL[m.type];
    return `<span class="kind-badge ${k.cls}">${k.label}</span>`;
  }
  return '';
}
// "Puce" strat : icône + nom + badge (Coopératif/Traître/Aléatoire ou Vous).
function stratChip(index) {
  const name = strategyMeta(index).name;
  return `${iconFor(index)}<span class="strat-name">${esc(name)}</span>${kindBadgeFor(index)}`;
}

// Construit la liste des duels du point de vue `v` contre tous les autres.
function buildDuels(v) {
  const out = [];
  for (let o = 0; o < STRAT_COUNT; o++) {
    if (o === v) continue;
    const [a, b] = v < o ? [v, o] : [o, v];
    const e = h2hMatrix[`${a}-${b}`];
    if (!e) continue;
    const my = v < o ? e.aScore : e.bScore;
    const opp = v < o ? e.bScore : e.aScore;
    const wins = v < o ? e.aWins : e.bWins;
    const losses = v < o ? e.bWins : e.aWins;
    out.push({ index: o, myScore: my, oppScore: opp, turns: e.turns, wins, ties: e.ties, losses, avgPerTurn: my / e.turns });
  }
  out.sort((a, b) => b.avgPerTurn - a.avgPerTurn || b.myScore - a.myScore);
  return out;
}

// Classement LIVE (chargement step-by-step pendant le tournoi) :
// diff-update + réordonnancement fluide des <tr> + animation de remontée de rang.
// N'affiche que les stratégies ayant déjà joué au moins un match => apparition
// progressive au fil des paires.  Cohérent avec le rendu final (renderRanking).
function renderLiveRanking(stats) {
  const played = stats
    .map((s) => ({ ...s, avgPerTurn: s.totalTurns ? s.totalScore / s.totalTurns : 0 }))
    .filter((s) => s.matches > 0);
  played.sort((a, b) => b.avgPerTurn - a.avgPerTurn || b.totalScore - a.totalScore);
  played.forEach((s, i) => { s.rank = i + 1; });

  let tbody = $('ranking').querySelector('table.standings tbody');
  if (!tbody) {
    $('ranking').innerHTML = `
      <table class="standings live">
        <thead><tr><th>#</th><th>Stratégie</th><th>Score / tour</th><th>Total</th><th>V · E · D</th></tr></thead>
        <tbody></tbody>
      </table>`;
    tbody = $('ranking').querySelector('table.standings tbody');
    liveRows = {};
  }

  const maxAvg = Math.max(...played.map((s) => s.avgPerTurn), 0.0001);

  played.forEach((s) => {
    let tr = liveRows[s.index];
    const isNew = !tr;
    if (isNew) {
      tr = document.createElement('tr');
      tr.dataset.stratidx = s.index;
      tbody.appendChild(tr);
      liveRows[s.index] = tr;
    }

    const prev = prevLiveRanks[s.index];
    const flashed = !isNew && prev != null && s.rank < prev;
    prevLiveRanks[s.index] = s.rank;

    const pct = Math.round((s.avgPerTurn / maxAvg) * 100);
    const rankCls = s.rank <= 3 ? 'top' : '';
    const rowCls = s.isUser ? 'user' : '';
    tr.className = `${rowCls}${isNew ? ' row-in' : ''}`;
    tr.innerHTML = `
      <td class="rank-cell ${rankCls}">${s.rank}</td>
      <td class="name-cell">${stratChip(s.index)}</td>
      <td>
        <div class="score-cell">${fmt(s.avgPerTurn)}</div>
        <div class="bar-track" style="margin-top:6px"><div class="bar-fill ${s.isUser ? 'user' : ''}" style="width:${pct}%"></div></div>
      </td>
      <td class="num">${s.totalScore}</td>
      <td class="num">${s.wins} · ${s.ties} · ${s.losses}</td>`;

    if (isNew) { tr.classList.remove('row-in'); void tr.offsetWidth; tr.classList.add('row-in'); }
    if (flashed) { tr.classList.remove('row-flashed'); void tr.offsetWidth; tr.classList.add('row-flashed'); }
  });

  // Réordonne selon le classement courant (déplacement fluide des <tr> existants).
  played.forEach((s) => {
    const tr = liveRows[s.index];
    if (tr) tbody.appendChild(tr);
  });
}

function renderRanking(stats) {
  const maxAvg = Math.max(...stats.map((s) => s.avgPerTurn), 0.0001);
  const userStat = stats.find((s) => s.isUser);

  // Résumé
  if (userStat) {
    summaryVisible = true;
    $('summary').classList.remove('hidden');
    $('summary').innerHTML = `
      <div><div class="lbl">Votre rang</div><div class="big accent">${userStat.rank}<span style="color:var(--muted);font-size:14px;font-weight:500"> / ${stats.length}</span></div></div>
      <div><div class="lbl">Score moy. / tour</div><div class="big">${fmt(userStat.avgPerTurn)}</div></div>
      <div><div class="lbl">Victoires · Égalités · Défaites</div><div class="big" style="font-size:16px">${userStat.wins} · ${userStat.ties} · ${userStat.losses}</div></div>`;
  }

  const rows = stats.map((s) => {
    const pct = Math.round((s.avgPerTurn / maxAvg) * 100);
    const rankCls = s.rank <= 3 ? 'top' : '';
    const rowCls = s.isUser ? 'user' : '';
    return `
      <tr class="${rowCls}" data-stratidx="${s.index}" title="Visualiser le match animé">
        <td class="rank-cell ${rankCls}">${s.rank}</td>
        <td class="name-cell">${stratChip(s.index)}</td>
        <td>
          <div class="score-cell">${fmt(s.avgPerTurn)}</div>
          <div class="bar-track" style="margin-top:6px"><div class="bar-fill ${s.isUser ? 'user' : ''}" style="width:${pct}%"></div></div>
        </td>
        <td class="num">${s.totalScore}</td>
        <td class="num">${s.wins} · ${s.ties} · ${s.losses}</td>
      </tr>`;
  }).join('');

  $('ranking').innerHTML = `
    <table class="standings">
      <thead><tr>
        <th>#</th><th>Stratégie</th><th>Score / tour</th><th>Total</th><th>V · E · D</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ------------------------- VUE DUELS (point de vue filtrable) ----------
function renderDuels(viewpoint) {
  duelViewpoint = viewpoint;
  // Barre de filtre (point de vue) : construite une fois, synchronisée.
  const sel = $('duelViewpoint');
  if (sel && sel.options.length !== STRAT_COUNT) {
    sel.innerHTML = '';
    for (let i = 0; i < STRAT_COUNT; i++) {
      const m = strategyMeta(i);
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${m.icon || '•'}  ${m.name}`;
      sel.appendChild(o);
    }
  }
  if (sel) sel.value = String(viewpoint);

  const vm = strategyMeta(viewpoint);
  const duels = buildDuels(viewpoint);
  if (!Object.keys(h2hMatrix).length) {
    $('duels').innerHTML = `<div class="empty">Entrez dans l'arène pour voir les duels de ${esc(vm.name)} face à chaque algorithme.</div>`;
    return;
  }
  if (!duels.length) {
    $('duels').innerHTML = '<div class="empty">Aucun duel à afficher.</div>';
    return;
  }
  const maxScore = Math.max(...duels.map((d) => Math.max(d.myScore, d.oppScore)), 1);
  const rows = duels.map((d) => {
    const myPct = Math.round((d.myScore / maxScore) * 100);
    const oppPct = Math.round((d.oppScore / maxScore) * 100);
    const diff = d.myScore - d.oppScore;
    const diffCls = diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'neu';
    const diffTxt = diff > 0 ? `+${diff}` : `${diff}`;
    return `
      <tr data-a="${viewpoint}" data-b="${d.index}" title="Simuler le match animé">
        <td class="name-cell">${stratChip(d.index)}</td>
        <td class="duel-bar-cell">
          <div class="duel-bar">
            <div class="duel-seg mine" style="width:${myPct}%"></div>
            <div class="duel-seg opp" style="width:${oppPct}%"></div>
          </div>
          <div class="duel-nums"><span class="mine">${d.myScore}</span><span class="opp">${d.oppScore}</span></div>
        </td>
        <td class="num tab">${fmt(d.avgPerTurn)}</td>
        <td class="num tab ${diffCls}">${diffTxt}</td>
        <td class="num tab">${d.wins}·${d.ties}·${d.losses}</td>
        <td class="sim-cue-cell"><span class="sim-cue">Simuler ▶</span></td>
      </tr>`;
  }).join('');

  const poss = vm.isUser ? 'Vos duels' : `Duels de ${vm.name}`;
  $('duels').innerHTML = `
    <p class="duels-hint">${poss} — score cumulé (5 manches) face à chaque autre algorithme. Cliquez une ligne pour lancer la simulation animée.</p>
    <table class="duels-table">
      <thead><tr>
        <th>Adversaire</th><th>${iconFor(viewpoint)} Score · ${vm.isUser ? 'Adversaire' : 'Opposant'}</th><th>Moy./tour</th><th>Diff.</th><th>V·E·D</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function setView(v) {
  currentView = v;
  const tabs = { ranking: 'tabRanking', duels: 'tabDuels', codex: 'tabCodex' };
  for (const [key, id] of Object.entries(tabs)) {
    const el = $(id);
    if (!el) continue;            // #tabCodex n'existe plus en sous-onglet (nav navbar)
    const active = key === v;
    el.classList.toggle('active', active);
    el.setAttribute('aria-selected', String(active));
  }
  $('ranking').classList.toggle('hidden', v !== 'ranking');
  $('duels').classList.toggle('hidden', v !== 'duels');
  $('duelBar').classList.toggle('hidden', v !== 'duels');
  $('codex').classList.toggle('hidden', v !== 'codex');
  $('summary').classList.toggle('hidden', !(v === 'ranking' && summaryVisible));
  if (v === 'duels') renderDuels(duelViewpoint);
  syncTabbar(v);
}

// Synchronise l'onglet actif de la tabbar globale (Solo / Arène en ligne /
// Algorithmes) avec la vue courante. "Solo" couvre ranking+duels ; "Algorithmes"
// correspond à la vue codex (onglet navbar, plus de sous-onglet in-pane).
// (L'onglet "Arène en ligne" est sur arena.html.)
function syncTabbar(view) {
  const set = (sel, on) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.classList.toggle('active', on);
    if (on) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  };
  set('.tabbar-tab[data-tab="solo"]', view !== 'codex');
  set('.tabbar-tab[data-tab="codex"]', view === 'codex');
}

// ------------------------- VUE ALGORITHMES (CODEX) ---------------------
function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderCodex() {
  const cards = BUILTIN.map((s, i) => {
    const m = s.meta;
    const kind = KIND_LABEL[m.type] || KIND_LABEL.nice;
    const code = s.impl ? s.impl.toString() : '';
    return `
      <article class="algo-card ${kind.cls}" data-kind="${m.type || 'nice'}">
        <header class="algo-head">
          <span class="algo-icon" aria-hidden="true">${m.icon || '•'}</span>
          <div class="algo-title">
            <span class="algo-name">${esc(m.name)}</span>
            <span class="kind-badge ${kind.cls}">${kind.label}</span>
          </div>
        </header>
        <p class="algo-behavior">${esc(m.behavior || m.desc || '')}</p>
        <footer class="algo-foot">
          <button class="algo-sim-btn" data-stratidx="${i + 1}" title="Simuler le match animé contre ${esc(m.name)}">
            <span class="play-glyph" aria-hidden="true">▶</span> Simuler
          </button>
          <details class="algo-code-wrap">
            <summary>Code source</summary>
            <pre class="algo-code"><code>${esc(code)}</code></pre>
          </details>
        </footer>
      </article>`;
  }).join('');
  $('codex').innerHTML = `
    <div class="codex-toolbar">
      <div class="codex-filters" role="group" aria-label="Filtrer par type">
        <button class="kind-filter is-active" data-kind="all" aria-pressed="true">Tous</button>
        <button class="kind-filter kind-nice" data-kind="nice" aria-pressed="false"><span class="kind-dot kind-nice" aria-hidden="true"></span>Coopératif</button>
        <button class="kind-filter kind-mean" data-kind="mean" aria-pressed="false"><span class="kind-dot kind-mean" aria-hidden="true"></span>Traître</button>
        <button class="kind-filter kind-noisy" data-kind="noisy" aria-pressed="false"><span class="kind-dot kind-noisy" aria-hidden="true"></span>Aléatoire</button>
      </div>
      <span class="codex-count" id="codexCount"></span>
    </div>
    <p class="codex-note">Encode : <code>0</code> = Coopérer · <code>1</code> = Trahir. Signature : <code>decide(opponentLastMove, currentTurn, myScore, opponentScore, randomValue, myLastMove)</code>. Cliquez « Simuler » pour visualiser le match contre cet algorithme.</p>
    <div class="codex-grid">${cards}</div>`;
  setCodexFilter('all');
}

// Active un filtre de type dans le codex et met à jour le compteur de cartes.
function setCodexFilter(kind) {
  const codex = $('codex');
  codex.dataset.filter = kind;
  codex.querySelectorAll('.kind-filter').forEach((b) => {
    const on = b.dataset.kind === kind;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const cnt = $('codexCount');
  if (cnt) {
    const n = kind === 'all'
      ? BUILTIN.length
      : BUILTIN.filter((s) => s.meta.type === kind).length;
    cnt.textContent = `${n} algorithme${n > 1 ? 's' : ''}`;
  }
}

// ----------------------------- TOURNOI --------------------------------
function setRunning(on) {
  running = on;
  $('runBtn').disabled = on;
  $('runBtn').textContent = on ? 'Tournoi en cours…' : 'Entrer dans l\'arène';
}

async function runTournament() {
  clearBanner();
  let userStrat;
  try { userStrat = await buildPlayerStrategy(); }
  catch (e) { showBanner(`Impossible de charger le runtime : <code>${e.message}</code>`, 'err', 12000); return; }
  if (userStrat.loadError) {
    showBanner(`Erreur dans votre code (${lang}) : <code>${userStrat.loadError}</code>`, 'err', 14000);
    return;
  }
  cachedUserStrat = userStrat;
  cachedUserLang = lang;

  const strategies = [userStrat, ...BUILTIN];
  const totalPairs = (strategies.length * (strategies.length + 1)) / 2;
  let lastError = null;

  setRunning(true);
  summaryVisible = false;
  $('summary').classList.add('hidden');
  $('ranking').innerHTML = '<div class="empty">Tournoi en cours…</div>';
  $('duels').innerHTML = '<div class="empty">Tournoi en cours…</div>';
  liveRows = {}; prevLiveRanks = {};
  // Barre de progression live (chargement step-by-step).
  $('liveBar').classList.remove('hidden');
  $('liveBarFill').style.width = '0%';
  $('progress').innerHTML = `<span class="live-dot"></span>0 / ${totalPairs} paires`;

  // Accumule la matrice head-to-head complète (toutes paires i<=j).
  h2hMatrix = {};
  // Cadence du rendu live : ~28 rafraîchis répartis sur le tournoi (fluide,
  // pas bavand). + petit sleep pour laisser le navigateur peindre (le C# est
  // instant sinon — aucun rendu step-by-step visible).
  const emitEvery = Math.max(1, Math.floor(totalPairs / 28));
  const paceMs = 22;
  let lastRender = -1;
  try {
    const stats = await roundRobin(strategies, {
      lengths: LENGTHS,
      reps: 1,
      onProgress: async (done, total, st) => {
        $('progress').innerHTML = `<span class="live-dot"></span>${done} / ${total} paires`;
        $('liveBarFill').style.width = `${Math.round((done / total) * 100)}%`;
        const shouldRender = done === 1 || done === total || done - lastRender >= emitEvery;
        if (!shouldRender) return;
        lastRender = done;
        renderLiveRanking(st);
        await sleep(paceMs);
      },
      onResult: (i, j, len, res) => {
        const e = h2hMatrix[`${i}-${j}`] || (h2hMatrix[`${i}-${j}`] = {
          aScore: 0, bScore: 0, turns: 0, aWins: 0, ties: 0, bWins: 0,
        });
        e.aScore += res.scoreA; e.bScore += res.scoreB; e.turns += len;
        if (res.winner === 'A') e.aWins++;
        else if (res.winner === 'B') e.bWins++;
        else e.ties++;
      },
    });
    $('progress').textContent = `${totalPairs} matchs · terminé`;
    renderRanking(stats);
    renderDuels(duelViewpoint);
    if (userStrat.lastError) {
      showBanner(`Votre code a levé une erreur pendant un match : <code>${userStrat.lastError}</code>`, 'err', 12000);
    }
  } catch (e) {
    $('progress').textContent = 'Erreur';
    showBanner(`Erreur d'exécution : <code>${e.message}</code>`, 'err', 14000);
  } finally {
    $('liveBar').classList.add('hidden');
    setRunning(false);
  }
}

// ----------------------------- SIMULATION -----------------------------
let sim = null;            // MatchSim (p5) instancié à la 1re ouverture
let simSpeedMs = SPEEDS[1].ms; // défaut 1×
let simAIdx = 0;           // index stratégie A courante (0 = Vous, 1.. = BUILTIN)
let simBIdx = 1;           // index stratégie B courante

function refreshPlayBtn() {
  const btn = $('simPlay');
  if (!sim) return;
  const st = sim.state;
  if (st.finished || !st.running) btn.textContent = '▶';
  else if (st.paused) btn.textContent = '▶';
  else btn.textContent = '⏸';
  btn.setAttribute('aria-label', st.paused || st.finished ? 'Lecture' : 'Pause');
}

async function ensureUserStrat() {
  if (cachedUserStrat && cachedUserLang === lang) return cachedUserStrat;
  const s = await buildPlayerStrategy();
  if (s.loadError) throw new Error(s.loadError);
  cachedUserStrat = s; cachedUserLang = lang;
  return s;
}

// Renvoie l'objet stratégie par index du tournoi (0 = Vous, à construire au besoin).
async function strategyObj(index) {
  if (index === 0) return ensureUserStrat();
  return BUILTIN[index - 1];
}

// Affiche le duel RÉEL joué pendant le tournoi (scores agrégés sur les 5 manches)
// pour la paire (aIdx, bIdx). Complète l'animation : on voit « la partie qu'il a
// jouée » et on peut la simuler. Self-play exclu du tournoi => message dédié.
function renderSimDuel(aIdx, bIdx) {
  const el = $('simDuel');
  if (!el) return;
  if (aIdx === bIdx) {
    el.innerHTML = `<span class="sim-duel-label">Tournoi</span><span class="sim-duel-none">Affrontement miroir — non joué en tournoi (self-play exclu). Simulez-le ci-dessous.</span>`;
    return;
  }
  const [a, b] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
  const e = h2hMatrix[`${a}-${b}`];
  if (!e) {
    el.innerHTML = `<span class="sim-duel-label">Tournoi</span><span class="sim-duel-none">Lancez d'abord « Entrer dans l'arène » pour voir le duel réel, puis simulez-le.</span>`;
    return;
  }
  // Du point de vue A (aIdx) : son score est aScore si aIdx===a sinon bScore.
  const aIsA = aIdx === a;
  const scoreA = aIsA ? e.aScore : e.bScore;
  const scoreB = aIsA ? e.bScore : e.aScore;
  const winsA = aIsA ? e.aWins : e.bWins;
  const winsB = aIsA ? e.bWins : e.aWins;
  const verdictCls = scoreA > scoreB ? 'win' : scoreA < scoreB ? 'loss' : 'tie';
  const verdictTxt = scoreA > scoreB ? 'Victoire' : scoreA < scoreB ? 'Défaite' : 'Égalité';
  const avgA = (scoreA / e.turns).toFixed(2);
  el.innerHTML =
    `<span class="sim-duel-label">Tournoi <span class="sim-duel-badge ${verdictCls}">${verdictTxt}</span></span>` +
    `<span class="sim-duel-scores">` +
      `<span class="sim-duel-side a">${iconFor(aIdx)} ${esc(strategyMeta(aIdx).name)} <b>${scoreA}</b> <i>${avgA}/tour</i></span>` +
      `<span class="sim-duel-vs">·</span>` +
      `<span class="sim-duel-side b">${iconFor(bIdx)} ${esc(strategyMeta(bIdx).name)} <b>${scoreB}</b></span>` +
    `</span>` +
    `<span class="sim-duel-meta">${e.turns} tours · ${winsA}V ${e.ties}E ${winsB}D · simulez ci-dessous ▾</span>`;
}

async function openSim(aIdx, bIdx, { focusPlay = true } = {}) {
  let A, B;
  try { A = await strategyObj(aIdx); B = await strategyObj(bIdx); }
  catch (e) { showBanner(`Impossible de charger le runtime : <code>${e.message}</code>`, 'err', 12000); return; }

  simAIdx = aIdx; simBIdx = bIdx;

  // Rafraîchit le libellé « Vous » (la langue peut avoir changé) et synchronise
  // les sélecteurs d'opposants sur le match en cours.
  const youLbl = `${strategyMeta(0).icon || '•'}  ${strategyMeta(0).name}`;
  for (const id of ['simOppA', 'simOppB']) {
    const s = $(id);
    if (!s) continue;
    if (s.options[0]) s.options[0].textContent = youLbl;
  }
  $('simOppA').value = String(aIdx);
  $('simOppB').value = String(bIdx);

  const nameA = A.meta.name;
  const nameB = aIdx === bIdx ? `${B.meta.name} (miroir)` : B.meta.name;

  // Ouvre la modale + titre avec icônes/badges.
  $('simModal').classList.remove('hidden');
  $('simTitle').innerHTML = `${iconFor(aIdx)}<span class="strat-name">${esc(nameA)}</span>${kindBadgeFor(aIdx)}` +
    ` <span class="vs">vs</span> ` +
    `${iconFor(bIdx)}<span class="strat-name">${esc(nameB)}</span>${kindBadgeFor(bIdx)}`;
  renderSimDuel(aIdx, bIdx);
  if (!sim) {
    sim = new MatchSim($('simCanvas'), { onStatus: (t) => { $('simStatus').textContent = t; refreshPlayBtn(); } });
  }
  const length = parseInt($('simLength').value, 10) || LENGTHS[1];
  const seed = Math.max(1, parseInt($('simSeed').value, 10) || 1);
  simSpeedMs = parseInt($('simSpeed').value, 10);
  sim.play({ stratA: A, stratB: B, nameA, nameB, length, seed, speedMs: simSpeedMs });
  refreshPlayBtn();
  if (focusPlay) $('simPlay').focus();
}

// Remplit les deux sélecteurs d'opposants avec toutes les stratégies
// (0 = Vous, 1.. = algorithmes de référence).
function populateOpponents() {
  for (const id of ['simOppA', 'simOppB']) {
    const sel = $(id);
    if (!sel || sel.options.length === STRAT_COUNT) continue;
    sel.innerHTML = '';
    for (let i = 0; i < STRAT_COUNT; i++) {
      const m = strategyMeta(i);
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${m.icon || '•'}  ${m.name}`;
      sel.appendChild(o);
    }
  }
}

function closeSim() {
  if (sim) { sim.destroy(); sim = null; }
  $('simModal').classList.add('hidden');
}

function setupSim() {
  // Vitesse
  const speedSel = $('simSpeed');
  SPEEDS.forEach((s, i) => {
    const o = document.createElement('option');
    o.value = String(s.ms); o.textContent = s.label;
    if (i === 1) o.selected = true;
    speedSel.appendChild(o);
  });
  // Longueur
  const lenSel = $('simLength');
  LENGTHS.forEach((l, i) => {
    const o = document.createElement('option');
    o.value = String(l); o.textContent = `${l} tours`;
    if (i === 1) o.selected = true;
    lenSel.appendChild(o);
  });
  // Opposants : liste toutes les stratégies ; changer l'un relance le match
  // avec la nouvelle paire (longueur/graine/vitesse courantes conservées).
  populateOpponents();
  $('simOppA').onchange = () => {
    const a = Math.min(STRAT_COUNT - 1, Math.max(0, parseInt($('simOppA').value, 10) || 0));
    openSim(a, simBIdx, { focusPlay: false });
  };
  $('simOppB').onchange = () => {
    const b = Math.min(STRAT_COUNT - 1, Math.max(0, parseInt($('simOppB').value, 10) || 0));
    openSim(simAIdx, b, { focusPlay: false });
  };

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
    const v = (Math.floor(Math.random() * 1e6) + 1);
    $('simSeed').value = String(v);
    if (sim) { sim.seed = v; sim.restart(); }
  };
  $('simClose').onclick = closeSim;
  $('simModal').addEventListener('click', (e) => { if (e.target === $('simModal')) closeSim(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('simModal').classList.contains('hidden')) closeSim();
    if (e.key === ' ' && !$('simModal').classList.contains('hidden')) {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT') return;
      e.preventDefault();
      if (sim) {
        if (sim.state.finished || !sim.state.running) sim.restart();
        else sim.togglePause();
        refreshPlayBtn();
      }
    }
  });

  // Clic sur une ligne du classement -> simulation Vous vs cette strat.
  $('ranking').addEventListener('click', (e) => {
    const tr = e.target.closest('tbody tr[data-stratidx]');
    if (!tr) return;
    openSim(0, parseInt(tr.dataset.stratidx, 10));
  });
  // Vue Duels : filtre du point de vue + clic ligne -> sim viewpoint vs adv.
  const vSel = $('duelViewpoint');
  if (vSel) vSel.onchange = (e) => renderDuels(parseInt(e.target.value, 10) || 0);
  $('duels').addEventListener('click', (e) => {
    const tr = e.target.closest('tbody tr[data-a][data-b]');
    if (!tr) return;
    openSim(parseInt(tr.dataset.a, 10), parseInt(tr.dataset.b, 10));
  });
  // Codex : filtre par type + bouton « Simuler » d'une carte -> Vous vs cet algo.
  $('codex').addEventListener('click', (e) => {
    const filter = e.target.closest('.kind-filter');
    if (filter) { setCodexFilter(filter.dataset.kind); return; }
    const btn = e.target.closest('.algo-sim-btn[data-stratidx]');
    if (!btn) return;
    e.preventDefault();
    openSim(0, parseInt(btn.dataset.stratidx, 10));
  });
}

// ----------------------------- SOUMISSION À L'ARÈNE EN LIGNE ----------
// Le bouton "Soumettre ma stratégie" vit dans la section code de Solo.
// Il porte le code C# en cours vers le modal de l'arène en ligne (arena.html).
function submitToArena() {
  // L'arène en ligne compile du C# côté serveur (classe `Player`).
  if (lang !== 'csharp') {
    setLang('csharp');
    showBanner("L'arène en ligne compile du <strong>C#</strong>. Voici le modèle — adaptez votre stratégie, puis cliquez à nouveau pour la soumettre.", 'err', 9000);
    return;
  }
  const code = monacoEditor.getValue();
  if (!code.trim()) { showBanner('Le code de la stratégie est vide.', 'err'); return; }
  try { sessionStorage.setItem('arenaSubmitCode', code); } catch (e) { /* stockage indisponible */ }
  location.href = 'arena.html?submit';
}

// ----------------------------- INIT -----------------------------------
async function main() {
  await monacoReady;
  setLang('python');

  $('langPython').onclick = () => setLang('python');
  $('langCsharp').onclick = () => setLang('csharp');
  $('runBtn').onclick = runTournament;
  $('soloSubmitBtn').onclick = submitToArena;
  $('tabRanking').onclick = () => setView('ranking');
  $('tabDuels').onclick = () => setView('duels');
  // « Algorithmes » n'a plus de sous-onglet in-pane : on y accède via l'onglet
  // navbar (index.html#codex) qui recharge la page → setView('codex') au boot.
  renderCodex();
  setupSim();
  // Vue initiale : #codex → Algorithmes, sinon Solo (classement).
  setView(location.hash === '#codex' ? 'codex' : 'ranking');

  // Cmd/Ctrl+Enter lance le tournoi.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !running) runTournament();
  });

  setEngineStatus('Prêt · C# instantané · Python au 1er usage', true);
}
main();