#!/usr/bin/env node
/**
 * Merges the deep browser-crawled Google Maps archive (scratch/step_31_raw.json)
 * into data/maps-index.json, balancing geographic & city caps so no single city
 * dominates shuffling, and geocoding coordinates via ArcGIS World Geocoder.
 */
import fs from "node:fs";
import path from "node:path";

const rawPath = process.argv[2];
if (!rawPath || !fs.existsSync(rawPath)) {
  console.error("Usage: node scripts/merge-maps-archive.mjs <step_31_raw.json>");
  process.exit(1);
}

const mapsPath = path.resolve("data/maps-index.json");
const mapsReviewsPath = path.resolve("data/maps-reviews.json");
const htmlPath = path.resolve("index.html");

const rawWrapper = JSON.parse(fs.readFileSync(rawPath, "utf8"));
const crawledPlaces = rawWrapper?.value?.places || [];
const mapsData = JSON.parse(fs.readFileSync(mapsPath, "utf8"));

function normalizeCityBucket(address = "", countryIso = "") {
  const iso = (countryIso || "").toUpperCase();
  if (/oslo/i.test(address)) return "NO:Oslo";
  if (/sydney|pyrmont|mascot|bennelong/i.test(address)) return "AU:Sydney";
  if (/melbourne|fitzroy/i.test(address)) return "AU:Melbourne";
  if (/vancouver|richmond,\s*bc/i.test(address)) return "CA:Vancouver";
  if (/edmonton|stony plain/i.test(address)) return "CA:Edmonton";
  if (/calgary/i.test(address)) return "CA:Calgary";
  if (/montr[eé]al|laval,\s*qc/i.test(address)) return "CA:Montreal";
  if (/new york,\s*ny|brooklyn,\s*ny|queens,\s*ny|manhattan|bronx/i.test(address)) return "US:NYC";
  if (/seattle,\s*wa/i.test(address)) return "US:Seattle";
  if (/san francisco,\s*ca/i.test(address)) return "US:SF";
  const mState = address.match(/([^,]+),\s*([A-Z]{2})\b/);
  if (mState) return `${iso || "US"}:${mState[1].trim()},${mState[2]}`;
  return `${iso || "INTL"}:${address.slice(0, 24)}`;
}

function classifyTagAndRegion({ address = "", countryIso = "", views = 0 }) {
  const iso = (countryIso || "").toUpperCase();
  if (views >= 2000000) {
    const isWest = /,\s*(wa|ca|or)\b/i.test(address);
    return { region: isWest ? "west-coast" : "east-coast", tag: "hall-of-fame" };
  }
  if (iso === "CA" || /,\s*(bc|ab|on|qc|ns|nb|pe|nt)\b|canada/i.test(address)) {
    return { region: "canada", tag: "international" };
  }
  if (iso && iso !== "US") {
    return { region: "international", tag: "international" };
  }
  if (/new york,\s*ny|brooklyn,\s*ny|queens,\s*ny|manhattan|bronx/i.test(address)) {
    return { region: "east-coast", tag: "nyc" };
  }
  if (/,\s*(ca|wa|or)\b/i.test(address)) {
    return { region: "west-coast", tag: "us-50" };
  }
  if (/,\s*(pa|nj|de|md|va|dc|ct|ri|ma|vt|nh|me|nc|sc|ga|fl|wv)\b/i.test(address)) {
    return { region: "east-coast", tag: "us-50" };
  }
  return { region: "us-50", tag: "us-50" };
}

// Index existing places by placeId and normalized name
const existingById = new Map();
const existingByName = new Map();
for (const p of mapsData.places || []) {
  if (p.id) existingById.set(p.id, p);
  existingByName.set(p.name.toLowerCase(), p);
}

// Filter crawled places to those with real high-res photos and valid address
const photoCandidates = crawledPlaces.filter(
  (c) =>
    Array.isArray(c.photos) &&
    c.photos.length > 0 &&
    c.name &&
    c.name !== "Unknown place" &&
    c.address &&
    c.address.length >= 5
);

