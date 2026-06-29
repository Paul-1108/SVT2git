# Materialdienst

Kleine serverbasierte Materialdienst-App mit Node.js, normalem
HTML/CSS/JavaScript und SQLite. Es werden keine zusätzlichen Pakete benötigt.

## Start

Voraussetzung ist Node.js ab Version 22.5.

```powershell
npm start
```

Die Anwendung ist anschließend unter <http://localhost:3000> erreichbar. Beim
ersten Start wird `data/materialdienst.sqlite` angelegt und mit der bisherigen
Spielerliste befüllt.

Tests:

```powershell
npm test
```

## Bewusst einfaches Datenmodell

Es gibt zwei kleine fachliche Tabellen:

```text
players
  id
  name
  order_index
  active
  created_at

swaps
  id
  original_player_id
  replacement_player_id
  first_week_start
  second_week_start
  created_at
```

Der Materialdienst wird nicht in einer zweiten Tabelle gespeichert. Das Backend
sortiert alle aktiven Spieler nach `order_index` und wählt anhand der
Kalenderwoche jeweils drei aufeinanderfolgende Spieler aus. Die Rotation beginnt
fest am **29.06.2026 (KW 27)** mit den ersten drei Spielern und läuft von dort
wochenweise weiter – auch über Jahresgrenzen hinweg.

Beispiel:

```text
KW 27/2026 → Position 1–3
KW 28/2026 → Position 4–6
KW 29/2026 → Position 7–9
```

Nach dem letzten Spieler beginnt die Liste wieder von vorne. Änderungen an
Spielern oder ihrer Reihenfolge wirken sich deshalb direkt auf die Berechnung
aus.

Bei einem einmaligen Tausch übernimmt Spieler B zunächst den Dienst von Spieler
A. Das Backend sucht automatisch den nächsten regulären Dienst von B und setzt
dort A ein. Danach läuft die unveränderte Grundrotation weiter. Der Tausch kann
in beiden betroffenen Wochen über die Oberfläche wieder gelöscht werden.

Eine Datenbank aus der vorherigen Serverversion wird beim Start automatisch auf
dieses einfache Modell reduziert. Vorhandene Spieler bleiben erhalten.

## API

| Methode | Pfad | Funktion |
| --- | --- | --- |
| `GET` | `/api/materialdienst/current` | Aktueller Materialdienst |
| `GET` | `/api/materialdienst?year=2026&week=27` | Dienst einer Woche |
| `GET` | `/api/players` | Aktive Spieler |
| `GET` | `/api/players?include_inactive=true` | Alle Spieler |
| `POST` | `/api/players` | Spieler hinzufügen |
| `PUT` | `/api/players/:id` | Spieler bearbeiten |
| `DELETE` | `/api/players/:id` | Spieler deaktivieren |
| `POST` | `/api/swaps` | Einmaligen Tausch anlegen |
| `DELETE` | `/api/swaps/:id` | Tausch rückgängig machen |

Die Oberfläche nutzt ausschließlich diese API. Eine lokale `players.js` gibt
es nicht mehr.
