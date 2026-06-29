CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  order_index INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_players_order
  ON players(active, order_index, id);

CREATE TABLE IF NOT EXISTS swaps (
  id INTEGER PRIMARY KEY,
  original_player_id INTEGER NOT NULL REFERENCES players(id),
  replacement_player_id INTEGER NOT NULL REFERENCES players(id),
  first_week_start TEXT NOT NULL,
  second_week_start TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (original_player_id <> replacement_player_id),
  CHECK (second_week_start > first_week_start)
);

CREATE INDEX IF NOT EXISTS idx_swaps_weeks
  ON swaps(first_week_start, second_week_start);
