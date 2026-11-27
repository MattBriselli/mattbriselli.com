#!/usr/bin/env node
/**
 * Privacy-first Swarm / Foursquare check-in importer for mattbriselli.com.
 *
 * Usage:
 *   node scripts/import-swarm-checkins.mjs <path-to-checkins.json-or-folder> [--dry-run]
 *
 * Anti-doxxing safeguards built in:
 *   1. Broad metro geofence exclusions for NYC / Tri-State and Southeastern PA /
 *      Greater Philadelphia (Delaware, Montgomery, Chester, Bucks, Phila counties,
 *      South NJ, and Northern DE) — zero private home coordinates stored in code.
 *   2. Optional gitignored `.swarm-blocklist.local.json` support for fine-grained
 *      private radii (e.g. past apartments in SF/Seattle/Arlington/Pittsburgh or
 *      family/friends' residences) that NEVER gets committed to GitHub:
 *        { "circles": [{ "label": "Past apt", "lat": 37.75, "lng": -122.48, "radiusKm": 1.2 }] }
 *   3. Automatic category scrubbing: drops private residences, apartments, offices,
 *      medical/dental clinics, banks, schools/dorms, and gyms.
 *   4. Strips all timestamps, check-in counts, shouts, and companions, and rounds
 *      coordinates to 4 decimal places (~11m venue-level precision).
 */
import fs from "node:fs";
import path from "node:path";

const inputArg = process.argv[2];
const isDryRun = process.argv.includes("--dry-run");

if (!inputArg || !fs.existsSync(inputArg)) {
  console.error("Usage: node scripts/import-swarm-checkins.mjs <checkins.json | export-folder> [--dry-run]");
  process.exit(1);
}

// 1. Broad public metro exclusion zones (no personal street/home coords in repo!)
const METRO_EXCLUSION_BOXES = [
  {
    name: "NYC, Five Boroughs, North NJ, Lower Westchester & Western Long Island",
    minLat: 40.47,
    maxLat: 41.18,
    minLng: -74.35,
    maxLng: -73.62
  },
  {
    name: "Southeastern PA / Greater Philadelphia / Delco / Main Line / South NJ / Northern DE",
    minLat: 39.66,
    maxLat: 40.46,
    minLng: -75.95,
    maxLng: -74.68
  }
];

// 2. Optional local-only fine-grained circle blocklist (gitignored!)
const localBlocklistPath = path.resolve(".swarm-blocklist.local.json");
const localCircles = fs.existsSync(localBlocklistPath)
  ? JSON.parse(fs.readFileSync(localBlocklistPath, "utf8"))?.circles || []
  : [];

// 3. Sensitive / private venue category patterns to exclude everywhere
const PRIVATE_CATEGORY_RE =
  /\b(home|residential|apartment|condo|housing|dorm|fraternity|sorority|office|coworking|tech startup|conference room|doctor|dentist|medical|hospital|urgent care|clinic|pharmacy|therapy|bank|credit union|atm|gym|fitness|yoga|post office|laundromat|dry cleaner|parking|garage)\b/i;

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isGeofenceBlocked(lat, lng) {
  for (const box of METRO_EXCLUSION_BOXES) {
    if (lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng) {
      return box.name;
    }
  }
  for (const c of localCircles) {
    if (typeof c.lat === "number" && typeof c.lng === "number") {
      const rKm = Number(c.radiusKm) || 1.0;
      if (haversineKm(lat, lng, c.lat, c.lng) <= rKm) {
        return c.label || "local-circle-blocklist";
      }
    }
  }
  return null;
}

function loadCheckinItems(target) {
  const stat = fs.statSync(target);
  const files = stat.isDirectory()
    ? fs
        .readdirSync(target)
        .filter((f) => /^checkins.*\.json$/i.test(f))
        .map((f) => path.join(target, f))
    : [target];

  const all = [];
  for (const file of files) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const items = Array.isArray(parsed) ? parsed : parsed.items || parsed.checkins || [];
    all.push(...items);
  }
  return all;
}

