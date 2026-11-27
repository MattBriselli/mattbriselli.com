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

async function handleTravelPitch(request, env) {
  let destination = "";
  let name = "";
  let email = "";
  let honeypot = "";

  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const body = await request.json();
      destination = String(body.destination || "").trim();
      name = String(body.name || "").trim();
      email = String(body.email || "").trim();
      honeypot = String(body.website || "").trim();
    } else {
      const form = await request.formData();
      destination = String(form.get("destination") || "").trim();
      name = String(form.get("name") || "").trim();
      email = String(form.get("email") || "").trim();
      honeypot = String(form.get("website") || "").trim();
    }
  } catch {
    return Response.json({ ok: false, error: "Invalid request payload." }, { status: 400 });
  }

  if (honeypot) return Response.json({ ok: true });

  if (!destination || destination.length < 2 || destination.length > 300) {
    return Response.json(
      { ok: false, error: "Please enter a destination, city, or food spot (2–300 characters)." },
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
  const subject = `✈️ Travel Pitch: ${destination.slice(0, 72)}${cleanName ? ` (from ${cleanName})` : ""}`;

  const text = [
    "New 'Where Will Matt Travel Next?' submission on mattbriselli.com",
    "----------------------------------------------------------------",
    `Suggestion: ${destination}`,
    `From:       ${senderLine}`,
    `Approx Geo: ${cfCity}`,
    `Submitted:  ${new Date().toISOString()}`
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #181715; max-width: 560px; line-height: 1.5;">
      <p style="font-family: monospace; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #9e3b24; margin: 0 0 8px;">
        mattbriselli.com · Where Will Matt Travel Next?
      </p>
      <h2 style="font-family: Georgia, serif; font-size: 22px; margin: 0 0 16px;">${escapeHtml(destination)}</h2>
      <p style="margin: 0 0 6px;"><strong>From:</strong> ${escapeHtml(senderLine)}</p>
      <p style="margin: 0 0 6px; color: #69655c; font-size: 13px;"><strong>Visitor region:</strong> ${escapeHtml(cfCity)}</p>
    </div>
  `.trim();

  try {
    await sendToMatt(env, { subject, text, html, cleanName, cleanEmail });
  } catch {
    return Response.json({ ok: false, error: "Could not send email right now. Please try again shortly." }, { status: 502 });
  }

  if (contentType.includes("application/json")) return Response.json({ ok: true });
  return Response.redirect(new URL("/#explorer", request.url).toString(), 303);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.mattbriselli.com") {
      url.hostname = "mattbriselli.com";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/api/travel-pitch" && request.method === "POST") {
      return handleTravelPitch(request, env);
    }

    if (url.pathname === "/api/contact" && request.method === "POST") {
      return handleDirectContact(request, env);
    }

    if (url.pathname === "/api/letterboxd" && request.method === "GET") {
      return handleLiveLetterboxd();
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
