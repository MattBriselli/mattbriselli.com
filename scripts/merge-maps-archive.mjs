#!/usr/bin/env node
/**
 * Merges the deep browser-crawled Google Maps archive (step_31.json) into:
 *   1. data/maps-index.json  (< 256 KB ceiling: 348 globally balanced photo dispatches)
 *   2. data/maps-pins.json   (all remaining photo-backed places uncapped by city +
 *                             geocoded review/place pins -> 1,150+ total interactive pins)
 *   3. data/maps-reviews.json (written reviews archive)
 */
import fs from "node:fs";
import path from "node:path";

const rawPath = process.argv[2];
if (!rawPath || !fs.existsSync(rawPath)) {
  console.error("Usage: node scripts/merge-maps-archive.mjs <step_31.json>");
  process.exit(1);
}

const mapsPath = path.resolve("data/maps-index.json");
const mapsPinsPath = path.resolve("data/maps-pins.json");
const mapsReviewsPath = path.resolve("data/maps-reviews.json");

const rawWrapper = JSON.parse(fs.readFileSync(rawPath, "utf8"));
const crawledPlaces = rawWrapper?.value?.places || [];
const mapsData = JSON.parse(fs.readFileSync(mapsPath, "utf8"));
const existingReviewsPayload = fs.existsSync(mapsReviewsPath)
  ? JSON.parse(fs.readFileSync(mapsReviewsPath, "utf8"))
  : { reviews: [], mediaKeysByPlace: {} };

