---
name: jeveryword
description: Add exact-text answers from TypeSafe's Jev to an app with the jeveryword library. Use when the user wants to pull fields out of free text (names, emails, amounts, dates as written), highlight or redact PII, label words or phrases, or ask any "which part of this text…" question and get back a verbatim substring with character offsets and a probability. Also use when the user mentions Jev, TypeSafe, System One, or jeveryword.
---

# Using jeveryword in an app

Jev is a model that only answers multiple-choice questions. jeveryword numbers the pieces
of a text, offers those numbers as the options, and maps the numbers Jev picks back to the
exact original substring. Every value you get is verbatim source text with offsets.

## Decide if it fits before writing code

Use it when the answer is **written in the text** and you want it exactly: form filling from
chat messages, intake, PII highlighting, quoting the clause that says X, tagging words.

Do not use it when the value must be **computed or reformatted** ("next Tuesday" → a date,
"thirty-six" → 36, a total across line items), when the answer is spread over several
sentences, or for documents beyond roughly 20,000 characters. Say so and suggest an LLM with
JSON output, optionally verified with `text.includes(value)`.

If the user needs a normalized value, extract the verbatim span with jeveryword and normalize
it in code afterwards (`new Date(...)`, `parseFloat(...)`).

## Setup

```sh
npm install github:jkrup/jeveryword
```

It needs `TYPESAFE_API_KEY` in the environment on the **server**. Never ship the key to a
browser: call jeveryword from a server route and return results to the client.

Every helper takes an `evaluate` function. Create it once:

```js
import { createJevClient } from 'jeveryword';
const evaluate = createJevClient({ apiKey: process.env.TYPESAFE_API_KEY });
// or, with TypeSafe's SDK (@typesafe-ai/sdk):  const evaluate = request => client.systemOne(request);
```

Everything is a named export of `'jeveryword'`: `tokenize`, `extractSpans`, `classifyChunks`,
`mergeChunks`, `createJevClient`, `chunkers`. It is ESM only (`import`, not `require`).

## Pick one of three tools

### 1. Named fields out of a text → `extractSpans`

```js
import { extractSpans } from 'jeveryword';

const { results, calls } = await extractSpans({
  evaluate,
  text: message,
  fields: [
    { id: 'name',  description: "The sender's full name, not anyone else mentioned." },
    { id: 'email', description: "The sender's current email address. Respect corrections." },
  ],
});

for (const [id, r] of Object.entries(results)) {
  if (r.status === 'extracted') use(id, r.value, r.start, r.end); // text.slice(r.start, r.end) === r.value
  else handleAbsent(id, r.status);                                // 'missing' or 'ambiguous', value is null
}
```

Each result is one of:

```js
{ status: 'extracted', value: 'Maya Chen', start: 33, end: 42, probability: 0.99, tokenStart: 8, tokenEnd: 9 }
{ status: 'missing',   value: null, probability: 0.98 }   // not stated in the text
{ status: 'ambiguous', value: null, probability: 0.61 }   // several candidates or an unclear boundary
```

`probability` (0 to 1) is the weakest decision behind that answer. Route anything under
about 0.8 to a confirmation step ("Is your email maya.chen@example.com?") instead of
saving it silently.

- `id`: letters, digits, underscores. Up to 16 fields per call.
- `description` is the whole prompt for that field. Be specific about **whose** value, **which**
  one when several appear ("the new number, not the current one"), and what to leave out
  ("without a leading article", "just the number").
- Always handle `missing` and `ambiguous`. Never substitute a default silently.

### 2. A label for every word → `classifyChunks` + `mergeChunks`

```js
import { classifyChunks, mergeChunks } from 'jeveryword';

const scan = await classifyChunks({
  evaluate, text,
  labels: { none: 'Ordinary text.', name: "A person's name.", contact: 'An email address or phone number.' },
  rules: 'Include every person mentioned, not only the author.',
});
const spans = mergeChunks(text, scan.detections, { threshold: 0.5 });
// [{ label, value, start, end, score }]
```

`scan.detections` has an entry for **every** chunk, `{ value, start, end, label, score,
probabilities }`, including uninteresting ones with a score near 0. Do not display it raw:
`mergeChunks` keeps chunks with `score >= threshold` and joins neighbours with the same label.

