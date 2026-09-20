import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, partition, extractSpans } from '../src/index.mjs';
import { createJevClient } from '../src/client.mjs';

const chunksOf = text => tokenize(text).chunks;
const sentences = text => tokenize(text).sentences();

function oracle(targets, text) {
  return async ({ questions }) => ({ answers: Object.fromEntries(Object.entries(questions).map(([key, q]) => {
    const target = targets.find(t => q.instructions.includes(`this field: ${t.description}`));
    if (q.instructions.startsWith('Point to the sentence')) {
      const choice = typeof target.start === 'string' ? target.start : `s${sentences(text).find(s => target.start >= s.lo && target.start <= s.hi).id}`;
      return [key, { choice, probabilities: { [choice]: 1 }, confidence: 1 }];
    }
    const position = q.instructions.startsWith('Point to the FIRST') || typeof target.start === 'string' ? target.start : target.end;
    const choice = typeof position === 'string' ? position : Object.keys(q.criteria).find(k => {
      const [lo, hi = lo] = k.split('-').map(Number);
      return position >= lo && position <= hi;
    });
    return [key, { choice, probabilities: { [choice]: 1 }, confidence: 1 }];
  })) });
}

test('client posts model, state and questions to the TypeSafe endpoint', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(options.headers.Authorization, 'Bearer direct-test');
    assert.deepEqual(JSON.parse(options.body), { model: 'jev-latest', state: 'Hi', questions: { q0: { type: 'choice', instructions: 'Present?', criteria: { yes: null } } } });
    return Response.json({ model: 'jev-1', answers: { q0: { choice: 'yes', probabilities: { yes: 1 }, confidence: 0.9 } }, usage: { input_tokens: 123, output_tokens: 0 } });
  });
  const result = await createJevClient({ apiKey: 'direct-test' })({ state: 'Hi', questions: { q0: { type: 'choice', instructions: 'Present?', criteria: { yes: null } } } });
  assert.deepEqual(result.usage, { input_tokens: 123, output_tokens: 0 });
  assert.equal(result.answers.q0.confidence, 0.9);
  assert.throws(() => createJevClient({}), /TYPESAFE_API_KEY/);
});

test('provider token limit errors show actionable guidance without echoing the response body', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    detail: { error_type: 'max_tokens_exceeded', request_text: 'private source text' },
  }), { status: 400 }));
  const evaluate = createJevClient({ apiKey: 'test-key' });
  await assert.rejects(evaluate({ state: {}, questions: {} }), error => {
    assert.match(error.message, /max_tokens_exceeded/);
    assert.match(error.message, /8-way search/);
    assert.ok(!error.message.includes('private source text'));
    return true;
  });
});

test('tokens preserve Unicode and exact offsets', () => {
  const source = '👋  José van der Berg; a@b.com';
  for (const t of chunksOf(source)) assert.equal(source.slice(t.start, t.end), t.text);
});

test('joined capitalized names expose exact boundaries without inserting spaces', async () => {
  const text = '👋 my name is JustinKessler';
  const tokens = chunksOf(text);
  assert.deepEqual(tokens.slice(-2).map(t => t.text), ['Justin', 'Kessler']);
  for (const t of tokens) assert.equal(text.slice(t.start, t.end), t.text);
  const first = tokens.at(-2).id, last = tokens.at(-1).id;
  const fields = [
    { id: 'first', description: 'given name', start: first, end: first },
    { id: 'last', description: 'surname', start: last, end: last },
    { id: 'full', description: 'complete name', start: first, end: last },
  ];
  const result = await extractSpans({ text, fields, evaluate: oracle(fields) });
  assert.equal(result.results.first.value, 'Justin');
  assert.equal(result.results.last.value, 'Kessler');
  assert.equal(result.results.full.value, 'JustinKessler');
  assert.deepEqual(chunksOf('JoséKessler McDonald JUSTIN').map(t => t.text), ['José', 'Kessler', 'Mc', 'Donald', 'JUSTIN']);
});

test('partitions cover the full interval with no gaps or overlaps', () => {
  for (let n = 1; n < 300; n++) for (const x of [2, 8, 253]) {
    const groups = partition(0, n - 1, x);
    assert.deepEqual(groups.flatMap(g => Array.from({ length: g.hi - g.lo + 1 }, (_, j) => g.lo + j)), Array.from({ length: n }, (_, i) => i));
  }
});

