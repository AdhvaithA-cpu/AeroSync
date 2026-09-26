import http from "node:http";
import { replyToChat, createChatLimiter } from "./concierge.js";
const chatAllowed = createChatLimiter();
import { URL, pathToFileURL } from "node:url";
import { publicFlightResult } from "./provider-response.js";

const airLabsApiKey = process.env.AIRLABS_API_KEY?.trim();
const port = Number(process.env.PORT || 8080);
const rateWindowMs = 60_000;
const maxRequestsPerWindow = 60;
const requestCounts = new Map();
const providerTimeoutMs = 8_000;
const healthCacheMs = 5 * 60_000;
let cachedHealth;

const policyBrief = {
  title: "Improving Passenger Communication and Airport Security in U.S. Aviation",
  author: "Adhvaith Ananth",
  module: "passenger-communication-standard",
  summary: "AeroSync's policy brief argues that air travelers experience airlines, airports, TSA, DOT resources, baggage systems, terminal operations, and pickup coordination as one trip, but those systems often communicate separately. The product response is a passenger-centered workflow that labels sources, separates official status from estimates, and turns disruption information into next steps.",
  stakeholders: [
    "Passengers, especially first-time flyers, students, families, elderly travelers, international passengers, minors, and people with disabilities or mobility needs",
    "Airlines that communicate flight status, gate changes, rebooking, baggage, and customer support",
    "Airports that manage terminal movement, pickup zones, parking, baggage claim, and curbside traffic",
    "TSA, which manages aviation security and benefits from better passenger preparation",
    "DOT and federal policymakers overseeing passenger protection and consumer-facing aviation policy"
  ],
  policyOptions: [
    {
      name: "Passenger Communication Standard",
      description: "Encourage consistent categories for delay status, gate changes, baggage status, connection risk, security reminders, pickup guidance, accessibility assistance, and rebooking information."
    },
    {
      name: "Security Preparedness Integration",
      description: "Surface TSA identification, carry-on, liquids, electronics, prohibited item, accessibility, and arrival-time guidance before passengers reach the checkpoint."
    },
    {
      name: "Airport Pickup and Connection Pilot",
      description: "Test clearer pickup-zone, cell-phone-lot, baggage-claim, terminal-transfer, and connection-planning guidance at large hub airports."
    }
  ],
  appIntegration: [
    "Trip Planner maps the communication standard into trip fields.",
    "Connection Risk tests layover timing, airport complexity, terminal movement, baggage, and passenger needs.",
    "Pickup Mode tests curbside and family coordination policy.",
    "CivicRunway provides policy context and official-source links while preserving disclaimers.",
    "Smart Travel Packet exports the policy-aware trip plan."
  ],
  disclaimer: "This endpoint supports student policy research and product demos. It is not legal advice or official airline, airport, TSA, DOT, FAA, CBP, or government guidance."
};

function sendJSON(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(body));
}

function readJSON(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function checkRateLimit(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  const ip = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = requestCounts.get(ip) || { count: 0, resetAt: now + rateWindowMs };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + rateWindowMs;
  }

  bucket.count += 1;
  requestCounts.set(ip, bucket);
  return bucket.count <= maxRequestsPerWindow;
}

function normalizedFlight(value) {
  const flight = String(value || "").toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9]{2,3}[0-9]{1,5}[A-Z]?$/.test(flight) ? flight : null;
}

