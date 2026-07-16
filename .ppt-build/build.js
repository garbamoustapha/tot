// PD Arena — The Survival Algorithm
// Générateur de présentation 16:9, palette Ocean Gradient, structure sandwich.
// Source de vérité : docs/PPT-PLAN.md et docs/ARCHITECTURE.md

const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");

// ---------------------------------------------------------------------------
// Palette « Ocean Gradient »
// ---------------------------------------------------------------------------
const C = {
  primary:   "065A82", // deep blue
  secondary: "1C7293", // teal
  accent:    "21295C", // midnight (fonds sombres)
  bgLight:   "F4F7FA", // fond clair contenu
  textDark:  "1A2733", // texte corps
  textMute:  "5B6B78", // texte secondaire
  white:     "FFFFFF",
  card:      "FFFFFF",
  line:      "D9E2EC", // bordures subtiles
  tealSoft:  "E6F0F4", // fond pastel teal
  blueSoft:  "E8EEF4",
  gold:      "E0A458", // accent ponctuel
};

const FONT_H = "Cambria";
const FONT_B = "Calibri";
const FONT_M = "Consolas";

// 16:9 => 10" x 5.625"
const W = 10, H = 5.625;

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "Garba Moustapha";
pres.title  = "PD Arena — The Survival Algorithm";

// ---------------------------------------------------------------------------
// Helpers icônes
// ---------------------------------------------------------------------------
function renderIconSvg(IconComponent, color = "#FFFFFF", size = 256) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color, size: String(size) })
  );
}
async function iconPng(IconComponent, color = "#FFFFFF", size = 256) {
  const svg = renderIconSvg(IconComponent, color, size);
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

// Cercle plein + icône blanche centrée
function iconCircle(slide, x, y, d, png, fillColor) {
  slide.addShape(pres.shapes.OVAL, {
    x, y, w: d, h: d,
    fill: { color: fillColor },
    line: { color: fillColor, width: 0 },
  });
  const pad = d * 0.26;
  slide.addImage({ data: png, x: x + pad, y: y + pad, w: d - 2 * pad, h: d - 2 * pad });
}

// Carte rectangulaire avec barre d'accent verticale à gauche (RECTANGLE)
function card(slide, x, y, w, h, fill, accent) {
  const mkShadow = () => ({ type: "outer", blur: 8, offset: 2, angle: 135, color: "000000", opacity: 0.10 });
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color: fill },
    line: { color: C.line, width: 0.75 },
    shadow: mkShadow(),
  });
  if (accent) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.09, h,
      fill: { color: accent },
      line: { color: accent, width: 0 },
    });
  }
}

// En-tête de section sur fond clair : icône dans cercle + titre
function sectionHeader(slide, png, title, opts = {}) {
  const d = 0.62;
  const x = 0.5, y = 0.42;
  iconCircle(slide, x, y, d, png, opts.iconColor || C.primary);
  slide.addText(title, {
    x: x + d + 0.2, y: y - 0.04, w: W - (x + d + 0.2) - 0.5, h: d + 0.08,
    fontFace: FONT_H, fontSize: opts.size || 28, bold: true,
    color: C.accent, align: "left", valign: "middle", margin: 0,
  });
}

// Pied de page discret sur diapos contenu
function footer(slide, page) {
  slide.addText("PD Arena · The Survival Algorithm", {
    x: 0.5, y: 5.28, w: 5, h: 0.25,
    fontFace: FONT_B, fontSize: 9, color: C.textMute, align: "left", valign: "middle", margin: 0,
  });
  slide.addText(String(page), {
    x: W - 1.0, y: 5.28, w: 0.5, h: 0.25,
    fontFace: FONT_B, fontSize: 9, color: C.textMute, align: "right", valign: "middle", margin: 0,
  });
}

// Petite puce « chip » (pastille arrondie + texte)
function chip(slide, x, y, w, h, text, fill, txtColor) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.12,
    fill: { color: fill }, line: { color: fill, width: 0 },
  });
  slide.addText(text, {
    x, y, w, h, fontFace: FONT_B, fontSize: 11, bold: true,
    color: txtColor, align: "center", valign: "middle", margin: 0,
  });
}

