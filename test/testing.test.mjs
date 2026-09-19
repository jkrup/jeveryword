import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSpans, classifyChunks, mergeChunks } from '../src/index.mjs';
import { stubEvaluate } from '../src/testing.mjs';

test('stubEvaluate drives extractSpans: short text, long text, and missing fields', async () => {
  const filler = 'This sentence is only padding and says nothing useful at all. ';
  const fields = [{ id: 'name', description: 'full name' }, { id: 'phone', description: 'phone number' }, { id: 'size', description: 'party size' }];
  for (const text of ['Table for six, under Dana Whitfield.', filler.repeat(15) + 'Table for six, under Dana Whitfield. ' + filler.repeat(15)]) {
    const evaluate = stubEvaluate({ text, fields, values: { name: 'Dana Whitfield', size: 'six', phone: null } });
    const { results } = await extractSpans({ text, fields, evaluate });
    assert.deepEqual([results.name.value, results.size.value, results.phone.status], ['Dana Whitfield', 'six', 'missing']);
    for (const r of Object.values(results)) if (r.status === 'extracted') assert.equal(text.slice(r.start, r.end), r.value);
    assert.ok(evaluate.calls >= 1);
  }
  assert.throws(() => stubEvaluate({ text: 'abc', fields, values: { name: 'zzz' } }), /not a run of whole tokens/);
});

test('stubEvaluate drives classifyChunks', async () => {
  const text = 'Call Dana Whitfield on 07700 900123.';
  const scan = await classifyChunks({ text, labels: { none: 'other', name: 'a name', phone: 'a phone number' },
    evaluate: stubEvaluate({ text, labels: { Dana: 'name', Whitfield: 'name', '07700': 'phone', '900123': 'phone' } }) });
  assert.deepEqual(mergeChunks(text, scan.detections).map(s => [s.label, s.value]), [['name', 'Dana Whitfield'], ['phone', '07700 900123']]);
});