async function fetchAirLabs(path, queryItems = {}) {
  if (!airLabsApiKey) {
    return {
      status: 503,
      body: {
        error: {
          code: "missing_airlabs_key",
          message: "AeroSync backend is missing AIRLABS_API_KEY."
        }
      }
    };
  }

  const url = new URL(`https://airlabs.co/api/v9/${path}`);
  for (const [key, value] of Object.entries(queryItems)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("api_key", airLabsApiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);

  try {
    const providerResponse = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "AeroSyncBackend/1.0"
      },
      signal: controller.signal
    });
    const body = await providerResponse.json();
    return { status: providerResponse.status, body };
  } catch (error) {
    return {
      status: 504,
      body: {
        error: {
          code: "provider_unavailable",
          message: error?.name === "AbortError"
            ? "The aviation data provider timed out."
            : "The aviation data provider is temporarily unavailable."
        }
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleRequest(request, response) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    response.end();
    return;
  }

  if (!checkRateLimit(request)) {
    sendJSON(response, 429, {
      error: {
        code: "rate_limited",
        message: "Too many requests. Please try again soon."
      }
    });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "POST" && url.pathname === "/api/concierge") {
    const ip = String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim();
    if (!chatAllowed(ip)) {
      sendJSON(response, 429, { error: { message: "Concierge has reached its beta limit. Please try again later." } });
      return;
    }
    try {
      const body = await readJSON(request);
      sendJSON(response, 200, await replyToChat(body));
    } catch {
      sendJSON(response, 400, { error: { message: "Enter a question of up to 2,000 characters." } });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/features") {
    sendJSON(response, 200, {
      ok: true,
      app: "AeroSync",
      backendMode: "flight-proxy",
      accountMode: "preflight-only",
      features: [
        "secure-flight-provider-proxy",
        "provider-health-check",
        "account-launch-preflight",
        "policy-brief-module",
        "rate-limiting",
        "yc-demo-ready"
      ],
      message: "AeroSync backend is ready for flight data and account preflight. Add auth and a database before public accounts."
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/policy/brief") {
    sendJSON(response, 200, {
      ok: true,
      policyBrief
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    if (!airLabsApiKey) {
      sendJSON(response, 503, {
        ok: false,
        message: "Set AIRLABS_API_KEY on the backend host."
      });
      return;
    }

    if (!cachedHealth || cachedHealth.expiresAt <= Date.now()) {
      const ping = await fetchAirLabs("ping");
      cachedHealth = {
        ok: ping.status >= 200 && ping.status < 300 && !ping.body?.error,
        expiresAt: Date.now() + healthCacheMs
      };
    }
    const ok = cachedHealth.ok;
    sendJSON(response, ok ? 200 : 502, {
      ok,
      provider: "AirLabs",
      message: ok ? "AeroSync backend is ready." : "AirLabs did not verify this backend key."
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/flight") {
    const flightIATA = normalizedFlight(url.searchParams.get("flight_iata"));
    if (!flightIATA) {
      sendJSON(response, 400, {
        error: {
          code: "bad_flight_number",
          message: "Enter a valid flight number such as AA123 or DL456."
        }
      });
      return;
    }

    const result = publicFlightResult(
      await fetchAirLabs("flight", { flight_iata: flightIATA }), airLabsApiKey
    );
    sendJSON(response, result.status, result.body);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/account/preflight") {
    const body = await readJSON(request);
    const email = String(body.email || "").trim();
    const companyName = String(body.companyName || "AeroSync").trim();
    const roleTitle = String(body.roleTitle || "Founder").trim();

    if (email && !email.includes("@")) {
      sendJSON(response, 400, {
        ok: false,
        error: {
          code: "invalid_email",
          message: "Use a valid email address or leave email blank for local-only testing."
        }
      });
      return;
    }

    sendJSON(response, 200, {
      ok: true,
      accountMode: "preflight-only",
      companyName,
      roleTitle,
      message: "Account details validated. Connect a real auth provider and database before storing public user accounts."
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "POST") {
    sendJSON(response, 405, { error: { code: "method_not_allowed", message: "Use GET or POST." } });
    return;
  }

  sendJSON(response, 404, {
    error: {
      code: "not_found",
      message: "Use /api/health, /api/features, /api/policy/brief, /api/flight?flight_iata=AA123, or POST /api/account/preflight."
    }
  });
}

export const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(() => {
    sendJSON(response, 500, {
      error: {
        code: "server_error",
        message: "The request could not be completed."
      }
    });
  });
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(port, () => {
    console.log(`AeroSync flight proxy listening on port ${port}`);
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of requestCounts.entries()) {
    if (bucket.resetAt <= now) {
      requestCounts.delete(ip);
    }
  }
}, rateWindowMs).unref();
