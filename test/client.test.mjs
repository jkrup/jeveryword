import test from 'node:test';
import assert from 'node:assert/strict';
import {createJevClient,retryDelay} from '../src/client.mjs';
test('Retry-After accepts seconds and dates, with exponential fallback',()=>{
 assert.equal(retryDelay('3',0),3000);assert.equal(retryDelay(null,2),8000);
 assert.equal(retryDelay('Thu, 01 Jan 1970 00:00:10 GMT',0,4000),6000);
});
test('429 retries the same payload and reports waiting and retry count',async t=>{
 let calls=0;const waits=[],events=[],bodies=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;bodies.push(options.body);return calls<3?new Response('{}',{status:429,headers:{'Retry-After':'1'}}):Response.json({answers:{},usage:{inputTokens:12,outputTokens:0}});});
 const client=createJevClient({apiKey:'test',sleep:async ms=>waits.push(ms),onRetry:e=>events.push(e)});
 const result=await client({state:'fictional test',questions:{}});
 assert.equal(calls,3);assert.deepEqual(waits,[1000,1000]);assert.equal(events.length,2);assert.equal(new Set(bodies).size,1);assert.equal(result.rateLimitRetries,2);
});
test('persistent 429 stops at four attempts and long Retry-After never retries early',async t=>{
 let calls=0; t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('{}',{status:429});});
 await assert.rejects(createJevClient({apiKey:'test',sleep:async()=>{}})({state:'test',questions:{}}),e=>e.code==='rate_limited'&&e.httpAttempts===4);assert.equal(calls,4);
 t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:429,headers:{'Retry-After':'120'}}));
 await assert.rejects(createJevClient({apiKey:'test',sleep:async()=>assert.fail('must not sleep or retry early')})({state:'test',questions:{}}),/120 seconds/);
});
test('retry does not continue after browser disconnect',async t=>{
 let active=true,calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('{}',{status:429});});
 await assert.rejects(createJevClient({apiKey:'test',shouldContinue:()=>active,sleep:async()=>{active=false;}})({state:'test',questions:{}}),/disconnected/);assert.equal(calls,1);
});
