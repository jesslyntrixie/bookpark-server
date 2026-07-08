// db.js
// SQLite persistence for JasJus, using better-sqlite3 (synchronous API).
// This module owns the database: it creates the tables and exposes small
// functions so server.js never writes raw SQL. Data now survives restarts.

import Database from "better-sqlite3";

// Opens (or creates) the file jasjus.db in the project folder.
const db = new Database("jasjus.db");
db.pragma("journal_mode = WAL"); // better concurrency + durability

// --- Schema (runs once; IF NOT EXISTS makes it safe on every boot) ----------
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
    state     TEXT NOT NULL,
    startTime INTEGER NOT NULL,
    expiry    INTEGER NOT NULL,
    endTime   INTEGER,
    FOREIGN KEY (userId)    REFERENCES users(id),
    FOREIGN KEY (vehicleId) REFERENCES vehicles(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    flapId    TEXT NOT NULL,
    action    TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
`);

// --- Users -----------------------------------------------------------------
const _insertUser = db.prepare("INSERT INTO users (name) VALUES (?)");
const _getUser = db.prepare("SELECT * FROM users WHERE id = ?");

export function createUser(name) {
  const info = _insertUser.run(name);
  return getUser(info.lastInsertRowid);
}
export function getUser(id) {
  return _getUser.get(id) || null;
}

// --- Vehicles --------------------------------------------------------------
const _insertVehicle = db.prepare("INSERT INTO vehicles (ownerId, plate) VALUES (?, ?)");
const _getVehicle = db.prepare("SELECT * FROM vehicles WHERE id = ?");
const _vehiclesByOwner = db.prepare("SELECT * FROM vehicles WHERE ownerId = ?");

export function createVehicle(ownerId, plate) {
  const info = _insertVehicle.run(ownerId, plate);
  return getVehicle(info.lastInsertRowid);
}
export function getVehicle(id) {
  return _getVehicle.get(id) || null;
}
export function vehiclesByOwner(ownerId) {
  return _vehiclesByOwner.all(ownerId);
}

// --- Bookings --------------------------------------------------------------
const _insertBooking = db.prepare(`
  INSERT INTO bookings (userId, vehicleId, flapId, state, startTime, expiry, endTime)
  VALUES (?, ?, ?, 'booked', ?, ?, NULL)
`);
const _getBooking = db.prepare("SELECT * FROM bookings WHERE id = ?");
const _setState = db.prepare("UPDATE bookings SET state = ? WHERE id = ?");
const _closeBooking = db.prepare("UPDATE bookings SET state = 'done', endTime = ? WHERE id = ?");
// The one "live" booking for this single-flap PoC (booked or active).
const _activeBooking = db.prepare(
  "SELECT * FROM bookings WHERE state IN ('booked','active') LIMIT 1"
);
const _userLiveBooking = db.prepare(
  "SELECT * FROM bookings WHERE userId = ? AND state IN ('booked','active') LIMIT 1"
);
const _expiredBookings = db.prepare(
  "SELECT * FROM bookings WHERE state = 'booked' AND expiry < ?"
);

export function createBooking(userId, vehicleId, flapId, startTime, expiry) {
  const info = _insertBooking.run(userId, vehicleId, flapId, startTime, expiry);
  return getBooking(info.lastInsertRowid);
}
export function getBooking(id) {
  return _getBooking.get(id) || null;
}
export function setBookingState(id, state) {
  _setState.run(state, id);
  return getBooking(id);
}
export function closeBooking(id, endTime) {
  _closeBooking.run(endTime, id);
  return getBooking(id);
}
export function getActiveBooking() {
  return _activeBooking.get() || null;
}
export function getUserLiveBooking(userId) {
  return _userLiveBooking.get(userId) || null;
}
export function getExpiredBookings(nowTs) {
  return _expiredBookings.all(nowTs);
}

// --- Events ----------------------------------------------------------------
const _insertEvent = db.prepare(
  "INSERT INTO events (flapId, action, timestamp) VALUES (?, ?, ?)"
);
export function addEvent(flapId, action, timestamp) {
  _insertEvent.run(flapId, action, timestamp);
}

export default db;
