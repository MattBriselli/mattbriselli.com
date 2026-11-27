#!/usr/bin/env node
/**
 * Pre-resolves and caches canonical 2:3 Letterboxd film poster URLs (a.ltrbxd.com)
 * into data/letterboxd-reviews.json using mattbriselli.com's edge-cached /api/lb-poster
 * endpoint + gentle pacing so zero requests get rate-limited.
 */
import fs from "node:fs";
import path from "node:path";

const jsonPath = path.resolve("data/letterboxd-reviews.json");
const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const reviews = data.reviews || [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveViaEdge(boxdId, title, year) {
  const params = new URLSearchParams();
  if (boxdId) params.set("id", boxdId);
  if (title) params.set("title", title);
  if (year) params.set("year", String(year));

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://mattbriselli.com/api/lb-poster?${params.toString()}`);
      if (res.ok) {
        const payload = await res.json();
        if (payload?.ok && payload.poster) {
          // Reject square tvSeason artwork (only keep Letterboxd a.ltrbxd.com or 2:3 movie posters)
          if (payload.poster.includes("a.ltrbxd.com") || payload.poster.includes("600x900")) {
            return payload.poster;
          }
        }
        return "";
      }
    } catch {
      // retry once
    }
    await sleep(350);
  }
  return "";
}

async function main() {
  const knownByFilm = new Map();
  for (const r of reviews) {
    if (r.poster) {
      if (r.filmBoxdId) knownByFilm.set(r.filmBoxdId, r.poster);
      knownByFilm.set(`${r.filmTitle.toLowerCase()}|${r.filmYear}`, r.poster);
    }
  }
  for (const f of data.favorites || []) {
    if (f.poster && f.filmBoxdId) knownByFilm.set(f.filmBoxdId, f.poster);
  }

  const groups = new Map();
  for (const r of reviews) {
    if (r.poster && r.poster.startsWith("https://")) continue;
    const hit =
      (r.filmBoxdId && knownByFilm.get(r.filmBoxdId)) ||
      knownByFilm.get(`${r.filmTitle.toLowerCase()}|${r.filmYear}`);
    if (hit) {
      r.poster = hit;
      continue;
    }
    const key = r.filmBoxdId || `${r.filmTitle.toLowerCase()}|${r.filmYear}`;
    if (!groups.has(key)) {
      groups.set(key, {
        boxdId: r.filmBoxdId || "",
        title: r.filmTitle,
        year: r.filmYear,
        items: []
      });
    }
    groups.get(key).items.push(r);
  }

  const pending = [...groups.values()];
  console.log(`Remaining unique films needing posters: ${pending.length}...`);

  const CONCURRENCY = 6;
  let cursor = 0;
  let resolved = 0;

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < pending.length) {
      const idx = cursor++;
      const grp = pending[idx];
      const url = await resolveViaEdge(grp.boxdId, grp.title, grp.year);
      if (url) {
        resolved++;
        for (const r of grp.items) r.poster = url;
      }
      await sleep(90);
      if ((idx + 1) % 100 === 0 || idx + 1 === pending.length) {
        console.log(`  progress ${idx + 1}/${pending.length} (newly resolved ${resolved})...`);
        // Checkpoint to disk every 200 films
        if ((idx + 1) % 200 === 0) {
          fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n", "utf8");
        }
      }
    }
  });

  await Promise.all(workers);

  const totalWithPoster = reviews.filter((r) => Boolean(r.poster)).length;
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(
    `Complete! Cached 2:3 posters: ${totalWithPoster}/${reviews.length} (${(fs.statSync(jsonPath).size / 1024).toFixed(1)} KB)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
