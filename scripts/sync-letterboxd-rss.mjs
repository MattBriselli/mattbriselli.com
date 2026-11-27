#!/usr/bin/env node
/**
 * Syncs new Letterboxd reviews and watch stats from https://letterboxd.com/brslli/rss/
 * into data/letterboxd-reviews.json (plus static count badges in index.html & llms.txt).
 *
 * Designed to run weekly via .github/workflows/sync-letterboxd.yml so reviews never
 * roll off Letterboxd's ~50-85 item RSS window.
 *
 * Flags:
 *   --seed-watches   Record current RSS star-only watches as already counted in the CSV baseline
 */
import fs from "node:fs";
import path from "node:path";

const RSS_URL = "https://letterboxd.com/brslli/rss/";
const jsonPath = path.resolve("data/letterboxd-reviews.json");
const htmlPath = path.resolve("index.html");
const llmsPath = path.resolve("llms.txt");
const seedWatchesOnly = process.argv.includes("--seed-watches");

function decodeEntities(str) {
  return str
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function getTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : "";
}

function splitReviewBlocks(paragraphsRaw) {
  const paragraphs = [];
  const spoilerParagraphs = [];
  let inSpoilers = false;

  const spoilerHeaderRe =
    /^(?:this review may contain spoilers\.?|light\s+spoilers\s+below|spoilers\s+below.*|spoilers\s*~+|now\s+i\s+need\s+to\s+talk\s+spoilers.*|loose,\s*spoiler-filled\s+thoughts.*)$/i;

  for (const raw of paragraphsRaw) {
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    if (!inSpoilers && spoilerHeaderRe.test(lines[0])) {
      inSpoilers = true;
      const rest = lines.slice(1).filter((l) => l !== ".").join("\n").trim();
      if (rest) spoilerParagraphs.push(rest);
      continue;
    }

    const cleaned = lines.filter((l) => l !== ".").join("\n").trim();
    if (!cleaned) continue;
    if (inSpoilers) spoilerParagraphs.push(cleaned);
    else paragraphs.push(cleaned);
  }

  return { paragraphs, spoilerParagraphs };
}

