"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { createDatabase, toPlayer } = require("./database");

const ROOT = __dirname;
const DEFAULT_DB = path.join(ROOT, "data", "materialdienst.sqlite");
const ROTATION_START = "2026-06-29";
const MILLISECONDS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/rsc/logo.svg", ["rsc/logo.svg", "image/svg+xml"]],
  ["/rsc/logoblack.svg", ["rsc/logoblack.svg", "image/svg+xml"]],
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        reject(new HttpError(413, "Anfrage ist zu groß."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new HttpError(400, "Ungültiges JSON."));
      }
    });
    request.on("error", reject);
  });
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function isoWeekForDate(dateString) {
  if (dateString && !validDate(dateString)) {
    throw new HttpError(400, "Datum muss das Format JJJJ-MM-TT haben.");
  }
  const date = dateString ? new Date(`${dateString}T12:00:00Z`) : new Date();
  const day = date.getUTCDay() || 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day + 1);

  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();

  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 4);
  const week =
    1 + Math.round((thursday - firstThursday) / (7 * 24 * 60 * 60 * 1000));

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    year,
    week,
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}

function isoWeekFromNumbers(yearValue, weekValue) {
  const year = Number(yearValue);
  const week = Number(weekValue);
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    !Number.isInteger(week) ||
    week < 1 ||
    week > 53
  ) {
    throw new HttpError(400, "Jahr oder Kalenderwoche ist ungültig.");
  }

  const januaryFourth = new Date(Date.UTC(year, 0, 4, 12));
  const day = januaryFourth.getUTCDay() || 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - day + 1 + (week - 1) * 7);
  const result = isoWeekForDate(monday.toISOString().slice(0, 10));
  if (result.year !== year || result.week !== week) {
    throw new HttpError(400, `Das Jahr ${year} hat keine Kalenderwoche ${week}.`);
  }
  return result;
}

function basePlayersForPeriod(db, period) {
  const players = db
    .prepare(
      "SELECT * FROM players WHERE active = 1 ORDER BY order_index, id",
    )
    .all();
  if (players.length < 3) {
    throw new HttpError(
      422,
      "Für den Materialdienst werden mindestens drei aktive Spieler benötigt.",
    );
  }

  const weeksSinceStart = Math.round(
    (Date.parse(`${period.weekStart}T00:00:00Z`) -
      Date.parse(`${ROTATION_START}T00:00:00Z`)) /
      MILLISECONDS_PER_WEEK,
  );
  const firstIndex =
    ((weeksSinceStart * 3) % players.length + players.length) % players.length;
  return [0, 1, 2].map((offset) =>
    toPlayer(players[(firstIndex + offset) % players.length]),
  );
}

function swapsForWeek(db, weekStart) {
  return db
    .prepare(
      `SELECT
         s.*,
         original.name AS original_name,
         replacement.name AS replacement_name
       FROM swaps s
       JOIN players original ON original.id = s.original_player_id
       JOIN players replacement ON replacement.id = s.replacement_player_id
       WHERE s.first_week_start = ? OR s.second_week_start = ?
       ORDER BY s.id`,
    )
    .all(weekStart, weekStart)
    .map((swap) => ({
      id: swap.id,
      original_player_id: swap.original_player_id,
      original_player_name: swap.original_name,
      replacement_player_id: swap.replacement_player_id,
      replacement_player_name: swap.replacement_name,
      first_week_start: swap.first_week_start,
      second_week_start: swap.second_week_start,
    }));
}

function calculateMaterialDuty(db, period) {
  const basePlayers = basePlayersForPeriod(db, period);
  const appliedSwaps = swapsForWeek(db, period.weekStart);
  const selected = basePlayers.map((basePlayer, index) => {
    let player = basePlayer;
    let appliedSwap;

    for (const swap of appliedSwaps) {
      const isFirstWeek = swap.first_week_start === period.weekStart;
      const playerToReplace = isFirstWeek
        ? swap.original_player_id
        : swap.replacement_player_id;
      const replacementId = isFirstWeek
        ? swap.replacement_player_id
        : swap.original_player_id;
      if (basePlayer.id !== playerToReplace) continue;

      const row = db.prepare("SELECT * FROM players WHERE id = ?").get(replacementId);
      if (row) {
        player = toPlayer(row);
        appliedSwap = swap;
      }
    }

    return {
      ...player,
      position: index + 1,
      scheduled_player: appliedSwap ? basePlayer : null,
      swap_id: appliedSwap?.id || null,
    };
  });

  return {
    calendarWeek: period.week,
    year: period.year,
    weekStart: period.weekStart,
    weekEnd: period.weekEnd,
    rotationStart: ROTATION_START,
    basePlayers,
    players: selected,
    appliedSwaps,
  };
}