// Sort candidates so highest views & written reviews come first within each city bucket
photoCandidates.sort((a, b) => {
  const revA = a.reviewText ? 1 : 0;
  const revB = b.reviewText ? 1 : 0;
  if ((b.views || 0) !== (a.views || 0)) return (b.views || 0) - (a.views || 0);
  if (revB !== revA) return revB - revA;
  return 0;
});

// City caps prevent any single city (NYC, Oslo statue walk, Seattle, SF) from dominating Shuffle
const CITY_CAPS = {
  "US:NYC": 32,
  "NO:Oslo": 7,
  "US:Seattle": 26,
  "US:SF": 24,
  "AU:Sydney": 14,
  "CA:Vancouver": 14,
  "CA:Edmonton": 12
};
const DEFAULT_CITY_CAP = 10;

const cityCounts = new Map();
const selected = [];
const seenKeys = new Set();

// 1. Always keep curated Hall-of-Fame & seed places with known coords
for (const p of mapsData.places || []) {
  const bucket = normalizeCityBucket(p.location, p.countryIso || (p.region === "canada" ? "CA" : p.region === "international" ? "INTL" : "US"));
  const cap = CITY_CAPS[bucket] ?? DEFAULT_CITY_CAP;
  if (bucket === "US:NYC" && (cityCounts.get(bucket) || 0) >= cap && p.tag === "nyc") continue;
  cityCounts.set(bucket, (cityCounts.get(bucket) || 0) + 1);
  const k = p.id || `${p.name.toLowerCase()}|${p.location.toLowerCase()}`;
  seenKeys.add(k);
  seenKeys.add(p.name.toLowerCase());
  selected.push({ ...p, _needsGeo: typeof p.lat !== "number" || typeof p.lng !== "number" });
}

// 2. Add globally diverse crawled places
for (const c of photoCandidates) {
  const key = c.placeId || `${c.name.toLowerCase()}|${c.address.toLowerCase()}`;
  if (seenKeys.has(key) || (c.placeId && existingById.has(c.placeId))) {
    // Enrich existing place with extra photos, views, or review text!
    const ex = selected.find((s) => (c.placeId && s.id === c.placeId) || s.name.toLowerCase() === c.name.toLowerCase());
    if (ex) {
      if ((c.views || 0) > (ex.views || 0)) ex.views = c.views;
      if (c.rating && !ex.rating) ex.rating = c.rating;
      if (c.reviewText && (!ex.caption || !ex.caption.startsWith("“"))) {
        ex.caption = `“${c.reviewText.trim()}”`;
      }
      for (const ph of c.photos || []) {
        if (ph && !ex.photos.includes(ph) && ex.photos.length < 5) ex.photos.push(ph);
      }
    }
    continue;
  }

  const bucket = normalizeCityBucket(c.address, c.countryIso);
  const cap = CITY_CAPS[bucket] ?? DEFAULT_CITY_CAP;
  const curCount = cityCounts.get(bucket) || 0;
  if (curCount >= cap && (c.views || 0) < 2000000) continue;

  cityCounts.set(bucket, curCount + 1);
  seenKeys.add(key);

  const { region, tag } = classifyTagAndRegion({
    address: c.address,
    countryIso: c.countryIso,
    views: c.views || 0
  });

  const countryLabel = c.countryName && c.countryIso !== "US" ? c.countryName : "";
  const catParts = [];
  if ((c.views || 0) >= 2000000) catParts.push("Multi-Million View Club");
  else if (countryLabel) catParts.push(`${countryLabel} Dispatch`);
  else if (region === "west-coast") catParts.push("West Coast Dispatch");
  else if (tag === "nyc") catParts.push("NYC Dispatch");
  else catParts.push("US 50-State Dispatch");
  if (c.date) catParts.push(c.date.slice(0, 4));

  const caption = c.reviewText
    ? `“${c.reviewText.trim()}”`
    : c.views >= 100000
      ? `${c.views.toLocaleString("en-US")} views on Google Maps · ${c.address}.`
      : `Photographed on Google Maps · ${c.address}.`;

  const entry = {
    id: c.placeId || c.reviewId || `maps-${selected.length + 1}`,
    name: c.name,
    location: c.address,
    region,
    category: catParts.join(" · "),
    lat: null,
    lng: null,
    tag,
    caption,
    photos: c.photos.slice(0, 5),
    _needsGeo: true
  };
  if (c.views) entry.views = c.views;
  if (c.rating) entry.rating = c.rating;
  if (c.date) entry.date = c.date;
  if (c.countryIso) entry.countryIso = c.countryIso;

  selected.push(entry);
  if (selected.length >= 340) break;
}

