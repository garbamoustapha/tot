# Prisoner's Dilemma — Tournament Arena (MVP Solo, client-side)

Arène web **fonctionnelle** : vous écrivez une stratégie en **Python** ou **C#**,
vous **entrez dans l'arène**, et votre code affronte **tous** les algorithmes de
référence en round-robin. Le **classement complet** (du premier au dernier)
s'affiche. Aucun choix d'adversaire, aucun backend, aucune sortie réseau.

- **Python** → exécuté via **Pyodide** (CPython compilé en WebAssembly).
- **C#** → exécuté via un **interpréteur tree-walking** intégré
  (`js/cs-interpreter.js`), sur un sous-ensemble du langage (voir ci-dessous).
- Moteur de tournoi Axelrod conforme à `TourExec` : matrice T/R/P/S = 5/3/1/0,
  manches de 63·77·151·156·308 tours, self-play inclus, classement par **score
  moyen par tour** (équitable quelle que soit la longueur des manches).

## Lancer

```bash
cd D:\tot\app
python -m http.server 8765
# ouvrir http://localhost:8765/
```

> Un serveur HTTP local est nécessaire (modules ES + Pyodide). `file://` ne marche pas.

Au premier usage de Python, Pyodide (~10 Mo) se télécharge une fois (mis en
cache). Le C# s'exécute instantanément. Raccourci : **Ctrl/Cmd + Entrée** pour
lancer le tournoi.

## Fonctionnement

1. Éditez votre stratégie (le template minimal contient un **commentaire
   expliquant chaque paramètre** et ce que `decide()` doit retourner).
2. Cliquez **« Entrer dans l'arène »**.
3. Le tournoi round-robin se joue : votre code + les 19 algorithmes de référence,
   chacun contre tous (self-play inclus), sur les 5 longueurs de manches — soit
   190 paires × 5 = 950 matchs.
4. Le **classement** s'affiche du 1er au dernier, avec votre ligne surlignée
   (« Vous »), votre rang, votre score moyen par tour, et le bilan V · E · D.
5. **Cliquez n'importe quelle ligne du classement** pour ouvrir la
   **simulation de match animée** : votre stratégie vs cet adversaire, tour par
   tour, dans une visualisation p5.js (jetons C/D, scores cumulés, frise des
   coups, badge de gain T/R/P/S). Contrôles : lecture/pause (ou Espace),
   recommencer, vitesse (0,5× à instant), longueur de manche, graine. **Deux
   sélecteurs « Stratégie A / Stratégie B » permettent de changer les deux
   opposants à la volée** (Vous ou n'importe lequel des 19 algorithmes, miroir
   inclus) — la simulation relance immédiatement avec la nouvelle paire, en
   conservant la longueur, la graine et la vitesse courantes. Échap
   ferme. La graine rend chaque match reproductible (PRNG mulberry32).
6. Onglet **« Duels »** : un filtre **« Point de vue »** permet de choisir
   **n'importe quel** algorithme (Vous ou les 19 de référence) et de voir ses
   duels face à tous les autres — score cumulé (5 manches), différence, bilan
   V·E·D et barre comparative. Chaque ligne est cliquable pour lancer la
   simulation animée de ce duel précis.
7. Onglet **« Algorithmes »** (codex) : une carte par algorithme — icône
   teintée selon le type, nom, badge **Coopératif / Traître / Aléatoire**,
   comportement détaillé, et le **code source** réel (JavaScript, via
   `impl.toString()`) dépliable. Des **filtres par type** (Tous / Coopératif /
   Traître / Aléatoire, avec compteur) masquent les cartes hors type. Chaque
   carte a un bouton **« ▶ Simuler »** pour lancer le match animé contre cet
   algorithme.

## Signature de fonction (Axelrod)

```
decide(opponent_last_move, current_turn, my_score, opponent_score, random_value, my_last_move) → 0|1
```

`0 = Coopérer`, `1 = Trahir`, `opponent_last_move = -1` (ou `None`) au tour 1.
L'instance de la classe persiste d'un tour à l'autre (état mémorisé).

## Stratégies de référence (19)

Réciprocité : **Tit for Tat**, **Tit for Two Tats**, **Suspicious Tit for Tat**,
**Generous Tit for Tat**, **Reverse Tit for Tat**.
Réactives / à état : **Pavlov** (Win-Stay Lose-Shift), **k42r** (Borufsen),
**Champion**, **Tester**, **Joss** (TFT bruité).
À seuil / détection : **Grim Trigger**, **Graaskamp** (k60r), **Dawes & Batell**
(k80r), **Hard Majority** (k31r), **Soft Majority**.
Périodiques / baselines : **Periodic C·C·D**, **Random**, **Always Cooperate**,
**Always Defect**.

Les stratégies marquées `k31r`/`k60r`/`k80r` sont des ports fidèles de TourExec.

## Sous-ensemble C# supporté par l'interpréteur

- `using …;` (ignoré), `public class Player { … }` avec champs et méthodes.
- Modificateurs `public/private/protected/internal/static/readonly/const`.
- Types `int, long, double, float, bool, string, var, void` (+ ident).
- Champs avec initialiseur, `const`, méthodes + méthodes helper (`this.Foo()`).
- Instructions : bloc, décl. locale, assignation (`= += -= *= /= %=`),
  `if/else`, `for`, `while`, `do/while`, `return`, `break`, `continue`,
  `++/--` (pré/post), expression statement.
- Expressions : littéraux, `this`, `(expr)`, arithmétique, comparaisons,
  logiques (`&& || !`), bitwise (`& | ^`), ternaire `?:`, cast `(int)/(double)…`,
  accès membre, appels, `Math.Max/Min/Abs/Sqrt/Round/Floor/Ceiling/Sign/Pow/…`.
- **Division toujours flottante** (JS ne distingue pas `2` de `2.0`). Pour une
  troncature entière, utiliser `(int)(a / b)`.
- Garde-fous : 1 000 000 d'itérations max par boucle, profondeur d'appel 1000.

## Fichiers

```
app/
  index.html          Layout 2 colonnes (éditeur + classement)
  styles.css          Thème slate + un seul accent (indigo), minimal
  js/
    engine.js         playMatch, benchmark, roundRobin (tournoi + classement)
    builtin.js        19 stratégies de référence (TFT, TF2T, Pavlov, k42r, Graaskamp, Tester, …)
    python-runner.js  Exécution Python via Pyodide (Wasm)
    cs-interpreter.js Interpréteur C# (tokenizer + parser + évaluateur)
    templates.js      Modèles de code minimaux + commentaire explicatif
    sim.js            Simulation de match animée (p5.js, mode instance, PRNG seedé)
    ui.js             Orchestration : éditeur Monaco + tournoi + classement + simulation
```