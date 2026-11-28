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
  PRIVATE_VENUE_RE,
  thinHomeZones
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

const LH3_PREFIX = "https://lh3.googleusercontent.com/";
const LH3_DEFAULT_SUFFIX = "=w1000-h750-p-k-no";
const BOILERPLATE_CAPTION_RE = /^Photographed (?:in |on Google Maps )/i;

function compactPhotoUrl(u) {
  if (typeof u !== "string" || !u) return u;
  if (u.startsWith("lh3:")) return u;
  if (u.startsWith(LH3_PREFIX)) {
    let body = u.slice(LH3_PREFIX.length);
    if (body.endsWith(LH3_DEFAULT_SUFFIX)) {
      body = body.slice(0, -LH3_DEFAULT_SUFFIX.length);
    }
    return `lh3:${body}`;
  }
  return u;
}

function compactPlaceForStorage(p) {
  const out = { ...p };
  if (Array.isArray(out.photos) && out.photos.length) {
    out.photos = out.photos.map(compactPhotoUrl);
  }
  if (typeof out.caption === "string" && BOILERPLATE_CAPTION_RE.test(out.caption)) {
    delete out.caption;
  }
  if (out.countryIso === "US") {
    delete out.countryIso;
  }
  return out;
}

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
    if (safe.inZone || safe.blurred) {
      blurredPlaces++;
      // Strip repeat-visit signals inside home zones so local routines never stand out
      delete copy.visitCount;
      delete copy.firstDate;
      if (!copy.caption || !copy.caption.startsWith("“")) {
        delete copy.caption;
      } else if (matchedZone?.matchRegex && new RegExp(matchedZone.matchRegex, "i").test(copy.caption)) {
        delete copy.caption;
      }
    }
    out.push(compactPlaceForStorage(copy));
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
  if (safe.inZone || safe.blurred) blurredPlaces++;
  const cleanSnip =
    matchedZone?.matchRegex && snippet && new RegExp(matchedZone.matchRegex, "i").test(snippet)
      ? ""
      : snippet;
  const keepVisitCount = safe.inZone ? 1 : Number(visitCount) || 1;
  const keepFirstDate = safe.inZone ? "" : firstDate;
  const nextTuple = [safe.lat, safe.lng, cleanName, safe.location];
  if (rating || cleanSnip || visitDate || category || keepVisitCount > 1 || keepFirstDate) {
    nextTuple.push(rating || 0, cleanSnip || "");
    if (visitDate || category || keepVisitCount > 1 || keepFirstDate) {
      nextTuple.push(visitDate || "", category || "");
      if (keepVisitCount > 1) {
        nextTuple.push(keepVisitCount);
        if (keepFirstDate && keepFirstDate !== visitDate) nextTuple.push(keepFirstDate);
      }
    }
  }
  cleanTuples.push(nextTuple);
}
pins.mapOnlyPins = cleanTuples;

// Density-matched thinning across all pins so home zones blend into surrounding ring density
const combinedForThinning = [
  ...idx.places.map((p, i) => ({
    bucket: "index",
    idx: i,
    lat: p.lat,
    lng: p.lng,
    key: `idx|${p.name}|${p.lat}|${p.lng}`,
    priority: 2
  })),
  ...pins.extraPins.map((p, i) => ({
    bucket: "extra",
    idx: i,
    lat: p.lat,
    lng: p.lng,
    key: `extra|${p.name}|${p.lat}|${p.lng}`,
    priority: 1
  })),
  ...pins.mapOnlyPins.map((t, i) => ({
    bucket: "mapOnly",
    idx: i,
    lat: Number(t[0]),
    lng: Number(t[1]),
    key: `swarm|${t[2]}|${t[0]}|${t[1]}`,
    priority: 0
  }))
];
const { keptIndices, stats: zoneThinStats } = thinHomeZones(combinedForThinning, config);
const keepIdxSet = new Set();
const keepExtraSet = new Set();
const keepMapOnlySet = new Set();
for (const i of keptIndices) {
  const entry = combinedForThinning[i];
  if (entry.bucket === "index") keepIdxSet.add(entry.idx);
  else if (entry.bucket === "extra") keepExtraSet.add(entry.idx);
  else keepMapOnlySet.add(entry.idx);
}
idx.places = idx.places.filter((_, i) => keepIdxSet.has(i));
pins.extraPins = pins.extraPins.filter((_, i) => keepExtraSet.has(i));
pins.mapOnlyPins = pins.mapOnlyPins.filter((_, i) => keepMapOnlySet.has(i));

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

console.log("Applied 7-day embargo + density-matched home-zone privacy!", {
  droppedRecentOrErrand,
  sanitizedInZone: blurredPlaces,
  zoneThinStats,
  photoPins: allPhotoPlaces.length,
  extraDots,
  totalDots,
  reviews: cleanReviews.length
});
