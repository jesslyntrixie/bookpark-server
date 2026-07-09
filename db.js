// db.js
// SQLite persistence for JasJus, using better-sqlite3 (synchronous API).
// This module owns the database: it creates the tables and exposes small
// functions so server.js never writes raw SQL. Data survives restarts.

import Database from "better-sqlite3";

// Opens (or creates) the database file. Path is configurable via DB_PATH so it
// can point at a mounted volume in Docker; defaults to jasjus.db locally.
const db = new Database(process.env.DB_PATH || "jasjus.db");
db.pragma("journal_mode = WAL"); // better concurrency + durability

// --- Schema (runs once; IF NOT EXISTS makes it safe on every boot) ----------
//
// A booking reserves a TIME WINDOW [startTime, endTime]. It auto-ends when
// endTime passes. The actual in/out times are NOT stored on the booking — they
// live in the events table (one row per physical in/out), linked by bookingId.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ownerId INTEGER NOT NULL,
    plate   TEXT NOT NULL,
    FOREIGN KEY (ownerId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    INTEGER NOT NULL,
    vehicleId INTEGER NOT NULL,
    flapId    TEXT NOT NULL,
    state     TEXT NOT NULL,           -- booked | active | done | cancelled
    startTime INTEGER NOT NULL,        -- reservation start (epoch s)
    endTime   INTEGER NOT NULL,        -- planned end (epoch s); auto-ends here
    FOREIGN KEY (userId)    REFERENCES users(id),
    FOREIGN KEY (vehicleId) REFERENCES vehicles(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    bookingId INTEGER,                 -- which booking this in/out belongs to
    flapId    TEXT NOT NULL,
    action    TEXT NOT NULL,           -- 'in' | 'out'
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (bookingId) REFERENCES bookings(id)
  );
`);

// --- Users -----------------------------------------------------------------
const _insertUser = db.prepare("INSERT INTO users (name) VALUES (?)");
const _getUser = db.prepare("SELECT * FROM users WHERE id = ?");

export function createUser(name) {
  return getUser(_insertUser.run(name).lastInsertRowid);
}
export function getUser(id) {
  return _getUser.get(id) || null;
}

// --- Vehicles --------------------------------------------------------------
const _insertVehicle = db.prepare("INSERT INTO vehicles (ownerId, plate) VALUES (?, ?)");
const _getVehicle = db.prepare("SELECT * FROM vehicles WHERE id = ?");
const _vehiclesByOwner = db.prepare("SELECT * FROM vehicles WHERE ownerId = ?");

export function createVehicle(ownerId, plate) {
  return getVehicle(_insertVehicle.run(ownerId, plate).lastInsertRowid);
}
export function getVehicle(id) {
  return _getVehicle.get(id) || null;
}
export function vehiclesByOwner(ownerId) {
  return _vehiclesByOwner.all(ownerId);
}

// --- Bookings --------------------------------------------------------------
const _insertBooking = db.prepare(`
  INSERT INTO bookings (userId, vehicleId, flapId, state, startTime, endTime)
  VALUES (?, ?, ?, 'booked', ?, ?)
`);
const _getBooking = db.prepare("SELECT * FROM bookings WHERE id = ?");
const _setState = db.prepare("UPDATE bookings SET state = ? WHERE id = ?");
// "Live" = booked/active AND still within its window (endTime not yet passed).
const _activeBooking = db.prepare(
  "SELECT * FROM bookings WHERE state IN ('booked','active') AND endTime > ? LIMIT 1"
);
const _userLiveBooking = db.prepare(
  "SELECT * FROM bookings WHERE userId = ? AND state IN ('booked','active') AND endTime > ? LIMIT 1"
);
// Bookings whose window has ended but state hasn't caught up — auto-end these.
const _finishedBookings = db.prepare(
  "SELECT * FROM bookings WHERE state IN ('booked','active') AND endTime <= ?"
);

export function createBooking(userId, vehicleId, flapId, startTime, endTime) {
  return getBooking(_insertBooking.run(userId, vehicleId, flapId, startTime, endTime).lastInsertRowid);
}
export function getBooking(id) {
  return _getBooking.get(id) || null;
}
export function setBookingState(id, state) {
  _setState.run(state, id);
  return getBooking(id);
}
export function getActiveBooking(nowTs) {
  return _activeBooking.get(nowTs) || null;
}
export function getUserLiveBooking(userId, nowTs) {
  return _userLiveBooking.get(userId, nowTs) || null;
}
export function getFinishedBookings(nowTs) {
  return _finishedBookings.all(nowTs);
}

// --- Events (the in/out log; also the source of actual arrival/leave times) --
const _insertEvent = db.prepare(
  "INSERT INTO events (bookingId, flapId, action, timestamp) VALUES (?, ?, ?, ?)"
);
// A booking can have MANY in/out rows (driver comes and goes). Duration spans
// the FIRST 'in' to the LAST 'out', so we fetch the earliest/latest of each.
const _firstEvent = db.prepare(
  "SELECT timestamp FROM events WHERE bookingId = ? AND action = ? ORDER BY id ASC LIMIT 1"
);
const _lastEvent = db.prepare(
  "SELECT timestamp FROM events WHERE bookingId = ? AND action = ? ORDER BY id DESC LIMIT 1"
);

export function addEvent(bookingId, flapId, action, timestamp) {
  _insertEvent.run(bookingId, flapId, action, timestamp);
}
export function getFirstEventTime(bookingId, action) {
  const row = _firstEvent.get(bookingId, action);
  return row ? row.timestamp : null;
}
export function getLastEventTime(bookingId, action) {
  const row = _lastEvent.get(bookingId, action);
  return row ? row.timestamp : null;
}

export default db;
