// raise-flap.js
// A one-shot helper: connects to the same MQTT broker and tells the flap to
// RAISE (close), then exits. Useful for testing/manual control, because the
// main server only raises automatically when the sensor reports the car left.
//
// Run it:            node raise-flap.js
// Or via compose:    docker compose run --rm server node raise-flap.js

import mqtt from "mqtt";
import "dotenv/config";

const HOST = process.env.MQTT_HOST;
const PORT = process.env.MQTT_PORT || 8883;
const USERNAME = process.env.MQTT_USERNAME;
const PASSWORD = process.env.MQTT_PASSWORD;

const COMMAND_TOPIC = "flap/01/command";

if (!HOST || !USERNAME || !PASSWORD) {
  console.error("❌ Missing MQTT env vars. Check your .env file.");
  process.exit(1);
}

const client = mqtt.connect(`mqtts://${HOST}:${PORT}`, {
  username: USERNAME,
  password: PASSWORD,
});

client.on("connect", () => {
  console.log("✅ Connected to broker. Sending raise command...");
  const payload = JSON.stringify({ command: "raise" });

  client.publish(COMMAND_TOPIC, payload, (err) => {
    if (err) {
      console.error("❌ Publish failed:", err.message);
    } else {
      console.log(`📤 Sent ${payload} to ${COMMAND_TOPIC}`);
    }
    client.end(); // done — disconnect and exit
  });
});

client.on("error", (err) => {
  console.error("❌ MQTT connection error:", err.message);
  client.end();
  process.exit(1);
});
