/* CAR CARE VALU — Tweaks-Panel (nur Startseite) */
(function () {
  "use strict";

  var KEY = "ccv_tweaks_v1";
  var std = { palette: "sand", ansprache: "du", auftritt: "ruhig", panel: false };
  var cfg = {};
  try { cfg = Object.assign({}, std, JSON.parse(localStorage.getItem(KEY) || "{}")); }
  catch (e) { cfg = Object.assign({}, std); }

  /* ---------- Farbwelten ---------- */
  var PALETTEN = {
    sand: {
      name: "Sand & Gold", punkte: ["#efeae0", "#cdb48a", "#7d5d24", "#1b1712"],
      v: { "--ink": "#1b1712", "--acc": "#7d5d24", "--gold": "#cdb48a", "--paper": "#efeae0",
           "--paper2": "#f3efe7", "--paper3": "#e7e0d3", "--muted": "#453e30", "--muted2": "#58503f",
           "--line": "rgba(138,106,47,.26)", "--card": "rgba(255,255,255,.66)" }
    },
    nacht: {
      name: "Werkstatt bei Nacht", punkte: ["#14120f", "#2a251d", "#cdb48a", "#f4efe4"],
      v: { "--ink": "#f4efe4", "--acc": "#d8bc8c", "--gold": "#cdb48a", "--paper": "#14120f",
           "--paper2": "#1a1713", "--paper3": "#221d17", "--muted": "#c4bba8", "--muted2": "#a79d8a",
           "--line": "rgba(205,180,138,.28)", "--card": "rgba(255,255,255,.055)" }
    },
    stahl: {
      name: "Stahl & Signal", punkte: ["#eceef0", "#cfd5d9", "#b4531f", "#15191c"],
      v: { "--ink": "#15191c", "--acc": "#b4531f", "--gold": "#e08344", "--paper": "#eceef0",
           "--paper2": "#f4f6f7", "--paper3": "#dfe4e7", "--muted": "#3a4247", "--muted2": "#4e585e",
           "--line": "rgba(21,25,28,.18)", "--card": "rgba(255,255,255,.72)" }
    }
  };

  /* ---------- Ansprache: Copy über die ganze Seite ---------- */
  var TEXTE = {
    du: {
      h1: "Wir kommen zu dir. Prüf kurz die Anfahrt.",
      lead: "Bis 50 km Entfernung von Limeshain fahren wir ohne Aufschlag. Darüber kommen Spritkosten dazu — der Rechner zeigt sie dir vorher.",
      cta1: "Leistungen ansehen →", cta2: "Abo-Kunde: direkt buchen",
      tick3: "Termine auch samstags", such: "Ort suchen",
      buchen: "Termin buchen", rechner: "Pakete ansehen & buchen →"
    },
    sie: {
      h1: "Wir kommen zu Ihnen. Prüfen Sie kurz die Anfahrt.",
      lead: "Bis 50 km Entfernung von Limeshain fahren wir ohne Aufschlag. Darüber kommen Spritkosten hinzu — der Rechner zeigt sie Ihnen vorab.",
      cta1: "Leistungen ansehen →", cta2: "Als Abo-Kunde direkt buchen",
      tick3: "Termine auch samstags", such: "Ort eingeben",
      buchen: "Termin buchen", rechner: "Pakete ansehen & buchen →"
    }
  };

  /* ---------- Auftritt: Rhythmus und Bewegung ---------- */
  var AUFTRITT = {
    ruhig:    { name: "Ruhig",     sec: "1",    h1: "1",    mot: "1",   rund: "1" },
    kompakt:  { name: "Kompakt",   sec: "0.62", h1: "0.86", mot: "0.6", rund: "0.5" },
    kraft:    { name: "Kraftvoll", sec: "1.22", h1: "1.18", mot: "1.3", rund: "1.6" }
  };

  var wurzel = document.documentElement;

  function anwenden() {
    var p = PALETTEN[cfg.palette] || PALETTEN.sand;
    Object.keys(p.v).forEach(function (k) { wurzel.style.setProperty(k, p.v[k]); });
    wurzel.dataset.ccvPalette = cfg.palette;

    var a = AUFTRITT[cfg.auftritt] || AUFTRITT.ruhig;
    wurzel.style.setProperty("--tw-sec", a.sec);
    wurzel.style.setProperty("--tw-h1", a.h1);
    wurzel.style.setProperty("--tw-mot", a.mot);
    wurzel.style.setProperty("--tw-rund", a.rund);

    var t = TEXTE[cfg.ansprache] || TEXTE.du;
    var h1 = document.querySelector(".hero h1");
    if (h1) h1.textContent = t.h1;
    var lead = document.querySelector(".hero .lead");
    if (lead) lead.textContent = t.lead;
    var ctas = document.querySelectorAll(".hero .cta-row .btn");
    if (ctas[0]) ctas[0].textContent = t.cta1;
    if (ctas[1]) ctas[1].textContent = t.cta2;
    var ticks = document.querySelectorAll(".hero .ticks span");
    if (ticks[2]) ticks[2].textContent = t.tick3;
    var suchLabel = document.querySelector('label[for="ccv-q"], .search > span');
    if (suchLabel) suchLabel.textContent = t.such;
    var kalk = document.querySelector('a.btn.full[href="innenreinigung.html"]');
    if (kalk) kalk.textContent = t.rechner;

    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {}
    panel.querySelectorAll("[data-feld]").forEach(function (b) {
      b.classList.toggle("on", cfg[b.dataset.feld] === b.dataset.wert);
    });
  }

  /* ---------- Panel bauen ---------- */
  var knopf = document.createElement("button");
  knopf.id = "tw-open";
  knopf.type = "button";
  knopf.setAttribute("aria-label", "Darstellung anpassen");
  knopf.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 7h9a3 3 0 0 1 6 0h3v2h-3a3 3 0 0 1-6 0H3V7zm0 8h6a3 3 0 0 1 6 0h6v2h-6a3 3 0 0 1-6 0H3v-2z"/></svg><span>Darstellung</span>';

  var panel = document.createElement("aside");
  panel.id = "tw-panel";
  panel.setAttribute("aria-label", "Darstellung anpassen");

  function gruppe(titel, hinweis, feld, eintraege) {
    var s = '<div class="tw-g"><span class="tw-t">' + titel + '</span>';
    if (hinweis) s += '<span class="tw-h">' + hinweis + '</span>';
    s += '<div class="tw-r">';
    eintraege.forEach(function (e) {
      s += '<button type="button" data-feld="' + feld + '" data-wert="' + e.wert + '">';
      if (e.punkte) {
        s += '<i class="tw-sw">';
        e.punkte.forEach(function (c) { s += '<b style="background:' + c + '"></b>'; });
        s += '</i>';
      }
      s += '<span>' + e.name + '</span></button>';
    });
    return s + "</div></div>";
  }

  panel.innerHTML =
    '<div class="tw-head"><span>Darstellung</span><button type="button" id="tw-close" aria-label="Schließen">✕</button></div>' +
    gruppe("Farbwelt", "Trägt die ganze Seite", "palette", Object.keys(PALETTEN).map(function (k) {
      return { wert: k, name: PALETTEN[k].name, punkte: PALETTEN[k].punkte };
    })) +
    gruppe("Ansprache", "Ändert Überschrift, Text und Knöpfe", "ansprache", [
      { wert: "du", name: "Du — nah" }, { wert: "sie", name: "Sie — geschäftlich" }
    ]) +
    gruppe("Auftritt", "Rhythmus, Typo und Bewegung", "auftritt", Object.keys(AUFTRITT).map(function (k) {
      return { wert: k, name: AUFTRITT[k].name };
    })) +
    '<button type="button" id="tw-reset">Zurücksetzen</button>';

  document.body.appendChild(knopf);
  document.body.appendChild(panel);

  function offen(v) {
    cfg.panel = v;
    panel.classList.toggle("open", v);
    knopf.classList.toggle("hide", v);
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  knopf.addEventListener("click", function () { offen(true); });
  panel.querySelector("#tw-close").addEventListener("click", function () { offen(false); });
  panel.querySelector("#tw-reset").addEventListener("click", function () {
    cfg = Object.assign({}, std, { panel: true });
    anwenden();
  });
  panel.addEventListener("click", function (e) {
    var b = e.target.closest("[data-feld]");
    if (!b) return;
    cfg[b.dataset.feld] = b.dataset.wert;
    anwenden();
  });
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel.classList.contains("open")) offen(false);
  });

  anwenden();
  offen(!!cfg.panel);
})();
