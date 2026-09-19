# jev-span

[Jev](https://docs.typesafe.ai) answers multiple-choice questions. It cannot write, so it
cannot hand you a name, an email, or a quote from a document. It can point, though.

This library is the plumbing that makes pointing useful: it numbers the pieces of a text,
gives you those numbers as answer options, and turns the numbers the model picks back
into the exact original substring with character offsets. Whatever you get back is
verbatim source text. Nothing can be invented.

No dependencies. Works anywhere `fetch` does (Node 20+, Workers, Deno, Bun, browsers).
Experimental: checked on a handful of synthetic samples, not benchmarked.

```sh
npm install github:jkrup/jev-span
```

## The core: ask anything about a text, get text back

```js
import { index } from 'jev-span';

const doc = index('Please send the recieved invoices to accounting before Friday.');

doc.state      // { source_text: 'Please send…', tokens: '0|Please\n1|send\n2|the\n3|recieved\n…' }
doc.options()  // { '0': null, '1': null, '2': null, '3': null, … }  one option per token

// Your question, your model call:
const { answers } = await jev({
  state: doc.state,
  questions: {
    typo: { type: 'choice', instructions: 'Which token is a misspelled word?', criteria: doc.options({ also: ['none'] }) },
  },
});

doc.resolve(doc.decode(answers.typo.choice))
// → { value: 'recieved', start: 16, end: 24, lo: 3, hi: 3 }
```

That is the whole idea. The library knows nothing about spelling; it only guarantees the
round trip from text to ids and back.

| | |
| --- | --- |
| `index(text, { chunker?, prefix? })` | Split the text into numbered chunks. `chunkers.tokens` (default) separates words, numbers and punctuation; `chunkers.words` keeps emails, phone numbers and ids whole; or pass your own `text => [{ text, start, end }]`. |
| `doc.list(ranges?)` | The `id\|chunk` lines for the model to read, optionally only some ranges. |
| `doc.state` | `{ source_text, tokens: doc.list() }`, ready to send. Add your own keys freely. |
| `doc.options({ lo?, hi?, fanout?, also? })` | Answer options: bare ids with `null` descriptions. With more chunks than `fanout` (max 253 per question) they become balanced id ranges such as `40-59`, to narrow over several rounds. `also` adds answers like `'missing'`. |
| `doc.decode(choice)` | `'12'` → `{ lo: 12, hi: 12 }`, `'40-59'` → `{ lo: 40, hi: 59 }`, anything else → `null`. |
| `doc.resolve(lo, hi?, { trim? })` | Ids back to `{ value, start, end, lo, hi }`. Also accepts a decoded range. |
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
import { createJevClient } from 'jev-span/client';
const evaluate = createJevClient({ apiKey: process.env.TYPESAFE_API_KEY });
```

The bundled client adds 429 handling that honors `Retry-After`, a typed
`max_tokens_exceeded` error the helpers below use to shrink a request and retry, and an
optional [Vercel AI Gateway](https://vercel.com/ai-gateway) route that falls back to
TypeSafe's API: `createJevClient({ gateway: { token }, apiKey })`. A stub function works
too, which is how this repo's tests run without a network.

## Two helpers built on the core

### Field extraction

```js
import { extractSpans } from 'jev-span';

const { results } = await extractSpans({
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

Fields are plain-English instructions defined at runtime. Each result is a contiguous
source span, `missing`, or `ambiguous`. The return value also carries `calls`,
`durationMs` and a `trace` of every question, probability and usage figure.

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

Every step can be switched off: `speculate`, `locate`, `verify`, `trimPunctuation`, `fanout`.

### Labelling every chunk

```js
import { classifyChunks, mergeChunks } from 'jev-span';

const scan = await classifyChunks({
  evaluate, text,
  labels: { none: 'Ordinary prose.', name: "A person's name.", contact: 'An email address or phone number.' },
  rules: 'Include every person mentioned, not only the speaker.',
});
mergeChunks(text, scan.detections, { threshold: 0.5 });
// → [{ label: 'name', value: 'Maya Chen', start, end, score }, …]
```

One tiny question per chunk, up to 96 per request. With a `none` label each score is
`1 - P(none)`, so a UI can move a threshold slider without asking again.
[`examples/pii.mjs`](examples/pii.mjs) is a PII highlighter in about twenty lines of this.

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
decision, and output that the input cannot steer. Poor fit: long documents, values that
must be computed or reformatted ("next Tuesday", "thirty-six"), answers spread across
sentences, and bulk offline jobs where a small LLM with JSON output costs less.

## License

MIT
