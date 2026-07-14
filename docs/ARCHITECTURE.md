# Prisoner's Dilemma Arena — Architecture Technique

> Plateforme web de simulation de code ludique (type CodingGame) basée sur le
> **Dilemme du Prisonnier Itéré (DPI)** et les tournois d'Axelrod.
> Les utilisateurs programment des stratégies en **C#** ou **Python**, puis les
> affrontent dans une arène visuelle (solo) ou communautaire (multijoueur).

---

## 1. Contexte & références historiques

Le moteur de tournoi s'inspire du dépôt **`TourExec`** (logiciel original d'Axelrod,
*The Complexity of Cooperation*). Les invariants historiques repris tels quels :

| Élément | Valeur | Source |
|---|---|---|
| Signature de stratégie | `f(opponent_last_move, current_turn, my_score, opponent_score, random_value, my_last_move) → 0|1` | `TourExec/src/strategies/*.f` |
| Encodage des coups | **0 = Coopérer**, **1 = Trahir** | `TourExec/README.rst` |
| Matrice de gain (T,R,P,S) | **T=5, R=3, P=1, S=0** | `TourExec/src/tournament/AxTest.f` (Cases 1–4) |
| Longueurs de manches | **63, 77, 151, 156, 308** tours | `AxTest.f` ligne `integer length(5) /63,77,151,156,308/` |
| Stratégies de référence | TitForTat (`KTitForTatC`), k42r (Borufsen), Champion, TF2T, Pavlov, Random… | `TourExec/src/strategies/` (63 règles du 2ᵉ tournoi) |

L'état interne d'une stratégie **persiste d'un tour à l'autre** (en Fortran via
`-fno-automatic`). Dans notre exécuteur, chaque match instancie un objet stratégie
**stateful** : la fonction est appelée tour après tour sur la **même instance**.

### Matrice de gain (vue joueur)

| Joueur \ Adversaire | Coopère (0) | Trahit (1) |
|---|---|---|
| **Coopère (0)** | R=3 / R=3 | S=0 / T=5 |
| **Trahit (1)** | T=5 / S=0 | P=1 / P=1 |

`T > R > P > S` et `2R > T+S` ⇒ la coopération mutuelle est l'optimum de Pareto
répété, fondement de l'analyse d'Axelrod.

---

## 2. Schéma d'architecture global

```
                            ┌─────────────────────────────────────────────┐
                            │                 UTILISATEUR                  │
                            │   Navigateur (Monaco Editor + Chart.js)     │
                            └───────────────┬─────────────────────────────┘
                                            │ HTTPS / WSS
                            ┌───────────────▼─────────────────────────────┐
                            │            FRONTEND (SPA)                    │
                            │  Next.js 15 / React 19 + Tailwind CSS        │
                            │  • Arène Solo   • Hall des Challenges        │
                            │  Monaco (C#/Python) • Visualisation temps réel
                            └───────────────┬─────────────────────────────┘
                                            │ REST + WebSocket (SignalR/WS)
                            ┌───────────────▼─────────────────────────────┐
                            │        API DE GESTION (Gateway)              │
                            │  ASP.NET Core 8 minimal API / NestJS         │
                            │  Auth (JWT/OIDC) · Users · Stratégies CRUD   │
                            │  Leaderboard · Matchmaking · Tourn. orchest. │
                            │  Persistence: PostgreSQL + Redis (cache/pub)│
                            └───────┬─────────────────────┬───────────────┘
                       REST/gRPC   │                     │  file storage
              ┌─────────────────────▼──────┐    ┌─────────▼──────────┐
              │  MICROSERVICE D'EXÉCUTION   │    │  Object Storage     │
              │  (Code Execution Engine)    │    │  (codes sources,    │
              │  Sandbox Docker / Wasm      │    │   artefacts compilés)│
              │  • Runner C# (.NET 8 AOT)   │    └─────────────────────┘
              │  • Runner Python (Pyodide /  │
              │     CPython sandboxé)        │
              │  • Tournament Engine (DPI)   │
              └───────┬──────────────────────┘
                      │ events (score/tour)
              ┌───────▼──────────────────────┐
              │   Message Bus / Stream        │
              │   Redis Streams / NATS        │
              │   → push live au Frontend     │
              └───────────────────────────────┘
```

