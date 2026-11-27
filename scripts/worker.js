function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeEntities(str) {
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…");
}

async function sendToMatt(env, { subject, text, html, cleanName, cleanEmail }) {
  if (!env.EMAIL) {
    throw new Error("Email service binding not configured.");
  }
  const baseMessage = {
    from: { email: "shout@mattbriselli.com", name: "mattbriselli.com" },
    subject,
    text,
    html,
    ...(cleanEmail ? { replyTo: cleanName ? { email: cleanEmail, name: cleanName } : cleanEmail } : {})
  };
  try {
    await env.EMAIL.send({ ...baseMessage, to: "shout@mattbriselli.com" });
  } catch {
    await env.EMAIL.send({ ...baseMessage, to: "mattbriselli@gmail.com" });
  }
}

async function handleDirectContact(request, env) {
  let message = "";
  let name = "";
  let email = "";
  let honeypot = "";

  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const body = await request.json();
      message = String(body.message || "").trim();
      name = String(body.name || "").trim();
      email = String(body.email || "").trim();
      honeypot = String(body.website || "").trim();
    } else {
      const form = await request.formData();
      message = String(form.get("message") || "").trim();
      name = String(form.get("name") || "").trim();
      email = String(form.get("email") || "").trim();
      honeypot = String(form.get("website") || "").trim();
    }
  } catch {
    return Response.json({ ok: false, error: "Invalid request payload." }, { status: 400 });
  }

  if (honeypot) return Response.json({ ok: true });

  if (!message || message.length < 2 || message.length > 4000) {
    return Response.json(
      { ok: false, error: "Please write a message (2–4,000 characters)." },
      { status: 400 }
    );
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json(
      { ok: false, error: "Please enter a valid email address or leave it blank." },
      { status: 400 }
    );
  }

  const cleanName = name.slice(0, 100);
  const cleanEmail = email.slice(0, 120);
  const cfCity = request.cf?.city ? `${request.cf.city}, ${request.cf.country || ""}` : (request.cf?.country || "Unknown");
  const senderLine = cleanName && cleanEmail ? `${cleanName} <${cleanEmail}>` : cleanName || cleanEmail || "Anonymous visitor";
  const subject = `✉️ Message via mattbriselli.com${cleanName ? ` from ${cleanName}` : ""}`;

  const text = [
    "New direct message from mattbriselli.com",
    "----------------------------------------",
    `From:       ${senderLine}`,
    `Approx Geo: ${cfCity}`,
    `Submitted:  ${new Date().toISOString()}`,
    "",
    message
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #181715; max-width: 580px; line-height: 1.6;">
      <p style="font-family: monospace; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #9e3b24; margin: 0 0 10px;">
        mattbriselli.com · Direct Message
      </p>
      <p style="margin: 0 0 6px;"><strong>From:</strong> ${escapeHtml(senderLine)}</p>
      <p style="margin: 0 0 16px; color: #69655c; font-size: 13px;"><strong>Visitor region:</strong> ${escapeHtml(cfCity)}</p>
      <div style="padding: 14px 16px; background: #f2efe9; border-left: 3px solid #9e3b24; border-radius: 4px; white-space: pre-wrap;">${escapeHtml(message)}</div>
    </div>
  `.trim();

  try {
    await sendToMatt(env, { subject, text, html, cleanName, cleanEmail });
  } catch {
    return Response.json({ ok: false, error: "Could not send message right now. Please try again shortly." }, { status: 502 });
  }

  if (contentType.includes("application/json")) return Response.json({ ok: true });
  return Response.redirect(new URL("/#contact", request.url).toString(), 303);
}

async function handleLiveLetterboxd() {
  try {
    const res = await fetch("https://letterboxd.com/brslli/rss/", {
      headers: { "User-Agent": "mattbriselli.com-worker/1.0" },
      cf: { cacheTtl: 1800, cacheEverything: true }
    });
    if (!res.ok) return Response.json({ ok: false }, { status: 502 });
    const xml = await res.text();
    const getTag = (b, t) => {
      const m = b.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}>`));
      return m ? m[1].trim() : "";
    };
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    const reviews = [];
    for (const item of items) {
      const guid = getTag(item, "guid");
      if (!guid.startsWith("letterboxd-review-") && !guid.startsWith("letterboxd-watch-")) continue;
      const filmTitle = decodeEntities(getTag(item, "letterboxd:filmTitle"));
      const filmYear = getTag(item, "letterboxd:filmYear");
      const ratingRaw = getTag(item, "letterboxd:memberRating");
      const rating = ratingRaw ? Number(ratingRaw) : null;
      const liked = getTag(item, "letterboxd:memberLike") === "Yes";
      const rewatch = getTag(item, "letterboxd:rewatch") === "Yes";
      const watchedDate = getTag(item, "letterboxd:watchedDate");
      const link = getTag(item, "link");
      const descCdata = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] || getTag(item, "description");
      const poster = descCdata.match(/<img[^>]+src="([^"]+)"/)?.[1] || "";
      const bodyHtml = descCdata.replace(/<p>\s*<img[^>]*>\s*<\/p>/i, "").trim();
      const paragraphs = [...bodyHtml.matchAll(/<p>([\s\S]*?)<\/p>/gi)]
        .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, "").trim()))
        .filter((p) => p && !/^Watched on /i.test(p));
      if (!filmTitle || !paragraphs.length) continue;
      reviews.push({ id: guid, filmTitle, filmYear, rating, liked, rewatch, watchedDate, link, poster, paragraphs });
    }
    return Response.json(
      { ok: true, reviews },
      { headers: { "Cache-Control": "public, max-age=900, s-maxage=1800" } }
    );
  } catch {
    return Response.json({ ok: false }, { status: 502 });
  }
}

