// Aviationstack /flightsFuture: server-only key, dated departures, bounded spend.
const failure = (status, code, message) => ({ status, body: { error: { code, message } } });
const code = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
const localTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? value.slice(0,16) : null;
export function normalizeFuture(body, flight, airport, date) {
  if (!Array.isArray(body?.data)) throw new Error('Invalid schedule response');
  const response = [];
  for (const row of body.data) {
    const identity = [row.flight, row.codeshared?.flight].find(f => code(f?.iataNumber) === flight);
    if (!identity || code(row.departure?.iataCode) !== airport) continue;
    const raw = row.departure?.scheduledTime;
    // A departure board's requested date dates its time-only departure. Arrival day is NOT inferred.
    const departure = localTime(raw) || (typeof raw === 'string' && /^\d{2}:\d{2}$/.test(raw) ? `${date} ${raw}` : null);
    if (!departure || !departure.startsWith(date)) continue;
    const arrival = localTime(row.arrival?.scheduledTime);
    const item = { flight_iata: flight, dep_iata: airport, arr_iata: code(row.arrival?.iataCode),
      dep_time: departure, status: 'scheduled' };
    if (!/^[A-Z]{3}$/.test(item.arr_iata)) continue;
    if (arrival) item.arr_time = arrival;
    // No untrusted provider metadata, keys or arbitrary error strings leave the server.
    if (!response.some(r => r.dep_time === item.dep_time && r.arr_iata === item.arr_iata)) response.push(item);
  }
  return { response, provider: 'Aviationstack schedules' };
}
export function createFutureSchedules({ key = process.env.AVIATIONSTACK_API_KEY?.trim(), fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map();
  let nextRequest = 0;
  let hour = 0, count = 0;
  return async function lookup({ flight, airport, date }) {
    if (!/^[A-Z0-9]{2}\d{1,5}[A-Z]?$/.test(flight || '') || !/^[A-Z]{3}$/.test(airport || ''))
      return failure(400,'future_airport_required','Enter a departure airport and an IATA flight number for future schedules.');
    const stamp = Date.parse(`${date}T00:00:00Z`);
    const today = Math.floor(now()/86400000)*86400000;
    // One-day UTC tolerance for airport-local calendar dates. Client restricts to 30 days.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0,10) !== date || stamp < today-86400000 || stamp > today+31*86400000)
      return failure(400,'future_date_range','Choose a departure date within the next 30 days.');
    if (!key) return failure(503,'future_not_configured','Month-ahead schedules are not enabled yet. Enter your booking details manually.');
    const cacheKey = `${airport}/${date}/${flight}`;
    const cached = cache.get(cacheKey);
    if (cached?.until > now()) return {status:200,body:cached.body};
    const currentHour = Math.floor(now()/3600000);
    if (hour !== currentHour) { hour=currentHour; count=0; }
    if (now() < nextRequest || count >= 10) return failure(429,'future_rate_limit','Schedule searches are busy. Wait at least 10 seconds and try again, or enter your booking manually.');
    nextRequest=now()+10000; count++;
    const url = new URL('https://api.aviationstack.com/v1/flightsFuture');
    for (const [k,v] of Object.entries({access_key:key,iataCode:airport,type:'departure',date,airline_iata:flight.slice(0,2),flight_number:flight.slice(2),limit:'100'})) url.searchParams.set(k,v);
    try {
      const result = await fetcher(url,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
      const data = await result.json();
      if (!result.ok || data.error) return failure(502,'future_provider_error','Future schedules could not be retrieved. Check your booking or try again later.');
      // Never silently truncate a provider page and claim a complete answer.
      if (data.pagination?.total > data.data?.length) return failure(502,'future_incomplete','The schedule provider returned an incomplete result. Check your booking or narrow the flight number.');
      const body = normalizeFuture(data,flight,airport,date);
      for (const [k,v] of cache) if (v.until <= now()) cache.delete(k);
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(cacheKey,{body,until:now()+30*60000});
      return {status:200,body};
    } catch { return failure(502,'future_provider_error','Future schedules could not be retrieved. Check your booking or try again later.'); }
  };
}
