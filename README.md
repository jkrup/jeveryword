# jeveryword

[Jev](https://docs.typesafe.ai) answers multiple-choice questions. It cannot write, so it
cannot hand you a name, an email, or a quote from a document. It can point, though.

This library is the plumbing that makes pointing useful: it numbers the pieces of a text,
gives you those numbers as answer options, and turns the numbers the model picks back
into the exact original substring with character offsets. Whatever you get back is
verbatim source text. Nothing can be invented.

No dependencies. Works anywhere `fetch` does (Node 20+, Workers, Deno, Bun, browsers).
Experimental: checked on a handful of synthetic samples, not benchmarked.

```sh
npm install github:jkrup/jeveryword
```

## The core: ask anything about a text, get text back

```js
import { index, createJevClient } from 'jeveryword';

const evaluate = createJevClient({ apiKey: process.env.TYPESAFE_API_KEY }); // or your own, see below
const doc = index('Please send the recieved invoices to accounting before Friday.');

doc.state      // { source_text: 'Please send…', tokens: '0|Please\n1|send\n2|the\n3|recieved\n…' }
doc.options()  // { '0': null, '1': null, '2': null, '3': null, … }  one option per token

// Your question:
const { answers } = await evaluate({
  state: doc.state,
  questions: {
    typo: { type: 'choice', instructions: 'Which token is a misspelled word?', criteria: doc.options({ also: ['none'] }) },
  },
});

doc.pick(answers.typo.choice)
// → { value: 'recieved', start: 16, end: 24, lo: 3, hi: 3 }   (null if the model chose 'none')
```

That is the whole idea. The library knows nothing about spelling; it only guarantees the
round trip from text to ids and back.

For an answer longer than one token, ask where it starts and where it ends in the same
request, then resolve the pair:

```js
const criteria = doc.options({ also: ['none'] });
const { answers } = await evaluate({ state: doc.state, questions: {
  first: { type: 'choice', criteria, instructions: 'FIRST token of the part where the customer says what they want done?' },
  last:  { type: 'choice', criteria, instructions: 'LAST token of the part where the customer says what they want done?' },
}});
const first = doc.decode(answers.first.choice), last = doc.decode(answers.last.choice);
if (first && last && first.lo <= last.hi) doc.resolve(first.lo, last.hi, { trim: true }); // { value, start, end }
```

Every answer also carries `probabilities`, one number per option, so you can tell a sure
pick from a coin toss. (Jev adds `confidence` too: its own 0 to 1 summary of how peaked those
probabilities are.) The option values are `null` because an option needs no description here:
the numbered list already says what each id is.

| | |
| --- | --- |
| `index(text, { chunker?, prefix? })` | Split the text into numbered chunks. `chunkers.tokens` (default) separates words, numbers and punctuation; `chunkers.words` keeps emails, phone numbers and ids whole; or pass your own `text => [{ text, start, end }]`. |
| `doc.list(ranges?)` | The `id\|chunk` lines for the model to read, optionally only some ranges. |
| `doc.state` | `{ source_text, tokens: doc.list() }`, ready to send. Add your own keys freely. |
| `doc.options({ lo?, hi?, fanout?, also? })` | Answer options: bare ids with `null` descriptions. With more chunks than `fanout` (max 253 per question) they become balanced id ranges such as `40-59`, to narrow over several rounds. `also` adds answers like `'missing'`. |
| `doc.decode(choice)` | `'12'` → `{ lo: 12, hi: 12 }`, `'40-59'` → `{ lo: 40, hi: 59 }`, anything else → `null`. |
| `doc.resolve(lo, hi?, { trim? })` | Ids back to `{ value, start, end, lo, hi }`. Also accepts a decoded range. `trim` drops trailing sentence punctuation. |
| `doc.pick(choice, { trim? })` | `decode` + `resolve` in one step; `null` for a non-id choice. |
| `doc.sentences()` | Sentence ranges, for narrowing long text before pointing at tokens. |
| `mergeChunks(text, detections, options?)` | Join neighbouring labelled chunks back into text spans. |

Two details in here were learned the hard way. Bare ids with `null` descriptions cost far
fewer tokens than describing every option, because the numbered list already says what
each id is. And one `id|chunk` per line is what Jev reads reliably: with inline markers it
kept choosing the id after the word it meant.

## Bring your own model call

Everything that talks to a model takes an `evaluate` function:
`({ state, questions }) => Promise<{ answers }>`.

```js
// TypeSafe's SDK fits as-is
import { TypeSafeClient } from '@typesafe-ai/sdk';
const client = new TypeSafeClient();
const evaluate = request => client.systemOne(request);

// or the small dependency-free client in this package (optional)
import { createJevClient } from 'jeveryword';   // also exported from 'jeveryword/client'
const evaluate = createJevClient({ apiKey: process.env.TYPESAFE_API_KEY });
```

The bundled client adds 429 handling that honors `Retry-After`, a typed
`max_tokens_exceeded` error the helpers below use to shrink a request and retry, and an
optional [Vercel AI Gateway](https://vercel.com/ai-gateway) route that falls back to
TypeSafe's API: `createJevClient({ gateway: { token }, apiKey })`.

For tests, `jeveryword/testing` has a stand-in that needs no network or key: tell it the right answers and it plays the model.

```js
import { stubEvaluate } from 'jeveryword/testing';
const evaluate = stubEvaluate({ text, fields, values: { name: 'Maya Chen', phone: null } });  // for extractSpans
const evaluate = stubEvaluate({ text, labels: { Maya: 'name', Chen: 'name' } });              // for classifyChunks
```

## Two helpers built on the core

### Field extraction

```js
import { extractSpans, createJevClient } from 'jeveryword';
const evaluate = createJevClient({ apiKey: process.env.TYPESAFE_API_KEY });

const { results, calls } = await extractSpans({
  evaluate,
  text: "Alex Smith sent me your way. I'm Maya Chen, a software engineer at Fern Labs. My email is maya.old@example.com, actually use maya.chen@example.com.",
  fields: [
    { id: 'name', description: "The speaker's full name, not somebody else's." },
    { id: 'role', description: "The speaker's job title, without a leading article." },
    { id: 'email', description: "The speaker's current email. Respect explicit corrections." },
    { id: 'phone', description: "The speaker's phone number." },
  ],
});
// name   'Maya Chen'              [33, 42)
// role   'software engineer'      [46, 63)
// email  'maya.chen@example.com'  [125, 146)
// phone  missing
```

`results` has one entry per field id:

```js
{ status: 'extracted', value: 'Maya Chen', start: 33, end: 42, probability: 0.99, tokenStart: 8, tokenEnd: 9 }
{ status: 'missing',   value: null, probability: 0.98 }   // not stated in the text
{ status: 'ambiguous', value: null, probability: 0.61 }   // several candidates, or an unclear boundary
```

`text.slice(start, end) === value`, always. `tokenStart` and `tokenEnd` are the ids of the
first and last token, as `index(text)` numbers them. `probability` is the weakest decision on
the way to that answer, so sorting by it shows what to double-check:

```js
const shaky = Object.entries(results).filter(([, r]) => r.probability < 0.8);
```

A field's `description` is the whole prompt for that field. Say whose value you mean, which
one when several appear ("the new number, not the current one"), and what to leave out
("without a leading article"). Up to 16 fields per call; ids use letters, digits and
underscores; text up to 20,000 characters (enforced). The return value also has `calls`,
`inputTokens`, `durationMs`, and a `trace` of every question, probability and token count.
Empty text returns every field as `missing` without calling the model.

What it does so you do not have to:

- Shared rules go in state once; each question is one short line plus bare ids.
- Span starts and ends are asked in the same request. A guessed end is kept only if it is
  confident and consistent with the start; otherwise it is asked again with the start as
  context.
- Text too long for one question is searched sentence-first: one request finds each
  field's sentence, then tokens are listed and searched only inside those sentences.
- A boundary with a serious rival token is settled by one small request that shows the
  competing spans as text. Jev's probabilities drift between runs; this removes most of
  the resulting flakiness.
- Trailing sentence punctuation is trimmed. Requests that exceed the token limit are
  shrunk and retried; text is never truncated.

Each step has a switch: `speculate`, `locate`, `verify`, `trimPunctuation` (all default
`true`). `fanout` (2 to 253, default 253) caps the options per question; lower values trade
more rounds for smaller requests.

### Labelling every chunk

```js
import { classifyChunks, mergeChunks } from 'jeveryword';

const scan = await classifyChunks({
  evaluate, text,
  labels: { none: 'Ordinary prose.', name: "A person's name.", contact: 'An email address or phone number.' },
  rules: 'Include every person mentioned, not only the speaker.',
});
mergeChunks(text, scan.detections, { threshold: 0.5 });
// → [{ label: 'name', value: 'Maya Chen', start, end, score }, …]
```

One tiny question per chunk, up to 96 per request. Every chunk comes back in
`scan.detections` as `{ value, start, end, label, score, probabilities }`, including the
uninteresting ones: `label` is the best label other than `none`, and `score` is
`1 - P(none)`, so "the" might be `{ label: 'name', score: 0.01 }`. `mergeChunks` keeps the
chunks whose score reaches `threshold` (default 0.5) and joins neighbours that share a
label. Because the scores are already there, a UI slider can re-run `mergeChunks` at a new
threshold without asking the model again. `labels` must include the `none` option (rename it
with `none: 'other'`), since without one every chunk is forced into a real label and the
scores stop meaning anything. Text up to 20,000 characters (enforced).
[`examples/pii.mjs`](examples/pii.mjs) is a PII highlighter in about twenty lines of this.

## Errors and types

Thrown errors carry a `code`: `invalid_input` (your arguments; the message names the field or
option at fault), `invalid_answer` (the model function returned a choice that was not offered;
the message says which question and what was received, which is what you need when writing
your own `evaluate`), and from the bundled client `max_tokens_exceeded` and `rate_limited`.
TypeScript declarations ship with the package.

One caveat on untrusted input. The model can only ever answer with ids, so text cannot make
it produce words that are not in the source, and every prompt tells it the text is data. Text
can still influence **which** span it points at. Treat `probability` and your own validation
as the check, not the prompt.

## Use it from a coding agent

For Claude Code, copy [`skills/jeveryword`](skills/jeveryword) into your project's
`.claude/skills/` (or `~/.claude/skills/`) and ask for what you want ("pull the name and email
out of each support message"). For any other agent, paste this:

```text
Add the jeveryword library to this project and use it for the task below.
jeveryword lets TypeSafe's Jev (a multiple-choice-only model) return exact text: it numbers a
text's tokens, Jev picks numbers, the library maps them back to the verbatim substring with offsets.

Read https://github.com/jkrup/jeveryword/blob/main/skills/jeveryword/SKILL.md first and follow it.
Essentials if you cannot open it:
- npm install github:jkrup/jeveryword   (ESM only; server-side; needs TYPESAFE_API_KEY in the environment, never in browser code)
- import { createJevClient, extractSpans, classifyChunks, mergeChunks, index } from 'jeveryword'
- const evaluate = createJevClient({ apiKey: process.env.TYPESAFE_API_KEY })
- Named fields: const { results } = await extractSpans({ evaluate, text, fields: [{ id, description }] })
  each result: { status: 'extracted' | 'missing' | 'ambiguous', value, start, end, probability }
- A label per word: const { detections } = await classifyChunks({ evaluate, text, labels: { none: '…', myLabel: '…' } })
  then mergeChunks(text, detections, { threshold: 0.5 }) → [{ label, value, start, end, score }]
- Anything else: const doc = index(text); send { state: doc.state, questions: { q: { type: 'choice',
  instructions, criteria: doc.options({ also: ['none'] }) } } } to evaluate; then doc.resolve(doc.decode(answers.q.choice))
- Values are verbatim spans only. If a value must be computed or reformatted (a date, a total), extract the
  span and convert it in code. Handle 'missing' and 'ambiguous'; confirm anything with probability under 0.8.
- Add a test asserting text.slice(start, end) === value.

Task: <describe what you want extracted, labelled or found, and where in the app>
```

## Examples

```sh
export TYPESAFE_API_KEY=…
node examples/custom-question.mjs   # the core alone: find a typo
node examples/extract.mjs           # fields out of a message
node examples/pii.mjs "Call Maya Chen on +1 (415) 555-0123."
npm test                            # stub model, no network
```

## What to expect

Measured on single runs at Jev's list price of $42 per billion input tokens:

| Task | Input tokens | Calls | Cost |
| --- | ---: | ---: | ---: |
| 10 fields from a 210-character message | 9,234 | 1 | $0.0004 |
| 10 fields from a 270-character message with corrections | 11,860 | 2 | $0.0005 |
| 10 fields buried in a 2,086-character message | 7,337 | 2 | $0.0003 |
| PII labels for 56 chunks, 13 categories | 6,832 | 1 | $0.0003 |
| PII yes/no for 56 chunks | 2,798 | 1 | $0.0001 |

A call takes a few hundred milliseconds. All fields matched on these samples; that is an
anecdote, not an accuracy claim.

Good fit: short text handled live, where you need the exact span, a probability for every
decision, and output that can only ever be text from the source. Poor fit: long documents, values that
must be computed or reformatted ("next Tuesday", "thirty-six"), answers spread across
sentences, and bulk offline jobs where a small LLM with JSON output costs less.

## License

MIT
