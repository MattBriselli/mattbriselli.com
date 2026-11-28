/**
 * Shared location privacy & 7-day rolling embargo helper.
 *
 * Security design:
 *   - ZERO personal/home coordinates or neighborhood names live in repository code.
 *   - Loads private geofence zones strictly from:
 *       1. process.env.PRIVACY_GEOFENCE_JSON (encrypted GitHub Actions / CI secret), or
 *       2. .swarm-blocklist.local.json (strictly gitignored local file).
 *   - Enforces a strict 7-day rolling delay so no check-in, photo, or review from
 *     the most recent 7 days is ever published.
 *   - Inside configured zones: drops everyday errands/residential/private venues,
 *     enforces a small doorstep buffer (default 250m), strips neighborhood/ZIP
 *     tokens and repeat visit-count signals, and thins remaining public venues
 *     deterministically to match the pin density of the surrounding ring (R..2R)
 *     so home zones blend naturally into their surroundings without a "donut hole".
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_EMBARGO_DAYS = 7;
export const DEFAULT_INNER_DROP_KM = 0.25;
export const DEFAULT_DENSITY_FACTOR = 0.9;

export const PRIVATE_VENUE_RE =
  /\b(home|residential|apartments?|apts?|condos?|condominiums?|townhomes?|housing|dorm|dormitory|residence hall|fraternity|sorority|leasing|self storage|u-haul|public storage|extra space storage|office|coworking|tech startup|conference room|shuttle stop|google shuttle|google bus|rental car shuttle|shuttle transfer to|doctor|dentist|dermatolog|orthodon|chiropract|physical therapy|medical|hospital|urgent care|clinic|veterinar|pharmacy|walgreens|cvs|duane reade|rite aid|therapy|bank|credit union|atm|gym|fitness|equinox|planet fitness|yoga|post office|usps|ups store|fedex|laundromat|cleaners|dry clean|tailor|supermarket|grocery|key food|gristedes|morton williams|acme|giant|wawa|target|whole foods|trader joe|lowe's|home depot|hardware|parking|garage|liquor|beverage|pet supplies|mud bay|wine shop|dispensary|cannabis)\b/i;

export function isNoisyOrPrivateVenueName(rawName = "") {
  const name = String(rawName || "").trim();
  if (!name) return true;
  // Internal corporate offices / microkitchens / commuter stops (keep Google Store / Googleplex)
  if (
    /\b(google|googler|youtube office|adobe systems|121 spear|345 spear|hills plaza)\b/i.test(name) &&
    !/\b(google store|googleplex|google visitor)\b/i.test(name)
  ) {
    return true;
  }
  // Individual airport boarding gates & TSA lines (keep real landmarks like Golden Gate, Gate of Dawn, Sather Gate)
  if (
    /^([A-Z]{3}\s*[-–]\s*)?Gate\s+[A-Z]?\d+[A-Z]?(\b|\s*\()/i.test(name) ||
    /\bTSA\s*(Pre-?Check|Security|Checkpoint)\b/i.test(name)
  ) {
    return true;
  }
  // Bare residential/office street address used as venue name (preserve scenic drives)
  if (
    /^\d+\s+[A-Za-z0-9.\s]+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Way|Place|Pl|Drive|Dr|Lane|Ln|Court|Ct|Terrace|Ter)\.?$/i.test(name) &&
    !/^(17 Mile Drive|49-Mile Scenic Drive)$/i.test(name)
  ) {
    return true;
  }
  // Friend's apartment / private pad naming pattern
  if (/^[A-Z][a-z]+(\s+&\s+[A-Z][a-z]+)?[’']s\s+(Apt|Apartment|House|Home|Condo|Roof|Room|Pad|Basement|Backyard|Couch)\b/i.test(name)) {
    return true;
  }
  return false;
}

export function loadPrivacyConfig() {
  let parsed = null;
  if (process.env.PRIVACY_GEOFENCE_JSON) {
    try {
      parsed = JSON.parse(process.env.PRIVACY_GEOFENCE_JSON);
    } catch {
      console.warn("Warning: PRIVACY_GEOFENCE_JSON could not be parsed.");
    }
  } else {
    const localPath = path.resolve(".swarm-blocklist.local.json");
    if (fs.existsSync(localPath)) {
      try {
        parsed = JSON.parse(fs.readFileSync(localPath, "utf8"));
      } catch {
        console.warn("Warning: .swarm-blocklist.local.json could not be parsed.");
      }
    }
  }
  const zones = Array.isArray(parsed?.zones)
    ? parsed.zones
    : Array.isArray(parsed?.circles)
      ? parsed.circles
      : [];
  const embargoDays = Number(parsed?.embargoDays) || DEFAULT_EMBARGO_DAYS;
  return { embargoDays, zones };
}

export function getEmbargoCutoffMs(embargoDays = DEFAULT_EMBARGO_DAYS) {
  return Date.now() - embargoDays * 24 * 60 * 60 * 1000;
}

export function isTooRecent(dateInput, embargoDays = DEFAULT_EMBARGO_DAYS) {
  if (!dateInput) return false;
  let tsMs = NaN;
  if (typeof dateInput === "number") {
    tsMs = dateInput < 1e11 ? dateInput * 1000 : dateInput;
  } else if (typeof dateInput === "string") {
    // Treat YYYY-MM-DD as end of that UTC day so borderline days stay safely delayed
    const trimmed = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      tsMs = Date.parse(`${trimmed}T23:59:59Z`);
    } else {
      tsMs = Date.parse(trimmed);
    }
  }
  if (!Number.isFinite(tsMs)) return false;
  return tsMs > getEmbargoCutoffMs(embargoDays);
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findMatchingZone(lat, lng, zones, textHint = "") {
  if (!Array.isArray(zones)) return null;
  for (const z of zones) {
    if (typeof lat === "number" && typeof lng === "number" && typeof z.lat === "number" && typeof z.lng === "number") {
      const rKm = Number(z.radiusKm) || 2.5;
      if (haversineKm(lat, lng, z.lat, z.lng) <= rKm) {
        return z;
      }
    }
    if (z.matchRegex && textHint) {
      try {
        if (new RegExp(z.matchRegex, "i").test(textHint)) {
          return z;
        }
      } catch {}
    }
  }
  return null;
}

/**
 * Deterministic ~1.8-3.2km blur anchored around the zone's public metro center
 * (NOT the private zone center!) so blurred points cannot be averaged back to home.
 */
