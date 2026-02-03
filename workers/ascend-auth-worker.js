// ascend-auth Worker (service-worker style)
// Proxies auth requests to Apps Script + handles CORS for browser calls.

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxfon_qgn5hiQ58xOf8MvYbR9QFglDz27ECYjxcGmzJuQlCaX69hKtIeOiXsF7jZDEt/exec";

const ALLOWED_ORIGINS = [
  "https://jacobeugenehenderson.github.io",
  "https://jacobhenderson.studio",
];

function makeCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function json(body, status = 200, request) {
  const corsHeaders = request ? makeCorsHeaders(request) : {};
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const { pathname, searchParams } = url;

  // 1) CORS preflight for all paths
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: makeCorsHeaders(request),
    });
  }

  // 2) Only /auth is supported
  if (pathname !== "/auth") {
    return json({ ok: false, error: "Not found", path: pathname }, 404, request);
  }

  // 3) GET /auth?token=... → proxy to Apps Script
  if (request.method === "GET") {
    const token = searchParams.get("token");
    if (!token) {
      return json({ ok: false, error: "Missing token parameter" }, 400, request);
    }

    try {
      const scriptUrl = `${APPS_SCRIPT_URL}?token=${encodeURIComponent(token)}`;
      const scriptResp = await fetch(scriptUrl, {
        method: "GET",
        headers: { "Accept": "application/json" },
      });

      const result = await scriptResp.json();
      return json(result, 200, request);
    } catch (err) {
      console.error("Apps Script GET failed:", err);
      return json({ ok: false, error: "Auth service unavailable" }, 502, request);
    }
  }

  // 4) POST /auth → proxy to Apps Script
  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: "Invalid JSON body" }, 400, request);
    }

    const action = searchParams.get("action") || body.action || null;
    const token = searchParams.get("token") || body.token || null;

    // Handle reset action (logout)
    if (action === "reset") {
      if (!token) {
        return json({ ok: false, error: "Missing token" }, 400, request);
      }

      try {
        const formBody = `token=${encodeURIComponent(token)}&action=reset`;
        const scriptResp = await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: formBody,
          redirect: "follow",
        });

        const text = await scriptResp.text();
        let result;
        try {
          result = JSON.parse(text);
        } catch (e) {
          console.error("Apps Script POST (reset) returned non-JSON:", text.substring(0, 500));
          return json({ ok: false, error: "Auth service returned invalid response" }, 502, request);
        }
        return json(result, 200, request);
      } catch (err) {
        console.error("Apps Script POST (reset) failed:", err);
        return json({ ok: false, error: "Auth service unavailable", detail: String(err) }, 502, request);
      }
    }

    // Handle login action (default)
    const email = (body.email || "").trim();

    if (!token) {
      return json({ ok: false, error: "Missing token" }, 400, request);
    }
    if (!email) {
      return json({ ok: false, error: "Missing email" }, 400, request);
    }

    try {
      // Use POST with form-urlencoded to survive Apps Script redirects
      const formBody = `token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
      const scriptResp = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody,
        redirect: "follow",
      });

      const text = await scriptResp.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (e) {
        console.error("Apps Script POST returned non-JSON:", text.substring(0, 500));
        return json({ ok: false, error: "Auth service returned invalid response", debug: text.substring(0, 200) }, 502, request);
      }
      return json(result, 200, request);
    } catch (err) {
      console.error("Apps Script POST failed:", err);
      return json({ ok: false, error: "Auth service unavailable", detail: String(err) }, 502, request);
    }
  }

  // 5) Any other method on /auth
  return json(
    { ok: false, error: `Method ${request.method} not allowed` },
    405,
    request
  );
}
