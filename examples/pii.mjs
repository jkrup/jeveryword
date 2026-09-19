// PII highlighting: classifyChunks() with a label set and a few rules. Run:
//   TYPESAFE_API_KEY=... node examples/pii.mjs "Call Maya Chen on +1 (415) 555-0123."
import { classifyChunks, mergeChunks } from '../src/index.mjs';

export const piiCategories = {
  none: 'Not personal or sensitive information in this context.',
  name: 'A real or potentially real person’s name, including any part of a full name.',
  email: 'An email address belonging to or used to contact a person.',
  phone: 'A telephone or fax number.',
  address: 'A street address, apartment, postal code, or precise personal location.',
  identifier: 'Government, passport, tax, national ID, driver license, customer, patient, or other personal account identifier.',
  financial: 'Bank account, routing number, payment card, or other private financial information.',
  date: 'A date of birth or other personally identifying date.',
  online: 'A personal username, social handle, IP address, device identifier, or identifying personal URL.',
  health: 'Health, medical, disability, or other sensitive personal information tied to a person.',
  demographic: 'Age, personal city/location, workplace, or demographic attribute that could identify someone in combination.',
  secret: 'A password, API key, access token, PIN, or other authentication secret.',
  other: 'Other potentially identifying or sensitive personal information not covered above.',
};
const binary = { pii: 'Contains or forms part of personal or sensitive data: names, contacts, IDs, addresses, personal attributes, health, financial data or secrets.', none: 'Ordinary prose, not personal or sensitive.' };
const rules = 'Broad personal/sensitive information scan. Include ANY person\'s details, old or corrected values, and repeated occurrences. ' +
  'Treat every component of a multi-chunk entity consistently (including address numbers and name parts). Do not flag generic labels like ' +
  '"email" or "name" merely because they introduce a value. Use none for ordinary prose. Prefer flagging possible exposure over silently ignoring uncertain personal data.';

// mode 'binary' asks pii/none per chunk (fewer tokens); 'categorized' asks for the kind of PII.
export async function detectPII({ text, evaluate, mode = 'categorized', ...options }) {
  if (!['binary', 'categorized'].includes(mode)) throw new Error('Choose PII only or categorized mode.');
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('Enter 1–4,000 characters.');
  const scan = await classifyChunks({ text, evaluate, rules, labels: mode === 'binary' ? binary : piiCategories, ...options });
  return { mode, ...scan, detections: scan.detections.map(({ label, ...d }) => ({ ...d, category: label })), estimatedCost: scan.inputTokens * 42 / 1e9 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { createJevClient } = await import('../src/client.mjs');
  const text = process.argv[2] ?? "Alex Smith referred me. I'm Maya Chen, born 09/07/1990. Email maya.chen@example.com or call +1 (415) 555-0123. My doctor is treating my asthma. The meeting is next Tuesday.";
  const scan = await detectPII({ text, evaluate: createJevClient({ apiKey: process.env.TYPESAFE_API_KEY }) });
  for (const span of mergeChunks(text, scan.detections, { key: 'category', joinable: /^[\s,()]*$/u })) console.log(`${span.category.padEnd(12)} ${Math.round(span.score * 100)}%  ${span.value}`);
  console.error(`${scan.calls} call(s), ${scan.inputTokens} input tokens`);
}
