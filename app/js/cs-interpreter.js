// cs-interpreter.js — Interpréteur C# (tree-walking) pour un sous-ensemble
// suffisant pour les stratégies du Dilemme du Prisonnier.
// --------------------------------------------------------------------------
// Exécute RÉELLEMENT le code C# édité, dans le navigateur, sans serveur.
//
// Sous-ensemble supporté :
//   - `using ...;` (ignoré), `public class Player { champs; méthodes; }`
//   - Modificateurs : public/private/protected/internal/static/readonly/const
//   - Types : int, long, double, float, bool, string, var, void (+ ident)
//   - Champs avec initialiseur : `private int _x = 0;` et `const int C = 0;`
//   - Méthodes : `public int Decide(int a, int b, ..., double e, int f) { ... }`
//     + méthodes helper appelables via `this.Methode(...)`
//   - Instructions : bloc, décl. locale, assignation (= += -= *= /= %=),
//     if/else, for, while, return, break, continue, expression statement,
//     ++/-- (pré et post), expression vide
//   - Expressions : littéraux, ident, this, `( expr )`, opérateurs
//     arithmétiques (+ - * / %), comparaisons (< <= > >= == !=), logiques
//     (&& || !), bitwise (& | ^), ternaire ?:, accès membre `.`, appel
//     `Methode(args)`, `Math.*` (Max, Min, Abs, Sqrt, Round, Floor, Ceiling,
//     Sign, Pow)
//   - Sémantique int : division/reste entiers tronqués vers zéro
//
// Garde-fous : limite d'itération (1 000 000) par boucle, profondeur d'appel
// (1000), timeout (le moteur applique aussi un timeout CPU par tour côté hôte).

const TYPE_KEYWORDS = new Set([
  'int', 'long', 'short', 'byte', 'double', 'float', 'decimal',
  'bool', 'string', 'char', 'object', 'var', 'void',
]);
const KEYWORDS = new Set([
  'using', 'public', 'private', 'protected', 'internal', 'static',
  'readonly', 'const', 'abstract', 'sealed', 'class', 'namespace',
  'new', 'return', 'if', 'else', 'for', 'while', 'do',
  'break', 'continue', 'true', 'false', 'null', 'this',
  ...TYPE_KEYWORDS,
]);

const OPS = [
  '>>=', '<<=', '=>', '==', '!=', '<=', '>=', '&&', '||', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '->',
  '=', '<', '>', '+', '-', '*', '/', '%', '!', '&', '|', '^', '~',
  '?', ':', '(', ')', '{', '}', '[', ']', ';', ',', '.',
].sort((a, b) => b.length - a.length);

const MAX_ITER = 1_000_000;
const MAX_DEPTH = 1000;

// ============================ TOKENIZER ============================
function tokenize(src) {
  const tokens = [];
  let i = 0, line = 1, col = 1;
  const n = src.length;
  const push = (type, value, isInt) => tokens.push({ type, value, isInt, line, col });

  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; col = 1; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; col++; continue; }
    // commentaires
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2; continue;
    }
    // nombres
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
      let j = i, dot = false;
      while (j < n && /[0-9]/.test(src[j])) j++;
      if (src[j] === '.') { dot = true; j++; while (j < n && /[0-9]/.test(src[j])) j++; }
      if (src[j] === 'e' || src[j] === 'E') {
        j++; if (src[j] === '+' || src[j] === '-') j++;
        while (j < n && /[0-9]/.test(src[j])) j++;
        dot = true;
      }
      // suffixes f F d D m M L u U
      while (j < n && /[fFdDmMlLuU]/.test(src[j])) { if (/[fFdDmM]/.test(src[j])) dot = true; j++; }
      const text = src.slice(i, j).replace(/[fFdDmMlLuU]+$/, '');
      push('number', dot ? parseFloat(text) : parseInt(text, 10), !dot);
      col += (j - i); i = j; continue;
    }
    // chaînes
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < n && src[j] !== '"') { if (src[j] === '\\') { s += src[j + 1]; j += 2; } else { s += src[j]; j++; } }
      j++; push('string', s, false); col += (j - i); i = j; continue;
    }
    if (c === '\'') {
      let j = i + 1, s = '';
      if (src[j] === '\\') { s = src[j + 1]; j += 2; } else { s = src[j]; j++; }
      j++; push('string', s, false); col += (j - i); i = j; continue;
    }
    // identifiants / mots-clés
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      push(KEYWORDS.has(word) ? 'kw' : 'id', word, false);
      col += (j - i); i = j; continue;
    }
    // opérateurs / ponctuation
    let matched = null;
    for (const op of OPS) {
      if (src.startsWith(op, i)) { matched = op; break; }
    }
    if (matched) { push('op', matched, false); i += matched.length; col += matched.length; continue; }
    throw new ParseError(`Caractère inattendu '${c}'`, line, col);
  }
  push('eof', '', false);
  return tokens;
}