async function main() {
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const prevSerialized = JSON.stringify({
    stats: data.stats,
    reviews: data.reviews,
    seenWatchGuids: data.seenWatchGuids || []
  });

  const res = await fetch(RSS_URL, {
    headers: { "User-Agent": "mattbriselli.com-letterboxd-archiver/1.0" }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Letterboxd RSS: HTTP ${res.status}`);
  }
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  const existingByKey = new Map();
  const existingById = new Map();
  for (const r of data.reviews) {
    const key = `${String(r.filmTitle).toLowerCase()}|${r.filmYear}|${r.watchedDate}`;
    existingByKey.set(key, r);
    existingById.set(r.id, r);
  }

  const seenWatchSet = new Set(data.seenWatchGuids || []);
  let addedReviews = 0;
  let updatedReviews = 0;
  let addedWatches = 0;

  for (const item of items) {
    const guid = getTag(item, "guid");
    if (!guid.startsWith("letterboxd-review-") && !guid.startsWith("letterboxd-watch-")) {
      continue;
    }

    const filmTitle = decodeEntities(getTag(item, "letterboxd:filmTitle"));
    const filmYear = getTag(item, "letterboxd:filmYear");
    const ratingRaw = getTag(item, "letterboxd:memberRating");
    const rating = ratingRaw ? Number(ratingRaw) : null;
    const liked = getTag(item, "letterboxd:memberLike") === "Yes";
    const rewatch = getTag(item, "letterboxd:rewatch") === "Yes";
    const watchedDate = getTag(item, "letterboxd:watchedDate");
    const link = getTag(item, "link");

    const descCdata =
      item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] ||
      getTag(item, "description");
    const poster = descCdata.match(/<img[^>]+src="([^"]+)"/)?.[1] || "";
    const bodyHtml = descCdata.replace(/<p>\s*<img[^>]*>\s*<\/p>/i, "").trim();

    const rawParas = [...bodyHtml.matchAll(/<p>([\s\S]*?)<\/p>/gi)]
      .map((m) =>
        decodeEntities(
          m[1]
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .trim()
        )
      )
      .filter((p) => p && !/^Watched on /i.test(p));

    const { paragraphs, spoilerParagraphs } = splitReviewBlocks(rawParas);
    const hasReviewText = paragraphs.length > 0 || spoilerParagraphs.length > 0;
    const matchKey = `${filmTitle.toLowerCase()}|${filmYear}|${watchedDate}`;

    if (hasReviewText) {
      const existing = existingById.get(guid) || existingByKey.get(matchKey);
      if (existing) {
        let touched = false;
        if (poster && existing.poster !== poster) {
          existing.poster = poster;
          touched = true;
        }
        if (link && existing.link !== link) {
          existing.link = link;
          touched = true;
        }
        if (rating !== null && existing.rating !== rating) {
          existing.rating = rating;
          touched = true;
        }
        if (liked && !existing.liked) {
          existing.liked = true;
          touched = true;
        }
        if (touched) updatedReviews++;
      } else if (filmTitle) {
        const entry = {
          id: guid,
          filmTitle,
          filmYear,
          rating,
          liked,
          rewatch,
          inTheatres: false,
          watchedDate,
          loggedDate: watchedDate,
          filmBoxdId: "",
          link: link || "https://letterboxd.com/brslli/",
          poster,
          paragraphs
        };
        if (spoilerParagraphs.length) entry.spoilerParagraphs = spoilerParagraphs;
        data.reviews.push(entry);
        existingByKey.set(matchKey, entry);
        existingById.set(guid, entry);
        addedReviews++;

        if (!seedWatchesOnly && !seenWatchSet.has(guid)) {
          seenWatchSet.add(guid);
          if (!rewatch) {
            data.stats.watchedCount = (data.stats.watchedCount || 0) + 1;
            if (rating !== null) data.stats.ratedCount = (data.stats.ratedCount || 0) + 1;
            if (liked) data.stats.likedCount = (data.stats.likedCount || 0) + 1;
          }
        }
      }
    } else if (guid.startsWith("letterboxd-watch-")) {
      if (!seenWatchSet.has(guid)) {
        seenWatchSet.add(guid);
        if (!seedWatchesOnly && !rewatch) {
          data.stats.watchedCount = (data.stats.watchedCount || 0) + 1;
          if (rating !== null) data.stats.ratedCount = (data.stats.ratedCount || 0) + 1;
          if (liked) data.stats.likedCount = (data.stats.likedCount || 0) + 1;
          addedWatches++;
        }
      }
    }
  }

  // Sort reviews newest first
  data.reviews.sort((a, b) => {
    const dA = a.watchedDate || a.loggedDate || "";
    const dB = b.watchedDate || b.loggedDate || "";
    if (dA !== dB) return dB.localeCompare(dA);
    return 0;
  });

  data.stats.reviewCount = data.reviews.length;
  data.stats.fiveStarReviewCount = data.reviews.filter((r) => r.rating === 5).length;
  data.stats.fourPlusReviewCount = data.reviews.filter((r) => (r.rating || 0) >= 4).length;
  data.seenWatchGuids = [...seenWatchSet].slice(-250);

  const nextSerialized = JSON.stringify({
    stats: data.stats,
    reviews: data.reviews,
    seenWatchGuids: data.seenWatchGuids
  });

  if (prevSerialized === nextSerialized) {
    console.log("No new Letterboxd reviews or watch changes found.");
    return;
  }

  data.updatedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n", "utf8");

  // Keep static fallback counts in index.html & llms.txt synchronized
  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, "utf8");
    const revFmt = data.stats.reviewCount.toLocaleString("en-US");
    const watchFmt = data.stats.watchedCount.toLocaleString("en-US");
    const likeFmt = data.stats.likedCount.toLocaleString("en-US");
    const fiveFmt = data.stats.fiveStarReviewCount.toLocaleString("en-US");
    const fourFmt = data.stats.fourPlusReviewCount.toLocaleString("en-US");
    const likedRevFmt = data.reviews.filter((r) => r.liked).length.toLocaleString("en-US");

    html = html
      .replace(/Hosted Film Archive · [\d,]+ Reviews \+ Auto-Synced RSS/, `Hosted Film Archive · ${revFmt} Reviews + Auto-Synced RSS`)
      .replace(/(id="lb-stat-watched">)[\d,]+(<\/dd>)/, `$1${watchFmt}$2`)
      .replace(/(id="lb-stat-reviews">)[\d,]+(<\/dd>)/, `$1${revFmt}$2`)
      .replace(/(id="lb-stat-liked">)[\d,]+(<\/dd>)/, `$1${likeFmt}$2`)
      .replace(/(data-lb-filter="latest"[^>]*>)Latest \([\d,]+\)(<\/button>)/, `$1Latest (${revFmt})$2`)
      .replace(/(data-lb-filter="five"[^>]*>)★★★★★ \([\d,]+\)(<\/button>)/, `$1★★★★★ (${fiveFmt})$2`)
      .replace(/(data-lb-filter="favorites"[^>]*>)★★★★\+ \([\d,]+\)(<\/button>)/, `$1★★★★+ (${fourFmt})$2`)
      .replace(/(data-lb-filter="liked"[^>]*>)♥ Liked \([\d,]+\)(<\/button>)/, `$1♥ Liked (${likedRevFmt})$2`)
      .replace(/Search [\d,]+ film reviews/g, `Search ${revFmt} film reviews`)
      .replace(/Search [\d,]+ reviews, films, or years…/g, `Search ${revFmt} reviews, films, or years…`);
    fs.writeFileSync(htmlPath, html, "utf8");
  }

  if (fs.existsSync(llmsPath)) {
    let llms = fs.readFileSync(llmsPath, "utf8");
    const revFmt = data.stats.reviewCount.toLocaleString("en-US");
    const watchFmt = data.stats.watchedCount.toLocaleString("en-US");
    const likeFmt = data.stats.likedCount.toLocaleString("en-US");
    llms = llms.replace(
      /\*\*Letterboxd Film Archive \(@brslli\)\*\*: \*\*[\d,]+ films watched\*\* · \*\*[\d,]+ written reviews\*\*(.*?)· \*\*[\d,]+ liked films\*\*/,
      `**Letterboxd Film Archive (@brslli)**: **${watchFmt} films watched** · **${revFmt} written reviews**$1· **${likeFmt} liked films**`
    );
    fs.writeFileSync(llmsPath, llms, "utf8");
  }

  console.log(
    `Synced Letterboxd RSS: +${addedReviews} new reviews, ${updatedReviews} updated reviews, +${addedWatches} star-only watches (total reviews: ${data.stats.reviewCount}).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