export function blurCoordsToMetro(seedKey, zone) {
  const baseLat = typeof zone.coarseLat === "number" ? zone.coarseLat : Math.round(zone.lat * 10) / 10;
  const baseLng = typeof zone.coarseLng === "number" ? zone.coarseLng : Math.round(zone.lng * 10) / 10;
  const hash = crypto.createHash("sha256").update(String(seedKey)).digest();
  const u1 = hash.readUInt16BE(0) / 65535;
  const u2 = hash.readUInt16BE(2) / 65535;
  const angle = u1 * Math.PI * 2;
  const radiusDeg = 0.006 + u2 * 0.018; // ~0.7km - 2.6km around generic downtown center
  return {
    lat: Number((baseLat + radiusDeg * Math.cos(angle) * 0.75).toFixed(4)),
    lng: Number((baseLng + radiusDeg * Math.sin(angle)).toFixed(4)),
    location: zone.coarseLabel || "Metro Area"
  };
}

/**
 * Evaluates a candidate venue/place against private categories, 7-day embargo,
 * and private home-zone screening rules.
 *
 * Inside a home zone:
 *   - Always drops private/errand/residential venues and anything within the
 *     small doorstep buffer (default 250m of the zone center).
 *   - Drops venues whose name contains a configured private neighborhood/ZIP token.
 *   - Keeps real coordinates of remaining public venues (so density-matched
 *     thinning via `thinHomeZones` can blend them naturally into the surrounding
 *     area) while replacing the location label with the generic `coarseLabel`
 *     and marking `inZone: true` so callers strip repeat visit-frequency signals.
 *
 * @param {object} item - { name, location, category, lat, lng, dateOrTs, source: "swarm"|"maps" }
 * @param {object} config - from loadPrivacyConfig()
 * @returns {null | { lat: number, lng: number, location: string, blurred: boolean, inZone: boolean, zoneId: string|null }}
 */
