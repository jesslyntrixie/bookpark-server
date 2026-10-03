#!/usr/bin/env bash
# End-to-end smoke test for the BookPark server.
# Run the server in one terminal (npm start), then in another: ./test.sh
# NOTE: start from a FRESH server (state is in-memory) so ids are 1, 1, 1.

BASE="${BASE:-http://localhost:3000}"

# Pretty-print JSON if possible, otherwise show raw text.
pp() { python3 -c 'import sys,json
d=sys.stdin.read()
try: print(json.dumps(json.loads(d), indent=2))
except Exception: print(d.strip())'; }

step() { echo; echo "=== $1 ==="; }

post() { curl -s -X POST "$BASE$1" -H "Content-Type: application/json" -d "$2" | pp; }
get()  { curl -s "$BASE$1" | pp; }

step "0. Health check  (expect: running message)"
get "/"

step "1. Book before any user exists  (expect: 404 User not found)"
post "/book" '{"userId":"1","vehicleId":"1"}'

step "2. Create user Gaby  (expect: user id 1, empty vehicles)"
post "/users" '{"name":"Gaby"}'

step "3. Register a vehicle to user 1  (expect: vehicle id 1)"
post "/vehicles" '{"ownerId":"1","plate":"B1234XYZ"}'

step "4. Register vehicle to unknown owner  (expect: 404 Owner not found)"
post "/vehicles" '{"ownerId":"99","plate":"X0000XX"}'

step "5. Get user 1  (expect: Gaby with 1 vehicle)"
get "/users/1"

step "6. Book user 1 + vehicle 1 for 120 min  (expect: id 1, booked, endTime set, plannedDuration 7200)"
post "/book" '{"userId":"1","vehicleId":"1","durationMinutes":120}'

step "7. Book again while live  (expect: 409 already has active booking)"
post "/book" '{"userId":"1","vehicleId":"1"}'

step "8. Open the flap  (expect: flap opening; booking -> active)"
post "/open" '{"bookingId":"1"}'

step "9. Status  (expect: bookedBy 1, overstay false)"
get "/status"

step "10. Open again (re-enter mid-booking)  (expect: flap opening; still active)"
post "/open" '{"bookingId":"1"}'

step "11. Try /cancel an active booking  (expect: 403 only booked can cancel)"
post "/cancel" '{"bookingId":"1"}'

echo
echo "=== done ==="
echo
echo "NOTE: there is no /close. The flap auto-raises when the sensor reports the"
echo "car left, and the booking ends on its own at endTime. In/out times + actual"
echo "duration only populate when a real flap publishes presence over MQTT."
echo "To re-run cleanly, reset the DB:  rm -f bookpark.db bookpark.db-shm bookpark.db-wal"
