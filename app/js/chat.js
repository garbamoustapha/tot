// chat.js — Chat temps réel de PD Arena (autonome, présent sur toutes les pages).
// --------------------------------------------------------------------------
// • Bouton flottant (FAB) en bas à droite + panneau coulissant.
// • Le joueur choisit son pseudo UNE seule fois (unique, validé serveur) avant
//   de pouvoir écrire ; pseudo + jeton mémorisés en localStorage.
// • Badge de messages non lus sur le FAB quand le panneau est fermé.
//
// Backend :
//   POST /api/chat/register {userName}     -> { ok, userName, token } | 409 { error }
//   WS   /chatHub                          -> ReceiveHistory([msg]) / ReceiveChat(msg) / ChatError(text)
//        invoke('Send', userName, token, text)
//
// Dépend du client SignalR global (window.signalR), chargé par la page.

const LS_USER = 'pd-chat-user';
const LS_TOKEN = 'pd-chat-token';
const LS_SEEN = 'pd-chat-lastseen';

let hub = null;
let open = false;
let unread = 0;
let lastSeenId = readSeen();
let maxId = 0;               // plus grand id de message connu
let userName = localStorage.getItem(LS_USER) || '';
let token = localStorage.getItem(LS_TOKEN) || '';
let els = {};               // références DOM

// ----------------------------- UTILITAIRES ----------------------------
function readSeen() {
  const v = parseInt(localStorage.getItem(LS_SEEN) || '0', 10);
  return Number.isFinite(v) ? v : 0;
}
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function timeOf(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function initialOf(name) {
  const c = (name || '?').trim()[0] || '?';
  return c.toUpperCase();
}
// Couleur stable dérivée du pseudo (pour l'avatar).
function hueOf(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

// ----------------------------- CONSTRUCTION DOM -----------------------
function build() {
  const root = document.createElement('div');
  root.className = 'chat-root';
  root.innerHTML = `
    <button id="chatFab" class="chat-fab" type="button" aria-label="Ouvrir le chat" title="Chat de l'arène">
      <svg class="chat-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
      <span id="chatBadge" class="chat-badge hidden">0</span>
    </button>

    <section id="chatPanel" class="chat-panel hidden" role="dialog" aria-modal="false" aria-label="Chat de l'arène">
      <header class="chat-head">
        <div class="chat-head-title">
          <span class="chat-head-dot" id="chatConnDot"></span>
          <span>Chat de l'arène</span>
        </div>
        <button id="chatClose" class="chat-icon-btn" aria-label="Fermer le chat" title="Fermer">✕</button>
      </header>

      <div id="chatMessages" class="chat-messages" aria-live="polite">
        <div class="chat-empty">Chargement…</div>
      </div>

      <div id="chatError" class="chat-error hidden"></div>

      <!-- Étape 1 : choisir un pseudo (une seule fois) -->
      <form id="chatGate" class="chat-gate hidden">
        <label class="chat-gate-label" for="chatName">Choisissez un pseudo pour discuter <em>(unique)</em></label>
        <div class="chat-gate-row">
          <input id="chatName" class="chat-input" type="text" maxlength="24" placeholder="ex. Ada"
                 autocomplete="off" aria-label="Votre pseudo" />
          <button id="chatJoin" class="chat-send-btn" type="submit">Rejoindre</button>
        </div>
      </form>

      <!-- Étape 2 : composer un message -->
      <form id="chatComposer" class="chat-composer hidden">
        <input id="chatText" class="chat-input" type="text" maxlength="500"
               placeholder="Votre message…" autocomplete="off" aria-label="Votre message" />
        <button id="chatSend" class="chat-send-btn" type="submit" aria-label="Envoyer" title="Envoyer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </form>
    </section>`;
  document.body.appendChild(root);

  els = {
    fab: root.querySelector('#chatFab'),
    badge: root.querySelector('#chatBadge'),
    panel: root.querySelector('#chatPanel'),
    close: root.querySelector('#chatClose'),
    messages: root.querySelector('#chatMessages'),
    error: root.querySelector('#chatError'),
    gate: root.querySelector('#chatGate'),
    name: root.querySelector('#chatName'),
    composer: root.querySelector('#chatComposer'),
    text: root.querySelector('#chatText'),
    dot: root.querySelector('#chatConnDot'),
  };

  els.fab.addEventListener('click', toggle);
  els.close.addEventListener('click', () => setOpen(false));
  els.gate.addEventListener('submit', onJoin);
  els.composer.addEventListener('submit', onSend);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) setOpen(false);
  });

  updateComposer();
}

// ----------------------------- OUVERTURE / BADGE ----------------------
function toggle() { setOpen(!open); }

function setOpen(v) {
  open = v;
  els.panel.classList.toggle('hidden', !open);
  els.fab.classList.toggle('active', open);
  els.fab.setAttribute('aria-label', open ? 'Fermer le chat' : 'Ouvrir le chat');
  if (open) {
    markAllSeen();
    scrollToBottom();
    // Focus sur le champ pertinent (pseudo ou message).
    setTimeout(() => (userName && token ? els.text : els.name)?.focus(), 60);
  }
}

