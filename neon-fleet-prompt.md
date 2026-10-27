# Prompt für Opus: "NEON FLEET" – Cyberpunk-Schiffe-versenken (Online-Multiplayer, PWA)

Du bist ein erfahrener Fullstack- und Game-Entwickler mit Gespür für Mobile-UX und Game-Design. Baue ein vollständiges, spielbares Spiel nach der folgenden Spezifikation. Arbeite selbstständig, triff sinnvolle Entscheidungen, und teste am Ende alles gründlich.

## 1. Ziel
Ein Online-Multiplayer-Spiel im Stil von "Schiffe versenken", das sich deutlich von der klassischen Version abhebt: Cyberpunk-Look, futuristische Schiffe, Neon-Farben, Spezialwaffen und ein Energiesystem. Zwei Spieler spielen auf zwei Handys gegeneinander, verbunden per Link oder Raumcode. Das Spiel läuft im Mobile-Browser und ist als PWA installierbar (Zum Startbildschirm hinzufügen). Alles muss kostenlos hostbar sein (z. B. GitHub Pages, Netlify oder Cloudflare Pages), ohne eigenen kostenpflichtigen Server.

## 2. Technik
- **Stack:** Vite + TypeScript, ohne schweres Framework. Rendering des Spielfelds mit Canvas 2D (oder WebGL, falls es sich lohnt). UI-Menüs in HTML/CSS.
- **Hochauflösend:** Canvas konsequent mit `devicePixelRatio` skalieren, damit alles auf Retina-/High-DPI-Handys gestochen scharf ist. Schiffe und Effekte vektorbasiert bzw. prozedural zeichnen, keine verpixelten Bitmaps. Resize- und Orientierungswechsel sauber behandeln.
- **Multiplayer:** WebRTC über PeerJS (kostenloser Public-Broker, kein eigener Server nötig). Spieler 1 erstellt ein Spiel und bekommt einen 5-stelligen Raumcode, einen teilbaren Link (`?room=XXXXX`) und einen QR-Code. Spieler 2 öffnet den Link oder gibt den Code ein. Kapsle die Netzwerkschicht hinter einem Interface (`Transport`), damit man später z. B. auf Firebase oder WebSockets wechseln kann.
- **Robustheit:** Verbindungsabbruch erkennen, Reconnect mit demselben Raumcode ermöglichen, Spielzustand wiederherstellen. Zug-Timer optional (Standard 45 s).
- **Fairness:** Jeder Client hält sein eigenes Feld. Beim Platzieren wird ein Hash (Commitment) des Feldes samt Salt an den Gegner gesendet und nach Spielende zur Überprüfung aufgedeckt, damit keiner schummeln kann.
- **PWA:** Manifest, Service Worker, Icons, Vollbild, Portrait-Modus, installierbar. Das Spiel-Menü und Aufbau müssen offline starten (Multiplayer braucht Internet). Zusätzlich ein einfacher Offline-Modus gegen eine KI (siehe Abschnitt 7).
- **Sprache:** Deutsche Oberfläche, Texte in einer Übersetzungsdatei, damit später Englisch ergänzt werden kann.

## 3. Spielfeld und Flotte
- Feld: **15 × 15**.
- Flotte (je Spieler, 10 Schiffe, frei platzierbar, keine Berührung nötig):
  - 1× **Dreadnought** (Länge 6)
  - 1× **Carrier** (Länge 5)
  - 2× **Cruiser** (Länge 4)
  - 2× **Destroyer** (Länge 3)
  - 2× **Interceptor** (Länge 2)
  - 2× **Drone Skiff** (Länge 1)
- Platzieren per Drag and Drop mit Touch, Drehen per Tippen oder Button, Zufallsplatzierung per Knopf, "Bereit"-Knopf.
- Das 15×15-Feld muss auf dem Handy gut bedienbar sein: Pinch-Zoom und Verschieben, ausreichend große Touch-Zellen, ein Fadenkreuz-Cursor mit Bestätigen-Knopf, damit man nicht versehentlich falsch schießt. Koordinaten-Beschriftung (A–O, 1–15) im Neon-Stil.

