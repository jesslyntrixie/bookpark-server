// server.js
// an HTTP server that when the app calls POST /open, publishes "drop" over MQTT

import express from "express";
import mqtt from "mqtt";

const HOST = "5498bd475ef644588d863d458b321d09.s1.eu.hivemq.cloud";
const PORT = 8883;
const USERNAME = "jasjus";
const PASSWORD = "REMOVED";
const COMMAND_TOPIC = "flap/01/command";
const STATUS_TOPIC = "flap/01/status";

const flap = {
    flapState: "unknown",
    presence: "unknown",
    lastUpdate: null
}

const mqttClient = mqtt.connect(`mqtts://${HOST}:${PORT}`, {
  username: USERNAME,
  password: PASSWORD,
});

mqttClient.on("connect", () => {
  console.log("✅ Connected to MQTT broker!");

  mqttClient.subscribe(STATUS_TOPIC, (err) => {
    if (err) {
        console.error("Subscribe failed: ", err.message);
    }
    else console.log("Subscribed to status topic: ", STATUS_TOPIC);
  })
});

mqttClient.on("error", (err) => console.error("❌ MQTT connection error:", err.message));

mqttClient.on("message", (topic, payload) => {
    let data;
    try {
        data = JSON.parse(payload.toString());
    } catch {
        console.error("Got a non-JSON message, ignoring: ", payload.toString());
    }
    console.log(`📥 Received message on ${topic}: `, data);

    if (data.flapState) flap.flapState = data.flapState;
    if (data.presence) flap.presence = data.presence;
    flap.lastUpdate = Math.floor(Date.now() / 1000);
});

const app = express();
app.use(express.json());

app.post("/open", (req, res) => {
    console.log("Received /open request");

    const message = JSON.stringify({command: "drop"});

    mqttClient.publish(COMMAND_TOPIC, message, (err) => {
        if (err) {
            console.error("Publish failed: ", err.message);
            return res.status(500).json({error: "Failed to publish command"});
        }
        console.log(`📤 Sent ${message} to ${COMMAND_TOPIC}`);
        res.json({ok: true, message: "flap opening"})
    });
});

app.get("/status", (req, res) => {
    res.json(flap);
});

app.get("/", (req, res) => res.send("JasJus server is running. POST /open to open the flap."));

const WEB_PORT = 3000;
app.listen(WEB_PORT, () => {
    console.log(`Server is listening on http://localhost:${WEB_PORT}`);
})