test('binary, 8-way and direct preserve crossing spans and internal whitespace', async () => {
  const text = 'Alex referred me; I am José van  der Berg.';
  const tokens = chunksOf(text);
  const targets = [{ id: 'name', description: 'full name of speaker', start: tokens.find(t => t.text === 'José').id, end: tokens.find(t => t.text === 'Berg').id }];
  for (const fanout of [2, 8, 253]) {
    const r = await extractSpans({ text, fields: targets, fanout, evaluate: oracle(targets) });
    assert.equal(r.results.name.value, 'José van  der Berg');
    assert.ok(r.calls <= 2 * Math.max(1, Math.ceil(Math.log(tokens.length) / Math.log(fanout))));
    if (fanout === 253) assert.equal(r.calls, 1);
    const staged = await extractSpans({ text, fields: targets, fanout, speculate: false, evaluate: oracle(targets) });
    assert.equal(staged.results.name.value, 'José van  der Berg');
    if (fanout === 253) assert.equal(staged.calls, 2);
  }
});

test('missing and ambiguous fields produce no fabricated values', async () => {
  const fields = [{ id: 'first', description: 'first', start: 'missing' }, { id: 'last', description: 'last', start: 'ambiguous' }];
  const r = await extractSpans({ text: 'hello', fields, evaluate: oracle(fields) });
  assert.equal(r.results.first.status, 'missing');
  assert.equal(r.results.last.status, 'ambiguous');
  assert.equal(r.calls, 1);
});

test('empty source skips API and malformed responses fail closed', async () => {
  const fields = [{ id: 'name', description: 'name' }];
  const r = await extractSpans({ text: '', fields, evaluate: () => { throw Error('unexpected'); } });
  assert.equal(r.calls, 0);
  await assert.rejects(extractSpans({ text: 'name', fields, evaluate: async () => ({ answers: { q0: { choice: '900' } } }) }), e => e.code === 'invalid_answer' && /"900" for the start of field "name"/.test(e.message));
  await assert.rejects(extractSpans({ text: 'name', fields: [{ id: 'phone-number', description: 'x' }], evaluate: async () => ({}) }), e => e.code === 'invalid_input' && /fields\[0\]\.id "phone-number"/.test(e.message));
});

test('token-limit recovery narrows choices and splits batches without losing fields', async () => {
  const text = 'Alex referred me; I am José van der Berg.';
  const tokens = chunksOf(text);
  const first = tokens.find(t => t.text === 'José').id;
  const last = tokens.find(t => t.text === 'Berg').id;
  const fields = [
    { id: 'first', description: 'given name', start: first, end: first },
    { id: 'last', description: 'surname', start: first + 1, end: last },
  ];
  const choose = oracle(fields);
  let attempts = 0;
  const result = await extractSpans({ text, fields, evaluate: async args => {
    attempts++;
    const questions = Object.values(args.questions);
    if (questions.length > 1 || questions.some(q => Object.keys(q.criteria).length > 4)) {
      throw Object.assign(new Error('limit'), { code: 'max_tokens_exceeded' });
    }
    return choose(args);
  } });
  assert.equal(result.calls, attempts);
  assert.equal(result.effectiveFanout, 2);
  assert.equal(result.trace.filter(r => r.retry).length, 4);
  assert.equal(result.results.first.value, 'José');
  assert.equal(result.results.last.value, 'van der Berg');
});

test('unrecoverable token limits terminate and unrelated errors are not retried', async () => {
  let attempts = 0;
  const args = { text: 'Justin', fields: [{ id: 'name', description: 'name' }] };
  await assert.rejects(extractSpans({ ...args, evaluate: async () => {
    attempts++; throw Object.assign(new Error('limit'), { code: 'max_tokens_exceeded' });
  } }), /even with one field/);
  assert.equal(attempts, 4);
  attempts = 0;
  await assert.rejects(extractSpans({ ...args, evaluate: async () => { attempts++; throw new Error('unauthorized'); } }), /unauthorized/);
  assert.equal(attempts, 1);
});

