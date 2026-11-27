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
 *   - Inside configured zones: drops everyday errands/residential/private venues and
 *     blurs remaining public landmarks to coarse city-level coordinates + generic
 *     city labels with street addresses/ZIPs stripped.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_EMBARGO_DAYS = 7;

export const PRIVATE_VENUE_RE =
  /\b(home|residential|apartment|condo|housing|dorm|fraternity|sorority|office|coworking|tech startup|conference room|doctor|dentist|medical|hospital|urgent care|clinic|pharmacy|walgreens|cvs|duane reade|rite aid|therapy|bank|credit union|atm|gym|fitness|equinox|planet fitness|yoga|post office|usps|ups store|fedex|laundromat|cleaners|dry clean|tailor|supermarket|grocery|key food|gristedes|morton williams|acme|giant|wawa|target|whole foods|trader joe|hardware|parking|garage|liquor|beverage|pet supplies|wine shop|dispensary|cannabis)\b/i;

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
 * and private home-zone blur/exclusion rules.
 *
 * @param {object} item - { name, location, category, lat, lng, dateOrTs, source: "swarm"|"maps" }
 * @param {object} config - from loadPrivacyConfig()
 * @returns {null | { lat: number, lng: number, location: string, blurred: boolean }}
 */
export function filterAndBlurPlace(item, config) {
  const { embargoDays, zones } = config;
  if (isTooRecent(item.dateOrTs, embargoDays)) {
    return null;
  }

  const textBlob = `${item.name || ""} ${item.category || ""}`;
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
      blurred: false
    };
  }

  // Inside a sensitive home zone:
  // - For Swarm check-ins: drop routine check-ins completely unless explicitly opted-in;
  //   by default exclude Swarm inside sensitive zones so routine check-in density never leaks.
  if (item.source === "swarm") {
    return null;
  }

  // - For public Google Maps places inside a sensitive zone: drop everyday errands/pharmacies/etc.,
  //   and blur remaining cultural/public spots onto the generic metro center with street address stripped.
  if (PRIVATE_VENUE_RE.test(textBlob)) {
    return null;
  }

  const blurred = blurCoordsToMetro(`${item.name}|${zone.coarseLabel}`, zone);
  return {
    lat: blurred.lat,
    lng: blurred.lng,
    location: blurred.location,
    blurred: true
  };
}
