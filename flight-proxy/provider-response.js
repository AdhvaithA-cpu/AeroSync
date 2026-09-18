// The iOS decoder needs only these flight fields. Never forward provider
// request/account metadata, arbitrary error messages, or new upstream fields.
const stringFields = [
  "flight_iata", "airline_name", "status", "dep_iata", "arr_iata",
  "dep_time_utc", "dep_estimated_utc", "dep_actual_utc",
  "arr_time_utc", "arr_estimated_utc", "arr_actual_utc",
  "arr_terminal", "arr_gate", "arr_baggage"
];
const numberFields = ["delayed", "arr_delayed"];

export function publicFlightResult(result, apiKey) {
  if (result.status < 200 || result.status >= 300 || result.body?.error) {
    return {
      status: 502,
      body: { error: {
        code: "provider_unavailable",
        message: "Flight data is temporarily unavailable. Please try again later."
      } }
    };
  }

  const flight = result.body?.response;
  if (!flight || typeof flight !== "object" || Array.isArray(flight)) {
    return { status: 200, body: { response: null } };
  }

  const response = {};
  for (const field of stringFields) {
    const value = flight[field];
    if (typeof value !== "string") continue;
    // Defense in depth if an upstream error is placed inside a flight field.
    if (apiKey && (value.includes(apiKey) || value.includes(encodeURIComponent(apiKey)))) continue;
    response[field] = value;
  }
  for (const field of numberFields) {
    if (Number.isFinite(flight[field])) response[field] = flight[field];
  }
  return { status: 200, body: { response } };
}
