#!/usr/bin/env node
/**
 * sync-maps-index.mjs — Super-lightweight Google Maps Contributor Indexer
 *
 * Zero dependencies. Keeps `data/maps-index.json` lightweight by storing only
 * metadata, coordinates, view counts, review snippets, and Google CDN image URLs
 * (`lh3.googleusercontent.com/...=w1000-h750-p-k-no`) rather than binary blobs.
 *
 * Two ways to update your index in <10 seconds:
 *
 *   1. Browser Console One-Liner (while viewing your Maps Contributor page):
 *      Run `node scripts/sync-maps-index.mjs --snippet` to print a tiny snippet
 *      you can paste into DevTools Console on your Google Maps Reviews or Photos tab.
 *      Save or pipe the copied JSON into `node scripts/sync-maps-index.mjs /tmp/new.json`.
 *
 *   2. Google Takeout GeoJSON / JSON Merge:
 *      Export "Maps (your places)" from takeout.google.com and run:
 *      `node scripts/sync-maps-index.mjs ~/Downloads/Takeout/Maps/Reviews.json`
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.resolve(__dirname, "../data/maps-index.json");

const CONSOLE_SNIPPET = `
// Paste in DevTools Console on https://www.google.com/maps/contrib/104641095422852249098/photos or /reviews
(() => {
  const up = (u) => u ? u.replace(/=w\\d+-h\\d+[^"'\\s)]*/, "=w1000-h750-p-k-no") : null;
  const places = [];
  document.querySelectorAll(".FabbNe, .jftiEf[data-review-id]").forEach((el) => {
    const id = el.querySelector("[data-photo-bucket-id]")?.getAttribute("data-photo-bucket-id")
      || el.getAttribute("data-review-id") || "";
    const name = el.querySelector(".fgD3Vc, .d4r55")?.textContent?.trim();
    const location = el.querySelector(".b3XaXd, .RfnDt")?.textContent?.trim();
    const caption = el.querySelector(".wiI7pd")?.textContent?.trim() || "";
    const photos = [...el.querySelectorAll("[style*='googleusercontent'], img[src*='googleusercontent']")]
      .map((n) => {
        const s = n.getAttribute("src") || n.getAttribute("style") || "";
        const m = s.match(/https:\\/\\/lh3\\.googleusercontent\\.com\\/(?:gps-cs|grass-cs)\\/[^"'\\s)]+/);
        return m ? up(m[0]) : null;
      })
      .filter(Boolean);
    if (name && photos.length) {
      places.push({ id, name, location, caption, photos: [...new Set(photos)].slice(0, 4) });
    }
  });
  copy(JSON.stringify({ exportedAt: new Date().toISOString(), places }, null, 2));
  console.log("Copied " + places.length + " indexed places to clipboard!");
})();
`.trim();

const args = process.argv.slice(2);

if (args.includes("--snippet") || args.includes("--help") || args.length === 0) {
  console.log("=== Super-Lightweight Google Maps Contributor Indexer ===\n");
  console.log("Option 1 — Paste this snippet in DevTools Console on your Google Maps Contributor page:\n");
  console.log(CONSOLE_SNIPPET);
  console.log("\nOption 2 — Merge a console export or Google Takeout Reviews.json file:");
  console.log("  node scripts/sync-maps-index.mjs <path-to-exported-or-takeout.json>\n");
  process.exit(0);
}

const inputPath = path.resolve(process.cwd(), args[0]);
const indexData = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
const incoming = JSON.parse(fs.readFileSync(inputPath, "utf8"));

const existingById = new Map(indexData.places.map((p) => [p.id || p.name, p]));
let added = 0;

// Handle either Console Snippet output ({ places: [...] }) or Google Takeout GeoJSON ({ features: [...] })
const candidateList = Array.isArray(incoming.places)
  ? incoming.places
  : Array.isArray(incoming.features)
    ? incoming.features.map((f) => ({
        id: f.properties?.google_maps_url || f.properties?.location?.name,
        name: f.properties?.location?.name || "Visited Place",
        location: f.properties?.location?.address || "",
        lat: f.geometry?.coordinates?.[1],
        lng: f.geometry?.coordinates?.[0],
        rating: f.properties?.five_star_rating_published,
        caption: f.properties?.review_text_published || "",
        photos: (f.properties?.photos || []).map((p) => p.url || p).filter(Boolean)
      }))
    : [];

for (const item of candidateList) {
  const key = item.id || item.name;
  if (!key) continue;
  if (!existingById.has(key)) {
    indexData.places.push({
      id: key,
      name: item.name,
      location: item.location || "",
      region: item.region || "east-coast",
      category: item.category || "Google Maps Dispatch",
      lat: item.lat ?? 40.758,
      lng: item.lng ?? -73.9855,
      rating: item.rating,
      views: item.views,
      tag: item.tag || "nyc",
      caption: item.caption || "",
      photos: item.photos || []
    });
    existingById.set(key, item);
    added++;
  }
}

indexData.lastUpdated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(INDEX_PATH, JSON.stringify(indexData, null, 2) + "\n", "utf8");
console.log(`Synced ${added} new place(s) into ${INDEX_PATH} (total indexed places: ${indexData.places.length}).`);
