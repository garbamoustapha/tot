---
name: deploy-pdarena
description: Déploie l'arène PD Arena (.NET 9 ASP.NET Core) sur l'hébergement MonsterASP via FTP, puis vérifie la santé du site en live (frontend, API, SignalR, base SQL). Conçu pour tourner sous /loop jusqu'à ce que le site soit sain. Déclencheurs — "déploie PD Arena", "deploy pdarena", "mets en ligne l'arène", "redéploie le site", "vérifie le déploiement", "/loop deploy".
---

# Déploiement PD Arena → MonsterASP

Skill de déploiement + vérification de bout en bout pour PD Arena. Un cycle =
build → publish → upload FTP → vérification santé. Idempotent : sûr à relancer
en boucle jusqu'à ce que le site soit sain.

## Contexte technique (ne pas ré-explorer à chaque fois)

- **App** : `backend/PdArena` — ASP.NET Core 9, hébergement `InProcess` (IIS/ANCMv2).
  Sert le frontend statique `app/` (copié dans `wwwroot` au publish), une API REST
  `/api/*`, et un hub SignalR `/arenaHub`. URLs frontend **relatives** → same-origin.
- **Persistance** : SQL Server (MonsterASP `databaseasp.net`). Le store (`Store.cs`)
  est 100 % SQL, résilient : si la DB est injoignable, les lectures renvoient vide
  et le site **reste debout** (le frontend et l'API ne tombent pas).
- **Cible** : hébergement MonsterASP. Racine web = dossier `wwwroot` du compte FTP.
  Le publish (`PdArena.dll`, `web.config`, DLLs, `runtimes/`, `wwwroot/` frontend,
  `appsettings.json`) va dans `ftp://<host>/wwwroot/`.
- **Secrets** : identifiants FTP dans `deploy.env` (gitignoré, jamais commité).
  Chaîne de connexion SQL dans `backend/PdArena/appsettings.json` (gitignorée aussi,
  déployée mais hors git). Ne JAMAIS écrire ces secrets dans un fichier commité ni
  dans la sortie affichée.

## Procédure (un cycle)

1. **Pré-requis** : vérifier que `deploy.env` existe dans ce dossier de skill. Sinon,
   copier `deploy.env.example` → `deploy.env` et demander les identifiants FTP à
   l'utilisateur (host, user, password, URL publique du site).
2. **Lancer le cycle** :
   ```bash
   bash .claude/skills/deploy-pdarena/deploy.sh
   ```
   Le script publie, déploie via la technique `app_offline.htm` (qui arrête l'app IIS
   pour libérer le verrou sur les DLL), réessaie les fichiers en échec, remet en ligne,
   puis vérifie `/`, `/api/status`, `/arena.html` et l'état SQL via `/api/dbcheck`.
   Ajouter `--skip-build` pour redéployer sans recompiler.
3. **Lire le RÉSULTAT** en dernière ligne :
   - `SITE_SAIN (DB_OK)` → **terminé**, tout fonctionne. Arrêter la boucle.
   - `SITE_SAIN (DB_DOWN)` → site en ligne mais SQL injoignable (voir §Diagnostic DB).
   - `SITE_KO` → échec frontend/API : diagnostiquer puis relancer.

## Comportement en /loop

Ce skill est fait pour `/loop` (auto-rythmé). À chaque itération :
- Relancer un cycle **seulement** si le précédent n'était pas `SITE_SAIN (DB_OK)`,
  ou si des fichiers source ont changé depuis.
- **Condition d'arrêt** : dès que le résultat est `SITE_SAIN (DB_OK)`, arrêter la
  boucle (`ScheduleWakeup stop:true`) et rapporter le succès. Ne pas boucler
  indéfiniment sur un blocage externe non résoluble par le code (voir ci-dessous).
- Espacer les itérations (≥ 20 min) — un déploiement n'a pas besoin d'être fréquent.

## Diagnostic (prendre la meilleure décision selon le contexte)

- **`SITE_KO`, `/` renvoie une page « MonsterASP » avec cookie `ASPSESSIONID`** :
  c'est la page parquée du serveur par défaut, pas notre app → l'URL publique testée
  est mauvaise. Utiliser l'URL du panneau « Websites » (ex. `http://<nom>.runasp.net`),
  pas le hostname FTP `siteXXXXX.siteasp.net`. Corriger `SITE_URL` dans `deploy.env`.
- **`/api/*` → 404 IIS mais `/` sert bien notre index** : `web.config` manquant ou
  non appliqué. Vérifier qu'il est présent dans `ftp://<host>/wwwroot/web.config`.
- **500 sur `/api/submit`** : erreur d'écriture SQL. Interroger `/api/dbcheck` pour
  le message exact (renvoie l'erreur SANS mot de passe ni stack).
- **`DB_DOWN` avec « No such host is known »** : le hostname SQL ne résout pas.
  Vérifier dans le panneau MonsterASP que la base est **active** et que le hostname
  exact (onglet « Local access for websites ») correspond à `appsettings.json`.
  **Blocage externe** : ne pas boucler dessus — rapporter à l'utilisateur.
- **Verrou de fichier / upload DLL échoue** : l'app tourne encore. Le script gère
  ça via `app_offline.htm` ; si un fichier reste bloqué, relancer.

## Notes

- Ne jamais basculer le site en `ASPNETCORE_ENVIRONMENT=Development` sur la prod
  (exposerait traces + secrets aux visiteurs). Pour diagnostiquer, utiliser
  `/api/dbcheck` ou activer `stdoutLogEnabled` en restant en Production.
- L'endpoint `/api/dbcheck` est un outil de diagnostic. Une fois la DB validée
  (`DB_OK`), on peut le retirer de `Program.cs` pour la version finale.
- Le HTTPS (`https://<nom>.runasp.net`) doit être activé dans le panneau MonsterASP
  (certificat Let's Encrypt gratuit) ; en HTTP seul, `SITE_URL` reste en `http://`.
