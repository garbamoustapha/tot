# Plan de la présentation — PD Arena

> Présentation technique du projet **PD Arena** — plateforme web de type
> CodingGame basée sur le Dilemme du Prisonnier Itéré (DPI) et les tournois
> d'Axelrod. Public visé : équipe technique / jury de projet.
> Format : 16:9, ~14 diapositives, palette « Ocean Gradient » (deep blue / teal /
> midnight), sans images (modèle glm-5.2), icônes vectorielles via react-icons.

---

## Liste ordonnée des diapositives

1. **Couverture / Titre**
   - Titre : « PD Arena »
   - Sous-titre : « Code-battle platform — Dilemme du Prisonnier Itéré »
   - Ligne de contexte : Inspiré des tournois d'Axelrod · C# & Python · Solo + Multijoueur
   - Auteur / date

2. **Le concept en une diapo**
   - Pitch : « Programme ta stratégie, entre dans l'arène, affronte tous les
     algorithmes. »
   - 3 piliers (icônes + texte) : ① Coder (C#/Python) ② Combattre (round-robin)
     ③ Visualiser (tour par tour)

3. **Contexte historique — Axelrod & TourExec**
   - Origine : tournois de Robert Axelrod (*The Complexity of Cooperation*)
   - `TourExec` = logiciel original en Fortran → **source de vérité du contrat**
   - Invariants historiques repris tels quels (signature, gains, longueurs)
   - Pourquoi un état stateful persiste d'un tour à l'autre

4. **Le contrat d'exécution (signature)**
   - Signature : `f(opponent_last_move, current_turn, my_score, opponent_score,
     random_value, my_last_move) → 0|1`
   - 0 = Coopérer, 1 = Trahir
   - Règle tour 1 : coups absents → `-1` (stratégie « nice » coopère)
   - État géré par le runner (instance réutilisée tour après tour)

5. **La matrice de gain (T,R,P,S)**
   - Tableau joueur / adversaire
   - T=5, R=3, P=1, S=0
   - Propriétés : `T > R > P > S` et `2R > T+S` ⇒ coopération mutuelle = opt. de Pareto

6. **Architecture globale**
   - Trois couches : Frontend (SPA, Monaco) / Backend (ASP.NET Core + SignalR) /
     Exécution (engine, Roslyn, Pyodide)
   - Mode Solo = exécution côté client (Wasm/interpréteur) ; Mode Arène = serveur
   - Flux de données REST + SignalR (temps réel)

7. **Le mode Solo — arène d'entraînement**
   - Éditeur Monaco (C#/Python)
   - Round-robin contre les 19 stratégies builtin, 5 longueurs, self-play inclus
   - Classement live progressif (rang 1 → dernier, score moy./tour)
   - Vues : Classement / Duels / Algorithmes (codex)

8. **Le mode Arène — multijoueur en ligne**
   - Backend ASP.NET Core 9 + SignalR (`/arenaHub`)
   - Soumission : 1 stratégie / joueur, compilée via Roslyn (filtre tokens interdits)
   - Tournoi périodique (BackgroundService, horaire par défaut)
   - Évènements temps réel : Countdown / Start / Progress / Leaderboard / Duels

9. **Le moteur de tournoi**
   - Boucle de match (instance fraîche, sanitize des coups, payoff)
   - Robustesse : 5 longueurs {63, 77, 151, 156, 308} (comme Axelrod masquait la longueur)
   - Round-robin + self-play ; score = moyenne par tour
   - Reproductibilité : graine par match, hash SHA-256 des codes

10. **Visualisation & simulation**
    - p5.js : jetons C/D animés, scores cumulés, frise des coups, badge T/R/P/S
    - Match reproductible (PRNG mulberry32 seedé)
    - Rejeu serveur (`/api/replay`) : tout duel animable, source non exposée
    - Contrôles : play/pause, vitesse, longueur, graine

11. **Sécurité — sandboxing du code utilisateur**
    - Code non-fiable : boucles infinies, réseau, FS, mémoire
    - Serveur : Roslyn + filtre source (System.Net/IO/Reflection/Threading…),
      ALC collectible (unload), timeout par tour
    - Client (Solo) : Pyodide (Wasm) + interpréteur C# maison (sous-ensemble)
    - Validation statique de signature + timeout CPU = filet ultime

12. **Les 19 stratégies builtin (codex)**
    - Familles : Coopératifs (TFT, TF2T, Pavlov, AlwaysC…), Traîtres (Grim,
      AlwaysD, Tester, Joss…), Aléatoires (Random, noisy)
    - Ports historiques : k42r (Borufsen), Champion, Graaskamp (k60r),
      Dawes & Batell (k80r)
    - Chaque stratégie : icône, type, comportement, code source réel

13. **Stack technique & livrables**
    - Frontend : HTML/JS (Monaco, Chart.js, p5.js) — site statique
    - Backend : ASP.NET Core 9, SignalR, Roslyn, persistance JSON
    - Tests : REST 11/11, SignalR 49/49, navigateur 0 pageerror
    - Référence : `TourExec` (Fortran), `docs/ARCHITECTURE.md`

14. **Conclusion & perspectives**
    - Récap : une plateforme qui rend le DPI tangible et jouable
    - Suite possible : auth/JWT, PostgreSQL+Redis, conteneurs gVisor, matchmaker
    - Lever de rideau : « Que la meilleure stratégie gagne. »

---

## Décisions de design (normes)

- **Palette** : Ocean Gradient — Primary `065A82` (deep blue), Secondary `1C7293`
  (teal), Accent `21295C` (midnight), fond clair `F4F7FA`, texte `1A2733`.
- **Structure sandwich** : diapos titre + conclusion en fond sombre (midnight),
  contenu en fond clair.
- **Motif visuel** : icône dans cercle coloré à gauche des en-têtes de section ;
  barre d'accent verticale fine à gauche des cartes (RECTANGLE, pas rounded).
- **Typographie** : Header `Cambria` (personnalité), Body `Calibri` (lisible).
  Titres 36–40pt, sous-titres 18–22pt, corps 14–16pt, captions 10–12pt.
- **Marges** : 0.5" mini, 0.3" entre blocs, alignement à gauche du corps.
- **Pas de ligne d'accent sous les titres** (marqueur de slides IA).
- **Pas d'images raster** (glm-5.2 ne les gère pas) ; icônes vectorielles uniquement.