function weekConflict(db, weekStart) {
  return db
    .prepare(
      `SELECT id FROM swaps
       WHERE first_week_start = ? OR second_week_start = ?
       LIMIT 1`,
    )
    .get(weekStart, weekStart);
}

function createSwap(db, body) {
  const period = isoWeekFromNumbers(body.year, body.week);
  const originalId = Number(body.original_player_id);
  const replacementId = Number(body.replacement_player_id);
  if (
    !Number.isSafeInteger(originalId) ||
    !Number.isSafeInteger(replacementId)
  ) {
    throw new HttpError(400, "Beide Spieler müssen ausgewählt werden.");
  }

  const basePlayers = basePlayersForPeriod(db, period);
  const original = basePlayers.find((player) => player.id === originalId);
  if (!original) {
    throw new HttpError(
      400,
      "Der abgebende Spieler ist in dieser Woche nicht regulär eingeteilt.",
    );
  }
  const replacementRow = db
    .prepare("SELECT * FROM players WHERE id = ? AND active = 1")
    .get(replacementId);
  if (!replacementRow) {
    throw new HttpError(404, "Der Ersatzspieler wurde nicht gefunden.");
  }
  if (basePlayers.some((player) => player.id === replacementId)) {
    throw new HttpError(
      400,
      "Der Ersatzspieler ist in dieser Woche bereits eingeteilt.",
    );
  }
  if (weekConflict(db, period.weekStart)) {
    throw new HttpError(409, "Für diese Woche besteht bereits ein Tausch.");
  }

  let returnPeriod;
  const searchStart = Date.parse(`${period.weekStart}T00:00:00Z`);
  const playerCount = db
    .prepare("SELECT COUNT(*) AS count FROM players WHERE active = 1")
    .get().count;
  for (let offset = 1; offset <= playerCount * 2; offset += 1) {
    const candidateDate = new Date(searchStart + offset * MILLISECONDS_PER_WEEK);
    const candidate = isoWeekForDate(candidateDate.toISOString().slice(0, 10));
    const candidatePlayers = basePlayersForPeriod(db, candidate);
    const hasReplacement = candidatePlayers.some(
      (player) => player.id === replacementId,
    );
    if (!hasReplacement) continue;

    const alsoHasOriginal = candidatePlayers.some(
      (player) => player.id === originalId,
    );
    if (alsoHasOriginal) {
      throw new HttpError(
        409,
        `${original.name} ist beim nächsten Dienst von ` +
          `${replacementRow.name} selbst bereits eingeteilt.`,
      );
    }
    if (weekConflict(db, candidate.weekStart)) {
      throw new HttpError(
        409,
        `Beim nächsten Dienst von ${replacementRow.name} besteht bereits ein Tausch.`,
      );
    }
    returnPeriod = candidate;
    break;
  }
  if (!returnPeriod) {
    throw new HttpError(
      409,
      "Für den Ersatzspieler konnte kein freier Rücktausch-Termin gefunden werden.",
    );
  }

  const result = db
    .prepare(
      `INSERT INTO swaps (
         original_player_id,
         replacement_player_id,
         first_week_start,
         second_week_start
       ) VALUES (?, ?, ?, ?)`,
    )
    .run(originalId, replacementId, period.weekStart, returnPeriod.weekStart);

  return {
    id: Number(result.lastInsertRowid),
    original_player_id: originalId,
    original_player_name: original.name,
    replacement_player_id: replacementId,
    replacement_player_name: replacementRow.name,
    first_week: {
      year: period.year,
      week: period.week,
      week_start: period.weekStart,
    },
    second_week: {
      year: returnPeriod.year,
      week: returnPeriod.week,
      week_start: returnPeriod.weekStart,
    },
  };
}

