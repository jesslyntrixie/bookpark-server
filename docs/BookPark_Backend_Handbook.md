# BookPark Smart Parking — Backend Owner's Handbook (v2)

*Your personal source of truth. Updated after our decisions: MQTT broker chosen + live, Node.js as the server (Firebase as ripcord), contract issued to IoT.*

> **What changed from v1:** the "which backend / which bridge" options are now DECIDED — you're building a Node.js server that talks MQTT to the flap via a live HiveMQ broker. The old option tables are replaced by "what we chose" below.

---

## Part 0 — Your job in one paragraph

You own **the middle layer** — the "Server" in Chris's diagram. You (1) remember everything (bookings, flap states), (2) answer the app over **HTTP**, and (3) command the flaps over **MQTT**. Nothing talks directly to anything else — it all goes through you.

```
   [ App ] ⇄ HTTP ⇄  [ YOU: Node server ]  ⇄ MQTT (via broker) ⇄ [ Flap ]
```

---

## Part 1 — DECIDED (no longer open)

| Decision | Choice | Note |
|---|---|---|
| Device channel | **MQTT** via **HiveMQ Cloud** broker | broker is live ("Free #1") |
| Backend | **Node.js server** (you write it) | you have Node experience + want the learning |
| Safety ripcord | **Firebase-only fallback** | if Day 1–2 fights you, drop to Firebase; not a failure |
| Data storage (start) | in-memory or lightweight (SQLite/JSON) | only go heavier if you need persistence |
| Message format | **JSON**, timestamps = **Unix epoch seconds** | per the contract |
| Trigger (button vs proximity) | **not your concern** | sensing = App; broadcasting = IoT; you just react to an "open" |

**Why Node (not Firebase):** you're *in charge* of the server and the IoT connects *to* your server — so owning a single Node server that does HTTP + MQTT is the simplest coherent thing *and* the better learning. Firebase stays as the parachute only.

---

## Part 2 — The broker + the contract (the agreed interface)

Broker is **live**. Connection details (in the contract, section 0):
- Host: `5498bd475ef644588d863d458b321d09.s1.eu.hivemq.cloud`
- Port: `8883` (TLS on)
- Username / Password: *(created in Access Management — kept in the contract, not here)*
- Credential permission: **Publish and Subscribe**

**The contract (`BookPark_IoT_Server_Contract.md`) is the source of truth for the interface.** The two channels:
- Server **publishes** commands → topic `flap/01/command` → `{"command":"drop"}` / `{"command":"raise"}`
- Flap **publishes** status → topic `flap/01/status` → `{"flapState":"down"}`, `{"presence":"occupied"}`, etc. Your server **subscribes** here.

> Reminder: MQTT has no "replies." The flap doesn't respond to your command — it independently publishes status on its own channel. Two one-way streams, not a conversation.

---

## Part 3 — The data model (keep it tiny)

> **Note:** the sketch below is the original v2 plan. The **canonical, current**
> data model is the ERD/class diagram in `docs/diagrams/` (which now reflects the
> built system: separate `Vehicle` entity, a reserved `[startTime, endTime]`
> window that auto-ends, in/out times in `Event` (not the booking), and
> `status`/`duration`/`overstay` derived rather than stored). Kept for history.

**Stall/Flap** `{ id, flapState (up/down), presence, bookedBy }` — `status`, `overstay` derived
**Booking** `{ id, userId, vehicleId, flapId, state, startTime, endTime }`
**User** `{ id, name }` — vehicles are their own entity now
**Vehicle** `{ id, ownerId, plate }`
**Event** `{ id, bookingId, flapId, action (in/out), timestamp }` — the in/out log; source of actual duration

Resist adding fields you won't use in two weeks.

### Stored (database) vs runtime (memory)

Not everything above is a database table. The rule:

> **Store what you'd lose forever on a restart and can't get back. Keep in
> memory what a device re-sends, or what you can recompute from stored data.**

- **Stored — SQLite tables** (survive restarts): `users`, `vehicles`,
  `bookings`, `events`. Nothing else re-creates these, so they must persist.
  *These four are the ERD (`BookPark_ERD`).*
- **Runtime — in server memory** (rebuilt on each start): the **Stall** object
  (`flapState`, `presence`) — the flap re-reports these over MQTT within
  seconds, so there's no need to save them. And `bookedBy` / `status` /
  `overstay` are **derived** from the `bookings` table on demand, never stored.