async function handleLbPoster(url) {
  const id = (url.searchParams.get("id") || "").trim();
  const title = (url.searchParams.get("title") || "").trim();
  const year = (url.searchParams.get("year") || "").trim();

  if (id && !/^[A-Za-z0-9]{2,12}$/.test(id)) {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (!id && !title) {
    return Response.json({ ok: false }, { status: 400 });
  }

  let poster = "";

  // 1. Try canonical Letterboxd boxd.it film JSON-LD poster
  if (id) {
    try {
      const lbRes = await fetch(`https://boxd.it/${encodeURIComponent(id)}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml"
        },
        cf: { cacheTtl: 2592000, cacheEverything: true }
      });
      if (lbRes.ok) {
        const html = await lbRes.text();
        const imgMatch = html.match(/"image"\s*:\s*"(https:\/\/a\.ltrbxd\.com\/[^"]+)"/);
        if (imgMatch) poster = imgMatch[1];
      }
    } catch {
      // Fall through to Apple iTunes catalog fallback
    }
  }

  // 2. Fallback to Apple iTunes Movie / TV catalog high-res 2:3 artwork
  if (!poster && title) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const targetNorm = norm(title);
    const targetYear = Number(year) || 0;

    for (const queryUrl of [
      `https://itunes.apple.com/search?term=${encodeURIComponent(`${title} ${year}`.trim())}&media=movie&entity=movie&limit=6`,
      `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&media=tvShow&entity=tvSeason&limit=4`
    ]) {
      if (poster) break;
      try {
        const itRes = await fetch(queryUrl, { cf: { cacheTtl: 2592000, cacheEverything: true } });
        if (!itRes.ok) continue;
        const data = await itRes.json();
        const results = Array.isArray(data.results) ? data.results : [];
        let best = null;
        let bestScore = -1;
        for (const item of results) {
          const itemTitle = item.trackName || item.collectionName || "";
          const itemNorm = norm(itemTitle.replace(/\s*\(.*?\)\s*$/, ""));
          const relYear = item.releaseDate ? Number(item.releaseDate.slice(0, 4)) : 0;
          let score = 0;
          if (itemNorm === targetNorm) score += 10;
          else if (itemNorm.includes(targetNorm) || targetNorm.includes(itemNorm)) score += 5;
          if (targetYear && relYear) {
            const diff = Math.abs(targetYear - relYear);
            if (diff === 0) score += 6;
            else if (diff === 1) score += 4;
            else if (diff <= 2) score += 1;
          }
          if (score > bestScore && item.artworkUrl100) {
            bestScore = score;
            best = item;
          }
        }
        if (best && bestScore >= 6) {
          poster = best.artworkUrl100.replace(/100x100bb\.jpg$/, "600x900bb.jpg");
        }
      } catch {
        // ignore
      }
    }
  }

  return Response.json(
    { ok: Boolean(poster), poster },
    {
      headers: {
        "Cache-Control": poster
          ? "public, max-age=2592000, s-maxage=2592000, immutable"
          : "public, max-age=3600, s-maxage=3600"
      }
    }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.mattbriselli.com") {
      url.hostname = "mattbriselli.com";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/api/contact" && request.method === "POST") {
      return handleDirectContact(request, env);
    }

    if (url.pathname === "/api/letterboxd" && request.method === "GET") {
      return handleLiveLetterboxd();
    }

    if (url.pathname === "/api/lb-poster" && request.method === "GET") {
      return handleLbPoster(url);
    }

    // Agent content negotiation on root URL
    const accept = request.headers.get("accept") || "";
    if (url.pathname === "/" && !accept.includes("text/html")) {
      if (accept.includes("text/markdown")) {
        const mdUrl = new URL("/llms.txt", url.origin);
        return env.ASSETS.fetch(new Request(mdUrl, request));
      }
      if (accept.includes("application/json")) {
        const jsonUrl = new URL("/resume.json", url.origin);
        return env.ASSETS.fetch(new Request(jsonUrl, request));
      }
    }

    return env.ASSETS.fetch(request);
  }
};
