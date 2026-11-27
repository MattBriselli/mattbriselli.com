#!/usr/bin/env node
/**
 * One-shot local OAuth 2.0 helper to exchange Foursquare Project Client ID + Client Secret
 * for a personal Swarm access token (`users/self/checkins`), store it in GitHub Actions
 * secret `SWARM_OAUTH_TOKEN`, and run an initial 7-day-delayed sync check.
 *
 * Uses port 8989 (avoiding macOS AirPlay ports 5000/7000).
 *
 * Setup in Foursquare Developer Console -> Project Settings:
 *   1. Add Redirect URI: http://localhost:8989/callback
 *   2. Run:
 *      FOURSQUARE_CLIENT_ID=... FOURSQUARE_CLIENT_SECRET=... node scripts/auth-swarm-local.mjs
 *      (or place FOURSQUARE_CLIENT_ID and FOURSQUARE_CLIENT_SECRET in .env.local)
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = 8989;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

function loadDotEnvLocal() {
  const p = path.resolve(".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

loadDotEnvLocal();

const clientId = (process.env.FOURSQUARE_CLIENT_ID || "").trim();
const clientSecret = (process.env.FOURSQUARE_CLIENT_SECRET || "").trim();

if (!clientId || !clientSecret) {
  console.error(
    "Missing FOURSQUARE_CLIENT_ID or FOURSQUARE_CLIENT_SECRET.\n" +
      "Add them to .env.local (gitignored) or pass them as environment variables."
  );
  process.exit(1);
}

const authUrl =
  "https://foursquare.com/oauth2/authenticate?" +
  new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI
  }).toString();

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || "/", `http://localhost:${PORT}`);
  if (reqUrl.pathname !== "/callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = reqUrl.searchParams.get("code");
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Missing ?code= parameter from Foursquare.");
    return;
  }

  try {
    const tokenUrl =
      "https://foursquare.com/oauth2/access_token?" +
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code
      }).toString();

    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();
    const accessToken = tokenData?.access_token;
    if (!accessToken) {
      throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
    }

    // Store encrypted in GitHub Actions secret SWARM_OAUTH_TOKEN
    execFileSync("gh", ["secret", "set", "SWARM_OAUTH_TOKEN", "--body", accessToken], {
      stdio: "inherit"
    });

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<!doctype html><meta charset='utf-8'><title>Swarm Connected</title>" +
        "<body style='font-family:system-ui;padding:2.5rem;max-width:34rem;margin:auto'>" +
        "<h2>✓ Swarm OAuth Connected</h2>" +
        "<p>Saved encrypted <code>SWARM_OAUTH_TOKEN</code> to GitHub Actions secrets. You can close this tab.</p></body>"
    );

    console.log("\n✓ Saved SWARM_OAUTH_TOKEN to GitHub Actions secrets! Running initial 7-day-delayed sync...");
    server.close(() => {
      try {
        execFileSync("node", ["scripts/sync-swarm-api.mjs"], {
          stdio: "inherit",
          env: { ...process.env, SWARM_OAUTH_TOKEN: accessToken }
        });
      } catch (e) {
        console.error("Initial sync check error:", e.message);
      }
      process.exit(0);
    });
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Error: ${err.message}`);
    console.error(err);
    server.close(() => process.exit(1));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\nListening on ${REDIRECT_URI}`);
  console.log(`Authorize Swarm in your browser:\n\n  ${authUrl}\n`);
  if (process.platform === "darwin") {
    spawn("open", [authUrl], { stdio: "ignore", detached: true }).unref();
  }
});
