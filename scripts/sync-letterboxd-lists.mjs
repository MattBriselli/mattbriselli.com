#!/usr/bin/env node
/**
 * Builds and syncs data/letterboxd-lists.json from Matt's public Letterboxd lists
 * (https://letterboxd.com/brslli/lists/), cross-referencing pre-cached 2:3 film
 * posters, ratings, and review snippets from data/letterboxd-reviews.json and
 * resolving any remaining 2:3 film posters via mattbriselli.com/api/lb-poster.
 */
import fs from "node:fs";
import path from "node:path";

const LISTS_URL = "https://letterboxd.com/brslli/lists/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const reviewsPath = path.resolve("data/letterboxd-reviews.json");
const outPath = path.resolve("data/letterboxd-lists.json");
const cachedP1 = "/tmp/lb_lists_p1.html";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(str = "") {
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function classifyListTag(title = "", slug = "") {
  const s = `${title} ${slug}`.toLowerCase();
  if (/2026|2025|top-films|watched-in/.test(s)) return "yearly";
  if (/set-in|set-at|christmas|thanksgiving|bay-area|philly/.test(s)) return "places-seasons";
  return "tropes";
}

function parseLazyPosterDivs(htmlBlock) {
  const films = [];
  const divMatches = htmlBlock.match(/<div[^>]*data-component-class="LazyPoster"[^>]*>/g) || [];
  for (const tag of divMatches) {
    const fullName = decodeEntities(tag.match(/data-item-full-display-name="([^"]+)"/)?.[1] || "");
    const rawName = decodeEntities(tag.match(/data-item-name="([^"]+)"/)?.[1] || fullName);
    const slug = tag.match(/data-item-slug="([^"]+)"/)?.[1] || "";
    const linkPath = tag.match(/data-item-link="([^"]+)"/)?.[1] || (slug ? `/film/${slug}/` : "");
    const identRaw = decodeEntities(tag.match(/data-postered-identifier='([^']+)'/)?.[1] || "");
    let lid = "";
    try {
      lid = JSON.parse(identRaw)?.lid || "";
    } catch {}

    const yearMatch = fullName.match(/\((\d{4})\)\s*$/);
    const year = yearMatch ? yearMatch[1] : "";
    const title = rawName.replace(/\s*\(\d{4}\)\s*$/, "").trim();
    if (!title) continue;

    films.push({
      title,
      year,
      slug,
      filmBoxdId: lid,
      link: linkPath ? `https://letterboxd.com${linkPath}` : "https://letterboxd.com/brslli/"
    });
  }
  return films;
}

function parseListDetailFilms(html) {
  const entries = [];
  const liBlocks = html.match(/<li[^>]*class="[^"]*posteritem[^"]*"[\s\S]*?<\/li>/g) || [];
  for (const li of liBlocks) {
    const films = parseLazyPosterDivs(li);
    if (!films.length) continue;
    const film = films[0];
    const ownerRating2x = Number(li.match(/data-owner-rating="(\d+)"/)?.[1] || 0);
    if (ownerRating2x > 0) {
      film.rating = ownerRating2x / 2;
    }
    const rankNum = li.match(/<p[^>]*class="[^"]*list-number[^"]*"[^>]*>(\d+)<\/p>/)?.[1];
    if (rankNum) {
      film.rank = Number(rankNum);
    }
    entries.push(film);
  }
  return entries;
}

async function fetchHtmlGracefully(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      redirect: "follow"
    });
    if (!res.ok) return "";
    const txt = await res.text();
    if (txt.length < 12000 || txt.includes("Just a moment...")) return "";
    return txt;
  } catch {
    return "";
  }
}

