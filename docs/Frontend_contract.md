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
| IDs | Integers (e.g. `1`). Assigned by the server; never sent on create. |
| Timestamps | Unix epoch **seconds** (10 digits), same as the IoT contract |
| Auth | **None yet** (PoC). Do not ship to production without it. |

> One flap for the PoC: `flap/01`. The API is written around that single stall.
> Data is persisted (SQLite), so users/vehicles/bookings survive a server restart.

---

## 1. The model the app needs to understand

**Stall** — the physical parking spot. The app reads a derived `status` plus an
`overstay` flag:

| `status` | Meaning | How it arises |
|---|---|---|
| `free` | Available to book | no car, no live booking |
| `booked` | Reserved, car not arrived yet | live booking, spot empty |
| `occupied` | A car is on the spot | presence occupied |

> **`overstay`** is a separate **boolean**, not a status value. The flap only
> opens for the person who booked, so parking on an unbooked spot is physically
> impossible — the *only* violation that can occur is **overstay**: a booker
> still on the spot after their window (`endTime`) has passed. `overstay` is
> `true` whenever a car is present with no live booking.

**Booking** — one reservation. Its `state` moves through a lifecycle:

| `state` | Meaning |
|---|---|
| `booked` | Reserved, flap not opened yet |
| `active` | Driver opened the flap; session in progress |
| `done` | Ended — auto-ended when `endTime` passed |
| `cancelled` | Driver cancelled before using it |

Booking object shape:

```json
{
  "id": 1,
  "userId": 1,
  "vehicleId": 1,
  "flapId": "flap/01",
  "state": "booked",
  "startTime": 1783396436,
  "endTime": 1783403636,
  "plannedDuration": 7200,
  "arrivedAt": null,
  "leftAt": null,
  "actualDuration": null
}
```

A booking reserves a **time window** `[startTime, endTime]` and **auto-ends when
`endTime` passes** (whether or not the driver ever opened it):

- **`startTime`** — when the reservation begins (set at booking).
- **`endTime`** — the planned end (set at booking); the booking ends here.

Those two are **stored**. The rest are **derived** — computed by the server, not
stored (present in responses but absent from the data model / ERD). A driver may
enter and leave **several times** within one booking, so in/out times come from
the **events log** (many rows per booking), not the booking itself:

- **`plannedDuration`** = `endTime − startTime` (seconds) — reserved length, known at booking.
- **`arrivedAt`** = the **first** `in` event; **`leftAt`** = the **last** `out` event (`null` until they happen).
- **`actualDuration`** = `leftAt − arrivedAt` — whole span they held the spot; `null` until both exist.

**User** — a profile that owns one or more vehicles:

```json
{ "id": 1, "name": "Taqwa", "vehicles": [ { "id": 1, "ownerId": 1, "plate": "B1234XYZ" } ] }
```

**Vehicle** — belongs to one user (`ownerId`):

```json
{ "id": 1, "ownerId": 1, "plate": "B1234XYZ" }
```

> A user may own many vehicles, but only **one** of them can hold a live
> (`booked`/`active`) booking at a time.

---

## 2. Endpoints

### `POST /users` — create a user profile
**Request**
```json
{ "name": "Taqwa" }
```
**Success — `200`** → `{ "ok": true, "user": { "id": 1, "name": "Taqwa", "vehicles": [] } }`
**Error** — `400` if `name` missing.

---

### `GET /users/:id` — fetch a user (with their vehicles)
**Success — `200`** → `{ "ok": true, "user": { "id": 1, "name": "Taqwa", "vehicles": [ ... ] } }`
**Error** — `404` if not found.

---

### `POST /vehicles` — register a vehicle to a user
**Request**
```json
{ "ownerId": 1, "plate": "B1234XYZ" }
```
**Success — `200`** → `{ "ok": true, "vehicle": { "id": 1, "ownerId": 1, "plate": "B1234XYZ" } }`
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
Optionally set the reservation length with `durationMinutes` (defaults to 120).

**Request**
```json
{ "userId": 1, "vehicleId": 1, "durationMinutes": 120 }
```

**Success — `200`** — returns the booking with its reserved window:
```json
{ "ok": true, "booking": { "id": 1, "state": "booked",
  "startTime": 1783396436, "endTime": 1783403636, "plannedDuration": 7200, ... } }
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
Drop the flap so the car can pass. First call moves `booked → active`; it may be
called **again** during the booking (to re-enter after leaving) — the booking
stays `active`. In/out times are recorded by the flap's presence sensor, not here.

**Request**
```json
{ "bookingId": 1 }
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

> **There is no `/close` endpoint.** Raising the flap is automatic: when the flap
> sensor reports the car has left (`presence:"free"`), the server raises the flap
> and logs the `out` event. The booking itself ends on its own when `endTime`
> passes. (The app never needs to "close" a session.)

---

### `POST /cancel` — cancel before use
Cancel a booking that hasn't been opened. Moves `booked → cancelled`. No flap command.

**Request**
```json
{ "bookingId": 1 }
```

**Success — `200`**
```json
{ "ok": true, "message": "booking cancelled",
  "booking": { "id": 1, "state": "cancelled" } }
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
  "bookedBy": 1,
  "status": "occupied",
  "overstay": false
}
```

- `status` is the derived label from section 1 (what the UI shows).
- `bookedBy` is the id of the live booking, or `null` when none.
- `overstay` is `true` if a car is still present after its booking window ended.
- `flapState` (`up`/`down`) and `presence` (`free`/`occupied`) come from the flap's sensor.

---

### `GET /booking/:id` — look up one booking
Fetch a single booking's current state (with derived `plannedDuration`,
`arrivedAt`, `leftAt`, `actualDuration`). Use to poll a booking through its lifecycle.

**Success — `200`**
```json
{ "ok": true, "booking": { "id": 1, "state": "active", "arrivedAt": 1783396500, "actualDuration": null, ... } }
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
0. POST /users    {name}                → user id 1      (once, on signup)
   POST /vehicles {ownerId:1, plate}     → vehicle id 1   (once, per car)
1. GET  /status                          → status:"free"  (spot available)
2. POST /book   {userId:1, vehicleId:1}  → booking id 1, state:"booked"
                                           (reserves [startTime, endTime])
3. POST /open   {bookingId:1}            → "flap opening", state:"active"
   (car arrives → sensor logs "in"; GET /status shows "occupied")
   (car leaves → sensor logs "out", server auto-raises the flap)
   (driver may POST /open again to re-enter, any number of times)
4. endTime passes                        → booking auto-ends (state:"done")
   (GET /status back to "free"; actualDuration = first in → last out)
```

There is no close step. `POST /cancel` can end a booking that was never opened.
If a car is still on the spot after `endTime`, `/status` shows `overstay: true`
until it leaves.

---

## 5. Known limitations (so the frontend plans around them)
- **No auth** — anyone with a `bookingId` can open the flap. PoC only.
- **One flap** — the API assumes a single stall (`flap/01`).
- **Status is push-dependent** — `status`/`overstay` and the in/out log only
  update once the real flap reports `presence`; until then `status` stays
  `booked`/`free` and `actualDuration` stays `null`.

---

## 6. Sign-off
- [ ] Base URLs confirmed (local + deployed)
- [ ] Endpoint shapes agreed with frontend
- [ ] Status/state vocabularies agreed