export function filterAndBlurPlace(item, config) {
  const { embargoDays, zones } = config;
  if (isTooRecent(item.dateOrTs, embargoDays)) {
    return null;
  }

  const textBlob = `${item.name || ""} ${item.category || ""}`;
  if (isNoisyOrPrivateVenueName(item.name)) {
    return null;
  }
  if (item.source === "swarm" && PRIVATE_VENUE_RE.test(textBlob)) {
    return null;
  }

  const zone = findMatchingZone(
    item.lat,
    item.lng,
    zones,
    `${item.name || ""} ${item.location || ""}`
  );
  if (!zone) {
    return {
      lat: Number(Number(item.lat).toFixed(4)),
      lng: Number(Number(item.lng).toFixed(4)),
      location: item.location || "",
      blurred: false,
      inZone: false,
      zoneId: null
    };
  }

  // Inside a sensitive home zone: always drop everyday errands/residential/private venues.
  if (PRIVATE_VENUE_RE.test(textBlob)) {
    return null;
  }

  // Drop venues whose name explicitly mentions a private neighborhood/town/ZIP token.
  if (zone.matchRegex) {
    try {
      if (new RegExp(zone.matchRegex, "i").test(String(item.name || ""))) {
        return null;
      }
    } catch {}
  }

  // Enforce a small doorstep exclusion buffer around the exact zone center.
  const innerDropKm = Number.isFinite(Number(zone.innerDropKm))
    ? Number(zone.innerDropKm)
    : DEFAULT_INNER_DROP_KM;
  if (
    typeof item.lat === "number" &&
    typeof item.lng === "number" &&
    typeof zone.lat === "number" &&
    typeof zone.lng === "number" &&
    haversineKm(item.lat, item.lng, zone.lat, zone.lng) <= innerDropKm
  ) {
    return null;
  }

  return {
    lat: Number(Number(item.lat).toFixed(4)),
    lng: Number(Number(item.lng).toFixed(4)),
    location: zone.coarseLabel || "Metro Area",
    blurred: false,
    inZone: true,
    zoneId: String(zone.id || `${zone.coarseLabel || "zone"}`)
  };
}

function deterministicHash(seed) {
  return crypto.createHash("sha256").update(String(seed)).digest("hex");
}

/**
 * Density-matched deterministic thinning for home zones.
 *
 * For each configured zone (radius R):
 *   1. Counts pins in the surrounding annulus (R < d <= 2R) that are outside
 *      all home zones. Since the annulus has 3x the area of the inner circle,
 *      `targetCount = round((ringCount / 3) * densityFactor)` matches the
 *      surrounding area's natural pin density (default densityFactor = 0.9).
 *   2. Partitions candidate pins inside the zone into a coarse 6x6 spatial grid
 *      and selects up to `targetCount` pins via deterministic round-robin across
 *      grid cells (preferring higher `priority` within each cell) so kept pins
 *      are evenly spread and stable across weekly CI runs.
 *
 * @param {Array<{ lat: number, lng: number, key: string, priority?: number }>} entries
 * @param {object} config - from loadPrivacyConfig()
 * @returns {{ keptIndices: Set<number>, stats: Array<{ zoneIndex: number, radiusKm: number, ringCount: number, inZoneCount: number, targetCount: number, keptCount: number }> }}
 */