function createRequestHandler(db) {
  return async function handler(request, response) {
    const url = new URL(request.url, "http://localhost");

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json(response, 200, { status: "ok" });
      }

      if (url.pathname === "/api/players" && request.method === "GET") {
        const includeInactive =
          url.searchParams.get("include_inactive") === "true";
        const rows = db
          .prepare(
            `SELECT * FROM players
             ${includeInactive ? "" : "WHERE active = 1"}
             ORDER BY order_index, id`,
          )
          .all();
        return json(response, 200, { players: rows.map(toPlayer) });
      }

      if (url.pathname === "/api/players" && request.method === "POST") {
        const body = await readJson(request);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || name.length > 100) {
          throw new HttpError(400, "Name muss zwischen 1 und 100 Zeichen lang sein.");
        }
        const nextIndex = db
          .prepare("SELECT COALESCE(MAX(order_index), 0) + 1 AS value FROM players")
          .get().value;
        try {
          const result = db
            .prepare("INSERT INTO players (name, order_index) VALUES (?, ?)")
            .run(name, nextIndex);
          const player = db
            .prepare("SELECT * FROM players WHERE id = ?")
            .get(result.lastInsertRowid);
          return json(response, 201, { player: toPlayer(player) });
        } catch (error) {
          if (String(error.message).includes("UNIQUE")) {
            throw new HttpError(409, "Dieser Spieler ist bereits vorhanden.");
          }
          throw error;
        }
      }

      const playerMatch = url.pathname.match(/^\/api\/players\/(\d+)$/);
      if (playerMatch && request.method === "PUT") {
        const id = Number(playerMatch[1]);
        const existing = db.prepare("SELECT * FROM players WHERE id = ?").get(id);
        if (!existing) throw new HttpError(404, "Spieler wurde nicht gefunden.");

        const body = await readJson(request);
        if (body.name !== undefined && typeof body.name !== "string") {
          throw new HttpError(400, "Name muss Text sein.");
        }
        if (body.active !== undefined && typeof body.active !== "boolean") {
          throw new HttpError(400, "Aktivstatus muss true oder false sein.");
        }
        if (
          body.order_index !== undefined &&
          (!Number.isInteger(body.order_index) || body.order_index < 0)
        ) {
          throw new HttpError(400, "Reihenfolge ist ungültig.");
        }

        const name = body.name === undefined ? existing.name : body.name.trim();
        const active =
          body.active === undefined ? existing.active : body.active ? 1 : 0;
        const orderIndex =
          body.order_index === undefined ? existing.order_index : body.order_index;
        if (!name || name.length > 100) {
          throw new HttpError(400, "Name muss zwischen 1 und 100 Zeichen lang sein.");
        }

        try {
          db.prepare(
            "UPDATE players SET name = ?, active = ?, order_index = ? WHERE id = ?",
          ).run(name, active, orderIndex, id);
        } catch (error) {
          if (String(error.message).includes("UNIQUE")) {
            throw new HttpError(409, "Dieser Spieler ist bereits vorhanden.");
          }
          throw error;
        }
        const player = db.prepare("SELECT * FROM players WHERE id = ?").get(id);
        return json(response, 200, { player: toPlayer(player) });
      }

      if (playerMatch && request.method === "DELETE") {
        const result = db
          .prepare("UPDATE players SET active = 0 WHERE id = ?")
          .run(Number(playerMatch[1]));
        if (!result.changes) throw new HttpError(404, "Spieler wurde nicht gefunden.");
        response.writeHead(204);
        return response.end();
      }

      if (url.pathname === "/api/swaps" && request.method === "POST") {
        const body = await readJson(request);
        return json(response, 201, { swap: createSwap(db, body) });
      }

      const swapMatch = url.pathname.match(/^\/api\/swaps\/(\d+)$/);
      if (swapMatch && request.method === "DELETE") {
        const result = db
          .prepare("DELETE FROM swaps WHERE id = ?")
          .run(Number(swapMatch[1]));
        if (!result.changes) throw new HttpError(404, "Tausch wurde nicht gefunden.");
        response.writeHead(204);
        return response.end();
      }

      if (
        url.pathname === "/api/materialdienst/current" &&
        request.method === "GET"
      ) {
        return json(response, 200, calculateMaterialDuty(db, isoWeekForDate()));
      }

      if (url.pathname === "/api/materialdienst" && request.method === "GET") {
        const period = isoWeekFromNumbers(
          url.searchParams.get("year"),
          url.searchParams.get("week"),
        );
        return json(response, 200, calculateMaterialDuty(db, period));
      }

      if (url.pathname.startsWith("/api/")) {
        throw new HttpError(404, "API-Endpunkt wurde nicht gefunden.");
      }

      const staticFile = STATIC_FILES.get(url.pathname);
      if (!staticFile || request.method !== "GET") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return response.end("Nicht gefunden");
      }
      const [relativePath, contentType] = staticFile;
      const content = fs.readFileSync(path.join(ROOT, relativePath));
      response.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": content.length,
      });
      return response.end(content);
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) console.error(error);
      return json(response, status, {
        error: status === 500 ? "Interner Serverfehler." : error.message,
      });
    }
  };
}

function startServer(options = {}) {
  const db = options.db || createDatabase(options.dbPath || DEFAULT_DB);
  const server = http.createServer(createRequestHandler(db));
  const port = options.port ?? Number(process.env.PORT || 3000);
  server.listen(port, options.host || "127.0.0.1");
  return { server, db };
}

if (require.main === module) {
  const { server } = startServer();
  server.on("listening", () => {
    console.log(`Materialdienst läuft auf http://localhost:${server.address().port}`);
  });
}

module.exports = {
  calculateMaterialDuty,
  createSwap,
  createRequestHandler,
  isoWeekForDate,
  isoWeekFromNumbers,
  startServer,
};