That's why the **ERD shows only the 4 tables**, while the **class/domain
diagram** (`BookPark_Data_Model`) also shows `Stall`, marked *runtime, not stored*.
An ERD models the database; a class diagram models the code's objects.

> Multi-flap later: the flaps' **identity/config** (which flaps exist) would
> become a real `stalls` table (so `bookings.flapId` becomes a true FK); each
> flap's **live sensor state** would stay a runtime lookup keyed by flap id.

---

## Part 4 — Your task list (front-loaded to de-risk early)

**Do the scary part first.** The critical path is proving your server can drive the flap through the broker. If that works by Day 2, you basically can't fail.

**B1 — Node server connects to the broker + publishes "drop"** ⭐ *(Day 1 target)*
- Node app connects to HiveMQ (host/port/creds), publishes `{"command":"drop"}` to `flap/01/command`.
- Test with a fake subscriber (MQTT Explorer) — no app, no real flap needed.
→ *Done when:* you publish and see the message arrive in a test tool.

**B2 — Prove it against the real flap (INT1)** ⭐ *(Day 2 target)*
- Your teammate's ESP32 subscribes; your publish makes the real flap drop.
→ *Done when:* your server's "drop" physically moves the flap. **This is the milestone; fear mostly gone here.**

**B3 — HTTP endpoints for the app**
- `create booking`, `open spot`, (opt) `availability`.
- "open spot" verifies the booking, then publishes "drop" (reuses B1).
→ *Done when:* an HTTP call to "open" drops the flap (INT3).

**B4 — Booking logic + data**
- Create booking → stall `booked`; reject double-booking; store it.
→ *Done when:* booking flips stall state and blocks a second booking.

**B5 — Subscribe to status back**
- Subscribe to `flap/01/status`; update stall state when the flap reports.
→ *Done when:* flap's status changes are reflected in your data.

**B6 — Exit + duration**
- Log in/out events; duration = timeOut − timeIn (epoch subtraction); free the stall.
→ *Done when:* a full in→out cycle stores a duration and frees the stall.

---

## Part 5 — Suggested days (4 focused hrs/day, no all-nighters)

| Day | Target |
|---|---|
| 1 | B1 — server publishes "drop" to broker, tested with a fake subscriber |
| 2 | B2 — real flap drops from your server (**INT1**) |
| 3 | B3 + B4 — HTTP endpoints + booking logic (INT2, INT3) |
| 4 | B5 + B6 — status back, duration, error handling, polish |
| 5 | Buffer for the bugs that always show up |

> If Day 1–2 fights you badly → pull the **Firebase ripcord**. It's judgment, not failure.

---

## Part 6 — What to learn (targeted)

- **Node MQTT client** — the `mqtt` npm library: connect, publish, subscribe (~20–30 lines).
- **A tiny HTTP server** — Express basics: a few POST/GET endpoints.
- **JSON** — you know this.
- **HiveMQ "Test your connection" tab + MQTT Explorer** — to sanity-check the broker.
- Skip: auth systems, scaling, hosting, payments. Not needed for a PoC.

---

## Part 7 — Traps to avoid

- **Wrong credential permission** → must be **Publish and Subscribe**, not Subscribe Only, or nothing sends.
- **Mismatched topic/field names** vs the ESP32 → silent failure. The contract is the shared truth; both copy it exactly.
- **Timestamp unit mismatch** → agree epoch **seconds** (10 digits), not milliseconds.
- **Overbuilding the data model** → keep it tiny.
- **Building everything before testing** → test B1 immediately with a fake subscriber before moving on.
- **Losing sleep** → tired debugging is the slowest kind; the front-loaded plan exists so you don't have to.

---

## Part 8 — Definition of done (your checklist)

- [ ] Node server connects to HiveMQ and publishes "drop" (B1)
- [ ] Real flap drops from your server (B2 / INT1)
- [ ] App "open" → flap drops (B3 / INT3)
- [ ] Booking creates a record + blocks double-booking (B4 / INT2)
- [ ] Flap status flows back and updates your data (B5)
- [ ] Full in→out logs duration + frees stall (B6)

---

*Companions: `BookPark_IoT_Server_Contract.md` (the interface — sent to IoT), `BookPark_Parking_Architecture.md` (whole system), `BookPark_Tech_Kanban.md` (all streams). Your cards: B1–B6 + INT1/INT2/INT3.*
