// server.js
// HTTP server for JasJus. The app calls HTTP endpoints; the server commands the
// flap over MQTT (publish to flap/01/command) and listens to the flap's status
// (subscribe to flap/01/status). Data is persisted in SQLite via db.js.
// See JasJus_Backend_Handbook.md (cards B1–B6) and the diagrams.

import express from "express";
import mqtt from "mqtt";
import "dotenv/config";
import * as db from "./db.js";

const HOST = process.env.MQTT_HOST;
const MQTT_PORT = process.env.MQTT_PORT || 8883;
const USERNAME = process.env.MQTT_USERNAME;
const PASSWORD = process.env.MQTT_PASSWORD;
const COMMAND_TOPIC = "flap/01/command";
const STATUS_TOPIC = "flap/01/status";

if (!HOST || !USERNAME || !PASSWORD) {
  console.error("❌ Missing MQTT env vars. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Runtime-only state.
//   stall holds LIVE sensor data (flapState/presence) pushed by the flap over
//   MQTT. This is ephemeral by nature, so it stays in memory — it is NOT
//   persisted. Everything durable (users, vehicles, bookings, events) lives in
//   SQLite (db.js). "bookedBy" is DERIVED from the active booking in the DB.
// ---------------------------------------------------------------------------
const stall = {
  id: "flap/01",
  flapState: "unknown", // up | down       (from the flap)
  presence: "unknown",  // free | occupied (from the flap)
};

const now = () => Math.floor(Date.now() / 1000); // epoch seconds, per the contract

const DEFAULT_DURATION = 120 * 60; // default reservation length if none given (2h)

// --- Derived views (computed on read, never stored) ------------------------

// Occupancy label for the app. Pure presence + whether a booking is live.
// (A car present with no live booking is a violation — see /status.)
function deriveStatus(active) {
  if (stall.presence === "occupied") return "occupied";
  if (active) return "booked"; // reserved, car not here yet
  return "free";
}

// A booking row plus derived fields (never stored). A driver may enter/leave
// several times per booking, so:
//   arrivedAt = FIRST 'in', leftAt = LAST 'out'   (from the events log)
//   actualDuration = leftAt - arrivedAt            (whole span they held the spot)
//   plannedDuration = the reserved length          (from the window)
function bookingView(b) {
  const arrivedAt = db.getFirstEventTime(b.id, "in");
  const leftAt = db.getLastEventTime(b.id, "out");
  return {
    ...b,
    plannedDuration: b.endTime - b.startTime,
    arrivedAt,
    leftAt,
    actualDuration: arrivedAt && leftAt ? leftAt - arrivedAt : null,
  };
}

// A user row plus their vehicles.
function userView(u) {
  return { ...u, vehicles: db.vehiclesByOwner(u.id) };
}

// ---------------------------------------------------------------------------
// MQTT
// ---------------------------------------------------------------------------
const mqttClient = mqtt.connect(`mqtts://${HOST}:${MQTT_PORT}`, {
  username: USERNAME,
  password: PASSWORD,
});

mqttClient.on("connect", () => {
  console.log("✅ Connected to MQTT broker!");
  mqttClient.subscribe(STATUS_TOPIC, (err) => {
    if (err) console.error("Subscribe failed: ", err.message);
    else console.log("Subscribed to status topic: ", STATUS_TOPIC);
  });
});

mqttClient.on("error", (err) => console.error("❌ MQTT connection error:", err.message));

// B5 — the flap's status updates our live sensor fields.
mqttClient.on("message", (topic, payload) => {
  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    console.error("Got a non-JSON message, ignoring: ", payload.toString());
    return;
  }
  console.log(`📥 Received message on ${topic}: `, data);
  if (data.flapState) stall.flapState = data.flapState;

  // Presence transitions ARE the in/out log, and drive the auto-close:
  //   occupied -> log "in"            (car entered; flap was dropped by /open)
  //   free     -> log "out" + raise   ("close" — car left, so raise the flap)
  // A car can enter/leave many times within one booking; the booking stays
  // active until endTime. This is the source of arrival/leave times + duration.
  if (data.presence && data.presence !== stall.presence) {
    stall.presence = data.presence;
    const active = db.getActiveBooking(now());
    if (data.presence === "occupied") {
      if (active) db.addEvent(active.id, stall.id, "in", now());
    } else if (data.presence === "free") {
      if (active) db.addEvent(active.id, stall.id, "out", now());
      publish("raise"); // auto-close: car gone, protect the spot again
    }
  } else if (data.presence) {
    stall.presence = data.presence;
  }
});

// Publish a command to the flap. Returns false if the broker is down.
function publish(command) {
  if (!mqttClient.connected) return false;
  mqttClient.publish(COMMAND_TOPIC, JSON.stringify({ command }), (err) => {
    if (err) console.error("Publish failed: ", err.message);
    else console.log(`📤 Sent {command:"${command}"} to ${COMMAND_TOPIC}`);
  });
  return true;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

app.get("/", (req, res) =>
  res.send("JasJus server is running. POST /book to reserve, /open to drop the flap.")
);

// Raw sensor fields + derived status + active booking id + overstay flag.
// The flap only opens for the booker, so unbooked parking is impossible — a car
// present with NO live booking can only mean the booker stayed past endTime.
// Hence the single violation this system has is OVERSTAY.
app.get("/status", (req, res) => {
  const active = db.getActiveBooking(now());
  const overstay = stall.presence === "occupied" && !active;
  res.json({
    ...stall,
    bookedBy: active ? active.id : null,
    status: deriveStatus(active),
    overstay,
  });
});

app.get("/booking/:id", (req, res) => {
  const booking = db.getBooking(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  res.json({ ok: true, booking: bookingView(booking) });
});

// --- Users -----------------------------------------------------------------

app.post("/users", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const user = db.createUser(name);
  console.log(`User ${user.id} created: ${name}`);
  res.json({ ok: true, user: userView(user) });
});

app.get("/users/:id", (req, res) => {
  const user = db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true, user: userView(user) });
});

