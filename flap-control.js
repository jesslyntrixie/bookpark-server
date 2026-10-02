// flap-control.js
// A tiny standalone control server for MANUALLY driving the flap while testing.
// It connects to the same MQTT broker and exposes buttons/endpoints to send
// "raise" (close) or "drop" (open) — so you can reset the flap between tests
// without going through the app.
//
// Run it:   node flap-control.js
// Then open http://localhost:4000 in your browser, or:
//   curl http://localhost:4000/raise
//   curl http://localhost:4000/drop
//
// Note: this is a TEST tool. It talks straight to the flap and does NOT touch
// bookings, so use it only for manual testing — not in a real run.

import express from "express";
import mqtt from "mqtt";
import "dotenv/config";

const HOST = process.env.MQTT_HOST;
const PORT = process.env.MQTT_PORT || 8883;
const USERNAME = process.env.MQTT_USERNAME;
const PASSWORD = process.env.MQTT_PASSWORD;

const COMMAND_TOPIC = "flap/01/command";
const WEB_PORT = 4000; // separate from the main server (3000) and nginx (8080)

if (!HOST || !USERNAME || !PASSWORD) {
  console.error("❌ Missing MQTT env vars. Check your .env file.");
  process.exit(1);
}

// --- One shared MQTT connection ---------------------------------------------
const mqttClient = mqtt.connect(`mqtts://${HOST}:${PORT}`, {
  username: USERNAME,
  password: PASSWORD,
});

mqttClient.on("connect", () => console.log("✅ Connected to MQTT broker!"));
mqttClient.on("error", (err) => console.error("❌ MQTT error:", err.message));

// Send a command to the flap. Returns false if the broker is down.
function sendCommand(command) {
  if (!mqttClient.connected) return false;
  mqttClient.publish(COMMAND_TOPIC, JSON.stringify({ command }), (err) => {
    if (err) console.error("Publish failed:", err.message);
    else console.log(`📤 Sent {command:"${command}"} to ${COMMAND_TOPIC}`);
  });
  return true;
}

// --- Tiny web UI + endpoints ------------------------------------------------
const app = express();

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head><title>Flap Control</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 40px;">
        <h1>🚧 Flap Control (test tool)</h1>
        <p>Manually drive the flap over MQTT.</p>
        <button onclick="fetch('/raise').then(()=>msg('raise'))"
                style="font-size:20px; padding:16px 32px; margin:8px;">⬆️ Raise (close)</button>
        <button onclick="fetch('/drop').then(()=>msg('drop'))"
                style="font-size:20px; padding:16px 32px; margin:8px;">⬇️ Drop (open)</button>
        <p id="status"></p>
        <script>
          function msg(cmd){ document.getElementById('status').textContent = 'Sent: ' + cmd; }
        </script>
      </body>
    </html>
  `);
});

app.get("/raise", (req, res) => {
  if (!sendCommand("raise")) return res.status(503).json({ error: "Broker not connected" });
  res.json({ ok: true, command: "raise" });
});

app.get("/drop", (req, res) => {
  if (!sendCommand("drop")) return res.status(503).json({ error: "Broker not connected" });
  res.json({ ok: true, command: "drop" });
});

app.listen(WEB_PORT, () => {
  console.log(`🕹️  Flap control running at http://localhost:${WEB_PORT}`);
});