export function thinHomeZones(entries, config) {
  const zones = Array.isArray(config?.zones) ? config.zones : [];
  const keptIndices = new Set(entries.map((_, i) => i));
  const stats = [];
  if (!zones.length || !entries.length) {
    return { keptIndices, stats };
  }

  // Assign each entry to at most one home zone (first radius match).
  const entryZoneIdx = new Int16Array(entries.length).fill(-1);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e.lat !== "number" || typeof e.lng !== "number") continue;
    for (let zi = 0; zi < zones.length; zi++) {
      const z = zones[zi];
      if (typeof z.lat !== "number" || typeof z.lng !== "number") continue;
      const rKm = Number(z.radiusKm) || 2.5;
      if (haversineKm(e.lat, e.lng, z.lat, z.lng) <= rKm) {
        entryZoneIdx[i] = zi;
        break;
      }
    }
  }

  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi];
    if (typeof z.lat !== "number" || typeof z.lng !== "number") continue;
    const rKm = Number(z.radiusKm) || 2.5;
    const outerKm = rKm * 2;
    const densityFactor = Number.isFinite(Number(z.densityFactor))
      ? Number(z.densityFactor)
      : DEFAULT_DENSITY_FACTOR;

    let ringCount = 0;
    const inZone = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (typeof e.lat !== "number" || typeof e.lng !== "number") continue;
      if (entryZoneIdx[i] === zi) {
        inZone.push(i);
      } else if (entryZoneIdx[i] === -1) {
        const d = haversineKm(e.lat, e.lng, z.lat, z.lng);
        if (d > rKm && d <= outerKm) {
          ringCount++;
        }
      }
    }

    const rawTarget = Math.round((ringCount / 3) * densityFactor);
    const minKeep = Number.isFinite(Number(z.minKeep)) ? Number(z.minKeep) : 0;
    const maxKeep = Number.isFinite(Number(z.maxKeep)) ? Number(z.maxKeep) : Infinity;
    const targetCount = Math.max(minKeep, Math.min(maxKeep, rawTarget));

    if (inZone.length <= targetCount) {
      stats.push({
        zoneIndex: zi,
        radiusKm: rKm,
        ringCount,
        inZoneCount: inZone.length,
        targetCount,
        keptCount: inZone.length
      });
      continue;
    }

    // Remove all in-zone indices first, then re-add the spatially spread selection.
    for (const idx of inZone) keptIndices.delete(idx);

    const gridSpan = 6;
    const latRadiusDeg = rKm / 111.32;
    const lngRadiusDeg = rKm / (111.32 * Math.max(0.2, Math.cos((z.lat * Math.PI) / 180)));
    const cells = new Map();
    const zoneSalt = String(z.id || `zone-${zi}`);

    for (const idx of inZone) {
      const e = entries[idx];
      const gx = Math.max(
        0,
        Math.min(gridSpan - 1, Math.floor((((e.lng - z.lng) / lngRadiusDeg + 1) / 2) * gridSpan))
      );
      const gy = Math.max(
        0,
        Math.min(gridSpan - 1, Math.floor((((e.lat - z.lat) / latRadiusDeg + 1) / 2) * gridSpan))
      );
      const cellKey = `${gx},${gy}`;
      if (!cells.has(cellKey)) cells.set(cellKey, []);
      cells.get(cellKey).push({
        idx,
        priority: Number(e.priority) || 0,
        hash: deterministicHash(`${zoneSalt}|${e.key || idx}`)
      });
    }

    // Sort candidates inside each cell: higher priority first, then deterministic hash.
    for (const bucket of cells.values()) {
      bucket.sort((a, b) => (b.priority - a.priority) || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
    }

    // Deterministic cell order for round-robin sampling across the whole circle.
    const orderedBuckets = [...cells.entries()]
      .sort((a, b) => {
        const ha = deterministicHash(`${zoneSalt}|cell|${a[0]}`);
        const hb = deterministicHash(`${zoneSalt}|cell|${b[0]}`);
        return ha < hb ? -1 : ha > hb ? 1 : 0;
      })
      .map(([, bucket]) => bucket);

    let kept = 0;
    let round = 0;
    while (kept < targetCount) {
      let progressed = false;
      for (const bucket of orderedBuckets) {
        if (round < bucket.length) {
          keptIndices.add(bucket[round].idx);
          kept++;
          progressed = true;
          if (kept >= targetCount) break;
        }
      }
      if (!progressed) break;
      round++;
    }

    stats.push({
      zoneIndex: zi,
      radiusKm: rKm,
      ringCount,
      inZoneCount: inZone.length,
      targetCount,
      keptCount: kept
    });
  }

  return { keptIndices, stats };
}
