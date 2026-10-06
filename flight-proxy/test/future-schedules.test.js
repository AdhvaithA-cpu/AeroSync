import test from 'node:test';
import assert from 'node:assert/strict';
import {createFutureSchedules,normalizeFuture} from '../future-schedules.js';
const row={flight:{iataNumber:'AA2925'},departure:{iataCode:'DFW',scheduledTime:'2026-11-05 06:00:00'},arrival:{iataCode:'LGA',scheduledTime:'2026-11-05 10:31:00'}};
const args={flight:'AA2925',airport:'DFW',date:'2026-11-05'};
const start=Date.parse('2026-10-06T12:00:00Z');
test('dated schedules filter and deduplicate without provider metadata',()=>{
const b=normalizeFuture({request:{key:'secret'},data:[row,row,{...row,flight:{iataNumber:'AA123'}},{...row,departure:{...row.departure,scheduledTime:'2026-11-04 06:00:00'}}]},args.flight,args.airport,args.date);
assert.equal(b.response.length,1);assert.equal(b.response[0].dep_time,'2026-11-05 06:00');assert.ok(!JSON.stringify(b).includes('secret'));
});
test('time-only departure dated by query; arrival day not fabricated; codeshare accepted',()=>{
const b=normalizeFuture({data:[{...row,flight:{iataNumber:'BA123'},codeshared:{flight:{iataNumber:'AA2925'}},departure:{...row.departure,scheduledTime:'23:30'},arrival:{...row.arrival,scheduledTime:'01:30'}}]},args.flight,args.airport,args.date);
assert.equal(b.response[0].dep_time,'2026-11-05 23:30');assert.equal(b.response[0].arr_time,undefined);
});
test('range, invalid calendar date, airport and unconfigured checks',async()=>{
const lookup=createFutureSchedules({key:'',now:()=>start});assert.equal((await lookup(args)).status,503);
for(const changes of [{date:'2026-12-10'},{date:'2026-02-30'},{airport:''}])assert.equal((await lookup({...args,...changes})).status,400);
});
test('exact request, caching and global rate limit',async()=>{
let calls=0;const lookup=createFutureSchedules({key:'private',now:()=>start,fetcher:async url=>{
calls++;assert.equal(url.pathname,'/v1/flightsFuture');assert.equal(url.searchParams.get('date'),args.date);assert.equal(url.searchParams.get('iataCode'),'DFW');assert.equal(url.searchParams.get('flight_number'),'2925');return {ok:true,json:async()=>({data:[row]})};}});
assert.equal((await lookup(args)).status,200);assert.equal((await lookup(args)).status,200);assert.equal(calls,1);assert.equal((await lookup({...args,flight:'AA123'})).status,429);
});
test('errors, incomplete pages and malformed replies fail without leaking secrets',async()=>{
for(const b of [{error:{message:'private'}},{data:[row],pagination:{total:500}},{oops:true}]){
const lookup=createFutureSchedules({key:'private',now:()=>start,fetcher:async()=>({ok:true,json:async()=>b})});const r=await lookup(args);assert.equal(r.status,502);assert.ok(!JSON.stringify(r).includes('private'));
}});
