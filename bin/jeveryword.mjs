#!/usr/bin/env node
// Try jeveryword from a terminal, with no install and no key:
//   npx jeveryword "Hi, I'm Maya Chen from Fern Labs, maya@fern.example" name company email
//   npx jeveryword --pii "Call Maya Chen on +1 (415) 555-0123"
// Each word after the text is a field to find; quote longer descriptions ("the new order number").
// With TYPESAFE_API_KEY set it runs on your key. Without one it uses the shared, rate-limited demo.
import { extractSpans, classifyChunks, mergeChunks, createJevClient } from '../src/index.mjs';

const DEMO = (process.env.JEVERYWORD_DEMO_URL || 'https://jeveryword.vercel.app').replace(/\/$/, '');
const args = process.argv.slice(2);
const flag = name => args.includes(name) && args.splice(args.indexOf(name), 1).length > 0;
const json = flag('--json'), pii = flag('--pii'), help = flag('--help') || flag('-h');
const [text, ...wanted] = args;
const dim = s => process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s, bold = s => process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s;

if (help || !text || (!pii && !wanted.length)) {
  console.log(`Usage:
  jeveryword "<text>" <field> [field…]     pull fields out of text, e.g.  name email "order number"
  jeveryword --pii "<text>"                find personal data in text
Options: --json   print raw JSON
No key needed: without TYPESAFE_API_KEY this uses the shared demo at ${DEMO} (rate-limited).`);
  process.exit(help ? 0 : 1);
}
const fields = wanted.map((description, i) => ({ id: description.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(?![a-z])/, 'f_') || `field_${i}`, label: description, description }));

// The demo streams newline-delimited JSON events; the last useful one is the result or an error.
async function viaDemo(path, body) {
  const response = await fetch(`${DEMO}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const raw = await response.text();
  if (!response.ok) throw new Error(JSON.parse(raw).error ?? `Demo returned HTTP ${response.status}`);
  const events = raw.trim().split('\n').map(line => JSON.parse(line));
  const failed = events.find(e => e.type === 'error');
  if (failed) throw new Error(failed.error);
  return events.find(e => e.type === 'result').result;
}

try {
  const key = process.env.TYPESAFE_API_KEY;
  const evaluate = key && createJevClient({ apiKey: key });
  if (!key && !json) console.error(dim(`No TYPESAFE_API_KEY set: using the shared demo (${DEMO}), which is rate-limited.\n`));
  if (pii) {
    const labels = { none: 'Not personal or sensitive.', name: "A person's name.", email: 'An email address.', phone: 'A phone number.', address: 'A street address or precise location.', identifier: 'An ID, account or document number.', financial: 'Bank or card details.', health: 'Health information.', secret: 'A password, key or token.' };
    const detections = key ? (await classifyChunks({ text, evaluate, labels, rules: "Include any person's details. Treat every part of a multi-word entity the same way." })).detections
      : (await viaDemo('/api/pii', { text, mode: 'categorized' })).detections.map(({ category, ...d }) => ({ ...d, label: category }));
    const spans = mergeChunks(text, detections, { joinable: /^[\s,()]*$/u });
    if (json) console.log(JSON.stringify(spans, null, 2));
    else if (!spans.length) console.log('Nothing personal found.');
    else for (const s of spans) console.log(`${s.label.padEnd(11)} ${bold(s.value.padEnd(Math.max(...spans.map(x => x.value.length))))}  ${dim(`[${s.start}, ${s.end})  ${Math.round(s.score * 100)}%`)}`);
  } else {
    const { results, calls } = key ? await extractSpans({ text, fields, evaluate }) : await viaDemo('/api/extract', { text, fields, fanout: 253 });
    if (json) console.log(JSON.stringify(results, null, 2));
    else {
      const width = Math.max(...fields.map(f => f.label.length));
      const valueWidth = Math.max(0, ...Object.values(results).map(r => r.value?.length ?? 0));
      for (const f of fields) {
        const r = results[f.id];
        console.log(`${f.label.padEnd(width)}  ${r.status === 'extracted' ? `${bold(r.value.padEnd(valueWidth))}  ${dim(`${`[${r.start}, ${r.end})`.padEnd(10)} ${Math.round((r.probability ?? 1) * 100)}%`)}` : dim(r.status === 'missing' ? '— not in the text' : '— ambiguous')}`);
      }
      console.error(dim(`\n${calls} model call${calls === 1 ? '' : 's'}. Every value is an exact slice of your text.`));
    }
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
