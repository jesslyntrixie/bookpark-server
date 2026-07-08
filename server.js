// server.js
// HTTP server for JasJus. The app calls HTTP endpoints; the server commands the
// flap over MQTT (publish to flap/01/command) and listens to the flap's status
// (subscribe to flap/01/status). See JasJus_Backend_Handbook.md (cards B1–B6)
// and the diagrams: JasJus_ERD / JasJus_StallStates / JasJus_BookingLifecycle.

import express from "express";
import mqtt from "mqtt";
import "dotenv/config";

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
// State 
//
//   stall    : the physical spot. Two orthogonal raw fields:
//                presence  (car there?)      — owned by the flap (MQTT)
//                bookedBy  (active booking?)  — owned by the app  (HTTP)
//              There is NO stored "status" — it's derived from those two.
//   bookings : every booking ever made, keyed by id. duration is derived.
//   events   : in/out log (ground-truth physical crossings).
// ---------------------------------------------------------------------------
const stall = {
  id: "flap/01",
  flapState: "unknown", // up | down      
  presence: "unknown",  // free | occupied 
  bookedBy: null,       // id of the active booking, or null
};

const bookings = {};
const events = [];
const users = {};    // id -> { id, name }
const vehicles = {}; // id -> { id, ownerId, plate }
let nextBookingId = 1;
let nextUserId = 1;
let nextVehicleId = 1;

const now = () => Math.floor(Date.now() / 1000); 

// booking.state may be one of these.
//   booked -> active -> done          (happy path)
//   booked -> cancelled               (driver cancels before use)
//   booked -> expired                 (no-show, hold timed out)
const BOOKING_STATES = ["booked", "active", "done", "cancelled", "expired"];

// How long a booking is held before a no-show auto-expires.
const BOOKING_TTL = 15 * 60; 

// --- Derived views (computed on read, never stored) ------------------------

function deriveStatus(s) {
  const isBooked = s.bookedBy !== null;
  const carHere = s.presence === "occupied";
  if (carHere && !isBooked) return "violation"; 
  if (carHere && isBooked) return "occupied";
  if (!carHere && isBooked) return "booked";     
  return "free";
}

// A booking with its derived duration attached.
function bookingView(b) {
  return {
    ...b,
    duration: b.endTime ? b.endTime - b.startTime : null, // seconds, derived
  };
}

// A user with their vehicles attached (vehicles derived by ownerId).
function userView(u) {
  return {
    ...u,
    vehicles: Object.values(vehicles).filter((v) => v.ownerId === u.id),
  };
}

// True if this user already holds a live booking (booked or active).
// Enforces: only one of a user's vehicles can have an active booking at a time.
function userHasLiveBooking(userId) {
  return Object.values(bookings).some(
    (b) => b.userId === userId && (b.state === "booked" || b.state === "active")
  );
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
  if (data.presence) stall.presence = data.presence;
});

function publishCommand(command, res, onSuccess) {
  if (!mqttClient.connected) {
    return res.status(503).json({ error: "Not connected to MQTT broker" });
  }
  const message = JSON.stringify({ command });
  mqttClient.publish(COMMAND_TOPIC, message, (err) => {
    if (err) {
      console.error("Publish failed: ", err.message);
      return res.status(500).json({ error: "Failed to publish command" });
    }
    console.log(`📤 Sent ${message} to ${COMMAND_TOPIC}`);
    onSuccess();
  });
}





// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

app.get("/", (req, res) =>
  res.send("JasJus server is running. POST /book, /open, /close.")
);

app.get("/status", (req, res) => {
  res.json({ ...stall, status: deriveStatus(stall) });
});

app.get("/booking/:id", (req, res) => {
  const booking = bookings[req.params.id];
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  res.json({ ok: true, booking: bookingView(booking) });
});

// --- Users -----------------------------------------------------------------

app.post("/users", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  const id = String(nextUserId++);
  users[id] = { id, name };
  console.log(`User ${id} created: ${name}`);
  res.json({ ok: true, user: userView(users[id]) });
});

app.get("/users/:id", (req, res) => {
  const user = users[req.params.id];
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true, user: userView(user) });
});

// --- Vehicles --------------------------------------------------------------

