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

## Datenmodell

Die Rotation besteht aus vier kleinen Tabellen:

```text
players
  id
  name
  order_index
  active
  created_at

rotation_state
  next_player_id
  last_generated_week

assignments
  week_start
  position
  player_id

swaps
  id
  original_player_id
  replacement_player_id
  first_week_start
  second_week_start
  created_at
```

Die Rotation beginnt fest am **29.06.2026 (KW 27)**. `rotation_state` ist der
persistente „Redeball“ und zeigt auf den nächsten Spieler im Ring. Pro Woche
wird der Ball drei Positionen weitergereicht. Am Listenende läuft er wieder bei
der ersten Position weiter.

Beispiel:

```text
KW 27/2026 → Position 1–3
KW 28/2026 → Position 4–6
KW 29/2026 → Position 7–9
```

Bereits erreichte Wochen werden in `assignments` festgeschrieben. Dadurch
verschieben sich vergangene Einteilungen nicht, wenn sich die Spielerliste
ändert:

- Neue Spieler werden am Ende des Rings ergänzt.
- Deaktivierte Spieler bleiben an ihrer Position, werden beim Weiterreichen
  aber übersprungen.
- Eine Reaktivierung nimmt wieder an der vorhandenen Ringposition teil.
- Zukünftige Wochen sind nur eine Vorschau und bewegen den gespeicherten Ball
  nicht.

Bei einem einmaligen Tausch übernimmt Spieler B zunächst den Dienst von Spieler
A. Das Backend sucht automatisch den nächsten regulären Dienst von B und setzt
dort A ein. Danach läuft die unveränderte Grundrotation weiter. Der Tausch kann
in beiden betroffenen Wochen über die Oberfläche wieder gelöscht werden. Weil
ein Tausch verbindlich ist, werden die Grundzuweisungen bis zum Rücktausch
reserviert.

Eine Datenbank aus einer vorherigen Serverversion wird beim Start automatisch
erweitert. Vorhandene Spieler bleiben erhalten.

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
