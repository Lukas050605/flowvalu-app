# FlowValu — Live-Matching-App

Echtes Text-Chat-Matching mit Warteschlange und echtem Video-Call per WebRTC (Peer-to-Peer, kein Drittanbieter-Account nötig).

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
