/* CAR CARE VALU — Komplett-Abo: Pop-up und Abo-Vergleich vor dem Buchen */
(function () {
  "use strict";

  var URL_KOMPLETT = "https://app.acuityscheduling.com/catalog.php?owner=37613678&action=addCart&clear=1&id=2286606";
  var URL_KOMFORT = "https://app.acuityscheduling.com/catalog.php?owner=37613678&action=addCart&clear=1&id=2097859";
  var URL_EXKLUSIV = "https://app.acuityscheduling.com/catalog.php?owner=37613678&action=addCart&clear=1&id=2097867";
  var KEY = "ccv_promo_zu";
  var TAGE = 5;

  function zuletztZu() {
    try { return Number(localStorage.getItem(KEY) || 0); } catch (e) { return 0; }
  }
  function merken() {
    try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
  }

  function modal(html, cls) {
    var ov = document.createElement("div");
    ov.className = "pm-ov " + (cls || "");
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.innerHTML = '<div class="pm-box">' +
      '<button type="button" class="pm-x" aria-label="Schließen">✕</button>' + html + "</div>";
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add("open"); });
    var vorher = document.activeElement;
    function zu() {
      ov.classList.remove("open");
      setTimeout(function () { ov.remove(); }, 300);
      document.removeEventListener("keydown", esc);
      if (vorher && vorher.focus) vorher.focus();
    }
    function esc(e) { if (e.key === "Escape") zu(); }
    ov.addEventListener("click", function (e) {
      if (e.target === ov || e.target.closest(".pm-x") || e.target.closest("[data-pm-zu]")) zu();
    });
    document.addEventListener("keydown", esc);
    var erster = ov.querySelector(".pm-box a, .pm-box button:not(.pm-x)");
    if (erster) setTimeout(function () { erster.focus(); }, 60);
    return { zu: zu, el: ov };
  }

  /* ---------- 1) Pop-up Komplett-Abo ---------- */
  var POPUP = '' +
    '<span class="pm-badge">⭐ EXKLUSIV NUR IM ABO</span>' +
    '<h2>Komplett-Abo — Innen &amp; Außen</h2>' +
    '<p class="pm-lead">Dein ganzes Auto, jeden Monat gepflegt — mit Fotodokumentation für eine Leasingrückgabe ohne böse Überraschungen.</p>' +
    '<ul class="pm-list">' +
      '<li>1 Termin pro Monat, innen und außen</li>' +
      '<li>Außenwäsche per Handwäsche in der nächsten Waschbox — nur im Abo</li>' +
      '<li>Zustands-Dokumentation bei jedem Termin inklusive</li>' +
      '<li>Fester Termin, du musst an nichts denken</li>' +
      '<li>Innenreinigung bei dir vor Ort, wir kümmern uns um alles</li>' +
    '</ul>' +
    '<div class="pm-price"><b>139 €</b><span>pro Monat · zzgl. einmalig 49 € Einrichtung</span></div>' +
    '<div class="pm-cta">' +
      '<a class="btn full" href="' + URL_KOMPLETT + '" target="_blank" rel="noopener" data-pm-zu>Komplett-Abo buchen →</a>' +
      '<a class="btn ghost full" href="abo.html#komplett" data-pm-zu>Alle Leistungen ansehen</a>' +
    '</div>' +
    '<button type="button" class="pm-later" data-pm-zu>Später</button>';

  var pfad = location.pathname.split("/").pop() || "index.html";
  var ausgenommen = ["abo.html", "abo-termin.html", "impressum.html", "agb.html", "datenschutz.html",
    "anfrage.html", "minispiel.html", "b2b.html", "autohaus.html", "fitnessstudio.html", "vermietung.html"];
  var popupErlaubt = ausgenommen.indexOf(pfad) === -1 &&
    Date.now() - zuletztZu() > TAGE * 86400000;

  var gezeigt = false;
  function zeigePopup() {
    if (gezeigt || !popupErlaubt || document.querySelector(".pm-ov")) return;
    gezeigt = true;
    merken();
    modal(POPUP, "pm-promo");
  }

  if (popupErlaubt) {
    setTimeout(zeigePopup, 22000);
    window.addEventListener("scroll", function onS() {
      var h = document.documentElement;
      if ((h.scrollTop + h.clientHeight) / h.scrollHeight > 0.62) {
        window.removeEventListener("scroll", onS);
        setTimeout(zeigePopup, 600);
      }
    }, { passive: true });
    document.addEventListener("mouseout", function (e) {
      if (!e.relatedTarget && e.clientY < 8) zeigePopup();
    });
  }

  /* ---------- 2) Vergleich vor dem Buchen im Rechner ---------- */
  function zahl(t) {
    var m = String(t || "").replace(/\./g, "").match(/(\d+)(?:,(\d+))?/);
    return m ? Number(m[1] + "." + (m[2] || "0")) : 0;
  }
  function eur(n) { return n.toFixed(2).replace(".", ",") + " €"; }

  function vergleich(paket, preis, weiterHref) {
    var komfortSpar = Math.max(0, preis - 40);
    var html = '' +
      '<span class="pm-badge">BEVOR DU BUCHST</span>' +
      '<h2>Einmal oder dauerhaft günstiger?</h2>' +
      '<p class="pm-lead">Dein Einzeltermin ' + paket + ' kostet <b>' + eur(preis) + '</b>. Im Abo zahlst du pro Termin deutlich weniger — und dein Auto bleibt dauerhaft gepflegt.</p>' +
      '<div class="pm-cmp">' +
        '<div class="pm-c">' +
          '<span class="mono">EINZELTERMIN</span><b>' + eur(preis) + '</b><i>einmalig · ' + paket + '</i>' +
          '<a class="btn ghost full" href="' + weiterHref + '" target="_blank" rel="noopener" data-pm-zu>Einzeln buchen</a>' +
        '</div>' +
        '<div class="pm-c">' +
          '<span class="mono">KOMFORT-ABO</span><b>40,00 €</b><i>pro Termin' + (komfortSpar > 0 ? ' · du sparst ' + eur(komfortSpar) : '') + '</i>' +
          '<a class="btn ghost full" href="' + URL_KOMFORT + '" target="_blank" rel="noopener" data-pm-zu>Komfort-Abo</a>' +
        '</div>' +
        '<div class="pm-c pm-hi">' +
          '<span class="pm-tag">INNEN + AUSSEN</span>' +
          '<span class="mono">KOMPLETT-ABO</span><b>139,00 €</b><i>pro Monat · innen, außen, Foto-Doku · einmalig 49 € Einrichtung</i>' +
          '<a class="btn full" href="' + URL_KOMPLETT + '" target="_blank" rel="noopener" data-pm-zu>Komplett-Abo →</a>' +
        '</div>' +
      '</div>' +
      '<p class="pm-fine">Alle Abos monatlich kündbar. Außenwäsche gibt es für Privatkunden nur im Komplett-Abo. <a href="abo.html" data-pm-zu>Abo-Modelle vergleichen</a></p>';
    modal(html, "pm-compare");
  }

  var sBasis = document.getElementById("ccv-sum-basis");
  var sPrem = document.getElementById("ccv-sum-premium");
  [["ccv-go-basis", "BASIS", sBasis], ["ccv-go-premium", "PREMIUM", sPrem]].forEach(function (d) {
    var a = document.getElementById(d[0]);
    if (!a) return;
    a.addEventListener("click", function (e) {
      var href = a.getAttribute("href") || "";
      if (href.indexOf("acuityscheduling") === -1) return; /* z. B. Wetter-Hinweis: nicht abfangen */
      var kmFeld = document.getElementById("ccv-num");
      var km = kmFeld ? Number(kmFeld.value) || 0 : 0;
      if (km > 50) return; /* Abos nur bis 50 km — darüber direkt buchen */
      e.preventDefault();
      gezeigt = true;
      vergleich(d[1], zahl(d[2] && d[2].textContent) || (d[1] === "BASIS" ? 59 : 69), href);
    });
  });
})();