### 2.1 Frontend (SPA)

- **Stack** : Next.js 15 (App Router) + React 19 + Tailwind CSS + Monaco Editor
  (coloration C#/Python) + Chart.js (courbe de coopération) + Framer Motion
  (animations d'arène).
- **Deux interfaces** :
  1. **Arène Solo / Entraînement** — 3 panneaux : éditeur, config adversaires,
     visualisation (coups live, scores cumulés, courbe de tendance).
  2. **Hall des Challenges** — leaderboard global (score moyen) + matchmaker de
     duel ("Mon Code vs Son Code").
- **Temps réel** : connexion WebSocket/SignalR pour recevoir les évènements
  tour-par-tour émis par le moteur d'exécution.

### 2.2 API de gestion (Gateway)

- **Stack** : ASP.NET Core 8 (minimal API + SignalR) — cohérence avec les
  runners C#. (NestJS est une alternative valide.)
- **Responsabilités** :
  - Authentification / autorisation (JWT ou OIDC, OIDC recommandé via Keycloak).
  - CRUD des stratégies utilisateur (versionnées, stockées en base + object storage).
  - File d'attente des simulations (soumission → job → résultat).
  - **Leaderboard** : score moyen de chaque joueur contre le *pool* complet
    (round-robin estilo Axelrod), recalculé incrémentalement via job périodique
    ou sur événement de fin de tournoi.
  - **Matchmaker** : sélection d'un adversaire spécifique et lancement d'un duel
    isolé.
- **Persistance** :
  - **PostgreSQL** : utilisateurs, stratégies, matchs, scores, leaderboard.
  - **Redis** : cache du leaderboard, pub/sub des évènements live, files de jobs.

### 2.3 Microservice d'exécution (Code Execution Engine)

Service **stateless, autonome et isolé**, scalable horizontalement. Reçoit un
job `(stratégieA, stratégieB, longueur de manche, nombre de répétitions)` et
renvoie le log tour-par-tour + scores finaux.

- **Orchestrateur de tournoi** : simule **N répétitions** de matchs avec
  longueurs variables **{63, 77, 151, 156, 308}** (tirées aléatoirement ou
  fixes) pour mesurer la robustesse face à l'inconnu — exactement comme Axelrod
  masquait la longueur réelle aux concurrents.
- **Runners par langage** (cf. §4) : C# et Python.
- **Sandboxing** (cf. §3).
- **Émission d'évènements** : à chaque tour, publie
  `{turn, moveA, moveB, scoreA, scoreB, payoff}` sur Redis Streams pour le
  live du Frontend.

---

## 3. Sécurité — Sandboxing de l'exécution

Le code utilisateur est **non-fiable**. Menaces : boucles infinies, accès
réseau/système de fichiers, épuisement mémoire, escape container.

### 3.1 Modèle retenu : conteneur Docker léger par job (ou par batch)

| Couche | Mesure |
|---|---|
| **Isolement OS** | Conteneur jetable (runtime `gVisor` / `kata-containers` recommandé pour une couche VM légère) ; un match = un conteneur éphémère. |
| **Réseau** | `--network=none` (aucun accès réseau). |
| **Système de fichiers** | Filesystem read-only + tmpfs pour `/tmp` ; montage **uniquement** du code de la stratégie. |
| **Ressources** | `--memory=256m --cpus=1 --pids-limit=64` ; **timeout CPU temps-réel** par tour (ex. 100 ms) et par match (ex. 10 s). |
| **Capabilities** | `--cap-drop=ALL --security-opt=no-new-privileges`. |
| **Utilisateur** | Exécution sous UID non-root `1000:1000`. |

### 3.2 Alternative WebAssembly / Isolates

Pour réduire le coût de cold-start (Docker ≈ 100–300 ms / conteneur) :

- **Python** : **Pyodine** (CPython compilé en Wasm, tourne dans le navigateur
  *ou* côté serveur via un isolate). Aucun accès FS/réseau natif.
- **C#** : **Blazor WebAssembly** côté client, ou compilation vers Wasm
  (`NativeAOT-LLVM` + `wasmtime`) côté serveur dans un isolate type
  `Cloudflare Workers` / `Den isolats`.

**Recommandation hybride** :
- **Mode Solo (entraînement)** → exécution **côté client** en WebAssembly
  (Pyodide / Blazor Wasm) : zéro coût serveur, feedback instantané, sécurité
  maximale (le code ne quitte jamais le navigateur).
- **Mode Multijoueur / leaderboard** → exécution **côté serveur** en conteneur
  gVisor (résultats certifiés, anti-triche, reproductibles).

### 3.3 Validation statique du code soumis

Avant exécution, analyse AST légère pour rejeter :
- Imports réseau/OS interdits (Python : `socket`, `subprocess`, `os.system`,
  `ctypes`… ; C# : `System.Net`, `System.IO.File`, `Process`…).
- Boucles non bornées manifestes (heuristic + timeout CPU en filet de sécurité).
- Conformité de signature (présence de la fonction attendue, retour bool/int).

Le **timeout CPU par tour** reste le filet ultime : une stratégie qui dépasse
perd le tour (coup forfait = Trahir `1`, ou disqualification du match selon
politique).

---

## 4. Format de fonction (contrat d'exécution)

### 4.1 Signature standardisée (Axelrod)

```text
ENTRÉES
  opponent_last_move : int   ∈ {0,1}   # 0=Coopérer, 1=Trahir (coup précédent de l'adversaire)
  current_turn       : int   ≥ 1       # numéro du tour courant (1-indexé)
  my_score           : int             # score cumulé du joueur
  opponent_score     : int             # score cumulé de l'adversaire
  random_value       : float ∈ [0,1)   # aléa pour stratégies stochastiques
  my_last_move       : int   ∈ {0,1}   # coup précédent du joueur lui-même

SORTIE
  return : int ∈ {0,1}                 # 0=Coopérer, 1=Trahir
```

### 4.2 État persistant

La fonction est **sans champ de classe mutables visibles** : l'état (historique
des coups, compteurs…) est géré **par le runner** qui instancie la stratégie une
fois par match et la rappelle tour après tour. Le template expose une **classe
stateful** (C#) / un **module stateful** (Python) ; le runner appelle la méthode
`Decide(...)` à chaque tour sur la même instance.

### 4.3 Règle d'initialisation (premier tour)

Au tour 1, `opponent_last_move` et `my_last_move` sont **absents** (convention :
`-1` ou `None`). Une stratégie "nice" (comme TFT) coopère au premier tour par
défaut. Le runner transmet `-1` que le code interprète comme "pas d'historique".

---

## 5. Moteur de tournoi (Tournament Engine)

### 5.1 Boucle de match (1 match = 1 longueur de manche)

```pseudo
function playMatch(stratA, stratB, length):
    a = stratA.newInstance()      # état frais
    b = stratB.newInstance()
    lastA = -1; lastB = -1        # -1 = pas de coup précédent
    scoreA = 0; scoreB = 0
    log = []
    for turn in 1..length:
        mvA = a.Decide(lastB, turn, scoreA, scoreB, rng(), lastA)
        mvB = b.Decide(lastA, turn, scoreB, scoreA, rng(), lastB)
        # validation : 0/1, sinon coup forfait
        mvA = sanitize(mvA); mvB = sanitize(mvB)
        # matrice T=5,R=3,P=1,S=0
        (gainA, gainB) = payoff(mvA, mvB)
        scoreA += gainA; scoreB += gainB
        log.push({turn, mvA, mvB, scoreA, scoreB})
        lastA = mvA; lastB = mvB
    return {scoreA, scoreB, log}
```

### 5.2 Robustesse — longueurs variables & répétitions

Chaque duel est joué sur les **5 longueurs** `{63, 77, 151, 156, 308}`, répété
**N** fois (configurable, ex. N=10) pour réduire la variance des stratégies
stochastiques. Le score retenu = **moyenne** sur (5 longueurs × N répétitions).

### 5.3 Round-robin & leaderboard

- Tournoi = **round-robin** : chaque stratégie affronte toutes les autres
  (et elle-même, pour mesurer la robustesse face à un clone — point clé d'Axelrod).
- **Score de leaderboard** = moyenne du score par match contre le pool entier.
- Recalcul incrémental : à chaque nouvelle stratégie soumise, on ne rejoue que
  les duels impliquant cette stratégie ; le cache Redis stocke les duels
  déjà calculés (clé = hash des deux codes + longueurs + seed).

### 5.4 Reproductibilité & anti-triche

- Graine RNG **par match** (pas globale) — transmise au runner, journalisée.
- Les codes sont **hashés** (SHA-256) ; le leaderboard ne retient que la
  dernière version publiée par utilisateur.
- Mode serveur uniquement pour les matchs comptabilisés (le Wasm client est
  réservé à l'entraînement).

---

## 6. Schéma de données (simplifié)

```sql
-- PostgreSQL
users(id, username, email, password_hash, created_at)

strategies(
  id, user_id, name, language,         -- 'csharp' | 'python'
  source_hash, source_ref,             -- pointeur vers l'object storage
  version, is_published, created_at
)

matches(
  id, tournament_id,
  strat_a_id, strat_b_id,
  lengths, repetitions, rng_seed,
  score_a, score_b, winner,
  log_ref,                             -- log tour-par-tour (object storage / JSONB)
  created_at
)

leaderboard(
  strategy_id, avg_score, rank, matches_played, updated_at
)

duel_requests(                         -- matchmaker
  id, requester_id, target_strategy_id,
  status, result_match_id, created_at
)
```

---

## 7. API REST (endpoints clés)

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/auth/login` | Authentification, retour JWT |
| `GET/POST` | `/strategies` | Lister / créer une stratégie |
| `GET/PUT/DELETE` | `/strategies/{id}` | Détail / versionner / supprimer |
| `POST` | `/arena/simulate` | Lancer un match solo (synchrone, exécution Wasm côté client ou job court) |
| `POST` | `/arena/duel` | Matchmaker : duel contre une stratégie cible |
| `WS` | `/arena/stream/{jobId}` | Flux live des évènements tour-par-tour |
| `GET` | `/leaderboard` | Classement global paginé |
| `GET` | `/strategies/builtin` | Liste des adversaires prédéfinis (TFT, k42r, Champion…) |

---

## 8. Adversaires prédéfinis (builtin)

Portés depuis `TourExec/src/strategies/` vers C#/Python dans le runner :

| ID | Nom | Origine | Principe |
|---|---|---|---|
| `tft` | Tit for Tat | `KTitForTatC.f` | Coopère t1, puis copie le dernier coup de l'adversaire. "Nice", pardonneresse, claire. |
| `tf2t` | Tit for Two Tats | `KTF2TC.f` | Ne trahit qu'après deux trahisons consécutives. |
| `pavlov` | Win-Stay Lose-Shift | `KPavlovC.f` | Conserve son coup si gain ≥ R, change sinon. |
| `random` | Random | `KRandomC.f` | Coopère/trahit selon `random_value`. |
| `k42r` | Borufsen (top tournoi) | `k42r.f` | TFT + détection d'adversaires "random/défectifs" + échappatoire aux cycles de trahison. |
| `champion` | Champion d'Axelrod | (stratégie gagnante) | Variante TFT avec perturbation stratégique. |

---

## 9. Roadmap de mise en œuvre

1. **P0 — MVP Solo** : Frontend (éditeur + visualisation) + runner Python Wasm
   côté client (Pyodide) + adversaires builtin. Aucun backend nécessaire pour
   l'entraînement local.
2. **P1 — Backend & persistance** : API gestion, auth, stockage des stratégies.
3. **P2 — Exécution serveur sandboxée** : conteneurs gVisor, moteur de tournoi,
   WS live.
4. **P3 — Multijoueur** : leaderboard round-robin, matchmaker, recalcul incrémental.
5. **P4 — C# runner** + compilation AOT dans la sandbox.

---

## 10. Livrables associés

- `docs/arena.html` — maquette HTML/Tailwind de l'arène (éditeur Monaco +
  visualisation + hall des challenges).
- `templates/player.cs` — template de stratégie C# (TFT d'exemple).
- `templates/player.py` — template de stratégie Python (TFT d'exemple).