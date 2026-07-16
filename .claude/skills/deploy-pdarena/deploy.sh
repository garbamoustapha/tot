#!/usr/bin/env bash
# ============================================================================
#  deploy-pdarena — build + publish + déploiement FTP + vérification santé.
#  Idempotent et sûr à relancer (conçu pour /loop). Ne contient AUCUN secret :
#  les identifiants FTP sont lus depuis deploy.env (gitignoré).
#
#  Usage :  bash deploy.sh [--skip-build]
#  Sorties : 0 = site sain (frontend + API OK) ; 1 = échec (à relancer) ;
#            2 = configuration manquante (deploy.env).
#  L'état de la base SQL est rapporté séparément (DB_OK/DB_DOWN) mais ne fait
#  PAS échouer le déploiement : l'app reste debout même DB injoignable.
# ============================================================================
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ='/d/tot/backend/PdArena'
PUB="$PROJ/publish"

# --- 1) Config / secrets --------------------------------------------------
if [[ ! -f "$HERE/deploy.env" ]]; then
  echo "ERREUR: $HERE/deploy.env introuvable. Copier deploy.env.example -> deploy.env et remplir." >&2
  exit 2
fi
# shellcheck disable=SC1091
source "$HERE/deploy.env"
: "${FTPHOST:?}" "${FTPUSER:?}" "${FTPPASS:?}" "${SITE_URL:?}"
BASE="ftp://${FTPHOST}/wwwroot"
AUTH=(--user "${FTPUSER}:${FTPPASS}" --ftp-pasv --connect-timeout 30 --retry 2 -sS)

# --- 2) Build + publish ---------------------------------------------------
if [[ "${1:-}" != "--skip-build" ]]; then
  echo "[build] dotnet publish -c Release (net9.0)…"
  if ! dotnet publish "$PROJ/PdArena.csproj" -c Release -o "$PUB" -f net9.0 --nologo 2>&1 | tail -4; then
    echo "[build] ÉCHEC publish" >&2; exit 1
  fi
fi
[[ -f "$PUB/PdArena.dll" ]] || { echo "[build] PdArena.dll absent de $PUB" >&2; exit 1; }

# --- 3) Déploiement FTP (technique app_offline) ---------------------------
cd "$PUB" || exit 1
echo '<html><body style="font-family:sans-serif;padding:3rem;text-align:center"><h2>Mise a jour en cours…</h2></body></html>' > /tmp/pd_app_offline.htm
echo "[deploy] app_offline (arrêt IIS, libère les DLL)…"
curl "${AUTH[@]}" --ftp-create-dirs -T /tmp/pd_app_offline.htm "${BASE}/app_offline.htm" >/dev/null && echo "  offline"
sleep 2

echo "[deploy] upload des fichiers (hors pdb/br/gz)…"
# Une SEULE connexion curl pour tous les fichiers (réutilise la session FTP =
# beaucoup plus rapide qu'un curl par fichier). On construit les paires -T/URL.
mapfile -t files < <(find . -type f ! -name '*.pdb' ! -name '*.br' ! -name '*.gz' ! -name 'app_offline.htm')
total=${#files[@]}
args=()
for f in "${files[@]}"; do
  rel="${f#./}"
  args+=(-T "$f" "${BASE}/${rel}")
done
upload_batch() { curl "${AUTH[@]}" --ftp-create-dirs "${args[@]}" >/dev/null 2>&1; }
if upload_batch; then
  echo "[deploy] $total fichier(s) uploadés (1 passe)"
else
  echo "[deploy] passe 1 incomplète — réessai global…"
  if upload_batch; then echo "[deploy] $total fichier(s) uploadés (2e passe)"; \
  else echo "[deploy] AVERTISSEMENT: des fichiers ont pu échouer (vérifier la santé ci-dessous)" >&2; fi
fi

echo "[deploy] retrait app_offline (remise en ligne)…"
curl "${AUTH[@]}" -Q "-DELE /wwwroot/app_offline.htm" "${BASE}/" >/dev/null 2>&1 && echo "  online"

# --- 4) Vérification santé ------------------------------------------------
echo "[verify] réveil + cold start…"; sleep 12
pass=1
probe() { curl -s -m 45 -o /dev/null -w "%{http_code}" "$1" 2>/dev/null; }

home=$(probe "$SITE_URL/")
[[ "$home" == "200" ]] && echo "  [OK]  /            HTTP 200" || { echo "  [FAIL] /            HTTP $home"; pass=0; }

api=$(curl -s -m 45 "$SITE_URL/api/status" 2>/dev/null)
if echo "$api" | grep -q "strategiesCount"; then
  echo "  [OK]  /api/status   $api"
else
  echo "  [FAIL] /api/status  -> $api"; pass=0
fi

arena=$(probe "$SITE_URL/arena.html")
[[ "$arena" == "200" ]] && echo "  [OK]  /arena.html   HTTP 200" || { echo "  [WARN] /arena.html  HTTP $arena"; }

# État base SQL (informatif — ne bloque pas le déploiement).
db=$(curl -s -m 45 "$SITE_URL/api/dbcheck" 2>/dev/null)
if echo "$db" | grep -q '"ok":true'; then
  echo "  [OK]  SQL Server    connecté"
  DBSTATE=DB_OK
elif [[ -n "$db" ]]; then
  echo "  [WARN] SQL Server   injoignable: $(echo "$db" | sed -E 's/.*"error":"?([^"]*)"?.*/\1/' | head -c 120)"
  DBSTATE=DB_DOWN
else
  echo "  [WARN] SQL Server   endpoint /api/dbcheck absent (retiré ?)"; DBSTATE=DB_UNKNOWN
fi

echo "----------------------------------------------------------------"
if (( pass == 1 )); then
  echo "RÉSULTAT: SITE_SAIN  ($DBSTATE)  -> $SITE_URL"
  exit 0
else
  echo "RÉSULTAT: SITE_KO  ($DBSTATE)  -> relancer le déploiement"
  exit 1
fi
