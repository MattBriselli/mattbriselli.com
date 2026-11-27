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
  let radarPreviewMarker = null;
  const flightArcsLayerGroup = L.layerGroup().addTo(map);
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

  // Region-stratified interleave so consecutive slides rotate globally instead of clustering on NYC
  function buildBalancedDeck(items) {
    const buckets = new Map();
    for (const item of items) {
      const key =
        item.tag === "nyc"
          ? "nyc"
          : item.region === "international" || item.region === "canada"
            ? "global"
            : item.region === "west-coast"
              ? "west"
              : "other";
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

      const allFilterBtn = document.querySelector('[data-slide-filter="all"]');
      if (allFilterBtn && rawPlaces.length) {
        allFilterBtn.textContent = `Shuffled Mix (${rawPlaces.length})`;
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
      populateNextTravelChips(data.nextDestinations || []);
      renderActiveSlide(false);
      resizeOverlayCanvas();
    });

  function populateNextTravelChips(destinations) {
    const wrap = document.getElementById("next-travel-chips");
    if (!wrap || !Array.isArray(destinations)) return;
    wrap.innerHTML = "";
    destinations.forEach((dest) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip";
      btn.setAttribute("aria-pressed", "false");
      btn.textContent = `🧭 ${dest.name}`;
      btn.addEventListener("click", () => {
        wrap.querySelectorAll(".filter-chip").forEach((b) => {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        if (radarPreviewMarker) {
          map.removeLayer(radarPreviewMarker);
        }
        const dark = isDarkActive();
        radarPreviewMarker = L.circleMarker([dest.lat, dest.lng], {
          radius: 10,
          color: dark ? "#5ec28f" : "#1f6b45",
          weight: 2.5,
          dashArray: "4,3",
          fillColor: dark ? "#5ec28f" : "#1f6b45",
          fillOpacity: 0.22
        })
          .addTo(map)
          .bindTooltip(`<strong>Next Up? ${dest.name}</strong><br>${dest.note}`, {
            direction: "top",
            permanent: true
          })
          .openTooltip();

        map.flyTo([dest.lat, dest.lng], dest.zoom || 5, { duration: 1.1 });
        if (statusLineEl) {
          statusLineEl.textContent = `Scouting Next Stop: ${dest.name} — ${dest.note}`;
        }
        mapContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      wrap.appendChild(btn);
    });
  }

  // Wire "Where Will Matt Travel Next?" direct email submission form
  const pitchForm = document.getElementById("travel-pitch-form");
  const destInput = document.getElementById("pitch-destination");
  const emailInput = document.getElementById("pitch-email");
  const destErr = document.getElementById("pitch-dest-error");
  const emailErr = document.getElementById("pitch-email-error");
  const pitchSubmitBtn = document.getElementById("pitch-submit-btn");
  const pitchStatus = document.getElementById("pitch-status");

  function validateDestField() {
    if (!destInput) return true;
    const valid = destInput.value.trim().length >= 2;
    destInput.setAttribute("aria-invalid", String(!valid));
    if (destErr) destErr.hidden = valid;
    return valid;
  }

  function validateEmailField() {
    if (!emailInput) return true;
    const val = emailInput.value.trim();
    const valid = !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
    emailInput.setAttribute("aria-invalid", String(!valid));
    if (emailErr) emailErr.hidden = valid;
    return valid;
  }

  if (destInput) {
    let destTouched = false;
    destInput.addEventListener("blur", () => {
      if (destInput.value.length > 0 || destTouched) {
        destTouched = true;
        validateDestField();
      }
    });
    destInput.addEventListener("input", () => {
      if (destInput.getAttribute("aria-invalid") === "true") validateDestField();
    });
  }

  if (emailInput) {
    emailInput.addEventListener("blur", () => {
      if (emailInput.value.length > 0) validateEmailField();
    });
    emailInput.addEventListener("input", () => {
      if (emailInput.getAttribute("aria-invalid") === "true") validateEmailField();
    });
  }

  if (pitchForm) {
    pitchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const destOk = validateDestField();
      const emailOk = validateEmailField();
      if (!destOk) {
        destInput?.focus();
        return;
      }
      if (!emailOk) {
        emailInput?.focus();
        return;
      }

      if (pitchSubmitBtn) pitchSubmitBtn.disabled = true;
      if (pitchStatus) pitchStatus.textContent = "Sending suggestion…";

      const payload = {
        destination: destInput?.value.trim() || "",
        name: document.getElementById("pitch-name")?.value.trim() || "",
        email: emailInput?.value.trim() || "",
        website: document.getElementById("pitch-website")?.value || ""
      };

      try {
        const res = await fetch("/api/travel-pitch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Could not send suggestion right now.");
        }
        pitchForm.reset();
        destInput?.removeAttribute("aria-invalid");
        emailInput?.removeAttribute("aria-invalid");
        if (pitchStatus) {
          pitchStatus.textContent = "✓ Sent to Matt! Thanks for the tip.";
        }
      } catch (err) {
        if (pitchStatus) {
          pitchStatus.textContent = err.message || "Could not send right now—email shout@mattbriselli.com directly.";
        }
      } finally {
        if (pitchSubmitBtn) pitchSubmitBtn.disabled = false;
      }
    });
  }
})();