test('questions are compact: shared rules in state, bare id options, balanced fan-out', async () => {
  const text = Array.from({ length: 464 }, (_, i) => `w${i}`).join(' ');
  const fields = [{ id: 'word', description: 'the word', start: 300, end: 301 }];
  const requests = [];
  const choose = oracle(fields);
  const r = await extractSpans({ text, fields, evaluate: args => { requests.push(args); return choose(args); } });
  assert.equal(r.results.word.value, 'w300 w301');
  assert.equal(r.calls, 2);
  assert.match(requests[0].state.tokens, /^0\|w0\n1\|w1\n/);
  for (const { questions } of requests) for (const q of Object.values(questions)) {
    assert.ok(Object.keys(q.criteria).length <= 24, 'two rounds of ~22 options, not 253 then 2');
    assert.ok(Object.values(q.criteria).every(v => v === null));
    assert.ok(q.instructions.length < 120);
  }
});

test('doubtful speculative ends are discarded and asked again with their start', async () => {
  const text = 'I am José van der Berg.';
  const tokens = chunksOf(text);
  const fields = [{ id: 'name', description: 'full name', start: tokens.find(t => t.text === 'José').id, end: tokens.find(t => t.text === 'Berg').id }];
  const choose = oracle(fields);
  for (const spoil of [a => ({ ...a, choice: '0', probabilities: { 0: 1 } }), a => ({ ...a, probabilities: { [a.choice]: 0.5 } })]) {
    const r = await extractSpans({ text, fields, evaluate: async args => {
      const response = await choose(args);
      for (const [key, q] of Object.entries(args.questions)) if (q.instructions.startsWith('Point to the LAST') && !q.instructions.includes('FIRST token is')) response.answers[key] = spoil(response.answers[key]);
      return response;
    } });
    assert.equal(r.calls, 2);
    assert.equal(r.results.name.value, 'José van der Berg');
    assert.equal(r.trace[0].decisions.find(d => d.speculative).accepted, false);
  }
});

test('sentences split conservatively and keep emails, decimals and abbreviations whole', () => {
  const text = 'Dr. Ada Lovelace paid $3.50 to ada@example.com. Was it late? No!\nSecond line';
  assert.deepEqual(sentences(text).map(s => s.text), ['Dr. Ada Lovelace paid $3.50 to ada@example.com.', 'Was it late?', 'No!', 'Second line']);
});

test('long text: one sentence lookup, then tokens searched only inside the chosen sentences', async () => {
  const filler = 'This sentence is only padding and says nothing useful at all. ';
  const text = filler.repeat(15) + 'My name is José van der Berg. ' + filler.repeat(15);
  const tokens = chunksOf(text);
  assert.ok(tokens.length > 253);
  const fields = [{ id: 'name', description: 'full name', start: tokens.find(t => t.text === 'José').id, end: tokens.find(t => t.text === 'Berg').id },
    { id: 'phone', description: 'phone number', start: 'missing' }];
  const requests = [];
  const choose = oracle(fields, text);
  const r = await extractSpans({ text, fields, evaluate: args => { requests.push(args); return choose(args); } });
  assert.equal(r.results.name.value, 'José van der Berg');
  assert.equal(r.results.phone.status, 'missing');
  assert.equal(r.calls, 2);
  assert.equal(r.trace[0].boundary, 'locate');
  assert.match(requests[0].state.sentences, /^s0\|This sentence/);
  assert.equal(requests[1].state.tokens.split('\n').length, 8, 'only the chosen sentence is indexed');
  assert.equal(Object.keys(requests[1].questions).length, 2, 'the missing field is not searched');
});