app.post("/vehicles", (req, res) => {
  const { ownerId, plate } = req.body;
  if (!ownerId || !plate) {
    return res.status(400).json({ error: "ownerId and plate are required" });
  }
  if (!users[ownerId]) return res.status(404).json({ error: "Owner (user) not found" });

  const id = String(nextVehicleId++);
  vehicles[id] = { id, ownerId, plate };
  console.log(`Vehicle ${id} (${plate}) registered to user ${ownerId}`);
  res.json({ ok: true, vehicle: vehicles[id] });
});

app.get("/vehicles/:id", (req, res) => {
  const vehicle = vehicles[req.params.id];
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
  res.json({ ok: true, vehicle });
});

// --- Bookings --------------------------------------------------------------

app.post("/book", (req, res) => {
  const { userId, vehicleId } = req.body;
  if (!userId || !vehicleId) {
    return res.status(400).json({ error: "userId and vehicleId are required" });
  }

  // Validate the user and vehicle, and that the vehicle belongs to the user.
  const user = users[userId];
  if (!user) return res.status(404).json({ error: "User not found" });
  const vehicle = vehicles[vehicleId];
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
  if (vehicle.ownerId !== userId) {
    return res.status(403).json({ error: "Vehicle does not belong to this user" });
  }

  // One live booking per user (only one of their vehicles at a time).
  if (userHasLiveBooking(userId)) {
    return res.status(409).json({ error: "User already has an active booking" });
  }
  if (stall.bookedBy) return res.status(409).json({ error: "Flap is already booked" });

  const id = String(nextBookingId++);
  const startTime = now();
  bookings[id] = {
    id,
    userId,
    vehicleId,
    flapId: stall.id,
    state: "booked",
    startTime,
    expiry: startTime + BOOKING_TTL,
    endTime: null,
  };
  stall.bookedBy = id;

  console.log(`Booking ${id} created for user ${userId}, vehicle ${vehicle.plate}`);
  res.json({ ok: true, booking: bookingView(bookings[id]) });
});

app.post("/open", (req, res) => {
  const { bookingId } = req.body;
  if (!bookingId) return res.status(400).json({ error: "bookingId is required" });
  const booking = bookings[bookingId];
  if (!booking || !["booked", "active"].includes(booking.state)) {
    return res.status(403).json({ error: "No valid booking for this flap" });
  }

  publishCommand("drop", res, () => {
    booking.state = "active";
    events.push({ flapId: stall.id, action: "in", timestamp: now() });
    res.json({ ok: true, message: "flap opening" });
  });
});

app.post("/close", (req, res) => {
  const { bookingId } = req.body;
  if (!bookingId) return res.status(400).json({ error: "bookingId is required" });
  const booking = bookings[bookingId];
  if (!booking || booking.state !== "active") {
    return res.status(403).json({ error: "No active booking to close" });
  }

  publishCommand("raise", res, () => {
    booking.endTime = now();
    booking.state = "done";
    events.push({ flapId: stall.id, action: "out", timestamp: booking.endTime });

    stall.bookedBy = null; 

    console.log(`Booking ${booking.id} closed. Duration: ${booking.endTime - booking.startTime}s`);
    res.json({ ok: true, message: "flap raising", booking: bookingView(booking) });
  });
});

app.post("/cancel", (req, res) => {
  const { bookingId } = req.body;
  if (!bookingId) return res.status(400).json({ error: "bookingId is required" });
  const booking = bookings[bookingId];
  if (!booking || booking.state !== "booked") {
    return res.status(403).json({ error: "Only a booked (not-yet-open) booking can be cancelled" });
  }

  booking.state = "cancelled";
  if (stall.bookedBy === booking.id) stall.bookedBy = null;

  console.log(`Booking ${booking.id} cancelled`);
  res.json({ ok: true, message: "booking cancelled", booking: bookingView(booking) });
});

setInterval(() => {
  const t = now();
  for (const b of Object.values(bookings)) {
    if (b.state === "booked" && t > b.expiry) {
      b.state = "expired";
      if (stall.bookedBy === b.id) stall.bookedBy = null;
      console.log(`Booking ${b.id} expired (no-show)`);
    }
  }
}, 30 * 1000); 

const WEB_PORT = process.env.PORT || 3000;
app.listen(WEB_PORT, () => {
  console.log(`Server is listening on port ${WEB_PORT}`);
});