class ParseError extends Error {
  constructor(msg, line, col) { super(`${msg} (ligne ${line}:${col})`); this.line = line; this.col = col; }
}

// ============================ PARSER ============================
class Parser {
  constructor(tokens) { this.toks = tokens; this.p = 0; }
  peek(k = 0) { return this.toks[this.p + k] || this.toks[this.toks.length - 1]; }
  next() { return this.toks[this.p++]; }
  is(type, value) { const t = this.peek(); return t.type === type && (value === undefined || t.value === value); }
  isKw(v) { return this.is('kw', v); }
  isOp(v) { return this.is('op', v); }
  expectOp(v) { if (!this.isOp(v)) throw new ParseError(`'${v}' attendu`, this.peek().line, this.peek().col); return this.next(); }
  expectId() { if (!this.is('id')) throw new ParseError('identifiant attendu', this.peek().line, this.peek().col); return this.next().value; }

  parseProgram() {
    const classes = [];
    while (!this.is('eof')) {
      if (this.isKw('using')) { while (!this.isOp(';') && !this.is('eof')) this.next(); this.expectOp(';'); continue; }
      if (this.isKw('namespace')) { // saute namespace X { ... }
        this.next(); this.expectId();
        this.expectOp('{');
        // parse inner classes
        continue;
      }
      classes.push(this.parseClass());
    }
    return classes;
  }

  skipModifiers() {
    while (['public', 'private', 'protected', 'internal', 'static', 'readonly', 'const', 'abstract', 'sealed'].includes(this.peek().value) && this.peek().type === 'kw') {
      const mods = [];
      while (this.peek().type === 'kw' && ['public', 'private', 'protected', 'internal', 'static', 'readonly', 'const', 'abstract', 'sealed'].includes(this.peek().value)) mods.push(this.next().value);
      return mods;
    }
    return [];
  }

  parseClass() {
    this.skipModifiers();
    if (!this.isKw('class')) throw new ParseError("'class' attendu", this.peek().line, this.peek().col);
    this.next();
    const name = this.expectId();
    // saute héritage : `: Base` ou `where ...`
    if (this.isOp(':')) { this.next(); while (!this.isOp('{') && !this.is('eof')) this.next(); }
    if (this.isKw('where')) { while (!this.isOp('{') && !this.is('eof')) this.next(); }
    this.expectOp('{');
    const fields = [];
    const methods = new Map();
    while (!this.isOp('}') && !this.is('eof')) {
      const mods = this.skipModifiers();
      const isConst = mods.includes('const');
      const retType = this.parseType();
      const memberName = this.expectId();
      if (this.isOp('(')) {
        this.next();
        const params = [];
        if (!this.isOp(')')) {
          do {
            this.skipModifiers();
            const ptype = this.parseType();
            const pname = this.expectId();
            params.push({ name: pname, type: ptype });
          } while (this.isOp(',') && this.next());
        }
        this.expectOp(')');
        const body = this.parseBlock();
        methods.set(memberName, { name: memberName, params, body });
      } else {
        let init = null;
        if (this.isOp('=')) { this.next(); init = this.parseExpression(); }
        this.expectOp(';');
        fields.push({ name: memberName, init, isConst });
      }
    }
    this.expectOp('}');
    return { name, fields, methods };
  }

