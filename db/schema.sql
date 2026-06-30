CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  order_index INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_players_order
  ON players(active, order_index, id);

CREATE TABLE IF NOT EXISTS rotation_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_player_id INTEGER REFERENCES players(id),
  last_generated_week TEXT
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY,
  week_start TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 3),
  player_id INTEGER NOT NULL REFERENCES players(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (week_start, position)
);

CREATE INDEX IF NOT EXISTS idx_assignments_week
  ON assignments(week_start, position);

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
