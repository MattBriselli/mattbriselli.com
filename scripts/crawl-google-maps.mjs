#!/usr/bin/env node
/**
 * Zero-dependency Headless Chrome (CDP) crawler & weekly syncer for Matt's public
 * Google Maps Contributor profile (104641095422852249098).
 *
 * Intercepts Google Maps' /locationhistory/preview/mas JSON batches across:
 *   1. /reviews (written reviews + star ratings + exact timestamps + attached photos)
 *   2. /photos  (sorted by date — 100 photos per batch with exact capture dates & countries)
 *   3. /photos  (sorted by views — highest-viewed uploads)
 *
 * Stores permanent media keys (CIABIh... / AF1Qip...), high-res CDN URLs, exact [lat, lng],
 * ratings, written review quotes, and capture dates into data/maps-index.json.
 *
 * Usage:
 *   node scripts/crawl-google-maps.mjs --max-scrolls=50
 *   node scripts/crawl-google-maps.mjs --weekly
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONTRIB_ID = "104641095422852249098";
const REVIEWS_URL = `https://www.google.com/maps/contrib/${CONTRIB_ID}/reviews?hl=en&gl=us`;
const PHOTOS_URL = `https://www.google.com/maps/contrib/${CONTRIB_ID}/photos?hl=en&gl=us`;

const mapsJsonPath = path.resolve("data/maps-index.json");
const mapsReviewsPath = path.resolve("data/maps-reviews.json");
const htmlPath = path.resolve("index.html");
const llmsPath = path.resolve("llms.txt");

const args = process.argv.slice(2);
const isWeekly = args.includes("--weekly");
const maxScrollsArg = args.find((a) => a.startsWith("--max-scrolls="));
const maxScrolls = maxScrollsArg
  ? Number(maxScrollsArg.split("=")[1])
  : isWeekly
    ? 6
    : 55;

function findChromeBinary() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium"
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Could not find Google Chrome binary.");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CdpSession {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        const handlers = this.listeners.get(msg.method) || [];
        for (const h of handlers) h(msg.params);
      }
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

async function launchChrome(port = 9241) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maps-cdp-"));
  const chromeBin = findChromeBinary();
  let stderrBuf = "";
  const proc = spawn(
    chromeBin,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1440,960",
      "--lang=en-US",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank"
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  proc.stderr?.on("data", (chunk) => {
    if (stderrBuf.length < 2000) stderrBuf += String(chunk);
  });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        targets = await res.json();
        if (targets.length) break;
      }
    } catch {
      // wait
    }
  }
  if (!targets || !targets.length) {
    proc.kill("SIGKILL");
    throw new Error(`Chrome DevTools endpoint failed to start (${chromeBin}): ${stderrBuf.trim()}`);
  }

  const pageTarget = targets.find((t) => t.type === "page") || targets[0];
  const cdp = new CdpSession(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();

  const cleanup = () => {
    cdp.close();
    try {
      proc.kill("SIGKILL");
    } catch {
      // ignore
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  return { cdp, cleanup };
}

function upgradePhotoUrl(rawUrl) {
  if (!rawUrl || !rawUrl.includes("googleusercontent.com/")) return "";
  const url = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
  // Ignore user avatar URLs
  if (url.includes("/a-/ALV-") || url.includes("/ogw/")) return "";
  return url.replace(/=[^=/]+$/, "=w1000-h750-p-k-no");
}

function classifyPlace({ address = "", countryIso = "", lat = 0, lng = 0 }) {
  const addr = address.toLowerCase();
  const iso = (countryIso || "").toUpperCase();

  if (iso === "CA" || /,\s*(bc|ab|on|qc|ns|nb|pe|nt)\b|canada/i.test(address)) {
    return { region: "canada", tag: "international" };
  }
  if (["KZ", "UZ", "KG", "TJ", "TM"].includes(iso) || /kazakhstan|uzbekistan|kyrgyzstan|tajikistan|turkmenistan/i.test(addr)) {
    return { region: "central-asia", tag: "international" };
  }
  if ((iso && iso !== "US") || (!/,\s*[A-Z]{2}\s+\d{5}/.test(address) && !/united states|\busa\b/i.test(addr) && (lng > -50 || lat < 18))) {
    return { region: "international", tag: "international" };
  }
  if (/new york,\s*ny|brooklyn,\s*ny|queens,\s*ny|manhattan|bronx,\s*ny|staten island/i.test(address)) {
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

function parseMasPayload(rawText, store) {
  if (!rawText || !rawText.startsWith(")]}'")) return { reviewsFound: 0, photosFound: 0 };
  let parsed;
  try {
    parsed = JSON.parse(rawText.replace(/^\)\]\}'\n/, ""));
  } catch {
    return { reviewsFound: 0, photosFound: 0 };
  }

  // 1. Extract profile telemetry if present
  try {
    const contribCounts = parsed?.[16]?.[8]?.[0];
    if (Array.isArray(contribCounts)) {
      let photos = 0;
      let videos = 0;
      for (const row of contribCounts) {
        const label = row?.[6];
        const total = Number(row?.[9]);
        if (label === "Reviews" && total > 0) store.telemetry.totalReviews = Math.max(store.telemetry.totalReviews, total);
        if (label === "Ratings" && total > 0) store.telemetry.totalRatings = Math.max(store.telemetry.totalRatings, total);
        if (label === "Photos" && total > 0) photos = total;
        if (label === "Videos" && total > 0) videos = total;
      }
      if (photos > 0) {
        store.telemetry.totalPhotos = Math.max(store.telemetry.totalPhotos, photos + videos);
      }
    }
    const viewsCandidate = Number(parsed?.[22]?.[3]);
    if (viewsCandidate > 100000000) {
      store.telemetry.totalPhotoViews = Math.max(store.telemetry.totalPhotoViews, viewsCandidate);
    }
  } catch {
    // ignore
  }

  let reviewsFound = 0;
  let photosFound = 0;

  const upsertPlace = (id, patch) => {
    if (!id) return null;
    const cur = store.places.get(id) || {
      id,
      name: "",
      location: "",
      category: "",
      lat: null,
      lng: null,
      rating: null,
      views: 0,
      date: "",
      countryIso: "",
      caption: "",
      photos: [],
      mediaKeys: []
    };
    if (patch.name && !cur.name) cur.name = patch.name;
    if (patch.location && (!cur.location || patch.location.length > cur.location.length)) cur.location = patch.location;
    if (patch.category && !cur.category) cur.category = patch.category;
    if (typeof patch.lat === "number" && Number.isFinite(patch.lat)) cur.lat = Number(patch.lat.toFixed(5));
    if (typeof patch.lng === "number" && Number.isFinite(patch.lng)) cur.lng = Number(patch.lng.toFixed(5));
    if (typeof patch.rating === "number" && patch.rating > 0) cur.rating = patch.rating;
    if (typeof patch.views === "number" && patch.views > cur.views) cur.views = patch.views;
    if (patch.date && (!cur.date || patch.date > cur.date)) cur.date = patch.date;
    if (patch.countryIso && !cur.countryIso) cur.countryIso = patch.countryIso;
    if (patch.caption && (!cur.caption || patch.caption.length > cur.caption.length)) cur.caption = patch.caption;

    for (const u of patch.photos || []) {
      const clean = upgradePhotoUrl(u);
      if (clean && !cur.photos.includes(clean) && cur.photos.length < 8) {
        cur.photos.push(clean);
      }
    }
    for (const mk of patch.mediaKeys || []) {
      if (mk && !cur.mediaKeys.includes(mk) && cur.mediaKeys.length < 12) {
        cur.mediaKeys.push(mk);
      }
    }
    store.places.set(id, cur);
    return cur;
  };

  // 2. Parse Reviews array: parsed[45][0]
  const revItems = parsed?.[45]?.[0];
  if (Array.isArray(revItems)) {
    for (const item of revItems) {
      const pInfo = item?.[1]?.[0];
      const rev = item?.[2];
      if (!Array.isArray(pInfo)) continue;
      const placeId = pInfo[1] || pInfo[13] || "";
      const lat = pInfo[3]?.[2];
      const lng = pInfo[3]?.[3];
      const name = pInfo[4] || "";
      const address = pInfo[5] || "";
      const category = pInfo[9]?.[0]?.[0] || "";

      const rating = rev?.[2]?.[0]?.[0] || null;
      const reviewText = rev?.[2]?.[15]?.[0]?.[0] || "";
      const createdMicros = Number(rev?.[1]?.[2] || 0);
      const date = createdMicros > 1e12 ? new Date(createdMicros / 1000).toISOString().slice(0, 10) : "";

      const photos = [];
      const mediaKeys = [];
      const revPhotos = rev?.[2]?.[2];
      if (Array.isArray(revPhotos)) {
        for (const ph of revPhotos) {
          const mk = ph?.[0];
          const u = ph?.[1]?.[6]?.[0];
          if (mk) mediaKeys.push(mk);
          if (u) photos.push(u);
        }
      }

      if (placeId && name && typeof lat === "number" && typeof lng === "number") {
        upsertPlace(placeId, {
          name,
          location: address,
          category,
          lat,
          lng,
          rating,
          date,
          caption: reviewText ? `“${reviewText.trim()}”` : "",
          photos,
          mediaKeys
        });
        reviewsFound++;
      }
    }
  }

  // 3. Parse Photos array: parsed[22][1]
  const photoItems = parsed?.[22]?.[1];
  if (Array.isArray(photoItems)) {
    for (const entry of photoItems) {
      const phMeta = entry?.[0];
      const plMeta = entry?.[1];
      if (!Array.isArray(phMeta)) continue;

      const mediaKey = phMeta[0] || "";
      const photoUrl = phMeta[6]?.[0] || "";
      const dateArr = phMeta[21]?.[6]?.[7] || phMeta[21]?.[6]?.[8];
      let date = "";
      if (Array.isArray(dateArr) && dateArr[0] >= 2005) {
        const y = String(dateArr[0]);
        const m = String(dateArr[1] || 1).padStart(2, "0");
        const d = String(dateArr[2] || 1).padStart(2, "0");
        date = `${y}-${m}-${d}`;
      }

      const lat = plMeta?.[0]?.[2] ?? phMeta?.[21]?.[5]?.[0]?.[1]?.[0]?.[2];
      const lng = plMeta?.[0]?.[3] ?? phMeta?.[21]?.[5]?.[0]?.[1]?.[0]?.[3];
      const deepPlaceBlock = phMeta?.[21]?.[5]?.[0]?.[9]?.[0];
      const name =
        plMeta?.[2] ||
        deepPlaceBlock?.[2]?.[0] ||
        phMeta?.[21]?.[3]?.[7]?.[0] ||
        "";
      const address = plMeta?.[3] || "";
      const placeId =
        plMeta?.[17] ||
        phMeta?.[21]?.[5]?.[0]?.[9]?.[1]?.[0]?.[0]?.[0] ||
        deepPlaceBlock?.[0]?.[3] ||
        `${name}|${Number(lat || 0).toFixed(3)}`;
      const category = plMeta?.[18] || deepPlaceBlock?.[3]?.[0] || "";
      const countryIso = plMeta?.[28] || "";
      const countryName = plMeta?.[26] || "";
      const city = plMeta?.[25] || "";

      // Extract view count if present in photo entry (e.g. Sort by views)
      let views = 0;
      const viewCountCandidate = Number(entry?.[4]?.[0] || phMeta?.[21]?.[6]?.[0] || 0);
      if (viewCountCandidate > 50) views = viewCountCandidate;

      let location = address;
      if (countryName && countryIso && countryIso !== "US" && location && !location.toLowerCase().includes(countryName.toLowerCase())) {
        location = `${location}, ${countryName}`;
      } else if (!location && (city || countryName)) {
        location = [city, countryName].filter(Boolean).join(", ");
      }

      if (name && typeof lat === "number" && typeof lng === "number" && photoUrl) {
        upsertPlace(placeId, {
          name,
          location,
          category,
          lat,
          lng,
          views,
          date,
          countryIso,
          photos: [photoUrl],
          mediaKeys: mediaKey ? [mediaKey] : []
        });
        photosFound++;
      }
    }
  }

  return { reviewsFound, photosFound };
}

async function cdpClickSelector(cdp, selectorOrFnExpr) {
  const res = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const el = (${selectorOrFnExpr})();
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (el.textContent || '').trim().slice(0, 40) };
    })()`,
    returnByValue: true
  });
  const pt = res.result?.value;
  if (!pt) return null;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await sleep(60);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  return pt;
}

async function scrollContributorFeed(cdp, label, scrollCount, getBatchCounter) {
  let stagnant = 0;
  let prevBatches = getBatchCounter();
  let prevScrollH = 0;

  for (let i = 0; i < scrollCount; i++) {
    const stateRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const all = [...document.querySelectorAll('div')];
        const scrollers = all.filter(el => {
          if (el.clientHeight < 150 || el.scrollHeight <= el.clientHeight + 20) return false;
          const oy = getComputedStyle(el).overflowY;
          return oy === 'auto' || oy === 'scroll' || el.classList.contains('m6QErb');
        });
        scrollers.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
        const target = scrollers[0];
        if (!target) return { found: false, scrollH: 0, scrollTop: 0 };
        target.scrollTop = target.scrollHeight;
        target.dispatchEvent(new Event('scroll', { bubbles: true }));
        const r = target.getBoundingClientRect();
        return {
          found: true,
          scrollH: target.scrollHeight,
          scrollTop: Math.round(target.scrollTop),
          x: Math.round(r.left + Math.min(180, r.width / 2)),
          y: Math.round(r.top + Math.min(350, r.height / 2))
        };
      })()`,
      returnByValue: true
    });

    const val = stateRes.result?.value || { found: false, scrollH: 0, x: 220, y: 480 };
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: val.x || 220, y: val.y || 480 });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: val.x || 220,
      y: val.y || 480,
      deltaX: 0,
      deltaY: 3200
    });

    await sleep(1750);

    const curBatches = getBatchCounter();
    if (curBatches === prevBatches && val.scrollH === prevScrollH) {
      stagnant++;
    } else {
      stagnant = 0;
      prevBatches = curBatches;
      prevScrollH = val.scrollH;
    }

    if ((i + 1) % 5 === 0 || i === scrollCount - 1) {
      console.log(`  [${label}] scroll ${i + 1}/${scrollCount} -> scrollH: ${val.scrollH}, masBatches: ${curBatches}`);
    }
    if (stagnant >= 5) {
      console.log(`  [${label}] stabilized after ${i + 1} scrolls (scrollH=${val.scrollH}, masBatches=${curBatches}).`);
      break;
    }
  }
}

async function main() {
  const existingData = JSON.parse(fs.readFileSync(mapsJsonPath, "utf8"));
  const existingReviewsPayload = fs.existsSync(mapsReviewsPath)
    ? JSON.parse(fs.readFileSync(mapsReviewsPath, "utf8"))
    : { lastUpdated: existingData.lastUpdated || "", mediaKeysByPlace: {}, reviews: existingData.hostedReviews || [] };
  const hostedReviewsList = Array.isArray(existingReviewsPayload.reviews)
    ? existingReviewsPayload.reviews
    : Array.isArray(existingReviewsPayload)
      ? existingReviewsPayload
      : [];
  const mediaKeysByPlace = existingReviewsPayload.mediaKeysByPlace || {};
  const store = {
    telemetry: {
      points: existingData.profile?.points || 385939,
      totalPhotos: existingData.profile?.totalPhotos || 66085,
      totalPhotoViews: existingData.profile?.totalPhotoViews || 1185244022,
      totalReviews: existingData.profile?.totalReviews || 3591,
      totalRatings: existingData.profile?.totalRatings || 54
    },
    places: new Map()
  };

  // Seed with existing curated places so Hall-of-Fame view counts & captions stay intact
  for (const p of existingData.places || []) {
    store.places.set(p.id, {
      id: p.id,
      name: p.name,
      location: p.location,
      region: p.region,
      category: p.category,
      lat: p.lat,
      lng: p.lng,
      views: p.views || 0,
      secondaryViews: p.secondaryViews || 0,
      rating: p.rating || null,
      date: p.date || "",
      countryIso: p.countryIso || "",
      tag: p.tag,
      caption: p.caption || "",
      photos: [...(p.photos || [])],
      mediaKeys: [...(p.mediaKeys || mediaKeysByPlace[p.id] || [])]
    });
  }

  const { cdp, cleanup } = await launchChrome(9242);
  let totalMasBatches = 0;

  try {
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.send("Network.enable", { maxPostDataSize: 65536 });
    await cdp.send("Runtime.enable");

    const masRequests = new Map();

    cdp.on("Network.responseReceived", (params) => {
      const url = params.response?.url || "";
      if (url.includes("/locationhistory/preview/mas")) {
        masRequests.set(params.requestId, url);
      }
    });

    cdp.on("Network.loadingFinished", async (params) => {
      if (!masRequests.has(params.requestId)) return;
      masRequests.delete(params.requestId);
      try {
        const bodyRes = await cdp.send("Network.getResponseBody", { requestId: params.requestId });
        const text = bodyRes.base64Encoded
          ? Buffer.from(bodyRes.body, "base64").toString("utf8")
          : bodyRes.body;
        const res = parseMasPayload(text, store);
        if (res.reviewsFound || res.photosFound) {
          totalMasBatches++;
        }
      } catch {
        // ignore evicted buffer
      }
    });

    // Pass 1: Crawl Reviews Feed
    console.log("Pass 1: Crawling Google Maps Reviews ->", REVIEWS_URL);
    await cdp.send("Page.navigate", { url: REVIEWS_URL });
    await sleep(5500);

    // Dismiss consent banner if shown
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = [...document.querySelectorAll('button')].find(b => /accept all|reject all|i agree/i.test(b.textContent || ''));
        if (btn) btn.click();
      })()`,
      returnByValue: true
    });
    await sleep(1200);

    // Extract Local Guide points from header text
    const headerCheck = await cdp.send("Runtime.evaluate", {
      expression: `document.body.innerText.slice(0, 1200)`,
      returnByValue: true
    });
    const headerTxt = headerCheck.result?.value || "";
    const ptsMatch = headerTxt.match(/([\d,]+)\s*points/i);
    if (ptsMatch) {
      const pts = Number(ptsMatch[1].replace(/,/g, ""));
      if (pts > store.telemetry.points) store.telemetry.points = pts;
    }

    await scrollContributorFeed(cdp, "Reviews", isWeekly ? 5 : maxScrolls, () => totalMasBatches);

    // Pass 2: Crawl Photos Feed (Sorted by Date)
    console.log("Pass 2: Crawling Google Maps Photos (by Date) ->", PHOTOS_URL);
    await cdp.send("Page.navigate", { url: PHOTOS_URL });
    await sleep(5500);

    const viewsCheck = await cdp.send("Runtime.evaluate", {
      expression: `document.body.innerText.slice(0, 1200)`,
      returnByValue: true
    });
    const viewsTxt = viewsCheck.result?.value || "";
    const viewsMatch = viewsTxt.match(/([\d,]{9,})\s*views/i);
    if (viewsMatch) {
      const v = Number(viewsMatch[1].replace(/,/g, ""));
      if (v > store.telemetry.totalPhotoViews) store.telemetry.totalPhotoViews = v;
    }

    await scrollContributorFeed(cdp, "Photos-ByDate", isWeekly ? 3 : 12, () => totalMasBatches);

    // Pass 3 (Deep Crawl Only): Real CDP click on Date -> Sort by views
    if (!isWeekly) {
      console.log("Pass 3: Switching Photos to Sort by Views...");
      const openMenu = await cdpClickSelector(
        cdp,
        `() => document.querySelector('button[jsaction*="photo.sortMenu"]') || [...document.querySelectorAll('button')].find(b => /^date$/i.test((b.textContent || '').trim()))`
      );
      await sleep(1100);
      const pickedViews = await cdpClickSelector(
        cdp,
        `() => [...document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')].find(el => /sort by views/i.test((el.textContent || '').trim()))`
      );
      console.log("  Sort menu clicked:", Boolean(openMenu), "-> Sort by views clicked:", Boolean(pickedViews));
      await sleep(3500);
      await scrollContributorFeed(cdp, "Photos-ByViews", 24, () => totalMasBatches);
    }

    await sleep(1500);
  } finally {
    cleanup();
  }

  // Finalize places that have at least 1 valid photo & coordinates, capping unreviewed NYC overflow so global/US-50 shine
  const allCandidates = [];
  for (const p of store.places.values()) {
    if (!p.photos?.length || typeof p.lat !== "number" || typeof p.lng !== "number") continue;
    const { region, tag } = classifyPlace({
      address: p.location,
      countryIso: p.countryIso,
      lat: p.lat,
      lng: p.lng
    });

    const yearStr = p.date ? p.date.slice(0, 4) : "";
    let catLabel = p.category || "Field Dispatch";
    if (yearStr && !catLabel.includes(yearStr)) {
      catLabel = `${catLabel} · ${yearStr}`;
    }

    const hasWrittenReview = Boolean(p.caption && p.caption.startsWith("“"));
    let caption = p.caption;
    if (!caption) {
      caption = p.date
        ? `Photographed in ${p.location || p.name} (${p.date}).`
        : `Photographed on Google Maps in ${p.location || p.name}.`;
    }

    const entry = {
      id: p.id,
      name: p.name,
      location: p.location || p.name,
      region,
      category: catLabel,
      lat: p.lat,
      lng: p.lng,
      tag,
      caption,
      photos: p.photos,
      _hasWrittenReview: hasWrittenReview
    };
    if (p.rating) entry.rating = p.rating;
    if (p.date) entry.date = p.date;
    if (p.countryIso) entry.countryIso = p.countryIso;
    if (p.mediaKeys?.length) entry.mediaKeys = p.mediaKeys;

    allCandidates.push(entry);
  }

  allCandidates.sort((a, b) => {
    if (a._hasWrittenReview !== b._hasWrittenReview) return a._hasWrittenReview ? -1 : 1;
    return String(b.date || "").localeCompare(String(a.date || ""));
  });

  const finalPlaces = [];
  let nycCount = 0;
  for (const entry of allCandidates) {
    const hadReview = entry._hasWrittenReview;
    delete entry._hasWrittenReview;
    if (entry.tag === "nyc") {
      if (nycCount >= 45) continue;
      nycCount++;
    }
    if (finalPlaces.length >= 348) break;
    if (entry.mediaKeys?.length) {
      mediaKeysByPlace[entry.id] = entry.mediaKeys;
      delete entry.mediaKeys;
    }
    entry.photos = (entry.photos || []).slice(0, 2);
    finalPlaces.push(entry);

    // Also keep data/maps-reviews.json fresh with any newly crawled written reviews
    if (hadReview && entry.caption) {
      const cleanTxt = entry.caption.replace(/^[“"]|[”"]$/g, "").trim();
      const alreadyHosted = hostedReviewsList.some(
        (r) => r.id === entry.id || (r.name.toLowerCase() === entry.name.toLowerCase() && r.text.slice(0, 30) === cleanTxt.slice(0, 30))
      );
      if (!alreadyHosted && cleanTxt.length >= 8) {
        hostedReviewsList.unshift({
          id: entry.id,
          name: entry.name,
          location: entry.location,
          countryIso: entry.countryIso || "US",
          rating: entry.rating || 5,
          date: entry.date || "",
          dateText: "",
          text: cleanTxt,
          photo: entry.photos?.[0] || ""
        });
      }
    }
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  delete existingData.hostedReviews;
  delete existingData.topViewedLedger;
  delete existingData.profile?.bio;
  delete existingData.profile?.level;
  delete existingData.profile?.points;
  delete existingData.profile?.totalPhotoViews;
  existingData.lastUpdated = todayIso;
  existingData.profile = {
    ...existingData.profile,
    totalPhotos: store.telemetry.totalPhotos,
    totalReviews: store.telemetry.totalReviews,
    totalRatings: store.telemetry.totalRatings,
    countriesCount: 39,
    usStatesCount: 50,
    canadianProvincesCount: 8
  };
  existingData.places = finalPlaces;

  // Compact serialization keeps maps-index.json < 256 KB for fast initial load
  fs.writeFileSync(mapsJsonPath, JSON.stringify(existingData) + "\n", "utf8");
  fs.writeFileSync(
    mapsReviewsPath,
    JSON.stringify(
      {
        lastUpdated: todayIso,
        count: hostedReviewsList.length,
        reviews: hostedReviewsList,
        mediaKeysByPlace
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  // Sync static telemetry counters in index.html & llms.txt
  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, "utf8");
    const pFmt = store.telemetry.totalPhotos.toLocaleString("en-US");
    const rFmt = store.telemetry.totalReviews.toLocaleString("en-US");
    const placesFmt = finalPlaces.length.toLocaleString("en-US");

    html = html
      .replace(/(id="stat-total-photos">)[\d,]+(<\/dd>)/, `$1${pFmt}$2`)
      .replace(/(id="stat-total-reviews">)[\d,]+(<\/dd>)/, `$1${rFmt}$2`)
      .replace(/(data-slide-filter="all"[^>]*>)Shuffled Mix \([\d,]+\)(<\/button>)/, `$1Shuffled Mix (${placesFmt})$2`);
    fs.writeFileSync(htmlPath, html, "utf8");
  }

  if (fs.existsSync(llmsPath)) {
    let llms = fs.readFileSync(llmsPath, "utf8");
    const pFmt = store.telemetry.totalPhotos.toLocaleString("en-US");
    const rFmt = store.telemetry.totalReviews.toLocaleString("en-US");
    llms = llms.replace(
      /\*\*Google Maps Photography & Field Notes\*\*: \*\*[\d,]+ uploaded photos\*\* · \*\*[\d,]+ written reviews\*\*/,
      `**Google Maps Photography & Field Notes**: **${pFmt} uploaded photos** · **${rFmt} written reviews**`
    );
    fs.writeFileSync(llmsPath, llms, "utf8");
  }

  const byTag = {};
  const years = new Set();
  for (const p of finalPlaces) {
    byTag[p.tag] = (byTag[p.tag] || 0) + 1;
    if (p.date) years.add(p.date.slice(0, 4));
  }

  console.log(
    `Crawl complete! Batches=${totalMasBatches}, Total Places=${finalPlaces.length}, Tags=${JSON.stringify(byTag)}, Years=${[...years].sort().join(",")}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
