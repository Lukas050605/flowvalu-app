/* ============================================================
   CAR CARE VALU — Saison und Wetter
   ------------------------------------------------------------
   Diese Datei kannst du selbst ändern. Nach dem Ändern:
   speichern, auf GitHub hochladen. Kein Acuity nötig.
   ============================================================ */

/* ---- Frost-Pauschale ----------------------------------------
   betrag  = Euro. 0 heißt: Pauschale ist aus, nichts wird gezeigt.
   abGrad  = ab welcher Tiefsttemperatur sie greift (Grad Celsius)
   monate  = in welchen Monaten sie überhaupt möglich ist
             (1 = Januar … 12 = Dezember)                       */
window.CCV_FROST = {
  betrag: 19,
  abGrad: 0,
  monate: [11, 12, 1, 2, 3],
  name: "Frost-Pauschale",
  text: "Bei Frost brauchen Wasser, Reinigungsmittel und Trocknung deutlich länger. Die Pauschale deckt den Mehraufwand."
};

/* ---- Wetter-Schwellen ---------------------------------------
   rotAb   = ab dieser Regenwahrscheinlichkeit ist ein Samstag
             nicht buchbar (Prozent) — Buchungslink weicht
             dann der Hinweisseite wetter.html
   gelbAb  = ab hier unsicher
   tage    = wie viele Tage die Vorhersage zeigt (max. 14)       */
window.CCV_WETTER = {
  rotAb: 65,
  gelbAb: 35,
  tage: 7
};

/* ---- Die vier Jahreszeiten ----------------------------------
   Der Hinweis erscheint im Rechner, passend zum aktuellen Monat.
   Text frei änderbar.                                          */
window.CCV_SAISON = [
  { name: "Frühling", monate: [3, 4, 5],
    text: "Pollen und Streusalzreste sitzen jetzt in Teppichen und Lüftung. Gute Zeit für eine Grundreinigung nach dem Winter." },
  { name: "Sommer",   monate: [6, 7, 8],
    text: "Hitze trocknet Flecken ein und lässt Kunststoff ausbleichen. Wir arbeiten bei starker Sonne im Schatten oder früh am Tag." },
  { name: "Herbst",   monate: [9, 10, 11],
    text: "Laub und Nässe kommen mit ins Auto. Jetzt lohnt sich die Reinigung, bevor Feuchtigkeit im Innenraum bleibt." },
  { name: "Winter",   monate: [12, 1, 2],
    text: "Streusalz greift Teppiche und Fußmatten an. Bei Frost dauert die Arbeit länger — Termine legen wir auf die milderen Stunden." }
];