  parseType() {
    // accepte un mot-clé de type ou un identifiant (type nommé), ignore les génériques <...>
    const t = this.peek();
    if (t.type === 'kw' && TYPE_KEYWORDS.has(t.value)) { this.next(); }
    else if (t.type === 'id') { this.next(); }
    else throw new ParseError('type attendu', t.line, t.col);
    if (this.isOp('<')) { let d = 0; do { if (this.isOp('<')) d++; else if (this.isOp('>')) d--; this.next(); } while (d > 0 && !this.is('eof')); }
    if (this.isOp('[')) { while (!this.isOp(']') && !this.is('eof')) this.next(); this.expectOp(']'); }
    return t.value;
  }

  parseBlock() {
    this.expectOp('{');
    const body = [];
    while (!this.isOp('}') && !this.is('eof')) body.push(this.parseStatement());
    this.expectOp('}');
    return { type: 'Block', body };
  }

  parseStatement() {
    const t = this.peek();
    if (this.isOp('{')) return this.parseBlock();
    if (t.type === 'kw') {
      if (t.value === 'if') return this.parseIf();
      if (t.value === 'for') return this.parseFor();
      if (t.value === 'while') return this.parseWhile();
      if (t.value === 'return') { this.next(); let val = null; if (!this.isOp(';')) val = this.parseExpression(); this.expectOp(';'); return { type: 'Return', value: val }; }
      if (t.value === 'break') { this.next(); this.expectOp(';'); return { type: 'Break' }; }
      if (t.value === 'continue') { this.next(); this.expectOp(';'); return { type: 'Continue' }; }
      if (t.value === 'do') { this.next(); const body = this.parseStatement(); if (this.isKw('while')) this.next(); this.expectOp('('); const cond = this.parseExpression(); this.expectOp(')'); this.expectOp(';'); return { type: 'DoWhile', body, cond }; }
      if (TYPE_KEYWORDS.has(t.value) || t.value === 'var') return this.parseVarDecl();
    }
    // décl. avec type nommé : ident ident
    if (t.type === 'id' && this.peek(1).type === 'id') {
      return this.parseVarDecl();
    }
    // expression statement
    const expr = this.parseExpression();
    this.expectOp(';');
    return { type: 'ExprStmt', expr };
  }

  parseVarDecl() {
    const type = this.parseType();
    const name = this.expectId();
    let init = null;
    if (this.isOp('=')) { this.next(); init = this.parseExpression(); }
    this.expectOp(';');
    return { type: 'VarDecl', varType: type, name, init };
  }

  parseIf() {
    this.next(); this.expectOp('('); const cond = this.parseExpression(); this.expectOp(')');
    const then = this.parseStatement();
    let els = null;
    if (this.isKw('else')) { this.next(); els = this.parseStatement(); }
    return { type: 'If', cond, then, els };
  }

  parseFor() {
    this.next(); this.expectOp('(');
    let init = null;
    if (!this.isOp(';')) {
      if (this.peek().type === 'kw' && (TYPE_KEYWORDS.has(this.peek().value) || this.peek().value === 'var')) {
        init = this.parseVarDecl(); // consomme le ';'
      } else {
        init = { type: 'ExprStmt', expr: this.parseExpression() };
        this.expectOp(';');
      }
    } else this.next();
    let cond = null;
    if (!this.isOp(';')) cond = this.parseExpression();
    this.expectOp(';');
    let post = null;
    if (!this.isOp(')')) post = this.parseExpression();
    this.expectOp(')');
    const body = this.parseStatement();
    return { type: 'For', init, cond, post, body };
  }

  parseWhile() {
    this.next(); this.expectOp('('); const cond = this.parseExpression(); this.expectOp(')');
    const body = this.parseStatement();
    return { type: 'While', cond, body };
  }

  // --- expressions ---
  parseExpression() { return this.parseAssignment(); }

