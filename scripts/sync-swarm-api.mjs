#!/usr/bin/env node
/**
 * Ongoing automated Swarm / Foursquare check-in syncer for mattbriselli.com.
 *
 * Queries Foursquare's v2 `users/self/checkins` endpoint with `beforeTimestamp`
 * pinned strictly to `now - 7 days` so check-ins from the most recent 7 days are
 * never even downloaded, then runs the private geofence & category scrubber
 * (requiring PRIVACY_GEOFENCE_JSON in CI or .swarm-blocklist.local.json locally —
 * failing closed if no geofence config is loaded so unfiltered pins can never leak!).
 */
import fs from "node:fs";
import path from "node:path";
import { filterAndBlurPlace, getEmbargoCutoffMs, loadPrivacyConfig } from "./privacy-geofence.mjs";

const token = (process.env.SWARM_OAUTH_TOKEN || "").trim();
if (!token) {
  console.log("SWARM_OAUTH_TOKEN is not set yet — skipping ongoing Swarm sync cleanly.");
  process.exit(0);
}

const privacyConfig = loadPrivacyConfig();
// Fail closed: never auto-publish Swarm check-ins without active home-zone geofence rules!
if (!privacyConfig.zones.length) {
  console.error(
    "Refusing to sync Swarm check-ins without PRIVACY_GEOFENCE_JSON or .swarm-blocklist.local.json configured (fail-closed safety guard)."
  );
  process.exit(1);
}

const isBackfill =
  process.argv.includes("--backfill") || process.env.SWARM_BACKFILL === "true";
const beforeUnix = Math.floor(getEmbargoCutoffMs(privacyConfig.embargoDays) / 1000);
const mapsIndexPath = path.resolve("data/maps-index.json");
const mapsPinsPath = path.resolve("data/maps-pins.json");
const htmlPath = path.resolve("index.html");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toVenueLocalDate(createdTs, timeZoneOffsetMin) {
  const offsetSec = Number.isFinite(Number(timeZoneOffsetMin)) ? Number(timeZoneOffsetMin) * 60 : 0;
  return new Date((createdTs + offsetSec) * 1000).toISOString().slice(0, 10);
}

async function fetchCheckinPage(offset = 0) {
  const apiUrl = new URL("https://api.foursquare.com/v2/users/self/checkins");
  apiUrl.searchParams.set("oauth_token", token);
  apiUrl.searchParams.set("v", "20231010");
  apiUrl.searchParams.set("limit", "250");
  apiUrl.searchParams.set("offset", String(offset));
  apiUrl.searchParams.set("beforeTimestamp", String(beforeUnix));

  const res = await fetch(apiUrl);
  if (!res.ok) {
    throw new Error(`Foursquare API returned HTTP ${res.status}`);
  }
  const payload = await res.json();
  return {
    totalCount: Number(payload?.response?.checkins?.count || 0),
    items: payload?.response?.checkins?.items || []
  };
}

