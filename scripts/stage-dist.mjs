#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "data"), { recursive: true });
fs.mkdirSync(path.join(dist, "vendor"), { recursive: true });

const rootFiles = [
  "index.html",
  "styles.css",
  "script.js",
  "llms.txt",
  "resume.json",
  "robots.txt",
  "sitemap.xml",
  "favicon.svg",
  "favicon-32.png",
  "apple-touch-icon.png",
  "og-image.png",
  "matt-briselli.jpg",
  "countries-visited-map.png"
];

for (const file of rootFiles) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dist, file));
  }
}

for (const file of [
  "data/maps-index.json",
  "data/maps-reviews.json",
  "data/flighty-routes.json",
  "data/letterboxd-reviews.json",
  "data/world-countries.json",
  "data/us-states.json",
  "vendor/leaflet.js",
  "vendor/leaflet.css"
]) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

const headers = `/
  Link: <https://mattbriselli.com/llms.txt>; rel="alternate"; type="text/markdown"; title="LLM Overview", <https://mattbriselli.com/resume.json>; rel="alternate"; type="application/json"; title="JSON Resume"

/index.html
  Link: <https://mattbriselli.com/llms.txt>; rel="alternate"; type="text/markdown"; title="LLM Overview", <https://mattbriselli.com/resume.json>; rel="alternate"; type="application/json"; title="JSON Resume"

/llms.txt
  Content-Type: text/markdown; charset=utf-8
  Access-Control-Allow-Origin: *

/resume.json
  Content-Type: application/json; charset=utf-8
  Access-Control-Allow-Origin: *

/favicon.svg
  Content-Type: image/svg+xml
  Cache-Control: public, max-age=86400
`;

fs.writeFileSync(path.join(dist, "_headers"), headers);
console.log("Staged static assets into ./dist");