// --- Vehicles --------------------------------------------------------------

app.post("/vehicles", (req, res) => {
  const { ownerId, plate } = req.body;
  if (!ownerId || !plate) {
    return res.status(400).json({ error: "ownerId and plate are required" });
  }
  if (!db.getUser(ownerId)) return res.status(404).json({ error: "Owner (user) not found" });
  const vehicle = db.createVehicle(ownerId, plate);
  console.log(`Vehicle ${vehicle.id} (${plate}) registered to user ${ownerId}`);
  res.json({ ok: true, vehicle });
});

app.get("/vehicles/:id", (req, res) => {
  const vehicle = db.getVehicle(req.params.id);
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
  res.json({ ok: true, vehicle });
});

// --- Bookings --------------------------------------------------------------

app.post("/book", (req, res) => {
  const { userId, vehicleId, durationMinutes } = req.body;
  if (!userId || !vehicleId) {
    return res.status(400).json({ error: "userId and vehicleId are required" });
  }

  const user = db.getUser(userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  const vehicle = db.getVehicle(vehicleId);
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
  if (String(vehicle.ownerId) !== String(userId)) {
    return res.status(403).json({ error: "Vehicle does not belong to this user" });
  }

  const t = now();
  if (db.getUserLiveBooking(userId, t)) {
    return res.status(409).json({ error: "User already has an active booking" });
  }
  if (db.getActiveBooking(t)) {
    return res.status(409).json({ error: "Flap is already booked" });
  }

  // Reserve a window [startTime, endTime]. The booking auto-ends at endTime.
  const startTime = t;
  const duration = durationMinutes > 0 ? durationMinutes * 60 : DEFAULT_DURATION;
  const endTime = startTime + duration;

  const booking = db.createBooking(userId, vehicleId, stall.id, startTime, endTime);
  console.log(`Booking ${booking.id} created for user ${userId}, vehicle ${vehicle.plate} (${duration / 60} min)`);
  res.json({ ok: true, booking: bookingView(booking) });
});

// Drop the flap so the car can enter. First open moves booked -> active; may be
// called again to re-enter during the window. There is no /close: the flap
// raises automatically when the sensor reports the car has left (see MQTT
// handler), and the booking ends on its own when endTime passes.
app.post("/open", (req, res) => {
  const { bookingId } = req.body;
  if (!bookingId) return res.status(400).json({ error: "bookingId is required" });
  const booking = db.getBooking(bookingId);
  if (!booking || !["booked", "active"].includes(booking.state)) {
    return res.status(403).json({ error: "No valid booking for this flap" });
  }

  if (!publish("drop")) {
    return res.status(503).json({ error: "Not connected to MQTT broker" });
  }
  if (booking.state === "booked") db.setBookingState(booking.id, "active");
  res.json({ ok: true, message: "flap opening" });
});

// booked -> cancelled (no flap command; it was never opened)
app.post("/cancel", (req, res) => {
  const { bookingId } = req.body;
  if (!bookingId) return res.status(400).json({ error: "bookingId is required" });
  const booking = db.getBooking(bookingId);
  if (!booking || booking.state !== "booked") {
    return res.status(403).json({ error: "Only a booked (not-yet-open) booking can be cancelled" });
  }
  const cancelled = db.setBookingState(booking.id, "cancelled");
  console.log(`Booking ${booking.id} cancelled`);
  res.json({ ok: true, message: "booking cancelled", booking: bookingView(cancelled) });
});

// Auto-end sweep: when a booking's window (endTime) has passed, mark it done
// and free the stall — whether or not the driver ever opened or closed it.
setInterval(() => {
  for (const b of db.getFinishedBookings(now())) {
    db.setBookingState(b.id, "done");
    console.log(`Booking ${b.id} auto-ended (booking time finished)`);
  }
}, 30 * 1000);

const WEB_PORT = process.env.PORT || 3000;
app.listen(WEB_PORT, () => {
  console.log(`Server is listening on port ${WEB_PORT}`);
});