test('close calls are settled by comparing candidate spans; trailing punctuation is trimmed', async () => {
  const text = 'I am a software engineer.';
  const [software, engineer, stop] = ['software', 'engineer', '.'].map(w => chunksOf(text).find(t => t.text === w).id);
  const evaluate = async ({ questions }) => ({ answers: Object.fromEntries(Object.entries(questions).map(([key, q]) => {
    if (q.instructions.startsWith('Which candidate')) {
      assert.deepEqual(Object.values(q.criteria), ['engineer.', 'software engineer.']);
      return [key, { choice: 'c1', probabilities: { c0: 0.1, c1: 0.9 } }];
    }
    return [key, q.instructions.startsWith('Point to the FIRST')
      ? { choice: `${engineer}`, probabilities: { [engineer]: 0.59, [software]: 0.4 } }
      : { choice: `${stop}`, probabilities: { [stop]: 0.95 } }];
  })) });
  const r = await extractSpans({ text, fields: [{ id: 'role', description: 'role' }], evaluate });
  assert.equal(r.results.role.value, 'software engineer');
  assert.equal(r.results.role.probability, 0.9, 'the tie-break decided it, so its probability is reported');
  assert.equal(r.calls, 2);
  assert.equal(r.trace.at(-1).boundary, 'verify');
  const plain = await extractSpans({ text, fields: [{ id: 'role', description: 'role' }], evaluate, verify: false, trimPunctuation: false });
  assert.equal(plain.results.role.value, 'engineer.');
  assert.equal(plain.results.role.probability, 0.59, 'the weaker of the start and end decisions');
});

test('gateway is tried first; a rate limit or outage falls back to the TypeSafe API for the rest of the run', async t => {
  const urls = [], events = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    urls.push(url);
    if (url.includes('ai-gateway')) {
      assert.equal(options.headers.Authorization, 'Bearer gw');
      assert.equal(options.headers['ai-gateway-auth-method'], 'oidc');
      assert.equal(JSON.parse(options.body).model, undefined);
      return new Response('{}', { status: 429, headers: { 'retry-after': '30' } });
    }
    assert.equal(options.headers.Authorization, 'Bearer direct');
    return Response.json({ model: 'jev-1', answers: {}, usage: { input_tokens: 5, output_tokens: 0 } });
  });
  const evaluate = createJevClient({ apiKey: 'direct', gateway: { token: 'gw', authMethod: 'oidc' }, onFallback: e => events.push(e), sleep: async () => assert.fail('must not wait on the gateway') });
  assert.equal(evaluate.provider, 'gateway');
  assert.equal((await evaluate({ state: 'Hi', questions: {} })).provider, 'typesafe');
  await evaluate({ state: 'Hi', questions: {} });
  assert.deepEqual(urls.map(u => new URL(u).host), ['ai-gateway.vercel.sh', 'api.typesafe.ai', 'api.typesafe.ai']);
  assert.deepEqual(events.map(e => [e.from, e.to]), [['gateway', 'typesafe']]);
});

test('gateway responses are normalized; token-limit errors never trigger a fallback', async t => {
  let status = 200;
  t.mock.method(globalThis, 'fetch', async url => {
    assert.ok(url.includes('ai-gateway'));
    return status === 200 ? Response.json({ answers: { q0: { choice: 'yes', probabilities: { yes: 1 } } }, usage: { inputTokens: 123, outputTokens: 0 }, providerMetadata: { typesafe: { confidence: { q0: 0.9 } } } })
      : Response.json({ error: { message: '{"detail":{"error_type":"max_tokens_exceeded"}}' } }, { status });
  });
  const evaluate = createJevClient({ apiKey: 'direct', gateway: { token: 'gw' } });
  const result = await evaluate({ state: 'Hi', questions: {} });
  assert.deepEqual([result.provider, result.model, result.usage.input_tokens, result.answers.q0.confidence], ['gateway', 'typesafe-ai/jev', 123, 0.9]);
  status = 400;
  await assert.rejects(evaluate({ state: 'Hi', questions: {} }), error => error.code === 'max_tokens_exceeded');
  assert.equal(evaluate.provider, 'gateway');
});

test('a hung gateway is abandoned after the short fallback timeout, not the full one', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', (url, options) => {
    urls.push(new URL(url).host);
    if (url.includes('ai-gateway')) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
    return Promise.resolve(Response.json({ model: 'jev-1', answers: {}, usage: { input_tokens: 1, output_tokens: 0 } }));
  });
  const evaluate = createJevClient({ apiKey: 'direct', gateway: { token: 'gw' }, fallbackTimeoutMs: 40, timeoutMs: 5000 });
  const started = performance.now();
  assert.equal((await evaluate({ state: 'Hi', questions: {} })).provider, 'typesafe');
  assert.ok(performance.now() - started < 1000, 'fell back quickly');
  assert.deepEqual(urls, ['ai-gateway.vercel.sh', 'api.typesafe.ai']);
});