## 4. Gameplay-Extras (das, was das Spiel besonders macht)
**Energiesystem:** Jeder Spieler hat ein Energiekonto. Pro Zug gibt es +1 Energie, ein Treffer +1 extra, ein versenktes Schiff +2 extra. Energie wird für Spezialaktionen ausgegeben. Maximal 10.

**Spezialaktionen** (jede mit Energiekosten und eigener Animation):
1. **Salve (3 Energie):** Schuss auf 3 Felder in einer Reihe oder Spalte.
2. **Radar-Scan (2 Energie):** Zeigt, ob in einem 3×3-Bereich Schiffsteile liegen, und wie viele (ohne genaue Positionen).
3. **Drohne (3 Energie):** Deckt ein einzelnes Feld des Gegners dauerhaft auf, ohne einen Schuss zu verbrauchen.
4. **EMP-Puls (4 Energie):** Stört ein 3×3-Gebiet. Der Gegner kann dort in seinem nächsten Zug nicht scannen oder Spezialaktionen nutzen, und das Gebiet wird für ihn markiert.
5. **Schutzschild (3 Energie):** Eines der eigenen Schiffe absorbiert den nächsten Treffer.
6. **Reparatur-Nanobots (4 Energie):** Stellt ein getroffenes Feld eines eigenen, noch nicht versenkten Schiffs wieder her.
7. **Phantom-Hologramm (2 Energie):** Platziert einen Köder, der auf dem Feld des Gegners wie ein Treffer aussieht (einmal pro Spiel einsetzbar).
8. **Sprung-Antrieb (5 Energie):** Teleportiert ein eigenes, noch unbeschädigtes Schiff an eine neue freie Position.

**Weitere Mechaniken:**
- **Minenfelder:** Beim Platzieren darf jeder Spieler 3 Minen setzen. Trifft der Gegner eine Mine, verliert er 2 Energie und der Zug endet. Minen werden nur durch Treffer sichtbar.
- **Zufalls-Events** (alle 8 Runden, für beide gleich, deutlich angekündigt): z. B. "Sonnensturm: alle Scans in dieser Runde ungenau", "Energie-Boost: +2 Energie für beide", "Blackout: Anzeige des eigenen Feldes 1 Runde ausgeblendet".
- **Combo-Bonus:** Wer 3 Treffer in Folge landet, bekommt +1 Extra-Schuss.
- Alle Werte (Kosten, Boni, Anzahl) in einer zentralen Konfigurationsdatei, damit ich sie leicht balancen kann.
- Optional ein Spielmodus-Schalter beim Erstellen eines Raums: "Klassisch" (ohne Extras) und "Cyber" (mit allen Extras).

