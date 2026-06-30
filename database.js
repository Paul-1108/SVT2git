"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const schema = fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8");
const seed = fs.readFileSync(path.join(ROOT, "db", "seed.sql"), "utf8");

function migratePreviousVersion(db) {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'players'")
    .get();
  if (!table) return;

  const columns = db.prepare("PRAGMA table_info(players)").all();
  const oldModel = columns.some(
    (column) => column.name === "team_id" || column.name === "sort_order",
  );
  if (!oldModel) return;

  db.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
  try {
    db.exec("ALTER TABLE players RENAME TO players_previous");
    db.exec(schema);
    db.exec(`
      INSERT OR IGNORE INTO players (id, name, order_index, active, created_at)
      SELECT id, name, sort_order, active, created_at
      FROM players_previous
      ORDER BY sort_order, id
    `);
    db.exec(`
      DROP TABLE IF EXISTS duties;
      DROP TABLE IF EXISTS player_exceptions;
      DROP TABLE IF EXISTS teams;
      DROP TABLE IF EXISTS application_meta;
      DROP TABLE players_previous;
      COMMIT;
    `);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function createDatabase(filename) {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = new DatabaseSync(filename);
  migratePreviousVersion(db);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec(schema);

  const count = db.prepare("SELECT COUNT(*) AS count FROM players").get().count;
  if (count === 0) {
    db.exec(`BEGIN IMMEDIATE; ${seed} COMMIT;`);
  }
  db.exec(`
    INSERT OR IGNORE INTO rotation_state (
      id,
      next_player_id,
      last_generated_week
    )
    SELECT 1, id, NULL
    FROM players
    ORDER BY order_index, id
    LIMIT 1
  `);
  return db;
}

function toPlayer(row) {
  return {
    id: row.id,
    name: row.name,
    order_index: row.order_index,
    active: Boolean(row.active),
    created_at: row.created_at,
  };
}

module.exports = { createDatabase, toPlayer };