A `none` label is required (rename it with the `none` option): each score is then `1 - P(none)`, so a UI slider can re-filter
`scan.detections` with `mergeChunks` at a new threshold without calling the model again.
For PII highlighting or redaction, start from this label set (the fuller one is in
`node_modules/jeveryword/examples/pii.mjs`):

```js
const labels = {
  none: 'Not personal or sensitive information in this context.',
  name: 'A person’s name, including any part of a full name.',
  email: 'An email address.',
  phone: 'A telephone number.',
  address: 'A street address, postal code, or precise personal location.',
  identifier: 'Government, customer, patient or account identifier.',
  financial: 'Bank account, payment card, or other private financial information.',
  health: 'Health or medical information tied to a person.',
  secret: 'A password, API key, access token or PIN.',
};
const rules = "Include ANY person's details, old or corrected values, and repeats. Treat every part of a multi-word entity the same way. Do not flag labels like \"email\" that merely introduce a value.";

// Redact: replace from the end so earlier offsets stay valid.
let redacted = text;
for (const s of mergeChunks(text, scan.detections, { threshold: 0.5, joinable: /^[\s,()]*$/u }).reverse()) {
  redacted = redacted.slice(0, s.start) + `[${s.label.toUpperCase()}]` + redacted.slice(s.end);
}
```

### 3. Any other question about a text → the core

```js
import { tokenize } from 'jeveryword';

const doc = tokenize(text);
const { answers } = await evaluate({
  state: doc.state,
  questions: {
    q: { type: 'choice', instructions: 'Which token is a misspelled word?', criteria: doc.options({ also: ['none'] }) },
  },
});
const hit = doc.pick(answers.q.choice);          // { value, start, end }, or null when the model chose 'none'
```

For a multi-word answer, ask for both ends in the same call and resolve the pair:

```js
const criteria = doc.options({ also: ['none'] });
const { answers } = await evaluate({ state: doc.state, questions: {
  first: { type: 'choice', criteria, instructions: 'FIRST token of the clause that states the refund policy?' },
  last:  { type: 'choice', criteria, instructions: 'LAST token of the clause that states the refund policy?' },
}});
const first = doc.decode(answers.first.choice), last = doc.decode(answers.last.choice);
const quote = first && last && first.lo <= last.hi ? doc.resolve(first.lo, last.hi, { trim: true }) : null;
```

`answers.<id>.probabilities` has one number per option. One question can offer at most 253
tokens; for longer text use `extractSpans`, or narrow first with `doc.sentences()` and
`doc.options({ lo, hi })`. Put instructions shared by all questions in `state` (for example
`{ ...doc.state, rules: '…' }`): state is billed once per request, each question separately.

## Testing without the network

Do not hand-write fake model responses; the question format is an internal detail. Use the
stand-in from `jeveryword/testing` and tell it the right answers:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { stubEvaluate } from 'jeveryword/testing';

test('reads a booking', async () => {
  const text = 'Table for six, under Dana Whitfield.';
  // extractSpans: values by field id (verbatim text, or null for "not stated")
  const evaluate = stubEvaluate({ text, fields, values: { guestName: 'Dana Whitfield', partySize: 'six', phone: null } });
  const booking = await readBooking(text, { evaluate });
  assert.equal(text.slice(booking.guestName.start, booking.guestName.end), 'Dana Whitfield');
});
// classifyChunks: stubEvaluate({ text, labels: { Dana: 'name', Whitfield: 'name' } })  (chunk text → label)
```

`fields` must be the same `{ id, description }` list your code passes to `extractSpans`. To
make this possible, write app functions so `evaluate` can be passed in, defaulting to the
real client.

## Before you call it done

- Assert `text.slice(start, end) === value` in a test for at least one real input.
- Catch errors by `error.code`: `invalid_input` (fix the arguments; the message names the field), `invalid_answer`
  (the model function returned something not offered), `rate_limited`, `max_tokens_exceeded`. Text over 20,000
  characters throws `invalid_input`; split it yourself or use a different tool.
- Show or log low-confidence results instead of trusting them: `probability` on each
  `extractSpans` result, `score` on each `classifyChunks` detection.
- Cost is roughly $0.0004 for ten fields from a short message and a few hundred
  milliseconds per call. Debounce calls from UI events; do not call on every keystroke.
- Text sent to `evaluate` goes to TypeSafe. Mention that wherever the app handles user data.