## 5. Look and Feel (Cyberpunk)
- **Farbwelt:** Tiefschwarzer/dunkelvioletter Hintergrund, Neonpink (#ff2bd6), Cyan (#00f0ff), Neongelb, Neongrün, Violett. Leuchteffekte (Glow/Bloom), Scanlines, leichtes Rauschen, Grid-Raster im Hintergrund, subtile Glitch-Effekte bei Übergängen und Treffern.
- **Schiffe:** Futuristisch und prozedural gezeichnet, mit Neon-Konturen, Energiekernen, leuchtenden Triebwerken, Panzerplatten und Details. Jede Schiffsklasse erkennbar anders (Dreadnought massiv und eckig, Carrier mit Landedeck-Streifen, Interceptor schlank und spitz, Drone Skiff als kleine Scheibe). Eigene Schiffe in Cyan, getroffene Teile glühen rot/orange, versenkte Schiffe zerbrechen mit einer Animation.
- **Effekte:** Partikelexplosionen bei Treffern, Wasser- bzw. Energiewellen bei Fehlschüssen, Laser-/Raketen-Animationen für jede Spezialwaffe, Screenshake bei großen Treffern, pulsierende Fadenkreuze, Energieleiste mit leuchtendem Füllstand.
- **UI:** Typografie im Sci-Fi-Stil (z. B. Orbitron, Rajdhani oder Audiowide, per Google Fonts oder selbst gehostet), Hologramm-Panels mit Neon-Rahmen, haptisches Feedback per `navigator.vibrate`.
- **Sound:** Synthwave-artiger Soundtrack und Effekte per WebAudio generiert oder aus lizenzfreien Quellen. Stummschalten-Knopf, Standard moderat.
- Flüssige 60 FPS auf durchschnittlichen Handys. Effekte skalierbar (Grafikqualität niedrig/mittel/hoch).

## 6. Ablauf und Screens
1. **Startscreen:** Logo "NEON FLEET", Buttons "Spiel erstellen", "Spiel beitreten", "Gegen KI", "Anleitung", "Einstellungen".
2. **Lobby:** Raumcode, Link teilen (Web Share API), QR-Code, Status des Gegners.
3. **Flotte platzieren:** Mit Timer, danach "Bereit". Spiel startet, wenn beide bereit sind. Wer beginnt, wird per Zufall bestimmt.
4. **Kampf:** Gegnerfeld im Fokus, eigenes Feld als Minimap. Anzeige von Energie, Rundenzahl, Zug-Timer, Aktionsleiste unten mit den Spezialwaffen (gesperrt, wenn zu wenig Energie), Protokoll der letzten Aktionen.
5. **Ende:** Sieg-/Niederlagen-Screen mit Statistik (Trefferquote, versenkte Schiffe, eingesetzte Spezialaktionen), Aufdecken der gegnerischen Flotte, "Revanche"-Knopf.

## 7. KI-Gegner (Offline/Test)
Ein einfacher Computer-Gegner (leicht, mittel, schwer) mit Jagdmodus nach einem Treffer und Wahrscheinlichkeitskarte im schweren Modus. Er nutzt Spezialaktionen sinnvoll. Dient auch zum schnellen Testen allein.

## 8. Projektstruktur und Qualität
- Saubere Struktur: `src/game` (Regeln, reiner Spiellogik-Code ohne UI), `src/net` (Transport, Protokoll), `src/render` (Canvas, Effekte), `src/ui`, `src/ai`, `src/config`.
- Das Netzwerkprotokoll als typisierte Nachrichten definieren (z. B. `ready`, `shot`, `shotResult`, `special`, `specialResult`, `event`, `sync`, `reveal`). Die Spiellogik deterministisch halten.
- Unit-Tests für die Spielregeln (Platzieren, Treffer, Versenken, Spezialaktionen, Energie, Gewinnbedingung).
- Zwei Browserfenster bzw. zwei Geräte als Praxistest, dazu Mobile-Emulation. Prüfe insbesondere: Verbindungsaufbau, Reconnect, Touch-Bedienung, Zoom, Performance, Scharfstellung auf High-DPI.
- README mit: lokalem Start, Build, kostenlosem Deployment (GitHub Pages/Netlify Schritt für Schritt), Installation als PWA auf Android und iPhone, und wie man später mit Capacitor eine APK baut.

## 9. Vorgehen
1. Plane kurz die Architektur und das Netzwerkprotokoll.
2. Baue zuerst die reine Spiellogik mit Tests.
3. Dann Rendering und Platzierungs-UI.
4. Dann Multiplayer (PeerJS) mit Lobby und Reconnect.
5. Dann Spezialaktionen, Energie, Events und Minen.
6. Dann Look, Effekte, Sound und PWA.
7. Zum Schluss KI-Gegner, Politur, Tests, README.

Liefere nach jedem größeren Schritt einen lauffähigen Stand. Frage nur nach, wenn eine Entscheidung wirklich nicht sinnvoll selbst zu treffen ist. Am Ende: kurze Zusammenfassung, was fertig ist, wie ich es starte und deploye, und welche Ideen für Erweiterungen (z. B. Ranglisten, Skins, Kampagne) du siehst.
