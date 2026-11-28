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
  const TRACKED_SECTION_IDS = ["map", "coder", "eclectic", "letterboxd", "contact"];
  const MAP_HASH_ALIASES = new Set(["#explorer"]);
  const MOVIE_HASH_ALIASES = new Set(["#movies", "#films", "#film-reviews", "#reviews"]);
  const LISTS_HASH_ALIASES = new Set(["#film-lists", "#lists", "#lb-lists-showcase"]);
  const SCROLL_STATE_KEY = "mlb_section_scroll_v1";
  const supportsScrollTargetGroup =
    typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("scroll-target-group: auto");
  const navLinks = Array.from(document.querySelectorAll(".site-header .nav-list a[href^='#']"));
  const siteBrandLink = document.querySelector(".site-brand");
  const navEntry = performance.getEntriesByType?.("navigation")?.[0];
  const isPageReload = navEntry?.type === "reload";

  const initialRawHash = window.location.hash;
  const initialUrlParams = new URLSearchParams(window.location.search);
  const hasInitialMovieParams =
    initialUrlParams.has("film") ||
    initialUrlParams.has("movie") ||
    initialUrlParams.has("filter") ||
    initialUrlParams.has("list");

  function normalizeDeepHash(rawHash) {
    if (!rawHash) return "";
    const lower = rawHash.toLowerCase();
    if (MAP_HASH_ALIASES.has(lower)) return "#map";
    if (MOVIE_HASH_ALIASES.has(lower)) return "#letterboxd";
    if (LISTS_HASH_ALIASES.has(lower)) return "#film-lists";
    return rawHash;
  }

  const initialNormalizedHash = normalizeDeepHash(initialRawHash);
  if (initialRawHash && initialNormalizedHash !== initialRawHash) {
    try {
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}${initialNormalizedHash}`);
    } catch {}
  }

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
    const activeHashId = window.location.hash.replace(/^#/, "");
    if (activeHashId && activeHashId !== current) {
      const subEl = document.getElementById(activeHashId);
      if (subEl) {
        const subRect = subEl.getBoundingClientRect();
        if (subRect.top <= window.innerHeight * 0.72 && subRect.bottom > getHeaderOffset()) {
          return activeHashId;
        }
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

  function resolveNavParentId(sectionId) {
    if (!sectionId) return "";
    if (["map", "coder", "eclectic", "contact"].includes(sectionId)) return sectionId;
    const el = document.getElementById(sectionId);
    const parentSec = el?.closest("section[id], footer[id]");
    return parentSec?.id || sectionId;
  }

  function syncNavAndHash(sectionId, updateHistoryHash) {
    const navTargetId = resolveNavParentId(sectionId);
    const nativeCurrentLink = supportsScrollTargetGroup
      ? document.querySelector(".site-header .nav-list a:target-current")
      : null;

    for (const link of navLinks) {
      const isMatch =
        supportsScrollTargetGroup && nativeCurrentLink && navTargetId
          ? link === nativeCurrentLink
          : Boolean(navTargetId) && link.getAttribute("href") === `#${navTargetId}`;
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
    const { sectionId: rawSectionId, offsetInSection, scrollY } = savedScrollState;
    const sectionId = rawSectionId === "explorer" ? "map" : rawSectionId;
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
  } else if (initialNormalizedHash === "#map" && initialNormalizedHash !== initialRawHash) {
    const mapEl = document.getElementById("map");
    if (mapEl) {
      navScrollLockUntil = performance.now() + 900;
      activeTrackedSection = "map";
      syncNavAndHash("map", false);
      const topY = mapEl.getBoundingClientRect().top + window.scrollY - getHeaderOffset();
      window.scrollTo({ top: Math.max(0, topY), behavior: "instant" });
    }
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
    siteBrandLink.addEventListener("click", async (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      // Already at the very top: the name copies the site URL instead of scrolling nowhere
      if (window.scrollY <= 2) {
        const homeUrl = `${window.location.origin}/`;
        const prettyUrl = window.location.host.replace(/^www\./, "");
        try {
          await navigator.clipboard.writeText(homeUrl);
          showSiteToast(`Copied ${prettyUrl} to clipboard`, siteBrandLink);
        } catch {
          showSiteToast("Couldn’t copy the link", siteBrandLink);
        }
        return;
      }
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

  const isCoarseMapPointer =
    typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

  const map = L.map(mapContainer, {
    center: [REGION_PRESETS.world.lat, REGION_PRESETS.world.lng],
    zoom: REGION_PRESETS.world.zoom,
    minZoom: 2,
    maxZoom: 17,
    zoomControl: false,
    attributionControl: false,
    worldCopyJump: true,
    touchZoom: true,
    doubleClickZoom: !isCoarseMapPointer,
    bounceAtZoomLimits: false,
    zoomSnap: isCoarseMapPointer ? 0.25 : 0.5,
    zoomDelta: 1,
    inertia: true,
    inertiaDeceleration: 2400
  });

  // Mobile touch gestures (native-feeling, zero double-zoom, no popup flash on double-tap):
  // 1. Double-tap to zoom in (+1) at the tapped point
  // 2. Two-finger tap to zoom out (-1) at the midpoint
  // 3. Double-tap & drag (one-handed zoom: slide down to zoom in, up to zoom out)
  let suppressMapClickUntil = 0;
  let pendingTouchPinTimer = null;
  let isOneHandZooming = false;
  let markerRebuildTimer = null;
  let lastMarkerZoomTier = -1;

  function getMarkerZoomTier(z) {
    if (z >= 15) return 5;
    if (z >= 13) return 4;
    if (z >= 12) return 3;
    if (z >= 8) return 2;
    if (z >= 5) return 1;
    return 0;
  }

  (() => {
    let lastTapTime = 0;
    let lastTapPt = null;
    let singleStart = null;
    let twoFingerStart = null;
    let oneHandZoom = null;
    let oneHandRaf = 0;
    let oneHandPendingZoom = null;

    const isControlTarget = (target) =>
      target instanceof Element &&
      Boolean(target.closest(".leaflet-popup, .leaflet-control, .map-floating-controls, button, a"));

    const pointFromTouch = (touch) => {
      const rect = mapContainer.getBoundingClientRect();
      return L.point(touch.clientX - rect.left, touch.clientY - rect.top);
    };

    const cancelPendingPinTap = () => {
      if (pendingTouchPinTimer) {
        clearTimeout(pendingTouchPinTimer);
        pendingTouchPinTimer = null;
      }
    };

    mapContainer.addEventListener(
      "touchstart",
      (ev) => {
        if (isControlTarget(ev.target)) {
          singleStart = null;
          twoFingerStart = null;
          oneHandZoom = null;
          return;
        }
        const now = performance.now();
        if (ev.touches.length === 1) {
          twoFingerStart = null;
          const pt = pointFromTouch(ev.touches[0]);
          const isSecondTap =
            lastTapPt && now - lastTapTime <= 300 && Math.hypot(pt.x - lastTapPt.x, pt.y - lastTapPt.y) <= 40;
          singleStart = { pt, time: now, moved: false, isSecondTap };
          if (isSecondTap) {
            cancelPendingPinTap();
            oneHandZoom = {
              startY: pt.y,
              startZoom: map.getZoom(),
              anchorLatLng: map.containerPointToLatLng(pt),
              active: false
            };
          } else {
            oneHandZoom = null;
          }
        } else if (ev.touches.length === 2) {
          cancelPendingPinTap();
          singleStart = null;
          if (oneHandZoom?.active) {
            map.dragging.enable();
          }
          isOneHandZooming = false;
          oneHandZoom = null;
          lastTapTime = 0;
          lastTapPt = null;
          const p0 = pointFromTouch(ev.touches[0]);
          const p1 = pointFromTouch(ev.touches[1]);
          twoFingerStart = { p0, p1, time: now, moved: false };
        } else {
          singleStart = null;
          twoFingerStart = null;
        }
      },
      { passive: true }
    );

    mapContainer.addEventListener(
      "touchmove",
      (ev) => {
        if (ev.touches.length === 1 && singleStart) {
          const pt = pointFromTouch(ev.touches[0]);
          const dist = Math.hypot(pt.x - singleStart.pt.x, pt.y - singleStart.pt.y);
          if (dist > 14) singleStart.moved = true;

          if (oneHandZoom) {
            const dy = pt.y - oneHandZoom.startY;
            if (!oneHandZoom.active && Math.abs(dy) >= 12) {
              oneHandZoom.active = true;
              isOneHandZooming = true;
              map.dragging.disable();
              map.closePopup();
            }
            if (oneHandZoom.active) {
              if (ev.cancelable) ev.preventDefault();
              oneHandPendingZoom = Math.max(
                map.getMinZoom(),
                Math.min(map.getMaxZoom(), oneHandZoom.startZoom + dy / 95)
              );
              if (!oneHandRaf) {
                oneHandRaf = requestAnimationFrame(() => {
                  oneHandRaf = 0;
                  if (oneHandZoom?.active && oneHandPendingZoom !== null) {
                    map.setZoomAround(oneHandZoom.anchorLatLng, oneHandPendingZoom, { animate: false });
                  }
                });
              }
            }
          }
        } else if (ev.touches.length === 2 && twoFingerStart) {
          const p0 = pointFromTouch(ev.touches[0]);
          const p1 = pointFromTouch(ev.touches[1]);
          if (
            Math.hypot(p0.x - twoFingerStart.p0.x, p0.y - twoFingerStart.p0.y) > 18 ||
            Math.hypot(p1.x - twoFingerStart.p1.x, p1.y - twoFingerStart.p1.y) > 18
          ) {
            twoFingerStart.moved = true;
          }
        }
      },
      { passive: false }
    );

    const endTouch = (ev) => {
      const now = performance.now();

      if (oneHandZoom?.active) {
        if (oneHandRaf) {
          cancelAnimationFrame(oneHandRaf);
          oneHandRaf = 0;
        }
        isOneHandZooming = false;
        map.dragging.enable();
        suppressMapClickUntil = now + 380;
        oneHandZoom = null;
        singleStart = null;
        lastTapTime = 0;
        lastTapPt = null;
        const tier = getMarkerZoomTier(map.getZoom());
        if (tier !== lastMarkerZoomTier) {
          rebuildMarkers();
        }
        scheduleViewportSync();
        return;
      }

      if (twoFingerStart && ev.touches.length === 0) {
        const dt = now - twoFingerStart.time;
        if (!twoFingerStart.moved && dt <= 260) {
          if (ev.cancelable) ev.preventDefault();
          const midPt = L.point(
            (twoFingerStart.p0.x + twoFingerStart.p1.x) / 2,
            (twoFingerStart.p0.y + twoFingerStart.p1.y) / 2
          );
          const midLatLng = map.containerPointToLatLng(midPt);
          const nextZoom = Math.max(map.getMinZoom(), Math.floor(map.getZoom() - 0.01));
          suppressMapClickUntil = now + 380;
          map.closePopup();
          map.setZoomAround(midLatLng, nextZoom, { animate: true });
        }
        twoFingerStart = null;
        return;
      }

      if (singleStart && ev.touches.length === 0) {
        const dt = now - singleStart.time;
        if (!singleStart.moved && dt <= 260) {
          if (singleStart.isSecondTap) {
            if (ev.cancelable) ev.preventDefault();
            cancelPendingPinTap();
            const tapLatLng = map.containerPointToLatLng(singleStart.pt);
            const nextZoom = Math.min(map.getMaxZoom(), Math.ceil(map.getZoom() + 0.01));
            suppressMapClickUntil = now + 400;
            map.closePopup();
            map.setZoomAround(tapLatLng, nextZoom, { animate: true });
            lastTapTime = 0;
            lastTapPt = null;
          } else {
            lastTapTime = now;
            lastTapPt = singleStart.pt;
          }
        } else {
          lastTapTime = 0;
          lastTapPt = null;
        }
        singleStart = null;
        oneHandZoom = null;
      }
    };

    mapContainer.addEventListener("touchend", endTouch, { passive: false });
    mapContainer.addEventListener(
      "touchcancel",
      () => {
        if (oneHandRaf) {
          cancelAnimationFrame(oneHandRaf);
          oneHandRaf = 0;
        }
        if (oneHandZoom?.active) map.dragging.enable();
        isOneHandZooming = false;
        singleStart = null;
        twoFingerStart = null;
        oneHandZoom = null;
      },
      { passive: true }
    );
  })();

  // Explicit Leaflet z-index panes so SVG country/state polygons never block Canvas dot clicks!
  const choroplethPane = map.createPane("choroplethPane");
  choroplethPane.style.zIndex = "350";
  const routesPane = map.createPane("routesPane");
  routesPane.style.zIndex = "420";
  const pinsPane = map.createPane("pinsPane");
  pinsPane.style.zIndex = "550";

  const pinsCanvasRenderer = L.canvas({
    pane: "pinsPane",
    padding: 0.5,
    tolerance: isCoarseMapPointer ? 13 : 6
  });

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
          pane: "routesPane",
          color: glowColor,
          weight: weight + 4,
          opacity: dark ? 0.16 : 0.12,
          interactive: false,
          smoothFactor: 1.2
        }).addTo(flightArcsLayerGroup);

        const line = L.polyline(seg, {
          pane: "routesPane",
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
        pane: "routesPane",
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
      driven: true,
      title: "✓ Driven: Lake Louise ↔ Golden ↔ Revelstoke ↔ Kamloops",
      note: "BC Rockies Trans-Canada Hwy 1 via Rogers Pass & Salmon Arm",
      coords: [
        [51.4254, -116.1773], // Lake Louise, AB
        [51.2969, -116.9631], // Golden, BC
        [51.3005, -117.5200], // Rogers Pass, BC
        [50.9981, -118.1957], // Revelstoke, BC
        [50.7001, -119.2838], // Salmon Arm, BC
        [50.6745, -120.3273]  // Kamloops, BC
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
      title: "○ Future Link: Kamloops → Vancouver / Victoria, BC",
      note: "Coquihalla / Fraser Canyon final link to the Pacific",
      coords: [
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
          pane: "routesPane",
          color: drivenColor,
          weight: 7,
          opacity: 0.18,
          interactive: false,
          smoothFactor: 1.1
        }).addTo(canadaDriveLayerGroup);
      }
      const poly = L.polyline(seg.coords, {
        pane: "routesPane",
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
      { name: "Jasper, AB", lat: 52.8737, lng: -118.0814 },
      { name: "Kamloops, BC (Driven West Terminus)", lat: 50.6745, lng: -120.3273 }
    ];
    for (const ep of endpoints) {
      const dot = L.circleMarker([ep.lat, ep.lng], {
        pane: "routesPane",
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
        `<span class="legend-item"><span class="legend-swatch swatch-warm" aria-hidden="true"></span> ${formatNumber(extraReviewedDots)} Places Matt Visited (${formatNumber(totalDots)} Total)</span>`
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
        `<span class="legend-item"><span class="legend-swatch swatch-hot" aria-hidden="true"></span> ${formatNumber(totalDots)} Photos &amp; Places Matt Visited</span>`,
        `<span class="legend-item"><span class="legend-swatch swatch-pin" aria-hidden="true"></span> 173 Flights (315k mi)</span>`,
        `<span class="legend-item"><span class="legend-swatch swatch-warm" aria-hidden="true"></span> 39 Countries · 50 States · 8/13 Canada</span>`,
        `<span class="legend-item"><span class="legend-swatch swatch-drive" aria-hidden="true"></span> Canada Drive</span>`
      ].join("");
    }
  }

  let selectedGeoEntry = null;

  function clearSelectedGeoShape() {
    if (!selectedGeoEntry) return;
    const { layer, group } = selectedGeoEntry;
    selectedGeoEntry = null;
    if (group && layer) {
      group.resetStyle(layer);
    }
  }

  function applyGeoShapeHighlight(layer, visited = true) {
    const dark = isDarkActive();
    layer.setStyle({
      weight: 2.6,
      color: visited
        ? (dark ? "#ffd48a" : "#7c2d12")
        : (dark ? "#e2dcd0" : "#3f3c36"),
      fillColor: visited
        ? (dark ? "#f29d82" : "#cf5636")
        : (dark ? "#57534c" : "#cfc8bc"),
      fillOpacity: visited ? 0.52 : 0.34,
      dashArray: null
    });
    if (typeof layer.bringToFront === "function") {
      layer.bringToFront();
    }
  }

  function wireGeoShapeHighlight(layer, getGroup, isVisited, labelName) {
    layer.on("mouseover", () => {
      applyGeoShapeHighlight(layer, isVisited);
    });
    layer.on("mouseout", () => {
      if (selectedGeoEntry?.layer === layer) {
        applyGeoShapeHighlight(layer, isVisited);
        return;
      }
      const grp = getGroup();
      if (grp) grp.resetStyle(layer);
    });
    layer.on("click", (ev) => {
      L.DomEvent.stopPropagation(ev);
      stopAutoPlay();
      if (selectedGeoEntry?.layer === layer) {
        clearSelectedGeoShape();
        return;
      }
      clearSelectedGeoShape();
      selectedGeoEntry = { layer, group: getGroup(), isVisited };
      applyGeoShapeHighlight(layer, isVisited);
      if (statusLineEl && labelName) {
        statusLineEl.textContent = labelName;
      }
    });
  }

  function syncPanePointerEvents() {
    const showPins = lensShowsPhotos();
    const showRoutes = lensShowsFlights() || lensShowsCanadaDrive();
    const showChoropleth = activeLens === "atlas";
    pinsPane.style.pointerEvents = showPins ? "auto" : "none";
    if (pinsCanvasRenderer._container) {
      pinsCanvasRenderer._container.style.pointerEvents = showPins ? "auto" : "none";
    }
    routesPane.style.pointerEvents = showRoutes ? "auto" : "none";
    choroplethPane.style.pointerEvents = showChoropleth ? "auto" : "none";
  }

  const MONTH_SHORT = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  function formatVisitDate(isoStr) {
    if (!isoStr || typeof isoStr !== "string") return "";
    const trimmed = isoStr.trim();
    const m = trimmed.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (!m) return trimmed;
    if (typeof Temporal !== "undefined" && m[3]) {
      try {
        return Temporal.PlainDate.from(trimmed).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric"
        });
      } catch {}
    }
    const monthLabel = MONTH_SHORT[Number(m[2]) - 1] || m[2];
    return m[3] ? `${monthLabel} ${Number(m[3])}, ${m[1]}` : `${monthLabel} ${m[1]}`;
  }

  const CATEGORY_ICON_RULES = [
    [/coffee|tea\b|espresso|matcha|boba|bubble tea|cafe|café/i, "☕"],
    [/bakery|bagel|donut|doughnut|pastry|patisserie|croissant|crepe/i, "🥐"],
    [/ice cream|gelato|dessert|frozen yogurt|cupcake|chocolate|candy|pie\b/i, "🍦"],
    [/ramen|noodle|pho|udon|soba|dumpling|dim sum|hotpot|chinese/i, "🍜"],
    [/sushi|japanese|izakaya|omisoka|poke|seafood|oyster|fish/i, "🍣"],
    [/pizza|pizzeria|italian|pasta|trattoria/i, "🍕"],
    [/taco|mexican|burrito|taqueria|latin|cuban|peruvian|tapas/i, "🌮"],
    [/burger|sandwich|deli\b|diner|bbq|barbecue|steak|fried chicken|hot dog|wings|breakfast|brunch/i, "🍔"],
    [/cocktail|speakeasy|wine|whisky|whiskey|sake|lounge|nightclub|karaoke/i, "🍸"],
    [/brewery|beer|biergarten|pub\b|dive bar|sports bar|\bbar\b|tavern|cidery/i, "🍺"],
    [/restaurant|bistro|brasserie|food|gastropub|kitchen|eatery|dining|korean|thai|indian|vietnamese|french|mediterranean|greek/i, "🍽️"],
    [/movie|cinema|multiplex|film/i, "🎬"],
    [/theater|theatre|performing arts|opera|symphony|concert|music venue|jazz|comedy|broadway/i, "🎭"],
    [/museum|art gallery|exhibit|planetarium|aquarium|zoo\b/i, "🏛️"],
    [/bookstore|bookshop|library/i, "📚"],
    [/national park|state park|trail|hiking|mountain|forest|botanical|garden|campground|nature|lookout|scenic/i, "🌲"],
    [/beach|island|harbor|marina|pier|boardwalk|surf|ocean|bay\b|lake|waterfall|hotspring/i, "🏖️"],
    [/airport|airfield|heliport|terminal/i, "✈️"],
    [/metro|subway|train|rail|station|tram|streetcar|cable car|ferry|boat|pier/i, "🚇"],
    [/hotel|resort|motel|hostel|inn\b|lodging/i, "🏨"],
    [/bridge|monument|landmark|historic|castle|palace|shrine|temple|church|cathedral|mosque|synagogue|plaza|square|fountain|tower/i, "🌉"],
    [/stadium|arena|ballpark|baseball|basketball|football|soccer|hockey|tennis|golf|bowling|rink/i, "🏟️"],
    [/gym|fitness|yoga|climbing|trapeze|circus|pool|spa\b/i, "🤸"],
    [/university|college|campus|school|institute/i, "🎓"],
    [/store|shop|market|mall|boutique|grocery|record|vintage|bookstore/i, "🛍️"]
  ];

  function getCategoryIcon(category = "", fallback = "📍") {
    if (!category) return fallback;
    for (const [re, icon] of CATEGORY_ICON_RULES) {
      if (re.test(category)) return icon;
    }
    return fallback;
  }

  // Returns { count, dates[] } so labels can wrap between phrases instead of mid-date
  function visitSpanParts(lastDate, firstDate, visitCount = 1) {
    const count = Number(visitCount) > 1 ? Number(visitCount) : 1;
    const latestFmt = formatVisitDate(lastDate);
    const firstFmt = formatVisitDate(firstDate);
    const dates = [];
    if (firstFmt && latestFmt && firstDate !== lastDate) {
      dates.push(`First ${firstFmt}`, `Latest ${latestFmt}`);
    } else if (latestFmt || firstFmt) {
      dates.push(`Visited ${latestFmt || firstFmt}`);
    }
    return { count, dates };
  }

  function formatVisitSpan(lastDate, firstDate, visitCount = 1) {
    const { count, dates } = visitSpanParts(lastDate, firstDate, visitCount);
    const parts = count > 1 ? [`${formatNumber(count)} visits`, ...dates] : dates;
    return parts.join(" · ");
  }

  // Shared, wrap-friendly label markup for hover tooltips and click popups
  function buildPinLabelHtml({ icon = "", name = "", rating = 0, loc = "", category = "", lastDate, firstDate, visitCount }) {
    const stars = rating ? ` <span class="pin-tip-stars">${"★".repeat(rating)}</span>` : "";
    const { count, dates } = visitSpanParts(lastDate, firstDate, visitCount);
    const whereBits = [loc, category].filter(Boolean).map((t) => `<span class="pin-tip-chunk">${escMapHtml(t)}</span>`);
    const whenBits = dates.map((t) => `<span class="pin-tip-chunk">${escMapHtml(t)}</span>`);
    const countHtml = count > 1 ? `<span class="pin-tip-count">${formatNumber(count)} visits</span>` : "";
    // First + Latest always stack on their own lines: predictable width, no dangling separators
    const isSpan = dates.length > 1;
    return (
      `<span class="pin-tip-title">${icon ? `${escMapHtml(icon)} ` : ""}${escMapHtml(name)}${stars}</span>` +
      (whereBits.length ? `<span class="pin-tip-line pin-tip-where">${whereBits.join('<span class="pin-tip-sep" aria-hidden="true"> · </span>')}</span>` : "") +
      (countHtml || whenBits.length
        ? `<span class="pin-tip-line pin-tip-when${isSpan ? " pin-tip-stack" : ""}">${countHtml}${whenBits.join("")}</span>`
        : "")
    );
  }

  // Canvas circle that paints its category emoji inside once zoomed in close (no DOM, no network, no JSON)
  const GLYPH_MIN_ZOOM = 13;
  const GlyphCircleMarker = L.CircleMarker.extend({
    _updatePath() {
      L.CircleMarker.prototype._updatePath.call(this);
      const glyph = this.options.glyph;
      const renderer = this._renderer;
      if (!glyph || !renderer?._drawing || this._empty()) return;
      const r = this._radius;
      if (r < 7) return;
      const p = this._point;
      if (renderer._bounds && !renderer._bounds.contains(p)) return;
      const ctx = renderer._ctx;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.font = `${Math.round(r * 1.15)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph, p.x, p.y + r * 0.08);
      ctx.restore();
    }
  });

  function glyphPinStyle(dark, isFrequent) {
    return {
      color: isFrequent ? (dark ? "#ffbe5c" : "#c96214") : (dark ? "#f0ad4e" : "#d97724"),
      weight: isFrequent ? 2.4 : 1.6,
      fillColor: dark ? "#24211d" : "#fffaf2",
      fillOpacity: 0.96
    };
  }

  function getVisitRadiusBoost(visitCount, zoom) {
    const c = Number(visitCount) || 1;
    if (c <= 1) return 0;
    const scale = zoom >= 11 ? 1.25 : zoom >= 7 ? 1.05 : zoom >= 4 ? 0.88 : 0.75;
    return Math.min(5.0, Math.log2(c) * scale);
  }

  function openPlaceOnlyPopup(item) {
    const [lat, lng, name, loc, rating, snippet, lastDate, category, visitCount, firstDate] = item;
    const icon = getCategoryIcon(category, "📍");
    const spanStr = formatVisitSpan(lastDate, firstDate, visitCount);
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${loc || ""}`)}`;
    const quoteHtml = snippet
      ? `<div class="pin-popup-quote">“${escMapHtml(snippet)}${snippet.length >= 158 ? "…" : ""}”</div>`
      : "";
    L.popup({ closeButton: true, maxWidth: 270, minWidth: 220, className: "pin-popup", offset: [0, -6] })
      .setLatLng([lat, lng])
      .setContent(
        `<div class="pin-label">${buildPinLabelHtml({
          icon,
          name,
          rating,
          loc: loc || "Place Matt Visited",
          category,
          lastDate,
          firstDate,
          visitCount
        })}</div>` +
          quoteHtml +
          `<a class="pin-popup-link" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Open on Google Maps ↗</a>`
      )
      .openOn(map);
    const statusBits = [`${icon} ${name}`, loc, spanStr].filter(Boolean);
    if (statusLineEl) statusLineEl.textContent = statusBits.join(" · ");
  }

  function openPhotoPinSelection(idx) {
    const pl = filteredPlaces[idx];
    if (!pl) return;
    stopAutoPlay();
    const shouldZoomIn = map.getZoom() < 5;
    const stackedLayout =
      typeof window.matchMedia === "function" && window.matchMedia("(max-width: 57.99rem)").matches;
    if (!stackedLayout) {
      map.closePopup();
    }
    selectPlace(idx, shouldZoomIn);
    const spanStr = formatVisitSpan(pl.date, pl.firstDate, pl.visitCount);
    if (statusLineEl) {
      statusLineEl.textContent = [
        `📍 ${pl.name}`,
        pl.location,
        spanStr
      ]
        .filter(Boolean)
        .join(" · ");
    }
    if (stackedLayout) {
      const thumbUrl = (pl.photos?.[0] || "").replace(/=w\d+-h\d+-p-k-no$/, "=w320-h240-p-k-no");
      const thumbHtml = thumbUrl
        ? `<img class="pin-popup-thumb" src="${escMapHtml(thumbUrl)}" alt="${escMapHtml(pl.name)}" width="220" height="165" referrerpolicy="no-referrer">`
        : "";
      const pop = L.popup({ closeButton: true, maxWidth: 255, minWidth: 220, className: "pin-popup", offset: [0, -6] })
        .setLatLng([pl.lat, pl.lng])
        .setContent(
          thumbHtml +
            `<div class="pin-label">${buildPinLabelHtml({
              icon: getCategoryIcon(pl.category, ""),
              name: pl.name,
              rating: pl.rating,
              loc: pl.location,
              lastDate: pl.date,
              firstDate: pl.firstDate,
              visitCount: pl.visitCount
            })}</div>` +
            `<button type="button" class="pin-popup-jump-btn" data-jump-slideshow="1">View Full Photo Below ↓</button>`
        )
        .openOn(map);
      requestAnimationFrame(() => {
        const el = pop.getElement()?.querySelector("[data-jump-slideshow]");
        if (el) {
          el.addEventListener("click", () => {
            document
              .querySelector(".slideshow-stage-card")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }
      });
    }
  }

  function activateClosestPinAt(containerPoint, origEvent = null) {
    if (performance.now() < suppressMapClickUntil) return true;
    if (!lensShowsPhotos() || !mapsData || !containerPoint) return false;
    if (origEvent && origEvent._mlbPinHandled) return true;
    const maxHitPx = isCoarseMapPointer ? 22 : 14;
    const hitBounds = map.getBounds().pad(0.08);
    let best = null;
    let bestScore = maxHitPx;

    for (let idx = 0; idx < filteredPlaces.length; idx++) {
      const pl = filteredPlaces[idx];
      if (!hitBounds.contains([pl.lat, pl.lng])) continue;
      const pt = map.latLngToContainerPoint([pl.lat, pl.lng]);
      const d = Math.hypot(pt.x - containerPoint.x, pt.y - containerPoint.y);
      // Slight 3px priority for rich photo dispatches when directly overlapping a plain pin
      const score = Math.max(0, d - 3);
      if (d <= maxHitPx && score <= bestScore) {
        bestScore = score;
        best = { kind: "photo", idx };
      }
    }

    if (currentSlideFilter === "all" && mapOnlyPins.length) {
      const zoomNow = map.getZoom();
      for (let i = 0; i < mapOnlyPins.length; i++) {
        const item = mapOnlyPins[i];
        if (!hitBounds.contains([item[0], item[1]])) continue;
        const pt = map.latLngToContainerPoint([item[0], item[1]]);
        const d = Math.hypot(pt.x - containerPoint.x, pt.y - containerPoint.y);
        const boost = getVisitRadiusBoost(item[8], zoomNow) * 0.5;
        const score = Math.max(0, d - boost);
        if (d <= maxHitPx + boost && score < bestScore) {
          bestScore = score;
          best = { kind: "place", item };
        }
      }
    }

    if (!best && Array.isArray(mapsData.heatmapClusters)) {
      for (const c of mapsData.heatmapClusters) {
        if (!hitBounds.contains([c.lat, c.lng])) continue;
        const pt = map.latLngToContainerPoint([c.lat, c.lng]);
        const d = Math.hypot(pt.x - containerPoint.x, pt.y - containerPoint.y);
        if (d <= maxHitPx && d < bestScore) {
          bestScore = d;
          best = { kind: "cluster", cluster: c };
        }
      }
    }

    if (!best) return false;
    if (origEvent) origEvent._mlbPinHandled = true;

    const runSelection = () => {
      if (performance.now() < suppressMapClickUntil) return;
      if (best.kind === "photo") {
        openPhotoPinSelection(best.idx);
      } else if (best.kind === "place") {
        stopAutoPlay();
        openPlaceOnlyPopup(best.item);
      } else if (best.kind === "cluster") {
        stopAutoPlay();
        const label = best.cluster.label || best.cluster.name || "Visited Cluster";
        map.flyTo([best.cluster.lat, best.cluster.lng], Math.max(map.getZoom(), 6), { duration: 0.85 });
        if (statusLineEl) statusLineEl.textContent = `Exploring: ${label}`;
      }
    };

    // On touch screens, briefly defer pin activation so a double-tap zooms cleanly without flashing a popup first
    if (isCoarseMapPointer) {
      if (pendingTouchPinTimer) clearTimeout(pendingTouchPinTimer);
      pendingTouchPinTimer = setTimeout(() => {
        pendingTouchPinTimer = null;
        runSelection();
      }, 220);
    } else {
      runSelection();
    }
    return true;
  }

  map.on("click", (ev) => {
    if (lensShowsPhotos() && activateClosestPinAt(ev.containerPoint, ev.originalEvent)) {
      return;
    }
    clearSelectedGeoShape();
  });

  // One label at a time: a hover tooltip never stacks on top of the pin whose popup is open,
  // and opening a popup dismisses whatever hover tooltip was showing.
  let openHoverTooltip = null;
  function popupCoversLatLng(latlng) {
    const pop = map._popup;
    if (!pop || !map.hasLayer(pop) || !latlng) return false;
    const a = map.latLngToContainerPoint(pop.getLatLng());
    const b = map.latLngToContainerPoint(latlng);
    return Math.hypot(a.x - b.x, a.y - b.y) < 10;
  }
  map.on("tooltipopen", (ev) => {
    if (popupCoversLatLng(ev.tooltip.getLatLng())) {
      map.closeTooltip(ev.tooltip);
      return;
    }
    openHoverTooltip = ev.tooltip;
  });
  map.on("tooltipclose", (ev) => {
    if (openHoverTooltip === ev.tooltip) openHoverTooltip = null;
  });
  map.on("popupopen", () => {
    if (openHoverTooltip) map.closeTooltip(openHoverTooltip);
    openHoverTooltip = null;
  });

  function syncMapTheme() {
    const dark = isDarkActive();
    mapContainer.style.backgroundColor = dark ? "#121211" : "#eae6df";
    syncPanePointerEvents();
    updateTileLayer();
    if (countriesLayer) countriesLayer.setStyle(getCountryStyle);
    if (statesLayer) statesLayer.setStyle(getStateStyle);
    if (canadaProvincesLayer) canadaProvincesLayer.setStyle(getCanadaProvinceStyle);
    if (selectedGeoEntry?.layer) {
      applyGeoShapeHighlight(selectedGeoEntry.layer, selectedGeoEntry.isVisited);
    }
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
        pane: "choroplethPane",
        style: getCountryStyle,
        onEachFeature: (feature, layer) => {
          const nm = feature.properties?.name;
          if (nm === "United States of America" || nm === "United States" || nm === "Canada") {
            // Sub-national layers (50 US states & 13 Canadian provinces) handle interaction directly
            if (layer.options) layer.options.interactive = false;
            return;
          }
          if (nm) {
            const visited = Boolean(feature.properties.visited);
            const status = visited
              ? "✓ Visited &amp; Photographed (39/199 Quest)"
              : "Not yet visited";
            layer.bindTooltip(`<strong>${escMapHtml(nm)}</strong><br>${status}`, {
              sticky: true,
              direction: "top"
            });
            wireGeoShapeHighlight(
              layer,
              () => countriesLayer,
              visited,
              `${nm} — ${visited ? "Visited (39/199 Countries)" : "Remaining Quest Target"}`
            );
          }
        }
      }).addTo(map);
    }
    if (statesGeo) {
      statesLayer = L.geoJSON(statesGeo, {
        pane: "choroplethPane",
        style: getStateStyle,
        onEachFeature: (feature, layer) => {
          const nm = feature.properties?.name;
          if (nm) {
            layer.bindTooltip(
              `<strong>${escMapHtml(nm)}</strong><br>✓ All 50 US States Visited`,
              { sticky: true, direction: "top" }
            );
            wireGeoShapeHighlight(
              layer,
              () => statesLayer,
              true,
              `${nm} — ✓ All 50 US States Visited`
            );
          }
        }
      }).addTo(map);
    }
    if (canadaGeo) {
      canadaProvincesLayer = L.geoJSON(canadaGeo, {
        pane: "choroplethPane",
        style: getCanadaProvinceStyle,
        onEachFeature: (feature, layer) => {
          const nm = feature.properties?.name;
          if (nm) {
            const visited = Boolean(feature.properties.visited);
            const code = feature.properties.code ? ` (${feature.properties.code})` : "";
            const status = visited
              ? "✓ Visited (8/13 Canadian Provinces &amp; Territories)"
              : "○ Remaining Quest Target (5 left for 13/13)";
            layer.bindTooltip(
              `<strong>${escMapHtml(nm + code)}</strong><br>${status}`,
              { sticky: true, direction: "top" }
            );
            wireGeoShapeHighlight(
              layer,
              () => canadaProvincesLayer,
              visited,
              `${nm}${code} — ${visited ? "✓ Visited (8/13 Canada)" : "○ Remaining Quest Target"}`
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

  let activeDotMarkers = [];
  let activeMarkersAreGlyphs = false;

  function updateDotRadiiInPlace(zoom) {
    lastMarkerZoomTier = getMarkerZoomTier(zoom);
    const clusterR = zoom >= 6 ? 4.2 : 3.4;
    const baseSubRadius = zoom >= 12 ? 4.3 : zoom >= 8 ? 3.5 : zoom >= 5 ? 2.9 : 2.4;
    const basePinRadius = zoom >= 11 ? 5.8 : zoom >= 7 ? 4.9 : zoom >= 4 ? 4.2 : 3.7;
    for (let i = 0; i < activeDotMarkers.length; i++) {
      const rec = activeDotMarkers[i];
      if (rec.kind === "cluster") {
        rec.marker.setRadius(clusterR);
      } else if (rec.kind === "place") {
        rec.marker.setRadius(baseSubRadius + getVisitRadiusBoost(rec.count, zoom));
      } else if (rec.kind === "photo") {
        rec.marker.setRadius(basePinRadius + getVisitRadiusBoost(rec.count, zoom) * 0.7);
      }
    }
  }

  function rebuildMarkers() {
    pinsLayerGroup.clearLayers();
    activeDotMarkers = [];
    if (!lensShowsPhotos() || !mapsData) return;

    const dark = isDarkActive();
    const zoom = map.getZoom();
    lastMarkerZoomTier = getMarkerZoomTier(zoom);
    const bindHoverTooltips = !isCoarseMapPointer;
    const showGlyphs = zoom >= GLYPH_MIN_ZOOM;
    activeMarkersAreGlyphs = showGlyphs;

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
        if (bindHoverTooltips) {
          cm.bindTooltip(() => `<strong>${escMapHtml(label)}</strong>`, { direction: "top" });
        }
        cm.on("click", (ev) => {
          if (activateClosestPinAt(ev.containerPoint, ev.originalEvent)) return;
          stopAutoPlay();
          map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 6), { duration: 0.85 });
          if (statusLineEl) statusLineEl.textContent = `Exploring: ${label}`;
        });
        cm.addTo(pinsLayerGroup);
        if (!showGlyphs) activeDotMarkers.push({ marker: cm, kind: "cluster", count: 1 });
      }
    }

    // 1b. Places Matt Visited (pre-sorted ascending by repeat visitCount; 1x drawn first, favorites on top)
    const glyphBaseRadius = zoom >= 15 ? 9.5 : 8.2;
    if (currentSlideFilter === "all" && mapOnlyPins.length) {
      const baseSubRadius = zoom >= 12 ? 4.3 : zoom >= 8 ? 3.5 : zoom >= 5 ? 2.9 : 2.4;

      for (let i = 0; i < mapOnlyPins.length; i++) {
        const item = mapOnlyPins[i];
        const [lat, lng, name, loc, rating, , lastDate, category, visitCount, firstDate] = item;
        const count = Number(visitCount) || 1;
        const isFrequent = count >= 5;
        const glyph = showGlyphs ? getCategoryIcon(category, "") : "";
        const boost = getVisitRadiusBoost(count, zoom);
        const mPin = glyph
          ? new GlyphCircleMarker([lat, lng], {
              renderer: pinsCanvasRenderer,
              radius: glyphBaseRadius + boost * 0.6,
              glyph,
              ...glyphPinStyle(dark, isFrequent)
            })
          : L.circleMarker([lat, lng], {
              renderer: pinsCanvasRenderer,
              radius: baseSubRadius + boost,
              color: dark ? "#141312" : "#ffffff",
              weight: isFrequent ? 1.25 : 0.85,
              fillColor: isFrequent
                ? (dark ? "#ffbe5c" : "#c96214")
                : (dark ? "#f0ad4e" : "#d97724"),
              fillOpacity: count >= 3 ? 0.92 : 0.8
            });
        if (bindHoverTooltips) {
          mPin.bindTooltip(
            () =>
              buildPinLabelHtml({
                icon: getCategoryIcon(category, "📍"),
                name,
                rating,
                loc,
                category,
                lastDate,
                firstDate,
                visitCount: count
              }),
            { direction: "top", className: "pin-tip", offset: [0, -4] }
          );
        }
        mPin.on("click", (ev) => {
          if (activateClosestPinAt(ev.containerPoint, ev.originalEvent)) return;
          stopAutoPlay();
          openPlaceOnlyPopup(item);
        });
        mPin.addTo(pinsLayerGroup);
        if (!showGlyphs) activeDotMarkers.push({ marker: mPin, kind: "place", count });
      }
    }

    // 2. All photo dispatch dots on shared HTML5 Canvas (pinsPane above choropleth)
    let activeEntry = null;
    const basePinRadius = zoom >= 11 ? 5.8 : zoom >= 7 ? 4.9 : zoom >= 4 ? 4.2 : 3.7;
    filteredPlaces.forEach((pl, idx) => {
      if (idx === activePlaceIndex) {
        activeEntry = { pl, idx };
        return;
      }
      const pCount = pl.visitCount || 1;
      const pRadius = basePinRadius + getVisitRadiusBoost(pCount, zoom) * 0.7;
      const photoGlyph = showGlyphs ? getCategoryIcon(pl.category, "") : "";
      const marker = photoGlyph
        ? new GlyphCircleMarker([pl.lat, pl.lng], {
            renderer: pinsCanvasRenderer,
            radius: glyphBaseRadius + 1 + getVisitRadiusBoost(pCount, zoom) * 0.4,
            glyph: photoGlyph,
            color: dark ? "#e88264" : "#9e3b24",
            weight: 2.4,
            fillColor: dark ? "#24211d" : "#fffaf2",
            fillOpacity: 0.97
          })
        : L.circleMarker([pl.lat, pl.lng], {
            renderer: pinsCanvasRenderer,
            radius: pRadius,
            color: dark ? "#141312" : "#ffffff",
            weight: zoom >= 6 ? 1.25 : 1.0,
            fillColor: dark ? "#e88264" : "#9e3b24",
            fillOpacity: 0.94
          });
      if (bindHoverTooltips) {
        marker.bindTooltip(
          () =>
            buildPinLabelHtml({
              icon: getCategoryIcon(pl.category, "📸"),
              name: pl.name,
              rating: pl.rating,
              loc: pl.location,
              lastDate: pl.date,
              firstDate: pl.firstDate,
              visitCount: pl.visitCount
            }),
          { direction: "top", className: "pin-tip", offset: [0, -4] }
        );
      }
      marker.on("click", (ev) => {
        if (activateClosestPinAt(ev.containerPoint, ev.originalEvent)) return;
        openPhotoPinSelection(idx);
      });
      marker.addTo(pinsLayerGroup);
      if (!showGlyphs) activeDotMarkers.push({ marker, kind: "photo", count: pCount });
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
      if (bindHoverTooltips) {
        hero.bindTooltip(
          () =>
            buildPinLabelHtml({
              icon: getCategoryIcon(pl.category, "📍"),
              name: pl.name,
              rating: pl.rating,
              loc: pl.location,
              lastDate: pl.date,
              firstDate: pl.firstDate,
              visitCount: pl.visitCount
            }),
          { direction: "top", className: "pin-tip", offset: [0, -6] }
        );
      }
      hero.on("click", (ev) => {
        if (ev.originalEvent) ev.originalEvent._mlbPinHandled = true;
        stopAutoPlay();
        selectPlace(idx, true);
      });
      hero.addTo(pinsLayerGroup);
      hero.bringToFront();
    }
    syncPanePointerEvents();
  }

  map.on("zoomend", () => {
    if (isOneHandZooming) return;
    const z = map.getZoom();
    const nextTier = getMarkerZoomTier(z);
    if (nextTier !== lastMarkerZoomTier) {
      const wantsGlyphs = z >= GLYPH_MIN_ZOOM;
      if (!wantsGlyphs && !activeMarkersAreGlyphs && activeDotMarkers.length) {
        updateDotRadiiInPlace(z);
      } else {
        if (markerRebuildTimer) clearTimeout(markerRebuildTimer);
        markerRebuildTimer = setTimeout(() => {
          markerRebuildTimer = null;
          rebuildMarkers();
        }, 90);
      }
    }
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
    if (catEl) {
      const catIcon = getCategoryIcon(place.category, "");
      catEl.textContent = place.category
        ? `${catIcon ? `${catIcon} ` : ""}${place.category}`
        : "Field Dispatch";
    }
    if (coordsEl) {
      const slideSpan = formatVisitSpan(place.date, place.firstDate, place.visitCount);
      coordsEl.textContent = slideSpan
        ? `${slideSpan} · ${formatCoords(place.lat, place.lng)}`
        : formatCoords(place.lat, place.lng);
    }
    if (titleEl) titleEl.textContent = place.name;
    if (locEl) locEl.textContent = place.location;
    if (descEl) {
      descEl.textContent =
        place.caption ||
        (place.date
          ? `Photographed in ${place.location || place.name} (${place.date}).`
          : `Photographed on Google Maps in ${place.location || place.name}.`);
    }
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
      btn.scrollIntoView({ block: "nearest", inline: "nearest", container: "nearest" });
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
      btn.scrollIntoView({ block: "nearest", inline: "nearest", container: "nearest" });
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
  const locateBtn = document.getElementById("map-locate-btn");
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
    all: "All layers active: 10,700+ photo & visited-place pins, 173 Flighty routes, visited choropleth & Trans-Canada drive",
    static: "MapChart reference export · Scroll or use + / − to zoom, drag to pan"
  };

  const mapLensToolbar = document.getElementById("map-lens-toolbar");
  if (
    typeof IntersectionObserver !== "undefined" &&
    !(typeof CSS !== "undefined" && CSS.supports && CSS.supports("animation-timeline", "scroll(self inline)"))
  ) {
    document
      .querySelectorAll(
        "#map-lens-toolbar, .atlas-toolbar .toolbar-group, .slideshow-nav-btns, .lb-lists-toolbar, .letterboxd-controls .toolbar-group"
      )
      .forEach((scroller) => {
        const [firstItem, lastItem] = [scroller.firstElementChild, scroller.lastElementChild];
        if (!firstItem || !lastItem) return;
        const fadeObserver = new IntersectionObserver(
          (entries) => {
            for (const { target, intersectionRatio } of entries) {
              scroller.classList.toggle(
                target === firstItem ? "more-start" : "more-end",
                intersectionRatio < 1
              );
            }
          },
          { root: scroller, threshold: 1, rootMargin: "1px" }
        );
        fadeObserver.observe(firstItem);
        fadeObserver.observe(lastItem);
      });
  }

  function revealLensButtonInBar(btn) {
    if (!btn || !mapLensToolbar || mapLensToolbar.scrollWidth <= mapLensToolbar.clientWidth) return;
    const barRect = mapLensToolbar.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const pad = 36;
    if (btnRect.left < barRect.left + pad) {
      mapLensToolbar.scrollBy({
        left: btnRect.left - barRect.left - pad,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"
      });
    } else if (btnRect.right > barRect.right - pad) {
      mapLensToolbar.scrollBy({
        left: btnRect.right - barRect.right + pad,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"
      });
    }
  }

  function setMapLens(lens, fromToolbarClick = false) {
    activeLens = lens;
    const isStatic = lens === "static";
    let activeBtn = null;
    document.querySelectorAll("[data-map-lens]").forEach((btn) => {
      const isMatch = btn.getAttribute("data-map-lens") === lens;
      btn.setAttribute("aria-pressed", String(isMatch));
      if (isMatch) activeBtn = btn;
    });
    if (activeBtn) {
      if (fromToolbarClick) {
        activeBtn.scrollIntoView({ block: "nearest", inline: "nearest", container: "nearest" });
      } else {
        revealLensButtonInBar(activeBtn);
      }
    }
    if (!lensShowsPhotos()) {
      map.closePopup();
    }
    if (mapCanvasWrap) mapCanvasWrap.hidden = isStatic;
    if (staticMapWrap) staticMapWrap.hidden = !isStatic;
    if (isStatic) {
      syncPanePointerEvents();
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
      setMapLens(nextLens, true);
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

    const explorerSec = document.getElementById("map");
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
          "Goal 03: 8/13 Canadian Provinces & Territories + Disjoint Trans-Canada Drive (Halifax → Thunder Bay & Alberta/BC Rockies to Kamloops)";
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
  if (locateBtn) {
    let userLocLayer = null;
    let isLocating = false;

    locateBtn.addEventListener("click", () => {
      stopAutoPlay();
      if (isLocating) return;
      if (!("geolocation" in navigator)) {
        if (statusLineEl) statusLineEl.textContent = "Current location is unavailable in this browser.";
        return;
      }

      if (activeLens === "static") {
        setMapLens("photos");
      }

      isLocating = true;
      locateBtn.setAttribute("aria-busy", "true");
      locateBtn.classList.add("is-locating");
      if (statusLineEl) statusLineEl.textContent = "Locating your current position…";

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          isLocating = false;
          locateBtn.removeAttribute("aria-busy");
          locateBtn.classList.remove("is-locating");

          const { latitude, longitude, accuracy } = pos.coords;
          if (!userLocLayer) {
            userLocLayer = L.layerGroup().addTo(map);
          } else {
            userLocLayer.clearLayers();
          }

          if (Number.isFinite(accuracy) && accuracy > 0 && accuracy <= 5000) {
            L.circle([latitude, longitude], {
              radius: accuracy,
              color: "#2563eb",
              weight: 1,
              opacity: 0.4,
              fillColor: "#3b82f6",
              fillOpacity: 0.12,
              interactive: false
            }).addTo(userLocLayer);
          }

          L.circleMarker([latitude, longitude], {
            radius: 7,
            color: "#ffffff",
            weight: 2.5,
            fillColor: "#2563eb",
            fillOpacity: 1
          })
            .bindTooltip("Your current location", { direction: "top", offset: [0, -8] })
            .addTo(userLocLayer);

          map.flyTo([latitude, longitude], Math.max(map.getZoom(), 12), { duration: 1.0 });
          if (statusLineEl) statusLineEl.textContent = "Centered on your current location";
        },
        (err) => {
          isLocating = false;
          locateBtn.removeAttribute("aria-busy");
          locateBtn.classList.remove("is-locating");

          if (statusLineEl) {
            statusLineEl.textContent =
              err && err.code === 1
                ? "Location permission denied — enable location access to jump here."
                : "Unable to determine your current location right now.";
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
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

  function expandPhotoUrl(u) {
    if (typeof u !== "string" || !u) return "";
    if (!u.startsWith("lh3:")) return u;
    const body = u.slice(4);
    const hasSize = /=[^=/]+$/.test(body);
    return `https://lh3.googleusercontent.com/${body}${hasSize ? "" : "=w1000-h750-p-k-no"}`;
  }

  function hydratePlace(p) {
    if (!p) return p;
    if (Array.isArray(p.photos) && p.photos.length) {
      p.photos = p.photos.map(expandPhotoUrl);
    }
    if (!p.countryIso) p.countryIso = "US";
    return p;
  }

  // Load lightweight Google Maps index JSON (<256 KB) first, then stream 1,000+ extended pins
  fetch("data/maps-index.json")
    .then((r) => r.json())
    .then((data) => {
      mapsData = data;
      allRawPlaces = Array.isArray(data.places) ? data.places.map(hydratePlace) : [];
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
          const extra = Array.isArray(pinsPayload.extraPins) ? pinsPayload.extraPins.map(hydratePlace) : [];
          if (Array.isArray(pinsPayload.mapOnlyPins)) {
            mapOnlyPins = pinsPayload.mapOnlyPins
              .slice()
              .sort((a, b) => (Number(a[8]) || 1) - (Number(b[8]) || 1));
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
    const lessBtn = document.getElementById("gmap-rev-less-btn");
    const countLabel = document.getElementById("gmap-rev-count-label");
    const summaryCount = document.getElementById("gmap-rev-summary-count");
    const searchInput = document.getElementById("gmap-rev-search");
    const shufBtn = document.getElementById("gmap-rev-shuffle-btn");
    if (!grid) return;

    if (summaryCount && reviewsList.length) {
      summaryCount.textContent = formatNumber(reviewsList.length);
    }

    const INITIAL_REV_LIMIT = 3;
    let activeFilter = "all";
    let query = "";
    let visibleLimit = INITIAL_REV_LIMIT;
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
      if (lessBtn) {
        lessBtn.hidden = visibleLimit <= INITIAL_REV_LIMIT || matches.length <= INITIAL_REV_LIMIT;
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
        visibleLimit = INITIAL_REV_LIMIT;
        document.querySelectorAll("[data-gmap-filter]").forEach((b) => {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        btn.scrollIntoView({ block: "nearest", inline: "nearest", container: "nearest" });
        renderGrid();
      });
    });

    if (shufBtn) {
      shufBtn.addEventListener("click", () => {
        baseOrder = shuffleArray(reviewsList);
        visibleLimit = INITIAL_REV_LIMIT;
        renderGrid();
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        query = searchInput.value.trim();
        visibleLimit = INITIAL_REV_LIMIT;
        renderGrid();
      });
    }

    if (moreBtn) {
      moreBtn.addEventListener("click", () => {
        visibleLimit += 9;
        renderGrid();
      });
    }

    if (lessBtn) {
      lessBtn.addEventListener("click", () => {
        visibleLimit = INITIAL_REV_LIMIT;
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
     Progressive Disclosure for Eclectic Side Quests (hidden="until-found")
     ========================================================================== */
  const eclecticExtraPanel = document.getElementById("eclectic-extra-panel");
  const eclecticMoreBtn = document.getElementById("eclectic-more-btn");

  if (eclecticExtraPanel && eclecticMoreBtn) {
    let eclecticExpanded = false;

    const setEclecticExpanded = (expand) => {
      eclecticExpanded = expand;
      if (expand) {
        eclecticExtraPanel.removeAttribute("hidden");
      } else if ("onbeforematch" in HTMLElement.prototype) {
        eclecticExtraPanel.setAttribute("hidden", "until-found");
      } else {
        eclecticExtraPanel.hidden = true;
      }
      eclecticMoreBtn.setAttribute("aria-expanded", String(expand));
      eclecticMoreBtn.textContent = expand
        ? "Show Fewer Side Quests"
        : "Show All 6 Side Quests (+3 more)";
    };

    eclecticExtraPanel.addEventListener("beforematch", () => {
      setEclecticExpanded(true);
    });

    eclecticMoreBtn.addEventListener("click", () => {
      setEclecticExpanded(!eclecticExpanded);
    });
  }

  const theatreCreditsDrawer = document.querySelector(".theatre-credits-drawer");
  const theatreCard = theatreCreditsDrawer?.closest(".eclectic-card");
  if (theatreCreditsDrawer && theatreCard) {
    document.addEventListener("click", (ev) => {
      if (!theatreCreditsDrawer.open) return;
      if (ev.target instanceof Node && !theatreCard.contains(ev.target)) {
        theatreCreditsDrawer.open = false;
      }
    });
  }

  function isMovieDeepLinkActive() {
    const h = normalizeDeepHash(window.location.hash);
    return (
      h === "#letterboxd" ||
      h === "#film-lists" ||
      h === "#eclectic" ||
      hasInitialMovieParams ||
      savedScrollState?.sectionId === "eclectic" ||
      savedScrollState?.sectionId === "letterboxd"
    );
  }

  function runWhenNearLetterboxd(taskFn) {
    const targetEl = document.getElementById("letterboxd") || document.getElementById("eclectic");
    if (!targetEl || typeof IntersectionObserver === "undefined" || isMovieDeepLinkActive()) {
      taskFn();
      return;
    }
    let started = false;
    const trigger = () => {
      if (started) return;
      started = true;
      obs.disconnect();
      taskFn();
    };
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) trigger();
      },
      { rootMargin: "700px 0px" }
    );
    obs.observe(targetEl);
    window.addEventListener("hashchange", () => {
      if (isMovieDeepLinkActive()) trigger();
    });
  }

  /* ==========================================================================
     Hosted Letterboxd Reviews (@brslli) + Auto-Updating Edge RSS Sync
     ========================================================================== */
  const lbGrid = document.getElementById("letterboxd-grid");
  const lbMoreBtn = document.getElementById("lb-more-btn");
  const lbLessBtn = document.getElementById("lb-less-btn");
  const lbCountLabel = document.getElementById("lb-count-label");
  const lbSearchInput = document.getElementById("lb-search-input");
  const lbShuffleBtn = document.getElementById("lb-shuffle-btn");
  const lbFavShelf = document.getElementById("lb-favorites-shelf");
  const lbFavList = document.getElementById("lb-favorites-list");

  const INITIAL_LB_REV_COUNT = 3;
  const VALID_LB_FILTERS = new Set(["latest", "five", "favorites", "liked", "theatres"]);
  let allLbReviews = [];
  const initFilmQuery = (initialUrlParams.get("film") || initialUrlParams.get("movie") || "").trim();
  const initFilterParam = (initialUrlParams.get("filter") || "").trim().toLowerCase();
  let activeLbFilter = VALID_LB_FILTERS.has(initFilterParam) ? initFilterParam : "latest";
  let lbSearchQuery = initFilmQuery;
  let lbVisibleCount = INITIAL_LB_REV_COUNT;
  let lbShuffledOrder = null;
  let lbUrlSyncTimer = null;

  if (lbSearchInput && lbSearchQuery) {
    lbSearchInput.value = lbSearchQuery;
  }
  if (activeLbFilter !== "latest") {
    document.querySelectorAll("[data-lb-filter]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-lb-filter") === activeLbFilter));
    });
  }

  function buildShareableMoviesUrl(targetHash = "letterboxd") {
    const url = new URL(window.location.href);
    url.searchParams.delete("movie");
    if (targetHash === "letterboxd" && lbSearchQuery) {
      url.searchParams.set("film", lbSearchQuery);
    } else {
      url.searchParams.delete("film");
    }
    if (targetHash === "letterboxd" && activeLbFilter && activeLbFilter !== "latest") {
      url.searchParams.set("filter", activeLbFilter);
    } else {
      url.searchParams.delete("filter");
    }
    url.hash = targetHash;
    return url.toString();
  }

  function syncMovieUrlParams() {
    const url = new URL(window.location.href);
    url.searchParams.delete("movie");
    if (lbSearchQuery) {
      url.searchParams.set("film", lbSearchQuery);
    } else {
      url.searchParams.delete("film");
    }
    if (activeLbFilter && activeLbFilter !== "latest") {
      url.searchParams.set("filter", activeLbFilter);
    } else {
      url.searchParams.delete("filter");
    }
    if (lbSearchQuery || activeLbFilter !== "latest") {
      url.hash = "letterboxd";
    }
    try {
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {}
  }

  /* ==========================================================================
     Universal Click-Any-Header Link Copy + Top-Layer Toast Notification
     ========================================================================== */
  const copyToast = document.getElementById("copy-toast");
  const copyToastText = document.getElementById("copy-toast-text");
  const copyToastClose = document.getElementById("copy-toast-close");
  const toastAnnouncer = document.getElementById("toast-live-announcer");
  let toastDismissTimer = null;
  let toastPriorTrigger = null;
  let lastToastAnnouncement = "";

  function hideSiteToast(restoreFocus = false) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
    if (!copyToast) return;
    if (typeof copyToast.hidePopover === "function") {
      try {
        if (copyToast.matches(":popover-open")) copyToast.hidePopover();
      } catch {}
    }
    copyToast.classList.remove("is-open");
    if (restoreFocus && toastPriorTrigger && typeof toastPriorTrigger.focus === "function") {
      toastPriorTrigger.focus({ preventScroll: true });
    }
  }

  function scheduleToastAutoDismiss() {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = setTimeout(() => {
      if (copyToast && copyToast.contains(document.activeElement)) {
        return;
      }
      hideSiteToast(false);
    }, 2300);
  }

  if (copyToast) {
    copyToast.addEventListener("focusout", (ev) => {
      if (!copyToast.contains(ev.relatedTarget)) {
        scheduleToastAutoDismiss();
      }
    });
  }

  if (copyToastClose) {
    copyToastClose.addEventListener("click", (ev) => {
      ev.preventDefault();
      const hadFocusInside = Boolean(copyToast && copyToast.contains(document.activeElement));
      hideSiteToast(hadFocusInside);
    });
  }

  function showSiteToast(message, triggerEl = null) {
    const dialogEl = document.getElementById("lb-list-dialog");
    if (dialogEl?.open || !copyToast || !copyToastText) return;
    toastPriorTrigger = triggerEl;
    copyToastText.textContent = message;

    if (typeof copyToast.showPopover === "function") {
      try {
        if (!copyToast.matches(":popover-open")) copyToast.showPopover();
      } catch {}
    } else {
      copyToast.classList.add("is-open");
    }

    if (typeof document.ariaNotify === "function") {
      document.ariaNotify(message);
    } else if (toastAnnouncer) {
      let announced = message;
      if (announced === lastToastAnnouncement) announced += "\u00A0";
      lastToastAnnouncement = announced;
      toastAnnouncer.textContent = "";
      requestAnimationFrame(() => {
        toastAnnouncer.textContent = announced;
      });
    }

    scheduleToastAutoDismiss();
  }

  // Expand collapsed side quests automatically if initial URL points directly to one of them
  if (initialRawHash && eclecticExtraPanel) {
    const rawTarget = document.getElementById(initialRawHash.replace(/^#/, ""));
    if (rawTarget && eclecticExtraPanel.contains(rawTarget)) {
      eclecticExtraPanel.removeAttribute("hidden");
      eclecticMoreBtn?.setAttribute("aria-expanded", "true");
      if (eclecticMoreBtn) eclecticMoreBtn.textContent = "Show Fewer Side Quests";
      requestAnimationFrame(() => {
        rawTarget.scrollIntoView({ behavior: "instant", block: "start" });
      });
    }
  }

  document.addEventListener("click", async (ev) => {
    const link = ev.target instanceof Element ? ev.target.closest("a.section-anchor-link") : null;
    if (!link || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();

    const isRoot = link.hasAttribute("data-copy-root");
    const rawHref = link.getAttribute("href") || "";
    const labelTxt = link.textContent.trim().slice(0, 36);

    let shareUrl;
    let targetId = "";
    if (isRoot) {
      const u = new URL(window.location.href);
      u.search = "";
      u.hash = "";
      shareUrl = u.toString();
    } else if (rawHref.startsWith("?")) {
      const u = new URL(rawHref, `${window.location.origin}${window.location.pathname}`);
      shareUrl = u.toString();
      targetId = u.hash.replace(/^#/, "") || "letterboxd";
    } else {
      targetId = rawHref.replace(/^#/, "");
      if (targetId === "letterboxd") {
        shareUrl = buildShareableMoviesUrl("letterboxd");
      } else {
        const u = new URL(window.location.href);
        u.searchParams.delete("film");
        u.searchParams.delete("movie");
        u.searchParams.delete("filter");
        u.searchParams.delete("list");
        u.hash = targetId;
        shareUrl = u.toString();
      }
    }

    navScrollLockUntil = performance.now() + 900;
    activeTrackedSection = targetId;
    try {
      const parsed = new URL(shareUrl);
      history.replaceState(null, "", `${parsed.pathname}${parsed.search}${parsed.hash}`);
    } catch {}
    syncNavAndHash(targetId, false);

    try {
      await navigator.clipboard.writeText(shareUrl);
      showSiteToast(labelTxt ? `Copied link to “${labelTxt}”` : "Link copied to clipboard", link);
    } catch {
      showSiteToast("Updated link in address bar", link);
    }
  });

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
    if (lbLessBtn) {
      lbLessBtn.hidden = lbVisibleCount <= INITIAL_LB_REV_COUNT || matches.length <= INITIAL_LB_REV_COUNT;
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
        lbVisibleCount = INITIAL_LB_REV_COUNT;
        document.querySelectorAll("[data-lb-filter]").forEach((b) => {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        btn.scrollIntoView({ block: "nearest", inline: "nearest", container: "nearest" });
        syncMovieUrlParams();
        renderLbReviews();
      });
    });

    if (lbShuffleBtn) {
      lbShuffleBtn.addEventListener("click", () => {
        lbShuffledOrder = shuffleArray(allLbReviews);
        lbVisibleCount = INITIAL_LB_REV_COUNT;
        renderLbReviews();
      });
    }

    if (lbSearchInput) {
      lbSearchInput.addEventListener("input", () => {
        lbSearchQuery = lbSearchInput.value.trim();
        lbVisibleCount = INITIAL_LB_REV_COUNT;
        if (lbUrlSyncTimer) clearTimeout(lbUrlSyncTimer);
        lbUrlSyncTimer = setTimeout(syncMovieUrlParams, 220);
        renderLbReviews();
      });
    }

    if (lbMoreBtn) {
      lbMoreBtn.addEventListener("click", () => {
        lbVisibleCount += 9;
        renderLbReviews();
      });
    }

    if (lbLessBtn) {
      lbLessBtn.addEventListener("click", () => {
        lbVisibleCount = INITIAL_LB_REV_COUNT;
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

    function alignInitialMovieDeepLink() {
      if (isPageReload || userInteractedSinceLoad) return;
      const normHash = normalizeDeepHash(initialRawHash);
      const targetId =
        normHash === "#film-lists"
          ? "film-lists"
          : normHash === "#letterboxd" || hasInitialMovieParams
            ? "letterboxd"
            : "";
      if (!targetId) return;
      const targetEl = document.getElementById(targetId);
      if (!targetEl) return;
      navScrollLockUntil = performance.now() + 900;
      activeTrackedSection = targetId;
      syncNavAndHash(targetId, true);
      const topY = targetEl.getBoundingClientRect().top + window.scrollY - getHeaderOffset();
      window.scrollTo({ top: Math.max(0, topY), behavior: "instant" });
      if (hasInitialMovieParams && initFilmQuery && lbSearchInput) {
        lbSearchInput.focus({ preventScroll: true });
      }
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
            alignInitialMovieDeepLink();
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
            if (!renderedFromCache) {
              restoreReloadSectionPosition();
              alignInitialMovieDeepLink();
            }
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

    runWhenNearLetterboxd(loadLetterboxdWithCache);
  }

  /* ==========================================================================
     Curated Letterboxd Lists Shelf + Native <dialog> 2:3 Poster Gallery
     ========================================================================== */
  const lbListsGrid = document.getElementById("lb-lists-grid");
  const lbListsMoreRow = document.getElementById("lb-lists-more-row");
  const lbListsMoreBtn = document.getElementById("lb-lists-more-btn");
  const lbListsLessBtn = document.getElementById("lb-lists-less-btn");
  const lbListDialog = document.getElementById("lb-list-dialog");

  if (lbListDialog) {
    lbListDialog.addEventListener("close", () => {
      lbListDialog.returnValue = "";
    });
    // Light-dismiss fallback for browsers without native <dialog closedby="any">
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      const isOutside = (ev) => {
        const r = lbListDialog.getBoundingClientRect();
        return (
          ev.clientX < r.left ||
          ev.clientX > r.right ||
          ev.clientY < r.top ||
          ev.clientY > r.bottom
        );
      };
      let pressedOut = false;
      lbListDialog.addEventListener("pointerdown", (ev) => {
        pressedOut = isOutside(ev);
      });
      lbListDialog.addEventListener("pointerup", (ev) => {
        if (pressedOut && isOutside(ev)) lbListDialog.close();
      });
    }
  }

  if (lbListsGrid) {
    const INITIAL_LISTS_COUNT = 3;
    let allLists = [];
    let activeListCat = "all";
    let listsVisibleCount = INITIAL_LISTS_COUNT;

    const LIST_CAT_BADGES = {
      tropes: "🎬 Cinema Trope",
      yearly: "🎟️ 2026 & Ranked",
      "places-seasons": "📍 Place & Season"
    };

    function openListModal(listObj) {
      if (!lbListDialog || !listObj) return;
      const titleEl = document.getElementById("lb-list-dialog-title");
      const descEl = document.getElementById("lb-list-dialog-desc");
      const badgesEl = document.getElementById("lb-list-dialog-badges");
      const linkEl = document.getElementById("lb-list-dialog-link");
      const gridEl = document.getElementById("lb-list-dialog-grid");
      const footerEl = document.getElementById("lb-list-dialog-footer");

      if (titleEl) titleEl.textContent = listObj.title;
      if (descEl) {
        descEl.textContent = listObj.description || "Curated film list by Matt B (@brslli) on Letterboxd.";
      }
      if (linkEl) linkEl.href = listObj.url || "https://letterboxd.com/brslli/lists/";
      if (badgesEl) {
        badgesEl.innerHTML = "";
        const b1 = document.createElement("span");
        b1.className = "badge";
        b1.textContent = listObj.isRanked ? "🏆 Ranked / Ordered List" : (LIST_CAT_BADGES[listObj.category] || "🎬 Curated List");
        const b2 = document.createElement("span");
        b2.className = "lb-list-count";
        b2.textContent = `${formatNumber(listObj.filmCount)} ${listObj.filmCount === 1 ? "film" : "films"}`;
        badgesEl.append(b1, b2);
      }

      if (gridEl) {
        gridEl.innerHTML = "";
        const films = listObj.films || [];
        films.forEach((f, idx) => {
          const li = document.createElement("li");
          li.className = "lb-dialog-film";

          const a = document.createElement("a");
          a.className = "lb-dialog-poster-link";
          a.href = f.link || listObj.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.setAttribute("aria-label", `${f.title}${f.year ? ` (${f.year})` : ""} on Letterboxd`);

          if (f.poster) {
            const img = document.createElement("img");
            img.className = "lb-dialog-poster-img";
            img.src = f.poster;
            img.alt = `${f.title}${f.year ? ` (${f.year})` : ""} poster`;
            img.width = 200;
            img.height = 300;
            img.loading = "lazy";
            img.fetchPriority = "low";
            img.referrerPolicy = "no-referrer";
            a.appendChild(img);
          }

          if (f.rank || (/top films/i.test(listObj.title) && listObj.isRanked)) {
            const rk = document.createElement("span");
            rk.className = "lb-dialog-rank-pill";
            rk.textContent = `#${f.rank || idx + 1}`;
            a.appendChild(rk);
          }

          const tSpan = document.createElement("span");
          tSpan.className = "lb-dialog-film-title";
          tSpan.textContent = f.title;

          const metaSpan = document.createElement("span");
          metaSpan.className = "lb-dialog-film-meta";
          if (f.year) {
            const yr = document.createElement("span");
            yr.textContent = f.year;
            metaSpan.appendChild(yr);
          }
          if (typeof f.rating === "number" && f.rating > 0) {
            const st = document.createElement("span");
            st.className = "lb-stars";
            const full = Math.floor(f.rating);
            const half = f.rating - full >= 0.5 ? "½" : "";
            st.textContent = `${"★".repeat(full)}${half}${f.liked ? " ♥" : ""}`;
            metaSpan.appendChild(st);
          } else if (f.liked) {
            const lk = document.createElement("span");
            lk.className = "lb-stars";
            lk.textContent = "♥";
            metaSpan.appendChild(lk);
          }

          li.append(a, tSpan, metaSpan);

          if (f.reviewSnippet) {
            const q = document.createElement("span");
            q.className = "lb-dialog-film-quote";
            q.textContent = `“${f.reviewSnippet}”`;
            li.appendChild(q);
          }

          gridEl.appendChild(li);
        });
      }

      if (footerEl) {
        const shown = (listObj.films || []).length;
        footerEl.textContent =
          listObj.filmCount > shown
            ? `Showing ${formatNumber(shown)} of ${formatNumber(listObj.filmCount)} films in this list — click “Open on Letterboxd” above to browse all ${formatNumber(listObj.filmCount)}.`
            : `Showing all ${formatNumber(shown)} ${shown === 1 ? "film" : "films"} in this list.`;
      }

      if (!lbListDialog.open) {
        lbListDialog.showModal();
      }
    }

    function renderListsShelf() {
      const matching =
        activeListCat === "all"
          ? allLists
          : allLists.filter((l) => l.category === activeListCat);
      const visible = matching.slice(0, listsVisibleCount);

      lbListsGrid.innerHTML = "";
      for (const listObj of visible) {
        const li = document.createElement("li");
        li.className = "lb-list-card";

        // 1. Overlapping 5-poster 2:3 Letterboxd art stack
        const fanBtn = document.createElement("button");
        fanBtn.type = "button";
        fanBtn.className = "lb-list-fan-btn";
        fanBtn.setAttribute(
          "aria-label",
          `Explore ${listObj.title} (${listObj.filmCount} films)`
        );

        const fanUl = document.createElement("ul");
        fanUl.className = "lb-list-poster-fan";
        const previewFilms = (listObj.films || []).filter((f) => f.poster).slice(0, 5);
        previewFilms.forEach((f, idx) => {
          const fanLi = document.createElement("li");
          fanLi.className = "lb-fan-item";
          fanLi.style.zIndex = String(5 - idx);

          const img = document.createElement("img");
          img.className = "lb-fan-poster";
          img.src = f.poster;
          img.alt = "";
          img.width = 144;
          img.height = 216;
          img.loading = "lazy";
          img.fetchPriority = "low";
          img.referrerPolicy = "no-referrer";
          fanLi.appendChild(img);
          fanUl.appendChild(fanLi);
        });
        fanBtn.appendChild(fanUl);
        fanBtn.addEventListener("click", () => openListModal(listObj));

        // 2. Meta + Title + Description
        const metaRow = document.createElement("div");
        metaRow.className = "lb-list-meta-row";
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = /top films/i.test(listObj.title)
          ? "🏆 Ranked Top 10"
          : (LIST_CAT_BADGES[listObj.category] || "🎬 Curated List");
        const countEl = document.createElement("span");
        countEl.className = "lb-list-count";
        countEl.textContent = `${formatNumber(listObj.filmCount)} ${listObj.filmCount === 1 ? "film" : "films"}`;
        metaRow.append(badge, countEl);

        const h4 = document.createElement("h4");
        h4.className = "lb-list-title";
        h4.textContent = listObj.title;

        const desc = document.createElement("p");
        desc.className = "lb-list-desc";
        desc.textContent =
          listObj.description ||
          `Curated collection of ${formatNumber(listObj.filmCount)} ${listObj.filmCount === 1 ? "film" : "films"} on Letterboxd.`;

        const actions = document.createElement("div");
        actions.className = "lb-list-actions";

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "action-btn lb-open-list-btn";
        const shownCnt = (listObj.films || []).length;
        openBtn.textContent =
          listObj.filmCount > shownCnt
            ? `Explore Films (${shownCnt}/${listObj.filmCount})`
            : `Explore ${listObj.filmCount} ${listObj.filmCount === 1 ? "Film" : "Films"}`;
        openBtn.addEventListener("click", () => openListModal(listObj));

        const extLink = document.createElement("a");
        extLink.className = "lb-permalink";
        extLink.href = listObj.url;
        extLink.target = "_blank";
        extLink.rel = "noopener noreferrer";
        extLink.textContent = "Letterboxd ↗";

        actions.append(openBtn, extLink);
        li.append(fanBtn, metaRow, h4, desc, actions);
        lbListsGrid.appendChild(li);
      }

      if (lbListsMoreRow && lbListsMoreBtn) {
        const hasMore = matching.length > listsVisibleCount;
        const canCollapse = listsVisibleCount > INITIAL_LISTS_COUNT && matching.length > INITIAL_LISTS_COUNT;
        lbListsMoreRow.hidden = !hasMore && !canCollapse;
        lbListsMoreBtn.hidden = !hasMore;
        if (hasMore) {
          const rem = matching.length - listsVisibleCount;
          lbListsMoreBtn.textContent = `Show More Lists (+${rem} more)`;
        }
        if (lbListsLessBtn) {
          lbListsLessBtn.hidden = !canCollapse;
        }
      }
    }

    document.querySelectorAll("[data-lb-list-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeListCat = btn.getAttribute("data-lb-list-filter") || "all";
        listsVisibleCount = INITIAL_LISTS_COUNT;
        document.querySelectorAll("[data-lb-list-filter]").forEach((b) => {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        btn.scrollIntoView({ block: "nearest", inline: "nearest", container: "nearest" });
        renderListsShelf();
      });
    });

    if (lbListsMoreBtn) {
      lbListsMoreBtn.addEventListener("click", () => {
        listsVisibleCount += 6;
        renderListsShelf();
      });
    }

    if (lbListsLessBtn) {
      lbListsLessBtn.addEventListener("click", () => {
        listsVisibleCount = INITIAL_LISTS_COUNT;
        renderListsShelf();
      });
    }

    runWhenNearLetterboxd(() => {
      fetch("data/letterboxd-lists.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((payload) => {
          if (!payload || !Array.isArray(payload.lists)) return;
          allLists = payload.lists;
          const statEl = document.getElementById("lb-stat-lists");
          if (statEl && allLists.length) {
            statEl.textContent = `${allLists.length}+`;
          }
          renderListsShelf();
          const listParam = (initialUrlParams.get("list") || "").trim().toLowerCase();
          if (listParam) {
            const matchedList = allLists.find(
              (l) =>
                String(l.slug || "").toLowerCase() === listParam ||
                String(l.title || "").toLowerCase().includes(listParam)
            );
            if (matchedList) openListModal(matchedList);
          }
        })
        .catch(() => {});
    });

  window.addEventListener("hashchange", () => {
    const norm = normalizeDeepHash(window.location.hash);
    if (norm !== window.location.hash) {
      try {
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}${norm}`);
      } catch {}
      const id = norm.replace(/^#/, "");
      const el = id ? document.getElementById(id) : null;
      if (el) {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "start" });
      }
    }
  });
  }
})();