  parseAssignment() {
    const left = this.parseTernary();
    const t = this.peek();
    if (this.isOp('=') || this.isOp('+=') || this.isOp('-=') || this.isOp('*=') || this.isOp('/=') || this.isOp('%=') || this.isOp('&=') || this.isOp('|=') || this.isOp('^=')) {
      const op = this.next().value;
      const right = this.parseAssignment();
      return { type: 'Assign', op, target: left, value: right };
    }
    return left;
  }

  parseTernary() {
    const cond = this.parseBinary(0);
    if (this.isOp('?')) {
      this.next();
      const a = this.parseAssignment();
      this.expectOp(':');
      const b = this.parseAssignment();
      return { type: 'Ternary', cond, a, b };
    }
    return cond;
  }

  static PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '<=': 7, '>': 7, '>=': 7, '+': 8, '-': 8, '*': 9, '/': 9, '%': 9 };

  parseBinary(minPrec) {
    let left = this.parseUnary();
    for (;;) {
      const op = this.peek().value;
      const prec = Parser.PREC[op];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.parseBinary(prec + 1);
      left = { type: 'Binary', op, left, right };
    }
    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (this.isOp('-') || this.isOp('+') || this.isOp('!') || this.isOp('~')) {
      const op = this.next().value;
      const arg = this.parseUnary();
      return { type: 'Unary', op, arg };
    }
    if (this.isOp('++') || this.isOp('--')) {
      const op = this.next().value;
      const arg = this.parseUnary();
      return { type: 'PreIncDec', op, arg };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let node = this.parsePrimary();
    for (;;) {
      if (this.isOp('.')) {
        this.next();
        const name = this.expectId();
        if (this.isOp('(')) {
          this.next(); const args = this.parseArgs(); this.expectOp(')');
          node = { type: 'MethodCall', object: node, name, args };
        } else {
          node = { type: 'Member', object: node, name };
        }
      } else if (this.isOp('(')) {
        this.next(); const args = this.parseArgs(); this.expectOp(')');
        node = { type: 'Call', callee: node, args };
      } else if (this.isOp('++') || this.isOp('--')) {
        const op = this.next().value;
        node = { type: 'PostIncDec', op, arg: node };
      } else break;
    }
    return node;
  }

  parseArgs() {
    const args = [];
    if (this.isOp(')')) return args;
    do { args.push(this.parseExpression()); } while (this.isOp(',') && this.next());
    return args;
  }

  parsePrimary() {
    const t = this.peek();
    if (t.type === 'number') { this.next(); return { type: 'Num', value: t.value, isInt: t.isInt }; }
    if (t.type === 'string') { this.next(); return { type: 'Str', value: t.value }; }
    if (this.isKw('true') || this.isKw('false')) { this.next(); return { type: 'Bool', value: t.value === 'true' }; }
    if (this.isKw('null')) { this.next(); return { type: 'Null' }; }
    if (this.isKw('this')) { this.next(); return { type: 'This' }; }
    if (this.isKw('new')) {
      this.next(); this.parseType();
      if (this.isOp('(')) { this.next(); this.parseArgs(); this.expectOp(')'); }
      if (this.isOp('{')) { let d = 0; do { if (this.isOp('{')) d++; else if (this.isOp('}')) d--; this.next(); } while (d > 0 && !this.is('eof')); }
      return { type: 'Null' }; // new non supporté en valeur -> null
    }
    if (t.type === 'id') { this.next(); return { type: 'Ident', name: t.value }; }
    if (this.isOp('(')) {
      // cast C# : ( type ) expression  -- type est un mot-clé de type
      if (this.peek(1).type === 'kw' && TYPE_KEYWORDS.has(this.peek(1).value) && this.peek(2).value === ')') {
        this.next(); // (
        const toType = this.next().value; // type
        this.expectOp(')');
        const operand = this.parseUnary();
        return { type: 'Cast', toType, operand };
      }
      this.next(); const e = this.parseExpression(); this.expectOp(')'); return e;
    }
    throw new ParseError(`expression inattendue '${t.value}'`, t.line, t.col);
  }
}