async function main() {
  const maxPages = isBackfill ? 160 : 2; // up to 40,000 lifetime check-ins on backfill!
  const items = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchCheckinPage(offset);
    if (!batch.items.length) break;
    items.push(...batch.items);
    console.log(
      `  [Swarm API] page ${page + 1}: fetched ${batch.items.length} check-ins (running total: ${items.length}/${batch.totalCount || "?"})`
    );
    if (batch.items.length < 250) break;
    offset += 250;
    await sleep(180);
  }

  const mapsIndex = JSON.parse(fs.readFileSync(mapsIndexPath, "utf8"));
  const mapsPins = JSON.parse(fs.readFileSync(mapsPinsPath, "utf8"));

  const photoKeys = new Set();
  for (const p of mapsIndex.places || []) {
    photoKeys.add(`${p.name.toLowerCase().slice(0, 14)}|${p.lat.toFixed(2)},${p.lng.toFixed(2)}`);
  }
  const extraPinByKey = new Map();
  for (const p of mapsPins.extraPins || []) {
    const k = `${p.name.toLowerCase().slice(0, 14)}|${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
    photoKeys.add(k);
    extraPinByKey.set(k, p);
  }

  const existingPinIdxByKey = new Map();
  (mapsPins.mapOnlyPins || []).forEach((t, idx) => {
    const k = `${String(t[2]).toLowerCase().slice(0, 14)}|${Number(t[0]).toFixed(2)},${Number(t[1]).toFixed(2)}`;
    if (!existingPinIdxByKey.has(k)) existingPinIdxByKey.set(k, idx);
  });

  const added = [];
  let enrichedExisting = 0;

  for (const ci of items) {
    const createdTs = Number(ci?.createdAt || 0);
    if (!createdTs || createdTs > beforeUnix) continue;
    if (ci?.private || ci?.venue?.private) continue;

    const v = ci.venue || {};
    const name = String(v.name || "").trim();
    const loc = v.location || {};
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const catList = v.categories || [];
    const catNames = catList.map((c) => c?.name || c?.shortName || "").join(" ");
    const primaryCat = String(catList[0]?.shortName || catList[0]?.name || "").trim();
    const visitDate = toVenueLocalDate(createdTs, ci?.timeZoneOffset);

    const locLabel = [
      loc.city || "",
      loc.state || "",
      loc.country && loc.country !== "United States" && loc.country !== "US" ? loc.country : ""
    ]
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
    if (!safe) continue;

    const dedupeKey = `${name.toLowerCase().slice(0, 14)}|${safe.lat.toFixed(2)},${safe.lng.toFixed(2)}`;

    if (photoKeys.has(dedupeKey)) {
      const extraPin = extraPinByKey.get(dedupeKey);
      if (extraPin && !extraPin.date && visitDate) {
        extraPin.date = visitDate;
        enrichedExisting++;
      }
      continue;
    }

    if (existingPinIdxByKey.has(dedupeKey)) {
      const existIdx = existingPinIdxByKey.get(dedupeKey);
      if (existIdx >= 0) {
        const tuple = mapsPins.mapOnlyPins[existIdx];
        let changed = false;
        // check-ins arrive newest-first, so the first match is the most recent (>7d) visit date!
        if (!tuple[6] && visitDate) {
          tuple[4] = tuple[4] || 0;
          tuple[5] = tuple[5] || "";
          tuple[6] = visitDate;
          changed = true;
        }
        if (!tuple[7] && primaryCat) {
          tuple[4] = tuple[4] || 0;
          tuple[5] = tuple[5] || "";
          tuple[6] = tuple[6] || visitDate || "";
          tuple[7] = primaryCat;
          changed = true;
        }
        if (changed) enrichedExisting++;
      }
      continue;
    }

    existingPinIdxByKey.set(dedupeKey, -1);
    added.push([safe.lat, safe.lng, name, safe.location, 0, "", visitDate, primaryCat]);
  }

  if (!added.length && !enrichedExisting) {
    console.log(`Scanned ${items.length} matured (>7d) Swarm check-ins; 0 new or enriched public venues.`);
    return;
  }

  mapsPins.mapOnlyPins = [...added, ...(mapsPins.mapOnlyPins || [])];
  const photoCount = (mapsIndex.places?.length || 0) + (mapsPins.extraPins?.length || 0);
  const extraDots = mapsPins.mapOnlyPins.length + (mapsIndex.heatmapClusters?.length || 0);
  const totalDots = photoCount + extraDots;

  mapsPins.totalPins = totalDots;
  mapsPins.lastUpdated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(mapsPinsPath, JSON.stringify(mapsPins) + "\n", "utf8");

  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, "utf8");
    html = html.replace(
      /[\d,]+ (?:Additional Place Pins|Places Matt Visited) \([\d,]+ Total\)/,
      `${extraDots.toLocaleString("en-US")} Places Matt Visited (${totalDots.toLocaleString("en-US")} Total)`
    );
    fs.writeFileSync(htmlPath, html, "utf8");
  }

  console.log(
    `Added +${added.length} new & enriched ${enrichedExisting} existing Swarm venues (totalPins=${totalDots}).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