async function resolveEdgePoster(boxdId, title, year) {
  const params = new URLSearchParams();
  if (boxdId) params.set("id", boxdId);
  if (title) params.set("title", title);
  if (year) params.set("year", String(year));
  try {
    const res = await fetch(`https://mattbriselli.com/api/lb-poster?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.ok && data.poster && (data.poster.includes("a.ltrbxd.com") || data.poster.includes("600x900"))) {
        return data.poster;
      }
    }
  } catch {}
  return "";
}

async function main() {
  const reviewsData = JSON.parse(fs.readFileSync(reviewsPath, "utf8"));
  const prevListsData = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, "utf8"))
    : { lists: [] };
  const prevBySlug = new Map((prevListsData.lists || []).map((l) => [l.slug, l]));

  // Build instant lookup from our 1,422 hosted reviews & favorites
  const reviewByLid = new Map();
  const reviewByTitleYear = new Map();
  const posterByKey = new Map();

  for (const f of reviewsData.favorites || []) {
    if (f.poster) {
      if (f.filmBoxdId) posterByKey.set(f.filmBoxdId, f.poster);
      posterByKey.set(`${f.filmTitle.toLowerCase()}|${f.filmYear}`, f.poster);
    }
  }
  for (const r of reviewsData.reviews || []) {
    const ty = `${r.filmTitle.toLowerCase()}|${r.filmYear}`;
    if (r.filmBoxdId && !reviewByLid.has(r.filmBoxdId)) reviewByLid.set(r.filmBoxdId, r);
    if (!reviewByTitleYear.has(ty)) reviewByTitleYear.set(ty, r);
    if (r.poster) {
      if (r.filmBoxdId) posterByKey.set(r.filmBoxdId, r.poster);
      posterByKey.set(ty, r.poster);
    }
  }
  // Also preserve posters from any previous lists JSON
  for (const l of prevListsData.lists || []) {
    for (const f of l.films || []) {
      if (f.poster) {
        if (f.filmBoxdId) posterByKey.set(f.filmBoxdId, f.poster);
        posterByKey.set(`${f.title.toLowerCase()}|${f.year}`, f.poster);
      }
    }
  }

  let indexHtml = "";
  if (fs.existsSync(cachedP1) && !process.argv.includes("--live")) {
    indexHtml = fs.readFileSync(cachedP1, "utf8");
  } else {
    indexHtml = await fetchHtmlGracefully(LISTS_URL);
  }

  if (!indexHtml) {
    console.log("Letterboxd lists index unavailable right now; keeping existing data/letterboxd-lists.json.");
    return;
  }

  const articles = indexHtml.match(/<article class="list-summary[\s\S]*?<\/article>/g) || [];
  console.log(`Parsed ${articles.length} Letterboxd lists from index...`);

  const lists = [];
  for (const art of articles) {
    const id = art.match(/data-film-list-id="(\d+)"/)?.[1] || "";
    const href = art.match(/<h2[^>]*>[\s\S]*?<a href="([^"]+)"/)?.[1] || "";
    const slug = href.split("/").filter(Boolean).pop() || id;
    const title = decodeEntities(art.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1] || "").trim();
    const countRaw = decodeEntities(art.match(/<span class="value">([\s\S]*?)<\/span>/)?.[1] || "").trim();
    const filmCount = Number(countRaw.replace(/[^\d]/g, "")) || 0;
    const description = decodeEntities(
      art.match(/<div class="notes[^>]*>([\s\S]*?)<\/div>/)?.[1]?.replace(/<[^>]+>/g, " ") || ""
    )
      .replace(/\s+/g, " ")
      .trim();

    const previewFilms = parseLazyPosterDivs(art);
    const fullUrl = `https://letterboxd.com${href}`;

    // Try fetching canonical list page gently for up to 100 films + ranked status
    let detailHtml = "";
    if (slug === "powered-by-google" && fs.existsSync("/tmp/lb_list_sample.html")) {
      detailHtml = fs.readFileSync("/tmp/lb_list_sample.html", "utf8");
    } else {
      await sleep(950);
      detailHtml = await fetchHtmlGracefully(fullUrl);
    }

    let fullFilms = detailHtml ? parseListDetailFilms(detailHtml) : [];
    let fullDesc = description;
    if (detailHtml) {
      const heroDesc = decodeEntities(
        detailHtml
          .match(/<div class="body-text -prose -hero[\s\S]*?<\/div>/)?.[0]
          ?.replace(/<[^>]+>/g, " ") || ""
      )
        .replace(/\s+/g, " ")
        .trim();
      if (heroDesc && heroDesc.length > fullDesc.length) {
        fullDesc = heroDesc;
      }
    }

    if (!fullFilms.length) {
      const prev = prevBySlug.get(slug);
      fullFilms = prev?.films?.length ? prev.films : previewFilms;
    }

    const isRanked =
      fullFilms.some((f) => typeof f.rank === "number") ||
      /ranked|top \d+|ordered list|order by/i.test(`${title} ${fullDesc}`);

    // Cap stored films per list at 48 so JSON stays nimble while giving a deep browsable gallery
    const cappedFilms = fullFilms.slice(0, 48).map((f, idx) => {
      const ty = `${f.title.toLowerCase()}|${f.year}`;
      const matchedRev = (f.filmBoxdId && reviewByLid.get(f.filmBoxdId)) || reviewByTitleYear.get(ty);
      const outFilm = {
        title: f.title,
        year: f.year,
        filmBoxdId: f.filmBoxdId || matchedRev?.filmBoxdId || "",
        link: matchedRev?.link || f.link,
        poster:
          (f.filmBoxdId && posterByKey.get(f.filmBoxdId)) ||
          posterByKey.get(ty) ||
          f.poster ||
          ""
      };
      if (f.rank || (/top films/i.test(title) && isRanked)) {
        outFilm.rank = f.rank || idx + 1;
      }
      const rating = f.rating ?? matchedRev?.rating ?? null;
      if (typeof rating === "number" && rating > 0) outFilm.rating = rating;
      if (matchedRev?.liked) outFilm.liked = true;
      if (matchedRev?.paragraphs?.[0]) {
        const snippet = matchedRev.paragraphs[0].trim();
        outFilm.reviewSnippet = snippet.length > 130 ? `${snippet.slice(0, 127).trim()}…` : snippet;
      }
      return outFilm;
    });

    lists.push({
      id,
      slug,
      title,
      url: fullUrl,
      filmCount: filmCount || fullFilms.length,
      isRanked,
      category: classifyListTag(title, slug),
      description: fullDesc,
      films: cappedFilms
    });
    console.log(`  [${slug}] count=${filmCount}, fetchedFilms=${fullFilms.length}, stored=${cappedFilms.length}`);
  }

  // Resolve any missing 2:3 posters across all list films (especially the first 5 collage posters!)
  const missingByKey = new Map();
  for (const list of lists) {
    for (const film of list.films) {
      if (film.poster) continue;
      const k = film.filmBoxdId || `${film.title.toLowerCase()}|${film.year}`;
      if (!missingByKey.has(k)) missingByKey.set(k, []);
      missingByKey.get(k).push(film);
    }
  }

  const pendingGroups = [...missingByKey.values()];
  console.log(`Resolving ${pendingGroups.length} uncached list film posters via edge API...`);
  let cursor = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (cursor < pendingGroups.length) {
      const group = pendingGroups[cursor++];
      const sample = group[0];
      const url = await resolveEdgePoster(sample.filmBoxdId, sample.title, sample.year);
      if (url) {
        for (const item of group) item.poster = url;
      }
      await sleep(85);
    }
  });
  await Promise.all(workers);

  const payload = {
    profileUrl: LISTS_URL,
    updatedAt: new Date().toISOString().slice(0, 10),
    totalListsCount: lists.length,
    lists
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  const totalFilmsStored = lists.reduce((acc, l) => acc + l.films.length, 0);
  const withPoster = lists.reduce((acc, l) => acc + l.films.filter((f) => f.poster).length, 0);
  console.log(
    `Saved ${lists.length} lists (${totalFilmsStored} film entries, ${withPoster} with 2:3 posters, ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB) -> ${outPath}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
