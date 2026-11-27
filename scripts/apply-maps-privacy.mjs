#!/usr/bin/env node
/**
 * Applies the 7-day rolling delay and private home-zone blur/exclusion rules
 * (from gitignored .swarm-blocklist.local.json or PRIVACY_GEOFENCE_JSON) across
 * existing data/maps-index.json, data/maps-pins.json, and data/maps-reviews.json.
 */
import fs from "node:fs";
import path from "node:path";
import {
  filterAndBlurPlace,
  findMatchingZone,
  isTooRecent,
  loadPrivacyConfig,
  PRIVATE_VENUE_RE
} from "./privacy-geofence.mjs";

const config = loadPrivacyConfig();
const idxPath = path.resolve("data/maps-index.json");
const pinsPath = path.resolve("data/maps-pins.json");
const revPath = path.resolve("data/maps-reviews.json");
const htmlPath = path.resolve("index.html");

const idx = JSON.parse(fs.readFileSync(idxPath, "utf8"));
const pins = JSON.parse(fs.readFileSync(pinsPath, "utf8"));
const rev = JSON.parse(fs.readFileSync(revPath, "utf8"));

let droppedRecentOrErrand = 0;
let blurredPlaces = 0;

function stripZoneTokens(str, zone) {
  if (!str || !zone?.matchRegex) return str;
  try {
    const re = new RegExp(`\\s*[-–·,]?\\s*(${zone.matchRegex})`, "gi");
    return str.replace(re, "").trim();
  } catch {
    return str;
  }
}

function sanitizePlaceList(list) {
  const out = [];
  for (const p of list) {
    const matchedZone = findMatchingZone(p.lat, p.lng, config.zones, `${p.name || ""} ${p.location || ""}`);
    const safe = filterAndBlurPlace(
      {
        name: p.name,
        location: p.location,
        category: p.category || "",
        lat: p.lat,
        lng: p.lng,
        dateOrTs: p.date || "",
        source: "maps"
      },
      config
    );
    if (!safe) {
      droppedRecentOrErrand++;
      continue;
    }
    const cleanName = matchedZone ? stripZoneTokens(p.name, matchedZone) || p.name : p.name;
    // Drop if the venue name itself still explicitly contains a private neighborhood token
    if (matchedZone?.matchRegex && new RegExp(matchedZone.matchRegex, "i").test(cleanName)) {
      droppedRecentOrErrand++;
      continue;
    }
    const copy = { ...p, name: cleanName, lat: safe.lat, lng: safe.lng, location: safe.location };
    if (safe.blurred) {
      blurredPlaces++;
      if (!copy.caption || !copy.caption.startsWith("“")) {
        copy.caption = `Photographed in ${safe.location}.`;
      } else if (matchedZone?.matchRegex && new RegExp(matchedZone.matchRegex, "i").test(copy.caption)) {
        copy.caption = `Photographed in ${safe.location}.`;
      }
    }
    out.push(copy);
  }
  return out;
}

idx.places = sanitizePlaceList(idx.places || []);
pins.extraPins = sanitizePlaceList(pins.extraPins || []);

const cleanTuples = [];
for (const t of pins.mapOnlyPins || []) {
  const [lat, lng, name, loc, rating, snippet, visitDate, category, visitCount, firstDate] = t;
  const matchedZone = findMatchingZone(lat, lng, config.zones, `${name || ""} ${loc || ""}`);
  const safe = filterAndBlurPlace(
    {
      name,
      location: loc,
      category: category || "",
      lat,
      lng,
      dateOrTs: visitDate || "",
      source: "maps"
    },
    config
  );
  if (!safe) {
    droppedRecentOrErrand++;
    continue;
  }
  const cleanName = matchedZone ? stripZoneTokens(name, matchedZone) || name : name;
  if (matchedZone?.matchRegex && new RegExp(matchedZone.matchRegex, "i").test(cleanName)) {
    droppedRecentOrErrand++;
    continue;
  }
  if (safe.blurred) blurredPlaces++;
  const cleanSnip =
    matchedZone?.matchRegex && snippet && new RegExp(matchedZone.matchRegex, "i").test(snippet)
      ? ""
      : snippet;
  const nextTuple = [safe.lat, safe.lng, cleanName, safe.location];
  if (rating || cleanSnip || visitDate || category || visitCount || firstDate) {
    nextTuple.push(rating || 0, cleanSnip || "");
    if (visitDate || category || visitCount || firstDate) {
      nextTuple.push(visitDate || "", category || "");
      if (Number(visitCount) > 1) {
        nextTuple.push(Number(visitCount));
        if (firstDate && firstDate !== visitDate) nextTuple.push(firstDate);
      }
    }
  }
  cleanTuples.push(nextTuple);
}
pins.mapOnlyPins = cleanTuples;

