const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "vehicle.db");

let _db = null;

function save() {
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

const ready = initSqlJs().then((SQL) => {
  if (fs.existsSync(DB_PATH)) {
    _db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    _db = new SQL.Database();
  }

  _db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE,
      password    TEXT NOT NULL,
      phone       TEXT,
      location    TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL,
      nickname         TEXT,
      make             TEXT NOT NULL,
      model            TEXT NOT NULL,
      year             INTEGER,
      plate_number     TEXT NOT NULL,
      color            TEXT,
      current_mileage  INTEGER NOT NULL DEFAULT 0,
      fuel_type        TEXT NOT NULL DEFAULT 'petrol',
      vin              TEXT,
      is_default       INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
  `);

  save();
  console.log(`[vehicle-service] SQLite ready — ${DB_PATH}`);
  return _db;
});

function getDb() {
  if (!_db) throw new Error("DB not initialised yet");
  return _db;
}

/** Run a write statement and immediately persist to disk */
function run(sql, params = []) {
  getDb().run(sql, params);
  save();
}

/** Return all matching rows as plain objects */
function all(sql, params = []) {
  const stmt = getDb().prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/** Return first matching row or undefined */
function get(sql, params = []) {
  return all(sql, params)[0];
}

module.exports = { ready, run, all, get };
