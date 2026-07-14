// python-runner.js — Exécution réelle du code Python utilisateur via Pyodide
// (CPython compilé en WebAssembly). Aucune sortie réseau : le code ne quitte
// jamais le navigateur. Sécurité inhérente au sandbox Wasm.
// --------------------------------------------------------------------------
// Expose une fabrique makePythonStrategy(code) -> { init(), decide(inst,ctx),
// loadError, lastError } compatible avec le moteur (engine.playMatch).

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';

let _pyodidePromise = null;

// Charge Pyodide une seule fois (poids ~10 Mo, mis en cache par le navigateur).
export function loadPyodideOnce(onStatus) {
  if (_pyodidePromise) return _pyodidePromise;
  _pyodidePromise = new Promise((resolve, reject) => {
    const report = (msg) => onStatus && onStatus(msg);
    report('Téléchargement du runtime Python (Pyodide/Wasm)…');
    const s = document.createElement('script');
    s.src = PYODIDE_URL;
    s.onload = async () => {
      try {
        report('Initialisation de CPython…');
        const pyodide = await window.loadPyodide();
        await pyodide.loadPackage(['micropip']); // au cas où (stratégies pures)
        await pyodide.runPythonAsync(HARNESS);
        report('Prêt.');
        resolve(pyodide);
      } catch (e) {
        report('Erreur Pyodide : ' + e.message);
        reject(e);
      }
    };
    s.onerror = () => { report('Échec du chargement Pyodide.'); reject(new Error('pyodide load failed')); };
    document.head.appendChild(s);
  });
  return _pyodidePromise;
}

// Harness Python : charge le code utilisateur, instancie Player, expose decide.
const HARNESS = `
import js as _js

_inst = None
_user_ok = False
_load_error = None

def _pd_load(code):
    global _user_ok, _load_error, _inst
    _inst = None
    _load_error = None
    g = globals()
    g.pop("Player", None)
    try:
        exec(code, g)
        _user_ok = ("Player" in g)
        if not _user_ok:
            _load_error = "La classe 'Player' est introuvable dans le code."
    except Exception as e:
        _user_ok = False
        _load_error = f"{type(e).__name__}: {e}"

def _pd_ok():
    return _user_ok

def _pd_load_error():
    return _load_error

def _pd_reset():
    global _inst
    _inst = Player()

def _pd_decide(opp, turn, ms, os_, rv, my):
    # opp/my = -1 au tour 1 (convention "pas de coup précédent")
    try:
        r = _inst.decide(opp, turn, ms, os_, rv, my)
        if r is None:
            return [-1, "decide() a retourné None (attendu 0 ou 1)"]
        n = int(r)
        return [n, None]
    except Exception as e:
        return [-1, f"{type(e).__name__}: {e}"]
`;

// Crée une stratégie pilotée par le code Python de l'utilisateur.
export async function makePythonStrategy(code, { onStatus } = {}) {
  const pyodide = await loadPyodideOnce(onStatus);

  const loadFn = pyodide.globals.get('_pd_load');
  loadFn(code); loadFn.destroy();
  const okFn = pyodide.globals.get('_pd_ok');
  const ok = okFn(); okFn.destroy();
  const errFn = pyodide.globals.get('_pd_load_error');
  const loadError = errFn(); errFn.destroy();

  const strat = {
    language: 'python',
    loadError: ok ? null : (loadError || 'erreur de chargement'),
    lastError: null,

    init: async () => {
      const lf = pyodide.globals.get('_pd_load');
      lf(code); lf.destroy();
      const rf = pyodide.globals.get('_pd_reset');
      rf(); rf.destroy();
      strat.lastError = null;
      return {};
    },

    decide: async (_inst, ctx) => {
      const fn = pyodide.globals.get('_pd_decide');
      const proxy = fn(
        ctx.opponentLastMove,
        ctx.currentTurn,
        ctx.myScore,
        ctx.opponentScore,
        ctx.randomValue,
        ctx.myLastMove,
      );
      const [move, err] = proxy.toJs();
      proxy.destroy();
      fn.destroy();
      if (err) { strat.lastError = err; }
      return move; // -1 sur erreur -> sanitizeMove => coup forfait
    },
  };
  return strat;
}