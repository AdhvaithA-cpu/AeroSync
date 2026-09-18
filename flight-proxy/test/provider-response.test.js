import test from "node:test";
import assert from "node:assert/strict";
import { publicFlightResult } from "../provider-response.js";

const testKey = "TEST-ONLY-NOT-A-REAL-KEY";

test("keeps every flight field consumed by iOS but drops provider metadata", () => {
  const flight = {
    flight_iata: "AA123", airline_name: "Example Airlines", status: "active",
    dep_iata: "DFW", arr_iata: "ORD", dep_time_utc: "2026-09-18 10:00",
    dep_estimated_utc: "2026-09-18 10:05", dep_actual_utc: "2026-09-18 10:06",
    arr_time_utc: "2026-09-18 12:00", arr_estimated_utc: "2026-09-18 12:10",
    arr_actual_utc: "2026-09-18 12:11", delayed: 5, arr_delayed: 10,
    arr_terminal: "3", arr_gate: "K1", arr_baggage: "4"
  };
  const result = publicFlightResult({ status: 200, body: {
    request: { key: { api_key: testKey }, params: { api_key: testKey } },
    response: { ...flight, api_key: testKey, extra: { token: testKey } }
  } }, testKey);
  assert.deepEqual(result, { status: 200, body: { response: flight } });
  assert.ok(!JSON.stringify(result).includes(testKey));
});

test("provider errors never forward arbitrary messages or credentials", () => {
  for (const status of [200, 401, 429, 503, 504]) {
    const result = publicFlightResult({ status, body: {
      error: { code: testKey, message: `Invalid api_key=${testKey}` },
      request: { key: { api_key: testKey } }
    } }, testKey);
    assert.equal(result.status, 502);
    assert.equal(result.body.error.code, "provider_unavailable");
    assert.ok(!JSON.stringify(result).includes(testKey));
  }
});

test("missing or malformed flight data remains unavailable without fabricated details", () => {
  for (const response of [null, undefined, [], "not a flight"]) {
    assert.deepEqual(publicFlightResult({ status: 200, body: { response } }, testKey),
      { status: 200, body: { response: null } });
  }
});

test("rejects credentials and unexpected types even within allowed fields", () => {
  const result = publicFlightResult({ status: 200, body: { response: {
    status: testKey, flight_iata: "AA123", arr_gate: { api_key: testKey },
    delayed: "15", arr_delayed: Infinity, arr_terminal: null
  } } }, testKey);
  assert.deepEqual(result.body, { response: { flight_iata: "AA123" } });
});

test("rejects a URL-encoded credential within a flight field", () => {
  const key = "TEST ONLY / +";
  const result = publicFlightResult({ status: 200, body: { response: {
    status: `https://example.invalid/?api_key=${encodeURIComponent(key)}`
  } } }, key);
  assert.deepEqual(result.body, { response: {} });
});
