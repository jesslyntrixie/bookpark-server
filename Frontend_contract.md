# App ↔ Server Contract (HTTP)

*Companion to `Server_contract.md` (the IoT/MQTT side). That one covers Server ↔ Flap. **This** one covers **App ↔ Server**: the HTTP API the frontend calls. Source of truth for the frontend team.*

---

## 0. The basics

| Thing | Value |
|---|---|
| Protocol | HTTP (JSON) |
| Base URL (local dev) | `http://localhost:3000` |
| Base URL (deployed) | *TBD — filled in at deployment (Cloudflare Tunnel URL)* |
| Content-Type | `application/json` on every POST |
| Timestamps | Unix epoch **seconds** (10 digits), same as the IoT contract |
| Auth | **None yet** (PoC). Do not ship to production without it. |

> One flap for the PoC: `flap/01`. The API is written around that single stall.

---

## 1. The model the app needs to understand

**Stall** — the physical parking spot. The app mostly reads its derived `status`:

| `status` | Meaning | How it arises |
|---|---|---|
| `free` | Available to book | no booking, no car |
| `booked` | Reserved, car not arrived yet | active booking, spot empty |
| `occupied` | Reserved and a car is parked | active booking + car present |
| `violation` | Car parked with **no** booking | car present, no booking |

**Booking** — one reservation. Its `state` moves through a lifecycle:

| `state` | Meaning |
|---|---|
| `booked` | Reserved, flap not opened yet |
| `active` | Driver opened the flap; session in progress |
| `done` | Closed normally; `endTime` + `duration` available |
| `cancelled` | Driver cancelled before using it |
| `expired` | No-show; hold timed out (15 min) |

Booking object shape:

```json
{
  "id": "1",
  "userId": "1",
  "vehicleId": "1",
  "flapId": "flap/01",
  "state": "booked",
  "startTime": 1783396436,
  "expiry": 1783397336,
  "endTime": null,
  "duration": null
}
```

`duration` (seconds) and `endTime` are `null` until the booking is closed.

**User** — a profile that owns one or more vehicles:

```json
{ "id": "1", "name": "Gaby", "vehicles": [ { "id": "1", "ownerId": "1", "plate": "B1234XYZ" } ] }
```

**Vehicle** — belongs to one user (`ownerId`):

```json
{ "id": "1", "ownerId": "1", "plate": "B1234XYZ" }
```

> A user may own many vehicles, but only **one** of them can hold a live
> (`booked`/`active`) booking at a time.

---

## 2. Endpoints

### `POST /users` — create a user profile
**Request**
```json
{ "name": "Gaby" }
```
**Success — `200`** → `{ "ok": true, "user": { "id": "1", "name": "Gaby", "vehicles": [] } }`
**Error** — `400` if `name` missing.

---

### `GET /users/:id` — fetch a user (with their vehicles)
**Success — `200`** → `{ "ok": true, "user": { "id": "1", "name": "Gaby", "vehicles": [ ... ] } }`
**Error** — `404` if not found.

---

### `POST /vehicles` — register a vehicle to a user
**Request**
```json
{ "ownerId": "1", "plate": "B1234XYZ" }
```
**Success — `200`** → `{ "ok": true, "vehicle": { "id": "1", "ownerId": "1", "plate": "B1234XYZ" } }`
**Errors**
| Code | When | Body |
|---|---|---|
| `400` | `ownerId` or `plate` missing | `{ "error": "ownerId and plate are required" }` |
| `404` | Owner not found | `{ "error": "Owner (user) not found" }` |

---

### `GET /vehicles/:id` — fetch a vehicle
**Success — `200`** → `{ "ok": true, "vehicle": { ... } }`
**Error** — `404` if not found.

---

### `POST /book` — create a booking
Reserve the flap for a specific user + vehicle. Both must already exist.

**Request**
```json
{ "userId": "1", "vehicleId": "1" }
```

**Success — `200`**
```json
{ "ok": true, "booking": { "id": "1", "state": "booked", ... } }
```

**Errors**
| Code | When | Body |
|---|---|---|
| `400` | `userId` or `vehicleId` missing | `{ "error": "userId and vehicleId are required" }` |
| `404` | User or vehicle not found | `{ "error": "User not found" }` / `{ "error": "Vehicle not found" }` |
| `403` | Vehicle isn't owned by the user | `{ "error": "Vehicle does not belong to this user" }` |
| `409` | User already has a live booking | `{ "error": "User already has an active booking" }` |
| `409` | Flap already booked | `{ "error": "Flap is already booked" }` |

