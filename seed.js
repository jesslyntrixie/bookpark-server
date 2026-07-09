// seed.js
// Inserts a small set of example users + vehicles for demos/testing.
// Run once on a fresh database:  node seed.js
// (Safe to run again — it just appends more sample rows.)

import * as db from "./db.js";

const sample = [
  { name: "Gaby", plates: ["B1234XYZ"] },
  { name: "Cia", plates: ["DK5678ABC", "DK9012DEF"] }, 
  { name: "Gabriel", plates: ["A3456GHI"] },
  { name: "Beata", plates: ["B6769LK", "B7878POP", "B1111AAA"] },
  { name: "Taqwa", plates: ["DR787UYJ", "DR5427LKJ", "DR1111PPP"] },
  { name: "Jess", plates: ["E1234JKL"] }
];

for (const person of sample) {
  const user = db.createUser(person.name);
  const vehicles = person.plates.map((p) => db.createVehicle(user.id, p));
  console.log(
    `Seeded user ${user.id} (${user.name}) with vehicles:`,
    vehicles.map((v) => `${v.id}:${v.plate}`).join(", ")
  );
}

console.log("✅ Seeding done.");
process.exit(0);
