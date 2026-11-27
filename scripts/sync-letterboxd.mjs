#!/usr/bin/env node
/**
 * Builds data/letterboxd-reviews.json from an unpacked Letterboxd export folder,
 * preserving any pre-resolved RSS poster URLs and canonical links.
 *
 * Usage:
 *   node scripts/sync-letterboxd.mjs <path-to-unpacked-letterboxd-export>
 */
import fs from "node:fs";
import path from "node:path";

const exportDir = process.argv[2];
if (!exportDir || !fs.existsSync(path.join(exportDir, "reviews.csv"))) {
  console.error("Usage: node scripts/sync-letterboxd.mjs <unpacked-letterboxd-dir>");
  process.exit(1);
}

const outPath = path.resolve("data/letterboxd-reviews.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cur = "";
    } else if (ch !== "\r") {
      cur += ch;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows
    .filter((r) => r.some((x) => x !== ""))
    .map((r) => Object.fromEntries(headers.map((h, idx) => [h, r[idx] ?? ""])));
}

function stripTagsToCleanText(raw) {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:i|em|b|strong|blockquote|a)[^>]*>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function splitReviewBlocks(rawReview) {
  const blocks = rawReview
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((b) => stripTagsToCleanText(b))
    .filter((b) => b && !/^(?:\.\s*)+$/.test(b));

  const paragraphs = [];
  const spoilerParagraphs = [];
  let inSpoilers = false;

  const spoilerHeaderRe =
    /^(?:light\s+spoilers\s+below|spoilers\s+below.*|spoilers\s*~+|now\s+i\s+need\s+to\s+talk\s+spoilers.*|loose,\s*spoiler-filled\s+thoughts.*)$/i;

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    if (!inSpoilers && spoilerHeaderRe.test(lines[0])) {
      inSpoilers = true;
      const rest = lines.slice(1).filter((l) => l !== ".").join("\n").trim();
      if (rest) spoilerParagraphs.push(rest);
      continue;
    }

    const cleaned = lines.filter((l) => l !== ".").join("\n").trim();
    if (!cleaned) continue;
    if (inSpoilers) {
      spoilerParagraphs.push(cleaned);
    } else {
      paragraphs.push(cleaned);
    }
  }

  return { paragraphs, spoilerParagraphs };
}

// Load existing JSON to preserve RSS posters & canonical URLs
let existingByKey = new Map();
if (fs.existsSync(outPath)) {
  try {
    const prev = JSON.parse(fs.readFileSync(outPath, "utf8"));
    for (const r of prev.reviews || []) {
      const key = `${String(r.filmTitle).toLowerCase()}|${r.filmYear}|${r.watchedDate}`;
      existingByKey.set(key, r);
      const fallbackKey = `${String(r.filmTitle).toLowerCase()}|${r.filmYear}`;
      if (!existingByKey.has(fallbackKey) && r.poster) {
        existingByKey.set(fallbackKey, r);
      }
    }
  } catch {
    // ignore
  }
}

const watched = parseCsv(fs.readFileSync(path.join(exportDir, "watched.csv"), "utf8"));
const ratings = parseCsv(fs.readFileSync(path.join(exportDir, "ratings.csv"), "utf8"));
const diary = parseCsv(fs.readFileSync(path.join(exportDir, "diary.csv"), "utf8"));
const reviewsCsv = parseCsv(fs.readFileSync(path.join(exportDir, "reviews.csv"), "utf8"));
const likesPath = path.join(exportDir, "likes", "films.csv");
const likesCsv = fs.existsSync(likesPath) ? parseCsv(fs.readFileSync(likesPath, "utf8")) : [];

const filmUriByTitleYear = new Map();
const filmByUri = new Map();
for (const w of watched) {
  const key = `${w.Name.toLowerCase()}|${w.Year}`;
  filmUriByTitleYear.set(key, w["Letterboxd URI"]);
  filmByUri.set(w["Letterboxd URI"], w);
}

const ratingByTitleYear = new Map();
for (const rt of ratings) {
  ratingByTitleYear.set(`${rt.Name.toLowerCase()}|${rt.Year}`, Number(rt.Rating));
}

const likedFilmKeys = new Set();
for (const lk of likesCsv) {
  likedFilmKeys.add(`${lk.Name.toLowerCase()}|${lk.Year}`);
  if (lk["Letterboxd URI"]) likedFilmKeys.add(lk["Letterboxd URI"]);
}

const STATIC_FAVORITE_POSTERS = {
  "1skk": {
    link: "https://letterboxd.com/film/inception/",
    poster: "https://a.ltrbxd.com/resized/sm/upload/sv/95/s9/4j/inception-0-600-0-900-crop.jpg?v=30d7224316"
  },
  "2a2k": {
    link: "https://letterboxd.com/film/titanic-1997/",
    poster: "https://a.ltrbxd.com/resized/film-poster/5/1/5/2/4/51524-titanic-0-600-0-900-crop.jpg?v=7517ea94ce"
  },
  "2aq2": {
    link: "https://letterboxd.com/film/schindlers-list/",
    poster: "https://a.ltrbxd.com/resized/sm/upload/bz/1x/em/jr/yPisjyLweCl1tbgwgtzBCNCBle-0-600-0-900-crop.jpg?v=ca5215c5a9"
  },
  "2b4m": {
    link: "https://letterboxd.com/film/spirited-away/",
    poster: "https://a.ltrbxd.com/resized/film-poster/5/1/9/2/1/51921-spirited-away-0-600-0-900-crop.jpg?v=a3ad463c55"
  }
};