---

### `POST /open` — open the flap
Driver arrived; drop the flap. Moves the booking `booked → active`.

**Request**
```json
{ "bookingId": "1" }
```

**Success — `200`**
```json
{ "ok": true, "message": "flap opening" }
```

**Errors**
| Code | When | Body |
|---|---|---|
| `400` | `bookingId` missing | `{ "error": "bookingId is required" }` |
| `403` | No booking, or not `booked`/`active` | `{ "error": "No valid booking for this flap" }` |
| `503` | Server not connected to the broker | `{ "error": "Not connected to MQTT broker" }` |

---

### `POST /close` — end the session
Raise the flap, record duration, free the stall. Moves `active → done`.

**Request**
```json
{ "bookingId": "1" }
```

**Success — `200`**
```json
{ "ok": true, "message": "flap raising",
  "booking": { "id": "1", "state": "done", "endTime": 1783400036, "duration": 3600 } }
```

**Errors**
| Code | When | Body |
|---|---|---|
| `400` | `bookingId` missing | `{ "error": "bookingId is required" }` |
| `403` | No **active** booking | `{ "error": "No active booking to close" }` |
| `503` | Broker down | `{ "error": "Not connected to MQTT broker" }` |

---

### `POST /cancel` — cancel before use
Cancel a booking that hasn't been opened. Moves `booked → cancelled`. No flap command.

**Request**
```json
{ "bookingId": "1" }
```

**Success — `200`**
```json
{ "ok": true, "message": "booking cancelled",
  "booking": { "id": "1", "state": "cancelled" } }
```

**Errors**
| Code | When | Body |
|---|---|---|
| `400` | `bookingId` missing | `{ "error": "bookingId is required" }` |
| `403` | Not in `booked` state | `{ "error": "Only a booked (not-yet-open) booking can be cancelled" }` |

---

### `GET /status` — current stall state
Poll this to show live spot status.

**Success — `200`**
```json
{
  "id": "flap/01",
  "flapState": "down",
  "presence": "occupied",
  "bookedBy": "1",
  "status": "occupied"
}
```

- `status` is the derived label from section 1 (what the UI shows).
- `flapState` (`up`/`down`) and `presence` (`free`/`occupied`) come from the flap's sensor.

---

### `GET /booking/:id` — look up one booking
Fetch a single booking's current state (with derived `duration`). Use to poll a
booking through its lifecycle after `/book`.

**Success — `200`**
```json
{ "ok": true, "booking": { "id": "1", "state": "active", "duration": null, ... } }
```

**Errors**
| Code | When | Body |
|---|---|---|
| `404` | No booking with that id | `{ "error": "Booking not found" }` |

---

### `GET /` — health check
Returns a plain-text "server is running" string. Use for a quick reachability check.

---

## 3. Error format (shared by all endpoints)
Every error is JSON with a single `error` string:
```json
{ "error": "human-readable reason" }
```
Success responses always include `"ok": true`.

---

## 4. Typical happy-path flow (what the app does)

```
0. POST /users    {name}                   → user id "1"      (once, on signup)
   POST /vehicles {ownerId:"1", plate}      → vehicle id "1"   (once, per car)
1. GET  /status                             → status:"free"    (spot available)
2. POST /book   {userId:"1", vehicleId:"1"} → booking id "1", state:"booked"
3. POST /open   {bookingId:"1"}             → "flap opening", state:"active"
   (car arrives; GET /status now shows "occupied")
4. POST /close  {bookingId:"1"}             → state:"done", duration returned
   (GET /status back to "free")
```

Alternate endings: `POST /cancel` before step 3, or the server auto-`expired`s the
booking if the driver never opens it within 15 minutes.

---

## 5. Known limitations (so the frontend plans around them)
- **No auth** — anyone with a `bookingId` can open/close. PoC only.
- **In-memory** — a server restart clears all bookings.
- **One flap** — the API assumes a single stall (`flap/01`).

---

## 6. Sign-off
- [ ] Base URLs confirmed (local + deployed)
- [ ] Endpoint shapes agreed with frontend
- [ ] Status/state vocabularies agreed

Backend: Jesslyn   Frontend: ____   Date: ____