function markAllSeen() {
  unread = 0;
  lastSeenId = Math.max(lastSeenId, maxId);
  localStorage.setItem(LS_SEEN, String(lastSeenId));
  renderBadge();
}

function renderBadge() {
  if (unread > 0 && !open) {
    els.badge.textContent = unread > 9 ? '9+' : String(unread);
    els.badge.classList.remove('hidden');
  } else {
    els.badge.classList.add('hidden');
  }
}

// ----------------------------- MESSAGES -------------------------------
function renderHistory(list) {
  els.messages.innerHTML = '';
  if (!list || !list.length) {
    els.messages.innerHTML = '<div class="chat-empty">Aucun message. Lancez la conversation !</div>';
    return;
  }
  let count = 0;
  list.forEach((m) => {
    appendMessage(m, false);
    maxId = Math.max(maxId, m.id);
    if (m.id > lastSeenId && m.userName !== userName) count++;
  });
  unread = open ? 0 : count;
  if (open) markAllSeen(); else renderBadge();
  scrollToBottom();
}

function appendMessage(m, live) {
  const empty = els.messages.querySelector('.chat-empty');
  if (empty) empty.remove();

  const mine = m.userName === userName && !!userName;
  const row = document.createElement('div');
  row.className = `chat-msg ${mine ? 'mine' : ''}`;
  const hue = hueOf(m.userName || '?');
  row.innerHTML = `
    <div class="chat-avatar" style="--h:${hue}" aria-hidden="true">${esc(initialOf(m.userName))}</div>
    <div class="chat-bubble-wrap">
      <div class="chat-meta"><span class="chat-author">${esc(m.userName)}</span><span class="chat-time">${timeOf(m.at)}</span></div>
      <div class="chat-bubble">${esc(m.text)}</div>
    </div>`;
  els.messages.appendChild(row);

  if (live) {
    maxId = Math.max(maxId, m.id);
    if (open) {
      markAllSeen();
    } else if (!mine) {
      unread++;
      renderBadge();
    }
    const nearBottom = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 120;
    if (open && (nearBottom || mine)) scrollToBottom();
  }
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

// ----------------------------- PSEUDO / ENVOI -------------------------
function updateComposer() {
  const known = !!(userName && token);
  els.gate.classList.toggle('hidden', known);
  els.composer.classList.toggle('hidden', !known);
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.classList.remove('hidden');
  setTimeout(() => els.error.classList.add('hidden'), 5000);
}

async function onJoin(e) {
  e.preventDefault();
  const name = els.name.value.trim();
  if (!name) { els.name.focus(); return; }
  els.gate.querySelector('#chatJoin').disabled = true;
  try {
    const res = await fetch('/api/chat/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: name }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) { showError(data.error || 'Enregistrement impossible.'); return; }
    userName = data.userName;
    token = data.token;
    localStorage.setItem(LS_USER, userName);
    localStorage.setItem(LS_TOKEN, token);
    updateComposer();
    // Re-rendu de l'historique pour aligner mes propres messages à droite.
    if (hub) { try { const h = await fetchHistory(); renderHistory(h); } catch (_) {} }
    setTimeout(() => els.text.focus(), 40);
  } catch (err) {
    showError('Réseau indisponible : ' + err.message);
  } finally {
    els.gate.querySelector('#chatJoin').disabled = false;
  }
}

async function fetchHistory() {
  const res = await fetch('/api/chat/history');
  const data = await res.json();
  return data.messages || [];
}

async function onSend(e) {
  e.preventDefault();
  const text = els.text.value.trim();
  if (!text) return;
  if (!userName || !token) { updateComposer(); return; }
  if (!hub || hub.state !== 'Connected') { showError('Chat hors ligne — reconnexion…'); return; }
  try {
    await hub.invoke('Send', userName, token, text);
    els.text.value = '';
    els.text.focus();
  } catch (err) {
    showError('Envoi impossible : ' + err.message);
  }
}

// ----------------------------- SIGNALR --------------------------------
function connect() {
  if (!window.signalR) { setDot('off'); return; }
  setDot('busy');
  hub = new signalR.HubConnectionBuilder()
    .withUrl('/chatHub')
    .withAutomaticReconnect([0, 2000, 5000, 10000])
    .build();

  hub.on('ReceiveHistory', (list) => { setDot('on'); renderHistory(list); });
  hub.on('ReceiveChat', (m) => appendMessage(m, true));
  hub.on('ChatError', (msg) => {
    showError(msg);
    // Pseudo non reconnu (jeton périmé) : on repasse par l'écran d'inscription.
    if (/reconn/i.test(msg)) {
      token = '';
      localStorage.removeItem(LS_TOKEN);
      updateComposer();
    }
  });

  hub.onreconnecting(() => setDot('busy'));
  hub.onreconnected(() => setDot('on'));
  hub.onclose(() => setDot('off'));

  hub.start().then(() => setDot('on')).catch(() => {
    setDot('off');
    els.messages.innerHTML = '<div class="chat-empty">Chat indisponible (serveur injoignable).</div>';
  });
}

function setDot(kind) {
  if (els.dot) els.dot.className = `chat-head-dot ${kind}`;
}

// ----------------------------- INIT -----------------------------------
build();
connect();
