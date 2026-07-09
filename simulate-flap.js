// simulate-flap.js
// Pretends to be the ESP32 flap: connects to the same MQTT broker and publishes
// status messages to flap/01/status, so you can test the server WITHOUT hardware.
// It also prints any commands the server sends (drop/raise) on flap/01/command.
//
// Run it in its own terminal:  node simulate-flap.js
// Then in ANOTHER terminal, drive the booking flow with curl (see the guide).

import mqtt from "mqtt";
import "dotenv/config";

const HOST = process.env.MQTT_HOST;
const PORT = process.env.MQTT_PORT || 8883;
const USERNAME = process.env.MQTT_USERNAME;
const PASSWORD = process.env.MQTT_PASSWORD;

const STATUS_TOPIC = "flap/01/status";
const COMMAND_TOPIC = "flap/01/command";

const client = mqtt.connect(`mqtts://${HOST}:${PORT}`, { username: USERNAME, password: PASSWORD });

// Publish a status message (what the real flap would report).
function report(obj) {
  client.publish(STATUS_TOPIC, JSON.stringify(obj));
  console.log("🚗 flap ->", JSON.stringify(obj));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

client.on("connect", async () => {
  console.log("🔌 simulator connected to broker");
  // Listen for commands the server sends to the flap.
  client.subscribe(COMMAND_TOPIC);

  console.log("\n--- Simulating: car enters, stays, leaves, comes back, leaves ---\n");

  await wait(1000);
  report({ flapState: "down" });        // server told us to drop; flap is down
  await wait(1000);
  report({ presence: "occupied" });     // car drives in  -> server logs "in"

  await wait(3000);
  report({ presence: "free" });         // car leaves      -> server logs "out" + sends raise
  await wait(500);
  report({ flapState: "up" });          // flap raised itself

  await wait(3000);
  report({ presence: "occupied" });     // car returns     -> server logs another "in"
  await wait(3000);
  report({ presence: "free" });         // leaves again    -> "out" + raise

  await wait(1500);
  console.log("\n✅ simulation done. Press Ctrl-C to quit.\n");
});

// Print commands the server publishes to the flap.
client.on("message", (topic, payload) => {
  if (topic === COMMAND_TOPIC) console.log("📩 server -> flap:", payload.toString());
});

client.on("error", (e) => console.error("simulator error:", e.message));
