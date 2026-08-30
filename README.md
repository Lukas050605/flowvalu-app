# FlowValu — Live-Matching-App

Echtes Text-Chat-Matching mit Warteschlange, echtem Video-Call per WebRTC, Login/Registrierung mit E-Mail-Bestätigung, Profilbild/Verlauf, einem Melde-System mit automatischer Sperre — und einer KI-gestützten Call-Zusammenfassung als PDF.

## Call-Zusammenfassung einrichten (optional, aber empfohlen)

Während eines Video-Calls wird das Gespräch live per Browser-Spracherkennung mitgeschrieben (Text bleibt lokal in den Browsern, es werden keine Audiodaten hochgeladen). Nach dem Call bekommen beide automatisch ein PDF mit den wichtigsten Ideen.

**Wichtige Einschränkung:** Die Live-Spracherkennung nutzt die Web Speech API des Browsers — funktioniert zuverlässig in **Chrome und Edge**, ist in Firefox nicht und in Safari nur eingeschränkt verfügbar. Das lässt sich technisch nicht umgehen, da es eine Browser-Funktion ist.

**Für die KI-Zusammenfassung** (statt nur dem rohen Protokoll):
1. Auf [console.anthropic.com](https://console.anthropic.com) einen Account anlegen und einen API-Key erstellen
2. Bei Render unter "Environment" die Variable `ANTHROPIC_API_KEY` mit deinem Key setzen
3. Ohne diesen Key bekommen beide trotzdem ein PDF, aber nur mit dem rohen Gesprächsprotokoll statt einer aufbereiteten Ideen-Zusammenfassung

Die Anthropic-API wird nach Nutzung abgerechnet (nicht kostenlos wie Resend), die Kosten pro Zusammenfassung sind aber sehr gering (kurzer Text-Prompt).

## E-Mail-Bestätigung einrichten (empfohlen für den Live-Betrieb)

Ohne Einrichtung werden neue Konten beim lokalen Testen automatisch bestätigt (praktisch zum Entwickeln). Für den echten Betrieb:

1. Kostenlosen Account auf [resend.com](https://resend.com) anlegen
2. Im Dashboard unter "API Keys" einen Key erstellen
3. Auf Render (oder lokal in einer `.env`-Datei) die Umgebungsvariable setzen: `RESEND_API_KEY=dein-key-hier`
4. Zusätzlich `APP_URL` auf deine echte Adresse setzen, z. B. `APP_URL=https://flowvalu-app.onrender.com` (sonst zeigen die Bestätigungslinks auf localhost)

Resend verschickt die Bestätigungsmails automatisch von `onboarding@resend.dev` — dafür ist keine eigene Domain nötig, es funktioniert sofort mit jedem Empfänger.

## Login & Melden

- Jeder Nutzer braucht ein Konto (E-Mail + Passwort), bevor er matchen kann.
- Im Chat gibt's einen "🚩 Melden"-Button mit Grundauswahl.
- Nach 3 Meldungen gegen dieselbe Person wird ihr Konto automatisch gesperrt (in `server.js` über `REPORT_BAN_THRESHOLD` einstellbar).
- Nutzer- und Meldungsdaten liegen in `data/users.json` und `data/reports.json`.

## ⚠️ Wichtige Einschränkung: Datenspeicherung auf Render

Render's **kostenloser Tarif** hat ein "ephemeres" Dateisystem — das heißt: **bei jedem Neustart oder Redeploy des Servers gehen `data/users.json` und `data/reports.json` verloren**, und alle registrierten Nutzer wären weg. Für's Testen unproblematisch, aber **vor dem echten Live-Betrieb mit echten Nutzern** sollte das durch eine richtige Datenbank ersetzt werden (z. B. Render's eigene kostenlose Postgres-Datenbank). Das ist ein guter nächster Ausbauschritt.

## Lokal testen

```
npm install
node server.js
```

Dann im Browser **zwei Tabs** öffnen mit `http://localhost:3000` — im ersten Tab auf "Los geht's" klicken, kurz warten, dann im zweiten Tab ebenfalls starten. Beide sollten sich gegenseitig finden und chatten können.

## Wichtig: Kamera/Mikrofon brauchen HTTPS

Browser erlauben Kamera-/Mikrofon-Zugriff nur über **https://** oder auf **localhost**. Lokal (`localhost:3000`) funktioniert das direkt. Sobald die App aber öffentlich läuft (z. B. über Render.com), bekommt sie automatisch eine `https://`-Adresse — dann funktioniert es weiterhin ohne zusätzliche Einrichtung.

## Live schalten (kostenlos möglich)

Diese App braucht einen **echten Node-Server** — Squarespace, Webflow & Co. reichen dafür nicht aus, da sie nur statische Seiten hosten.

Empfohlen für den Start: **Render.com** (kostenloser Tier reicht für den Anfang)

1. Kostenlosen Account auf render.com anlegen
2. "New Web Service" → dieses Projekt als ZIP hochladen oder mit GitHub verbinden
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Render vergibt automatisch eine URL wie `flowvalu.onrender.com`

Alternativen: Railway.app, Fly.io — funktionieren nach dem gleichen Prinzip.

## Bekannte Grenzen dieser Version

- **Nur direkte Verbindung (kein TURN-Server):** Die WebRTC-Verbindung nutzt öffentliche STUN-Server, das reicht für die meisten Heim-/Mobilnetze. In seltenen Fällen (z. B. sehr restriktive Firmen-Firewalls) kann die Verbindung nicht zustande kommen — dafür bräuchte man später einen zusätzlichen TURN-Server.
- **Kein Login/Accounts** — jeder kann ohne Anmeldung mitmachen. Für den Start okay, für später (Bezahlschranke) brauchst du noch eine Nutzerverwaltung.
- **Keine Bezahlfunktion** — das 20€/Monat-Abo ist hier noch nicht eingebaut (Stripe-Integration wäre der nächste Schritt).
- **Warteschlange lebt nur im Arbeitsspeicher** — bei einem Server-Neustart sind alle gerade Wartenden weg. Für den Start unproblematisch, für den Dauerbetrieb später eine Datenbank (z. B. Redis) sinnvoll.
- **Kein Report/Moderation-System** — wie besprochen ein wichtiger nächster Schritt, sobald echte fremde Nutzer aufeinandertreffen.
