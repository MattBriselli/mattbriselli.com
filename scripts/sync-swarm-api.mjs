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

  const photoByKey = new Map();
  for (const p of mapsIndex.places || []) {
    const k = `${p.name.toLowerCase().slice(0, 14)}|${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
    photoByKey.set(k, { obj: p, inIndex: true });
  }
  for (const p of mapsPins.extraPins || []) {
    const k = `${p.name.toLowerCase().slice(0, 14)}|${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
    if (!photoByKey.has(k)) photoByKey.set(k, { obj: p, inIndex: false });
  }

  const existingPinIdxByKey = new Map();
  (mapsPins.mapOnlyPins || []).forEach((t, idx) => {
    const k = `${String(t[2]).toLowerCase().slice(0, 14)}|${Number(t[0]).toFixed(2)},${Number(t[1]).toFixed(2)}`;
    if (!existingPinIdxByKey.has(k)) existingPinIdxByKey.set(k, idx);
  });

  // Aggregate check-ins per public venue (visitCount, firstDate, lastDate, category)
  const venueAgg = new Map();
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
    let rec = venueAgg.get(dedupeKey);
    if (!rec) {
      rec = {
        lat: safe.lat,
        lng: safe.lng,
        name,
        location: safe.location,
        dates: visitDate ? [visitDate] : [],
        firstDate: visitDate || "",
        lastDate: visitDate || "",
        category: primaryCat
      };
      venueAgg.set(dedupeKey, rec);
    } else {
      if (visitDate) {
        rec.dates.push(visitDate);
        if (!rec.firstDate || visitDate < rec.firstDate) rec.firstDate = visitDate;
        if (!rec.lastDate || visitDate > rec.lastDate) rec.lastDate = visitDate;
      }
      if (!rec.category && primaryCat) rec.category = primaryCat;
    }
  }

  function buildCompactTuple(lat, lng, name, loc, rating, snippet, lastDate, cat, count, firstDate) {
    const out = [lat, lng, name, loc, rating || 0, snippet || "", lastDate || "", cat || ""];
    if (count > 1) {
      out.push(count);
      if (firstDate && firstDate !== lastDate) {
        out.push(firstDate);
      }
    }
    return out;
  }

  const added = [];
  let enrichedExisting = 0;
  let indexDirty = false;

  for (const [dedupeKey, rec] of venueAgg.entries()) {
    const totalFetchedVisits = Math.max(1, rec.dates.length);

    if (photoByKey.has(dedupeKey)) {
      const { obj: p, inIndex } = photoByKey.get(dedupeKey);
      let pChanged = false;
      if (!p.date && rec.lastDate) {
        p.date = rec.lastDate;
        pChanged = true;
      }
      if (isBackfill && totalFetchedVisits > 1 && p.visitCount !== totalFetchedVisits) {
        p.visitCount = totalFetchedVisits;
        pChanged = true;
      }
      if (rec.firstDate && rec.firstDate !== (p.date || rec.lastDate) && p.firstDate !== rec.firstDate) {
        p.firstDate = rec.firstDate;
        pChanged = true;
      }
      if (pChanged) {
        enrichedExisting++;
        if (inIndex) indexDirty = true;
      }
      continue;
    }

    if (existingPinIdxByKey.has(dedupeKey)) {
      const existIdx = existingPinIdxByKey.get(dedupeKey);
      const prev = mapsPins.mapOnlyPins[existIdx];
      const prevLast = prev[6] || "";
      const prevCat = prev[7] || "";
      const prevCount = Number(prev[8]) || 1;
      const prevFirst = prev[9] || prevLast;

      let nextLast = prevLast;
      let nextFirst = prevFirst;
      let nextCount = prevCount;
      const nextCat = prevCat || rec.category;

      if (isBackfill) {
        nextCount = totalFetchedVisits;
        nextLast = rec.lastDate || prevLast;
        nextFirst = rec.firstDate || prevFirst;
      } else {
        const newerVisits = prevLast ? rec.dates.filter((d) => d > prevLast).length : 0;
        if (!prevLast && rec.lastDate) {
          nextLast = rec.lastDate;
          nextFirst = rec.firstDate || rec.lastDate;
          nextCount = Math.max(prevCount, totalFetchedVisits);
        } else if (newerVisits > 0) {
          nextCount = prevCount + newerVisits;
          nextLast = rec.lastDate;
          if (rec.firstDate && (!nextFirst || rec.firstDate < nextFirst)) nextFirst = rec.firstDate;
        }
      }

      const rebuilt = buildCompactTuple(
        prev[0],
        prev[1],
        prev[2],
        prev[3],
        prev[4],
        prev[5],
        nextLast,
        nextCat,
        nextCount,
        nextFirst
      );
      if (JSON.stringify(rebuilt) !== JSON.stringify(prev)) {
        mapsPins.mapOnlyPins[existIdx] = rebuilt;
        enrichedExisting++;
      }
      continue;
    }

    added.push(
      buildCompactTuple(
        rec.lat,
        rec.lng,
        rec.name,
        rec.location,
        0,
        "",
        rec.lastDate,
        rec.category,
        totalFetchedVisits,
        rec.firstDate
      )
    );
  }

  if (!added.length && !enrichedExisting) {
    console.log(`Scanned ${items.length} matured (>7d) Swarm check-ins; 0 new or enriched public venues.`);
    return;
  }

  if (indexDirty) {
    const nextIndexStr = JSON.stringify(mapsIndex) + "\n";
    if (Buffer.byteLength(nextIndexStr, "utf8") < 260000) {
      fs.writeFileSync(mapsIndexPath, nextIndexStr, "utf8");
    }
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
