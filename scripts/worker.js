export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.mattbriselli.com") {
      url.hostname = "mattbriselli.com";
      return Response.redirect(url.toString(), 301);
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
