---
name: run-pdarena
description: Lance PD Arena en local (backend .NET 9 ASP.NET Core + frontend statique + SignalR temps réel) contre une base SQL Server LocalDB, puis vérifie la santé (frontend, API, DB, classement live). Déclencheurs — "run l'app", "lance PD Arena", "démarre l'arène en local", "run pdarena", "teste l'app en local", "lance le serveur", "démarre le backend".
---

# Lancer PD Arena en local

Démarre l'app complète en local : le backend ASP.NET Core sert le frontend
`app/`, l'API REST `/api/*`, le hub SignalR `/arenaHub` et exécute les tournois.
La persistance passe par **SQL Server LocalDB** (pas besoin du serveur SQL distant
MonsterASP, souvent injoignable). Le store crée sa table tout seul au 1er accès.

## Contexte technique (ne pas ré-explorer)

- **Projet** : `backend/PdArena` — ASP.NET Core **net9.0**. Runtime .NET 9 requis
  (le SDK peut être plus récent, le build cible net9.0).
- **Frontend** : servi depuis `../../app` en développement (résolu par `Program.cs`).
  Un dossier `wwwroot/` **vide** doit exister dans le projet, sinon le chargeur de
  static web assets d'ASP.NET lève `DirectoryNotFoundException` au démarrage — le
  script le crée.
- **Base** : LocalDB `(localdb)\MSSQLLocalDB`, base `PdArena`. On **surcharge**
  `ConnectionStrings__Default` par variable d'environnement (l'`appsettings.json`
  pointe vers le SQL distant, qu'on ignore ici). Outils requis : `sqllocaldb` +
  `sqlcmd` (fournis avec SQL Server LocalDB / les outils client).
- **Port** : `http://localhost:5000` par défaut (surchargeable via `PDARENA_PORT`).

## Procédure

1. **Lancer le serveur** en tâche de fond (il reste au premier plan du script → le
   harness le suit ; ne PAS ajouter `&` ni `nohup`) :
   ```bash
   bash .claude/skills/run-pdarena/run.sh
   ```
   Passer `run_in_background: true` sur l'appel Bash. Le script : démarre LocalDB,
   crée la base si absente, crée `wwwroot/`, build, puis `exec` le serveur.
   Ajouter `--no-build` pour relancer sans recompiler.
2. **Vérifier la santé** dans un appel Bash séparé (le serveur tourne déjà) :
   ```bash
   bash .claude/skills/run-pdarena/run.sh --check
   ```
   Lire la dernière ligne `RESULT:` :
   - `SITE_SAIN (DB_OK) → http://localhost:5000` → **prêt**. Donner l'URL à l'utilisateur.
   - `SITE_SAIN (DB_DOWN)` → frontend/API OK mais LocalDB injoignable (voir §Diagnostic).
   - `SITE_KO` → le serveur n'a pas démarré : lire le log de la tâche de fond.
   - `RUNNING` → une instance tournait déjà (le mode par défaut le détecte aussi et sort).
3. **Ouvrir** `http://localhost:5000` (Solo, Arène en ligne, Algorithmes). Le
   premier tournoi se lance ~20 s après le démarrage puis toutes les heures ; le
   bouton « Lancer maintenant » (ou `POST /api/tournament/trigger`) en force un.
4. **Arrêter** quand terminé :
   ```bash
   bash .claude/skills/run-pdarena/run.sh --stop
   ```

## Vérifier visuellement (optionnel)

Pour une capture réelle (Solo avec Monaco, Arène live, mode clair/sombre), utiliser
la skill `webapp-testing` (Playwright) contre `http://localhost:5000`. Attendre
`networkidle` + ~3 s pour laisser SignalR négocier ; l'arène doit afficher
« Connecté » (point vert) et le classement des 19 stratégies de référence.

## Diagnostic

- **`SITE_KO` / port déjà pris (`address already in use`)** : une instance orpheline
  tient le port 5000. `bash run.sh --stop` puis relancer. Ne jamais double-backgrounder
  (`&` DANS un appel `run_in_background`) — le process s'oriente et n'est plus suivi.
- **`sqllocaldb`/`sqlcmd introuvable`** : SQL Server LocalDB n'est pas installé.
  L'app démarre quand même sans DB, mais l'arène restera vide (`DB_DOWN`).
- **`DB_DOWN`** : LocalDB non démarré ou base absente. Relancer le mode par défaut
  (idempotent : il (re)démarre LocalDB et (re)crée la base).
- **Build échoue (runtime net9 manquant)** : vérifier `dotnet --list-runtimes`
  (Microsoft.AspNetCore.App 9.x requis).

## Notes

- Le mode `Development` est **volontaire en local** (cache navigateur désactivé →
  les éditions de `app/*.css|js|html` sont visibles au rafraîchissement). Ne jamais
  déployer ce mode en prod (voir la skill `deploy-pdarena`).
- Le fichier `wwwroot/` créé en local est vide et sans effet (le frontend réel est
  servi depuis `app/`) — inutile de le commiter.
