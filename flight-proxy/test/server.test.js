import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

// A fake credential is used only for offline regression tests.
process.env.AIRLABS_API_KEY = "TEST-ONLY-NOT-A-REAL-KEY";
const { server } = await import("../server.js");

test("HTTP routes preserve flight search and never return the provider key", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls += 1;
    assert.equal(url.hostname, "airlabs.co");
    assert.equal(url.searchParams.get("api_key"), process.env.AIRLABS_API_KEY);
    return { status: 200, json: async () => ({
      request: { key: { api_key: process.env.AIRLABS_API_KEY } },
      response: { flight_iata: url.searchParams.get("flight_iata"), status: "active", arr_gate: "C2" }
    }) };
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));

  function get(path) {
    return new Promise((resolve, reject) => {
      http.get({ hostname: "127.0.0.1", port, path }, response => {
        let text = "";
        response.on("data", chunk => { text += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, text, body: JSON.parse(text) }));
      }).on("error", reject);
    });
  }

  const bad = await get("/api/flight?flight_iata=INVALID");
  assert.equal(bad.status, 400);
  assert.equal(calls, 0);
  const flight = await get("/api/flight?flight_iata=aa%20123");
  assert.equal(flight.status, 200);
  assert.deepEqual(flight.body, { response: { flight_iata: "AA123", status: "active", arr_gate: "C2" } });
  assert.ok(!flight.text.includes(process.env.AIRLABS_API_KEY));
  const health = await get("/api/health");
  assert.equal(health.body.ok, true);
  assert.ok(!health.text.includes(process.env.AIRLABS_API_KEY));
  const before = calls;
  await get("/api/health");
  assert.equal(calls, before, "health requests use the cache");
  assert.equal((await get("/api/features")).body.ok, true);
  assert.equal((await get("/api/policy/brief")).body.ok, true);
  assert.equal((await get("/missing")).status, 404);

  t.mock.method(globalThis, "fetch", async () => ({ status: 200, json: async () => ({
    error: { message: process.env.AIRLABS_API_KEY }
  }) }));
  const failure = await get("/api/flight?flight_iata=AA123");
  assert.equal(failure.status, 502);
  assert.ok(!failure.text.includes(process.env.AIRLABS_API_KEY));
});
