import test from 'node:test';
import assert from 'node:assert/strict';
import { index, chunkers, mergeChunks, classifyChunks } from '../src/index.mjs';
import { detectPII } from '../examples/pii.mjs';

test('every chunk maps back to its exact source text, including Unicode', () => {
  for (const chunker of Object.values(chunkers)) {
    const text = '👋  José van der Berg; (a@b.com) “JustinKessler” +1 (415) 555-0123.';
    const doc = index(text, { chunker });
    for (const c of doc.chunks) assert.equal(text.slice(c.start, c.end), c.text);
    assert.deepEqual(doc.chunks.map(c => c.id), doc.chunks.map((_, i) => i));
  }
  assert.deepEqual(index('(a@b.com), call +1 (415) 555-0123!', { chunker: chunkers.words }).chunks.map(c => c.text), ['a@b.com', 'call', '+1', '415', '555-0123']);
});

test('list, options, decode and resolve round-trip: ids out, exact text back', () => {
  const doc = index("I'm Maya Chen, a software engineer.");
  assert.equal(doc.list().split('\n')[1], '1|Maya');
  assert.deepEqual(doc.state, { source_text: doc.text, tokens: doc.list() });
  const options = doc.options({ also: ['missing'] });
  assert.deepEqual(Object.keys(options), [...doc.chunks.map(c => String(c.id)), 'missing']);
  assert.ok(Object.values(options).every(v => v === null));
  for (const key of Object.keys(options)) {
    const range = doc.decode(key);
    if (key === 'missing') assert.equal(range, null);
    else assert.equal(doc.resolve(range).value, doc.chunks[key].text);
  }
  assert.deepEqual(doc.resolve(1, 2), { value: 'Maya Chen', start: 4, end: 13, lo: 1, hi: 2 });
  assert.equal(doc.resolve(5, 7, { trim: true }).value, 'software engineer');
  assert.equal(doc.resolve({ lo: 5, hi: 7 }, { trim: true }).value, 'software engineer');
  assert.throws(() => doc.resolve(3, 99), RangeError);
  assert.equal(doc.pick('1-2').value, 'Maya Chen');
  assert.equal(doc.pick('missing'), null);
  for (const bad of ['99', '5-2', 'x', '', '1-', null]) assert.equal(doc.decode(bad), null);
});

test('more chunks than fanout become balanced id ranges that narrow to a single chunk', () => {
  const doc = index(Array.from({ length: 464 }, (_, i) => `w${i}`).join(' '));
  let range = { lo: 0, hi: 463 }, rounds = 0;
  while (range.lo !== range.hi) {
    const keys = Object.keys(doc.options({ ...range, fanout: 253 }));
    assert.ok(keys.length <= 23);
    range = doc.decode(keys.find(k => { const r = doc.decode(k); return r.lo <= 300 && 300 <= r.hi; }));
    rounds++;
  }
  assert.deepEqual([rounds, doc.resolve(range).value], [2, 'w300']);
  const prefixed = index('a b c d', { prefix: 'c' });
  assert.deepEqual(Object.keys(prefixed.options({ fanout: 2 })), ['c0-c1', 'c2-c3']);
  assert.deepEqual(prefixed.decode('c2-c3'), { lo: 2, hi: 3 });
  assert.equal(prefixed.decode('2'), null);
});

test('classifyChunks: compact questions, 1 - P(none) scores, batch halving, fail closed', async () => {
  const text = 'Maya met Maya';
  let retries = 0;
  const scan = await classifyChunks({ text, labels: { none: 'nothing', name: 'a name' }, rules: 'Find names.', evaluate: async ({ state, questions }) => {
    assert.equal(state.chunks, 'c0|Maya\nc1|met\nc2|Maya');
    assert.ok(state.rules.startsWith('Find names.'));
    assert.deepEqual(Object.values(questions)[0].criteria, { none: null, name: null });
    if (Object.keys(questions).length > 1) { retries++; throw Object.assign(new Error('limit'), { code: 'max_tokens_exceeded' }); }
    return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: k === 'c1' ? 'none' : 'name', probabilities: { none: k === 'c1' ? .95 : .1, name: k === 'c1' ? .05 : .9 } }])), usage: { input_tokens: 10 } };
  } });
  assert.deepEqual([retries, scan.inputTokens, scan.calls], [1, 30, 4]);
  assert.deepEqual(scan.detections.map(d => [d.value, d.label, +d.score.toFixed(2)]), [['Maya', 'name', .9], ['met', 'name', .05], ['Maya', 'name', .9]]);
  for (const d of scan.detections) assert.equal(text.slice(d.start, d.end), d.value);
  assert.deepEqual(mergeChunks(text, scan.detections).map(s => s.value), ['Maya', 'Maya']);
  await assert.rejects(classifyChunks({ text: 'Maya', labels: { none: '', name: '' }, evaluate: async () => ({ answers: { c0: { choice: 'name' } } }) }), e => e.code === 'invalid_answer' && /chunk c0 \("Maya"\)/.test(e.message));
  await assert.rejects(classifyChunks({ text: 'Maya', labels: { name: '', place: '' }, evaluate: async () => ({}) }), e => e.code === 'invalid_input' && /"none" option/.test(e.message));
  const forced = await classifyChunks({ text: 'Maya', labels: { name: '', place: '' }, none: false, evaluate: async () => ({ answers: { c0: { choice: 'name', probabilities: { name: .7, place: .3 } } } }) });
  assert.deepEqual([forced.detections[0].label, forced.detections[0].score], ['name', .7]);
});

test('mergeChunks joins neighbours with the same label and keeps the weakest score', () => {
  const text = 'Call Maya Chen, now';
  const d = (t, label, score) => ({ label, score, start: text.indexOf(t), end: text.indexOf(t) + t.length });
  assert.deepEqual(mergeChunks(text, [d('Maya', 'name', .9), d('Chen', 'name', .7), d('now', 'name', .2)], { threshold: .5 }),
    [{ label: 'name', start: 5, end: 14, score: .7, value: 'Maya Chen' }]);
});

test('PII example: binary mode uses two options and reports category + slider score', async () => {
  const result = await detectPII({ text: 'Maya', mode: 'binary', evaluate: async ({ questions }) => {
    assert.deepEqual(questions.c0.criteria, { pii: null, none: null });
    return { answers: { c0: { choice: 'pii', probabilities: { pii: .85, none: .15 } } }, usage: { input_tokens: 100 } };
  } });
  assert.deepEqual([result.mode, result.detections[0].category, result.detections[0].score], ['binary', 'pii', .85]);
});
