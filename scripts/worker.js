function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

  // Silently accept bot honeypot submissions without sending email
  if (honeypot) {
    return Response.json({ ok: true });
  }

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

  const senderLine = cleanName && cleanEmail
    ? `${cleanName} <${cleanEmail}>`
    : cleanName || cleanEmail || "Anonymous visitor";

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
      <h2 style="font-family: Georgia, serif; font-size: 22px; margin: 0 0 16px;">
        ${escapeHtml(destination)}
      </h2>
      <p style="margin: 0 0 6px;"><strong>From:</strong> ${escapeHtml(senderLine)}</p>
      <p style="margin: 0 0 6px; color: #69655c; font-size: 13px;"><strong>Visitor region:</strong> ${escapeHtml(cfCity)}</p>
    </div>
  `.trim();

  if (!env.EMAIL) {
    return Response.json({ ok: false, error: "Email service binding not configured." }, { status: 503 });
  }

  const baseMessage = {
    from: { email: "shout@mattbriselli.com", name: "mattbriselli.com Travel Radar" },
    subject,
    text,
    html,
    ...(cleanEmail ? { replyTo: cleanName ? { email: cleanEmail, name: cleanName } : cleanEmail } : {})
  };

  try {
    try {
      await env.EMAIL.send({ ...baseMessage, to: "shout@mattbriselli.com" });
    } catch {
      await env.EMAIL.send({ ...baseMessage, to: "mattbriselli@gmail.com" });
    }
  } catch (err) {
    return Response.json(
      { ok: false, error: "Could not send email right now. Please try again shortly." },
      { status: 502 }
    );
  }

  if (contentType.includes("application/json")) {
    return Response.json({ ok: true });
  }
  return Response.redirect(new URL("/#explorer", request.url).toString(), 303);
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