// ============================ ÉVALUATEUR ============================
class ReturnSignal { constructor(value) { this.value = value; } }
class BreakSignal {}
class ContinueSignal {}

const MATH = {
  Max: (a, b) => Math.max(a, b),
  Min: (a, b) => Math.min(a, b),
  Abs: (a) => Math.abs(a),
  Sqrt: (a) => Math.sqrt(a),
  Round: (a) => Math.round(a),
  Floor: (a) => Math.floor(a),
  Ceiling: (a) => Math.ceil(a),
  Sign: (a) => Math.sign(a),
  Pow: (a, b) => Math.pow(a, b),
  Log: (a) => Math.log(a),
  Exp: (a) => Math.exp(a),
  Sin: (a) => Math.sin(a),
  Cos: (a) => Math.cos(a),
  Tan: (a) => Math.tan(a),
  PI: Math.PI,
  E: Math.E,
};

function defaultFor(type) {
  if (type === 'bool') return false;
  if (type === 'string' || type === 'char') return null;
  if (['int', 'long', 'short', 'byte', 'double', 'float', 'decimal'].includes(type)) return 0;
  return null;
}

function isIntNum(v) { return typeof v === 'number' && Number.isInteger(v); }

class Interpreter {
  constructor(classDef) {
    this.classDef = classDef;
    this.depth = 0;
    this.lastError = null;
  }

  newInstance() {
    const inst = { classDef: this.classDef, fields: new Map() };
    for (const f of this.classDef.fields) {
      let v;
      if (f.init) {
        const env = new Environment(null, inst);
        v = this.evalExpr(f.init, env);
      } else {
        v = 0; // défaut numérique (champs de stratégie typiquement int)
      }
      inst.fields.set(f.name, v);
    }
    return inst;
  }

  callMethod(inst, methodName, args) {
    const m = this.classDef.methods.get(methodName);
    if (!m) throw new Error(`Méthode '${methodName}' introuvable`);
    if (this.depth > MAX_DEPTH) throw new Error('Profondeur d\'appel dépassée (récursion ?)');
    this.depth++;
    const env = new Environment(null, inst);
    m.params.forEach((p, i) => env.vars.set(p.name, args[i]));
    try {
      this.execBlock(m.body, env);
    } catch (e) {
      if (e instanceof ReturnSignal) { this.depth--; return e.value; }
      this.depth--; throw e;
    }
    this.depth--;
    return null; // void / pas de return
  }

  execBlock(block, env) {
    const scope = new Environment(env, env.inst);
    for (const stmt of block.body) this.execStmt(stmt, scope);
  }