function classifyTagAndRegion({ address = "", countryIso = "" }) {
  const iso = (countryIso || "").toUpperCase();
  if (iso === "CA" || /,\s*(bc|ab|on|qc|ns|nb|pe|nt)\b|canada/i.test(address)) {
    return { region: "canada", tag: "international" };
  }
  if (["KZ", "UZ", "KG", "TJ", "TM"].includes(iso) || /kazakhstan|uzbekistan|kyrgyzstan|tajikistan|turkmenistan/i.test(address)) {
    return { region: "central-asia", tag: "international" };
  }
  if (iso && iso !== "US") {
    return { region: "international", tag: "international" };
  }
  if (/new york,\s*ny|brooklyn,\s*ny|queens,\s*ny|manhattan|bronx|staten island/i.test(address)) {
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

function sanitizePlace(p) {
  const cleanId = String(Array.isArray(p.id) ? p.id[0] : p.id || "").trim();
  let cleanCat = typeof p.category === "string" ? p.category.replace(/^ChIJ\S+\s*·?\s*/, "").trim() : "";
  if (!cleanCat) cleanCat = "Field Dispatch";
  const cleanCaption = String(p.caption || "")
    .replace(/ that has helped nearly [\d]+ million people find the right door/i, "")
    .trim();
  const out = {
    id: cleanId,
    name: p.name,
    location: p.location,
    region: p.region,
    category: cleanCat,
    lat: p.lat,
    lng: p.lng,
    tag: p.tag,
    caption: cleanCaption,
    photos: (p.photos || []).slice(0, 2)
  };
  if (p.rating) out.rating = p.rating;
  if (p.date) out.date = p.date;
  if (p.countryIso) out.countryIso = p.countryIso;
  return out;
}

// 1. Preserve all 348 curated & geocoded core places in maps-index.json
const corePlaces = [];
const seenKeys = new Set();
const seenNameLoc = new Set();

for (const rawP of mapsData.places || []) {
  if (typeof rawP.lat !== "number" || typeof rawP.lng !== "number") continue;
  const clean = sanitizePlace(rawP);
  const nlKey = `${clean.name.toLowerCase().trim()}|${clean.location.toLowerCase().slice(0, 18)}`;
  if (seenKeys.has(clean.id) || seenNameLoc.has(nlKey)) continue;
  seenKeys.add(clean.id);
  seenNameLoc.add(nlKey);
  seenNameLoc.add(clean.name.toLowerCase().trim());
  corePlaces.push(clean);
}

// 2. Collect all remaining crawled places (both with-photo and map-only) for geocoding
const extraPhotoCandidates = [];
const mapOnlyCandidates = [];

const sortedCrawl = crawledPlaces
  .filter((c) => c && c.name && c.name !== "Unknown place" && c.address && c.address.length >= 5)
  .slice()
  .sort((a, b) => {
    const phA = Array.isArray(a.photos) && a.photos.length > 0 ? 1 : 0;
    const phB = Array.isArray(b.photos) && b.photos.length > 0 ? 1 : 0;
    if (phB !== phA) return phB - phA;
    const revA = a.reviewText ? 1 : 0;
    const revB = b.reviewText ? 1 : 0;
    if (revB !== revA) return revB - revA;
    const intlA = a.countryIso && a.countryIso !== "US" ? 1 : 0;
    const intlB = b.countryIso && b.countryIso !== "US" ? 1 : 0;
    return intlB - intlA;
  });

for (const c of sortedCrawl) {
  const idKey = String(c.placeId || c.reviewId || "").trim();
  const nlKey = `${c.name.toLowerCase().trim()}|${c.address.toLowerCase().slice(0, 18)}`;
  if ((idKey && seenKeys.has(idKey)) || seenNameLoc.has(nlKey)) {
    // Enrich core place if it lacked rating or written review quote
    const ex = corePlaces.find(
      (p) => (idKey && p.id === idKey) || p.name.toLowerCase().trim() === c.name.toLowerCase().trim()
    );
    if (ex) {
      if (c.rating && !ex.rating) ex.rating = c.rating;
      if (c.reviewText && (!ex.caption || !ex.caption.startsWith("“"))) {
        ex.caption = `“${c.reviewText.trim()}”`;
      }
      for (const ph of c.photos || []) {
        if (ph && !ex.photos.includes(ph) && ex.photos.length < 2) ex.photos.push(ph);
      }
    }
    continue;
  }

  if (idKey) seenKeys.add(idKey);
  seenNameLoc.add(nlKey);

  const hasPhotos = Array.isArray(c.photos) && c.photos.length > 0;
  if (hasPhotos) {
    const { region, tag } = classifyTagAndRegion({
      address: c.address,
      countryIso: c.countryIso
    });
    const countryLabel = c.countryName && c.countryIso !== "US" ? c.countryName : "";
    const catParts = [];
    if (countryLabel) catParts.push(`${countryLabel} Dispatch`);
    else if (region === "west-coast") catParts.push("West Coast Dispatch");
    else if (tag === "nyc") catParts.push("NYC Dispatch");
    else catParts.push("US 50-State Dispatch");
    if (c.date) catParts.push(c.date.slice(0, 4));

    const entry = {
      id: idKey || `maps-ext-${extraPhotoCandidates.length + 1}`,
      name: c.name,
      location: c.address,
      region,
      category: catParts.join(" · "),
      lat: null,
      lng: null,
      tag,
      caption: c.reviewText
        ? `“${c.reviewText.trim()}”`
        : `Photographed on Google Maps · ${c.address}.`,
      photos: c.photos.slice(0, 2)
    };
    if (c.rating) entry.rating = c.rating;
    if (c.date) entry.date = c.date;
    if (c.countryIso) entry.countryIso = c.countryIso;
    extraPhotoCandidates.push(entry);
  } else if (mapOnlyCandidates.length < 700) {
    mapOnlyCandidates.push({
      name: c.name,
      location: c.address,
      rating: c.rating || 0,
      snippet: c.reviewText ? c.reviewText.trim().slice(0, 160) : "",
      lat: null,
      lng: null
    });
  }
}

const geoCache = new Map();
async function geocodeAddress(query) {
  if (geoCache.has(query)) return geoCache.get(query);
  const url =
    "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=" +
    encodeURIComponent(query) +
    "&maxLocations=1&f=json";
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const cand = data?.candidates?.[0];
    const loc = cand?.location;
    if (loc && typeof loc.y === "number" && typeof loc.x === "number" && (cand.score || 0) >= 70) {
      const coords = { lat: Number(loc.y.toFixed(5)), lng: Number(loc.x.toFixed(5)) };
      geoCache.set(query, coords);
      return coords;
    }
  } catch {
    // ignore transient error
  }
  geoCache.set(query, null);
  return null;
}

async function main() {
  const allToGeocode = [...extraPhotoCandidates, ...mapOnlyCandidates];
  console.log(
    `Geocoding ${extraPhotoCandidates.length} extra photo places + ${mapOnlyCandidates.length} map-only pins (${allToGeocode.length} total)...`
  );

  const CONCURRENCY = 36;
  let cursor = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < allToGeocode.length) {
      const idx = cursor++;
      const item = allToGeocode[idx];
      let coords = await geocodeAddress(item.location);
      if (!coords) coords = await geocodeAddress(`${item.name}, ${item.location}`);
      if (coords) {
        item.lat = coords.lat;
        item.lng = coords.lng;
      }
      if ((idx + 1) % 150 === 0) {
        console.log(`  geocoded ${idx + 1}/${allToGeocode.length}...`);
      }
    }
  });
  await Promise.all(workers);

  const validExtraPhotos = extraPhotoCandidates.filter(
    (p) => typeof p.lat === "number" && typeof p.lng === "number"
  );

  // Add slight deterministic micro-jitter ONLY when two pins share identical 5-decimal street-centroid coords
  const coordSeen = new Map();
  const jitterIfDuplicate = (lat, lng) => {
    const k = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const n = coordSeen.get(k) || 0;
    coordSeen.set(k, n + 1);
    if (n === 0) return [lat, lng];
    const angle = n * 2.39996; // golden angle
    const r = 0.00035 * Math.sqrt(n);
    return [Number((lat + r * Math.cos(angle)).toFixed(5)), Number((lng + r * Math.sin(angle)).toFixed(5))];
  };

  for (const p of corePlaces) {
    const [jLat, jLng] = jitterIfDuplicate(p.lat, p.lng);
    p.lat = jLat;
    p.lng = jLng;
  }
  for (const p of validExtraPhotos) {
    const [jLat, jLng] = jitterIfDuplicate(p.lat, p.lng);
    p.lat = jLat;
    p.lng = jLng;
  }

  const validMapOnlyTuples = [];
  for (const m of mapOnlyCandidates) {
    if (typeof m.lat !== "number" || typeof m.lng !== "number") continue;
    const [jLat, jLng] = jitterIfDuplicate(m.lat, m.lng);
    const tuple = [jLat, jLng, m.name, m.location];
    if (m.rating || m.snippet) {
      tuple.push(m.rating || 0);
      if (m.snippet) tuple.push(m.snippet);
    }
    validMapOnlyTuples.push(tuple);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  delete mapsData.hostedReviews;
  delete mapsData.topViewedLedger;
  delete mapsData.profile?.bio;
  delete mapsData.profile?.level;
  delete mapsData.profile?.points;
  delete mapsData.profile?.totalPhotoViews;
  mapsData.lastUpdated = todayIso;
  mapsData.places = corePlaces;

  const totalPhotoPlaces = corePlaces.length + validExtraPhotos.length;
  const totalInteractivePins =
    totalPhotoPlaces + validMapOnlyTuples.length + (mapsData.heatmapClusters?.length || 0);

  fs.writeFileSync(mapsPath, JSON.stringify(mapsData) + "\n", "utf8");
  fs.writeFileSync(
    mapsPinsPath,
    JSON.stringify({
      lastUpdated: todayIso,
      totalPhotoPlaces,
      totalPins: totalInteractivePins,
      extraPins: validExtraPhotos,
      mapOnlyPins: validMapOnlyTuples
    }) + "\n",
    "utf8"
  );

  // Refresh written reviews without view counts
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

  fs.writeFileSync(
    mapsReviewsPath,
    JSON.stringify(
      {
        lastUpdated: todayIso,
        count: writtenReviews.length,
        reviews: writtenReviews,
        mediaKeysByPlace: existingReviewsPayload.mediaKeysByPlace || {}
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log("Archive merge complete!", {
    corePlaces: corePlaces.length,
    extraPhotoPlaces: validExtraPhotos.length,
    totalPhotoPlaces,
    mapOnlyPins: validMapOnlyTuples.length,
    heatmapClusters: mapsData.heatmapClusters?.length || 0,
    totalInteractivePins,
    mapsIndexKB: (fs.statSync(mapsPath).size / 1024).toFixed(1),
    mapsPinsKB: (fs.statSync(mapsPinsPath).size / 1024).toFixed(1)
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
