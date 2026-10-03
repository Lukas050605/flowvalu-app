# Flow Valu — Frontend

Eigenständiges HTML/CSS/JS-Projekt. Keine Build-Tools, kein Framework, keine
externen Abhängigkeiten außer Google Fonts (Archivo, Manrope, Caveat).

## Dateien

```
site/
  index.html        Struktur und Inhalte der Homepage
  styles.css        gesamtes Design (Farben, Typografie, Layout, Hover, Responsive)
  script.js         interaktiver Beispiel-Weg (Ziel wählen → Schritte, aktueller Schritt)
  assets/
    hero.png        Kampagnenmotiv im Hero
```

## Verwendung

Ordner `site/` auf den Webserver kopieren, `index.html` aufrufen. Funktioniert
auch per Doppelklick lokal.

## Bilder ergänzen

Alle Bildflächen außer dem Hero sind Platzhalter (`<div class="photo" data-photo="…">`).
Der Text in `data-photo` beschreibt das gewünschte Motiv. Zum Einsetzen eines echten
Bildes entweder inline

```html
<div class="photo photo--34" style="background-image:url('assets/mentor-1.jpg')"></div>
```

oder pro Element eine eigene Regel in `styles.css`. Sobald ein `background-image`
gesetzt ist, verschwindet der Platzhaltertext automatisch.

Empfohlene Seitenverhältnisse: `photo--43` (4:3, Weg-Sektion),
`photo--34` (3:4, Mentoren), `photo--45` (4:5, Business),
Community und Final-CTA füllen ihre Fläche vollständig.

## Hero

`assets/hero.png` enthält die Kampagnentypografie bereits im Bild. Die vier
Karten im Motiv sind mit unsichtbaren Links (`.hotspot--1` bis `.hotspot--4`)
belegt, die per Prozentwerten positioniert sind. Wird das Motiv ausgetauscht,
müssen `left`, `top`, `width`, `height` dieser vier Regeln in `styles.css`
angepasst werden. Unter 760 px Breite sind die Hotspots ausgeblendet.

## Live-Match: Video-Chat zwischen zwei Nutzern

Kamera und Mikrofon funktionieren in **beide Richtungen** (WebRTC über PeerJS).

So funktioniert das Matching:
- Jeder Suchbegriff wird einem Thema zugeordnet (z. B. „Kunden gewinnen" → Vertrieb).
- Pro Thema gibt es einen Warteraum. Wer zuerst sucht, wartet dort.
- Wer danach ein ähnliches Thema sucht, wird automatisch mit dieser Person verbunden.
- „Zufall" nutzt einen gemeinsamen Warteraum für alle ohne Thema.
- „Nächste Person" trennt und sucht neu, „Beenden" schaltet Kamera und Mikrofon aus.

Testen: Seite in zwei Browsern oder auf zwei Geräten öffnen, beide anmelden,
denselben Begriff (oder beide „Zufall") wählen.

Voraussetzungen:
- Die Seite muss über **HTTPS** laufen (oder `localhost`), sonst gibt der Browser
  Kamera und Mikrofon nicht frei.
- Für die Verbindung wird der kostenlose öffentliche PeerJS-Server genutzt
  (`peerjs.min.js` von unpkg). Für den Live-Betrieb empfohlen: eigenen PeerJS-Server
  betreiben (`npm i peer`, dann `host`/`port`/`path` in `PEER_CONFIG` in
  `script.js` eintragen).
- In manchen Firmen- und Mobilnetzen klappt die direkte Verbindung nicht. Dafür
  einen **TURN-Server** in `PEER_CONFIG.config.iceServers` ergänzen
  (z. B. eigener coturn-Server oder ein Anbieter wie Twilio/Metered).
- Moderation, Melden/Blockieren und Altersprüfung sind noch nicht enthalten und
  sollten vor einem öffentlichen Start ergänzt werden.

## Mitschrift, KI-Mindmap, PDF, Bildschirm teilen

Im Live-Gespräch gibt es rechts drei Reiter: **Chat**, **Mitschrift** und **KI**.

- **Mitschrift** startet erst, wenn beide zugestimmt haben (Anfrage → Zustimmen/Ablehnen).
  Jede Seite schreibt ihre eigene Stimme per Spracherkennung des Browsers mit
  (Chrome/Edge, Deutsch) und schickt den Text an die andere Seite.
- Beim Beenden oder bei „Nächste Person" entsteht automatisch eine **Notiz**:
  KI-Mindmap, kurze Zusammenfassung, Aufgaben/nächste Schritte und komplette Mitschrift.
  Zu finden im Menü unter **Notizen**, dort „Als PDF speichern" (Druckdialog → „Als PDF speichern").
- **KI-Feld**: Fragen an die KI im Gespräch, beide sehen Fragen und Antworten.
  Die KI bekommt einen Auszug der Mitschrift als Kontext.
- **Bildschirm teilen**: Knopf in der Steuerleiste, ersetzt das Kamerabild für die andere Person.

KI-Anbieter: unter **KI-Einstellungen** ChatGPT (OpenAI) oder Claude (Anthropic) wählen,
API-Schlüssel und Modell eintragen. Ohne Schlüssel wird eine einfache Mindmap lokal erstellt.
Der Schlüssel liegt vorerst im Browser — für den echten Betrieb gehört der Aufruf auf den Server.

## Anpassungspunkte

- Farben, Abstände, Radien und Fonts liegen als CSS-Variablen in `:root`.
- Inhalte des Beispiel-Wegs stehen im Array `GOALS` in `script.js`
  (Label, Zieltext, Anzahl erledigter Schritte, Schrittliste, Warum, Aufgabe,
  Kurs, Mentor).
- Navigation und Buttons verlinken auf Sektions-Anker (`#kernkette`, `#beispiel`,
  `#kurse`, `#mentoren`, `#community`, `#fortschritt`, `#start`) — für echte
  Seiten die `href`-Werte ersetzen.
