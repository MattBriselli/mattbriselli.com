(() => {
  const metaScheme = document.querySelector('meta[name="color-scheme"]');
  const themeToggle = document.getElementById("theme-toggle");
  const printBtn = document.getElementById("print-resume-btn");
  const yearEl = document.getElementById("current-year");
  const filterButtons = document.querySelectorAll(".filter-chip[data-filter]");
  const timelineItems = document.querySelectorAll(".timeline-item[data-category]");
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
      requestMapRedraw();
    });
  }

  darkMediaQuery.addEventListener("change", () => {
    requestMapRedraw();
  });

  window.addEventListener("storage", (event) => {
    if (event.key === "color-scheme") {
      const newVal =
        event.newValue === "light" || event.newValue === "dark" ? event.newValue : null;
      applyMetaScheme(newVal);
      requestMapRedraw();
    }
  });

  if (filterButtons.length > 0 && timelineItems.length > 0) {
    filterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const selected = btn.getAttribute("data-filter") || "all";
        filterButtons.forEach((other) => {
          other.setAttribute("aria-pressed", String(other === btn));
        });
        timelineItems.forEach((item) => {
          const cat = item.getAttribute("data-category");
          if (selected === "all" || cat === selected) {
            item.removeAttribute("hidden");
          } else {
            item.setAttribute("hidden", "");
          }
        });
      });
    });
  }

  if (printBtn) {
    printBtn.addEventListener("click", () => {
      window.print();
    });
  }

  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  /* ==========================================================================
     Interactive World Photo Heatmap, Pin Explorer & Global Slideshow
     ========================================================================== */
  const canvas = document.getElementById("world-heatmap-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const tooltipEl = document.getElementById("map-tooltip");
  const statusLineEl = document.getElementById("map-status-line");

  // Stylized vector continental coastline polygons [lng, lat] for crisp, zero-dependency world rendering
  const WORLD_POLYGONS = [
    // North America & Central America
    [
      [-168, 65], [-160, 71], [-140, 70], [-125, 70], [-110, 73], [-95, 72], [-80, 70],
      [-65, 66], [-62, 60], [-55, 52], [-60, 46], [-67, 45], [-70, 42], [-74, 40.5],
      [-76, 37], [-75.5, 35], [-80, 32], [-81, 25], [-82, 26], [-84, 30], [-90, 29],
      [-97, 26], [-98, 20], [-87, 21], [-88, 16], [-83, 10], [-78, 8], [-82, 8],
      [-92, 14], [-105, 19], [-110, 23], [-114, 31], [-112, 27], [-110, 23],
      [-117, 32.5], [-122.5, 37.7], [-124.5, 42], [-124.5, 48.5], [-130, 54],
      [-138, 59], [-150, 61], [-162, 55], [-166, 60], [-168, 65]
    ],
    // Greenland & Baffin
    [
      [-78, 76], [-65, 81], [-30, 83], [-18, 76], [-24, 70], [-44, 60], [-52, 65], [-55, 72], [-78, 76]
    ],
    // South America
    [
      [-78, 9], [-72, 12], [-62, 10], [-50, 1], [-35, -6], [-38, -15], [-43, -23],
      [-52, -33], [-62, -40], [-68, -54], [-74, -52], [-73, -40], [-71, -30],
      [-70, -18], [-77, -12], [-81, -5], [-79, 2], [-78, 9]
    ],
    // Europe & Eurasia (including Central Asia, China, India, Southeast Asia)
    [
      [-9, 36], [-9, 43], [-2, 43], [-4, 48], [2, 51], [8, 54], [10, 58], [5, 60],
      [14, 68], [28, 71], [42, 68], [60, 70], [85, 73], [115, 73], [145, 71],
      [178, 66], [170, 60], [155, 59], [142, 54], [135, 45], [129, 35], [124, 40],
      [118, 39], [122, 31], [120, 23], [108, 21], [109, 12], [103, 1], [100, 13],
      [96, 16], [90, 22], [80, 15], [77, 8], [72, 20], [67, 25], [56, 26], [50, 30],
      [58, 22], [44, 12], [35, 30], [36, 36], [27, 37], [29, 41], [23, 38], [18, 40],
      [16, 38], [12, 44], [14, 41], [9, 44], [3, 42], [-5, 36], [-9, 36]
    ],
    // Great Britain & Ireland
    [
      [-6, 50], [-5, 54], [-6, 58], [-2, 58.5], [1.7, 52.5], [1, 51], [-6, 50]
    ],
    [
      [-10, 51.5], [-10, 54.5], [-6, 55], [-6, 52], [-10, 51.5]
    ],
    // Africa
    [
      [-6, 35], [10, 37], [12, 33], [25, 32], [33, 31], [43, 12], [51, 12], [41, -2],
      [40, -15], [35, -24], [28, -33], [18, -35], [15, -24], [12, -8], [9, 4],
      [-5, 5], [-13, 9], [-17, 15], [-16, 24], [-9, 31], [-6, 35]
    ],
    // Japan & Taiwan
    [
      [130, 31], [136, 34], [140, 36], [141.5, 41], [145, 43], [141, 45], [139, 39], [131, 34], [130, 31]
    ],
    [
      [120.2, 22], [121.6, 25.2], [121.9, 24.5], [120.8, 21.9], [120.2, 22]
    ],
    // Australia
    [
      [114, -22], [122, -17], [131, -12], [136, -12], [142, -11], [146, -18],
      [153, -26], [151, -34], [145, -38], [139, -36], [131, -32], [122, -34],
      [115, -34], [114, -26], [114, -22]
    ],
    // New Zealand
    [
      [167, -46], [172, -41], [178, -37], [175, -41], [169, -46.5], [167, -46]
    ]
  ];

  // Camera presets: { centerLng, centerLat, zoom }
  const REGION_PRESETS = {
    world: { lng: -15, lat: 24, zoom: 1.05, label: "Whole World (66,085 Photos · 1.18B+ Views)" },
    nyc: { lng: -74.8, lat: 40.6, zoom: 7.2, label: "NYC, Philadelphia, Pittsburgh & East Coast" },
    west: { lng: -121.8, lat: 42.2, zoom: 4.5, label: "San Francisco (6 yrs), Seattle & West Coast" },
    us50: { lng: -98.5, lat: 39.5, zoom: 2.55, label: "All 50 US States Visited" },
    "central-asia": { lng: 68.5, lat: 42.2, zoom: 3.8, label: "All 5 Central Asian Republics (KZ · KG · UZ · TJ · TM)" },
    canada: { lng: -98.0, lat: 51.5, zoom: 2.6, label: "8 Canadian Provinces & Territories Explored" },
    "europe-apac": { lng: 60.0, lat: 22.0, zoom: 1.45, label: "London, Western Europe, Istanbul, Shanghai, Taipei & Australia" }
  };

  let mapsData = null;
  let filteredPlaces = [];
  let activePlaceIndex = 0;
  let activePhotoIndex = 0;
  let previousPlace = null;

  let showHeatmap = true;
  let showPins = true;
  let showArcs = true;
  let autoPlayTimer = null;

  const camera = {
    lng: REGION_PRESETS.world.lng,
    lat: REGION_PRESETS.world.lat,
    zoom: REGION_PRESETS.world.zoom,
    targetLng: REGION_PRESETS.world.lng,
    targetLat: REGION_PRESETS.world.lat,
    targetZoom: REGION_PRESETS.world.zoom
  };

  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartLng = 0;
  let dragStartLat = 0;
  let hoveredPoint = null;
  let animFrameId = null;
  let pulsePhase = 0;

  function project(lng, lat, width, height) {
    // Equirectangular-Mercator hybrid projection centered on camera
    let dLng = lng - camera.lng;
    if (dLng > 180) dLng -= 360;
    if (dLng < -180) dLng += 360;
    const scaleX = (width / 360) * camera.zoom;
    const scaleY = (height / 165) * camera.zoom;
    const x = width / 2 + dLng * scaleX;
    const y = height / 2 - (lat - camera.lat) * scaleY;
    return { x, y };
  }

  function unproject(x, y, width, height) {
    const scaleX = (width / 360) * camera.zoom;
    const scaleY = (height / 165) * camera.zoom;
    let lng = camera.lng + (x - width / 2) / scaleX;
    if (lng > 180) lng -= 360;
    if (lng < -180) lng += 360;
    const lat = Math.max(-75, Math.min(82, camera.lat - (y - height / 2) / scaleY));
    return { lng, lat };
  }

  function flyTo(lng, lat, zoom) {
    camera.targetLng = lng;
    camera.targetLat = lat;
    if (typeof zoom === "number") {
      camera.targetZoom = Math.max(1.0, Math.min(20, zoom));
    }
    startAnimationLoop();
  }

  function requestMapRedraw() {
    startAnimationLoop();
  }

  function startAnimationLoop() {
    if (animFrameId) return;
    const step = () => {
      pulsePhase = (pulsePhase + 0.06) % (Math.PI * 2);
      const dLng = camera.targetLng - camera.lng;
      const dLat = camera.targetLat - camera.lat;
      const dZoom = camera.targetZoom - camera.zoom;
      const moving = Math.abs(dLng) > 0.02 || Math.abs(dLat) > 0.02 || Math.abs(dZoom) > 0.005;

      if (moving) {
        camera.lng += dLng * 0.16;
        camera.lat += dLat * 0.16;
        camera.zoom += dZoom * 0.16;
      } else {
        camera.lng = camera.targetLng;
        camera.lat = camera.targetLat;
        camera.zoom = camera.targetZoom;
      }

      drawMap();

      if (moving) {
        animFrameId = requestAnimationFrame(step);
      } else {
        animFrameId = null;
      }
    };
    animFrameId = requestAnimationFrame(step);
  }

  function drawMap() {
    const width = canvas.width;
    const height = canvas.height;
    const dark = isDarkActive();

    // 1. Ocean background
    ctx.fillStyle = dark ? "#141413" : "#f3efe8";
    ctx.fillRect(0, 0, width, height);

    // 2. Subtle lat/lng graticule grid
    ctx.strokeStyle = dark ? "rgba(255, 255, 255, 0.05)" : "rgba(24, 23, 21, 0.06)";
    ctx.lineWidth = 1;
    for (let lng = -150; lng <= 180; lng += 30) {
      const p1 = project(lng, 80, width, height);
      const p2 = project(lng, -70, width, height);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    for (let lat = -60; lat <= 75; lat += 30) {
      const p1 = project(-180, lat, width, height);
      const p2 = project(180, lat, width, height);
      ctx.beginPath();
      ctx.moveTo(0, p1.y);
      ctx.lineTo(width, p2.y);
      ctx.stroke();
    }

    // 3. Continental vector landmasses
    ctx.fillStyle = dark ? "#22211e" : "#e5dfd4";
    ctx.strokeStyle = dark ? "#3b3833" : "#c5bdb0";
    ctx.lineWidth = 1.15;

    for (const poly of WORLD_POLYGONS) {
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const pt = project(poly[i][0], poly[i][1], width, height);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    if (!mapsData) return;

    // 4. Thermal Photo Heatmap Layer
    if (showHeatmap && Array.isArray(mapsData.heatmapClusters)) {
      ctx.save();
      for (const c of mapsData.heatmapClusters) {
        const pt = project(c.lng, c.lat, width, height);
        if (pt.x < -80 || pt.x > width + 80 || pt.y < -80 || pt.y > height + 80) continue;
        const weight = c.weight || 0.75;
        const baseRadius = Math.max(14, Math.min(48, 22 * Math.sqrt(camera.zoom) * weight));
        const grad = ctx.createRadialGradient(pt.x, pt.y, 1, pt.x, pt.y, baseRadius);
        if (dark) {
          grad.addColorStop(0, `rgba(255, 160, 95, ${0.55 * weight})`);
          grad.addColorStop(0.45, `rgba(232, 110, 68, ${0.28 * weight})`);
          grad.addColorStop(1, "rgba(232, 110, 68, 0)");
        } else {
          grad.addColorStop(0, `rgba(185, 52, 24, ${0.46 * weight})`);
          grad.addColorStop(0.5, `rgba(224, 118, 48, ${0.22 * weight})`);
          grad.addColorStop(1, "rgba(224, 118, 48, 0)");
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, baseRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 5. Geodesic Flight Arc between previous place and active place
    const activePlace = filteredPlaces[activePlaceIndex];
    if (showArcs && activePlace && previousPlace && previousPlace.id !== activePlace.id) {
      const pStart = project(previousPlace.lng, previousPlace.lat, width, height);
      const pEnd = project(activePlace.lng, activePlace.lat, width, height);
      const dist = Math.hypot(pEnd.x - pStart.x, pEnd.y - pStart.y);
      if (dist > 8 && dist < width * 1.4) {
        const midX = (pStart.x + pEnd.x) / 2;
        const midY = (pStart.y + pEnd.y) / 2 - Math.min(95, dist * 0.28);
        ctx.save();
        ctx.strokeStyle = dark ? "rgba(232, 130, 100, 0.75)" : "rgba(158, 59, 36, 0.7)";
        ctx.lineWidth = 1.75;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(pStart.x, pStart.y);
        ctx.quadraticCurveTo(midX, midY, pEnd.x, pEnd.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 6. Regional Cluster Dots + Clickable Photo Pins
    if (showPins) {
      // Draw subtle background cluster dots first
      if (Array.isArray(mapsData.heatmapClusters)) {
        for (const c of mapsData.heatmapClusters) {
          const pt = project(c.lng, c.lat, width, height);
          if (pt.x < -10 || pt.x > width + 10 || pt.y < -10 || pt.y > height + 10) continue;
          ctx.fillStyle = dark ? "rgba(240, 237, 230, 0.45)" : "rgba(82, 79, 73, 0.45)";
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw interactive featured dispatch photo pins
      for (let i = 0; i < filteredPlaces.length; i++) {
        const pl = filteredPlaces[i];
        const pt = project(pl.lng, pl.lat, width, height);
        const isActive = i === activePlaceIndex;
        const isHovered = hoveredPoint && hoveredPoint.placeIndex === i;

        if (isActive) {
          // Outer pulsing ring
          ctx.strokeStyle = dark ? "rgba(94, 194, 143, 0.65)" : "rgba(31, 107, 69, 0.55)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 11 + Math.sin(pulsePhase) * 2.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.fillStyle = isActive
          ? (dark ? "#5ec28f" : "#1f6b45")
          : isHovered
            ? (dark ? "#ffffff" : "#181715")
            : (dark ? "#e88264" : "#9e3b24");
        ctx.strokeStyle = dark ? "#111110" : "#faf8f5";
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isActive ? 6.5 : isHovered ? 6 : 4.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
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

    // Render multi-angle photo thumbnails if place has >1 uploaded photo
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

    if (shouldFly) {
      const targetZ = Math.max(camera.targetZoom, 3.6);
      flyTo(place.lng, place.lat, targetZ);
    } else {
      requestMapRedraw();
    }
  }

  function selectPlace(index, shouldFly = true) {
    if (!filteredPlaces.length) return;
    previousPlace = filteredPlaces[activePlaceIndex] || null;
    activePlaceIndex = (index + filteredPlaces.length) % filteredPlaces.length;
    activePhotoIndex = 0;
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
        flyTo(item.lng, item.lat, 6.5);
        if (statusLineEl) {
          statusLineEl.textContent = `Centered on ${item.name} (${item.location}) — ${formatNumber(item.views)} views`;
        }
        canvas.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      tdAction.appendChild(flyBtn);

      tr.append(tdRank, tdName, tdLoc, tdViews, tdAction);
      tbody.appendChild(tr);
    });
  }

  // Canvas Pointer Events (Pan, Hover Tooltip, Pin Click, Wheel Zoom)
  function getCanvasMousePos(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
      cssX: evt.clientX - rect.left,
      cssY: evt.clientY - rect.top
    };
  }

  function findHitPoint(x, y) {
    // Check featured photo pins first
    for (let i = 0; i < filteredPlaces.length; i++) {
      const pl = filteredPlaces[i];
      const pt = project(pl.lng, pl.lat, canvas.width, canvas.height);
      if (Math.hypot(pt.x - x, pt.y - y) <= 12) {
        return {
          type: "place",
          placeIndex: i,
          title: pl.name,
          subtitle: pl.views
            ? `${pl.location} · ${formatNumber(pl.views)} views`
            : `${pl.location} · ${pl.category}`
        };
      }
    }
    // Check heatmap clusters next
    if (mapsData && Array.isArray(mapsData.heatmapClusters)) {
      for (const c of mapsData.heatmapClusters) {
        const pt = project(c.lng, c.lat, canvas.width, canvas.height);
        if (Math.hypot(pt.x - x, pt.y - y) <= 10) {
          return {
            type: "cluster",
            placeIndex: -1,
            title: c.label || c.name,
            subtitle: "Visited & photographed cluster",
            lng: c.lng,
            lat: c.lat
          };
        }
      }
    }
    return null;
  }

  canvas.addEventListener("pointerdown", (evt) => {
    const pos = getCanvasMousePos(evt);
    isDragging = true;
    dragStartX = pos.x;
    dragStartY = pos.y;
    dragStartLng = camera.lng;
    dragStartLat = camera.lat;
    canvas.setPointerCapture(evt.pointerId);
  });

  canvas.addEventListener("pointermove", (evt) => {
    const pos = getCanvasMousePos(evt);
    if (isDragging) {
      const scaleX = (canvas.width / 360) * camera.zoom;
      const scaleY = (canvas.height / 165) * camera.zoom;
      camera.lng = dragStartLng - (pos.x - dragStartX) / scaleX;
      camera.lat = Math.max(-70, Math.min(78, dragStartLat + (pos.y - dragStartY) / scaleY));
      camera.targetLng = camera.lng;
      camera.targetLat = camera.lat;
      requestMapRedraw();
      return;
    }

    const hit = findHitPoint(pos.x, pos.y);
    hoveredPoint = hit;
    canvas.style.cursor = hit ? "pointer" : "grab";
    if (tooltipEl) {
      if (hit) {
        tooltipEl.hidden = false;
        tooltipEl.style.left = `${pos.cssX}px`;
        tooltipEl.style.top = `${pos.cssY}px`;
        tooltipEl.textContent = `${hit.title} (${hit.subtitle})`;
      } else {
        tooltipEl.hidden = true;
      }
    }
    requestMapRedraw();
  });

  canvas.addEventListener("pointerup", (evt) => {
    const pos = getCanvasMousePos(evt);
    const movedDist = Math.hypot(pos.x - dragStartX, pos.y - dragStartY);
    isDragging = false;

    if (movedDist < 6) {
      const hit = findHitPoint(pos.x, pos.y);
      if (hit && hit.type === "place") {
        selectPlace(hit.placeIndex, true);
      } else if (hit && hit.type === "cluster") {
        flyTo(hit.lng, hit.lat, Math.max(camera.zoom, 4.2));
        if (statusLineEl) {
          statusLineEl.textContent = `Exploring cluster: ${hit.title}`;
        }
      }
    }
  });

  canvas.addEventListener("pointerleave", () => {
    hoveredPoint = null;
    if (tooltipEl) tooltipEl.hidden = true;
    requestMapRedraw();
  });

  canvas.addEventListener(
    "wheel",
    (evt) => {
      evt.preventDefault();
      const factor = evt.deltaY < 0 ? 1.22 : 0.82;
      camera.targetZoom = Math.max(1.0, Math.min(18, camera.targetZoom * factor));
      startAnimationLoop();
    },
    { passive: false }
  );

  // Wire toolbar buttons
  document.querySelectorAll("[data-region-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-region-preset") || "world";
      const preset = REGION_PRESETS[key] || REGION_PRESETS.world;
      document.querySelectorAll("[data-region-preset]").forEach((other) => {
        other.setAttribute("aria-pressed", String(other === btn));
      });
      flyTo(preset.lng, preset.lat, preset.zoom);
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
          ? mapsData.places.slice()
          : mapsData.places.filter((p) => p.tag === filter);
      activePlaceIndex = 0;
      activePhotoIndex = 0;
      renderActiveSlide(true);
    });
  });

  const heatBtn = document.getElementById("toggle-heatmap-btn");
  const pinsBtn = document.getElementById("toggle-pins-btn");
  const arcsBtn = document.getElementById("toggle-arcs-btn");
  const zoomInBtn = document.getElementById("map-zoom-in");
  const zoomOutBtn = document.getElementById("map-zoom-out");
  const resetBtn = document.getElementById("map-reset-btn");
  const prevBtn = document.getElementById("slide-prev-btn");
  const nextBtn = document.getElementById("slide-next-btn");
  const autoBtn = document.getElementById("slide-autoplay-btn");
  const flyBtn = document.getElementById("slide-fly-btn");

  if (heatBtn) {
    heatBtn.addEventListener("click", () => {
      showHeatmap = !showHeatmap;
      heatBtn.setAttribute("aria-pressed", String(showHeatmap));
      requestMapRedraw();
    });
  }
  if (pinsBtn) {
    pinsBtn.addEventListener("click", () => {
      showPins = !showPins;
      pinsBtn.setAttribute("aria-pressed", String(showPins));
      requestMapRedraw();
    });
  }
  if (arcsBtn) {
    arcsBtn.addEventListener("click", () => {
      showArcs = !showArcs;
      arcsBtn.setAttribute("aria-pressed", String(showArcs));
      requestMapRedraw();
    });
  }
  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
      camera.targetZoom = Math.min(18, camera.targetZoom * 1.45);
      startAnimationLoop();
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
      camera.targetZoom = Math.max(1.0, camera.targetZoom / 1.45);
      startAnimationLoop();
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const p = REGION_PRESETS.world;
      flyTo(p.lng, p.lat, p.zoom);
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
      if (place) flyTo(place.lng, place.lat, 6.2);
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

  // Load lightweight Google Maps index JSON
  fetch("data/maps-index.json")
    .then((r) => r.json())
    .then((data) => {
      mapsData = data;
      filteredPlaces = Array.isArray(data.places) ? data.places.slice() : [];
      if (data.profile) {
        const vEl = document.getElementById("stat-total-views");
        const pEl = document.getElementById("stat-total-photos");
        const rEl = document.getElementById("stat-total-reviews");
        if (vEl) vEl.textContent = formatNumber(data.profile.totalPhotoViews);
        if (pEl) pEl.textContent = formatNumber(data.profile.totalPhotos);
        if (rEl) rEl.textContent = formatNumber(data.profile.totalReviews);
      }
      populateTopViewsTable(data.topViewedLedger || []);
      renderActiveSlide(false);
      startAnimationLoop();
    })
    .catch(() => {
      drawMap();
    });
})();