const profilePath = path.join(exportDir, "profile.csv");
const profileRow = fs.existsSync(profilePath)
  ? parseCsv(fs.readFileSync(profilePath, "utf8"))[0] || {}
  : {};

const favUris = (profileRow["Favorite Films"] || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const favorites = favUris
  .map((uri) => {
    const w = filmByUri.get(uri);
    if (!w) return null;
    const boxdId = uri.split("/").pop() || "";
    const meta = STATIC_FAVORITE_POSTERS[boxdId] || {};
    const rating = ratingByTitleYear.get(`${w.Name.toLowerCase()}|${w.Year}`) ?? 5;
    return {
      filmTitle: w.Name,
      filmYear: w.Year,
      rating,
      filmBoxdId: boxdId,
      link: meta.link || uri,
      poster: meta.poster || ""
    };
  })
  .filter(Boolean);

const reviews = [];
for (let idx = 0; idx < reviewsCsv.length; idx++) {
  const row = reviewsCsv[idx];
  const filmTitle = row.Name.trim();
  const filmYear = row.Year.trim();
  const watchedDate = (row["Watched Date"] || row.Date || "").trim();
  const loggedDate = (row.Date || watchedDate).trim();
  const reviewUri = (row["Letterboxd URI"] || "").trim();
  const reviewBoxdId = reviewUri.split("/").pop() || String(idx);

  const titleYearKey = `${filmTitle.toLowerCase()}|${filmYear}`;
  const exactKey = `${titleYearKey}|${watchedDate}`;
  const filmUri = filmUriByTitleYear.get(titleYearKey) || "";
  const filmBoxdId = filmUri.split("/").pop() || "";

  const prevExact = existingByKey.get(exactKey);
  const prevFilm = existingByKey.get(titleYearKey);
  const favMeta = STATIC_FAVORITE_POSTERS[filmBoxdId];

  const rating = row.Rating ? Number(row.Rating) : null;
  const liked = Boolean(
    likedFilmKeys.has(titleYearKey) ||
    (filmUri && likedFilmKeys.has(filmUri)) ||
    prevExact?.liked
  );
  const rewatch = row.Rewatch === "Yes";
  const tagsLower = (row.Tags || "").toLowerCase();
  const inTheatres = tagsLower.includes("watched in theatres");

  const { paragraphs, spoilerParagraphs } = splitReviewBlocks(row.Review || "");
  if (!paragraphs.length && !spoilerParagraphs.length) continue;

  const entry = {
    id: `boxd-${reviewBoxdId}`,
    filmTitle,
    filmYear,
    rating,
    liked,
    rewatch,
    inTheatres,
    watchedDate,
    loggedDate,
    filmBoxdId,
    link: prevExact?.link || reviewUri || "https://letterboxd.com/brslli/",
    poster: prevExact?.poster || prevFilm?.poster || favMeta?.poster || "",
    paragraphs
  };
  if (spoilerParagraphs.length) {
    entry.spoilerParagraphs = spoilerParagraphs;
  }
  entry._seq = idx;
  reviews.push(entry);
}

// Sort newest first (by watchedDate desc, then loggedDate desc, then CSV sequence desc)
reviews.sort((a, b) => {
  const dA = a.watchedDate || a.loggedDate || "";
  const dB = b.watchedDate || b.loggedDate || "";
  if (dA !== dB) return dB.localeCompare(dA);
  const lA = a.loggedDate || "";
  const lB = b.loggedDate || "";
  if (lA !== lB) return lB.localeCompare(lA);
  return b._seq - a._seq;
});

for (const r of reviews) delete r._seq;

const theatreDiaryCount = diary.filter((d) =>
  (d.Tags || "").toLowerCase().includes("watched in theatres")
).length;

const output = {
  profile: {
    username: profileRow.Username || "brslli",
    name: `${profileRow["Given Name"] || "Matt"} ${profileRow["Family Name"] || "B"}`.trim(),
    url: "https://letterboxd.com/brslli/",
    tagline: "a movie a day or so i say",
    joined: profileRow["Date Joined"] || "2016-07-01"
  },
  updatedAt: new Date().toISOString().slice(0, 10),
  stats: {
    watchedCount: watched.length,
    ratedCount: ratings.length,
    reviewCount: reviews.length,
    likedCount: likesCsv.length,
    theatreCount: theatreDiaryCount,
    theatreReviewCount: reviews.filter((r) => r.inTheatres).length,
    fiveStarReviewCount: reviews.filter((r) => r.rating === 5).length,
    fourPlusReviewCount: reviews.filter((r) => (r.rating || 0) >= 4).length
  },
  favorites,
  reviews
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(
  `Wrote ${reviews.length} reviews (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB) to ${outPath}`
);
console.log("Stats:", output.stats);