// Liste à puces dans une zone
function bullets(slide, items, x, y, w, h, opts = {}) {
  const arr = items.map((it, i) => {
    const o = { bullet: { code: opts.code || "25AA" }, breakLine: i < items.length - 1, paraSpaceAfter: 6 };
    if (typeof it === "object") { Object.assign(o, it); return { text: it.text, options: o }; }
    return { text: it, options: o };
  });
  slide.addText(arr, {
    x, y, w, h,
    fontFace: FONT_B, fontSize: opts.size || 14, color: opts.color || C.textDark,
    align: "left", valign: "top", margin: 0, lineSpacingMultiple: 1.0,
  });
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
(async () => {
  // Pré-rendu des icônes (blanches pour cercles colorés)
  const ic = {
    trophy:   await iconPng(fa.FaTrophy),
    code:     await iconPng(fa.FaCode),
    bolt:     await iconPng(fa.FaBolt),
    chart:    await iconPng(fa.FaChartLine),
    book:     await iconPng(fa.FaBook),
    hand:     await iconPng(fa.FaHandshake),
    table:    await iconPng(fa.FaTable),
    layers:   await iconPng(fa.FaLayerGroup),
    user:     await iconPng(fa.FaUser),
    globe:    await iconPng(fa.FaGlobe),
    cogs:     await iconPng(fa.FaCogs),
    shield:   await iconPng(fa.FaShieldAlt),
    branch:   await iconPng(fa.FaCodeBranch),
    cubes:    await iconPng(fa.FaCubes),
    flag:     await iconPng(fa.FaFlagCheckered),
    play:     await iconPng(fa.FaPlay),
    users:    await iconPng(fa.FaUsers),
    robot:    await iconPng(fa.FaRobot),
    skull:    await iconPng(fa.FaSkull),
    dice:     await iconPng(fa.FaDice),
    check:    await iconPng(fa.FaCheckCircle),
    server:   await iconPng(fa.FaServer),
    desktop:  await iconPng(fa.FaDesktop),
    clock:    await iconPng(fa.FaClock),
    lock:     await iconPng(fa.FaLock),
    database: await iconPng(fa.FaDatabase),
    network:  await iconPng(fa.FaNetworkWired),
    star:     await iconPng(fa.FaStar),
    flask:    await iconPng(fa.FaFlask),
    eye:      await iconPng(fa.FaEye),
  };
  // Icônes colorées (sur fond clair) pour variantes
  const icColor = {
    coop:  await iconPng(fa.FaHandshake, "#065A82"),
    trait: await iconPng(fa.FaSkull,     "#1C7293"),
    random:await iconPng(fa.FaDice,      "#21295C"),
  };

  // =========================================================================
  // SLIDE 1 — Couverture / Titre (fond sombre)
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.accent };
    // Grand cercle décoratif à droite avec trophée
    const cd = 2.5, cx = 6.95, cy = 1.55;
    s.addShape(pres.shapes.OVAL, {
      x: cx, y: cy, w: cd, h: cd,
      fill: { color: C.primary }, line: { color: C.secondary, width: 1.5 },
    });
    const pad = cd * 0.26;
    s.addImage({ data: ic.trophy, x: cx + pad, y: cy + pad, w: cd - 2 * pad, h: cd - 2 * pad });

    // Barre d'accent verticale à gauche
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.6, y: 1.5, w: 0.09, h: 2.1, fill: { color: C.gold }, line: { color: C.gold, width: 0 },
    });

    // Eyebrow
    s.addText("CODE-BATTLE PLATFORM", {
      x: 0.85, y: 1.45, w: 6, h: 0.35,
      fontFace: FONT_B, fontSize: 13, bold: true, color: C.gold,
      align: "left", valign: "middle", margin: 0, charSpacing: 4,
    });
    // Titre
    s.addText("PD Arena", {
      x: 0.8, y: 1.85, w: 6.2, h: 1.0,
      fontFace: FONT_H, fontSize: 54, bold: true, color: C.white,
      align: "left", valign: "middle", margin: 0,
    });
    // Sous-titre
    s.addText("The Survival Algorithm — Dilemme du Prisonnier Itéré", {
      x: 0.85, y: 3.0, w: 6.0, h: 0.55,
      fontFace: FONT_H, fontSize: 19, italic: true, color: "CADCFC",
      align: "left", valign: "middle", margin: 0,
    });
    // Tagline
    s.addText("Inspiré des tournois d'Axelrod  ·  C# & Python  ·  Solo + Multijoueur", {
      x: 0.85, y: 3.6, w: 6.0, h: 0.4,
      fontFace: FONT_B, fontSize: 13, color: "9FB3C8",
      align: "left", valign: "middle", margin: 0,
    });
    // Auteur / date
    s.addText("Garba Moustapha  ·  Juillet 2026", {
      x: 0.85, y: 4.75, w: 6, h: 0.35,
      fontFace: FONT_B, fontSize: 12, color: "8FA3B8",
      align: "left", valign: "middle", margin: 0,
    });
  }

  // =========================================================================
  // SLIDE 2 — Le concept en une diapo
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    sectionHeader(s, ic.code, "Le concept en une diapo");

    // Pitch
    s.addText("« Programme ta stratégie, entre dans l'arène, affronte tous les algorithmes. »", {
      x: 0.7, y: 1.3, w: 8.6, h: 0.6,
      fontFace: FONT_H, fontSize: 18, italic: true, color: C.secondary,
      align: "center", valign: "middle", margin: 0,
    });

    // 3 piliers
    const pillars = [
      { icon: ic.code,  title: "Coder",      desc: "Édite ta stratégie en C# ou Python", color: C.primary },
      { icon: ic.bolt,  title: "Combattre",  desc: "Round-robin contre tous les algorithmes", color: C.secondary },
      { icon: ic.chart, title: "Visualiser", desc: "Suivi tour par tour, scores cumulés", color: C.accent },
    ];
    const cw = 2.78, gap = 0.33, total = 3 * cw + 2 * gap;
    const x0 = (W - total) / 2;
    const cy = 2.15, ch = 2.55;
    pillars.forEach((p, i) => {
      const x = x0 + i * (cw + gap);
      card(s, x, cy, cw, ch, C.card, p.color);
      iconCircle(s, x + (cw - 1.0) / 2, cy + 0.28, 1.0, p.icon, p.color);
      s.addText(p.title, {
        x: x + 0.15, y: cy + 1.42, w: cw - 0.3, h: 0.4,
        fontFace: FONT_H, fontSize: 20, bold: true, color: C.accent,
        align: "center", valign: "middle", margin: 0,
      });
      s.addText(p.desc, {
        x: x + 0.2, y: cy + 1.85, w: cw - 0.4, h: 0.6,
        fontFace: FONT_B, fontSize: 13, color: C.textMute,
        align: "center", valign: "top", margin: 0,
      });
    });
    footer(s, 2);
  }

  // =========================================================================
  // SLIDE 3 — Contexte historique — Axelrod & TourExec
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    sectionHeader(s, ic.book, "Contexte historique — Axelrod & TourExec");

    // Colonne gauche : texte
    bullets(s, [
      "Origine : tournois de Robert Axelrod (The Complexity of Cooperation).",
      "TourExec = logiciel original en Fortran → source de vérité du contrat.",
      "Invariants historiques repris tels quels : signature, gains, longueurs.",
      "L'état interne d'une stratégie persiste d'un tour à l'autre.",
    ], 0.6, 1.45, 5.4, 2.7, { size: 14 });

    // Carte droite
    const rx = 6.2, ry = 1.45, rw = 3.3, rh = 3.1;
    card(s, rx, ry, rw, rh, C.card, C.secondary);
    s.addText("TourExec (Fortran)", {
      x: rx + 0.25, y: ry + 0.18, w: rw - 0.4, h: 0.4,
      fontFace: FONT_H, fontSize: 16, bold: true, color: C.accent, align: "left", valign: "middle", margin: 0,
    });
    s.addText("Référence du contrat d'exécution", {
      x: rx + 0.25, y: ry + 0.58, w: rw - 0.4, h: 0.35,
      fontFace: FONT_B, fontSize: 12, italic: true, color: C.secondary, align: "left", valign: "middle", margin: 0,
    });
    // Stat callout
    s.addText("63", {
      x: rx + 0.25, y: ry + 1.05, w: rw - 0.4, h: 0.7,
      fontFace: FONT_H, fontSize: 40, bold: true, color: C.primary, align: "left", valign: "middle", margin: 0,
    });
    s.addText("stratégies du 2ᵉ tournoi d'Axelrod", {
      x: rx + 0.25, y: ry + 1.78, w: rw - 0.4, h: 0.5,
      fontFace: FONT_B, fontSize: 12, color: C.textMute, align: "left", valign: "top", margin: 0,
    });
    s.addText("Invariants : signature · matrice · longueurs de manches", {
      x: rx + 0.25, y: ry + 2.4, w: rw - 0.4, h: 0.6,
      fontFace: FONT_B, fontSize: 11, color: C.textDark, align: "left", valign: "top", margin: 0,
    });
    footer(s, 3);
  }

  // =========================================================================
  // SLIDE 4 — Le contrat d'exécution (signature)
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    sectionHeader(s, ic.hand, "Le contrat d'exécution");

    // Bloc code sombre
    const bx = 0.7, by = 1.5, bw = 8.6, bh = 1.55;
    s.addShape(pres.shapes.RECTANGLE, {
      x: bx, y: by, w: bw, h: bh,
      fill: { color: C.accent }, line: { color: C.accent, width: 0 },
      shadow: { type: "outer", blur: 8, offset: 2, angle: 135, color: "000000", opacity: 0.12 },
    });
    s.addText([
      { text: "ENTRÉES   ", options: { color: C.gold, bold: true } },
      { text: "opponent_last_move · current_turn · my_score", options: { color: C.white, breakLine: true } },
      { text: "          ", options: {} },
      { text: "opponent_score · random_value · my_last_move", options: { color: C.white, breakLine: true } },
      { text: "SORTIE    ", options: { color: C.gold, bold: true } },
      { text: "→ 0 | 1     ", options: { color: C.white } },
      { text: "(0 = Coopérer, 1 = Trahir)", options: { color: "9FB3C8", italic: true } },
    ], {
      x: bx + 0.25, y: by + 0.18, w: bw - 0.5, h: bh - 0.36,
      fontFace: FONT_M, fontSize: 14, align: "left", valign: "top", margin: 0, lineSpacingMultiple: 1.15,
    });

    // Deux cartes sous le bloc
    const cy2 = 3.35, ch2 = 1.55, gap = 0.3, cw2 = (8.6 - gap) / 2;
    card(s, 0.7, cy2, cw2, ch2, C.card, C.primary);
    s.addText("Règle du tour 1", {
      x: 0.95, y: cy2 + 0.18, w: cw2 - 0.4, h: 0.35,
      fontFace: FONT_H, fontSize: 15, bold: true, color: C.accent, align: "left", valign: "middle", margin: 0,
    });
    s.addText("Coups absents → -1. Une stratégie « nice » (TFT) coopère par défaut au premier tour.", {
      x: 0.95, y: cy2 + 0.58, w: cw2 - 0.4, h: 0.85,
      fontFace: FONT_B, fontSize: 12.5, color: C.textDark, align: "left", valign: "top", margin: 0,
    });

    card(s, 0.7 + cw2 + gap, cy2, cw2, ch2, C.card, C.secondary);
    s.addText("État géré par le runner", {
      x: 0.95 + cw2 + gap, y: cy2 + 0.18, w: cw2 - 0.4, h: 0.35,
      fontFace: FONT_H, fontSize: 15, bold: true, color: C.accent, align: "left", valign: "middle", margin: 0,
    });
    s.addText("Instance de stratégie réutilisée tour après tour : la fonction est rappelée sur la même instance stateful.", {
      x: 0.95 + cw2 + gap, y: cy2 + 0.58, w: cw2 - 0.4, h: 0.85,
      fontFace: FONT_B, fontSize: 12.5, color: C.textDark, align: "left", valign: "top", margin: 0,
    });
    footer(s, 4);
  }

  // =========================================================================
  // SLIDE 5 — La matrice de gain (T,R,P,S)
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    sectionHeader(s, ic.table, "La matrice de gain (T, R, P, S)");

    // Tableau à gauche
    const header = [
      { text: "Joueur \\ Adv.", options: { fill: { color: C.accent }, color: C.white, bold: true, align: "center", valign: "middle" } },
      { text: "Coopère (0)",  options: { fill: { color: C.accent }, color: C.white, bold: true, align: "center", valign: "middle" } },
      { text: "Trahit (1)",   options: { fill: { color: C.accent }, color: C.white, bold: true, align: "center", valign: "middle" } },
    ];
    const row = (a, b, c, fill) => [
      { text: a, options: { fill: { color: fill }, color: C.accent, bold: true, align: "center", valign: "middle" } },
      { text: b, options: { fill: { color: C.white }, color: C.textDark, align: "center", valign: "middle" } },
      { text: c, options: { fill: { color: C.white }, color: C.textDark, align: "center", valign: "middle" } },
    ];
    const rows = [
      header,
      row("Coopère (0)", "R = 3 / R = 3", "S = 0 / T = 5", C.tealSoft),
      row("Trahit (1)",  "T = 5 / S = 0", "P = 1 / P = 1", C.blueSoft),
    ];
    s.addTable(rows, {
      x: 0.6, y: 1.6, w: 5.0, colW: [1.7, 1.65, 1.65],
      rowH: 0.62, fontFace: FONT_B, fontSize: 13,
      border: { type: "solid", pt: 1, color: C.line },
      valign: "middle",
    });

    // Stats à droite
    const rx = 5.85, ry = 1.6;
    const stats = [
      { v: "T = 5", l: "Tentation — seul je trahis", c: C.primary },
      { v: "R = 3", l: "Récompense — coopération mutuelle", c: C.secondary },
      { v: "P = 1", l: "Punition — trahison mutuelle", c: C.accent },
      { v: "S = 0", l: "Sucker — je coopère, l'autre trahit", c: C.gold },
    ];
    stats.forEach((st, i) => {
      const y = ry + i * 0.72;
      s.addText(st.v, {
        x: rx, y, w: 1.45, h: 0.6,
        fontFace: FONT_H, fontSize: 24, bold: true, color: st.c, align: "left", valign: "middle", margin: 0,
      });
      s.addText(st.l, {
        x: rx + 1.5, y, w: 2.15, h: 0.6,
        fontFace: FONT_B, fontSize: 11.5, color: C.textDark, align: "left", valign: "middle", margin: 0,
      });
    });

    // Propriété
    card(s, 0.6, 4.35, 8.8, 0.78, C.tealSoft, C.secondary);
    s.addText("T > R > P > S   et   2R > T+S   ⇒   la coopération mutuelle est l'optimum de Pareto répété.", {
      x: 0.85, y: 4.35, w: 8.3, h: 0.78,
      fontFace: FONT_B, fontSize: 13.5, bold: true, color: C.accent, align: "left", valign: "middle", margin: 0,
    });
    footer(s, 5);
  }

  // =========================================================================
  // SLIDE 6 — Architecture globale
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    sectionHeader(s, ic.layers, "Architecture globale");

    const layers = [
      { icon: ic.desktop, name: "Frontend (SPA)",     color: C.primary,
        items: ["Monaco Editor (C# / Python)", "Chart.js + p5.js — visualisation live", "Arène Solo · Hall des Challenges"] },
      { icon: ic.server, name: "Backend (ASP.NET Core 9)", color: C.secondary,
        items: ["SignalR /arenaHub — évènements temps réel", "CRUD stratégies · leaderboard · matchmaker", "Persistance JSON"] },
      { icon: ic.cogs, name: "Exécution",            color: C.accent,
        items: ["Moteur de tournoi (DPI, round-robin)", "Roslyn (C#) · Pyodide (Python Wasm)", "Sandbox + timeout par tour"] },
    ];
    const lx = 0.6, lw = 8.8;
    const ly = 1.4, lh = 1.04, gap = 0.15;
    layers.forEach((l, i) => {
      const y = ly + i * (lh + gap);
      card(s, lx, y, lw, lh, C.card, l.color);
      iconCircle(s, lx + 0.22, y + (lh - 0.68) / 2, 0.68, l.icon, l.color);
      s.addText(l.name, {
        x: lx + 1.1, y: y + 0.1, w: 3.4, h: 0.38,
        fontFace: FONT_H, fontSize: 15, bold: true, color: C.accent, align: "left", valign: "middle", margin: 0,
      });
      s.addText(l.items.join("   ·   "), {
        x: lx + 1.1, y: y + 0.5, w: lw - 1.35, h: 0.48,
        fontFace: FONT_B, fontSize: 11.5, color: C.textDark,
        align: "left", valign: "middle", margin: 0,
      });
    });

    // Bande bas : modes
    s.addText([
      { text: "Solo = exécution côté client (Wasm / interpréteur)   ·   ", options: { color: C.textDark, bold: true } },
      { text: "Arène = exécution serveur   ·   ", options: { color: C.textDark, bold: true } },
      { text: "Flux : REST + SignalR (temps réel)", options: { color: C.secondary, italic: true } },
    ], {
      x: 0.6, y: 4.92, w: 8.8, h: 0.3,
      fontFace: FONT_B, fontSize: 12, align: "left", valign: "middle", margin: 0,
    });
    footer(s, 6);
  }

  // =========================================================================
  // SLIDE 7 — Le mode Solo — arène d'entraînement
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    sectionHeader(s, ic.user, "Le mode Solo — arène d'entraînement");

    bullets(s, [
      "Éditeur Monaco — code ta stratégie en C# ou Python.",
      "Round-robin contre les 19 stratégies builtin, 5 longueurs, self-play inclus.",
      "Classement live progressif (rang 1 → dernier, score moyen / tour).",
      "Trois vues : Classement · Duels · Algorithmes (codex).",
    ], 0.6, 1.5, 5.6, 3.2, { size: 14 });

    // Stats à droite
    const sx = 6.5, sy = 1.55, sw = 3.0, sh = 1.0, sgap = 0.18;
    const stats = [
      { v: "19", l: "stratégies builtin", icon: ic.robot },
      { v: "5",  l: "longueurs de manche", icon: ic.clock },
      { v: "3",  l: "vues de l'arène",     icon: ic.eye },
    ];
    stats.forEach((st, i) => {
      const y = sy + i * (sh + sgap);
      card(s, sx, y, sw, sh, C.card, C.primary);
      s.addText(st.v, {
        x: sx + 0.2, y, w: 1.2, h: sh,
        fontFace: FONT_H, fontSize: 38, bold: true, color: C.primary, align: "left", valign: "middle", margin: 0,
      });
      s.addText(st.l, {
        x: sx + 1.45, y, w: sw - 1.6, h: sh,
        fontFace: FONT_B, fontSize: 12.5, color: C.textDark, align: "left", valign: "middle", margin: 0,
      });
    });
    footer(s, 7);
  }

  // =========================================================================
  // SLIDE 8 — Le mode Arène — multijoueur en ligne
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    sectionHeader(s, ic.globe, "Le mode Arène — multijoueur en ligne");

    bullets(s, [
      "Backend ASP.NET Core 9 + SignalR (/arenaHub).",
      "Soumission : 1 stratégie / joueur, compilée via Roslyn (filtre des tokens interdits).",
      "Tournoi périodique — BackgroundService, horaire par défaut.",
      "Évènements temps réel émis aux clients connectés.",
    ], 0.6, 1.5, 8.8, 1.9, { size: 14 });

    // Flux d'évènements
    s.addText("Flux d'évènements temps réel", {
      x: 0.6, y: 3.5, w: 8.8, h: 0.3,
      fontFace: FONT_H, fontSize: 14, bold: true, color: C.accent, align: "left", valign: "middle", margin: 0,
    });
    const evts = ["Countdown", "Start", "Progress", "Leaderboard", "Duels"];
    const ew = 1.62, egap = 0.22, etotal = 5 * ew + 4 * egap;
    const ex0 = (W - etotal) / 2;
    const ey = 3.95, eh = 0.62;
    evts.forEach((e, i) => {
      const x = ex0 + i * (ew + egap);
      const col = i % 2 === 0 ? C.primary : C.secondary;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y: ey, w: ew, h: eh, rectRadius: 0.1,
        fill: { color: col }, line: { color: col, width: 0 },
        shadow: { type: "outer", blur: 6, offset: 2, angle: 135, color: "000000", opacity: 0.1 },
      });
      s.addText(e, {
        x, y: ey, w: ew, h: eh, fontFace: FONT_B, fontSize: 13, bold: true, color: C.white,
        align: "center", valign: "middle", margin: 0,
      });
      // Flèche entre les pastilles
      if (i < evts.length - 1) {
        s.addText("›", {
          x: x + ew, y: ey, w: egap, h: eh, fontFace: FONT_H, fontSize: 22, bold: true,
          color: C.gold, align: "center", valign: "middle", margin: 0,
        });
      }
    });
    footer(s, 8);
  }

  // =========================================================================
  // SLIDE 9 — Le moteur de tournoi
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    sectionHeader(s, ic.cogs, "Le moteur de tournoi");

    // Carte gauche : boucle de match
    const lx = 0.6, ly = 1.5, lw = 4.35, lh = 3.5;
    card(s, lx, ly, lw, lh, C.card, C.primary);
    s.addText("Boucle de match", {
      x: lx + 0.25, y: ly + 0.18, w: lw - 0.4, h: 0.4,
      fontFace: FONT_H, fontSize: 16, bold: true, color: C.accent, align: "left", valign: "middle", margin: 0,
    });
    bullets(s, [
      "Instance fraîche par match (état vierge).",
      "Sanitize des coups : 0/1, sinon coup forfait.",
      "Payoff via la matrice T,R,P,S.",
      "Journalisation tour par tour (score, coups).",
    ], lx + 0.25, ly + 0.65, lw - 0.45, lh - 0.8, { size: 13 });

    // Carte droite : robustesse
    const rx = 5.15, ry = 1.5, rw = 4.25, rh = 3.5;
    card(s, rx, ry, rw, rh, C.card, C.secondary);
    s.addText("Robustesse & reproductibilité", {
      x: rx + 0.25, y: ry + 0.18, w: rw - 0.4, h: 0.4,
      fontFace: FONT_H, fontSize: 16, bold: true, color: C.accent, align: "left", valign: "middle", margin: 0,
    });
    // 5 longueurs en chips
    s.addText("5 longueurs de manche (Axelrod masquait la longueur)", {
      x: rx + 0.25, y: ry + 0.62, w: rw - 0.4, h: 0.3,
      fontFace: FONT_B, fontSize: 11.5, italic: true, color: C.textMute, align: "left", valign: "middle", margin: 0,
    });
    const lengths = ["63", "77", "151", "156", "308"];
    const cw2 = 0.66, cg = 0.13;
    const lx0 = rx + 0.25;
    lengths.forEach((v, i) => {
      chip(s, lx0 + i * (cw2 + cg), ry + 0.98, cw2, 0.42, v, C.accent, C.white);
    });
    bullets(s, [
      "Round-robin + self-play (robustesse face à un clone).",
      "Score retenu = moyenne par tour sur l'ensemble des duels.",
      "Graine RNG par match, journalisée.",
      "Hash SHA-256 des codes (anti-triche, reproductibilité).",
    ], rx + 0.25, ry + 1.55, rw - 0.45, rh - 1.7, { size: 13 });
    footer(s, 9);
  }

  // =========================================================================
  // SLIDE 10 — Visualisation & simulation
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    sectionHeader(s, ic.chart, "Visualisation & simulation");

    bullets(s, [
      "p5.js : jetons C / D animés, scores cumulés, frise des coups, badge T/R/P/S.",
      "Match reproductible — PRNG mulberry32 seedé.",
      "Rejeu serveur (/api/replay) : tout duel animable, source non exposée.",
      "Contrôles : play / pause, vitesse, longueur, graine.",
    ], 0.6, 1.5, 5.7, 3.2, { size: 14 });

    // Carte droite : aperçu stylisé
    const rx = 6.6, ry = 1.55, rw = 2.9, rh = 3.2;
    card(s, rx, ry, rw, rh, C.accent, C.gold);
    iconCircle(s, rx + (rw - 0.9) / 2, ry + 0.3, 0.9, ic.play, C.gold);
    s.addText("Rejeu animé", {
      x: rx + 0.15, y: ry + 1.35, w: rw - 0.3, h: 0.4,
      fontFace: FONT_H, fontSize: 17, bold: true, color: C.white, align: "center", valign: "middle", margin: 0,
    });
    s.addText("tour par tour", {
      x: rx + 0.15, y: ry + 1.75, w: rw - 0.3, h: 0.35,
      fontFace: FONT_B, fontSize: 12, italic: true, color: "CADCFC", align: "center", valign: "middle", margin: 0,
    });
    // Mini badges T/R/P/S
    const badges = [["C", C.secondary], ["D", C.gold], ["C", C.secondary], ["D", C.gold]];
    const bw = 0.5, bg = 0.12, btotal = 4 * bw + 3 * bg;
    const bx0 = rx + (rw - btotal) / 2;
    badges.forEach((b, i) => {
      s.addShape(pres.shapes.OVAL, {
        x: bx0 + i * (bw + bg), y: ry + 2.3, w: bw, h: bw,
        fill: { color: b[1] }, line: { color: b[1], width: 0 },
      });
      s.addText(b[0], {
        x: bx0 + i * (bw + bg), y: ry + 2.3, w: bw, h: bw, fontFace: FONT_B, fontSize: 12, bold: true,
        color: C.white, align: "center", valign: "middle", margin: 0,
      });
    });
    s.addText("Graine · Vitesse · Longueur", {
      x: rx + 0.15, y: ry + 2.7, w: rw - 0.3, h: 0.4,
      fontFace: FONT_B, fontSize: 10.5, color: "9FB3C8", align: "center", valign: "middle", margin: 0,
    });
    footer(s, 10);
  }

  // =========================================================================
  // SLIDE 11 — Sécurité — sandboxing du code utilisateur
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    sectionHeader(s, ic.shield, "Sécurité — sandboxing du code utilisateur");

    s.addText("Menaces : boucles infinies · réseau · système de fichiers · mémoire.", {
      x: 0.6, y: 1.3, w: 8.8, h: 0.35,
      fontFace: FONT_B, fontSize: 13, italic: true, color: C.textMute, align: "left", valign: "middle", margin: 0,
    });

    const cw2 = 4.3, ch2 = 2.35, gap = 0.3, cy = 1.8;
    // Serveur
    card(s, 0.6, cy, cw2, ch2, C.card, C.primary);
    iconCircle(s, 0.85, cy + 0.25, 0.7, ic.server, C.primary);
    s.addText("Serveur (Arène)", {
      x: 1.7, y: cy + 0.28, w: cw2 - 1.2, h: 0.6,
      fontFace: FONT_H, fontSize: 16, bold: true, color: C.accent, align: "left", valign: "middle", margin: 0,
    });
    bullets(s, [
      "Roslyn + filtre source (System.Net / IO / Reflection / Threading…).",
      "ALC collectible — déchargement du code.",
      "Timeout CPU par tour.",
    ], 0.85, cy + 1.05, cw2 - 0.5, ch2 - 1.2, { size: 12.5 });

    // Client
    card(s, 0.6 + cw2 + gap, cy, cw2, ch2, C.card, C.secondary);
    iconCircle(s, 0.85 + cw2 + gap, cy + 0.25, 0.7, ic.desktop, C.secondary);
    s.addText("Client (Solo)", {
      x: 1.7 + cw2 + gap, y: cy + 0.28, w: cw2 - 1.2, h: 0.6,
      fontFace: FONT_H, fontSize: 16, bold: true, color: C.accent, align: "left", valign: "middle", margin: 0,
    });
    bullets(s, [
      "Pyodide (Wasm) — Python dans le navigateur.",
      "Interpréteur C# maison (sous-ensemble).",
      "Le code ne quitte jamais le navigateur.",
    ], 0.85 + cw2 + gap, cy + 1.05, cw2 - 0.5, ch2 - 1.2, { size: 12.5 });

    // Bande filet ultime
    card(s, 0.6, 4.3, 8.8, 0.68, C.tealSoft, C.gold);
    s.addText([
      { text: "Filet ultime : ", options: { bold: true, color: C.accent } },
      { text: "validation statique de signature + timeout CPU par tour.", options: { color: C.textDark } },
    ], {
      x: 0.85, y: 4.3, w: 8.3, h: 0.68, fontFace: FONT_B, fontSize: 13, align: "left", valign: "middle", margin: 0,
    });
    footer(s, 11);
  }

  // =========================================================================
  // SLIDE 12 — Les 19 stratégies builtin (codex)
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    sectionHeader(s, ic.branch, "Les 19 stratégies builtin (codex)");

    // Grand stat à droite
    const sx = 7.55, sy = 1.5, sw = 1.95, sh = 1.95;
    s.addShape(pres.shapes.OVAL, {
      x: sx, y: sy, w: sw, h: sh, fill: { color: C.primary }, line: { color: C.secondary, width: 1.5 },
    });
    s.addText("19", {
      x: sx, y: sy, w: sw, h: sh, fontFace: FONT_H, fontSize: 56, bold: true, color: C.white,
      align: "center", valign: "middle", margin: 0,
    });
    s.addText("stratégies", {
      x: sx, y: sy + sh + 0.05, w: sw, h: 0.3, fontFace: FONT_B, fontSize: 12, color: C.textMute,
      align: "center", valign: "middle", margin: 0,
    });

    // 3 familles à gauche
    const fams = [
      { icon: icColor.coop,   title: "Coopératifs",  color: C.primary,
        items: ["TFT · TF2T · Pavlov · AlwaysC"], },
      { icon: icColor.trait,  title: "Traîtres",     color: C.secondary,
        items: ["Grim · AlwaysD · Tester · Joss"], },
      { icon: icColor.random, title: "Aléatoires",   color: C.accent,
        items: ["Random · noisy"], },
    ];
    const fx = 0.6, fw = 6.7, fh = 0.88, fgap = 0.14, fy0 = 1.45;
    fams.forEach((f, i) => {
      const y = fy0 + i * (fh + fgap);
      card(s, fx, y, fw, fh, C.card, f.color);
      iconCircle(s, fx + 0.2, y + (fh - 0.62) / 2, 0.62, f.icon, f.color);
      s.addText(f.title, {
        x: fx + 0.95, y: y + 0.1, w: 1.7, h: 0.35,
        fontFace: FONT_H, fontSize: 15, bold: true, color: C.accent, align: "left", valign: "middle", margin: 0,
      });
      s.addText(f.items[0], {
        x: fx + 0.95, y: y + 0.46, w: fw - 1.1, h: 0.4,
        fontFace: FONT_B, fontSize: 12.5, color: C.textDark, align: "left", valign: "middle", margin: 0,
      });
    });

    // Ports historiques
    card(s, 0.6, 4.5, 6.7, 0.68, C.tealSoft, C.gold);
    s.addText([
      { text: "Ports historiques : ", options: { bold: true, color: C.accent } },
      { text: "k42r (Borufsen) · Champion · Graaskamp (k60r) · Dawes & Batell (k80r)", options: { color: C.textDark } },
    ], {
      x: 0.85, y: 4.5, w: 6.2, h: 0.68, fontFace: FONT_B, fontSize: 12, align: "left", valign: "middle", margin: 0,
    });
    footer(s, 12);
  }

  // =========================================================================
  // SLIDE 13 — Stack technique & livrables
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.bgLight };
    sectionHeader(s, ic.cubes, "Stack technique & livrables");

    const cards = [
      { icon: ic.desktop, title: "Frontend",   color: C.primary,
        items: ["HTML / JS — site statique", "Monaco · Chart.js · p5.js", "Coloration C# & Python"] },
      { icon: ic.server, title: "Backend",    color: C.secondary,
        items: ["ASP.NET Core 9 + SignalR", "Roslyn (compilation C#)", "Persistance JSON"] },
      { icon: ic.check, title: "Tests",       color: C.accent,
        items: ["REST : 11 / 11 ✓", "SignalR : 49 / 49 ✓", "Navigateur : 0 pageerror"] },
    ];
    const cw = 2.78, gap = 0.33, total = 3 * cw + 2 * gap;
    const x0 = (W - total) / 2;
    const cy = 1.55, ch = 2.6;
    cards.forEach((c, i) => {
      const x = x0 + i * (cw + gap);
      card(s, x, cy, cw, ch, C.card, c.color);
      iconCircle(s, x + (cw - 0.9) / 2, cy + 0.25, 0.9, c.icon, c.color);
      s.addText(c.title, {
        x: x + 0.15, y: cy + 1.28, w: cw - 0.3, h: 0.4,
        fontFace: FONT_H, fontSize: 18, bold: true, color: C.accent, align: "center", valign: "middle", margin: 0,
      });
      bullets(s, c.items, x + 0.25, cy + 1.72, cw - 0.5, 0.8, { size: 12 });
    });

    // Référence
    s.addText([
      { text: "Référence : ", options: { bold: true, color: C.accent } },
      { text: "TourExec (Fortran) · docs/ARCHITECTURE.md · docs/arena.html", options: { color: C.textMute, italic: true } },
    ], {
      x: 0.6, y: 4.4, w: 8.8, h: 0.4, fontFace: FONT_B, fontSize: 12.5, align: "center", valign: "middle", margin: 0,
    });
    footer(s, 13);
  }

  // =========================================================================
  // SLIDE 14 — Conclusion & perspectives (fond sombre)
  // =========================================================================
  {
    const s = pres.addSlide();
    s.background = { color: C.accent };
    // En-tête sombre
    const d = 0.62, hx = 0.6, hy = 0.5;
    iconCircle(s, hx, hy, d, ic.flag, C.gold);
    s.addText("Conclusion & perspectives", {
      x: hx + d + 0.2, y: hy - 0.04, w: W - (hx + d + 0.2) - 0.5, h: d + 0.08,
      fontFace: FONT_H, fontSize: 28, bold: true, color: C.white, align: "left", valign: "middle", margin: 0,
    });

    // Récap
    s.addText("Une plateforme qui rend le Dilemme du Prisonnier Itéré tangible et jouable.", {
      x: 0.7, y: 1.5, w: 8.6, h: 0.6,
      fontFace: FONT_H, fontSize: 18, italic: true, color: "CADCFC", align: "left", valign: "middle", margin: 0,
    });

    // Perspectives chips
    s.addText("Suites possibles", {
      x: 0.7, y: 2.25, w: 8, h: 0.3,
      fontFace: FONT_B, fontSize: 12, bold: true, color: C.gold, align: "left", valign: "middle", margin: 0, charSpacing: 2,
    });
    const persp = ["Auth / JWT", "PostgreSQL + Redis", "Conteneurs gVisor", "Matchmaker"];
    const pw = 2.05, pgap = 0.22, ptotal = 4 * pw + 3 * pgap;
    const px0 = (W - ptotal) / 2;
    const py = 2.65, ph = 0.55;
    persp.forEach((p, i) => {
      const x = px0 + i * (pw + pgap);
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x, y: py, w: pw, h: ph, rectRadius: 0.12,
        fill: { color: C.primary }, line: { color: C.secondary, width: 1 },
      });
      s.addText(p, {
        x, y: py, w: pw, h: ph, fontFace: FONT_B, fontSize: 13, bold: true, color: C.white,
        align: "center", valign: "middle", margin: 0,
      });
    });

    // Lever de rideau
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.7, y: 3.7, w: 0.09, h: 0.95, fill: { color: C.gold }, line: { color: C.gold, width: 0 },
    });
    s.addText("Que la meilleure stratégie gagne.", {
      x: 0.95, y: 3.7, w: 8.3, h: 0.95,
      fontFace: FONT_H, fontSize: 30, bold: true, italic: true, color: C.white, align: "left", valign: "middle", margin: 0,
    });

    // Footer sombre
    s.addText("Garba Moustapha  ·  Juillet 2026  ·  PD Arena", {
      x: 0.7, y: 5.05, w: 8.6, h: 0.35,
      fontFace: FONT_B, fontSize: 11, color: "8FA3B8", align: "left", valign: "middle", margin: 0,
    });
  }

  await pres.writeFile({ fileName: "D:/tot/The_Survival_Algorithm.pptx" });
  console.log("OK — The_Survival_Algorithm.pptx généré (14 diapos).");
})().catch(e => { console.error(e); process.exit(1); });