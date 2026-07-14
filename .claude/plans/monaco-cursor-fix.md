# Plan : réparer le curseur figé en haut à gauche dans l'éditeur Monaco

## Problème constaté
L'éditeur de code de l'arène (Monaco Editor) a un comportement erratique : le curseur reste bloqué en haut à gauche (ligne 1, colonne 1). Typiquement, cela signifie que Monaco a mal calculé ses dimensions au moment de l'initialisation ou que son `layout()` n'est jamais déclenché après que le conteneur a obtenu sa taille réelle.

## Code concerné
- `app/index.html` : charge p5.js AVANT le loader Monaco, charge le CSS Monaco, contient `#monaco`.
- `app/js/ui.js:30-65` : initialisation de Monaco, création du modèle et de l'éditeur, switch de langage.
- `app/styles.css:51-62` : styles du conteneur `#monaco` (flex:1, min-height:0).

## Causes probables identifiées

### 1. Conteneur sans dimensions stables au premier layout
`#monaco` dépend de la chaîne flex : `.pane-body { flex:1 }` → `#monaco { flex:1; min-height:0 }`. C'est correct en théorie, mais Monaco a besoin d'une taille calculée dès `create()`. Si un parent n'a pas encore été mesuré (fonts non chargées, CSS en cours de calcul, ou scrollbar qui apparaît), Monaco peut se créer avec une hauteur/largeur de 0 et ne jamais se redimensionner correctement malgré `automaticLayout: true`.

### 2. `automaticLayout: true` n'est pas suffisant
Cette option observe les mutations du conteneur parent, mais elle ne détecte pas toujours les changements de taille dus au chargement asynchrone des polices ou au premier paint. Sans un `editor.layout()` forcé après un `requestAnimationFrame` + chargement des fonts, l'éditeur peut rester "coincé".

### 3. Changement de langue réinitialise le curseur
`setLang()` appelle `monacoModel.setValue(tpl)`. `setValue` réinitialise le modèle et replace le curseur en (1,1). Quand l'utilisateur a déjà commencé à taper puis clique sur l'autre langage (ou au démarrage si `main()` appelle `setLang('python')` après que le modèle a déjà été initialisé avec le même template), cela efface la position du curseur. Ce n'est pas le bug principal, mais ça participe au symptôme "figé en haut à gauche".

### 4. Conflit potentiel require.js / AMD
Le loader Monaco (`vs/loader.js`) pose `window.require` et `window.define`. p5.js est chargé avant pour éviter qu'il ne s'enregistre comme module AMD, mais d'autres scripts tiers ou un hot-reload pourraient réintroduire un conflit. Il faut isoler le contexte AMD de Monaco autant que possible.

## Approches envisagées

### A. Correctif minimal (chaud)
- Forcer `editor.layout()` dans un `requestAnimationFrame` puis un `setTimeout(0)` après `monacoReady`.
- Ajouter une écoute de `document.fonts.ready` avant create si possible, ou layout après fonts ready.
- Conserver `automaticLayout: true`.
- **Inconvénient** : fragile, dépend du timing, ne résout pas le problème structurel de redimensionnement.

### B. Wrapper explicite + ResizeObserver (recommandé)
- Remplacer `#monaco` par un wrapper `<div id="monacoWrap"><div id="monaco"></div></div>`.
- Donner au wrapper `position: relative; width: 100%; height: 100%; overflow: hidden;`.
- L'éditeur interne `#monaco` a `position:absolute; inset:0`.
- Désactiver `automaticLayout: true` et gérer le resize manuellement via un `ResizeObserver` sur le wrapper.
- Forcer `editor.layout()` après création, après `document.fonts.ready`, et à chaque changement de taille du wrapper.
- **Avantage** : fiable, prévisible, performance maîtrisée, résout le curseur figé à la source.

### C. Attendre les polices avant create
- Utiliser `await document.fonts.ready` avant `monaco.editor.create()`.
- **Inconvénient** : peut retarder l'affichage de plusieurs centaines de ms sur une connexion lente. À combiner avec B, pas à utiliser seul.

### D. Préserver le curseur au changement de langue
- Sauvegarder la position du curseur avant `setValue` via `editor.getPosition()`.
- Après `setValue`, appeler `editor.setPosition(pos)` si elle est toujours valide pour le nouveau template.
- **Avantage** : améliore l'UX, mais ne résout pas le bug de curseur figé.

## Stratégie retenue
1. **Wrapper + ResizeObserver** (approche B) : corrige la cause racine du curseur figé.
2. **Layout forcé multi-étape** : `requestAnimationFrame` → `document.fonts.ready` → `ResizeObserver` → `editor.layout()`.
3. **Préservation curseur au switch langage** (D) : amélioration UX directement liée au symptôme.
4. **Confinement AMD** : utiliser `require.config({ paths: ... })` et éviter tout conflit avec p5. Déjà fait, mais on le conserve.
5. **Test de non-régression** : vérifier que l'éditeur occupe bien toute la hauteur, que taper déplace le curseur, que le switch Python/C# conserve ou réinitialise proprement le curseur, et que le redimensionnement de la fenêtre met à jour l'éditeur.

## Fichiers à modifier
- `app/index.html` : ajouter le wrapper explicite autour de `#monaco`.
- `app/styles.css` : styles du wrapper et de l'éditeur interne.
- `app/js/ui.js` : refacto de `monacoReady`, ajout du `ResizeObserver`, layout forcé, préservation du curseur dans `setLang`.

## Non-objectifs
- Ne pas changer la logique métier du tournoi.
- Ne pas changer le moteur d'exécution Python/C#.
- Ne pas migrer vers un autre éditeur (CodeMirror, ACE, etc.) — rester sur Monaco.

## Validation attendue
- [ ] Le curseur se déplace normalement lors de la frappe dès le chargement.
- [ ] L'éditeur remplit tout l'espace vertical de la pane.
- [ ] Redimensionner la fenêtre met à jour l'éditeur sans figer.
- [ ] Switcher entre Python et C# ne fige pas le curseur et ne l'envoie pas systématiquement en (1,1).
- [ ] Aucune erreur console liée à Monaco, require.js ou p5.