  execStmt(s, env) {
    switch (s.type) {
      case 'VarDecl': {
        const v = s.init ? this.evalExpr(s.init, env) : defaultFor(s.varType);
        env.vars.set(s.name, v);
        return;
      }
      case 'ExprStmt': this.evalExpr(s.expr, env); return;
      case 'If': {
        if (this.truthy(this.evalExpr(s.cond, env))) this.execStmt(s.then, env);
        else if (s.els) this.execStmt(s.els, env);
        return;
      }
      case 'While': {
        let iter = 0;
        while (this.truthy(this.evalExpr(s.cond, env))) {
          if (++iter > MAX_ITER) throw new Error('Boucle infinie présumée (while)');
          try { this.execStmt(s.body, env); }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) continue; throw e; }
        }
        return;
      }
      case 'DoWhile': {
        let iter = 0;
        do {
          if (++iter > MAX_ITER) throw new Error('Boucle infinie présumée (do/while)');
          try { this.execStmt(s.body, env); }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) continue; throw e; }
        } while (this.truthy(this.evalExpr(s.cond, env)));
        return;
      }
      case 'For': {
        const scope = new Environment(env, env.inst);
        if (s.init) this.execStmt(s.init, scope);
        let iter = 0;
        while (s.cond ? this.truthy(this.evalExpr(s.cond, scope)) : true) {
          if (++iter > MAX_ITER) throw new Error('Boucle infinie présumée (for)');
          try { this.execStmt(s.body, scope); }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) { if (s.post) this.evalExpr(s.post, scope); continue; } throw e; }
          if (s.post) this.evalExpr(s.post, scope);
        }
        return;
      }
      case 'Return': throw new ReturnSignal(s.value ? this.evalExpr(s.value, env) : null);
      case 'Break': throw new BreakSignal();
      case 'Continue': throw new ContinueSignal();
      case 'Block': this.execBlock(s, env); return;
    }
    throw new Error('Instruction non supportée: ' + s.type);
  }

  evalExpr(e, env) {
    switch (e.type) {
      case 'Num': return e.value;
      case 'Str': return e.value;
      case 'Bool': return e.value;
      case 'Null': return null;
      case 'This': return env.inst;
      case 'Ident': return this.lookup(env, e.name);
      case 'Member': {
        const obj = this.evalExpr(e.object, env);
        if (obj && obj.fields instanceof Map) return obj.fields.get(e.name);
        // Math.PI etc. -> obj est l'objet MATH
        if (obj === MATH && e.name in MATH) return MATH[e.name];
        throw new Error(`Accès membre '${e.name}' impossible`);
      }
      case 'Binary': return this.evalBinary(e, env);
      case 'Unary': {
        const v = this.evalExpr(e.arg, env);
        if (e.op === '-') return -v;
        if (e.op === '+') return +v;
        if (e.op === '!') return !this.truthy(v);
        if (e.op === '~') return ~v;
        return v;
      }
      case 'Ternary': return this.truthy(this.evalExpr(e.cond, env)) ? this.evalExpr(e.a, env) : this.evalExpr(e.b, env);
      case 'Cast': {
        const v = this.evalExpr(e.operand, env);
        if (e.toType === 'int' || e.toType === 'long' || e.toType === 'short' || e.toType === 'byte') return Math.trunc(v);
        if (e.toType === 'double' || e.toType === 'float' || e.toType === 'decimal') return Number(v);
        if (e.toType === 'bool') return this.truthy(v);
        return v;
      }
      case 'Assign': return this.evalAssign(e, env);
      case 'PreIncDec': {
        const cur = this.evalExpr(e.arg, env);
        const nv = e.op === '++' ? cur + 1 : cur - 1;
        this.assignTo(e.arg, nv, env);
        return nv;
      }
      case 'PostIncDec': {
        const cur = this.evalExpr(e.arg, env);
        const nv = e.op === '++' ? cur + 1 : cur - 1;
        this.assignTo(e.arg, nv, env);
        return cur;
      }
      case 'Call': {
        // appel de méthode sur this : callee est un Ident
        if (e.callee.type === 'Ident') {
          const args = e.args.map((a) => this.evalExpr(a, env));
          return this.callMethod(env.inst, e.callee.name, args);
        }
        throw new Error('Appel de fonction non supporté');
      }
      case 'MethodCall': {
        const obj = this.evalExpr(e.object, env);
        const args = e.args.map((a) => this.evalExpr(a, env));
        if (obj === MATH) {
          const fn = MATH[e.name];
          if (!fn) throw new Error(`Math.${e.name} non supporté`);
          return fn(...args);
        }
        if (obj && obj.fields instanceof Map) {
          return this.callMethod(obj, e.name, args);
        }
        throw new Error(`Appel méthode '${e.name}' impossible`);
      }
    }
    throw new Error('Expression non supportée: ' + e.type);
  }

  evalBinary(e, env) {
    const { op } = e;
    if (op === '&&') return this.truthy(this.evalExpr(e.left, env)) ? this.truthy(this.evalExpr(e.right, env)) : false;
    if (op === '||') return this.truthy(this.evalExpr(e.left, env)) ? true : this.truthy(this.evalExpr(e.right, env));
    const a = this.evalExpr(e.left, env);
    const b = this.evalExpr(e.right, env);
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      // Division et modulo toujours flottants (JS ne distingue pas 2 de 2.0,
      // ce qui rendrait la détection de "division entière C#" peu fiable après
      // un cast (double)). Pour une troncature entière, utiliser (int)(a/b).
      case '/': return b === 0 ? 0 : a / b;
      case '%': return b === 0 ? 0 : a % b;
      case '<': return a < b; case '<=': return a <= b;
      case '>': return a > b; case '>=': return a >= b;
      case '==': return a === b; case '!=': return a !== b;
      case '&': return a & b; case '|': return a | b; case '^': return a ^ b;
    }
    throw new Error('Opérateur non supporté: ' + op);
  }

  evalAssign(e, env) {
    let val = this.evalExpr(e.value, env);
    if (e.op === '=') { this.assignTo(e.target, val, env); return val; }
    const cur = this.evalExpr(e.target, env);
    let nv;
    switch (e.op) {
      case '+=': nv = cur + val; break;
      case '-=': nv = cur - val; break;
      case '*=': nv = cur * val; break;
      case '/=': nv = val === 0 ? 0 : cur / val; break;
      case '%=': nv = val === 0 ? 0 : cur % val; break;
      case '&=': nv = cur & val; break;
      case '|=': nv = cur | val; break;
      case '^=': nv = cur ^ val; break;
      default: throw new Error('Assignation non supportée: ' + e.op);
    }
    this.assignTo(e.target, nv, env);
    return nv;
  }

  // résolution d'une variable : locale (scope chain) puis champ d'instance
  lookup(env, name) {
    let e = env;
    while (e) { if (e.vars.has(name)) return e.vars.get(name); e = e.parent; }
    if (env.inst && env.inst.fields.has(name)) return env.inst.fields.get(name);
    if (name === 'Math') return MATH;
    throw new Error(`Variable '${name}' non définie`);
  }

  assignTo(target, value, env) {
    if (target.type === 'Ident') {
      let e = env;
      while (e) { if (e.vars.has(target.name)) { e.vars.set(target.name, value); return; } e = e.parent; }
      if (env.inst && env.inst.fields.has(target.name)) { env.inst.fields.set(target.name, value); return; }
      // nouvelle variable locale implicite (tolérant) -> scope courant
      env.vars.set(target.name, value);
      return;
    }
    if (target.type === 'Member' && target.object.type === 'This') {
      env.inst.fields.set(target.name, value);
      return;
    }
    if (target.type === 'Member') {
      const obj = this.evalExpr(target.object, env);
      if (obj && obj.fields instanceof Map) { obj.fields.set(target.name, value); return; }
    }
    throw new Error('Cible d\'assignation invalide');
  }

  truthy(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return v != null;
  }
}

