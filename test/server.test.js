"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");
const { createDatabase } = require("../database");
const {
  isoWeekForDate,
  isoWeekFromNumbers,
  startServer,
} = require("../server");

let db;
let server;
let baseUrl;

before(async () => {
  db = createDatabase(":memory:");
  ({ server } = startServer({ db, port: 0 }));
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  db.close();
});

async function request(route, options) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { "Content-Type": "application/json" },
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

test("berechnet ISO-Wochen korrekt", () => {
  assert.deepEqual(isoWeekForDate("2025-12-31"), {
    year: 2026,
    week: 1,
    weekStart: "2025-12-29",
    weekEnd: "2026-01-04",
  });
  assert.deepEqual(isoWeekFromNumbers(2026, 1), {
    year: 2026,
    week: 1,
    weekStart: "2025-12-29",
    weekEnd: "2026-01-04",
  });
});

test("liefert die Spielerliste aus der einzigen Datentabelle", async () => {
  const { response, body } = await request("/api/players");
  assert.equal(response.status, 200);
  assert.equal(body.players.length, 32);
  assert.equal(body.players[11].name, "Lennard Grüner");
  assert.equal(body.players[11].order_index, 12);
});

test("liefert das Frontend mit der neuen API-Anbindung aus", async () => {
  const page = await fetch(`${baseUrl}/`);
  const script = await fetch(`${baseUrl}/app.js`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Materialdienst<\/title>/);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /\/api\/materialdienst\?year=/);
});

test("startet die Rotation am 29.06.2026 mit den ersten Spielern", async () => {
  const { response, body } = await request(
    "/api/materialdienst?year=2026&week=27",
  );
  assert.equal(response.status, 200);
  assert.equal(body.calendarWeek, 27);
  assert.equal(body.year, 2026);
  assert.equal(body.rotationStart, "2026-06-29");
  assert.deepEqual(
    body.players.map((player) => player.name),
    ["Andre", "Brian", "Elia"],
  );
  assert.deepEqual(
    body.players.map((player) => player.position),
    [1, 2, 3],
  );
});

test("rückt ab dem Startdatum jede Woche drei Spieler weiter", async () => {
  const firstWeek = await request(
    "/api/materialdienst?year=2026&week=28",
  );
  assert.deepEqual(
    firstWeek.body.players.map((player) => player.name),
    ["Felix", "Flo", "Georg"],
  );

  const nextYear = await request(
    "/api/materialdienst?year=2027&week=1",
  );
  assert.equal(nextYear.response.status, 200);
  assert.equal(nextYear.body.players.length, 3);
});

test("tauscht einmal hin und beim nächsten Dienst zurück", async () => {
  const created = await request("/api/swaps", {
    method: "POST",
    body: JSON.stringify({
      year: 2026,
      week: 27,
      original_player_id: 1,
      replacement_player_id: 4,
    }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.swap.first_week.week, 27);
  assert.equal(created.body.swap.second_week.week, 28);

  const firstWeek = await request(
    "/api/materialdienst?year=2026&week=27",
  );
  assert.deepEqual(
    firstWeek.body.players.map((player) => player.name),
    ["Felix", "Brian", "Elia"],
  );
  assert.equal(firstWeek.body.players[0].scheduled_player.name, "Andre");

  const returnWeek = await request(
    "/api/materialdienst?year=2026&week=28",
  );
  assert.deepEqual(
    returnWeek.body.players.map((player) => player.name),
    ["Andre", "Flo", "Georg"],
  );
  assert.equal(returnWeek.body.players[0].scheduled_player.name, "Felix");

  const normalWeek = await request(
    "/api/materialdienst?year=2026&week=29",
  );
  assert.deepEqual(
    normalWeek.body.players.map((player) => player.name),
    ["Jakob", "Jan", "Janick"],
  );

  const removed = await request(`/api/swaps/${created.body.swap.id}`, {
    method: "DELETE",
  });
  assert.equal(removed.response.status, 204);

  const restored = await request(
    "/api/materialdienst?year=2026&week=27",
  );
  assert.deepEqual(
    restored.body.players.map((player) => player.name),
    ["Andre", "Brian", "Elia"],
  );
});

test("verhindert einen Rücktausch mit doppelter Einteilung", async () => {
  const { response, body } = await request("/api/swaps", {
    method: "POST",
    body: JSON.stringify({
      year: 2026,
      week: 27,
      original_player_id: 1,
      replacement_player_id: 32,
    }),
  });
  assert.equal(response.status, 409);
  assert.match(body.error, /selbst bereits eingeteilt/);
});

test("legt Spieler an und bearbeitet ihn", async () => {
  const created = await request("/api/players", {
    method: "POST",
    body: JSON.stringify({ name: "Test Spieler" }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.player.order_index, 33);

  const updated = await request(`/api/players/${created.body.player.id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: "Testspieler",
      active: false,
      order_index: 2,
    }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.player.name, "Testspieler");
  assert.equal(updated.body.player.active, false);
  assert.equal(updated.body.player.order_index, 2);
});

test("weist eine nicht vorhandene KW 53 zurück", async () => {
  const { response, body } = await request(
    "/api/materialdienst?year=2025&week=53",
  );
  assert.equal(response.status, 400);
  assert.match(body.error, /keine Kalenderwoche 53/);
});

test("migriert Spieler aus der vorherigen Version", () => {
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "materialdienst-test-"),
  );
  const filename = path.join(tempDirectory, "test.sqlite");
  let localDb = new DatabaseSync(filename);

  try {
    localDb.exec(`
      CREATE TABLE players (
        id INTEGER PRIMARY KEY,
        team_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        active INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO players
        (id, team_id, name, active, sort_order, created_at)
      VALUES
        (7, 1, 'Migrierter Spieler', 1, 4, '2026-01-01 12:00:00');
    `);
    localDb.close();
    localDb = undefined;

    localDb = createDatabase(filename);
    const player = localDb
      .prepare("SELECT * FROM players WHERE id = 7")
      .get();
    const tables = localDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);

    assert.equal(player.name, "Migrierter Spieler");
    assert.equal(player.order_index, 4);
    assert.deepEqual(tables, ["players", "swaps"]);
  } finally {
    localDb?.close();
    for (const entry of fs.readdirSync(tempDirectory)) {
      fs.unlinkSync(path.join(tempDirectory, entry));
    }
    fs.rmdirSync(tempDirectory);
  }
});