const rawItems = loadCheckinItems(inputArg);
const mapsIndex = JSON.parse(fs.readFileSync(path.resolve("data/maps-index.json"), "utf8"));
const mapsPinsPath = path.resolve("data/maps-pins.json");
const mapsPins = fs.existsSync(mapsPinsPath)
  ? JSON.parse(fs.readFileSync(mapsPinsPath, "utf8"))
  : { extraPins: [], mapOnlyPins: [] };

const existingGridKeys = new Set();
for (const p of [...(mapsIndex.places || []), ...(mapsPins.extraPins || [])]) {
  existingGridKeys.add(`${p.name.toLowerCase().slice(0, 14)}|${p.lat.toFixed(2)},${p.lng.toFixed(2)}`);
}
for (const t of mapsPins.mapOnlyPins || []) {
  existingGridKeys.add(`${String(t[2]).toLowerCase().slice(0, 14)}|${Number(t[0]).toFixed(2)},${Number(t[1]).toFixed(2)}`);
}

let blockedMetro = 0;
let blockedPrivateCat = 0;
let skippedDuplicate = 0;
const acceptedByVenue = new Map();

for (const ci of rawItems) {
  const v = ci?.venue || ci;
  const name = String(v?.name || "").trim();
  const loc = v?.location || {};
  const lat = Number(loc.lat ?? v?.lat);
  const lng = Number(loc.lng ?? loc.lon ?? v?.lng);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

  if (ci?.private || v?.private) {
    blockedPrivateCat++;
    continue;
  }

  const catNames = (v?.categories || []).map((c) => c?.name || c?.shortName || "").join(" ");
  if (PRIVATE_CATEGORY_RE.test(catNames) || PRIVATE_CATEGORY_RE.test(name)) {
    blockedPrivateCat++;
    continue;
  }

  const blockedReason = isGeofenceBlocked(lat, lng);
  if (blockedReason) {
    blockedMetro++;
    continue;
  }

  const venueId = String(v?.id || `${name.toLowerCase()}|${lat.toFixed(3)},${lng.toFixed(3)}`);
  if (acceptedByVenue.has(venueId)) continue;

  const dedupeKey = `${name.toLowerCase().slice(0, 14)}|${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (existingGridKeys.has(dedupeKey)) {
    skippedDuplicate++;
    continue;
  }
  existingGridKeys.add(dedupeKey);

  const city = loc.city || "";
  const state = loc.state || "";
  const country = loc.country || loc.cc || "";
  const locParts = [city, state, country && country !== "United States" && country !== "US" ? country : ""]
    .filter(Boolean)
    .join(", ");

  acceptedByVenue.set(venueId, [
    Number(lat.toFixed(4)),
    Number(lng.toFixed(4)),
    name,
    locParts || "Visited Venue"
  ]);
}

const newTuples = [...acceptedByVenue.values()];
console.log({
  rawCheckinsScanned: rawItems.length,
  blockedInNycOrSePaOrLocalCircles: blockedMetro,
  blockedPrivateOrSensitiveCategory: blockedPrivateCat,
  skippedAlreadyOnMap: skippedDuplicate,
  cleanPublicVenuesReady: newTuples.length,
  dryRun: isDryRun
});

if (!isDryRun && newTuples.length > 0) {
  mapsPins.mapOnlyPins = [...(mapsPins.mapOnlyPins || []), ...newTuples];
  mapsPins.totalPins =
    (mapsIndex.places?.length || 0) +
    (mapsPins.extraPins?.length || 0) +
    mapsPins.mapOnlyPins.length +
    (mapsIndex.heatmapClusters?.length || 0);
  mapsPins.lastUpdated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(mapsPinsPath, JSON.stringify(mapsPins) + "\n", "utf8");
  console.log(`Merged +${newTuples.length} clean Swarm venues into data/maps-pins.json (totalPins=${mapsPins.totalPins}).`);
}
