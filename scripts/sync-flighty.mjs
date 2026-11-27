#!/usr/bin/env node
/**
 * sync-flighty.mjs — Privacy-Safe Flighty CSV Aggregator
 *
 * Reads a Flighty CSV export, strips ALL private fields (PNRs, confirmation codes,
 * seats, tail numbers, exact timestamps, canceled flights, and future booked flights),
 * computes spherical great-circle distances, and writes compact `data/flighty-routes.json`.
 *
 * Usage:
 *   node scripts/sync-flighty.mjs path/to/FlightyExport.csv
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.resolve(__dirname, "../data/flighty-routes.json");

const AIRPORTS = {
  AGP: { city: "Málaga, Spain", lat: 36.6749, lng: -4.4991 },
  ALA: { city: "Almaty, Kazakhstan", lat: 43.3521, lng: 77.0405 },
  ANC: { city: "Anchorage, AK", lat: 61.1743, lng: -149.9962 },
  ARN: { city: "Stockholm, Sweden", lat: 59.6519, lng: 17.9186 },
  ASB: { city: "Ashgabat, Turkmenistan", lat: 37.9868, lng: 58.3610 },
  ATH: { city: "Athens, Greece", lat: 37.9364, lng: 23.9445 },
  ATL: { city: "Atlanta, GA", lat: 33.6407, lng: -84.4277 },
  AUS: { city: "Austin, TX", lat: 30.1975, lng: -97.6664 },
  BFS: { city: "Belfast, Northern Ireland", lat: 54.6575, lng: -6.2158 },
  BGO: { city: "Bergen, Norway", lat: 60.2934, lng: 5.2181 },
  BKK: { city: "Bangkok (Suvarnabhumi), Thailand", lat: 13.6900, lng: 100.7501 },
  BLQ: { city: "Bologna, Italy", lat: 44.5354, lng: 11.2887 },
  BOS: { city: "Boston, MA", lat: 42.3656, lng: -71.0096 },
  BSZ: { city: "Bishkek (Manas), Kyrgyzstan", lat: 43.0613, lng: 74.4776 },
  FRU: { city: "Bishkek (Manas), Kyrgyzstan", lat: 43.0613, lng: 74.4776 },
  BUD: { city: "Budapest, Hungary", lat: 47.4369, lng: 19.2556 },
  BUR: { city: "Burbank, CA", lat: 34.2007, lng: -118.3587 },
  BWI: { city: "Baltimore/Washington, MD", lat: 39.1754, lng: -76.6684 },
  CLT: { city: "Charlotte, NC", lat: 35.2140, lng: -80.9431 },
  CMH: { city: "Columbus, OH", lat: 39.9980, lng: -82.8919 },
  CNX: { city: "Chiang Mai, Thailand", lat: 18.7668, lng: 98.9626 },
  CRL: { city: "Brussels South Charleroi, Belgium", lat: 50.4592, lng: 4.4538 },
  DCA: { city: "Washington National (Reagan), VA", lat: 38.8512, lng: -77.0402 },
  DEN: { city: "Denver, CO", lat: 39.8561, lng: -104.6737 },
  DFW: { city: "Dallas/Fort Worth, TX", lat: 32.8998, lng: -97.0403 },
  DMK: { city: "Bangkok (Don Mueang), Thailand", lat: 13.9126, lng: 100.6068 },
  DOH: { city: "Doha, Qatar", lat: 25.2731, lng: 51.6081 },
  DUB: { city: "Dublin, Ireland", lat: 53.4264, lng: -6.2499 },
  DYU: { city: "Dushanbe, Tajikistan", lat: 38.5433, lng: 68.8250 },
  EIN: { city: "Eindhoven, Netherlands", lat: 51.4501, lng: 5.3745 },
  EVN: { city: "Yerevan, Armenia", lat: 40.1473, lng: 44.3959 },
  EWR: { city: "Newark / NYC, NJ", lat: 40.6895, lng: -74.1745 },
  FLL: { city: "Fort Lauderdale, FL", lat: 26.0742, lng: -80.1506 },
  GYD: { city: "Baku, Azerbaijan", lat: 40.4675, lng: 50.0467 },
  HEL: { city: "Helsinki, Finland", lat: 60.3172, lng: 24.9633 },
  HKG: { city: "Hong Kong", lat: 22.3080, lng: 113.9185 },
  HNL: { city: "Honolulu, HI", lat: 21.3187, lng: -157.9224 },
  IAD: { city: "Washington Dulles, VA", lat: 38.9531, lng: -77.4565 },
  ICN: { city: "Seoul (Incheon), South Korea", lat: 37.4602, lng: 126.4407 },
  IST: { city: "İstanbul, Türkiye", lat: 41.2753, lng: 28.7519 },
  JFK: { city: "New York (JFK), NY", lat: 40.6413, lng: -73.7781 },
  LAX: { city: "Los Angeles, CA", lat: 33.9416, lng: -118.4085 },
  LBD: { city: "Khujand, Tajikistan", lat: 40.2154, lng: 69.6947 },
  LGA: { city: "New York (LaGuardia), NY", lat: 40.7769, lng: -73.8740 },
  LHR: { city: "London (Heathrow), UK", lat: 51.4700, lng: -0.4543 },
  LTN: { city: "London (Luton), UK", lat: 51.8747, lng: -0.3683 },
  MAN: { city: "Manchester, UK", lat: 53.3537, lng: -2.2750 },
  MEL: { city: "Melbourne, Australia", lat: -37.6690, lng: 144.8410 },
  MEX: { city: "Mexico City, Mexico", lat: 19.4363, lng: -99.0721 },
  MIA: { city: "Miami, FL", lat: 25.7959, lng: -80.2870 },
  MSO: { city: "Missoula, MT", lat: 46.9163, lng: -114.0906 },
  MSP: { city: "Minneapolis/St. Paul, MN", lat: 44.8848, lng: -93.2223 },
  MSY: { city: "New Orleans, LA", lat: 29.9934, lng: -90.2580 },
  MUC: { city: "Munich, Germany", lat: 48.3537, lng: 11.7750 },
  MYP: { city: "Mary, Turkmenistan", lat: 37.6068, lng: 61.8967 },
  NAP: { city: "Naples, Italy", lat: 40.8860, lng: 14.2908 },
  NCU: { city: "Nukus, Uzbekistan", lat: 42.4884, lng: 59.6233 },
  NQZ: { city: "Astana, Kazakhstan", lat: 51.0222, lng: 71.4669 },
  NRT: { city: "Tokyo (Narita), Japan", lat: 35.7720, lng: 140.3929 },
  ORD: { city: "Chicago (O'Hare), IL", lat: 41.9742, lng: -87.9073 },
  OSL: { city: "Oslo, Norway", lat: 60.1976, lng: 11.1004 },
  PDX: { city: "Portland, OR", lat: 45.5898, lng: -122.5951 },
  PHL: { city: "Philadelphia, PA", lat: 39.8744, lng: -75.2424 },
  PHX: { city: "Phoenix, AZ", lat: 33.4373, lng: -112.0078 },
  PIT: { city: "Pittsburgh, PA", lat: 40.4915, lng: -80.2329 },
  SEA: { city: "Seattle, WA", lat: 47.4502, lng: -122.3088 },
  SFO: { city: "San Francisco, CA", lat: 37.6213, lng: -122.3790 },
  SJC: { city: "San Jose, CA", lat: 37.3639, lng: -121.9289 },
  SJD: { city: "San José del Cabo, Mexico", lat: 23.1518, lng: -109.7210 },
  SLC: { city: "Salt Lake City, UT", lat: 40.7899, lng: -111.9791 },
  STN: { city: "London (Stansted), UK", lat: 51.8860, lng: 0.2389 },
  SYD: { city: "Sydney, Australia", lat: -33.9399, lng: 151.1753 },
  SYR: { city: "Syracuse, NY", lat: 43.1112, lng: -76.1063 },
  TAS: { city: "Tashkent, Uzbekistan", lat: 41.2579, lng: 69.2812 },
  TAZ: { city: "Daşoguz, Turkmenistan", lat: 41.7617, lng: 59.8333 },
  TBS: { city: "Tbilisi, Georgia", lat: 41.6692, lng: 44.9547 },
  TLL: { city: "Tallinn, Estonia", lat: 59.4133, lng: 24.8328 },
  TPA: { city: "Tampa, FL", lat: 27.9755, lng: -82.5332 },
  TPE: { city: "Taipei (Taoyuan), Taiwan", lat: 25.0797, lng: 121.2342 },
  VNO: { city: "Vilnius, Lithuania", lat: 54.6341, lng: 25.2858 },
  YVR: { city: "Vancouver, BC, Canada", lat: 49.1967, lng: -123.1815 },
  YYC: { city: "Calgary, AB, Canada", lat: 51.1215, lng: -114.0076 },
  YYZ: { city: "Toronto, ON, Canada", lat: 43.6777, lng: -79.6248 },
  YZF: { city: "Yellowknife, NWT, Canada", lat: 62.4628, lng: -114.4403 }
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length || row.length) {
    row.push(cur.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.length > 0));
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.7613; // Earth mean radius in statute miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node scripts/sync-flighty.mjs <path/to/FlightyExport.csv>");
  process.exit(1);
}

const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
const headers = rows[0];
const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

const today = new Date().toISOString().slice(0, 10);
const airportCounts = new Map();
const routeMap = new Map();
const airlines = new Set();
const aircraft = new Set();
const years = new Set();

let totalFlights = 0;
let totalMiles = 0;
const missingAirports = new Set();

for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const date = (r[idx["Date"]] || "").trim();
  const isCanceled = String(r[idx["Canceled"]] || "").toLowerCase() === "true";
  const hasActual = Boolean(
    (r[idx["Gate Departure (Actual)"]] || "").trim() ||
    (r[idx["Take off (Actual)"]] || "").trim() ||
    (r[idx["Landing (Actual)"]] || "").trim() ||
    (r[idx["Gate Arrival (Actual)"]] || "").trim()
  );
  // Strictly exclude canceled flights and any future/unflown flights
  if (isCanceled || !date || date > today || (date >= "2026-01-01" && !hasActual)) continue;

  const from = (r[idx["From"]] || "").trim().toUpperCase();
  const to = (r[idx["To"]] || "").trim().toUpperCase();
  if (!from || !to) continue;

  const a1 = AIRPORTS[from];
  const a2 = AIRPORTS[to];
  if (!a1) missingAirports.add(from);
  if (!a2) missingAirports.add(to);
  if (!a1 || !a2) continue;

  totalFlights++;
  if (date.slice(0, 4)) years.add(date.slice(0, 4));
  if (r[idx["Airline"]]) airlines.add(r[idx["Airline"]].trim());
  if (r[idx["Aircraft Type Name"]]) aircraft.add(r[idx["Aircraft Type Name"]].trim());

  airportCounts.set(from, (airportCounts.get(from) || 0) + 1);
  airportCounts.set(to, (airportCounts.get(to) || 0) + 1);

  const legMiles = Math.round(haversineMiles(a1.lat, a1.lng, a2.lat, a2.lng));
  totalMiles += legMiles;

  const [k1, k2] = from < to ? [from, to] : [to, from];
  const key = `${k1}-${k2}`;
  const existing = routeMap.get(key);
  if (existing) {
    existing.count++;
  } else {
    routeMap.set(key, { from: k1, to: k2, count: 1, miles: legMiles });
  }
}

if (missingAirports.size) {
  console.warn("Missing airport coordinates for:", [...missingAirports].join(", "));
}

const sortedYears = [...years].sort();
const airportsList = [...airportCounts.entries()]
  .map(([code, visits]) => ({
    code,
    city: AIRPORTS[code].city,
    lat: AIRPORTS[code].lat,
    lng: AIRPORTS[code].lng,
    visits
  }))
  .sort((a, b) => b.visits - a.visits);

const routesList = [...routeMap.values()].sort((a, b) => b.count - a.count || b.miles - a.miles);
const earthOrbits = Number((totalMiles / 24901).toFixed(1));

const output = {
  summary: {
    totalFlights,
    totalMiles,
    earthOrbits,
    uniqueAirports: airportsList.length,
    uniqueRoutes: routesList.length,
    uniqueAirlines: airlines.size,
    uniqueAircraft: aircraft.size,
    yearRange: `${sortedYears[0]}–${sortedYears[sortedYears.length - 1]}`
  },
  airports: airportsList,
  routes: routesList
};

fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n");
console.log("Wrote", OUT_PATH);
console.log("Summary:", output.summary);
console.log("Top 8 Airports:", airportsList.slice(0, 8));
console.log("Top 8 Routes:", routesList.slice(0, 8));