// Scrub written reviews: enforce 7-day delay + blur/drop home-zone addresses & tokens
const cleanReviews = [];
for (const r of rev.reviews || []) {
  if (isTooRecent(r.date, config.embargoDays)) {
    droppedRecentOrErrand++;
    continue;
  }
  const matchedZone = findMatchingZone(null, null, config.zones, `${r.name || ""} ${r.location || ""} ${r.text || ""}`);
  if (matchedZone) {
    if (PRIVATE_VENUE_RE.test(r.name || "")) {
      droppedRecentOrErrand++;
      continue;
    }
    const cleanName = stripZoneTokens(r.name, matchedZone) || r.name;
    if (
      new RegExp(matchedZone.matchRegex, "i").test(cleanName) ||
      new RegExp(matchedZone.matchRegex, "i").test(r.text || "")
    ) {
      droppedRecentOrErrand++;
      continue;
    }
    cleanReviews.push({
      ...r,
      name: cleanName,
      location: matchedZone.coarseLabel
    });
    blurredPlaces++;
    continue;
  }
  cleanReviews.push(r);
}
rev.reviews = cleanReviews;
rev.count = cleanReviews.length;

const allPhotoPlaces = [...idx.places, ...pins.extraPins];
const tags = { all: allPhotoPlaces.length, international: 0, "us-50": 0, nyc: 0 };
for (const p of allPhotoPlaces) tags[p.tag] = (tags[p.tag] || 0) + 1;
const extraDots = pins.mapOnlyPins.length + (idx.heatmapClusters || []).length;
const totalDots = allPhotoPlaces.length + extraDots;

pins.totalPhotoPlaces = allPhotoPlaces.length;
pins.totalPins = totalDots;

fs.writeFileSync(idxPath, JSON.stringify(idx) + "\n", "utf8");
fs.writeFileSync(pinsPath, JSON.stringify(pins) + "\n", "utf8");
fs.writeFileSync(revPath, JSON.stringify(rev, null, 2) + "\n", "utf8");

if (fs.existsSync(htmlPath)) {
  let html = fs.readFileSync(htmlPath, "utf8");
  html = html
    .replace(/(data-slide-filter="all"[^>]*>)Shuffled Mix \([\d,]+\)(<\/button>)/, `$1Shuffled Mix (${tags.all.toLocaleString("en-US")})$2`)
    .replace(/(data-slide-filter="international"[^>]*>)Global &amp; Canada \([\d,]+\)(<\/button>)/, `$1Global &amp; Canada (${tags.international.toLocaleString("en-US")})$2`)
    .replace(/(data-slide-filter="us-50"[^>]*>)50 US States \([\d,]+\)(<\/button>)/, `$150 US States (${tags["us-50"].toLocaleString("en-US")})$2`)
    .replace(/(data-slide-filter="nyc"[^>]*>)NYC &amp; Broadway \([\d,]+\)(<\/button>)/, `$1NYC &amp; Broadway (${tags.nyc.toLocaleString("en-US")})$2`)
    .replace(/(id="slide-counter">)Dispatch 1 of [\d,]+(<\/span>)/, `$1Dispatch 1 of ${tags.all.toLocaleString("en-US")}$2`)
    .replace(/[\d,]+ Photo Pins/, `${tags.all.toLocaleString("en-US")} Photo Pins`)
    .replace(/[\d,]+ (?:Additional Place Pins|Places Matt Visited) \([\d,]+ Total\)/, `${extraDots.toLocaleString("en-US")} Places Matt Visited (${totalDots.toLocaleString("en-US")} Total)`)
    .replace(/(id="gmap-rev-summary-count">)[\d,]+(<\/span>)/, `$1${cleanReviews.length.toLocaleString("en-US")}$2`);
  fs.writeFileSync(htmlPath, html, "utf8");
}

console.log("Applied 7-day embargo + home-zone blur!", {
  droppedRecentOrErrand,
  blurredPlaces,
  photoPins: allPhotoPlaces.length,
  extraDots,
  totalDots,
  reviews: cleanReviews.length
});
