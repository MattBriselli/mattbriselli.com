(() => {
  const metaScheme = document.querySelector('meta[name="color-scheme"]');
  const themeToggle = document.getElementById("theme-toggle");
  const printBtn = document.getElementById("print-resume-btn");
  const yearEl = document.getElementById("current-year");
  const darkMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function getSystemScheme() {
    return darkMediaQuery.matches ? "dark" : "light";
  }

  function getStoredScheme() {
    try {
      const val = localStorage.getItem("color-scheme");
      return val === "light" || val === "dark" ? val : null;
    } catch {
      return null;
    }
  }

  function isDarkActive() {
    if (metaScheme && metaScheme.content === "dark") return true;
    if (metaScheme && metaScheme.content === "light") return false;
    const stored = getStoredScheme();
    if (stored) return stored === "dark";
    return darkMediaQuery.matches;
  }

  function applyMetaScheme(scheme) {
    if (metaScheme) {
      metaScheme.content = scheme ?? "light dark";
    }
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const systemScheme = getSystemScheme();
      const currentScheme =
        metaScheme && (metaScheme.content === "light" || metaScheme.content === "dark")
          ? metaScheme.content
          : getStoredScheme() ?? systemScheme;

      const targetScheme = currentScheme === "dark" ? "light" : "dark";

      if (targetScheme !== systemScheme) {
        try {
          localStorage.setItem("color-scheme", targetScheme);
        } catch {}
        applyMetaScheme(targetScheme);
      } else {
        try {
          localStorage.removeItem("color-scheme");
        } catch {}
        applyMetaScheme(null);
      }
      syncMapTheme();
    });
  }

  darkMediaQuery.addEventListener("change", () => {
    syncMapTheme();
  });

  window.addEventListener("storage", (event) => {
    if (event.key === "color-scheme") {
      const newVal =
        event.newValue === "light" || event.newValue === "dark" ? event.newValue : null;
      applyMetaScheme(newVal);
      syncMapTheme();
    }
  });

  if (printBtn) {
    printBtn.addEventListener("click", () => {
      window.print();
    });
  }

  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  /* ==========================================================================
     Scrollspy + Non-Sticky URL Hash Sync & Reload Section Persistence
     ========================================================================== */
  const TRACKED_SECTION_IDS = ["explorer", "coder", "eclectic", "contact"];
  const SCROLL_STATE_KEY = "mlb_section_scroll_v1";
  const supportsScrollTargetGroup =
    typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("scroll-target-group: auto");
  const navLinks = Array.from(document.querySelectorAll(".site-header .nav-list a[href^='#']"));
  const siteBrandLink = document.querySelector(".site-brand");
  const navEntry = performance.getEntriesByType?.("navigation")?.[0];
  const isPageReload = navEntry?.type === "reload";

  let savedScrollState = null;
  try {
    const rawSaved = sessionStorage.getItem(SCROLL_STATE_KEY);
    if (rawSaved) savedScrollState = JSON.parse(rawSaved);
  } catch {}

  let userInteractedSinceLoad = false;
  let isRestoringScroll = false;
  let initialRestoreWindowUntil = isPageReload && savedScrollState ? performance.now() + 1200 : 0;
  let navScrollLockUntil = 0;
  let activeTrackedSection = null;

  function getHeaderOffset() {
    const hdr = document.querySelector(".site-header");
    return (hdr ? hdr.offsetHeight : 58) + 12;
  }

  function computeActiveSectionId() {
    const firstEl = document.getElementById(TRACKED_SECTION_IDS[0]);
    if (!firstEl) return "";
    const probeY = getHeaderOffset() + Math.min(180, window.innerHeight * 0.26);
    if (firstEl.getBoundingClientRect().top > probeY) {
      return "";
    }
    const atPageBottom =
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 40;
    if (atPageBottom) {
      const contactEl = document.getElementById("contact");
      if (contactEl && contactEl.getBoundingClientRect().top < window.innerHeight * 0.8) {
        return "contact";
      }
    }
    let current = "";
    for (const id of TRACKED_SECTION_IDS) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= probeY) {
        current = id;
      }
    }
    return current;
  }

  function persistSectionScrollState(sectionId) {
    try {
      const el = sectionId ? document.getElementById(sectionId) : null;
      const secTop = el ? el.getBoundingClientRect().top + window.scrollY : 0;
      sessionStorage.setItem(
        SCROLL_STATE_KEY,
        JSON.stringify({
          sectionId,
          offsetInSection: el ? Math.round(window.scrollY - secTop) : 0,
          scrollY: Math.round(window.scrollY)
        })
      );
    } catch {}
  }

  function syncNavAndHash(sectionId, updateHistoryHash) {
    const nativeCurrentLink = supportsScrollTargetGroup
      ? document.querySelector(".site-header .nav-list a:target-current")
      : null;

    for (const link of navLinks) {
      const isMatch =
        supportsScrollTargetGroup && nativeCurrentLink && sectionId
          ? link === nativeCurrentLink
          : Boolean(sectionId) && link.getAttribute("href") === `#${sectionId}`;
      if (!supportsScrollTargetGroup) {
        link.classList.toggle("target-current", isMatch);
      }
      link.setAttribute("aria-current", isMatch ? "true" : "false");
    }

    if (updateHistoryHash) {
      const desiredHash = sectionId ? `#${sectionId}` : "";
      if (window.location.hash !== desiredHash) {
        const cleanBase = `${window.location.pathname}${window.location.search}`;
        try {
          history.replaceState(null, "", desiredHash || cleanBase);
        } catch {}
      }
    }
  }

  function restoreReloadSectionPosition() {
    if (!isPageReload || !savedScrollState || userInteractedSinceLoad) return;
    if (performance.now() > initialRestoreWindowUntil) return;
    const { sectionId, offsetInSection, scrollY } = savedScrollState;
    isRestoringScroll = true;
    if (!sectionId) {
      window.scrollTo({ top: Math.max(0, scrollY || 0), behavior: "instant" });
      syncNavAndHash("", true);
    } else {
      const secEl = document.getElementById(sectionId);
      if (secEl) {
        const secTop = secEl.getBoundingClientRect().top + window.scrollY;
        const maxOffset = Math.max(0, secEl.offsetHeight - 100);
        const clampedOffset = Math.min(Math.max(-getHeaderOffset(), offsetInSection || 0), maxOffset);
        window.scrollTo({ top: Math.max(0, secTop + clampedOffset), behavior: "instant" });
        syncNavAndHash(sectionId, true);
      }
    }
    requestAnimationFrame(() => {
      isRestoringScroll = false;
    });
  }

  if (isPageReload && savedScrollState) {
    try {
      if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    } catch {}
    restoreReloadSectionPosition();
  } else {
    activeTrackedSection = computeActiveSectionId();
    syncNavAndHash(activeTrackedSection, false);
  }

  requestAnimationFrame(() => {
    delete document.documentElement.dataset.reloading;
  });

  const markUserScrollIntent = () => {
    userInteractedSinceLoad = true;
    initialRestoreWindowUntil = 0;
    navScrollLockUntil = 0;
  };
  window.addEventListener("wheel", markUserScrollIntent, { passive: true });
  window.addEventListener("touchstart", markUserScrollIntent, { passive: true });
  window.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) {
      markUserScrollIntent();
    }
  });

  for (const link of navLinks) {
    link.addEventListener("click", () => {
      userInteractedSinceLoad = true;
      initialRestoreWindowUntil = 0;
      const targetId = (link.getAttribute("href") || "").replace(/^#/, "");
      if (!targetId) return;
      navScrollLockUntil = performance.now() + 900;
      activeTrackedSection = targetId;
      syncNavAndHash(targetId, true);
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        const secTop = targetEl.getBoundingClientRect().top + window.scrollY;
        try {
          sessionStorage.setItem(
            SCROLL_STATE_KEY,
            JSON.stringify({
              sectionId: targetId,
              offsetInSection: -getHeaderOffset(),
              scrollY: Math.max(0, Math.round(secTop - getHeaderOffset()))
            })
          );
        } catch {}
      }
    });
  }

  if (siteBrandLink) {
    siteBrandLink.addEventListener("click", (e) => {
      e.preventDefault();
      userInteractedSinceLoad = true;
      initialRestoreWindowUntil = 0;
      navScrollLockUntil = performance.now() + 900;
      activeTrackedSection = "";
      syncNavAndHash("", true);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" });
      try {
        sessionStorage.setItem(
          SCROLL_STATE_KEY,
          JSON.stringify({ sectionId: "", offsetInSection: 0, scrollY: 0 })
        );
      } catch {}
    });
  }

  let scrollTicking = false;
  function handleViewportScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      scrollTicking = false;
      if (isRestoringScroll || performance.now() < initialRestoreWindowUntil) return;
      if (performance.now() < navScrollLockUntil) return;
      const nextSection = computeActiveSectionId();
      if (nextSection !== activeTrackedSection) {
        activeTrackedSection = nextSection;
        syncNavAndHash(nextSection, true);
      }
      persistSectionScrollState(nextSection);
    });
  }

  window.addEventListener("scroll", handleViewportScroll, { passive: true });
  document.addEventListener("scrollend", () => {
    if (isRestoringScroll || performance.now() < initialRestoreWindowUntil) return;
    navScrollLockUntil = 0;
    const settledSection = computeActiveSectionId();
    activeTrackedSection = settledSection;
    syncNavAndHash(settledSection, true);
    persistSectionScrollState(settledSection);
  });
  window.addEventListener("pagehide", () => {
    if (performance.now() >= navScrollLockUntil) {
      const finalSection = computeActiveSectionId();
      persistSectionScrollState(finalSection);
    }
    try {
      if ("scrollRestoration" in history) history.scrollRestoration = "auto";
    } catch {}
  });
  window.addEventListener("load", () => {
    restoreReloadSectionPosition();
  });

  /* ==========================================================================
     Multi-Lens Leaflet Atlas (CARTO @2x Retina Basemaps + Photo Thumbnail
     Stacks + Glowing Flighty Great-Circle Routes + 39-Country / 50-State /
     13-Canadian-Province Vector Choropleth)
     ========================================================================== */
  const mapContainer = document.getElementById("leaflet-world-map");
  if (!mapContainer || typeof window.L === "undefined") return;
  const statusLineEl = document.getElementById("map-status-line");

  // Roving tabindex fallback for role="toolbar" [focusgroup] where native focusgroup is unsupported
  if (!("focusGroup" in HTMLElement.prototype)) {
    document.querySelectorAll('[role="toolbar"][focusgroup]').forEach((bar) => {
      const items = Array.from(bar.querySelectorAll("button"));
      if (!items.length) return;
      items.forEach((b, i) => {
        b.tabIndex = i === 0 ? 0 : -1;
      });
      bar.addEventListener("focusin", ({ target }) => {
        if (items.includes(target)) {
          items.forEach((b) => {
            b.tabIndex = b === target ? 0 : -1;
          });
        }
      });
      bar.addEventListener("keydown", (e) => {
        const curIdx = items.indexOf(document.activeElement);
        if (curIdx === -1) return;
        const vertical = bar.getAttribute("aria-orientation") === "vertical";
        const rtl = getComputedStyle(bar).direction === "rtl";
        const steps = vertical
          ? { ArrowDown: 1, ArrowUp: -1 }
          : { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };
        let nextIdx = null;
        if (e.key in steps) {
          nextIdx = (curIdx + steps[e.key] + items.length) % items.length;
        } else if (e.key === "Home") {
          nextIdx = 0;
        } else if (e.key === "End") {
          nextIdx = items.length - 1;
        }
        if (nextIdx !== null) {
          e.preventDefault();
          items[nextIdx].focus();
        }
      });
    });
  }

  function escMapHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const REGION_PRESETS = {
    world: { lat: 25, lng: -12, zoom: 2, label: "Whole World (39 Countries · All 50 US States · 66,085 Photos)" },
    nyc: { lat: 40.758, lng: -73.98, zoom: 12, label: "New York City, Broadway & Five-Borough Dispatches" },
    west: { lat: 41.8, lng: -122.3, zoom: 5, label: "San Francisco (6 yrs), Seattle & West Coast" },
    us50: { lat: 39.5, lng: -98.5, zoom: 4, label: "All 50 US States Visited" },
    "central-asia": { lat: 42.2, lng: 67.5, zoom: 5, label: "Central Asia (Kazakhstan · Kyrgyzstan · Uzbekistan · Tajikistan · Turkmenistan)" },
    canada: { lat: 53.5, lng: -96.5, zoom: 4, label: "8/13 Canadian Provinces & Territories + Disjoint Trans-Canada Drive" },
    "europe-apac": { lat: 34.0, lng: 55.0, zoom: 3, label: "Europe & Asia-Pacific Across 39 Countries Visited" }
  };

  let mapsData = null;
  let allRawPlaces = [];
  let mapOnlyPins = [];
  let currentSlideFilter = "all";
  let flightyData = null;
  let filteredPlaces = [];
  let activePlaceIndex = 0;
  let activePhotoIndex = 0;
  let autoPlayTimer = null;
  let viewportSyncTimer = null;

  // Focused Map Lenses: "photos" | "flights" | "atlas" | "all" | "static"
  let activeLens = "photos";

  const map = L.map(mapContainer, {
    center: [REGION_PRESETS.world.lat, REGION_PRESETS.world.lng],
    zoom: REGION_PRESETS.world.zoom,
    minZoom: 2,
    maxZoom: 17,
    zoomControl: false,
    attributionControl: false,
    worldCopyJump: true
  });
  const pinsCanvasRenderer = L.canvas({ padding: 0.5 });

  let baseTileLayer = null;
  let labelTileLayer = null;
  let currentBaseUrl = "";
  let currentLabelUrl = "";
  let countriesLayer = null;
  let statesLayer = null;
  let canadaProvincesLayer = null;
  const flightArcsLayerGroup = L.layerGroup().addTo(map);
  const canadaDriveLayerGroup = L.layerGroup().addTo(map);
  const pinsLayerGroup = L.layerGroup().addTo(map);

  function lensShowsPhotos() {
    return activeLens === "photos" || activeLens === "all";
  }
  function lensShowsFlights() {
    return activeLens === "flights" || activeLens === "all";
  }
  function lensShowsCanadaDrive() {
    return activeLens === "atlas" || activeLens === "all";
  }
  function lensIsChoroplethFocus() {
    return activeLens === "atlas";
  }

  // Compute spherical 3D great-circle points between two (lat, lng) pairs, splitting cleanly across the ±180° antimeridian
  function buildGreatCircleSegments(lat1, lng1, lat2, lng2, steps = 36) {
    const toRad = (d) => (d * Math.PI) / 180;
    const toDeg = (r) => (r * 180) / Math.PI;
    const p1 = toRad(lat1), l1 = toRad(lng1);
    const p2 = toRad(lat2), l2 = toRad(lng2);

    const v1 = [Math.cos(p1) * Math.cos(l1), Math.cos(p1) * Math.sin(l1), Math.sin(p1)];
    const v2 = [Math.cos(p2) * Math.cos(l2), Math.cos(p2) * Math.sin(l2), Math.sin(p2)];
    const dot = Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
    const omega = Math.acos(dot);
    if (omega < 1e-5) return [[[lat1, lng1], [lat2, lng2]]];

    const sinOmega = Math.sin(omega);
    const rawPts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = Math.sin((1 - t) * omega) / sinOmega;
      const b = Math.sin(t * omega) / sinOmega;
      const x = a * v1[0] + b * v2[0];
      const y = a * v1[1] + b * v2[1];
      const z = a * v1[2] + b * v2[2];
      const lat = toDeg(Math.atan2(z, Math.hypot(x, y)));
      const lng = toDeg(Math.atan2(y, x));
      rawPts.push([lat, lng]);
    }

    const segments = [[]];
    for (let i = 0; i < rawPts.length; i++) {
      const cur = rawPts[i];
      const seg = segments[segments.length - 1];
      if (seg.length > 0) {
        const prev = seg[seg.length - 1];
        if (Math.abs(cur[1] - prev[1]) > 180) {
          // Interpolate exact crossing latitude at ±180° meridian
          const prevLng = prev[1];
          const curLng = cur[1] + (cur[1] < prevLng ? 360 : -360);
          const boundary = prevLng > 0 ? 180 : -180;
          const frac = (boundary - prevLng) / (curLng - prevLng);
          const crossLat = prev[0] + frac * (cur[0] - prev[0]);
          seg.push([crossLat, boundary]);
          segments.push([[crossLat, -boundary], cur]);
          continue;
        }
      }
      seg.push(cur);
    }
    return segments.filter((s) => s.length >= 2);
  }

  function rebuildFlightArcs() {
    flightArcsLayerGroup.clearLayers();
    if (!lensShowsFlights() || !flightyData) return;

    const dark = isDarkActive();
    const zoom = map.getZoom();
    const airportByCode = new Map(
      (flightyData.airports || []).map((a) => [a.code, a])
    );

    const sortedRoutes = (flightyData.routes || []).slice().sort((a, b) => a.count - b.count);

    // 1. Dual-pass glowing great-circle Flighty trajectories
    for (const r of sortedRoutes) {
      const a1 = airportByCode.get(r.from);
      const a2 = airportByCode.get(r.to);
      if (!a1 || !a2) continue;
      const segments = buildGreatCircleSegments(a1.lat, a1.lng, a2.lat, a2.lng, 38);
      const weight = Math.min(3.6, 1.3 + Math.log2(r.count) * 0.72);
      const opacity = Math.min(0.92, 0.46 + Math.log2(r.count) * 0.16);
      const isTrunk = r.count >= 6;
      const stroke = isTrunk
        ? (dark ? "#46e5a0" : "#136840")
        : r.count >= 2
          ? (dark ? "#68ca98" : "#1f6b45")
          : (dark ? "#e8a85a" : "#b85d27");
      const glowColor = isTrunk
        ? (dark ? "#3dd68c" : "#1f6b45")
        : (dark ? "#5ec28f" : "#2f855a");
      const label = `<strong>✈️ ${escMapHtml(r.from)} ↔ ${escMapHtml(r.to)}</strong><br>${escMapHtml(a1.city)} ↔ ${escMapHtml(a2.city)}<br>${r.count} ${r.count === 1 ? "flight" : "flights"} · ${formatNumber(r.miles)} mi`;

      for (const seg of segments) {
        L.polyline(seg, {
          color: glowColor,
          weight: weight + 4,
          opacity: dark ? 0.16 : 0.12,
          interactive: false,
          smoothFactor: 1.2
        }).addTo(flightArcsLayerGroup);

        const line = L.polyline(seg, {
          color: stroke,
          weight,
          opacity,
          smoothFactor: 1.2
        });
        line.bindTooltip(label, { sticky: true, direction: "top" });
        line.addTo(flightArcsLayerGroup);
      }
    }

    // 2. Airport hub nodes + IATA code badges on top hubs
    for (const ap of flightyData.airports || []) {
      const isMajorHub = ap.visits >= 10 || (zoom >= 4 && ap.visits >= 5);
      const dot = L.circleMarker([ap.lat, ap.lng], {
        radius: Math.min(6.2, 2.5 + Math.log2(ap.visits + 1) * 0.62),
        color: dark ? "#111110" : "#ffffff",
        weight: 1.25,
        fillColor: ap.visits >= 6 ? (dark ? "#46e5a0" : "#136840") : (dark ? "#e8a85a" : "#b85d27"),
        fillOpacity: 0.95
      });
      dot.bindTooltip(
        `<strong>✈️ ${escMapHtml(ap.code)}</strong> · ${escMapHtml(ap.city)}<br>${ap.visits} ${ap.visits === 1 ? "flight leg" : "flight legs"}`,
        { direction: "top" }
      );
      dot.addTo(flightArcsLayerGroup);

      if (isMajorHub && activeLens === "flights") {
        const badge = L.marker([ap.lat, ap.lng], {
          interactive: false,
          icon: L.divIcon({
            className: "hub-label-wrapper",
            html: `<span class="airport-hub-tag">${escMapHtml(ap.code)}</span>`,
            iconSize: [34, 16],
            iconAnchor: [-6, 8]
          })
        });
        badge.addTo(flightArcsLayerGroup);
      }
    }
  }

  function shuffleArray(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // Disjoint Cross-Canada Road Quest Segments (Driven vs. Remaining)
  const CANADA_DRIVE_SEGMENTS = [
    {
      driven: true,
      title: "✓ Driven: Halifax, NS → Thunder Bay, ON",
      note: "Atlantic coast across Nova Scotia, New Brunswick, Québec & Ontario to Lake Superior",
      coords: [
        [44.6488, -63.5752], // Halifax, NS
        [45.3686, -63.2662], // Truro, NS
        [46.0878, -64.7782], // Moncton, NB
        [45.9636, -66.6431], // Fredericton, NB
        [47.3623, -68.3251], // Edmundston, NB
        [47.8360, -69.5342], // Rivière-du-Loup, QC
        [46.8139, -71.2080], // Québec City, QC
        [45.5017, -73.5673], // Montréal, QC
        [45.4215, -75.6972], // Ottawa, ON
        [46.3091, -79.4608], // North Bay, ON
        [46.4917, -80.9930], // Sudbury, ON
        [46.5219, -84.3461], // Sault Ste. Marie, ON
        [47.9947, -84.7700], // Wawa, ON
        [48.7019, -86.3822], // Marathon, ON
        [48.9950, -88.2610], // Nipigon, ON
        [48.3809, -89.2477]  // Thunder Bay, ON
      ]
    },
    {
      driven: true,
      title: "✓ Driven: Calgary ↔ Banff ↔ Jasper ↔ Edmonton",
      note: "Alberta Rockies, Icefields Parkway & Queen Elizabeth II Hwy corridor",
      coords: [
        [51.0447, -114.0719], // Calgary, AB
        [51.1784, -115.5708], // Banff, AB
        [51.4254, -116.1773], // Lake Louise, AB
        [52.8737, -118.0814], // Jasper, AB
        [53.5461, -113.4938], // Edmonton, AB
        [52.2681, -113.8112], // Red Deer, AB
        [51.0447, -114.0719]  // Calgary, AB
      ]
    },
    {
      driven: false,
      title: "○ Future Link: Thunder Bay, ON → Winnipeg → Regina → Calgary",
      note: "Prairies Trans-Canada gap across Manitoba & Saskatchewan",
      coords: [
        [48.3809, -89.2477],  // Thunder Bay, ON
        [49.7670, -94.4894],  // Kenora, ON
        [49.8951, -97.1384],  // Winnipeg, MB
        [50.4452, -104.6189], // Regina, SK
        [50.0405, -110.6764], // Medicine Hat, AB
        [51.0447, -114.0719]  // Calgary, AB
      ]
    },
    {
      driven: false,
      title: "○ Future Link: Jasper, AB → Kamloops → Vancouver / Victoria, BC",
      note: "Yellowhead / Trans-Canada Rockies-to-Pacific gap",
      coords: [
        [52.8737, -118.0814], // Jasper, AB
        [50.6745, -120.3273], // Kamloops, BC
        [49.2827, -123.1207], // Vancouver, BC
        [48.4284, -123.3656]  // Victoria, BC
      ]
    }
  ];

  function rebuildCanadaDrive() {
    canadaDriveLayerGroup.clearLayers();
    if (!lensShowsCanadaDrive()) return;
    const dark = isDarkActive();
    const drivenColor = dark ? "#6ea8fe" : "#1d4ed8";
    const gapColor = dark ? "#9aa5b5" : "#5b6778";

    for (const seg of CANADA_DRIVE_SEGMENTS) {
      if (seg.driven) {
        L.polyline(seg.coords, {
          color: drivenColor,
          weight: 7,
          opacity: 0.18,
          interactive: false,
          smoothFactor: 1.1
        }).addTo(canadaDriveLayerGroup);
      }
      const poly = L.polyline(seg.coords, {
        color: seg.driven ? drivenColor : gapColor,
        weight: seg.driven ? 3.6 : 2.0,
        opacity: seg.driven ? 0.95 : 0.65,
        dashArray: seg.driven ? null : "5,6",
        smoothFactor: 1.1
      });
      poly.bindTooltip(`<strong>${escMapHtml(seg.title)}</strong><br>${escMapHtml(seg.note)}`, {
        sticky: true,
        direction: "top"
      });
      poly.addTo(canadaDriveLayerGroup);
    }

    const endpoints = [
      { name: "Halifax, NS (Driven East Terminus)", lat: 44.6488, lng: -63.5752 },
      { name: "Thunder Bay, ON (Driven West Terminus)", lat: 48.3809, lng: -89.2477 },
      { name: "Calgary, AB", lat: 51.0447, lng: -114.0719 },
      { name: "Edmonton, AB", lat: 53.5461, lng: -113.4938 },
      { name: "Jasper, AB", lat: 52.8737, lng: -118.0814 }
    ];
    for (const ep of endpoints) {
      const dot = L.circleMarker([ep.lat, ep.lng], {
        radius: 4.8,
        color: dark ? "#111110" : "#ffffff",
        weight: 1.6,
        fillColor: drivenColor,
        fillOpacity: 0.96
      });
      dot.bindTooltip(`<strong>🚗 ${escMapHtml(ep.name)}</strong>`, { direction: "top" });
      dot.addTo(canadaDriveLayerGroup);
    }
  }

  // Region + Era stratified interleave so consecutive slides rotate across continents AND years
  function buildBalancedDeck(items) {
    const buckets = new Map();
    for (const item of items) {
      const year = item.date ? item.date.slice(0, 4) : "classic";
      const geo =
        item.region === "international" || item.region === "central-asia"
          ? "intl"
          : item.region === "canada"
            ? "canada"
            : item.region === "west-coast"
              ? "west"
              : item.tag === "nyc"
                ? `nyc-${year >= "2026" ? "recent" : "archive"}`
                : "us";
      const key = `${geo}|${year >= "2025" ? "recent" : "archive"}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    }
    const queues = shuffleArray([...buckets.values()]).map((group) => shuffleArray(group));
    const result = [];
    let added = true;
    while (added) {
      added = false;
      for (const q of queues) {
        if (q.length) {
          result.push(q.shift());
          added = true;
        }
      }
    }
    return result;
  }

  function getCountryStyle(feature) {
    const dark = isDarkActive();
    const visited = Boolean(feature?.properties?.visited);
    const name = feature?.properties?.name || "";
    // Let US & Canada sub-national layers handle detailed province/state coloring in Atlas mode
    const isSubnationalHost = name === "United States of America" || name === "United States" || name === "Canada";
    if (lensIsChoroplethFocus()) {
      if (isSubnationalHost) {
        return {
          fillColor: "transparent",
          fillOpacity: 0,
          color: dark ? "#6e5a4b" : "#9e3b24",
          weight: 1.1
        };
      }
      return {
        fillColor: visited ? (dark ? "#e88264" : "#cf5636") : "transparent",
        fillOpacity: visited ? (dark ? 0.36 : 0.38) : 0,
        color: visited ? (dark ? "#f29d82" : "#9e3b24") : (dark ? "#2e2c28" : "#d8d2c7"),
        weight: visited ? 1.25 : 0.45
      };
    }
    const subtleAlpha = activeLens === "flights" ? 0.07 : 0.14;
    return {
      fillColor: visited && !isSubnationalHost ? (dark ? "#e88264" : "#c85a38") : "transparent",
      fillOpacity: visited && !isSubnationalHost ? subtleAlpha : 0,
      color: visited ? (dark ? "#58463a" : "#b99984") : "transparent",
      weight: visited ? 0.8 : 0
    };
  }

  function getStateStyle() {
    const dark = isDarkActive();
    if (lensIsChoroplethFocus()) {
      return {
        fillColor: dark ? "#e88264" : "#cf5636",
        fillOpacity: dark ? 0.35 : 0.36,
        color: dark ? "#f29d82" : "#9e3b24",
        weight: 0.95
      };
    }
    const subtleAlpha = activeLens === "flights" ? 0.05 : 0.11;
    return {
      fillColor: dark ? "#e88264" : "#c85a38",
      fillOpacity: subtleAlpha,
      color: dark ? "#4a3d33" : "#c4ab99",
      weight: 0.55,
      dashArray: "2,2"
    };
  }

  function getCanadaProvinceStyle(feature) {
    const dark = isDarkActive();
    const visited = Boolean(feature?.properties?.visited);
    if (lensIsChoroplethFocus()) {
      return {
        fillColor: visited ? (dark ? "#f0ad4e" : "#d9822b") : (dark ? "#252422" : "#eae4da"),
        fillOpacity: visited ? (dark ? 0.42 : 0.44) : 0.18,
        color: visited ? (dark ? "#f6c173" : "#9a5412") : (dark ? "#55514a" : "#9f988c"),
        weight: visited ? 1.2 : 0.85,
        dashArray: visited ? null : "4,4"
      };
    }
    const subtleAlpha = activeLens === "flights" ? 0.05 : 0.12;
    return {
      fillColor: visited ? (dark ? "#f0ad4e" : "#d9822b") : "transparent",
      fillOpacity: visited ? subtleAlpha : 0,
      color: visited ? (dark ? "#5c4d38" : "#bfa382") : "transparent",
      weight: visited ? 0.65 : 0
    };
  }

  function updateTileLayer() {
    const dark = isDarkActive();
    // 100% keyless Esri ArcGIS MapServer tiles (verified with production Referer, zero API key)
    const useMinimalGray = dark || activeLens === "flights" || activeLens === "atlas";
    const baseUrl = dark
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
      : useMinimalGray
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}";

    const labelUrl = dark
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
      : useMinimalGray
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
        : "";

    if (baseTileLayer) {
      if (currentBaseUrl !== baseUrl) {
        baseTileLayer.setUrl(baseUrl);
        currentBaseUrl = baseUrl;
      }
    } else {
      currentBaseUrl = baseUrl;
      baseTileLayer = L.tileLayer(baseUrl, {
        maxZoom: 18,
        opacity: 1
      }).addTo(map);
      baseTileLayer.bringToBack();
    }

    if (labelUrl) {
      if (labelTileLayer) {
        if (currentLabelUrl !== labelUrl) {
          labelTileLayer.setUrl(labelUrl);
          currentLabelUrl = labelUrl;
        }
      } else {
        currentLabelUrl = labelUrl;
        labelTileLayer = L.tileLayer(labelUrl, {
          maxZoom: 18,
          opacity: 0.92,
          interactive: false
        }).addTo(map);
      }
    } else if (labelTileLayer) {
      map.removeLayer(labelTileLayer);
      labelTileLayer = null;
      currentLabelUrl = "";
    }
  }

  function updateLegendForLens() {
    const legendEl = document.getElementById("map-legend");
    const vpWrapEl = document.getElementById("viewport-strip-wrap");
    if (vpWrapEl) {
      vpWrapEl.hidden = !lensShowsPhotos();
    }
    if (!legendEl) return;
    legendEl.hidden = activeLens === "static";
    const totalDispatches = allRawPlaces.length || 348;
    const extraReviewedDots = mapOnlyPins.length + (mapsData?.heatmapClusters?.length || 0);
    const totalDots = totalDispatches + extraReviewedDots;
    if (activeLens === "photos") {
      legendEl.innerHTML = [
        `<span class="legend-item"><span class="legend-swatch swatch-pin" aria-hidden="true"></span> Active Slideshow Pin</span>`,
        `<span class="legend-item"><span class="legend-swatch swatch-hot" aria-hidden="true"></span> ${formatNumber(totalDispatches)} Photo Pins</span>`,
        `<span class="legend-item"><span class="legend-swatch swatch-warm" aria-hidden="true"></span> ${formatNumber(extraReviewedDots)} Additional Place Pins (${formatNumber(totalDots)} Total)</span>`
      ].join("");
    } else if (activeLens === "flights") {
      legendEl.innerHTML = [
        `<span class="legend-item"><span class="legend-swatch swatch-pin" aria-hidden="true"></span> Trunk Flight Corridors (6+ legs)</span>`,
        `<span class="legend-item"><span class="legend-swatch swatch-warm" aria-hidden="true"></span> Regional &amp; Long-Haul Routes (314,804 mi · 83 Airports)</span>`
      ].join("");
    } else if (activeLens === "atlas") {
      legendEl.innerHTML = [
        `<span class="legend-item"><span class="legend-swatch swatch-hot" aria-hidden="true"></span> 39 Countries &amp; All 50 US States</span>`,
        `<span class="legend-item"><span class="legend-swatch swatch-warm" aria-hidden="true"></span> 8/13 Canadian Provinces &amp; Territories</span>`,
        `<span class="legend-item"><span class="legend-swatch swatch-drive" aria-hidden="true"></span> Disjoint Trans-Canada Drive</span>`
      ].join("");
    } else {
      legendEl.innerHTML = [
        `<span class="legend-item"><span class="legend-swatch swatch-hot" aria-hidden="true"></span> ${formatNumber(totalDots)} Photo &amp; Region Dots</span>`,
        `<span class="legend-item"><span class="legend-swatch swatch-pin" aria-hidden="true"></span> 173 Flights (315k mi)</span>`,
        `<span class="legend-item"><span class="legend-swatch swatch-warm" aria-hidden="true"></span> 39 Countries · 50 States · 8/13 Canada</span>`,
        `<span class="legend-item"><span class="legend-swatch swatch-drive" aria-hidden="true"></span> Canada Drive</span>`
      ].join("");
    }
  }

  function syncMapTheme() {
    const dark = isDarkActive();
    mapContainer.style.backgroundColor = dark ? "#121211" : "#eae6df";
    updateTileLayer();
    if (countriesLayer) countriesLayer.setStyle(getCountryStyle);
    if (statesLayer) statesLayer.setStyle(getStateStyle);
    if (canadaProvincesLayer) canadaProvincesLayer.setStyle(getCanadaProvinceStyle);
    rebuildFlightArcs();
    rebuildCanadaDrive();
    rebuildMarkers();
    updateLegendForLens();
  }

  // Load crisp local Natural Earth Countries + 50 US States + 13 Canadian Provinces GeoJSON
  Promise.all([
    fetch("data/world-countries.json").then((r) => r.json()).catch(() => null),
    fetch("data/us-states.json").then((r) => r.json()).catch(() => null),
    fetch("data/canada-provinces.json").then((r) => r.json()).catch(() => null)
  ]).then(([countriesGeo, statesGeo, canadaGeo]) => {
    if (countriesGeo) {
      countriesLayer = L.geoJSON(countriesGeo, {
        style: getCountryStyle,
        onEachFeature: (feature, layer) => {
          const nm = feature.properties?.name;
          if (nm && nm !== "United States of America" && nm !== "Canada") {
            const status = feature.properties.visited
              ? "✓ Visited &amp; Photographed (39/199 Quest)"
              : "Not yet visited";
            layer.bindTooltip(`<strong>${escMapHtml(nm)}</strong><br>${status}`, {
              sticky: true,
              direction: "top"
            });
          }
        }
      }).addTo(map);
    }
    if (statesGeo) {
      statesLayer = L.geoJSON(statesGeo, {
        style: getStateStyle,
        onEachFeature: (feature, layer) => {
          if (feature.properties?.name) {
            layer.bindTooltip(
              `<strong>${escMapHtml(feature.properties.name)}</strong><br>✓ All 50 US States Visited`,
              { sticky: true, direction: "top" }
            );
          }
        }
      }).addTo(map);
    }
    if (canadaGeo) {
      canadaProvincesLayer = L.geoJSON(canadaGeo, {
        style: getCanadaProvinceStyle,
        onEachFeature: (feature, layer) => {
          if (feature.properties?.name) {
            const code = feature.properties.code ? ` (${feature.properties.code})` : "";
            const status = feature.properties.visited
              ? "✓ Visited (8/13 Canadian Provinces &amp; Territories)"
              : "○ Remaining Quest Target (5 left for 13/13)";
            layer.bindTooltip(
              `<strong>${escMapHtml(feature.properties.name + code)}</strong><br>${status}`,
              { sticky: true, direction: "top" }
            );
          }
        }
      }).addTo(map);
    }
    syncMapTheme();
  });

  function stopAutoPlay() {
    if (!autoPlayTimer) return;
    clearInterval(autoPlayTimer);
    autoPlayTimer = null;
    const btn = document.getElementById("slide-autoplay-btn");
    if (btn) {
      btn.setAttribute("aria-pressed", "false");
    }
  }

  map.on("dragstart", stopAutoPlay);
  mapContainer.addEventListener("wheel", stopAutoPlay, { passive: true });

  function getPlacesInCurrentViewport() {
    if (!filteredPlaces.length) return [];
    const bounds = map.getBounds();
    const center = map.getCenter();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const lngSpan = ne.lng - sw.lng;
    const cosLat = Math.cos((center.lat * Math.PI) / 180);

    const matches = [];
    for (let idx = 0; idx < filteredPlaces.length; idx++) {
      const pl = filteredPlaces[idx];
      if (typeof pl.lat !== "number" || typeof pl.lng !== "number") continue;
      if (pl.lat < sw.lat || pl.lat > ne.lat) continue;

      let inLng = false;
      if (lngSpan >= 359) {
        inLng = true;
      } else {
        const normLng = ((((pl.lng - sw.lng) % 360) + 360) % 360) + sw.lng;
        inLng = normLng <= ne.lng;
      }
      if (!inLng) continue;

      let dLng = pl.lng - center.lng;
      if (dLng > 180) dLng -= 360;
      else if (dLng < -180) dLng += 360;
      const dLat = pl.lat - center.lat;
      const distSq = dLat * dLat + (dLng * cosLat) * (dLng * cosLat);
      matches.push({ idx, pl, distSq });
    }

    matches.sort((a, b) => a.distSq - b.distSq || String(a.pl.id).localeCompare(String(b.pl.id)));
    return matches;
  }

  function updateViewportControls() {
    const vpNextBtn = document.getElementById("slide-viewport-next-btn");
    const vpLabelEl = document.getElementById("viewport-strip-label");
    const vpHintEl = document.getElementById("viewport-strip-hint");
    const stripEl = document.getElementById("viewport-photo-strip");
    if (!filteredPlaces.length) return;

    const inView = getPlacesInCurrentViewport();
    const count = inView.length;

    if (vpNextBtn) {
      vpNextBtn.textContent = `📍 Next in View (${formatNumber(count)})`;
      if (count === 0) {
        vpNextBtn.setAttribute("aria-disabled", "true");
      } else {
        vpNextBtn.removeAttribute("aria-disabled");
      }
    }

    if (vpLabelEl) {
      vpLabelEl.textContent = `In This Map View (${formatNumber(count)})`;
    }
    if (vpHintEl) {
      vpHintEl.textContent =
        count > 24
          ? `Showing 24 closest to center of ${formatNumber(count)} in view · Zoom in or scroll →`
          : count > 0
            ? "Click any card or press 📍 Next in View to browse locally"
            : "Zoom out or pan toward glowing dots to see local photos";
    }

    if (!stripEl || !lensShowsPhotos()) return;

    stripEl.innerHTML = "";
    if (count === 0) {
      const empty = document.createElement("span");
      empty.className = "viewport-strip-empty";
      empty.textContent = "No photo pins inside this map frame — zoom out or pan to a visited region.";
      stripEl.appendChild(empty);
      return;
    }

    const slice = inView.slice(0, 24);
    // Always include activePlaceIndex in the strip if it is inside the current viewport
    if (!slice.some((m) => m.idx === activePlaceIndex)) {
      const activeMatch = inView.find((m) => m.idx === activePlaceIndex);
      if (activeMatch) {
        slice[slice.length - 1] = activeMatch;
      }
    }

    let activeChipBtn = null;
    for (const { idx, pl } of slice) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "viewport-chip-btn";
      const isActive = idx === activePlaceIndex;
      if (isActive) {
        btn.setAttribute("aria-current", "true");
        activeChipBtn = btn;
      }
      btn.setAttribute("aria-label", `${pl.name}, ${pl.location}`);

      const photoUrl = pl.photos?.[0] || "";
      if (photoUrl) {
        const img = document.createElement("img");
        img.className = "viewport-chip-thumb";
        img.src = photoUrl.replace(/=w\d+-h\d+-p-k-no$/, "=w160-h120-p-k-no");
        img.alt = "";
        img.width = 80;
        img.height = 72;
        img.loading = "lazy";
        img.fetchPriority = "low";
        img.referrerPolicy = "no-referrer";
        btn.appendChild(img);
      } else {
        const fb = document.createElement("span");
        fb.className = "viewport-chip-thumb-fallback";
        fb.setAttribute("aria-hidden", "true");
        fb.textContent = "📍";
        btn.appendChild(fb);
      }

      const txtWrap = document.createElement("span");
      txtWrap.className = "viewport-chip-text";
      const nameSpan = document.createElement("span");
      nameSpan.className = "viewport-chip-name";
      nameSpan.textContent = pl.name;
      const locSpan = document.createElement("span");
      locSpan.className = "viewport-chip-loc";
      locSpan.textContent = pl.location;
      txtWrap.append(nameSpan, locSpan);
      btn.appendChild(txtWrap);

      btn.addEventListener("click", () => {
        stopAutoPlay();
        const pos = inView.findIndex((m) => m.idx === idx);
        selectPlace(idx, false, false, pos >= 0 ? { pos: pos + 1, total: count } : null);
      });

      stripEl.appendChild(btn);
    }

    if (activeChipBtn) {
      const targetLeft = Math.max(
        0,
        activeChipBtn.offsetLeft - stripEl.clientWidth / 2 + activeChipBtn.offsetWidth / 2
      );
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      stripEl.scrollTo({ left: targetLeft, behavior: reduced ? "instant" : "smooth" });
    }
  }

  function scheduleViewportSync() {
    if (viewportSyncTimer) clearTimeout(viewportSyncTimer);
    viewportSyncTimer = setTimeout(() => {
      viewportSyncTimer = null;
      updateViewportControls();
    }, 120);
  }

  function rebuildMarkers() {
    pinsLayerGroup.clearLayers();
    if (!lensShowsPhotos() || !mapsData) return;

    const dark = isDarkActive();
    const zoom = map.getZoom();

    // 1. Regional footprint dots across all 50 US states, Central Asia, Canada, Europe & Asia-Pacific
    if (Array.isArray(mapsData.heatmapClusters)) {
      for (const c of mapsData.heatmapClusters) {
        const label = c.label || c.name || "Visited Cluster";
        const cm = L.circleMarker([c.lat, c.lng], {
          renderer: pinsCanvasRenderer,
          radius: zoom >= 6 ? 4.2 : 3.4,
          color: dark ? "#141312" : "#ffffff",
          weight: 1.0,
          fillColor: dark ? "#f0ad4e" : "#d97724",
          fillOpacity: 0.82
        });
        cm.bindTooltip(`<strong>${escMapHtml(label)}</strong>`, { direction: "top" });
        cm.on("click", () => {
          stopAutoPlay();
          map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 6), { duration: 0.85 });
          if (statusLineEl) statusLineEl.textContent = `Exploring: ${label}`;
        });
        cm.addTo(pinsLayerGroup);
      }
    }

    // 1b. Additional geocoded Google Maps reviewed/photographed place pins (bringing map past 1,200+ pins)
    if (currentSlideFilter === "all" && mapOnlyPins.length) {
      const subRadius = zoom >= 11 ? 4.8 : zoom >= 7 ? 4.0 : zoom >= 4 ? 3.4 : 2.9;
      for (const item of mapOnlyPins) {
        const [lat, lng, name, loc, rating, snippet] = item;
        const stars = rating ? ` · ${"★".repeat(rating)}` : "";
        const mPin = L.circleMarker([lat, lng], {
          renderer: pinsCanvasRenderer,
          radius: subRadius,
          color: dark ? "#141312" : "#ffffff",
          weight: 0.9,
          fillColor: dark ? "#f0ad4e" : "#d97724",
          fillOpacity: 0.84
        });
        mPin.bindTooltip(
          `<strong>${escMapHtml(name)}</strong><br>${escMapHtml(loc)}${escMapHtml(stars)}`,
          { direction: "top" }
        );
        mPin.on("click", () => {
          stopAutoPlay();
          const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${loc}`)}`;
          const quoteHtml = snippet
            ? `<div class="pin-popup-quote">“${escMapHtml(snippet)}${snippet.length >= 158 ? "…" : ""}”</div>`
            : "";
          L.popup({ closeButton: true, maxWidth: 260 })
            .setLatLng([lat, lng])
            .setContent(
              `<strong>${escMapHtml(name)}</strong>${escMapHtml(stars)}` +
                `<div class="pin-popup-loc">${escMapHtml(loc)}</div>` +
                quoteHtml +
                `<a class="pin-popup-link" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Open on Google Maps ↗</a>`
            )
            .openOn(map);
          if (statusLineEl) statusLineEl.textContent = `${name} · ${loc}`;
        });
        mPin.addTo(pinsLayerGroup);
      }
    }

    // 2. All 1,000+ individual photo dispatch dots on shared HTML5 Canvas
    let activeEntry = null;
    const pinRadius = zoom >= 11 ? 6.0 : zoom >= 7 ? 5.1 : zoom >= 4 ? 4.4 : 3.9;
    filteredPlaces.forEach((pl, idx) => {
      if (idx === activePlaceIndex) {
        activeEntry = { pl, idx };
        return;
      }
      const marker = L.circleMarker([pl.lat, pl.lng], {
        renderer: pinsCanvasRenderer,
        radius: pinRadius,
        color: dark ? "#141312" : "#ffffff",
        weight: zoom >= 6 ? 1.25 : 1.0,
        fillColor: dark ? "#e88264" : "#9e3b24",
        fillOpacity: 0.94
      });
      const metric = pl.rating ? ` · ${"★".repeat(pl.rating)}` : "";
      marker.bindTooltip(
        `<strong>${escMapHtml(pl.name)}</strong><br>${escMapHtml(pl.location)}${escMapHtml(metric)}`,
        { direction: "top" }
      );
      marker.on("click", () => {
        stopAutoPlay();
        // Keep current neighborhood viewport if already zoomed in; gently zoom in only from world view
        const shouldZoomIn = map.getZoom() < 5;
        selectPlace(idx, shouldZoomIn);
      });
      marker.addTo(pinsLayerGroup);
    });

    // 3. Active slideshow hero beacon (glowing outer ring + emerald core dot painted last on top)
    if (activeEntry) {
      const { pl, idx } = activeEntry;
      L.circleMarker([pl.lat, pl.lng], {
        renderer: pinsCanvasRenderer,
        radius: 14,
        color: dark ? "#46e5a0" : "#15803d",
        weight: 1.5,
        opacity: 0.45,
        fillColor: dark ? "#46e5a0" : "#15803d",
        fillOpacity: 0.22,
        interactive: false
      }).addTo(pinsLayerGroup);

      const hero = L.circleMarker([pl.lat, pl.lng], {
        renderer: pinsCanvasRenderer,
        radius: 8.2,
        color: dark ? "#111110" : "#ffffff",
        weight: 2.2,
        fillColor: dark ? "#46e5a0" : "#15803d",
        fillOpacity: 1
      });
      const metric = pl.rating ? ` · ${"★".repeat(pl.rating)}` : "";
      hero.bindTooltip(
        `<strong>📍 ${escMapHtml(pl.name)}</strong><br>${escMapHtml(pl.location)}${escMapHtml(metric)}`,
        { direction: "top" }
      );
      hero.on("click", () => {
        stopAutoPlay();
        selectPlace(idx, true);
      });
      hero.addTo(pinsLayerGroup);
      hero.bringToFront();
    }
  }

  map.on("zoomend", () => {
    rebuildMarkers();
    if (lensShowsFlights()) rebuildFlightArcs();
    scheduleViewportSync();
  });
  map.on("moveend", () => {
    scheduleViewportSync();
  });

  function formatNumber(n) {
    return typeof n === "number" ? n.toLocaleString("en-US") : String(n);
  }

  function formatCoords(lat, lng) {
    const ns = lat >= 0 ? "N" : "S";
    const ew = lng >= 0 ? "E" : "W";
    return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lng).toFixed(2)}°${ew}`;
  }

  function renderActiveSlide(shouldFly = false, localContext = null) {
    if (!filteredPlaces.length) return;
    const place = filteredPlaces[activePlaceIndex];
    const photos = place.photos || [];
    const mainPhoto = photos[activePhotoIndex] || photos[0] || "";

    const counterEl = document.getElementById("slide-counter");
    const imgEl = document.getElementById("slide-main-img");
    const frameEl = imgEl ? imgEl.closest(".slide-image-frame") : null;
    const metricEl = document.getElementById("slide-metric-pill");
    const thumbsEl = document.getElementById("slide-thumbs");
    const catEl = document.getElementById("slide-category");
    const coordsEl = document.getElementById("slide-coords");
    const titleEl = document.getElementById("slide-title");
    const locEl = document.getElementById("slide-location");
    const descEl = document.getElementById("slide-description");
    const mapsLinkEl = document.getElementById("slide-maps-link");

    if (counterEl) {
      counterEl.textContent = localContext
        ? `In View ${formatNumber(localContext.pos)} of ${formatNumber(localContext.total)} · #${activePlaceIndex + 1}`
        : `Dispatch ${formatNumber(activePlaceIndex + 1)} of ${formatNumber(filteredPlaces.length)}`;
    }
    if (imgEl) {
      if (mainPhoto) {
        imgEl.hidden = false;
        if (frameEl) frameEl.hidden = false;
        imgEl.src = mainPhoto;
        imgEl.alt = `${place.name} — ${place.location}`;
      } else if (frameEl) {
        frameEl.hidden = true;
      }
    }
    if (metricEl) {
      if (place.rating) {
        metricEl.textContent = `${"★".repeat(place.rating)} · Google Maps Review`;
      } else {
        metricEl.textContent = "📍 Google Maps Dispatch";
      }
    }
    if (catEl) catEl.textContent = place.category || "Field Dispatch";
    if (coordsEl) coordsEl.textContent = formatCoords(place.lat, place.lng);
    if (titleEl) titleEl.textContent = place.name;
    if (locEl) locEl.textContent = place.location;
    if (descEl) descEl.textContent = place.caption || "";
    if (mapsLinkEl) {
      const q = encodeURIComponent(`${place.name} ${place.location}`);
      mapsLinkEl.href = `https://www.google.com/maps/search/?api=1&query=${q}`;
    }

    if (thumbsEl) {
      thumbsEl.innerHTML = "";
      if (photos.length > 1) {
        photos.forEach((url, idx) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "slide-thumb-btn";
          btn.setAttribute("aria-label", `View photo ${idx + 1} of ${photos.length} for ${place.name}`);
          btn.setAttribute("aria-pressed", String(idx === activePhotoIndex));

          const thumbImg = document.createElement("img");
          thumbImg.src = url.replace("=w1000-h750-p-k-no", "=w240-h180-p-k-no");
          thumbImg.alt = "";
          thumbImg.width = 80;
          thumbImg.height = 60;
          thumbImg.referrerPolicy = "no-referrer";
          thumbImg.loading = "lazy";
          thumbImg.fetchPriority = "low";
          btn.appendChild(thumbImg);

          btn.addEventListener("click", () => {
            stopAutoPlay();
            activePhotoIndex = idx;
            renderActiveSlide(false, localContext);
          });
          thumbsEl.appendChild(btn);
        });
      }
    }

    if (shouldFly) {
      if (!lensShowsPhotos()) {
        setMapLens("photos");
      }
      const minTargetZoom =
        currentSlideFilter === "nyc" ? 13 : place.tag === "nyc" ? 12 : 6;
      const targetZoom = Math.max(map.getZoom(), minTargetZoom);
      map.flyTo([place.lat, place.lng], targetZoom, { duration: 0.85 });
      if (statusLineEl) {
        statusLineEl.textContent = `${place.name} · ${place.location}`;
      }
    } else if (localContext && statusLineEl) {
      statusLineEl.textContent = `In View (${localContext.pos}/${localContext.total}): ${place.name} · ${place.location}`;
    }
    rebuildMarkers();
    updateViewportControls();
  }

  function selectPlace(index, shouldFly = true, randomizePhoto = false, localContext = null) {
    if (!filteredPlaces.length) return;
    activePlaceIndex = (index + filteredPlaces.length) % filteredPlaces.length;
    const photos = filteredPlaces[activePlaceIndex]?.photos || [];
    activePhotoIndex = randomizePhoto && photos.length > 1
      ? Math.floor(Math.random() * photos.length)
      : 0;
    renderActiveSlide(shouldFly, localContext);
  }

  // Wire toolbar buttons (works on both Interactive Leaflet Map and 39-Country Static Map!)
  const STATIC_PRESETS = {
    world: { fx: 0.5, fy: 0.5, scale: 1 },
    nyc: { fx: 0.275, fy: 0.355, scale: 3.4 },
    west: { fx: 0.165, fy: 0.34, scale: 3.1 },
    us50: { fx: 0.215, fy: 0.355, scale: 2.3 },
    "central-asia": { fx: 0.675, fy: 0.35, scale: 3.2 },
    canada: { fx: 0.215, fy: 0.235, scale: 2.3 },
    "europe-apac": { fx: 0.64, fy: 0.36, scale: 1.85 }
  };

  let smScale = 1;
  let smTx = 0;
  let smTy = 0;

  document.querySelectorAll("[data-region-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      stopAutoPlay();
      const key = btn.getAttribute("data-region-preset") || "world";
      const preset = REGION_PRESETS[key] || REGION_PRESETS.world;
      document.querySelectorAll("[data-region-preset]").forEach((other) => {
        other.setAttribute("aria-pressed", String(other === btn));
      });
      if (activeLens === "static") {
        focusStaticPreset(key);
      } else {
        if (key === "canada" && activeLens === "photos") {
          setMapLens("atlas");
        }
        map.flyTo([preset.lat, preset.lng], preset.zoom, { duration: 0.95 });
      }
      if (statusLineEl) statusLineEl.textContent = preset.label;
    });
  });

  function updateFilterButtonCounts() {
    const filterLabels = {
      all: ["Shuffled Mix", allRawPlaces.length],
      international: ["Global & Canada", allRawPlaces.filter((p) => p.tag === "international").length],
      "us-50": ["50 US States", allRawPlaces.filter((p) => p.tag === "us-50").length],
      nyc: ["NYC & Broadway", allRawPlaces.filter((p) => p.tag === "nyc").length]
    };
    for (const [tagKey, [labelTxt, cnt]] of Object.entries(filterLabels)) {
      const btn = document.querySelector(`[data-slide-filter="${tagKey}"]`);
      if (btn && cnt > 0) btn.textContent = `${labelTxt} (${formatNumber(cnt)})`;
    }
  }

  document.querySelectorAll("[data-slide-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!allRawPlaces.length) return;
      stopAutoPlay();
      const prevFilter = currentSlideFilter;
      const filter = btn.getAttribute("data-slide-filter") || "all";
      currentSlideFilter = filter;
      document.querySelectorAll("[data-slide-filter]").forEach((other) => {
        other.setAttribute("aria-pressed", String(other === btn));
      });
      if (!lensShowsPhotos()) setMapLens("photos");
      filteredPlaces =
        filter === "all"
          ? buildBalancedDeck(allRawPlaces)
          : shuffleArray(allRawPlaces.filter((p) => p.tag === filter));
      activePlaceIndex = 0;
      const firstPlace = filteredPlaces[0];
      const firstPhotos = firstPlace?.photos || [];
      activePhotoIndex = firstPhotos.length > 1 ? Math.floor(Math.random() * firstPhotos.length) : 0;
      if (filter === "nyc" && firstPlace) {
        renderActiveSlide(false);
        map.flyTo([firstPlace.lat, firstPlace.lng], Math.max(map.getZoom(), 13), { duration: 0.9 });
        if (statusLineEl) statusLineEl.textContent = `${firstPlace.name} · ${firstPlace.location}`;
      } else if (prevFilter === "nyc" && firstPlace && map.getZoom() > 8) {
        renderActiveSlide(false);
        map.flyTo([firstPlace.lat, firstPlace.lng], 7, { duration: 0.9 });
        if (statusLineEl) statusLineEl.textContent = `${firstPlace.name} · ${firstPlace.location}`;
      } else {
        renderActiveSlide(true);
      }
    });
  });

  const lensFlightsBtn = document.getElementById("lens-flights-btn");
  const zoomInBtn = document.getElementById("map-zoom-in");
  const zoomOutBtn = document.getElementById("map-zoom-out");
  const resetBtn = document.getElementById("map-reset-btn");
  const mapCanvasWrap = document.getElementById("map-canvas-wrap");
  const staticMapWrap = document.getElementById("static-countries-map-wrap");
  const staticViewport = document.getElementById("static-map-viewport");
  const staticImg = document.getElementById("static-countries-img");

  function clampStaticTransform() {
    if (!staticViewport) return;
    const vw = staticViewport.clientWidth || 600;
    const vh = staticViewport.clientHeight || 432;
    if (smScale <= 1.01) {
      smScale = 1;
      smTx = 0;
      smTy = 0;
      return;
    }
    const minTx = vw * (1 - smScale);
    const minTy = vh * (1 - smScale);
    smTx = Math.min(0, Math.max(minTx, smTx));
    smTy = Math.min(0, Math.max(minTy, smTy));
  }

  function applyStaticTransform(animate = false) {
    if (!staticImg) return;
    clampStaticTransform();
    staticImg.style.transition = animate ? "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    staticImg.style.transform = `translate(${smTx}px, ${smTy}px) scale(${smScale})`;
  }

  function zoomStaticAt(factor, cx, cy, animate = true) {
    if (!staticViewport) return;
    const nextScale = Math.min(7, Math.max(1, smScale * factor));
    const ratio = nextScale / smScale;
    smTx = cx - (cx - smTx) * ratio;
    smTy = cy - (cy - smTy) * ratio;
    smScale = nextScale;
    applyStaticTransform(animate);
  }

  function focusStaticPreset(key) {
    if (!staticViewport) return;
    const p = STATIC_PRESETS[key] || STATIC_PRESETS.world;
    const vw = staticViewport.clientWidth || 600;
    const vh = staticViewport.clientHeight || 432;
    smScale = p.scale;
    smTx = vw / 2 - p.fx * vw * smScale;
    smTy = vh / 2 - p.fy * vh * smScale;
    applyStaticTransform(true);
  }

  if (staticViewport) {
    staticViewport.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = staticViewport.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.22 : 1 / 1.22;
        zoomStaticAt(factor, cx, cy, false);
      },
      { passive: false }
    );

    staticViewport.addEventListener("dblclick", (e) => {
      const rect = staticViewport.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (smScale >= 4) {
        smScale = 1;
        smTx = 0;
        smTy = 0;
        applyStaticTransform(true);
      } else {
        zoomStaticAt(1.8, cx, cy, true);
      }
    });

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originTx = 0;
    let originTy = 0;

    staticViewport.addEventListener("pointerdown", (e) => {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      originTx = smTx;
      originTy = smTy;
      staticViewport.setPointerCapture(e.pointerId);
    });

    staticViewport.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      smTx = originTx + (e.clientX - startX);
      smTy = originTy + (e.clientY - startY);
      applyStaticTransform(false);
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      try {
        staticViewport.releasePointerCapture(e.pointerId);
      } catch {}
    };
    staticViewport.addEventListener("pointerup", endDrag);
    staticViewport.addEventListener("pointercancel", endDrag);

    staticViewport.addEventListener("keydown", (e) => {
      const step = 48;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomStaticAt(1.35, staticViewport.clientWidth / 2, staticViewport.clientHeight / 2, true);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomStaticAt(1 / 1.35, staticViewport.clientWidth / 2, staticViewport.clientHeight / 2, true);
      } else if (e.key === "0") {
        e.preventDefault();
        focusStaticPreset("world");
      } else if (smScale > 1 && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        if (e.key === "ArrowLeft") smTx += step;
        if (e.key === "ArrowRight") smTx -= step;
        if (e.key === "ArrowUp") smTy += step;
        if (e.key === "ArrowDown") smTy -= step;
        applyStaticTransform(false);
      }
    });
  }

  const LENS_DESCRIPTIONS = {
    photos: "Drag to pan · Scroll or + / − to zoom · Keys: ← / → slides, V next in view · Click any dot to explore",
    flights: "Flighty log: 173 completed flights · 314,804 miles (12.6× Earth) across 83 airports",
    atlas: "Visited Atlas: 39/199 countries · 50/50 US states · 8/13 Canadian provinces + overland drive",
    all: "All layers active: 1,000+ photo dots, 173 Flighty routes, visited choropleth & Trans-Canada drive",
    static: "MapChart reference export · Scroll or use + / − to zoom, drag to pan"
  };

  function setMapLens(lens) {
    activeLens = lens;
    const isStatic = lens === "static";
    document.querySelectorAll("[data-map-lens]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-map-lens") === lens));
    });
    if (mapCanvasWrap) mapCanvasWrap.hidden = isStatic;
    if (staticMapWrap) staticMapWrap.hidden = !isStatic;
    if (isStatic) {
      applyStaticTransform(false);
      updateLegendForLens();
    } else {
      map.invalidateSize();
      syncMapTheme();
    }
    if (statusLineEl) {
      statusLineEl.textContent = LENS_DESCRIPTIONS[lens] || LENS_DESCRIPTIONS.photos;
    }
  }

  document.querySelectorAll("[data-map-lens]").forEach((btn) => {
    btn.addEventListener("click", () => {
      stopAutoPlay();
      const nextLens = btn.getAttribute("data-map-lens") || "photos";
      setMapLens(nextLens);
    });
  });

  const shuffleBtn = document.getElementById("slide-shuffle-btn");
  const viewportNextBtn = document.getElementById("slide-viewport-next-btn");
  const prevBtn = document.getElementById("slide-prev-btn");
  const nextBtn = document.getElementById("slide-next-btn");
  const autoBtn = document.getElementById("slide-autoplay-btn");
  const flyBtn = document.getElementById("slide-fly-btn");

  if (shuffleBtn) {
    shuffleBtn.addEventListener("click", () => {
      if (filteredPlaces.length <= 1) return;
      stopAutoPlay();
      if (!lensShowsPhotos()) setMapLens("photos");
      let nextIdx = activePlaceIndex;
      while (nextIdx === activePlaceIndex) {
        nextIdx = Math.floor(Math.random() * filteredPlaces.length);
      }
      selectPlace(nextIdx, true, true);
    });
  }

  function stepViewportPhoto(direction = 1) {
    stopAutoPlay();
    if (!lensShowsPhotos()) {
      setMapLens("photos");
    }
    const inView = getPlacesInCurrentViewport();
    if (!inView.length) {
      if (statusLineEl) {
        statusLineEl.textContent = "No photo pins in this map area — zoom out or pan toward glowing dots";
      }
      return;
    }
    if (inView.length === 1 && inView[0].idx === activePlaceIndex) {
      const curPhotos = filteredPlaces[activePlaceIndex]?.photos || [];
      if (curPhotos.length > 1) {
        activePhotoIndex = (activePhotoIndex + direction + curPhotos.length) % curPhotos.length;
        renderActiveSlide(false, { pos: 1, total: 1 });
        return;
      }
      if (statusLineEl) {
        statusLineEl.textContent = `Only 1 pin in this zoomed area (${inView[0].pl.name}) — zoom out slightly for nearby spots`;
      }
      return;
    }
    const curPos = inView.findIndex((m) => m.idx === activePlaceIndex);
    const nextPos =
      curPos >= 0
        ? (curPos + direction + inView.length) % inView.length
        : direction >= 0
          ? 0
          : inView.length - 1;
    selectPlace(inView[nextPos].idx, false, false, { pos: nextPos + 1, total: inView.length });
  }

  if (viewportNextBtn) {
    viewportNextBtn.addEventListener("click", () => {
      stepViewportPhoto(1);
    });
  }

  // Keyboard navigation for the Explorer Photo Atlas (← / → / [ / ] for slides, V or Shift+←/→ for local viewport)
  document.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target;
    if (
      target instanceof HTMLElement &&
      (target.matches("input, textarea, select, [contenteditable='true']") ||
        target.closest("[role='toolbar']"))
    ) {
      return;
    }
    if (target === staticViewport && smScale > 1) return;

    const explorerSec = document.getElementById("explorer");
    const atlasEl = document.getElementById("atlas");
    if (!explorerSec || !atlasEl || !filteredPlaces.length) return;

    const focusInsideExplorer = explorerSec.contains(document.activeElement);
    const rect = atlasEl.getBoundingClientRect();
    const atlasVisible = rect.bottom > 80 && rect.top < window.innerHeight - 80;
    if (!focusInsideExplorer && !atlasVisible) return;

    // When Leaflet map container itself has focus, let bare Arrow keys pan the map natively;
    // still support Shift+Arrows, [ / ], and V everywhere!
    const mapHasDirectFocus = document.activeElement === mapContainer;

    if (e.key === "v" || e.key === "V") {
      e.preventDefault();
      stepViewportPhoto(e.shiftKey ? -1 : 1);
    } else if (e.key === "[") {
      e.preventDefault();
      stopAutoPlay();
      selectPlace(activePlaceIndex - 1, true);
    } else if (e.key === "]") {
      e.preventDefault();
      stopAutoPlay();
      selectPlace(activePlaceIndex + 1, true);
    } else if (e.key === "ArrowLeft" && e.shiftKey) {
      e.preventDefault();
      stepViewportPhoto(-1);
    } else if (e.key === "ArrowRight" && e.shiftKey) {
      e.preventDefault();
      stepViewportPhoto(1);
    } else if (e.key === "ArrowLeft" && !mapHasDirectFocus) {
      e.preventDefault();
      stopAutoPlay();
      selectPlace(activePlaceIndex - 1, true);
    } else if (e.key === "ArrowRight" && !mapHasDirectFocus) {
      e.preventDefault();
      stopAutoPlay();
      selectPlace(activePlaceIndex + 1, true);
    }
  });

  const goalCountriesBtn = document.getElementById("goal-countries-btn");
  if (goalCountriesBtn) {
    goalCountriesBtn.addEventListener("click", () => {
      stopAutoPlay();
      setMapLens("atlas");
      const p = REGION_PRESETS.world;
      map.flyTo([p.lat, p.lng], p.zoom, { duration: 0.95 });
      if (statusLineEl) {
        statusLineEl.textContent = "Goal 01: 39 / 199 Countries Visited — Hover any country to inspect";
      }
      mapContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
  const goalStatesBtn = document.getElementById("goal-states-btn");
  if (goalStatesBtn) {
    goalStatesBtn.addEventListener("click", () => {
      stopAutoPlay();
      setMapLens("atlas");
      const p = REGION_PRESETS.us50;
      map.flyTo([p.lat, p.lng], p.zoom, { duration: 1.0 });
      if (statusLineEl) statusLineEl.textContent = "Goal 02 ✓ Complete: All 50 US States Visited";
      mapContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
  const goalCanadaDriveBtn = document.getElementById("goal-canada-drive-btn");
  if (goalCanadaDriveBtn) {
    goalCanadaDriveBtn.addEventListener("click", () => {
      stopAutoPlay();
      setMapLens("atlas");
      map.flyTo([53.5, -96.5], 4, { duration: 1.05 });
      if (statusLineEl) {
        statusLineEl.textContent =
          "Goal 03: 8/13 Canadian Provinces & Territories + Disjoint Trans-Canada Drive (Halifax → Thunder Bay & Alberta Rockies)";
      }
      mapContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
      stopAutoPlay();
      if (activeLens === "static" && staticViewport) {
        zoomStaticAt(1.45, staticViewport.clientWidth / 2, staticViewport.clientHeight / 2, true);
      } else {
        map.zoomIn();
      }
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
      stopAutoPlay();
      if (activeLens === "static" && staticViewport) {
        zoomStaticAt(1 / 1.45, staticViewport.clientWidth / 2, staticViewport.clientHeight / 2, true);
      } else {
        map.zoomOut();
      }
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      stopAutoPlay();
      const p = REGION_PRESETS.world;
      if (activeLens === "static") {
        focusStaticPreset("world");
      } else {
        map.flyTo([p.lat, p.lng], p.zoom, { duration: 0.9 });
      }
      if (statusLineEl) statusLineEl.textContent = p.label;
    });
  }
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      stopAutoPlay();
      selectPlace(activePlaceIndex - 1, true);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      stopAutoPlay();
      selectPlace(activePlaceIndex + 1, true);
    });
  }
  if (flyBtn) {
    flyBtn.addEventListener("click", () => {
      stopAutoPlay();
      if (!lensShowsPhotos()) setMapLens("photos");
      const place = filteredPlaces[activePlaceIndex];
      if (place) map.flyTo([place.lat, place.lng], 12, { duration: 0.9 });
    });
  }
  if (autoBtn) {
    autoBtn.addEventListener("click", () => {
      if (autoPlayTimer) {
        stopAutoPlay();
      } else {
        if (!lensShowsPhotos()) setMapLens("photos");
        autoBtn.setAttribute("aria-pressed", "true");
        selectPlace(activePlaceIndex + 1, true);
        autoPlayTimer = setInterval(() => {
          selectPlace(activePlaceIndex + 1, true);
        }, 4500);
      }
    });
  }

  // Load privacy-safe Flighty great-circle flight history
  fetch("data/flighty-routes.json")
    .then((r) => r.json())
    .then((fData) => {
      flightyData = fData;
      if (fData?.summary) {
        const s = fData.summary;
        const flEl = document.getElementById("stat-flighty-summary");
        if (flEl) {
          flEl.textContent = `${formatNumber(s.totalFlights)} · ${Math.round(s.totalMiles / 1000)}k mi (${s.earthOrbits}× 🌍)`;
        }
        if (lensFlightsBtn) {
          lensFlightsBtn.textContent = `✈️ Flights (${s.totalFlights})`;
        }
      }
      rebuildFlightArcs();
    })
    .catch(() => {});

  // Load lightweight Google Maps index JSON (<256 KB) first, then stream 1,000+ extended pins
  fetch("data/maps-index.json")
    .then((r) => r.json())
    .then((data) => {
      mapsData = data;
      allRawPlaces = Array.isArray(data.places) ? data.places.slice() : [];
      filteredPlaces = buildBalancedDeck(allRawPlaces);
      const firstPhotos = filteredPlaces[0]?.photos || [];
      activePhotoIndex = firstPhotos.length > 1 ? Math.floor(Math.random() * firstPhotos.length) : 0;

      updateFilterButtonCounts();
      updateLegendForLens();

      if (data.profile) {
        const pEl = document.getElementById("stat-total-photos");
        const rEl = document.getElementById("stat-total-reviews");
        if (pEl) pEl.textContent = formatNumber(data.profile.totalPhotos);
        if (rEl) rEl.textContent = formatNumber(data.profile.totalReviews);
      }
      if (Array.isArray(data.hostedReviews) && data.hostedReviews.length) {
        initHostedMapsReviews(data.hostedReviews);
      } else {
        fetch("data/maps-reviews.json")
          .then((r) => r.json())
          .then((revPayload) => {
            const list = Array.isArray(revPayload) ? revPayload : revPayload.reviews || [];
            initHostedMapsReviews(list);
          })
          .catch(() => {});
      }
      renderActiveSlide(false);

      // Stream extended 1,000+ pin archive without disturbing the currently displayed slide
      fetch("data/maps-pins.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((pinsPayload) => {
          if (!pinsPayload) return;
          const extra = Array.isArray(pinsPayload.extraPins) ? pinsPayload.extraPins : [];
          if (Array.isArray(pinsPayload.mapOnlyPins)) {
            mapOnlyPins = pinsPayload.mapOnlyPins;
          }
          const seenIds = new Set(allRawPlaces.map((p) => p.id));
          const uniqueExtra = [];
          for (const p of extra) {
            if (p && p.id && !seenIds.has(p.id)) {
              seenIds.add(p.id);
              uniqueExtra.push(p);
            }
          }
          if (uniqueExtra.length) {
            allRawPlaces = allRawPlaces.concat(uniqueExtra);
            const matchingExtra =
              currentSlideFilter === "all"
                ? buildBalancedDeck(uniqueExtra)
                : shuffleArray(uniqueExtra.filter((p) => p.tag === currentSlideFilter));

            if (matchingExtra.length) {
              filteredPlaces = filteredPlaces.concat(matchingExtra);
            }
          }

          updateFilterButtonCounts();
          updateLegendForLens();
          const counterEl = document.getElementById("slide-counter");
          if (counterEl && !counterEl.textContent.startsWith("In View")) {
            counterEl.textContent = `Dispatch ${formatNumber(activePlaceIndex + 1)} of ${formatNumber(filteredPlaces.length)}`;
          }
          rebuildMarkers();
          updateViewportControls();
        })
        .catch(() => {});
    });

  function initHostedMapsReviews(reviewsList) {
    const grid = document.getElementById("gmap-reviews-grid");
    const moreBtn = document.getElementById("gmap-rev-more-btn");
    const countLabel = document.getElementById("gmap-rev-count-label");
    const summaryCount = document.getElementById("gmap-rev-summary-count");
    const searchInput = document.getElementById("gmap-rev-search");
    const shufBtn = document.getElementById("gmap-rev-shuffle-btn");
    if (!grid) return;

    if (summaryCount && reviewsList.length) {
      summaryCount.textContent = formatNumber(reviewsList.length);
    }

    let activeFilter = "all";
    let query = "";
    let visibleLimit = 6;
    let baseOrder = shuffleArray(reviewsList);

    const isNycAddr = (addr = "") =>
      /new york,\s*ny|brooklyn,\s*ny|queens,\s*ny|manhattan|bronx/i.test(addr);

    function getMatches() {
      let arr = baseOrder.slice();
      if (activeFilter === "intl") {
        arr = arr.filter((r) => r.countryIso && r.countryIso !== "US");
      } else if (activeFilter === "nyc") {
        arr = arr.filter((r) => r.countryIso === "US" && isNycAddr(r.location));
      } else if (activeFilter === "us") {
        arr = arr.filter((r) => (!r.countryIso || r.countryIso === "US") && !isNycAddr(r.location));
      }
      if (query) {
        const q = query.toLowerCase();
        arr = arr.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.location.toLowerCase().includes(q) ||
            r.text.toLowerCase().includes(q)
        );
      }
      return arr;
    }

    function renderGrid() {
      const matches = getMatches();
      const slice = matches.slice(0, visibleLimit);
      grid.innerHTML = "";

      for (const rev of slice) {
        const li = document.createElement("li");
        li.className = "gmap-rev-card";

        if (rev.photo) {
          const img = document.createElement("img");
          img.className = "gmap-rev-thumb";
          img.src = rev.photo.replace("=w1000-h750-p-k-no", "=w640-h360-p-k-no");
          img.alt = `${rev.name} — ${rev.location}`;
          img.width = 320;
          img.height = 180;
          img.loading = "lazy";
          img.referrerPolicy = "no-referrer";
          img.addEventListener("error", () => img.remove());
          li.appendChild(img);
        }

        const h4 = document.createElement("h4");
        h4.textContent = rev.name;

        const meta = document.createElement("div");
        meta.className = "lb-meta-row";
        const stars = document.createElement("span");
        stars.className = "lb-stars";
        stars.textContent = "★".repeat(Math.max(1, Math.min(5, rev.rating || 5)));
        const loc = document.createElement("span");
        loc.className = "lb-date";
        loc.textContent = rev.location;
        meta.append(stars, loc);

        const p = document.createElement("p");
        p.textContent = `“${rev.text}”`;

        li.append(h4, meta, p);
        grid.appendChild(li);
      }

      if (moreBtn) {
        moreBtn.hidden = matches.length <= visibleLimit;
        if (!moreBtn.hidden) {
          moreBtn.textContent = `Show More Dispatches (${formatNumber(matches.length - visibleLimit)} remaining)`;
        }
      }
      if (countLabel) {
        countLabel.textContent = matches.length
          ? `Showing ${formatNumber(slice.length)} of ${formatNumber(matches.length)} hosted Google Maps reviews`
          : "No matching Google Maps reviews.";
      }
    }

    document.querySelectorAll("[data-gmap-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeFilter = btn.getAttribute("data-gmap-filter") || "all";
        visibleLimit = 6;
        document.querySelectorAll("[data-gmap-filter]").forEach((b) => {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        renderGrid();
      });
    });

    if (shufBtn) {
      shufBtn.addEventListener("click", () => {
        baseOrder = shuffleArray(reviewsList);
        visibleLimit = 6;
        renderGrid();
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        query = searchInput.value.trim();
        visibleLimit = 6;
        renderGrid();
      });
    }

    if (moreBtn) {
      moreBtn.addEventListener("click", () => {
        visibleLimit += 12;
        renderGrid();
      });
    }

    renderGrid();
  }

  /* ==========================================================================
     Direct "Get in Touch" Contact Form (/api/contact)
     ========================================================================== */
  const contactForm = document.getElementById("direct-contact-form");
  const contactMsg = document.getElementById("contact-message");
  const contactEmail = document.getElementById("contact-email");
  const contactMsgErr = document.getElementById("contact-msg-error");
  const contactEmailErr = document.getElementById("contact-email-error");
  const contactSubmitBtn = document.getElementById("contact-submit-btn");
  const contactStatus = document.getElementById("contact-status");

  function validateContactMsg() {
    if (!contactMsg) return true;
    const valid = contactMsg.value.trim().length >= 2;
    contactMsg.setAttribute("aria-invalid", String(!valid));
    if (contactMsgErr) contactMsgErr.hidden = valid;
    return valid;
  }

  function validateContactEmail() {
    if (!contactEmail) return true;
    const val = contactEmail.value.trim();
    const valid = !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
    contactEmail.setAttribute("aria-invalid", String(!valid));
    if (contactEmailErr) contactEmailErr.hidden = valid;
    return valid;
  }

  if (contactMsg) {
    let touched = false;
    contactMsg.addEventListener("blur", () => {
      if (contactMsg.value.length > 0 || touched) {
        touched = true;
        validateContactMsg();
      }
    });
    contactMsg.addEventListener("input", () => {
      if (contactMsg.getAttribute("aria-invalid") === "true") validateContactMsg();
    });
  }

  if (contactEmail) {
    contactEmail.addEventListener("blur", () => {
      if (contactEmail.value.length > 0) validateContactEmail();
    });
    contactEmail.addEventListener("input", () => {
      if (contactEmail.getAttribute("aria-invalid") === "true") validateContactEmail();
    });
  }

  if (contactForm) {
    contactForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msgOk = validateContactMsg();
      const emailOk = validateContactEmail();
      if (!msgOk) {
        contactMsg?.focus();
        return;
      }
      if (!emailOk) {
        contactEmail?.focus();
        return;
      }

      if (contactSubmitBtn) contactSubmitBtn.disabled = true;
      if (contactStatus) contactStatus.textContent = "Sending message…";

      const payload = {
        message: contactMsg?.value.trim() || "",
        name: document.getElementById("contact-name")?.value.trim() || "",
        email: contactEmail?.value.trim() || "",
        website: document.getElementById("contact-website")?.value || ""
      };

      try {
        const res = await fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Could not send message right now.");
        }
        contactForm.reset();
        contactMsg?.removeAttribute("aria-invalid");
        contactEmail?.removeAttribute("aria-invalid");
        if (contactStatus) {
          contactStatus.textContent = "✓ Message sent! Matt received your email.";
        }
      } catch (err) {
        if (contactStatus) {
          contactStatus.textContent = err.message || "Could not send right now—email shout@mattbriselli.com directly.";
        }
      } finally {
        if (contactSubmitBtn) contactSubmitBtn.disabled = false;
      }
    });
  }

  /* ==========================================================================
     Hosted Letterboxd Reviews (@brslli) + Auto-Updating Edge RSS Sync
     ========================================================================== */
  const lbGrid = document.getElementById("letterboxd-grid");
  const lbMoreBtn = document.getElementById("lb-more-btn");
  const lbCountLabel = document.getElementById("lb-count-label");
  const lbSearchInput = document.getElementById("lb-search-input");
  const lbShuffleBtn = document.getElementById("lb-shuffle-btn");
  const lbFavShelf = document.getElementById("lb-favorites-shelf");
  const lbFavList = document.getElementById("lb-favorites-list");

  let allLbReviews = [];
  let activeLbFilter = "latest";
  let lbSearchQuery = "";
  let lbVisibleCount = 6;
  let lbShuffledOrder = null;

  const posterCache = new Map();
  try {
    const cachedRaw = localStorage.getItem("mlb_lb_posters_v1");
    if (cachedRaw) {
      const parsed = JSON.parse(cachedRaw);
      for (const [k, v] of Object.entries(parsed)) {
        if (v) posterCache.set(k, v);
      }
    }
  } catch {
    // ignore storage limits
  }

  function savePosterCache() {
    try {
      if (posterCache.size > 2000) return;
      localStorage.setItem("mlb_lb_posters_v1", JSON.stringify(Object.fromEntries(posterCache)));
    } catch {
      // ignore
    }
  }

  async function resolvePosterForReview(rev, frameEl) {
    const cacheKey = rev.filmBoxdId || `${rev.filmTitle}|${rev.filmYear}`;
    if (posterCache.has(cacheKey)) {
      const url = posterCache.get(cacheKey);
      if (url) attachPosterImg(frameEl, url, rev);
      return;
    }
    const params = new URLSearchParams();
    if (rev.filmBoxdId) params.set("id", rev.filmBoxdId);
    params.set("title", rev.filmTitle);
    if (rev.filmYear) params.set("year", String(rev.filmYear));

    try {
      const res = await fetch(`/api/lb-poster?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok && data.poster) {
        rev.poster = data.poster;
        posterCache.set(cacheKey, data.poster);
        savePosterCache();
        if (frameEl.isConnected) attachPosterImg(frameEl, data.poster, rev);
      }
    } catch {
      // keep clean cinema-slate fallback
    }
  }

  function attachPosterImg(frameEl, posterUrl, rev) {
    if (!posterUrl || frameEl.querySelector("img.lb-poster")) return;
    const img = document.createElement("img");
    img.className = "lb-poster";
    img.src = posterUrl;
    img.alt = `${rev.filmTitle} (${rev.filmYear}) poster`;
    img.width = 200;
    img.height = 300;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("load", () => {
      frameEl.classList.add("has-poster");
    });
    img.addEventListener("error", () => {
      frameEl.classList.remove("has-poster");
      img.remove();
    });
    frameEl.classList.add("has-poster");
    frameEl.appendChild(img);
  }

  function renderLbFavorites(favorites) {
    if (!lbFavShelf || !lbFavList || !Array.isArray(favorites) || !favorites.length) return;
    lbFavList.innerHTML = "";
    for (const fav of favorites) {
      const li = document.createElement("li");
      li.className = "lb-fav-item";
      const a = document.createElement("a");
      a.href = fav.link || "https://letterboxd.com/brslli/";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", `${fav.filmTitle} (${fav.filmYear}) — Favorite film on Letterboxd`);

      if (fav.poster) {
        const img = document.createElement("img");
        img.className = "lb-fav-poster";
        img.src = fav.poster;
        img.alt = `${fav.filmTitle} (${fav.filmYear})`;
        img.width = 104;
        img.height = 156;
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        a.appendChild(img);
      } else {
        a.textContent = fav.filmTitle;
      }
      li.appendChild(a);
      lbFavList.appendChild(li);
    }
    lbFavShelf.hidden = false;
  }

  function formatStars(rating) {
    if (typeof rating !== "number" || rating <= 0) return "";
    const full = Math.floor(rating);
    const half = rating - full >= 0.5 ? "½" : "";
    return "★".repeat(full) + half;
  }

  function getFilteredLbReviews() {
    let list = lbShuffledOrder ? lbShuffledOrder.slice() : allLbReviews.slice();
    if (activeLbFilter === "five") {
      list = list.filter((r) => r.rating === 5);
    } else if (activeLbFilter === "favorites") {
      list = list.filter((r) => (r.rating || 0) >= 4);
    } else if (activeLbFilter === "liked") {
      list = list.filter((r) => r.liked);
    } else if (activeLbFilter === "theatres") {
      list = list.filter((r) => r.inTheatres);
    }
    if (lbSearchQuery) {
      const q = lbSearchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.filmTitle.toLowerCase().includes(q) ||
          String(r.filmYear || "").includes(q) ||
          (r.paragraphs || []).some((p) => p.toLowerCase().includes(q)) ||
          (r.spoilerParagraphs || []).some((p) => p.toLowerCase().includes(q))
      );
    }
    return list;
  }

  function renderLbReviews() {
    if (!lbGrid) return;
    const matches = getFilteredLbReviews();
    const visible = matches.slice(0, lbVisibleCount);
    lbGrid.innerHTML = "";

    for (const rev of visible) {
      const li = document.createElement("li");
      li.className = "lb-card";

      const posterFrame = document.createElement("div");
      posterFrame.className = "lb-poster-frame";
      const fbTitle = document.createElement("span");
      fbTitle.className = "lb-poster-fallback-title";
      fbTitle.setAttribute("aria-hidden", "true");
      fbTitle.textContent = rev.filmTitle;
      const fbYear = document.createElement("span");
      fbYear.className = "lb-poster-fallback-year";
      fbYear.setAttribute("aria-hidden", "true");
      fbYear.textContent = rev.filmYear || "";
      posterFrame.append(fbTitle, fbYear);

      if (rev.poster) {
        attachPosterImg(posterFrame, rev.poster, rev);
      } else {
        resolvePosterForReview(rev, posterFrame);
      }

      const body = document.createElement("div");
      body.className = "lb-body";

      const titleRow = document.createElement("div");
      titleRow.className = "lb-title-row";
      const h4 = document.createElement("h4");
      h4.textContent = rev.filmTitle;
      const yearSpan = document.createElement("span");
      yearSpan.className = "lb-year";
      yearSpan.textContent = rev.filmYear || "";
      titleRow.append(h4, yearSpan);

      const metaRow = document.createElement("div");
      metaRow.className = "lb-meta-row";
      const starsStr = formatStars(rev.rating);
      if (starsStr) {
        const starsEl = document.createElement("span");
        starsEl.className = "lb-stars";
        starsEl.setAttribute("aria-label", `${rev.rating} out of 5 stars`);
        starsEl.textContent = starsStr;
        metaRow.appendChild(starsEl);
      }
      if (rev.liked) {
        const heart = document.createElement("span");
        heart.className = "lb-stars";
        heart.setAttribute("aria-label", "Liked");
        heart.textContent = "♥";
        metaRow.appendChild(heart);
      }
      if (rev.inTheatres) {
        const th = document.createElement("span");
        th.className = "lb-date";
        th.textContent = "🎟️ Theatre";
        metaRow.appendChild(th);
      }
      if (rev.rewatch) {
        const rw = document.createElement("span");
        rw.className = "lb-date";
        rw.textContent = "↻ Rewatch";
        metaRow.appendChild(rw);
      }
      if (rev.watchedDate) {
        const dt = document.createElement("time");
        dt.className = "lb-date";
        dt.dateTime = rev.watchedDate;
        dt.textContent = rev.watchedDate;
        metaRow.appendChild(dt);
      }

      const textWrap = document.createElement("div");
      textWrap.className = "lb-review-text";
      const paras = rev.paragraphs || [];
      for (const pText of paras.slice(0, 3)) {
        const p = document.createElement("p");
        p.textContent = pText;
        textWrap.appendChild(p);
      }

      if (paras.length > 3) {
        const moreDetails = document.createElement("details");
        moreDetails.className = "lb-disclosure";
        const moreSummary = document.createElement("summary");
        moreSummary.textContent = `Read full review (+${paras.length - 3} more)`;
        moreDetails.appendChild(moreSummary);
        for (const pText of paras.slice(3)) {
          const p = document.createElement("p");
          p.textContent = pText;
          moreDetails.appendChild(p);
        }
        textWrap.appendChild(moreDetails);
      }

      if (Array.isArray(rev.spoilerParagraphs) && rev.spoilerParagraphs.length) {
        const spDetails = document.createElement("details");
        spDetails.className = "lb-disclosure lb-spoiler";
        const spSummary = document.createElement("summary");
        spSummary.textContent = "Spoilers — click to reveal";
        spDetails.appendChild(spSummary);
        for (const pText of rev.spoilerParagraphs) {
          const p = document.createElement("p");
          p.textContent = pText;
          spDetails.appendChild(p);
        }
        textWrap.appendChild(spDetails);
      }

      const link = document.createElement("a");
      link.className = "lb-permalink";
      link.href = rev.link || "https://letterboxd.com/brslli/";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "View on Letterboxd ↗";

      body.append(titleRow, metaRow, textWrap, link);
      li.append(posterFrame, body);
      lbGrid.appendChild(li);
    }

    if (lbMoreBtn) {
      lbMoreBtn.hidden = matches.length <= lbVisibleCount;
      if (!lbMoreBtn.hidden) {
        lbMoreBtn.textContent = `Show More Reviews (${(matches.length - lbVisibleCount).toLocaleString()} remaining)`;
      }
    }
    if (lbCountLabel) {
      lbCountLabel.textContent = matches.length
        ? `Showing ${visible.length.toLocaleString()} of ${matches.length.toLocaleString()} hosted reviews`
        : "No matching reviews found.";
    }
  }

  function mergeLbReviews(freshList) {
    if (!Array.isArray(freshList) || !freshList.length) return;
    const existingByMatchKey = new Map();
    for (const r of allLbReviews) {
      const k = `${String(r.filmTitle).toLowerCase()}|${r.filmYear}|${r.watchedDate}`;
      existingByMatchKey.set(k, r);
    }

    const brandNew = [];
    for (const fresh of freshList) {
      const k = `${String(fresh.filmTitle).toLowerCase()}|${fresh.filmYear}|${fresh.watchedDate}`;
      const match = existingByMatchKey.get(k);
      if (match) {
        if (!match.poster && fresh.poster) match.poster = fresh.poster;
        if (fresh.link) match.link = fresh.link;
      } else {
        brandNew.push(fresh);
      }
    }

    if (brandNew.length) {
      allLbReviews = [...brandNew, ...allLbReviews];
      const latestChip = document.querySelector('[data-lb-filter="latest"]');
      if (latestChip) {
        latestChip.textContent = `Latest (${allLbReviews.length.toLocaleString()})`;
      }
      const statReviews = document.getElementById("lb-stat-reviews");
      if (statReviews) {
        statReviews.textContent = allLbReviews.length.toLocaleString();
      }
    }
    renderLbReviews();
  }

  if (lbGrid) {
    document.querySelectorAll("[data-lb-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeLbFilter = btn.getAttribute("data-lb-filter") || "latest";
        lbShuffledOrder = null;
        lbVisibleCount = 6;
        document.querySelectorAll("[data-lb-filter]").forEach((b) => {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        renderLbReviews();
      });
    });

    if (lbShuffleBtn) {
      lbShuffleBtn.addEventListener("click", () => {
        lbShuffledOrder = shuffleArray(allLbReviews);
        lbVisibleCount = 6;
        renderLbReviews();
      });
    }

    if (lbSearchInput) {
      lbSearchInput.addEventListener("input", () => {
        lbSearchQuery = lbSearchInput.value.trim();
        lbVisibleCount = 6;
        renderLbReviews();
      });
    }

    if (lbMoreBtn) {
      lbMoreBtn.addEventListener("click", () => {
        lbVisibleCount += 12;
        renderLbReviews();
      });
    }

    const LB_CACHE_NAME = "mlb-letterboxd-archive-v1";
    const LB_RSS_DELTA_KEY = "mlb_lb_rss_delta_v1";
    const LB_ARCHIVE_URL = "data/letterboxd-reviews.json";

    function applyLbArchiveData(data) {
      if (!data) return;
      allLbReviews = Array.isArray(data.reviews) ? data.reviews : [];
      if (data.stats) {
        const setStat = (id, val) => {
          const el = document.getElementById(id);
          if (el && typeof val === "number") el.textContent = val.toLocaleString();
        };
        setStat("lb-stat-watched", data.stats.watchedCount);
        setStat("lb-stat-reviews", data.stats.reviewCount);
        setStat("lb-stat-theatres", data.stats.theatreCount);
        setStat("lb-stat-liked", data.stats.likedCount);
      }
      renderLbFavorites(data.favorites);
      // Immediately overlay any cached RSS delta reviews before network responds
      try {
        const rawDelta = localStorage.getItem(LB_RSS_DELTA_KEY);
        if (rawDelta) {
          const cachedRss = JSON.parse(rawDelta);
          if (Array.isArray(cachedRss) && cachedRss.length) {
            mergeLbReviews(cachedRss);
            return;
          }
        }
      } catch {}
      renderLbReviews();
    }

    async function loadLetterboxdWithCache() {
      let renderedFromCache = false;
      if ("caches" in window) {
        try {
          const cache = await caches.open(LB_CACHE_NAME);
          const cachedRes = await cache.match(LB_ARCHIVE_URL);
          if (cachedRes) {
            const cachedData = await cachedRes.json();
            applyLbArchiveData(cachedData);
            restoreReloadSectionPosition();
            renderedFromCache = true;
          }
        } catch {}
      }

      // Network fetch (stale-while-revalidate if already rendered from Cache Storage)
      try {
        const netRes = await fetch(LB_ARCHIVE_URL);
        if (netRes.ok) {
          const cloneForCache = netRes.clone();
          const freshData = await netRes.json();
          if (!renderedFromCache || freshData?.updatedAt) {
            applyLbArchiveData(freshData);
            if (!renderedFromCache) restoreReloadSectionPosition();
          }
          if ("caches" in window) {
            caches
              .open(LB_CACHE_NAME)
              .then((c) => c.put(LB_ARCHIVE_URL, cloneForCache))
              .catch(() => {});
          }
        }
      } catch {}

      // Refresh from live Cloudflare edge RSS endpoint & persist delta locally
      try {
        const rssRes = await fetch("/api/letterboxd");
        if (rssRes.ok) {
          const live = await rssRes.json();
          if (live?.ok && Array.isArray(live.reviews)) {
            try {
              localStorage.setItem(LB_RSS_DELTA_KEY, JSON.stringify(live.reviews));
            } catch {}
            mergeLbReviews(live.reviews);
          }
        }
      } catch {}
    }

    loadLetterboxdWithCache();
  }
})();
