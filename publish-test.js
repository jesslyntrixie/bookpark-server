// publish-test.js
// Goal: connect to our HiveMQ broker and publish one "drop" command.

import mqtt from "mqtt";  

const HOST = "5498bd475ef644588d863d458b321d09.s1.eu.hivemq.cloud";
const PORT = 8883;                       // TLS port
const USERNAME = "jasjus";              
const PASSWORD = "REMOVED"; 

const COMMAND_TOPIC = "flap/01/command";

// "mqtts://" means secure MQTT (matches port 8883 / TLS on).
const brokerUrl = `mqtts://${HOST}:${PORT}`;

// Connect to the broker, logging in with our username + password.
const client = mqtt.connect(brokerUrl, {
  username: USERNAME,
  password: PASSWORD,
});

// This runs ONCE, when we successfully connect to the broker.
client.on("connect", () => {
  console.log("✅ Connected to the broker!");
 
  const message = JSON.stringify({ command: "drop" });

  client.publish(COMMAND_TOPIC, message, () => {
    console.log(`📤 Sent ${message} to ${COMMAND_TOPIC}`);
    client.end();   // we're done; close the connection cleanly.
  });
});

// If anything goes wrong (bad password, wrong host, no internet), show it.
client.on("error", (err) => {
  console.error("❌ Connection error:", err.message);
  client.end();
});