async function geocodeAddress(query) {
  const url =
    "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=" +
    encodeURIComponent(query) +
    "&maxLocations=1&f=json";
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const loc = data?.candidates?.[0]?.location;
    if (loc && typeof loc.y === "number" && typeof loc.x === "number") {
      return { lat: Number(loc.y.toFixed(5)), lng: Number(loc.x.toFixed(5)) };
    }
  } catch {
    // ignore
  }
  return null;
}

async function main() {
  const toGeo = selected.filter((s) => s._needsGeo);
  console.log(`Selected ${selected.length} globally balanced places (${toGeo.length} need geocoding)...`);

  const CONCURRENCY = 20;
  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < toGeo.length) {
      const cur = toGeo[idx++];
      const q = `${cur.name}, ${cur.location}`;
      let coords = await geocodeAddress(cur.location);
      if (!coords) coords = await geocodeAddress(q);
      if (coords) {
        cur.lat = coords.lat;
        cur.lng = coords.lng;
      }
    }
  });
  await Promise.all(workers);

  const validPlaces = [];
  for (const p of selected) {
    delete p._needsGeo;
    if (typeof p.lat === "number" && typeof p.lng === "number") {
      validPlaces.push(p);
    }
  }

  // Also keep a rich hosted written-reviews feed (up to 250 diverse written reviews across countries & states)
  const writtenReviews = crawledPlaces
    .filter((r) => r.reviewText && r.reviewText.trim().length >= 8 && r.name && r.address)
    .map((r, i) => ({
      id: r.reviewId || r.placeId || `gmap-rev-${i}`,
      name: r.name,
      location: r.address,
      countryIso: r.countryIso || "US",
      rating: r.rating || 5,
      date: r.date || "",
      dateText: r.dateText || "",
      text: r.reviewText.trim(),
      photo: r.photos?.[0] || ""
    }));

  const todayIso = new Date().toISOString().slice(0, 10);
  const mediaKeysByPlace = {};
  for (const p of validPlaces) {
    if (p.mediaKeys?.length) {
      mediaKeysByPlace[p.id] = p.mediaKeys;
      delete p.mediaKeys;
    }
    p.photos = (p.photos || []).slice(0, p.tag === "hall-of-fame" ? 3 : 1);
  }
  delete mapsData.hostedReviews;
  delete mapsData.profile?.bio;
  mapsData.lastUpdated = todayIso;
  mapsData.profile = {
    ...mapsData.profile,
    countriesCount: 39,
    usStatesCount: 50,
    canadianProvincesCount: 8
  };
  mapsData.places = validPlaces;

  fs.writeFileSync(mapsPath, JSON.stringify(mapsData) + "\n", "utf8");
  fs.writeFileSync(
    mapsReviewsPath,
    JSON.stringify(
      {
        lastUpdated: todayIso,
        count: writtenReviews.length,
        reviews: writtenReviews,
        mediaKeysByPlace
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, "utf8");
    html = html.replace(
      /(data-slide-filter="all"[^>]*>)Shuffled Mix \([\d,]+\)(<\/button>)/,
      `$1Shuffled Mix (${validPlaces.length})$2`
    );
    fs.writeFileSync(htmlPath, html, "utf8");
  }

  const byTag = {};
  const byRegion = {};
  for (const p of validPlaces) {
    byTag[p.tag] = (byTag[p.tag] || 0) + 1;
    byRegion[p.region] = (byRegion[p.region] || 0) + 1;
  }
  console.log("Saved maps-index.json!", {
    places: validPlaces.length,
    hostedReviews: writtenReviews.length,
    sizeKB: (fs.statSync(mapsPath).size / 1024).toFixed(1),
    byTag,
    byRegion
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
