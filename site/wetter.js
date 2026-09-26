/* CAR CARE VALU — Saison-Hinweis, Wettervorhersage, Frost-Pauschale
   Wetterdaten: Open-Meteo (kostenlos, ohne Schlüssel).
   Fällt die Abfrage aus, bleibt der Rechner unverändert nutzbar. */
(function () {
  "use strict";

  var slot = document.getElementById("wx-slot") || document.getElementById("ccv-out");
  if (!slot) return;
  var eigenerSlot = slot.id === "wx-slot";

  var FROST = window.CCV_FROST || { betrag: 0 };
  var SCHW = window.CCV_WETTER || { rotAb: 70, gelbAb: 40, tage: 7 };
  var SAISON = window.CCV_SAISON || [];

  var monat = new Date().getMonth() + 1;
  var jetzt = SAISON.filter(function (s) { return s.monate.indexOf(monat) > -1; })[0];
  var frostMoeglich = FROST.betrag > 0 && (FROST.monate || []).indexOf(monat) > -1;

  /* Position im Jahr, auf den Tag genau */
  var heute = new Date();
  var jahr = heute.getFullYear();
  var start = new Date(jahr, 0, 1), ende = new Date(jahr + 1, 0, 1);
  var anteil = (heute - start) / (ende - start);
  var MON = ["J","F","M","A","M","J","J","A","S","O","N","D"];

  function skala() {
    var segs = [];
    SAISON.forEach(function (s) {
      var m = s.monate.slice().sort(function (a, b) { return a - b; });
      var lauf = [m[0]];
      for (var i = 1; i < m.length; i++) {
        if (m[i] === lauf[lauf.length - 1] + 1) lauf.push(m[i]);
        else { segs.push({ name: s.name, von: lauf[0], breite: lauf.length, aktiv: s === jetzt }); lauf = [m[i]]; }
      }
      segs.push({ name: s.name, von: lauf[0], breite: lauf.length, aktiv: s === jetzt });
    });

    var html = '<div class="yr">' +
      '<div class="yr-head"><span class="mono">' + jahr + ' · ' +
      (jetzt ? jetzt.name.toUpperCase() : "") + '</span>' +
      '<span class="mono yr-tag">' + heute.getDate() + ". " +
      ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"][heute.getMonth()] +
      '</span></div><div class="yr-bar">';

    segs.forEach(function (b) {
      html += '<i class="yr-seg' + (b.aktiv ? " on" : "") + '" style="left:' +
        ((b.von - 1) / 12 * 100).toFixed(4) + '%;width:' + (b.breite / 12 * 100).toFixed(4) +
        '%"><b>' + (b.breite === 1 ? "" : b.name) + '</b></i>';
    });

    html += '<span class="yr-now" style="left:' + (anteil * 100).toFixed(2) + '%"></span></div>' +
      '<div class="yr-mon">' + MON.map(function (m, i) {
        return '<span' + (i === heute.getMonth() ? ' class="on"' : '') + '>' + m + '</span>';
      }).join("") + '</div></div>';
    return html;
  }

  var wrap = document.createElement("div");
  wrap.className = "wx";
  wrap.innerHTML =
    skala() +
    (jetzt ? '<div class="wx-saison"><span class="mono">' + jetzt.name.toUpperCase() +
      '</span><p>' + jetzt.text + '</p></div>' : "") +
    '<div class="wx-box" hidden>' +
      '<div class="wx-head"><span class="mono">WETTER · <b id="wx-ort">—</b></span>' +
      '<span class="mono" id="wx-quelle">unsere Samstagstermine</span></div>' +
      '<div class="wx-days" id="wx-days"></div>' +
      '<p class="wx-note" id="wx-note"></p>' +
      '<a class="wx-mehr" href="wetter.html" hidden>Warum wir bei diesem Wetter nicht arbeiten →</a>' +
    '</div>';

  if (eigenerSlot) slot.appendChild(wrap);
  else slot.parentNode.insertBefore(wrap, slot.nextSibling);

  var box = wrap.querySelector(".wx-box");
  var tage = wrap.querySelector("#wx-days");
  var note = wrap.querySelector("#wx-note");
  var ortAus = wrap.querySelector("#wx-ort");
  var mehr = wrap.querySelector(".wx-mehr");

  var WOCHE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  var cache = {};

  window.CCV_WX = { ort: "", gute: null, alleRot: false, frostTage: 0, geladen: false };

  function melden() {
    if (typeof window.CCV_WX_FERTIG === "function") window.CCV_WX_FERTIG(window.CCV_WX);
  }

  function urteil(p, code, tmin) {
    if ([95, 96, 99].indexOf(code) > -1) return { s: "rot", t: "Gewitter" };
    if (p >= SCHW.rotAb) return { s: "rot", t: "zu nass" };
    if (frostMoeglich && tmin <= FROST.abGrad) return { s: "frost", t: "Frost" };
    if (p >= SCHW.gelbAb) return { s: "gelb", t: "unsicher" };
    return { s: "gruen", t: "gut" };
  }

  function zeichne(ort, d, mittel) {
    ortAus.textContent = ort;
    tage.innerHTML = "";
    var gute = 0, gelb = 0, frostTage = 0;

    var nurSa = [];
    d.time.forEach(function (iso, i) {
      if (new Date(iso + "T12:00:00").getDay() === 6) nurSa.push(i);
    });

    nurSa.forEach(function (i, n) {
      var iso = d.time[i];
      var p = Math.round(d.precipitation_probability_max[i] || 0);
      var tmin = Math.round(d.temperature_2m_min[i]);
      var u = urteil(p, d.weather_code[i], tmin);
      if (u.s === "gruen") gute++;
      if (u.s === "gelb") gelb++;
      if (u.s === "frost") frostTage++;

      var dt = new Date(iso + "T12:00:00");
      var el = document.createElement("div");
      el.className = "wx-day sa " + u.s;
      el.innerHTML =
        '<b>' + (n === 0 ? "Nächster Sa." : "Sa. darauf") + '</b>' +
        '<span class="wx-dat">' + dt.getDate() + "." + (dt.getMonth() + 1) + '.</span>' +
        '<span class="wx-p">' + p + ' %</span>' +
        '<span class="wx-t">' + tmin + '°</span>' +
        '<i>' + u.t + '</i>';
      tage.appendChild(el);
    });

    var alleRot = gute === 0 && gelb === 0 && frostTage === 0;
    window.CCV_WX = { ort: ort, gute: gute, gelb: gelb, alleRot: alleRot, frostTage: frostTage, geladen: true };

    var quelle = document.getElementById("wx-quelle");
    if (quelle) quelle.textContent = mittel ? "Mittel aus 8 Richtungen" : "unsere Samstagstermine";

    var s = [];
    if (mittel) s.push("Ohne genauen Ort werten wir acht Richtungen im Abstand von " + ort.replace("Umkreis ", "") + " aus und mitteln die Werte.");
    if (alleRot) {
      s.push("An den kommenden Samstagen ist das Wetter in " + ort + " nicht gut genug. Wir nehmen die Online-Buchung heraus, statt einen Termin zuzusagen, den wir absagen müssten.");
    } else if (gute > 0) {
      s.push(gute === 1 ? "Ein Samstag ist gut geeignet — Regenwahrscheinlichkeit unter " + SCHW.gelbAb + " %."
        : gute + " Samstage sind gut geeignet — Regenwahrscheinlichkeit unter " + SCHW.gelbAb + " %.");
    } else {
      s.push("Kein Samstag ist sicher trocken — machbar ist es trotzdem. Wir arbeiten in den trockenen Stunden und verschieben kostenfrei, wenn es am Morgen anders aussieht.");
    }
    if (frostTage > 0 && FROST.betrag > 0) {
      s.push("An " + frostTage + (frostTage === 1 ? " Tag" : " Tagen") + " liegt die Tiefsttemperatur bei " +
        FROST.abGrad + "° oder darunter. Dann kommt die " + FROST.name + " von " +
        FROST.betrag.toFixed(2).replace(".", ",") + " € dazu.");
    }
    s.push("Die Werte sind eine Vorhersage, keine Zusage.");
    note.textContent = s.join(" ");
    mehr.hidden = !alleRot;
    box.hidden = false;
    melden();
  }

  function laden(ort) {
    if (!ort) return;
    if (cache[ort]) { zeichne(ort, cache[ort]); return; }
    box.hidden = false;
    tage.innerHTML = '<div class="wx-lade">Wetter für ' + ort + ' wird geladen …</div>';
    note.textContent = "";
    mehr.hidden = true;
    ortAus.textContent = ort;

    fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=de&country=DE&name=" + encodeURIComponent(ort))
      .then(function (r) { return r.json(); })
      .then(function (g) {
        if (!g.results || !g.results.length) throw new Error("kein Ort");
        var o = g.results[0];
        return fetch("https://api.open-meteo.com/v1/forecast?latitude=" + o.latitude +
          "&longitude=" + o.longitude +
          "&daily=precipitation_probability_max,weather_code,temperature_2m_min" +
          "&timezone=Europe%2FBerlin&forecast_days=16");
      })
      .then(function (r) { return r.json(); })
      .then(function (w) {
        if (!w.daily || !w.daily.time) throw new Error("keine Daten");
        cache[ort] = w.daily;
        zeichne(ort, w.daily);
      })
      .catch(function () {
        tage.innerHTML = "";
        note.textContent = "Die Wettervorhersage ist gerade nicht erreichbar. Das ändert nichts an der Buchung — wir melden uns, wenn das Wetter am Termintag nicht mitspielt.";
        window.CCV_WX = { ort: ort, gute: null, alleRot: false, frostTage: 0, geladen: true };
        melden();
      });
  }

  /* ---- Umkreis statt einzelnem Ort ---- */
  var MITTE = { lat: 50.2917, lon: 9.0083 };
  var umkreisCache = {};

  function umkreis(km) {
    km = Math.max(1, Math.round(km));
    if (umkreisCache[km]) { zeichne("Umkreis " + km + " km", umkreisCache[km], true); return; }

    box.hidden = false;
    tage.innerHTML = '<div class="wx-lade">Wetter im Umkreis von ' + km + ' km wird ausgewertet …</div>';
    note.textContent = "";
    mehr.hidden = true;
    ortAus.textContent = "Umkreis " + km + " km";

    var la = [], lo = [];
    for (var i = 0; i < 8; i++) {
      var w = i * Math.PI / 4;
      la.push((MITTE.lat + (km / 111.32) * Math.cos(w)).toFixed(4));
      lo.push((MITTE.lon + (km / (111.32 * Math.cos(MITTE.lat * Math.PI / 180))) * Math.sin(w)).toFixed(4));
    }

    fetch("https://api.open-meteo.com/v1/forecast?latitude=" + la.join(",") +
      "&longitude=" + lo.join(",") +
      "&daily=precipitation_probability_max,weather_code,temperature_2m_min" +
      "&timezone=Europe%2FBerlin&forecast_days=16")
      .then(function (r) { return r.json(); })
      .then(function (w) {
        var punkte = Array.isArray(w) ? w : [w];
        var erste = punkte[0] && punkte[0].daily;
        if (!erste) throw new Error("keine Daten");
        var d = { time: erste.time.slice(), precipitation_probability_max: [], weather_code: [], temperature_2m_min: [] };
        erste.time.forEach(function (_, i) {
          var p = 0, tmin = 0, code = 0, n = 0;
          punkte.forEach(function (pt) {
            if (!pt.daily) return;
            p += pt.daily.precipitation_probability_max[i] || 0;
            tmin += pt.daily.temperature_2m_min[i];
            code = Math.max(code, pt.daily.weather_code[i] || 0);
            n++;
          });
          d.precipitation_probability_max.push(Math.round(p / n));
          d.temperature_2m_min.push(tmin / n);
          d.weather_code.push(code);
        });
        umkreisCache[km] = d;
        zeichne("Umkreis " + km + " km", d, true);
      })
      .catch(function () {
        tage.innerHTML = "";
        note.textContent = "Die Wettervorhersage ist gerade nicht erreichbar. Das ändert nichts an der Buchung — wir melden uns, wenn das Wetter am Termintag nicht mitspielt.";
        window.CCV_WX = { ort: "Umkreis", gute: null, alleRot: false, frostTage: 0, geladen: true };
        melden();
      });
  }

  window.CCV_WETTER_LADEN = laden;
  window.CCV_WETTER_UMKREIS = umkreis;

  /* Ort aus der Adresszeile, falls verlinkt */
  var vonUrl = new URLSearchParams(location.search).get("ort");
  if (vonUrl) laden(vonUrl);

  /* Ortsauswahl im Rechner (index.html) */
  var gewaehlt = document.getElementById("ccv-picked");
  if (gewaehlt) {
    new MutationObserver(function () {
      var t = (gewaehlt.textContent || "").replace(/^GEWÄHLT:\s*/i, "").replace(/·.*$/, "").trim();
      if (t && t.length > 1) laden(t);
    }).observe(gewaehlt, { childList: true, characterData: true, subtree: true });
  }
})();
