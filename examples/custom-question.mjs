// The core on its own: ask your own question about a text and get exact text back.
// Here: "which word is misspelled?" Nothing in the library knows about spelling. Run:
//   TYPESAFE_API_KEY=... node examples/custom-question.mjs
import { tokenize } from '../src/index.mjs';

const doc = tokenize('Please send the recieved invoices to accounting before Friday.');

// Any function that posts { state, questions } to Jev works; this is the plain HTTP call.
const response = await fetch('https://api.typesafe.ai/v1/systemone', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'jev-latest',
    state: doc.state, // the text, plus "0|Please 1|send ..." one per line
    questions: {
      typo: { type: 'choice', instructions: 'Which token is a misspelled word?', criteria: doc.options({ also: ['none'] }) },
    },
  }),
});
const { answers } = await response.json();

const picked = doc.decode(answers.typo.choice); // { lo, hi } or null for 'none'
console.log(picked ? doc.resolve(picked) : 'no typo found'); // { value: 'recieved', start: 16, end: 24, ... }
