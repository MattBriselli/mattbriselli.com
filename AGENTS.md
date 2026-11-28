# Personal Website — Agent & Cross-Project Guidelines

## Overview
This repository (`/Users/M/Dev/Personal Website`) hosts **Matt Briselli's** personal website, stitched curriculum vitae (Tech, Science, and Theatre), travel ledger, and machine-readable SEO/Agent feeds (`llms.txt`, `resume.json`, Schema.org JSON-LD).

## Keeping Recent Work Synchronized
Whenever significant milestones, launches, or new projects are completed across `/Users/M/Dev/` (such as updates to `Mom` / Arioso String Quartet, `GamerBoy`, `Brand Eating`, or new repositories):
1. Update the **02 · Software Engineer + Technical Program Manager (`#coder`)** section in `index.html`.
2. Sync the machine-readable agent feeds in `llms.txt` and `resume.json` so search engines and AI agents always have an accurate picture of Matt's latest work.

## Deferred Work (Do Later)
- **Split the map out of `script.js`:** Everything after the map setup in `script.js` sits behind an early `return` that fires when `#leaflet-world-map` is missing or Leaflet (`window.L`) fails to load. If that happens, header link copying, the toast, the brand-click copy, and the whole Letterboxd/Movies section silently stop working too. Fix: move the map code into its own module or function (e.g. `map.js` / `initMap()`) so a map failure can only break the map. Not urgent, because Leaflet is self-hosted in `vendor/`, but do it before the next big map feature.
