#!/usr/bin/env bash
# run.sh — Lance PD Arena en local (backend .NET 9 + frontend + SignalR) contre
# une base SQL Server LocalDB. Idempotent. Conçu pour être lancé en tâche de
# fond par l'agent, qui vérifie ensuite la santé via `--check`.
#
# Modes :
#   bash run.sh              setup (LocalDB, DB, wwwroot) + build + LANCE le serveur (foreground)
#   bash run.sh --no-build   idem sans recompiler
#   bash run.sh --check      vérifie seulement un serveur déjà lancé, imprime RESULT, sort
#   bash run.sh --stop       arrête le serveur et libère le port
#
# L'agent DOIT lancer le mode par défaut avec run_in_background:true (le serveur
# reste au premier plan → suivi par le harness), puis appeler `--check` à part.
set -uo pipefail

# ------------------------------------------------------------------ config ---
PORT="${PDARENA_PORT:-5000}"
URL="http://localhost:${PORT}"
CONFIG="${PDARENA_CONFIG:-Debug}"
TFM="net9.0"
DB_NAME="${PDARENA_DB_NAME:-PdArena}"
LOCALDB_INSTANCE="${PDARENA_LOCALDB:-MSSQLLocalDB}"

# Racine du dépôt = deux niveaux au-dessus de ce script (.claude/skills/run-pdarena).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PROJ="$REPO/backend/PdArena"
DLL="$PROJ/bin/$CONFIG/$TFM/PdArena.dll"
CONNSTR="Server=(localdb)\\${LOCALDB_INSTANCE};Database=${DB_NAME};Integrated Security=true;Encrypt=False;MultipleActiveResultSets=True;Connect Timeout=30;"

up() { [ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/status" 2>/dev/null)" = "200" ]; }

find_tool() { # $1 = nom exe ; cherche dans le PATH puis Program Files
  command -v "$1" 2>/dev/null && return 0
  ls "/c/Program Files/Microsoft SQL Server/"*/Tools/Binn/"$1".exe 2>/dev/null | head -1 && return 0
  ls "/c/Program Files/Microsoft SQL Server/Client SDK/ODBC/"*/Tools/Binn/"$1".exe 2>/dev/null | head -1 && return 0
  return 1
}

# ------------------------------------------------------------------ --stop ---
if [ "${1:-}" = "--stop" ]; then
  pid="$(netstat -ano 2>/dev/null | grep -E ":${PORT}\b.*LISTENING" | awk '{print $NF}' | head -1)"
  if [ -n "${pid:-}" ]; then taskkill //PID "$pid" //F >/dev/null 2>&1 && echo "Arrêté (PID $pid)"; else echo "Rien à arrêter sur le port $PORT"; fi
  exit 0
fi

# ------------------------------------------------------------------ --check --
if [ "${1:-}" = "--check" ]; then
  for _ in $(seq 1 25); do up && break; sleep 1; done
  if ! up; then echo "RESULT: SITE_KO (aucune réponse sur $URL)"; exit 1; fi
  echo "status  : $(curl -s "$URL/api/status")"
  db="$(curl -s "$URL/api/dbcheck")"; echo "dbcheck : $db"
  fe="$(curl -s -o /dev/null -w '%{http_code}' "$URL/")"; echo "frontend: HTTP $fe (/)"
  echo "URL     : $URL"
  if echo "$db" | grep -q '"ok":true'; then echo "RESULT: SITE_SAIN (DB_OK) → $URL"; else echo "RESULT: SITE_SAIN (DB_DOWN) → $URL"; fi
  exit 0
fi

# ------------------------------------------------------------ déjà en ligne --
if up; then echo "PD Arena déjà en ligne sur $URL"; echo "RESULT: RUNNING → $URL"; exit 0; fi

# 1) LocalDB -----------------------------------------------------------------
SQLLOCALDB="$(find_tool sqllocaldb)" || { echo "ERREUR: sqllocaldb introuvable (SQL Server LocalDB requis)."; exit 3; }
SQLCMD="$(find_tool sqlcmd)" || { echo "ERREUR: sqlcmd introuvable (outils client SQL requis)."; exit 3; }
echo "→ Démarrage LocalDB ($LOCALDB_INSTANCE)…"
"$SQLLOCALDB" start "$LOCALDB_INSTANCE" >/dev/null 2>&1 || true

# 2) Base de données (le store crée la table lui-même au 1er accès) ----------
echo "→ Vérification base '$DB_NAME'…"
"$SQLCMD" -S "(localdb)\\${LOCALDB_INSTANCE}" -b -Q "IF DB_ID('${DB_NAME}') IS NULL CREATE DATABASE [${DB_NAME}];" >/dev/null 2>&1 \
  || { echo "ERREUR: impossible de créer/joindre la base '$DB_NAME' sur LocalDB."; exit 3; }

# 3) wwwroot (ASP.NET static web assets l'exige, même vide) ------------------
mkdir -p "$PROJ/wwwroot"

# 4) Build -------------------------------------------------------------------
if [ "${1:-}" != "--no-build" ]; then
  echo "→ Build ($CONFIG)…"
  ( cd "$PROJ" && dotnet build -c "$CONFIG" --nologo -v q ) || { echo "ERREUR: build échoué."; exit 4; }
fi
[ -f "$DLL" ] || { echo "ERREUR: binaire introuvable ($DLL). Lancer sans --no-build."; exit 4; }

# 5) Lancement (foreground → suivi par le harness quand lancé en tâche de fond)
echo "→ Lancement du serveur sur $URL (Ctrl-C ou 'bash run.sh --stop' pour arrêter)…"
cd "$PROJ"
export ASPNETCORE_ENVIRONMENT=Development
export ASPNETCORE_URLS="$URL"
export ConnectionStrings__Default="$CONNSTR"
exec dotnet "$DLL"
