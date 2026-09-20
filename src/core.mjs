// The whole idea: a choice-only model cannot return text, but it can point. tokenize() numbers
// the pieces of a text so options can be bare ids, and resolve() turns the ids a model picked
// back into the exact original substring with character offsets.

// Errors carry a machine-readable code: 'invalid_input' (the caller's arguments) or
// 'invalid_answer' (the model function returned something that was not offered).
export function fail(code, message) { return Object.assign(new Error(message), { code }); }

export const chunkers = {
  // Words, numbers and punctuation as separate chunks. Joined names such as JustinKessler are
  // split at the capital; adjacent chunks can still be selected together (McDonald).
  tokens(text) {
    const chunks = [];
    for (const match of text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*|[^\s]/gu)) {
      let start = match.index;
      for (const piece of match[0].split(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})/u)) {
        chunks.push({ text: piece, start, end: start + piece.length });
        start += piece.length;
      }
    }
    return chunks;
  },
  // Whitespace-separated words with surrounding brackets, quotes and sentence punctuation
  // removed, so emails, phone numbers and ids stay in one piece.
  words(text) {
    return [...text.matchAll(/[^\s]+/gu)].flatMap(m => {
      const leading = m[0].match(/^[\(\[\{"“‘]+/u)?.[0].length ?? 0;
      const value = m[0].slice(leading).replace(/[\)\]\}"”’.,;:!?]+$/u, '');
      return value ? [{ text: value, start: m.index + leading, end: m.index + leading + value.length }] : [];
    });
  },
};

// Splits lo..hi into at most `fanout` contiguous groups of near-equal size.
export function partition(lo, hi, fanout) {
  const count = Math.min(fanout, hi - lo + 1);
  return Array.from({ length: count }, (_, i) => ({
    lo: lo + Math.floor(i * (hi - lo + 1) / count),
    hi: lo + Math.floor((i + 1) * (hi - lo + 1) / count) - 1,
  }));
}

const ABBREVIATION = /^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|Inc|Ltd|Co|Corp|vs|etc|[A-Z])$/;

export function tokenize(text, { chunker = chunkers.tokens, prefix = '' } = {}) {
  if (typeof text !== 'string') throw new TypeError('tokenize(text): text must be a string.');
  const chunks = chunker(text).map((chunk, id) => ({ id, ...chunk }));
  const last = chunks.length - 1;
  const doc = {
    text, chunks, prefix,

    // "id|chunk" lines for the model to read. One line per chunk is far cheaper than JSON, and
    // unlike inline markers it leaves no doubt which id belongs to which chunk.
    list(ranges = [{ lo: 0, hi: last }]) {
      return ranges.flatMap(({ lo, hi }) => chunks.slice(lo, hi + 1)).map(c => `${prefix}${c.id}|${c.text}`).join('\n');
    },

    // Ready-made state: the untouched text for reading, the numbered list for pointing.
    get state() { return { source_text: text, tokens: doc.list() }; },

    // Options for a choice question: bare ids with null descriptions, because the list already
    // says what each id is. More chunks than `fanout` become id ranges ("40-59") to narrow over
    // several rounds; ranges are sized so every round offers a similar, small number of options.
    // `also` adds non-pointing answers such as 'missing'.
    options({ lo = 0, hi = last, fanout = 253, also = [] } = {}) {
      if (hi < lo) return Object.fromEntries(also.map(key => [key, null]));
      const size = hi - lo + 1;
      let rounds = 1;
      for (let reach = fanout; reach < size; reach *= fanout) rounds++;
      let width = Math.min(fanout, Math.ceil(size ** (1 / rounds)));
      while (width ** rounds < size) width++;
      return Object.fromEntries([...partition(lo, hi, width).map(g => g.lo === g.hi ? `${prefix}${g.lo}` : `${prefix}${g.lo}-${prefix}${g.hi}`), ...also].map(key => [key, null]));
    },

    // The chunk range an option names: "12" → { lo: 12, hi: 12 }, "40-59" → { lo: 40, hi: 59 }.
    // Anything else ('missing', a label, a malformed or out-of-range id) → null.
    decode(choice) {
      const p = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`^${p}(\\d+)(?:-${p}(\\d+))?$`).exec(String(choice));
      if (!match) return null;
      const lo = Number(match[1]), hi = Number(match[2] ?? match[1]);
      return lo <= hi && hi <= last ? { lo, hi } : null;
    },

    // Chunk ids back to the exact original text. `trim` drops trailing sentence punctuation chunks.
    // resolve(lo, hi, options) or resolve({ lo, hi }, options), so a decode() result passes straight in.
    resolve(lo, hi = lo, options = {}) {
      if (typeof lo === 'object' && lo !== null) [lo, hi, options] = [lo.lo, lo.hi ?? lo.lo, typeof hi === 'object' ? hi : options];
      const { trim = false } = options;
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || hi > last || lo > hi) throw new RangeError(`resolve(${lo}, ${hi}): ids must satisfy 0 <= lo <= hi <= ${last}.`);
      while (trim && hi > lo && /^[.,;:!?]$/.test(chunks[hi].text)) hi--;
      const start = chunks[lo].start, end = chunks[hi].end;
      return { value: text.slice(start, end), start, end, lo, hi };
    },

    // decode + resolve in one step: the text a model's choice points at, or null when the choice
    // was not an id ('none', 'missing', …).
    pick(choice, options) {
      const range = doc.decode(choice);
      return range && doc.resolve(range, options);
    },

    // Chunk ranges of sentences, for narrowing long text before pointing at chunks. Conservative:
    // splits only after . ! ? followed by whitespace, or at a line break, and not after common
    // abbreviations, so a value rarely straddles a cut.
    sentences() {
      const out = [];
      for (let i = 0, lo = 0; i <= last; i++) {
        const gap = i === last ? '\n' : text.slice(chunks[i].end, chunks[i + 1].start);
        const stop = /^[.!?…]$/.test(chunks[i].text) && /\s/.test(gap) && !(chunks[i].text === '.' && i > lo && ABBREVIATION.test(chunks[i - 1].text));
        if (!stop && !gap.includes('\n')) continue;
        out.push({ id: out.length, lo, hi: i, text: text.slice(chunks[lo].start, chunks[i].end) });
        lo = i + 1;
      }
      return out;
    },
  };
  return doc;
}

// Adjacent chunks that share a label and clear the threshold, joined back into text spans
// (for highlighting or redaction). A joined span reports its weakest chunk's score.
export function mergeChunks(text, detections, { threshold = 0.5, key = 'label', joinable = /^[\s,]*$/u } = {}) {
  const spans = [];
  for (const d of detections.filter(d => d.score >= threshold && d.score > 0).sort((a, b) => a.start - b.start)) {
    const previous = spans.at(-1);
    if (previous && previous[key] === d[key] && joinable.test(text.slice(previous.end, d.start))) {
      previous.end = d.end; previous.score = Math.min(previous.score, d.score);
    } else spans.push({ [key]: d[key], start: d.start, end: d.end, score: d.score });
  }
  return spans.map(s => ({ ...s, value: text.slice(s.start, s.end) }));
}
