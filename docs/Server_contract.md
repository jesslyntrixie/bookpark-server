# IoT ↔ Server Contract (MQTT)

---

## 0. The broker (the shared "post office" both sides connect to)

We're using an MQTT broker. Both the server and the ESP32 connect to it.

| Thing | Value (fill in) |
|---|---|
| Broker provider | HiveMQ Cloud |
| Broker host / URL | 5498bd475ef644588d863d458b321d09.s1.eu.hivemq.cloud|
| Port | 8883 |
| Username | jasjus |
| Password | (stored outside the repo)|
| (note) TLS on? | yes |

> Both sides use these exact same connection details.

---

## 1. Naming: which flap are we testing?

For the PoC we have **one** flap. Pick its label (any name — the number is just an id):

- Our flap id = `flap/01`  

---

## 2. Server → Flap  (COMMANDS: server tells the flap what to do)

- **Topic (the channel):** `flap/01/command`
- **Who publishes:** the server
- **Who subscribes (listens):** the ESP32
- **Message format (JSON):**

| Meaning | Message the server sends |
|---|---|
| Drop the flap (let the car in) | `{"command":"drop"}` |
| Raise the flap (block again) | `{"command":"raise"}` |

*(optional, for tracking which command an ack refers to)*
`{"command":"drop","msgId":"abc123"}`

---

## 3. Flap → Server  (STATUS: flap reports what happened)

- **Topic (the channel):** `flap/01/status`
- **Who publishes:** the ESP32
- **Who subscribes (listens):** the server
- **Message format (JSON):**

| Meaning | Message the flap sends |
|---|---|
| Flap is physically down | `{"flapState":"down"}` |
| Flap is physically up | `{"flapState":"up"}` |
| A car is on the spot | `{"presence":"occupied"}` |
| Spot is empty | `{"presence":"free"}` |
| (optional) confirm a command ran | `{"ack":"drop","msgId":"abc123"}` |
| (optional) "I'm alive" heartbeat | `{"lastSeen": <timestamp>}` |

> Tip: the flap can send several facts in one message:
> `{"flapState":"down","presence":"occupied","timestamp":1720000000}`

---

## 4. Format rules we both agree on (so we read messages the same way)

- All messages are **JSON** (text like `{"key":"value"}`).
- Exact spelling matters: `command`, `flapState`, `presence` — agree the spelling now.
- Values are **strings** in quotes: `"drop"`, `"down"`, `"occupied"` (not numbers).
- Timestamp format = Unix epoch (supaya hitung durasi lebih gampang)

---

## 5. How IoT tests WITHOUT the server (unblocks Gaby today)

1. ESP32 connects to the broker (section 0) and **subscribes** to `flap/01/command`.
2. From any MQTT test tool (e.g. MQTT Explorer on laptop, or an MQTT app on phone), **publish** `{"command":"drop"}` to `flap/01/command`.
3. Flap should drop. Publish `{"command":"raise"}` → it raises.
4. Have the ESP32 **publish** status to `flap/01/status`, and watch it appear in the test tool.

→ When this works, IoT's side is DONE and tested. Later, the server simply becomes the thing publishing to `flap/01/command` — nothing on the ESP32 changes.

---

## 6. Sign-off (so it's locked)

- [v] Broker details filled and shared
- [v] Flap id agreed
- [v] Command topic + messages agreed
- [v] Status topic + messages agreed
- [v] Spelling + value types + timestamp format agreed
- [ ] IoT tested drop/raise with a test publisher (no server needed) TODO 

Backend: Jesslyn   IoT: Gaby   Date: July 2, 2025