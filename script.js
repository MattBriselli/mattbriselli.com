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
     Leaflet + Natural Earth GeoJSON (176 Countries + 50 US States) +
     Synced HTML5 Canvas Thermal Heatmap & Global Photo Slideshow
     ========================================================================== */
  const mapContainer = document.getElementById("leaflet-world-map");
  const canvas = document.getElementById("world-heatmap-canvas");
  if (!mapContainer || !canvas || typeof window.L === "undefined") return;
  const ctx = canvas.getContext("2d");
  const statusLineEl = document.getElementById("map-status-line");

  const REGION_PRESETS = {
    world: { lat: 28, lng: -15, zoom: 2, label: "Whole World (39 Countries · All 50 US States · 66,085 Photos)" },
    nyc: { lat: 40.55, lng: -75.2, zoom: 6, label: "NYC, Philadelphia, Pittsburgh & East Coast" },
    west: { lat: 42.5, lng: -122.2, zoom: 5, label: "San Francisco (6 yrs), Seattle & West Coast" },
    us50: { lat: 39.5, lng: -98.5, zoom: 4, label: "All 50 US States Visited" },
    "central-asia": { lat: 42.2, lng: 67.5, zoom: 5, label: "Central Asia (Kazakhstan · Kyrgyzstan · Uzbekistan · Tajikistan · Turkmenistan)" },
    canada: { lat: 52.0, lng: -97.0, zoom: 4, label: "8 Canadian Provinces & Territories Explored" },
    "europe-apac": { lat: 34.0, lng: 55.0, zoom: 3, label: "Europe & Asia-Pacific Across 39 Countries Visited" }
  };

  let mapsData = null;
  let flightyData = null;
  let filteredPlaces = [];
  let activePlaceIndex = 0;
  let activePhotoIndex = 0;
  let previousPlace = null;

  let showHeatmap = true;
  let showPins = true;
  let showArcs = true;
  let showCanadaDrive = true;
  let autoPlayTimer = null;

  // Initialize Leaflet map
  const map = L.map(mapContainer, {
    center: [REGION_PRESETS.world.lat, REGION_PRESETS.world.lng],
    zoom: REGION_PRESETS.world.zoom,
    minZoom: 2,
    maxZoom: 16,
    zoomControl: false,
    attributionControl: false,
    worldCopyJump: true
  });

  // Keyless Esri World Gray Canvas base + reference label tiles (zero API key required, works on any domain)
  let baseTileLayer = null;
  let labelTileLayer = null;
  let countriesLayer = null;
  let statesLayer = null;
  const flightArcsLayerGroup = L.layerGroup().addTo(map);
  const canadaDriveLayerGroup = L.layerGroup().addTo(map);
  const pinsLayerGroup = L.layerGroup().addTo(map);
  const placeMarkers = [];

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
    if (!showArcs || !flightyData) return;

    const dark = isDarkActive();
    const airportByCode = new Map(
      (flightyData.airports || []).map((a) => [a.code, a])
    );

    // 1. Great-circle Flighty routes (thickness & opacity scaled by flight frequency)
    for (const r of flightyData.routes || []) {
      const a1 = airportByCode.get(r.from);
      const a2 = airportByCode.get(r.to);
      if (!a1 || !a2) continue;
      const segments = buildGreatCircleSegments(a1.lat, a1.lng, a2.lat, a2.lng, 34);
      const weight = Math.min(3.4, 1.15 + Math.log2(r.count) * 0.65);
      const opacity = Math.min(0.82, 0.34 + Math.log2(r.count) * 0.16);
      const stroke = dark ? "#5ec28f" : "#1f6b45";
      const label = `<strong>✈️ ${r.from} ↔ ${r.to}</strong><br>${a1.city} ↔ ${a2.city}<br>${r.count} ${r.count === 1 ? "flight" : "flights"} · ${formatNumber(r.miles)} mi`;

      for (const seg of segments) {
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

    // 2. Subtle airport hub nodes across all 83 airports
    for (const ap of flightyData.airports || []) {
      const dot = L.circleMarker([ap.lat, ap.lng], {
        radius: Math.min(5.5, 2.2 + Math.log2(ap.visits + 1) * 0.55),
        color: dark ? "#111110" : "#faf8f5",
        weight: 0.9,
        fillColor: dark ? "#5ec28f" : "#1f6b45",
        fillOpacity: 0.85
      });
      dot.bindTooltip(
        `<strong>${ap.code}</strong> · ${ap.city}<br>${ap.visits} ${ap.visits === 1 ? "flight leg" : "flight legs"}`,
        { direction: "top" }
      );
      dot.addTo(flightArcsLayerGroup);
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
    if (!showCanadaDrive) return;
    const dark = isDarkActive();
    const drivenColor = dark ? "#6ea8fe" : "#2457c5";
    const gapColor = dark ? "#7c8899" : "#6c788a";

    for (const seg of CANADA_DRIVE_SEGMENTS) {
      const poly = L.polyline(seg.coords, {
        color: seg.driven ? drivenColor : gapColor,
        weight: seg.driven ? 3.4 : 1.8,
        opacity: seg.driven ? 0.92 : 0.55,
        dashArray: seg.driven ? null : "5,6",
        smoothFactor: 1.1
      });
      poly.bindTooltip(`<strong>${seg.title}</strong><br>${seg.note}`, {
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
        radius: 4.5,
        color: dark ? "#111110" : "#ffffff",
        weight: 1.5,
        fillColor: drivenColor,
        fillOpacity: 0.95
      });
      dot.bindTooltip(`<strong>🚗 ${ep.name}</strong>`, { direction: "top" });
      dot.addTo(canadaDriveLayerGroup);
    }
  }

  // Region + Era stratified interleave so consecutive slides rotate across continents AND years
  function buildBalancedDeck(items) {
    const buckets = new Map();
    for (const item of items) {
      const year = item.date ? item.date.slice(0, 4) : "classic";
      const geo =
        item.tag === "hall-of-fame"
          ? "hof"
          : item.region === "international" || item.region === "central-asia"
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
    const visited = feature?.properties?.visited;
    return {
      fillColor: visited
        ? (dark ? "#2c251f" : "#e7ddd0")
        : (dark ? "#1d1c1a" : "#ece8e0"),
      fillOpacity: 0.78,
      color: visited
        ? (dark ? "#5e4c3e" : "#b5a490")
        : (dark ? "#33312d" : "#cfc9be"),
      weight: visited ? 1.1 : 0.7
    };
  }

  function getStateStyle() {
    const dark = isDarkActive();
    return {
      fillColor: dark ? "#2e2620" : "#e5dacb",
      fillOpacity: 0.45,
      color: dark ? "#5c4b3e" : "#b8a793",
      weight: 0.75,
      dashArray: "2,2"
    };
  }

  function updateTileLayer() {
    const dark = isDarkActive();
    const baseUrl = dark
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
      : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
    const labelUrl = dark
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
      : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}";

    if (baseTileLayer) {
      baseTileLayer.setUrl(baseUrl);
    } else {
      baseTileLayer = L.tileLayer(baseUrl, {
        maxZoom: 16,
        opacity: 0.55
      }).addTo(map);
    }

    if (labelTileLayer) {
      labelTileLayer.setUrl(labelUrl);
    } else {
      labelTileLayer = L.tileLayer(labelUrl, {
        maxZoom: 16,
        opacity: 0.85
      }).addTo(map);
    }
  }

  function syncMapTheme() {
    const dark = isDarkActive();
    mapContainer.style.backgroundColor = dark ? "#121211" : "#f2efe9";
    if (countriesLayer) countriesLayer.setStyle(getCountryStyle);
    if (statesLayer) statesLayer.setStyle(getStateStyle);
    updateTileLayer();
    rebuildFlightArcs();
    rebuildCanadaDrive();
    rebuildMarkers();
    drawHeatmapOverlay();
  }

  // Load crisp local Natural Earth 176 Countries + 50 US States GeoJSON
  Promise.all([
    fetch("data/world-countries.json").then((r) => r.json()).catch(() => null),
    fetch("data/us-states.json").then((r) => r.json()).catch(() => null)
  ]).then(([countriesGeo, statesGeo]) => {
    if (countriesGeo) {
      countriesLayer = L.geoJSON(countriesGeo, {
        style: getCountryStyle,
        onEachFeature: (feature, layer) => {
          if (feature.properties && feature.properties.name) {
            const tag = feature.properties.visited ? " · Visited & Photographed" : "";
            layer.bindTooltip(`${feature.properties.name}${tag}`, {
              sticky: true,
              direction: "top"
            });
          }
        }
      }).addTo(map);
      countriesLayer.bringToBack();
    }
    if (statesGeo) {
      statesLayer = L.geoJSON(statesGeo, {
        style: getStateStyle,
        onEachFeature: (feature, layer) => {
          if (feature.properties && feature.properties.name) {
            layer.bindTooltip(`${feature.properties.name} (All 50 US States Visited)`, {
              sticky: true,
              direction: "top"
            });
          }
        }
      }).addTo(map);
    }
    updateTileLayer();
    rebuildFlightArcs();
    rebuildCanadaDrive();
    rebuildMarkers();
    drawHeatmapOverlay();
  });

  function resizeOverlayCanvas() {
    const rect = mapContainer.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(300, Math.round(rect.width * dpr));
    canvas.height = Math.max(200, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawHeatmapOverlay();
  }

  window.addEventListener("resize", resizeOverlayCanvas);

  function drawHeatmapOverlay() {
    const rect = mapContainer.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);
    if (!mapsData) return;

    const dark = isDarkActive();
    const zoom = map.getZoom();

    // 1. Draw Radial Thermal Photo Heatmap over exact Leaflet lat/lng container coordinates
    if (showHeatmap && Array.isArray(mapsData.heatmapClusters)) {
      ctx.save();
      for (const c of mapsData.heatmapClusters) {
        const pt = map.latLngToContainerPoint([c.lat, c.lng]);
        if (pt.x < -90 || pt.x > width + 90 || pt.y < -90 || pt.y > height + 90) continue;
        const weight = c.weight || 0.75;
        const radius = Math.max(16, Math.min(62, (11 + zoom * 4.5) * weight));
        const grad = ctx.createRadialGradient(pt.x, pt.y, 2, pt.x, pt.y, radius);
        if (dark) {
          grad.addColorStop(0, `rgba(255, 165, 95, ${0.62 * weight})`);
          grad.addColorStop(0.45, `rgba(232, 108, 64, ${0.32 * weight})`);
          grad.addColorStop(1, "rgba(232, 108, 64, 0)");
        } else {
          grad.addColorStop(0, `rgba(185, 50, 22, ${0.52 * weight})`);
          grad.addColorStop(0.5, `rgba(228, 120, 45, ${0.25 * weight})`);
          grad.addColorStop(1, "rgba(228, 120, 45, 0)");
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  map.on("move zoom viewreset moveend zoomend", drawHeatmapOverlay);

  function rebuildMarkers() {
    pinsLayerGroup.clearLayers();
    placeMarkers.length = 0;
    if (!showPins || !mapsData) return;

    const dark = isDarkActive();

    // 1. Background cluster pins (all 50 states, Central Asia cities, Canadian provinces, Europe, China, Australia)
    if (Array.isArray(mapsData.heatmapClusters)) {
      for (const c of mapsData.heatmapClusters) {
        const label = c.label || c.name || "Visited Cluster";
        const cm = L.circleMarker([c.lat, c.lng], {
          radius: 3.5,
          color: dark ? "#111110" : "#faf8f5",
          weight: 1,
          fillColor: dark ? "#e8993a" : "#c45a28",
          fillOpacity: 0.78
        });
        cm.bindTooltip(label, { direction: "top" });
        cm.on("click", () => {
          map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 6), { duration: 0.9 });
          if (statusLineEl) statusLineEl.textContent = `Exploring: ${label}`;
        });
        cm.addTo(pinsLayerGroup);
      }
    }

    // 2. Featured Photo Slideshow Dispatch Markers
    filteredPlaces.forEach((pl, idx) => {
      const isActive = idx === activePlaceIndex;
      const marker = L.circleMarker([pl.lat, pl.lng], {
        radius: isActive ? 8.5 : 6,
        color: dark ? "#111110" : "#ffffff",
        weight: 2,
        fillColor: isActive
          ? (dark ? "#5ec28f" : "#1f6b45")
          : (dark ? "#e88264" : "#9e3b24"),
        fillOpacity: 1
      });
      const metric = pl.views
        ? ` · ${formatNumber(pl.views)} views`
        : pl.rating
          ? ` · ${"★".repeat(pl.rating)}`
          : "";
      marker.bindTooltip(`<strong>${pl.name}</strong><br>${pl.location}${metric}`, {
        direction: "top"
      });
      marker.on("click", () => {
        selectPlace(idx, true);
      });
      marker.addTo(pinsLayerGroup);
      placeMarkers.push(marker);
      if (isActive) marker.bringToFront();
    });
  }

  function formatNumber(n) {
    return typeof n === "number" ? n.toLocaleString("en-US") : String(n);
  }

  function formatCoords(lat, lng) {
    const ns = lat >= 0 ? "N" : "S";
    const ew = lng >= 0 ? "E" : "W";
    return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lng).toFixed(2)}°${ew}`;
  }

  function renderActiveSlide(shouldFly = false) {
    if (!filteredPlaces.length) return;
    const place = filteredPlaces[activePlaceIndex];
    const photos = place.photos || [];
    const mainPhoto = photos[activePhotoIndex] || photos[0] || "";

    const counterEl = document.getElementById("slide-counter");
    const imgEl = document.getElementById("slide-main-img");
    const metricEl = document.getElementById("slide-metric-pill");
    const thumbsEl = document.getElementById("slide-thumbs");
    const catEl = document.getElementById("slide-category");
    const coordsEl = document.getElementById("slide-coords");
    const titleEl = document.getElementById("slide-title");
    const locEl = document.getElementById("slide-location");
    const descEl = document.getElementById("slide-description");
    const mapsLinkEl = document.getElementById("slide-maps-link");

    if (counterEl) {
      counterEl.textContent = `Dispatch ${activePlaceIndex + 1} of ${filteredPlaces.length}`;
    }
    if (imgEl && mainPhoto) {
      imgEl.src = mainPhoto;
      imgEl.alt = `${place.name} — ${place.location}`;
    }
    if (metricEl) {
      if (place.views) {
        metricEl.textContent = `👁 ${formatNumber(place.views)} views`;
      } else if (place.rating) {
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
          thumbImg.referrerPolicy = "no-referrer";
          thumbImg.loading = "lazy";
          btn.appendChild(thumbImg);

          btn.addEventListener("click", () => {
            activePhotoIndex = idx;
            renderActiveSlide(false);
          });
          thumbsEl.appendChild(btn);
        });
      }
    }

    rebuildMarkers();

    if (shouldFly) {
      const targetZoom = Math.max(map.getZoom(), 5);
      map.flyTo([place.lat, place.lng], targetZoom, { duration: 0.9 });
      if (statusLineEl) {
        statusLineEl.textContent = `${place.name} · ${place.location}`;
      }
    } else {
      drawHeatmapOverlay();
    }
  }

  function selectPlace(index, shouldFly = true, randomizePhoto = false) {
    if (!filteredPlaces.length) return;
    previousPlace = filteredPlaces[activePlaceIndex] || null;
    activePlaceIndex = (index + filteredPlaces.length) % filteredPlaces.length;
    const photos = filteredPlaces[activePlaceIndex]?.photos || [];
    activePhotoIndex = randomizePhoto && photos.length > 1
      ? Math.floor(Math.random() * photos.length)
      : 0;
    renderActiveSlide(shouldFly);
  }

  function populateTopViewsTable(ledger) {
    const tbody = document.getElementById("top-views-tbody");
    if (!tbody || !Array.isArray(ledger)) return;
    tbody.innerHTML = "";
    ledger.forEach((item, idx) => {
      const tr = document.createElement("tr");

      const tdRank = document.createElement("td");
      tdRank.textContent = `#${idx + 1}`;

      const tdName = document.createElement("td");
      const strong = document.createElement("strong");
      strong.textContent = item.name;
      tdName.appendChild(strong);

      const tdLoc = document.createElement("td");
      tdLoc.textContent = item.location;

      const tdViews = document.createElement("td");
      tdViews.textContent = `${formatNumber(item.views)} views`;

      const tdAction = document.createElement("td");
      const flyBtn = document.createElement("button");
      flyBtn.type = "button";
      flyBtn.className = "table-fly-btn";
      flyBtn.textContent = "Fly to Pin";
      flyBtn.addEventListener("click", () => {
        const matchIdx = filteredPlaces.findIndex(
          (p) => p.name.toLowerCase().includes(item.name.split(" ")[0].toLowerCase())
        );
        if (matchIdx !== -1) {
          selectPlace(matchIdx, false);
        }
        map.flyTo([item.lat, item.lng], 10, { duration: 1.0 });
        if (statusLineEl) {
          statusLineEl.textContent = `Centered on ${item.name} (${item.location}) — ${formatNumber(item.views)} views`;
        }
        mapContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      tdAction.appendChild(flyBtn);

      tr.append(tdRank, tdName, tdLoc, tdViews, tdAction);
      tbody.appendChild(tr);
    });
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

  let mapViewMode = "interactive";
  let smScale = 1;
  let smTx = 0;
  let smTy = 0;

  document.querySelectorAll("[data-region-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-region-preset") || "world";
      const preset = REGION_PRESETS[key] || REGION_PRESETS.world;
      document.querySelectorAll("[data-region-preset]").forEach((other) => {
        other.setAttribute("aria-pressed", String(other === btn));
      });
      if (mapViewMode === "static") {
        focusStaticPreset(key);
      } else {
        map.flyTo([preset.lat, preset.lng], preset.zoom, { duration: 1.0 });
      }
      if (statusLineEl) statusLineEl.textContent = preset.label;
    });
  });

  document.querySelectorAll("[data-slide-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mapsData) return;
      const filter = btn.getAttribute("data-slide-filter") || "all";
      document.querySelectorAll("[data-slide-filter]").forEach((other) => {
        other.setAttribute("aria-pressed", String(other === btn));
      });
      filteredPlaces =
        filter === "all"
          ? buildBalancedDeck(mapsData.places)
          : shuffleArray(mapsData.places.filter((p) => p.tag === filter));
      activePlaceIndex = 0;
      const firstPhotos = filteredPlaces[0]?.photos || [];
      activePhotoIndex = firstPhotos.length > 1 ? Math.floor(Math.random() * firstPhotos.length) : 0;
      renderActiveSlide(true);
    });
  });

  const heatBtn = document.getElementById("toggle-heatmap-btn");
  const pinsBtn = document.getElementById("toggle-pins-btn");
  const arcsBtn = document.getElementById("toggle-arcs-btn");
  const zoomInBtn = document.getElementById("map-zoom-in");
  const zoomOutBtn = document.getElementById("map-zoom-out");
  const resetBtn = document.getElementById("map-reset-btn");
  const viewInteractiveBtn = document.getElementById("view-interactive-map-btn");
  const viewStaticBtn = document.getElementById("view-static-map-btn");
  const mapCanvasWrap = document.getElementById("map-canvas-wrap");
  const staticMapWrap = document.getElementById("static-countries-map-wrap");
  const staticViewport = document.getElementById("static-map-viewport");
  const staticImg = document.getElementById("static-countries-img");
  const mapDataToggles = document.getElementById("map-data-toggles");
  const mapLegend = document.querySelector(".map-legend");

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

  function setMapViewMode(mode) {
    mapViewMode = mode;
    const isStatic = mode === "static";
    if (viewInteractiveBtn) viewInteractiveBtn.setAttribute("aria-pressed", String(!isStatic));
    if (viewStaticBtn) viewStaticBtn.setAttribute("aria-pressed", String(isStatic));
    if (mapCanvasWrap) mapCanvasWrap.hidden = isStatic;
    if (staticMapWrap) staticMapWrap.hidden = !isStatic;
    if (mapDataToggles) mapDataToggles.hidden = isStatic;
    if (mapLegend) mapLegend.hidden = isStatic;
    if (isStatic) {
      applyStaticTransform(false);
    } else {
      map.invalidateSize();
      resizeOverlayCanvas();
    }
    if (statusLineEl) {
      statusLineEl.textContent = isStatic
        ? "39-Country & 50-State Map · Scroll or use + / − to zoom, drag to pan, or click Fly To presets"
        : "Drag to pan · Scroll or use buttons to zoom · Click any glowing pin to view photos";
    }
  }

  if (viewInteractiveBtn) {
    viewInteractiveBtn.addEventListener("click", () => setMapViewMode("interactive"));
  }
  if (viewStaticBtn) {
    viewStaticBtn.addEventListener("click", () => setMapViewMode("static"));
  }
  const shuffleBtn = document.getElementById("slide-shuffle-btn");
  const prevBtn = document.getElementById("slide-prev-btn");
  const nextBtn = document.getElementById("slide-next-btn");
  const autoBtn = document.getElementById("slide-autoplay-btn");
  const flyBtn = document.getElementById("slide-fly-btn");

  if (shuffleBtn) {
    shuffleBtn.addEventListener("click", () => {
      if (filteredPlaces.length <= 1) return;
      let nextIdx = activePlaceIndex;
      while (nextIdx === activePlaceIndex) {
        nextIdx = Math.floor(Math.random() * filteredPlaces.length);
      }
      selectPlace(nextIdx, true, true);
    });
  }

  if (heatBtn) {
    heatBtn.addEventListener("click", () => {
      showHeatmap = !showHeatmap;
      heatBtn.setAttribute("aria-pressed", String(showHeatmap));
      drawHeatmapOverlay();
    });
  }
  if (pinsBtn) {
    pinsBtn.addEventListener("click", () => {
      showPins = !showPins;
      pinsBtn.setAttribute("aria-pressed", String(showPins));
      rebuildMarkers();
    });
  }
  if (arcsBtn) {
    arcsBtn.addEventListener("click", () => {
      showArcs = !showArcs;
      arcsBtn.setAttribute("aria-pressed", String(showArcs));
      rebuildFlightArcs();
    });
  }
  const canadaDriveBtn = document.getElementById("toggle-canada-drive-btn");
  if (canadaDriveBtn) {
    canadaDriveBtn.addEventListener("click", () => {
      showCanadaDrive = !showCanadaDrive;
      canadaDriveBtn.setAttribute("aria-pressed", String(showCanadaDrive));
      rebuildCanadaDrive();
    });
  }
  const goalCountriesBtn = document.getElementById("goal-countries-btn");
  if (goalCountriesBtn) {
    goalCountriesBtn.addEventListener("click", () => {
      setMapViewMode("static");
      focusStaticPreset("world");
      staticMapWrap?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
  const goalStatesBtn = document.getElementById("goal-states-btn");
  if (goalStatesBtn) {
    goalStatesBtn.addEventListener("click", () => {
      setMapViewMode("interactive");
      const p = REGION_PRESETS.us50;
      map.flyTo([p.lat, p.lng], p.zoom, { duration: 1.0 });
      if (statusLineEl) statusLineEl.textContent = "Goal 02 ✓ Complete: All 50 US States Visited";
      mapContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
  const goalCanadaDriveBtn = document.getElementById("goal-canada-drive-btn");
  if (goalCanadaDriveBtn) {
    goalCanadaDriveBtn.addEventListener("click", () => {
      setMapViewMode("interactive");
      showCanadaDrive = true;
      if (canadaDriveBtn) canadaDriveBtn.setAttribute("aria-pressed", "true");
      rebuildCanadaDrive();
      map.flyTo([50.8, -90.5], 4, { duration: 1.1 });
      if (statusLineEl) {
        statusLineEl.textContent =
          "Goal 03: 8/13 Canadian Provinces & Territories · Disjoint Trans-Canada Drive (Halifax → Thunder Bay + Calgary/Edmonton/Jasper)";
      }
      mapContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
      if (mapViewMode === "static" && staticViewport) {
        zoomStaticAt(1.45, staticViewport.clientWidth / 2, staticViewport.clientHeight / 2, true);
      } else {
        map.zoomIn();
      }
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
      if (mapViewMode === "static" && staticViewport) {
        zoomStaticAt(1 / 1.45, staticViewport.clientWidth / 2, staticViewport.clientHeight / 2, true);
      } else {
        map.zoomOut();
      }
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const p = REGION_PRESETS.world;
      if (mapViewMode === "static") {
        focusStaticPreset("world");
      } else {
        map.flyTo([p.lat, p.lng], p.zoom, { duration: 0.9 });
      }
      if (statusLineEl) statusLineEl.textContent = p.label;
    });
  }
  if (prevBtn) {
    prevBtn.addEventListener("click", () => selectPlace(activePlaceIndex - 1, true));
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => selectPlace(activePlaceIndex + 1, true));
  }
  if (flyBtn) {
    flyBtn.addEventListener("click", () => {
      const place = filteredPlaces[activePlaceIndex];
      if (place) map.flyTo([place.lat, place.lng], 11, { duration: 0.9 });
    });
  }
  if (autoBtn) {
    autoBtn.addEventListener("click", () => {
      if (autoPlayTimer) {
        clearInterval(autoPlayTimer);
        autoPlayTimer = null;
        autoBtn.setAttribute("aria-pressed", "false");
        autoBtn.textContent = "▶ Auto-Tour";
      } else {
        autoBtn.setAttribute("aria-pressed", "true");
        autoBtn.textContent = "⏸ Pause Tour";
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
        if (arcsBtn) {
          arcsBtn.textContent = `✈️ Flights (${s.totalFlights})`;
        }
      }
      rebuildFlightArcs();
    })
    .catch(() => {});

  // Load lightweight Google Maps index JSON with randomized deck order on every visit
  resizeOverlayCanvas();
  fetch("data/maps-index.json")
    .then((r) => r.json())
    .then((data) => {
      mapsData = data;
      const rawPlaces = Array.isArray(data.places) ? data.places : [];
      filteredPlaces = buildBalancedDeck(rawPlaces);
      const firstPhotos = filteredPlaces[0]?.photos || [];
      activePhotoIndex = firstPhotos.length > 1 ? Math.floor(Math.random() * firstPhotos.length) : 0;

      const filterLabels = {
        all: ["Shuffled Mix", rawPlaces.length],
        "hall-of-fame": ["Top Views", rawPlaces.filter((p) => p.tag === "hall-of-fame").length],
        international: ["Global & Canada", rawPlaces.filter((p) => p.tag === "international").length],
        "us-50": ["50 US States", rawPlaces.filter((p) => p.tag === "us-50").length],
        nyc: ["NYC & Broadway", rawPlaces.filter((p) => p.tag === "nyc").length]
      };
      for (const [tagKey, [labelTxt, cnt]] of Object.entries(filterLabels)) {
        const btn = document.querySelector(`[data-slide-filter="${tagKey}"]`);
        if (btn && cnt > 0) btn.textContent = `${labelTxt} (${cnt})`;
      }

      if (data.profile) {
        const vEl = document.getElementById("stat-total-views");
        const pEl = document.getElementById("stat-total-photos");
        const rEl = document.getElementById("stat-total-reviews");
        if (vEl) vEl.textContent = formatNumber(data.profile.totalPhotoViews);
        if (pEl) pEl.textContent = formatNumber(data.profile.totalPhotos);
        if (rEl) rEl.textContent = formatNumber(data.profile.totalReviews);
      }
      populateTopViewsTable(data.topViewedLedger || []);
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
      resizeOverlayCanvas();
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
      if (posterCache.size > 400) return;
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
    img.width = 150;
    img.height = 225;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.remove());
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
        img.width = 76;
        img.height = 114;
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

    fetch("data/letterboxd-reviews.json")
      .then((r) => r.json())
      .then((data) => {
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
        renderLbReviews();
        // Refresh from live Cloudflare edge RSS endpoint so new Letterboxd logs appear automatically
        return fetch("/api/letterboxd").then((r) => (r.ok ? r.json() : null));
      })
      .then((live) => {
        if (live?.ok && Array.isArray(live.reviews)) {
          mergeLbReviews(live.reviews);
        }
      })
      .catch(() => {});
  }
})();
