#!/usr/bin/env node
/**
 * Privacy-first Swarm / Foursquare historical check-in importer for mattbriselli.com.
 *
 * Usage:
 *   node scripts/import-swarm-checkins.mjs <checkins.json-or-folder> [--dry-run]
 *
 * Enforces:
 *   1. 7-day rolling time delay (nothing from the most recent 7 days is added).
 *   2. Private home-zone exclusions from gitignored `.swarm-blocklist.local.json`
 *      or `PRIVACY_GEOFENCE_JSON` secret (zero sensitive coords in repository code).
 *   3. Automatic private/errand venue category scrubbing.
 *   4. Stripping of all timestamps, check-in frequencies, companions, shouts, and
 *      street addresses (retaining only City, State/Country + 4-decimal coords).
 */
import fs from "node:fs";
import path from "node:path";
import { filterAndBlurPlace, isTooRecent, loadPrivacyConfig } from "./privacy-geofence.mjs";

const inputArg = process.argv[2];
const isDryRun = process.argv.includes("--dry-run");

if (!inputArg || !fs.existsSync(inputArg)) {
  console.error("Usage: node scripts/import-swarm-checkins.mjs <checkins.json | export-folder> [--dry-run]");
  process.exit(1);
}

const privacyConfig = loadPrivacyConfig();

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
    const items = Array.isArray(parsed)
      ? parsed
      : parsed?.response?.checkins?.items || parsed?.items || parsed?.checkins || [];
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

let delayedRecent7d = 0;
let filteredPrivacyOrCategory = 0;
let skippedDuplicate = 0;
const acceptedByVenue = new Map();

for (const ci of rawItems) {
  const createdTs = ci?.createdAt || ci?.created || ci?.date || "";
  if (isTooRecent(createdTs, privacyConfig.embargoDays)) {
    delayedRecent7d++;
    continue;
  }

  const v = ci?.venue || ci;
  const name = String(v?.name || "").trim();
  const loc = v?.location || {};
  const lat = Number(loc.lat ?? v?.lat);
  const lng = Number(loc.lng ?? loc.lon ?? v?.lng);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

  if (ci?.private || v?.private) {
    filteredPrivacyOrCategory++;
    continue;
  }

  const catNames = (v?.categories || []).map((c) => c?.name || c?.shortName || "").join(" ");
  const city = loc.city || "";
  const state = loc.state || "";
  const country = loc.country || loc.cc || "";
  const locLabel = [city, state, country && country !== "United States" && country !== "US" ? country : ""]
    .filter(Boolean)
    .join(", ");

  const safe = filterAndBlurPlace(
    {
      name,
      location: locLabel || "Visited Venue",
      category: catNames,
      lat,
      lng,
      dateOrTs: createdTs,
      source: "swarm"
    },
    privacyConfig
  );

  if (!safe) {
    filteredPrivacyOrCategory++;
    continue;
  }

  const venueId = String(v?.id || `${name.toLowerCase()}|${safe.lat.toFixed(3)},${safe.lng.toFixed(3)}`);
  if (acceptedByVenue.has(venueId)) continue;

  const dedupeKey = `${name.toLowerCase().slice(0, 14)}|${safe.lat.toFixed(2)},${safe.lng.toFixed(2)}`;
  if (existingGridKeys.has(dedupeKey)) {
    skippedDuplicate++;
    continue;
  }
  existingGridKeys.add(dedupeKey);

  acceptedByVenue.set(venueId, [safe.lat, safe.lng, name, safe.location]);
}

const newTuples = [...acceptedByVenue.values()];
console.log({
  rawCheckinsScanned: rawItems.length,
  heldBackBy7DayDelay: delayedRecent7d,
  filteredByHomeZonesOrPrivateCategories: filteredPrivacyOrCategory,
  skippedAlreadyOnMap: skippedDuplicate,
  cleanPublicVenuesReady: newTuples.length,
  zonesActive: privacyConfig.zones.length,
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
