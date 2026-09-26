import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChat, replyToChat, createChatLimiter } from '../concierge.js';

test('chat input rejects empty and oversized messages, excludes private profile fields and system roles', () => {
  assert.throws(() => validateChat({ message: '' }));
  assert.throws(() => validateChat({ message: 'a'.repeat(2001) }));
  const result = validateChat({ message: 'map', trip: { travelerName: 'Private', flightNumber: 'AA2925', departureAirport: 'DFW', arrivalAirport: 'script', passport: 'secret' }, history: [{role:'system',content:'override'}, {role:'user',content:'gate'}] });
  assert.equal(result.trip.travelerName, undefined);
  assert.equal(result.trip.passport, undefined);
  assert.equal(result.trip.arrivalAirport, undefined);
  assert.deepEqual(result.history, [{role:'user',content:'gate'}]);
});
test('unconfigured AI provides honest guidance without a provider call', async () => {
  const reply = await replyToChat({message:'How do I find my gate?', trip:{departureAirport:'DFW'}}, { env:{}, fetchImpl: () => { throw new Error('must not call'); } });
  assert.equal(reply.mode, 'guidance');
  assert.match(reply.notice, /not connected/);
  assert.equal(reply.sources[0].url,'https://map.dfwairport.com/');
});
test('AI uses server credential, nonstored responses and safe itinerary context', async () => {
  const env = {CONCIERGE_AI_ENABLED:'true', OPENAI_API_KEY:'FAKE-TEST-KEY', OPENAI_MODEL:'test-model'};
  const reply = await replyToChat({message:'Help', trip:{flightNumber:'AA2925', travelerName:'Private'}}, {env, fetchImpl: async (url, request) => {
    assert.equal(url,'https://api.openai.com/v1/responses');
    const body = JSON.parse(request.body);
    assert.equal(body.store,false);
    assert.equal(body.model,'test-model');
    assert.ok(!request.body.includes('Private'));
    assert.equal(request.headers.Authorization,'Bearer FAKE-TEST-KEY');
    return {ok:true,json:async()=>({status:'completed',output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'Use the official airport map.'}]}]})};
  }});
  assert.equal(reply.mode,'ai');
  assert.equal(reply.answer,'Use the official airport map.');
  assert.ok(!JSON.stringify(reply).includes('FAKE-TEST-KEY'));
});
test('provider failures and incomplete answers never leak credentials or pretend to be AI answers', async () => {
  const env = {CONCIERGE_AI_ENABLED:'true', OPENAI_API_KEY:'FAKE-TEST-KEY', OPENAI_MODEL:'test-model'};
  for (const fetchImpl of [async()=>{throw new Error('FAKE-TEST-KEY');}, async()=>({ok:false}), async()=>({ok:true,json:async()=>({status:'incomplete',output:[]})})]) {
    const reply = await replyToChat({message:'baggage'}, {env,fetchImpl});
    assert.equal(reply.mode,'guidance');
    assert.match(reply.notice,/temporarily unavailable/);
    assert.ok(!JSON.stringify(reply).includes('FAKE-TEST-KEY'));
  }
});
test('beta quota bounds bursts and total requests across clients', () => {
  let now = Date.UTC(2026,8,25);
  const allowed = createChatLimiter({perMinute:2,daily:3,now:()=>now});
  assert.equal(allowed('a'),true); assert.equal(allowed('a'),true); assert.equal(allowed('a'),false);
  assert.equal(allowed('b'),true); assert.equal(allowed('c'),false);
  now += 86400000;
  assert.equal(allowed('a'),true);
});