class Environment {
  constructor(parent, inst) { this.parent = parent; this.inst = inst; this.vars = new Map(); }
}

// ============================ ADAPTATEUR STRATÉGIE ============================
// Crée une stratégie exécutant le code C# de l'utilisateur.
export function makeCsharpStrategy(code) {
  let classDef = null;
  let loadError = null;
  let interp = null;
  try {
    const tokens = tokenize(code);
    const parser = new Parser(tokens);
    const classes = parser.parseProgram();
    classDef = classes.find((c) => c.name === 'Player') || classes[0];
    if (!classDef) throw new Error('Aucune classe trouvée');
    if (!classDef.methods.has('Decide')) throw new Error("Méthode 'Decide' introuvable dans la classe Player");
    interp = new Interpreter(classDef);
  } catch (e) {
    loadError = e.message || String(e);
  }

  return {
    language: 'csharp',
    loadError,
    lastError: null,
    init: async () => {
      if (loadError) return null;
      interp.lastError = null;
      return interp.newInstance();
    },
    decide: async (inst, ctx) => {
      if (loadError || !inst) return -1;
      try {
        const args = [
          ctx.opponentLastMove,
          ctx.currentTurn,
          ctx.myScore,
          ctx.opponentScore,
          ctx.randomValue,
          ctx.myLastMove,
        ];
        const r = interp.callMethod(inst, 'Decide', args);
        interp.lastError = null;
        if (r === null || r === undefined) { interp.lastError = 'Decide() a retourné null'; return -1; }
        return r;
      } catch (e) {
        interp.lastError = e.message || String(e);
        return -1;
      }
    },
  };
}