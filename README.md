# Matt Briselli — Personal Website (`mattbriselli.com`)

A minimalist, editorial personal website, interactive world photo heatmap, and stitched résumé built with semantic HTML, layered modern CSS, vanilla JavaScript, and machine-readable SEO / AI Agent feeds—zero build steps required.

Live at **[https://mattbriselli.com](https://mattbriselli.com)** (hosted on Cloudflare Workers Static Assets).

## Files & Architecture

- [`index.html`](./index.html) — Main website featuring a compact intro, **01 · World Photo Heatmap & Field Notes (`#atlas`)**, **02 · Projects & Shipped Work (`#work`)**, and **03 · Résumé Snapshot (`#resume`)**, plus Schema.org `ProfilePage` + `Person` JSON-LD and metadata-only career status.
- [`styles.css`](./styles.css) — Layered modern CSS (`@layer base, theme, layout, components, utilities;`) with warm editorial paper light mode, deep ink dark mode (`light-dark()`), Forced Colors Mode support, and `@media print` styling.
- [`script.js`](./script.js) — Two-state theme toggle, print handler, and interactive Leaflet + Natural Earth GeoJSON + HTML5 Canvas thermal heatmap & multi-photo slideshow.
- [`data/maps-index.json`](./data/maps-index.json) — Lightweight single-file Google Maps Local Guide Level 10 index (photo CDN URLs, view counts, coordinates, and regional heatmap clusters—zero binary photos stored in Git).
- [`data/world-countries.json`](./data/world-countries.json) & [`data/us-states.json`](./data/us-states.json) — Natural Earth vector boundaries for visited country & 50-state highlighting.
- [`scripts/sync-maps-index.mjs`](./scripts/sync-maps-index.mjs) — Zero-dependency Node CLI for merging new Google Maps places or Google Takeout `Reviews.json` into `data/maps-index.json`.
- [`llms.txt`](./llms.txt) & [`resume.json`](./resume.json) — Structured Markdown and JSON Resume feeds for LLMs, AI search engines, and recruiting agents.
- [`AGENTS.md`](./AGENTS.md) — Workspace instructions for keeping recent work synchronized across Antigravity projects.

## Local Preview

```sh
python3 -m http.server 8080
```

## Updating Google Maps Dispatches

```sh
# Print browser console snippet to grab new places from your Maps Contributor tab
node scripts/sync-maps-index.mjs --snippet

# Merge exported JSON or Google Takeout Reviews.json
node scripts/sync-maps-index.mjs path/to/maps-places.json
```
