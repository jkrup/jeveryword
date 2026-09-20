// A stand-in for the model, so code built on jeveryword can be tested without a network or a
// key. You say what the right answers are; it answers the library's questions accordingly.
import { tokenize, chunkers } from './core.mjs';

// stubEvaluate({ text, fields, values: { name: 'Maya Chen', phone: null } })   for extractSpans
// stubEvaluate({ text, labels: { 'Maya': 'name', 'Chen': 'name' } })           for classifyChunks
// A value must appear verbatim in the text; null or an absent id answers 'missing'. Chunks not
// listed in `labels` answer `none`. Custom questions get `fallback(question, key)` if you pass one.
export function stubEvaluate({ text, fields = [], values = {}, labels = {}, none = 'none', fallback } = {}) {
  const doc = tokenize(text);
  const spans = Object.fromEntries(fields.map(f => {
    const value = values[f.id];
    if (value === null || value === undefined) return [f.id, null];
    const start = text.indexOf(value), end = start + value.length;
    const inside = doc.chunks.filter(c => c.start >= start && c.end <= end);
    if (start < 0 || !inside.length || inside[0].start !== start || inside.at(-1).end !== end) throw new Error(`stubEvaluate: ${JSON.stringify(value)} is not a run of whole tokens in the text.`);
    return [f.id, { lo: inside[0].id, hi: inside.at(-1).id }];
  }));
  const sure = choice => ({ choice, probabilities: { [choice]: 1 }, confidence: 1 });
  const evaluate = async ({ questions }) => {
    evaluate.calls++;
    return { model: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, answers: Object.fromEntries(Object.entries(questions).map(([key, q]) => {
      const chunk = /^Chunk c\d+: (".*")$/s.exec(q.instructions);
      if (chunk) {
        const label = labels[JSON.parse(chunk[1])] ?? none;
        return [key, { choice: label, probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === label ? 1 : 0])) }];
      }
      const field = fields.find(f => q.instructions.includes(`this field: ${f.description}`));
      if (!field) {
        if (fallback) return [key, fallback(q, key)];
        throw new Error(`stubEvaluate: no answer for question ${key}: ${q.instructions.slice(0, 80)}`);
      }
      const span = spans[field.id];
      if (!span) return [key, sure('missing')];
      if (q.instructions.startsWith('Point to the sentence')) return [key, sure(`s${doc.sentences().find(s => span.lo >= s.lo && span.lo <= s.hi).id}`)];
      const target = q.instructions.startsWith('Point to the FIRST') ? span.lo : span.hi;
      return [key, sure(Object.keys(q.criteria).find(k => { const r = doc.decode(k); return r && target >= r.lo && target <= r.hi; }))];
    })) };
  };
  evaluate.calls = 0;
  return evaluate;
}
export { chunkers };
