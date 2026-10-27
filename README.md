# NEON FLEET

Cyberpunk-Schiffe-versenken für das Handy: Online-Multiplayer per Raumcode/Link/QR (WebRTC über PeerJS, kein eigener Server), KI-Gegner in drei Stufen, Energie und acht Spezialwaffen, Minen, Zufalls-Events und eine kryptografische Fairness-Prüfung. Läuft im Mobile-Browser und lässt sich als PWA installieren.

## Schnellstart

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
npm run dev
```

Der Dev-Server läuft auf `http://localhost:5173` und ist mit `--host` auch im WLAN erreichbar (die Adresse steht im Terminal). So kannst du direkt mit dem Handy testen.

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver mit Hot-Reload |
| `npm test` | Unit- und Integrationstests (Vitest) |
| `npm run build` | Typecheck und Produktions-Build nach `dist/` |
| `npm run preview` | Produktions-Build lokal ausliefern (inkl. Service Worker) |
| `npm run icons` | PWA-Icons in `public/icons/` neu erzeugen |

## Spielen

- **Spiel erstellen**: Wähle Modus (Cyber/Klassisch) und Zug-Timer. Du bekommst einen 5-stelligen Raumcode, einen Link (`?room=XXXXX`) und einen QR-Code.
- **Spiel beitreten**: Code eingeben oder den Link/QR-Code öffnen.
- **Gegen KI**: Leicht, Mittel oder Schwer, funktioniert komplett offline.
- **Bedienung**: Feld antippen → Fadenkreuz → **FEUER**. Mit zwei Fingern zoomen und verschieben, am Desktop mit dem Mausrad. Tippe auf die Minimap, um zwischen Feind- und eigenem Raster zu wechseln.
- **Verbindungsabbruch**: Das Spiel wird laufend lokal gespeichert. Nach Neuladen oder Netzwechsel verbinden sich beide Geräte automatisch über denselben Raumcode neu, und verpasste Züge werden nachgeliefert.

Die vollständigen Regeln stehen im Spiel unter **Anleitung**.

## Balancing

Alle Werte (Feldgröße, Flotte, Energie, Kosten der Spezialaktionen, Minen, Combo, Events, Timer) stehen zentral in [`src/config/balance.ts`](src/config/balance.ts).

## Projektstruktur

```
src/
  config/   balance.ts – alle Spielwerte
  game/     reine Spiellogik ohne UI: Board, Flotte, Regeln, Events, Commitment, Verifikation
  net/      Transport-Interface, PeerJS- und Local-Transport, Protokoll, zuverlässige Session
  app/      MatchController (verbindet Logik + Netz), Sitzungen, Einstellungen
  ai/       KI-Gegner (Jagdmodus, Wahrscheinlichkeitskarte, Spezialaktionen)
  render/   Canvas-Renderer (DPR-scharf), Schiffe, Effekte, Szenen
  ui/       Screens (Menü, Lobby, Aufbau, Kampf, Ende)
  audio/    WebAudio-Synthesizer (Musik + Effekte)
  i18n/     Texte (de.ts), vorbereitet für weitere Sprachen
tests/      Regeln, Spezialaktionen, Fairness, komplette KI-Partien, Reconnect
```

### Netzwerk und Fairness

- `Transport` ([`src/net/transport.ts`](src/net/transport.ts)) ist ein schlankes Interface. `PeerTransport` nutzt den kostenlosen öffentlichen PeerJS-Broker. Für Firebase, WebSockets o. Ä. reicht eine weitere Implementierung.
- Die `Session`-Schicht nummeriert jede Nachricht, bestätigt sie und sendet nach einem Reconnect alles Unbestätigte erneut. Ein Heartbeat erkennt tote Verbindungen.
- Nachrichten sind typisiert: `hello`, `config`, `ready` (mit Commitment), `action`, `result`, `reveal`, `rematch`, `forfeit`.
- Jeder Client hält nur sein eigenes Feld. Beim „Bereit“ geht `SHA-256(Aufstellung | Salt)` an den Gegner. Nach Spielende decken beide Aufstellung, Salt und private Details auf (Schild, Hologramm, Sprünge). Jedes gemeldete Ergebnis wird dann nachsimuliert und geprüft.

## Kostenlos veröffentlichen

Der Build ist eine rein statische Seite (`dist/`). Ohne `BASE_PATH` nutzt er relative Pfade und läuft so auch auf Netlify und Cloudflare Pages.

### GitHub Pages (automatisch)

Der Workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) ist schon dabei. Bei jedem Push auf `main` testet und baut er das Projekt und veröffentlicht es auf GitHub Pages. Dabei setzt er `BASE_PATH` auf den Pages-Unterordner (z. B. `/neon-fleet/`), damit Service Worker, Manifest und Icons unter dem Pages-Link korrekt liegen.

1. Lege auf GitHub ein leeres Repository an, z. B. `neon-fleet`.
2. Verbinde es und pushe:
   ```bash
   git remote add origin https://github.com/DEINNAME/neon-fleet.git
   git push -u origin main
   ```
3. Stelle auf GitHub unter **Settings → Pages → Build and deployment → Source** „GitHub Actions“ ein.
4. Starte den Workflow unter **Actions** neu, falls der erste Lauf vor diesem Schritt fehlgeschlagen ist. Danach ist das Spiel unter `https://DEINNAME.github.io/neon-fleet/` erreichbar.

### Netlify

1. Melde dich auf [netlify.com](https://netlify.com) an und wähle **Add new site → Import an existing project**. Verbinde dann das GitHub-Repository.
2. Build command: `npm run build`, Publish directory: `dist`.
3. Klicke auf **Deploy**. Alternativ ohne Git: `npm run build` ausführen und den Ordner `dist` per Drag & Drop auf [app.netlify.com/drop](https://app.netlify.com/drop) ziehen.

### Cloudflare Pages

Wähle **Workers & Pages → Create → Pages → Connect to Git** und stelle dasselbe ein: `npm run build` und `dist`.

Hinweis: WebRTC und die PWA-Installation brauchen **HTTPS**. Das bieten alle drei Dienste automatisch.

## Als App installieren (PWA)

**Android (Chrome):** Seite öffnen, dann im Startmenü **App installieren** tippen oder über das Menü ⋮ **Zum Startbildschirm hinzufügen**. Die App startet danach im Vollbild.

**iPhone/iPad (Safari):** Seite öffnen, auf das Teilen-Symbol tippen und **Zum Home-Bildschirm** wählen. Spiel gegen KI, Menü und Aufbau funktionieren danach offline. Der Multiplayer braucht Internet.

## Später: Android-APK mit Capacitor

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "NEON FLEET" de.neonfleet.app --web-dir dist
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

Android Studio öffnet sich. Unter **Build → Build Bundle(s) / APK(s) → Build APK(s)** entsteht die APK. Nach jeder Code-Änderung `npm run build && npx cap sync android` ausführen. Für iOS gilt dasselbe mit `@capacitor/ios` und Xcode (Mac nötig). Native Vibration und Statusleiste lassen sich über die Capacitor-Plugins `@capacitor/haptics` und `@capacitor/status-bar` ergänzen.

## Lizenzen

Schriften: Orbitron und Rajdhani (SIL Open Font License) über `@fontsource`, lokal gebündelt. Grafik und Sound werden vollständig prozedural erzeugt, es gibt keine fremden Assets.
